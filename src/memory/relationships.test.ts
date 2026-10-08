import { saveAdventure, getAdventure, deleteAdventure } from "../db/adventureDb";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard, makeTriggerRule, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { onePassMemoryActions, parseOnePassMemory } from "./onePassMemory";
import { relationshipConflicts, relationshipItemId, relationshipTargets, validRelationshipState } from "./relationships";
import { runTurnPipeline } from "../state/turnPipeline";
import { runCompactMemoryFallback } from "./compactMemoryFallback";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runContinuityCheck, scanForRiskyClaims } from "../continuityLint";
import { runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import type { BrainPatch, MemoryProposal } from "../types/adventure";
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn(), isNativeDeepSeekProvider: vi.fn(() => false) }));
vi.mock("../continuityLint", () => ({ scanForRiskyClaims: vi.fn(() => false), runContinuityCheck: vi.fn() }));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const initial = { bond: "romantic partners", status: "dating", dimensions: { trust: "guarded", respect: "high", affection: "warm" } };
const proposed = { ...initial, dimensions: { ...initial.dimensions, trust: "growing" } };
const story = "Kori watches Seth return the stolen keepsake. Kori thanks Seth for keeping his promise.";
const config = { ...defaultModelConfig, model: "test", apiKey: "test", baseUrl: "https://example.com/v1" };
function fixture() {
  let a = structuredClone(createDefaultAdventure("Relationships"));
  a.brains = [makeBrain({ id: "kori", characterName: "Kori", thoughts: {} })];
  a.storyCards = [makeStoryCard({ id: "seth-card", title: "Seth", type: "character", content: "Character profile." }), makeStoryCard({ id: "mira-card", title: "Mira", type: "character", content: "Character profile." })];
  a.memoryDetectionSettings.enabled = true;
  a = adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "kori", focusStoryCardId: "seth-card", state: initial });
  return a;
}
function candidate(a = fixture()) { return { kind: "relationshipChange", effects: [], target: "kori", relationshipId: a.brains[0].relationships[0].id, focus: "Seth", focusStoryCardId: "seth-card", revision: 0, proposed,
  evidence: "Kori thanks Seth for keeping his promise.", knowledgeEvidence: "Kori watches Seth return the stolen keepsake.", reason: "Observed follow-through supports a small trust shift" }; }
function propose(a = fixture(), u: unknown = candidate(a), text = story) {
  return onePassMemoryActions(a, buildContext(a, { currentInput: "Kori and Seth talk." }), [u], text, "story-1").reduce(adventureReducer, a);
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(scanForRiskyClaims).mockReturnValue(false); });
describe("dynamic relationships", () => {
  it("normalizes old saves and independently defaults relationship approval off", () => {
    const a = fixture();
    const old = JSON.parse(JSON.stringify(a)); delete old.brains[0].relationships; delete old.memoryAutoApprove.relationshipUpdate;
    expect(normalizeAdventure(old).brains[0].relationships).toEqual([]);
    expect(normalizeAdventure(old).memoryAutoApprove.relationshipUpdate).toBe(false);
  });
  it("supports multiple directional focuses, keeps starting history and rejects duplicate enrollment and numeric meters", () => {
    let a = fixture();
    a = adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "kori", focusStoryCardId: "mira-card", state: initial });
    expect(a.brains).toHaveLength(1); expect(a.brains[0].relationships).toHaveLength(2);
    expect(adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "kori", focusStoryCardId: "seth-card", state: initial })).toBe(a);
    a = adventureReducer(a, { type: "EDIT_RELATIONSHIP", brainId: "kori", relationshipId: a.brains[0].relationships[0].id, state: proposed });
    expect(a.brains[0].relationships[0].history.map(h => h.state)).toEqual([initial, proposed]);
    expect(a.brains[0].relationships[1].current).toEqual(initial);
    expect(validRelationshipState({ ...initial, dimensions: { trust: "80" } })).toBe(false);
  });
  it("round-trips approved state, starting history and proposals through IndexedDB and JSON", async () => {
    const pending = propose(fixture());
    const a = adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: pending.activeState.memoryProposals[0].id });
    const imported = importAdventureJson(exportAdventureJson(a));
    expect(imported.brains[0].relationships).toEqual(a.brains[0].relationships);
    await saveAdventure(imported);
    const loaded = await getAdventure(imported.id);
    expect(loaded?.brains[0].relationships).toEqual(a.brains[0].relationships);
    expect(loaded?.activeState.memoryProposals).toEqual(a.activeState.memoryProposals);
    await deleteAdventure(imported.id);
  });
  it("selects both relevant characters, budgets named items and recalls only deliberately selected history", () => {
    let a = fixture(); const r = a.brains[0].relationships[0]; const id = relationshipItemId("kori", r.id);
    const included = buildContext(a, { currentInput: "Kori meets Seth." });
    expect(included.sections.find(s => s.id === "brains")?.items.map(i => i.id)).toContain(id);
    expect(included.messages.map(m => m.content).join(" ")).not.toContain("player-setup");
    expect(buildContext(a, { currentInput: "Kori waits alone." }).excludedItems.some(i => i.id === id && i.reason === "not_triggered")).toBe(true);
    a = adventureReducer(a, { type: "RECALL_RELATIONSHIP_HISTORY", brainId: "kori", relationshipId: r.id, historyIds: [r.history[0].id, "nonexistent"] });
    const recalled = buildContext(a, { currentInput: "Kori meets Seth." });
    expect(recalled.messages.map(m => m.content).join(" ")).toContain("Source turn: player-setup");
    expect(recalled.totalEstimatedTokens).toBeGreaterThan(included.totalEstimatedTokens);
    a.tokenBudgetSettings.maxContextTokens = 100;
    const tight = buildContext(a, { currentInput: "Kori meets Seth." });
    expect(tight.excludedItems.some(i => i.id === id && i.reason === "budget_exceeded")).toBe(true);
    expect(tight.sections.flatMap(s => s.items).map(i => i.content).join(" ")).not.toContain(r.id);
  });
  it("uses one normal call and independent review, then approves state and history atomically", async () => {
    const a = fixture(); a.memoryAutoApprove.brainUpdate = true; a.memoryAutoApprove.storyCard = true;
    const send = vi.fn(async () => ({ content: `${story}<memory_updates>${JSON.stringify({ updates: [candidate(a)] })}</memory_updates>` }));
    const result = await runTurnPipeline({ adventure: a, text: "Kori and Seth talk.", assistantMessageId: "story-1", sendChatCompletion: send });
    expect(send).toHaveBeenCalledTimes(1); expect(result.responseContent).toBe(story);
    let next = result.adventure; const p = next.activeState.memoryProposals[0];
    expect(p).toMatchObject({ proposedType: "relationshipUpdate", status: "pending", sourceTurnId: "story-1", requiresReview: true });
    expect(next.brains[0].relationships[0].current).toEqual(initial);
    next = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    expect(next.brains[0].relationships[0].current).toEqual(proposed);
    expect(next.brains[0].relationships[0].history.map(h => h.sourceTurnId)).toEqual(["player-setup", "story-1"]);
    expect(adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(next);
  });
  it("rejects without state changes, deduplicates pending/approved transitions, and refuses stale approval", () => {
    const a = fixture(); const next = propose(a); const p = next.activeState.memoryProposals[0];
    expect(propose(next).activeState.memoryProposals).toHaveLength(1);
    expect(adventureReducer(next, { type: "REJECT_MEMORY_PROPOSAL", proposalId: p.id }).brains).toEqual(a.brains);
    const edited = adventureReducer(next, { type: "EDIT_RELATIONSHIP", brainId: "kori", relationshipId: p.relationship!.relationshipId, state: { ...proposed, status: "on a date" } });
    expect(adventureReducer(edited, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(edited);
    const approved = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    expect(adventureReducer(approved, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...p, id: "duplicate" } })).toBe(approved);
  });
  it.each(["wrong target", "wrong focus", "wrong revision", "inexact quote", "unknown knowledge", "unchanged", "numeric"])("rejects %s with route diagnostics", issue => {
    const a = fixture(); const u: Record<string, unknown> = candidate(a);
    if (issue === "wrong target") u.target = "absent";
    if (issue === "wrong focus") u.focus = "Mira";
    if (issue === "wrong revision") u.revision = 8;
    if (issue === "inexact quote") u.evidence = "kori thanks seth for keeping his promise.";
    if (issue === "unknown knowledge") u.knowledgeEvidence = "Seth returned the keepsake secretly.";
    if (issue === "unchanged") u.proposed = initial;
    if (issue === "numeric") u.proposed = { ...proposed, dimensions: { trust: 50 } };
    const next = propose(a, u); expect(next.activeState.memoryProposals).toHaveLength(0);
    expect(next.activeState.evaluationLog[0].errors.join(" ")).toContain("relationshipChange [One-pass memory");
  });
  it("requires explicit major-transition evidence and review despite auto approval", () => {
    const a = fixture(); a.memoryAutoApprove.relationshipUpdate = true;
    const u = { ...candidate(a), proposed: { ...initial, status: "separated" } };
    expect(propose(a, u).activeState.memoryProposals).toHaveLength(0);
    const explicit = "Kori tells Seth their romantic relationship is over; they are separated.";
    const next = propose(a, { ...u, evidence: explicit, knowledgeEvidence: explicit }, explicit);
    expect(next.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true });
    expect(next.brains).toEqual(a.brains);
  });
  it("uses only its independent approval setting for locally reviewed minor proposals", () => {
    const a = fixture(); const p: MemoryProposal = { ...propose(a).activeState.memoryProposals[0], requiresReview: false };
    a.memoryAutoApprove.brainUpdate = true; a.memoryAutoApprove.storyCard = true;
    expect(adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }).brains).toEqual(a.brains);
    a.memoryAutoApprove.relationshipUpdate = true;
    expect(adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }).brains[0].relationships[0].current).toEqual(proposed);
  });
  it("recovers malformed envelopes through the existing fallback call and preserves token accounting", async () => {
    let a = fixture(); expect(parseOnePassMemory(`${story}<memory_updates>{bad}`).error).toBeTruthy();
    a = adventureReducer(a, { type: "ADD_MESSAGE", role: "user", content: "Kori and Seth talk.", id: "player" });
    a = adventureReducer(a, { type: "ADD_MESSAGE", role: "assistant", content: story, id: "story-1" });
    provider.mockResolvedValue({ content: JSON.stringify({ updates: [candidate(a)] }), raw: {}, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
    const result = await runCompactMemoryFallback(a, config);
    expect(provider).toHaveBeenCalledTimes(1); expect(result.tokenUsage).toEqual({ promptTokens: 100, completionTokens: 50 });
    const next = result.actions.reduce(adventureReducer, a);
    expect(next.activeState.memoryProposals[0].proposedType).toBe("relationshipUpdate");
    expect(next.activeState.evaluationLog[0].actionsExecuted.join(" ")).toContain("Compact memory fallback");
  });
  it("discards candidates from continuity-replaced drafts", async () => {
    const a = fixture(); vi.mocked(scanForRiskyClaims).mockReturnValue(true);
    vi.mocked(runContinuityCheck).mockResolvedValue({ correctedText: "Kori and Seth wait quietly." } as Awaited<ReturnType<typeof runContinuityCheck>>);
    const result = await runTurnPipeline({ adventure: a, text: "Kori and Seth talk.", providerConfig: config,
      sendChatCompletion: async () => ({ content: `${story}<memory_updates>${JSON.stringify({ updates: [candidate(a)] })}</memory_updates>` }) });
    expect(result.responseContent).toBe("Kori and Seth wait quietly.");
    expect(result.adventure.activeState.memoryProposals).toHaveLength(0); expect(result.adventure.brains).toEqual(a.brains);
  });
  it("keeps custom semantic rules working without a second relationship path", async () => {
    const a = fixture(); a.semanticEvaluationSettings.enabled = true;
    a.triggerRules = [makeTriggerRule({ name: "Door", id: "door-rule", enabled: true, evaluationMode: "semantic", condition: "when the door opens", actions: [{ type: "activateComponent", componentId: "door" }] })];
    provider.mockResolvedValue({ content: '["trigger:door-rule"]', raw: {} });
    const result = await runSemanticPostTurnEvaluation(a, config);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.actions.some(action => action.type === "ACTIVATE_COMPONENT")).toBe(true);
    expect(result.logEntry.conditionsEvaluated.map(c => c.id)).toEqual(["trigger:door-rule"]);
    expect(result.actions.reduce(adventureReducer, a).brains).toEqual(a.brains);
    const patch = { thoughts: { new: "I wonder why Seth helped." }, relationships: [] } as BrainPatch;
    const next = applyAIMemoryUpdate(a, [{ type: "brainPatch", brainId: "kori", patch, mode: "replace" }]).actions.reduce(adventureReducer, a);
    expect(next.brains[0].thoughts.new).toBeTruthy(); expect(next.brains[0].relationships).toEqual(a.brains[0].relationships);
  });
  it("deduplicates envelope targets and enforces the shared four-update limit", () => {
    const a = fixture(); const u = candidate(a);
    const actions = onePassMemoryActions(a, buildContext(a, { currentInput: "Kori meets Seth." }), [u, u], story, "story-1");
    const next = actions.reduce(adventureReducer, a);
    expect(next.activeState.memoryProposals).toHaveLength(1);
    expect(next.activeState.evaluationLog[0].errors.join(" ")).toContain("duplicate pair");
    const parsed = parseOnePassMemory(`${story}<memory_updates>${JSON.stringify({ updates: Array(5).fill(u) })}</memory_updates>`);
    expect(parsed.error).toBeUndefined();
    expect(onePassMemoryActions(a, buildContext(a, { currentInput: "Kori meets Seth." }), parsed.updates, story, "story-1").reduce(adventureReducer, a).activeState.memoryProposals).toHaveLength(1);
  });
  it("does not grant fallback relationship evidence access to older turns", () => {
    const a = fixture();
    const actions = onePassMemoryActions(a, buildContext(a, { currentInput: "Kori meets Seth." }), [candidate(a)], "Kori waits with Seth.", "story-2", undefined, "Compact memory fallback: one API call", "Seth waits.", [story]);
    expect(actions.reduce(adventureReducer, a).activeState.memoryProposals).toHaveLength(0);
  });
  it("does not enroll or update relationships in comms or disabled memory turns", async () => {
    for (const disabled of [true, false]) {
      const a = fixture(); a.memoryDetectionSettings.enabled = !disabled;
      const result = await runTurnPipeline({ adventure: a, text: "Kori meets Seth.", mode: disabled ? "story" : "comms",
        sendChatCompletion: async () => ({ content: `${story}<memory_updates>${JSON.stringify({ updates: [candidate(a)] })}</memory_updates>` }) });
      expect(result.adventure.brains).toEqual(a.brains);
      expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
    }
  });
  it("requires an existing character card at the reducer boundary", () => {
    const a = fixture();
    a.storyCards.push(makeStoryCard({ id: "place", title: "Tavern", type: "location", content: "A tavern." }));
    for (const focusStoryCardId of ["free-text name", "missing", "place", "seth-card"]) {
      expect(adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "kori", focusStoryCardId, state: initial })).toBe(a);
    }
    expect(a.brains[0].relationships[0].focusStoryCardId).toBe("seth-card");
  });
  it("uses card identity across renames and stops context and approval when the card is deleted", () => {
    const a = fixture();
    const pending = propose(a); const p = pending.activeState.memoryProposals[0];
    const r = a.brains[0].relationships[0];
    a.storyCards[0].title = "Seth Renamed";
    const context = buildContext(a, { currentInput: "Kori meets Seth Renamed." });
    expect(context.sections.flatMap(s => s.items).some(i => i.title === "Kori → Seth Renamed: current relationship")).toBe(true);
    expect(relationshipTargets(a, new Set([relationshipItemId("kori", r.id)]))[0]).toMatchObject({ focus: "Seth Renamed", focusStoryCardId: "seth-card" });
    pending.storyCards = [];
    expect(adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(pending);
    expect(buildContext(pending, { currentInput: "Kori meets Seth." }).sections.flatMap(s => s.items).some(i => i.id === relationshipItemId("kori", r.id))).toBe(false);
    expect(pending.brains[0].relationships[0].history).toEqual(r.history);
  });
  it("migrates only unique legacy name matches and lets the player link unresolved history", () => {
    const a = fixture(); delete a.brains[0].relationships[0].focusStoryCardId;
    expect(normalizeAdventure(a).brains[0].relationships[0].focusStoryCardId).toBe("seth-card");
    a.storyCards.push(makeStoryCard({ id: "another-seth", title: "Seth", type: "character", content: "Another character." }));
    const ambiguous = normalizeAdventure(a);
    const r = ambiguous.brains[0].relationships[0];
    expect(r.focusStoryCardId).toBeUndefined();
    const linked = adventureReducer(ambiguous, { type: "LINK_RELATIONSHIP_FOCUS", brainId: "kori", relationshipId: r.id, focusStoryCardId: "seth-card" });
    expect(linked.brains[0].relationships[0].focusStoryCardId).toBe("seth-card");
    expect(linked.brains[0].relationships[0].history).toEqual(r.history);
    expect(adventureReducer(linked, { type: "LINK_RELATIONSHIP_FOCUS", brainId: "kori", relationshipId: r.id, focusStoryCardId: "mira-card" })).toBe(linked);
  });
  it("flags duplicated status across authored surfaces without rewriting them", () => {
    const a = fixture(); a.storyCards = [makeStoryCard({ title: "Kori", content: "Kori and Seth are dating." })];
    a.components = [makeComponent({ title: "Essentials", type: "plotEssentials", content: "Seth and Kori are dating." }), makeComponent({ title: "Instructions", type: "aiInstructions", content: "Keep Seth and Kori together." })];
    const before = JSON.stringify(a); expect(relationshipConflicts(a, a.brains[0], "Seth")).toHaveLength(3); expect(JSON.stringify(a)).toBe(before);
  });
});
