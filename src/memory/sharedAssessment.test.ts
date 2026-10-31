import { assessMemoryBatch, assessMemory } from "./memoryAssessment";
import { parseMemoryAssessmentBatch } from "./assessmentValidation";
import { buildMemoryAssessmentConditions } from "../triggers/semanticEngine";
import { reconcileBrainBatchState } from "./brainBatchRecovery";
import { brainBatchEvidenceMessages } from "./memoryEvidenceWindow";
import { normalizeAdventure } from "../state/defaults";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { isAssessment, mockAssessment } from "../test/memoryAssessment";
import { mockPlacementVerdict } from "../test/memoryPlacement";
import { memoryCycleSources } from "./memoryCycleState";
import { factsCovered, proposalCoverage, relevantProposalCoverage } from "./factCoverage";
import { makeStoryCardSuggestion } from "./storyCardSuggestions";
import { validateMemoryUpdate } from "./validateMemoryUpdate";
import type { Adventure, MemoryProposal } from "../types/adventure";
vi.mock("../providers/openAICompatible", async original => ({ ...await original<typeof import("../providers/openAICompatible")>(), sendOpenAICompatibleChatCompletion: vi.fn() }));
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { ...defaultModelConfig, apiKey: "offline" };
const response = (content: string) => ({ content, raw: {} });
let fired: string[], discovery: boolean, failBrain: string | undefined, failValidation: string | undefined;
function seed() {
  const a = createDefaultAdventure(); a.components = []; a.brains = []; a.storyCards = [];
  a.messages = [{ id: "prior", role: "assistant", content: "Hermione offers Draconia a research dinner tomorrow. Draconia holds out her hand.", createdAt: "2026-10-24" },
    { id: "player", role: "user", content: "I take her hand. Yes, tomorrow.", createdAt: "2026-10-24" },
    { id: "source", role: "assistant", content: "Hermione accepts the invitation. Draconia agrees to share the notebook as a separate research agreement.", createdAt: "2026-10-24" }];
  return a;
}
async function cycle(a: Adventure) {
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: "source", turn: a.activeState.turn, manual: true });
  const result = await runMemoryCycle(claimed, config, { sourceId: "source", manual: true });
  return { ...result, state: result.actions.reduce(reduce, claimed) };
}
const counts = () => ({ assessment: provider.mock.calls.filter(([r]) => isAssessment(r.messages)).length,
  validation: provider.mock.calls.filter(([r]) => r.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))).length,
  total: provider.mock.calls.length });
beforeEach(() => {
  fired = []; discovery = false; failBrain = undefined; failValidation = undefined; provider.mockReset();
  provider.mockImplementation(async request => {
    const text = request.messages.map(m => m.content).join("\n");
    if (isAssessment(request.messages)) {
      const decision = JSON.parse(mockAssessment(request.messages, fired, discovery));
      for (const record of decision.sources ?? [decision]) for (const target of record.storyCards.targets) target.delta = "Hermione accepted the invitation.";
      return response(JSON.stringify(decision));
    }
    if (text.includes("MEMORY UPDATE VALIDATION")) {
      const body = JSON.parse(request.messages.at(-1)!.content);
      if (body.title === failValidation) throw Error("Disconnected");
      return response(JSON.stringify({ accepted: true, meaningfulChange: true, reason: "Supported by original source.",
        identityMatchesTarget: true, evidenceMessageIds: body.latestTurnMessageIds, placement: mockPlacementVerdict(body) }));
    }
    if (text.includes("recording one new thought")) {
      const name = /private plan for ([^.]+) based on/.exec(text)![1];
      if (name === failBrain) throw Error("Disconnected");
      return response(JSON.stringify({ thoughts: { latest: `1 → I, ${name}, interpret the agreement in my own way.` } }));
    }
    if (text.includes("Append new durable facts about")) return response("Hermione accepted the invitation.");
    if (text.includes("STORY CARD MEMORY CHECK")) return response("[]");
    throw Error("Unexpected mock request");
  });
});
it("uses one assessment and no downstream requests for a quiet exchange across all eligible groups", async () => {
  const a = seed(); a.components = [makeComponent({ type: "activePressure", title: "Pressure", content: "No threat" })];
  a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })];
  a.storyCards = [makeStoryCard({ title: "Notebook", content: "Research record", type: "lore", keys: ["notebook"] })];
  const result = await cycle(a);
  expect(counts()).toEqual({ assessment: 1, validation: 0, total: 1 });
  expect(result.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "complete", completedGroups: ["plot", "storyCards", "brains", "discovery"] });
  expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "work_skipped", reason: expect.stringContaining("No additional durable change") }));
});
it("keeps deterministic identity nominations when semantic discovery is validly skipped", async () => {
  const a = seed(); a.messages.at(-1)!.content = "Silverpeak Citadel is a hidden academy built into the mountain.";
  const r = await cycle(a);
  expect(counts().total).toBe(1);
  expect(r.state.activeState.memoryProposals).toContainEqual(expect.objectContaining({ title: "Silverpeak Citadel", storyCardReview: expect.objectContaining({ origin: "deterministic" }) }));
});
const isRepair = (messages: { content: string }[]) => messages[0]?.content.startsWith("ASSESSMENT FORMAT REPAIR");
it.each(["missing discovery", "missing brains", "unknown ID", "invalid evidence", "missing citation"])("retains incomplete %s for explicit retry without a paid repair", async kind => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", keys: ["invitation"], content: "PRIVATE FULL CARD CONTENT" })];
  let valid = "", invalid = "";
  provider.mockImplementation(async request => {
    if (isRepair(request.messages)) return response(valid);
    valid = mockAssessment(request.messages);
    const value = JSON.parse(valid);
    if (kind === "missing discovery") delete value.discovery;
    if (kind === "missing brains") delete value.brains;
    if (kind === "unknown ID") value.storyCards.targets = [{ id: "unknown", delta: "changed", evidenceMessageIds: ["source"] }];
    if (kind === "invalid evidence") value.discovery = { needed: true, reason: "Change", evidenceMessageIds: ["invented"] };
    if (kind === "missing citation") value.discovery = { needed: true, reason: "Change", evidenceMessageIds: ["prior"] };
    invalid = JSON.stringify(value);
    return response(invalid);
  });
  const r = await cycle(a);
  expect(counts()).toEqual({ assessment: 1, validation: 0, total: 1 });
  expect(r.state.messages.at(-1)?.memoryEvaluation?.status).toBe("quarantined");
  expect(r.state.activeState.memoryProposals).toEqual([]);
});
it("normalizes absent negative discovery evidence in one assessment without repair", async () => {
  provider.mockImplementation(async request => {
    const value = JSON.parse(mockAssessment(request.messages)); delete value.discovery.evidenceMessageIds;
    return response(JSON.stringify(value));
  });
  const r = await cycle(seed());
  expect(counts().total).toBe(1);
  expect(provider.mock.calls.filter(([r]) => isRepair(r.messages))).toHaveLength(0);
  expect(r.state.messages.at(-1)?.memoryEvaluation?.assessment?.discovery.evidenceMessageIds).toEqual([]);
});
it.each(["storyCard", "brain"])("normalizes an exact %s prefix omission and preserves the approval pipeline", async kind => {
  const a = seed();

  a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", content: "A dinner was offered.", keys: ["invitation"] })];
  a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })];
  fired = [kind === "brain" ? "brain:h" : "storyCard:invitation"];
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async request => {
    if (!isAssessment(request.messages)) return original(request);
    const value = JSON.parse(mockAssessment(request.messages, fired));
    value[kind === "brain" ? "brains" : "storyCards"].targets[0].id = kind === "brain" ? "h" : "invitation";
    return response(JSON.stringify(value));
  });
  const r = await cycle(a);
  expect(counts().assessment).toBe(1);
  expect(provider.mock.calls.filter(([r]) => isRepair(r.messages))).toHaveLength(0);
  expect(r.state.activeState.memoryProposals).toHaveLength(1);
  const proposal = r.state.activeState.memoryProposals[0];
  expect(proposal.status).toBe("pending");
  expect(r.state.storyCards).toEqual(a.storyCards); expect(r.state.brains).toEqual(a.brains);
  const approved = reduce(r.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
  expect(approved.activeState.memoryProposals[0].status).toBe("approved");
});
it.each(["{}", "[]", "{broken"])("quarantines invalid output %s after exactly one call and permits manual retry", async repair => {
  provider.mockImplementation(async request => response(repair));
  const r = await cycle(seed());
  expect(counts().total).toBe(1);
  expect(r.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "quarantined", attempts: 1, completedGroups: [] });
  expect(r.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ requestStage: "assessment", failureCategory: "invalid_model_output" }));
  r.state.activeState.memoryRecoveryStoryTurn = 100;
  expect(memoryCycleSources(r.state)).toEqual([]);
  expect(counts().total).toBe(1);
  provider.mockImplementation(async request => response(mockAssessment(request.messages)));
  const manual = await cycle(r.state);
  expect(counts().total).toBe(2);
  expect(manual.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "complete", attempts: 2 });
});
it.each(["[]", '{"plot":{"targets":null,"reason":"Quiet"}}', "{broken"])("does not repair other parser errors: %s", async invalid => {
  provider.mockResolvedValue(response(invalid));
  const r = await cycle(seed());
  expect(counts().total).toBe(1);
  expect(r.state.messages.at(-1)?.memoryEvaluation?.status).toBe("quarantined");
});
it("never automatically retries a failed transport request, but permits explicit retry", async () => {
  provider.mockRejectedValue(Error("Disconnected"));
  const first = await cycle(seed());
  expect(first.state.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
  first.state.activeState.memoryRecoveryStoryTurn = 100;
  first.state.memoryDetectionSettings.enabled = true;
  first.state.memoryDetectionSettings.everyNTurns = 1;
  expect(memoryCycleSources(first.state)).toEqual([]);
  expect(provider).toHaveBeenCalledTimes(1);
  provider.mockImplementation(async r => response(mockAssessment(r.messages)));
  const retried = await cycle(first.state);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(retried.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
});
it("sends earlier participant context and the latest pronoun/short answer without literal-name eligibility", async () => {
  const a = seed(); a.brains = [makeBrain({ id: "d", characterName: "Draconia", active: true }), makeBrain({ id: "h", characterName: "Hermione", active: true })];
  a.messages.at(-1)!.content = "She smiles and accepts. They confirm separate terms for sharing the research.";
  fired = ["brain:d", "brain:h"];
  const r = await cycle(a);
  const body = JSON.parse(provider.mock.calls[0][0].messages.at(-1)!.content);
  expect(body.conditions.brains.map((c: { id: string }) => c.id)).toEqual(["brain:d", "brain:h"]);
  expect(body.storyExcerpt.some((m: { id: string }) => m.id === "prior")).toBe(true);
  expect(JSON.stringify(body.latestTurn)).toContain("Yes, tomorrow");
  expect(r.state.activeState.memoryProposals.filter(p => p.proposedType === "brainUpdate")).toHaveLength(2);
  expect(r.state.activeState.memoryProposals.find(p => p.targetId === "d")?.content).toContain("I, Draconia");
  expect(r.state.activeState.memoryProposals.find(p => p.targetId === "h")?.content).toContain("I, Hermione");
  const publicCalls = provider.mock.calls.filter(([req]) => !isAssessment(req.messages) && !req.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION") || m.content.includes("recording one new thought")));
  expect(JSON.stringify(publicCalls)).not.toContain("I, Draconia");
});
it("permits learned message disclosures but never selects an absent mentioned character without a relevant change", async () => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true }), makeBrain({ id: "ron", characterName: "Ron", active: true })];
  a.messages.at(-1)!.content = "Hermione reads Draconia's message revealing the key. Ron is still away and has received nothing.";
  fired = ["brain:h"];
  const r = await cycle(a);
  expect(r.state.activeState.memoryProposals.map(p => p.targetId)).toEqual(["h"]);
  expect(provider.mock.calls[0][0].messages.some(m => m.content.includes("Mentioning an absent character never grants knowledge"))).toBe(true);
});
it("detects consecutive meaningful Brain changes with no default cooldown", async () => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true, lastUpdatedTurn: 1 })]; a.activeState.turn = 2;
  fired = ["brain:h"];
  const first = await cycle(a);
  const second = seed(); second.activeState.turn = 3; second.brains = first.state.brains.map(b => ({ ...b, lastUpdatedTurn: 2 }));
  await cycle(second);
  expect(counts()).toEqual({ assessment: 2, validation: 2, total: 6 });
  second.brains[0].autoUpdateCooldownTurns = 5; provider.mockClear();
  await cycle(second); expect(counts().total).toBe(1);
});
it("retains successful sibling work and raw drafts on validation failure with atomic group application", async () => {
  const a = seed(); a.brains = [makeBrain({ id: "d", characterName: "Draconia", active: true }), makeBrain({ id: "h", characterName: "Hermione", active: true })];
  fired = ["brain:d", "brain:h"]; failValidation = "Hermione";
  const first = await cycle(a); expect(counts()).toEqual({ assessment: 1, validation: 2, total: 5 });
  expect(first.state.activeState.memoryProposals).toHaveLength(0);
  expect(first.state.messages.at(-1)?.memoryEvaluation?.groupWork?.brains?.drafts["brain:d"].result).toBeDefined();
  failValidation = undefined; provider.mockClear();
  const second = await cycle(first.state);
  expect(counts()).toEqual({ assessment: 0, validation: 1, total: 1 });
  expect(second.state.activeState.memoryProposals).toHaveLength(2);
  expect(second.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
});
it.each(["metadata", "thought", "evidence"])("binds reuse to actual dependencies after a %s edit", async kind => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })]; fired = ["brain:h"]; failValidation = "Hermione";
  const first = await cycle(a);
  if (kind === "metadata") { first.state.metadata.description = "Unrelated UI description"; first.state.brains[0].updatedAt = "2030-01-01"; }
  if (kind === "thought") first.state.brains[0].thoughts.changed = "A relevant new interpretation.";
  if (kind === "evidence") first.state.messages[1].content = "I decline.";
  failValidation = undefined; provider.mockClear(); await cycle(first.state);
  expect(counts().assessment).toBe(kind === "evidence" || kind === "thought" ? 1 : 0);
  expect(counts().total).toBe(kind === "metadata" ? 1 : kind === "thought" ? 3 : 3);
});
it("classifies local parsing after a response as invalid output and regenerates only the malformed draft on retry", async () => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })]; fired = ["brain:h"];
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async req => !isAssessment(req.messages) ? response("{broken") : original(req));
  const first = await cycle(a);
  expect(first.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ group: "brains", failureCategory: "invalid_model_output" }));
  expect(first.state.activeState.memoryDiagnostics?.some(d => d.failureCategory === "transport_api")).toBe(false);
  provider.mockClear(); await cycle(first.state);
  // Invalid generated syntax cannot become valid by reparsing it; retain it visibly
  // but discard that draft for the next explicit regeneration attempt.
  expect(counts().assessment).toBe(0); expect(counts().total).toBe(1);
});
it("suppresses unchanged Brain patches before semantic validation", async () => {
  const a = seed(); const thought = "1 → I, Hermione, interpret the agreement in my own way.";
  a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true, thoughts: { latest: thought } })]; fired = ["brain:h"];
  await cycle(a); expect(counts()).toEqual({ assessment: 1, validation: 0, total: 2 });
});
it.each([JSON.stringify({ accepted: true, meaningfulChange: false, reason: "No change" }),
  JSON.stringify({ accepted: false, meaningfulChange: false, reason: "No change", placement: { kind: "none", reason: "Already covered" } }),
  JSON.stringify({ accepted: true, meaningfulChange: true, reason: "No public fact", placement: { kind: "none", reason: "Private only" } })])("accepts no-write verdicts before requiring write fields: %s", async raw => {
  provider.mockResolvedValue(response(raw));
  const r = await validateMemoryUpdate(seed(), config, "storyCard", "Invitation", "", "Hermione accepted the invitation.");
  expect(r.changed).toBe(false); expect(r.retryable).not.toBe(true); expect(provider).toHaveBeenCalledTimes(1);
});
function suggestion(a: Adventure, id: string, content = "Hermione accepted the invitation."): MemoryProposal {
  return { ...makeStoryCardSuggestion(a, "source", a.messages.at(-1)!.content, { title: "Dinner invitation", content,
    targetId: "invitation", type: "lore", evidence: a.messages.at(-1)!.content, reason: "Accepted research dinner", evidenceReviewed: true }), id };
}
it("shares relevant pending/dismissed fact coverage with newest-first limits, separate from canon", () => {
  const a = seed();
  a.activeState.memoryProposals = Array.from({ length: 20 }, (_, i) => ({ ...suggestion(a, String(i)), status: i === 0 ? "rejected" as const : "pending" as const }));
  const coverage = relevantProposalCoverage(a, "Hermione notebook invitation", ["invitation"], ["source"]);
  expect(coverage[0]).toMatchObject({ id: "0", status: "rejected", proposedFacts: expect.stringContaining("accepted") });
  expect(coverage.at(-1)?.id).toBe("11");
  expect(proposalCoverage(a, suggestion(a, "new", "Hermione agreed to the invitation."))).toBe(true);
  expect(proposalCoverage(a, suggestion(a, "new", "Hermione attended the dinner."))).toBe(false);
});
it("suppresses pending paraphrases and produces an approval no-op after another proposal wins", () => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", content: "A dinner was offered." })];
  const p = suggestion(a, "one"), q = suggestion(a, "two", "Hermione agreed to the invitation.");
  const pending = reduce(reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }), { type: "ADD_MEMORY_PROPOSAL", proposal: q });
  expect(pending.activeState.memoryProposals).toHaveLength(1);
  // Legacy overlapping proposals can already exist in saves, in either order.
  a.activeState.memoryProposals = [p, q];
  const first = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "two" });
  const second = reduce(first, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "one" });
  expect(second.storyCards).toEqual(first.storyCards);
  expect(second.activeState.memoryProposals.every(p => p.status === "approved")).toBe(true);
  expect(second.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "candidate_suppressed", reason: expect.stringContaining("no-op") }));
});
it("keeps a partially overlapping reviewed draft pending until edited/revalidated", () => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", content: "Hermione accepted the invitation." })];
  const p = suggestion(a, "mixed", "Hermione accepted the invitation.\nDraconia agreed to share the notebook."); a.activeState.memoryProposals = [p];
  const r = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(r.storyCards).toEqual(a.storyCards); expect(r.activeState.memoryProposals[0]).toMatchObject({ content: p.content, status: "pending", requiresReview: true });
});
it.each([
  ["Hermione offered the invitation.", "Hermione accepted the invitation."],
  ["Hermione accepted the invitation.", "Hermione attended the dinner."],
  ["Draconia proposed collaboration.", "Draconia agreed collaboration."],
  ["Draconia agreed collaboration.", "Draconia completed the research."],
  ["Draconia tried to kiss Hermione.", "Draconia kissed Hermione."],
  ["Hermione thinks Draconia trusts her.", "Draconia thinks Hermione trusts her."],
  ["Hermione accepted the invitation.", "Hermione did not accept the invitation."],
])("preserves distinct event state or attribution: %s / %s", (old, changed) => expect(factsCovered(changed, [old])).toBe(false));
it("passes existing-card handled facts to discovery and preserves a separate research agreement", async () => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", keys: ["invitation"], content: "A dinner was offered." })];
  fired = ["storyCard:invitation"]; discovery = true;
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async req => {
    if (!isAssessment(req.messages) && req.messages[0].content.startsWith("STORY CARD MEMORY CHECK")) {
      expect(req.messages.some(m => m.content.includes("Hermione accepted the invitation.") && m.content.includes("pending"))).toBe(true);
      const candidate = (title: string, content: string) => ({ title, content, storyCardType: "lore", evidenceMessageIds: ["source"],
        evidenceQuotes: [{ messageId: "source", quote: a.messages.at(-1)!.content }], eventStatus: "completed", suggestedTriggers: ["research agreement"] });
      return response(JSON.stringify([candidate("Dinner invitation", "Hermione agreed to the invitation."), candidate("Notebook agreement", "Draconia agreed to share the notebook.")]));
    }
    return original(req);
  });
  const r = await cycle(a);
  expect(r.state.activeState.memoryProposals).toHaveLength(2);
  expect(counts().validation).toBe(2); // existing-card delta and distinct research agreement, not the duplicate.
  expect(r.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "candidate_suppressed" }));
});

it("reuses a completed correction review but separately validates its frozen corrected draft on retry", async () => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", content: "A dinner was offered.", keys: ["invitation"] })];
  fired = ["storyCard:invitation"];
  let rejectFinal = true; const original = provider.getMockImplementation()!;
  provider.mockImplementation(async req => {
    if (req.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) {
      const body = JSON.parse(req.messages.at(-1)!.content);
      if (body.targetInfo.finalReview && rejectFinal) throw Error("Disconnected");
      const content = "Hermione accepted the invitation for research.";
      return response(JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
        reason: "Correct factual detail.", evidenceMessageIds: ["source"], placement: { ...mockPlacementVerdict(body),
          kind: "append", targetId: "invitation", content, newFact: content, title: "Dinner invitation" } }));
    }
    return original(req);
  });
  const first = await cycle(a); expect(counts()).toEqual({ assessment: 1, validation: 2, total: 3 });
  expect(first.state.activeState.memoryProposals).toHaveLength(0);
  rejectFinal = false; provider.mockClear(); const second = await cycle(first.state);
  expect(counts()).toEqual({ assessment: 0, validation: 1, total: 1 });
  expect(second.state.activeState.memoryProposals[0].content).toBe("Hermione accepted the invitation for research.");
});
it("keeps discovery drafts reusable after unrelated metadata/card additions", async () => {
  const a = seed(); discovery = true; failValidation = "Notebook agreement";
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async req => {
    if (!isAssessment(req.messages) && req.messages[0].content.startsWith("STORY CARD MEMORY CHECK")) return response(JSON.stringify([{
      title: "Notebook agreement", content: "Draconia agreed to share the notebook.", storyCardType: "lore", evidenceMessageIds: ["source"],
      evidenceQuotes: [{ messageId: "source", quote: a.messages.at(-1)!.content }], eventStatus: "completed", suggestedTriggers: ["notebook agreement"],
    }]));
    return original(req);
  });
  const first = await cycle(a); expect(counts().total).toBe(3);
  first.state.storyCards.push(makeStoryCard({ title: "Distant ocean", content: "Unrelated distant history.", keys: ["sailing"] }));
  first.state.title = "Renamed adventure"; failValidation = undefined; provider.mockClear();
  const second = await cycle(first.state);
  expect(counts()).toEqual({ assessment: 0, validation: 1, total: 1 });
  expect(second.state.activeState.memoryProposals).toHaveLength(1);
  expect(second.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
});

it("rejects stale negative assessments at commit even when no proposal supplied a destination snapshot", async () => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", content: "A dinner was offered.", keys: ["invitation"] })];
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: "source", turn: 0, manual: true });
  const result = await runMemoryCycle(claimed, config, { sourceId: "source", manual: true });
  const edited = reduce(claimed, { type: "UPDATE_STORY_CARD", storyCardId: "invitation", patch: { content: "Changed reference while assessment was in flight." } });
  const stale = result.actions.reduce(reduce, edited);
  expect(stale.messages.at(-1)?.memoryEvaluation?.completedGroups).toEqual([]);
  expect(stale.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "evaluation_stale" }));
});

it("preserves a valid positive decision through local normalization, validation, and approval", async () => {
  const a = seed();
  a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type: "lore", content: "A dinner was offered.", keys: ["invitation"] })];
  fired = ["storyCard:invitation"];
  const original = provider.getMockImplementation()!;
  let valid = "";
  provider.mockImplementation(async request => {
    if (isRepair(request.messages)) return response(valid);
    if (!isAssessment(request.messages)) return original(request);
    const validDecision = JSON.parse(mockAssessment(request.messages, fired));
    validDecision.storyCards.targets[0].delta = "Hermione accepted the invitation.";
    valid = JSON.stringify(validDecision);
    const value = JSON.parse(valid); delete value.discovery.evidenceMessageIds;
    return response(JSON.stringify(value));
  });
  const r = await cycle(a);
  expect(counts()).toEqual({ assessment: 1, validation: 1, total: 2 });
  expect(provider.mock.calls.filter(([r]) => isRepair(r.messages))).toHaveLength(0);
  expect(r.state.messages.at(-1)?.memoryEvaluation?.assessment?.storyCards).toEqual(JSON.parse(valid).storyCards);
  expect(r.state.activeState.memoryProposals).toHaveLength(1);
  expect(r.state.activeState.memoryProposals[0].status).toBe("pending");
  expect(r.state.storyCards).toEqual(a.storyCards);
  const approved = reduce(r.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: r.state.activeState.memoryProposals[0].id });
  expect(approved.storyCards[0].content).toContain("Hermione accepted the invitation.");
  expect(approved.activeState.memoryProposals[0].status).toBe("approved");
});

// Automatic batching uses the same model boundary as the manual regression fixtures.
function batchSeed() {
  const a = seed(); a.messages = []; a.components = []; a.storyCards = [];
  a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true, thoughts: { old: "I remember the original agreement." } }),
    makeBrain({ id: "d", characterName: "Draconia", active: true })];
  a.memoryDetectionSettings.enabled = true; a.memoryDetectionSettings.everyNTurns = 1;

  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async request => {
    const text = request.messages.map(m => m.content).join("\n");
    if (isAssessment(request.messages)) {
      const decision = JSON.parse(mockAssessment(request.messages, fired));
      const sourceId = JSON.parse(request.messages.at(-1)!.content).sourceId;
      const changes: Record<string, string> = { one: "I trust the offered research access", two: "I intend to protect the hidden key", three: "I question the council deadline" };
      for (const target of decision.brains.targets) target.delta = changes[sourceId] ?? "I reconsider the research evidence";
      return response(JSON.stringify(decision));
    }
    if (text.includes("Bounded Brain batch:") && !text.includes("MEMORY UPDATE VALIDATION") && !isAssessment(request.messages)) {
      const batch = JSON.parse(/Bounded Brain batch: (\[[^\n]+\])/.exec(text)![1]) as Array<{ sourceId: string; delta: string }>;
      const name = /private plan for ([^.]+) based on/.exec(text)![1];
      return response(JSON.stringify({ thoughts: Object.fromEntries(batch.map(d => [`reaction_${d.sourceId}`, `I, ${name}, reconsider ${d.delta}`])) }));
    }
    return original(request);
  });
  return a;
}
async function autoTurn(a: Adventure, id: string, targets: string[]) {
  fired = targets;
  const next = { ...a, messages: [...a.messages, { id, role: "assistant" as const,
    content: `Hermione and Draconia establish the research agreement ${id}.`, createdAt: "2026-10-25" }],
    activeState: { ...a.activeState, turn: a.activeState.turn + 1 } };
  return autoSource(next, id);
}
async function autoSource(a: Adventure, sourceId: string) {
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId, turn: a.activeState.turn });
  const result = await runMemoryCycle(claimed, config, { sourceId });
  return { ...result, state: result.actions.reduce(reduce, claimed) };
}
it("batches three consecutive same-character changes into one generated and validated patch", async () => {
  let a = batchSeed();
  for (const id of ["one", "two", "three"]) a = (await autoTurn(a, id, ["brain:h"])).state;
  expect(counts()).toEqual({ assessment: 3, validation: 1, total: 5 });
  const p = a.activeState.memoryProposals.find(p => p.proposedType === "brainUpdate")!;
  expect(Object.keys(JSON.parse(p.content).thoughts)).toEqual(["reaction_one", "reaction_two", "reaction_three"]);
  expect(p.sourceTurnId).toBe("three");
  expect(p.evaluationSource?.messages.map(m => m.id)).toEqual(["one", "two", "three"]);
  expect(a.activeState.pendingBrainDeltas).toEqual([]);
  const approved = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(approved.brains[0].thoughts.old).toBe("I remember the original agreement.");
  expect(Object.keys(approved.brains[0].thoughts)).toHaveLength(4);
});
it("flushes different characters separately with their own perspective and establishing source", async () => {
  let a = batchSeed();
  a = (await autoTurn(a, "one", ["brain:h"])).state;
  a = (await autoTurn(a, "two", ["brain:h", "brain:d"])).state;
  a = (await autoTurn(a, "three", [])).state;
  const ps = a.activeState.memoryProposals.filter(p => p.proposedType === "brainUpdate");
  expect(ps).toHaveLength(2);
  expect(ps.find(p => p.targetId === "h")?.content).toContain("I, Hermione");
  expect(ps.find(p => p.targetId === "h")?.content).not.toContain("I, Draconia");
  expect(ps.find(p => p.targetId === "d")?.content).toContain("I, Draconia");
  expect(ps.every(p => p.sourceTurnId === "two")).toBe(true);
  expect(counts()).toEqual({ assessment: 3, validation: 2, total: 7 });
  expect(a.activeState.pendingBrainDeltas).toEqual([]);
});
it("flushes a departed character on turn two with the original event as evidence anchor", async () => {
  let a = batchSeed(); a = (await autoTurn(a, "one", ["brain:h"])).state;
  fired = [];
  a.messages.push({ id: "two", role: "assistant", content: "Elsewhere the empty courtyard falls silent.", createdAt: "2026-10-25" });
  a = (await autoSource(a, "two")).state;
  expect(a.activeState.memoryProposals.find(p => p.targetId === "h")?.sourceTurnId).toBe("one");
  const review = provider.mock.calls.find(([r]) => r.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION")))![0];
  expect(JSON.parse(review.messages.at(-1)!.content).latestTurnMessageIds).toEqual(["one"]);
  expect(counts()).toEqual({ assessment: 2, validation: 1, total: 4 });
});
it("preserves failed batches, resumes the saved draft manually, and never duplicates thoughts", async () => {
  let a = batchSeed();
  a = (await autoTurn(a, "one", ["brain:h"])).state;
  a = (await autoTurn(a, "two", ["brain:h"])).state;
  failValidation = "Hermione";
  a = (await autoTurn(a, "three", ["brain:h"])).state;
  expect(a.activeState.pendingBrainDeltas?.map(d => d.sourceId)).toEqual(["one", "two"]);
  expect(a.activeState.memoryProposals).toEqual([]);
  expect(a.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
  expect(a.messages.at(-1)?.memoryEvaluation?.groupWork?.brains?.brainBatch?.enqueue[0].sourceId).toBe("three");
  failValidation = undefined; provider.mockClear();
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: "three", turn: a.activeState.turn, manual: true });
  const result = await runMemoryCycle(claimed, config, { sourceId: "three", manual: true });
  a = result.actions.reduce(reduce, claimed);
  expect(counts()).toEqual({ assessment: 0, validation: 1, total: 1 });
  expect(a.activeState.pendingBrainDeltas).toEqual([]);
  expect(a.activeState.memoryProposals).toHaveLength(1);
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: a.activeState.memoryProposals[0].id });
  expect(Object.keys(a.brains[0].thoughts)).toHaveLength(4);
  await runMemoryCycle(a, config, { sourceId: "three", manual: true });
  expect(counts().total).toBe(1);
});
it("keeps manual Brain evaluation immediate without touching queued automatic deltas", async () => {
  let a = batchSeed(); a = (await autoTurn(a, "one", ["brain:h"])).state;
  const pending = a.activeState.pendingBrainDeltas;
  a.messages.push({ id: "source", role: "assistant", content: "Hermione accepts a new research invitation.", createdAt: "2026-10-25" });
  provider.mockClear(); fired = ["brain:h"];
  const r = await cycle(a);
  expect(counts()).toEqual({ assessment: 1, validation: 1, total: 3 });
  expect(r.state.activeState.pendingBrainDeltas).toEqual(pending);
  expect(r.state.activeState.memoryProposals).toHaveLength(1);
});
it("persists a pending buffer across normalization and avoids queueing a source twice", async () => {
  const { normalizeAdventure } = await import("../state/defaults");
  let a = batchSeed(); a = (await autoTurn(a, "one", ["brain:h"])).state;
  a = normalizeAdventure(JSON.parse(JSON.stringify(a)));
  expect(a.activeState.pendingBrainDeltas).toHaveLength(1);
  await autoSource(a, "one");
  expect(counts().assessment).toBe(1);
  a = (await autoTurn(a, "two", ["brain:h"])).state;
  a = (await autoTurn(a, "three", ["brain:h"])).state;
  expect(counts()).toEqual({ assessment: 3, validation: 1, total: 5 });
  expect(a.activeState.pendingBrainDeltas).toEqual([]);
  const old = batchSeed(); delete old.activeState.pendingBrainDeltas;
  expect(normalizeAdventure(old).activeState.pendingBrainDeltas).toEqual([]);
});
it("ignores OOC turns when advancing the Brain batching deadline", async () => {
  let a = batchSeed(); a = (await autoTurn(a, "one", ["brain:h"])).state;
  a.messages.push({ id: "ooc", role: "assistant", inputMode: "comms", content: "OOC notes", createdAt: "2026-10-25" });
  a = (await autoTurn(a, "two", ["brain:h"])).state;
  expect(counts()).toEqual({ assessment: 2, validation: 0, total: 2 });
  a = (await autoTurn(a, "three", ["brain:h"])).state;
  expect(counts()).toEqual({ assessment: 3, validation: 1, total: 5 });
});
it("rejects a stale Brain transaction, removes unsupported buffer entries and salvages valid deltas", async () => {
  let a = batchSeed(); a = (await autoTurn(a, "one", ["brain:h"])).state;
  a = (await autoTurn(a, "two", ["brain:h"])).state;
  const r = await autoTurn(a, "three", ["brain:h"]);
  const commit = r.actions.find(a => a.type === "COMMIT_MEMORY_EVALUATION_GROUP" && a.group === "brains")!;
  const claimed = reduce({ ...a, activeState: { ...a.activeState, turn: 3 }, messages: [...a.messages, { ...r.state.messages.at(-1)!, memoryEvaluation: undefined }] }, { type: "CLAIM_MEMORY_EVALUATION", sourceId: "three", turn: 3 });
  const changed = { ...claimed, activeState: { ...claimed.activeState, pendingBrainDeltas: [...claimed.activeState.pendingBrainDeltas!,
    { ...claimed.activeState.pendingBrainDeltas![0], delta: "Edited buffered interpretation", sourceId: "extra" }] } };
  const stale = reduce(changed, commit);
  expect(stale.activeState.pendingBrainDeltas?.map(d => d.sourceId)).toEqual(["one", "two", "three"]);
  expect(stale.activeState.memoryProposals).toEqual([]);
  expect(stale.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "evaluation_stale", group: "brains" }));
});
it("requires supplied Brain establishing sources and separates validation caches by batch", async () => {
  const a = seed(); const cache = {};
  const review = (ids: string[]) => validateMemoryUpdate(a, config, "brain", "Hermione", "", '{"thoughts":{"new_key":"I reconsider the invitation."}}', undefined, false, false, { id: "h", type: "brain" }, cache, ids);
  expect((await review(["player"])).changed).toBe(false);
  expect(provider).not.toHaveBeenCalled();
  expect((await review(["prior"])).changed).toBe(true);
  expect((await review(["source"])).changed).toBe(true);
  expect(provider).toHaveBeenCalledTimes(2);
  await review(["source"]); expect(provider).toHaveBeenCalledTimes(2);
  provider.mockResolvedValue(response(JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
    evidenceMessageIds: ["invented"], reason: "Untrusted citation" })));
  expect((await review(["prior", "source"])).changed).toBe(false);
});

it("resumes only the failed automatic batch after a later source queues new changes", async () => {
  let a = batchSeed();
  a = (await autoTurn(a, "one", ["brain:h"])).state;
  a = (await autoTurn(a, "two", ["brain:h"])).state;
  failValidation = "Hermione";
  a = (await autoTurn(a, "three", ["brain:h"])).state;
  failValidation = undefined;
  a = (await autoTurn(a, "four", ["brain:h"])).state;
  expect(a.activeState.pendingBrainDeltas?.map(d => d.sourceId)).toEqual(["one", "two", "four"]);
  provider.mockClear();
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: "three", turn: a.activeState.turn, manual: true });
  const r = await runMemoryCycle(claimed, config, { sourceId: "three", manual: true });
  a = r.actions.reduce(reduce, claimed);
  expect(counts()).toEqual({ assessment: 0, validation: 1, total: 1 });
  expect(a.activeState.pendingBrainDeltas?.map(d => d.sourceId)).toEqual(["four"]);
  const p = a.activeState.memoryProposals.find(p => p.proposedType === "brainUpdate")!;
  expect(p.sourceTurnId).toBe("three");
  expect(Object.keys(JSON.parse(p.content).thoughts)).toEqual(["reaction_one", "reaction_two", "reaction_three"]);
  expect(p.evaluationSource?.messages.map(m => m.id)).not.toContain("four");
});
it("retains both successful sibling checkpoints and all buffered deltas when a batched review fails", async () => {
  let a = batchSeed();
  a = (await autoTurn(a, "one", ["brain:h", "brain:d"])).state;
  a = (await autoTurn(a, "two", ["brain:h", "brain:d"])).state;
  failValidation = "Hermione";
  a = (await autoTurn(a, "three", ["brain:h", "brain:d"])).state;
  expect(a.activeState.pendingBrainDeltas).toHaveLength(4);
  expect(a.activeState.memoryProposals).toEqual([]);
  expect(a.messages.at(-1)?.memoryEvaluation?.groupWork?.brains?.drafts["brain:d"].result).toBeDefined();
  failValidation = undefined; provider.mockClear();
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: "three", turn: a.activeState.turn, manual: true });
  const r = await runMemoryCycle(claimed, config, { sourceId: "three", manual: true });
  a = r.actions.reduce(reduce, claimed);
  expect(counts()).toEqual({ assessment: 0, validation: 1, total: 1 });
  expect(a.activeState.memoryProposals).toHaveLength(2);
  expect(a.activeState.pendingBrainDeltas).toEqual([]);
});
it.each(["character", "location", "custom"] as const)("retains targeted generation for existing %s cards", async type => {
  const a = seed(); a.storyCards = [makeStoryCard({ id: "invitation", title: "Dinner invitation", type, keys: ["invitation"], content: "An enduring subject." })];
  fired = ["storyCard:invitation"];
  await cycle(a);
  expect(provider.mock.calls.filter(([r]) => r.messages.some(m => m.content.includes("Append new durable facts about")))).toHaveLength(1);
});

it("rejects Brain review evidence that misses the supplied establishing source or target identity", async () => {
  for (const [evidenceMessageIds, identityMatchesTarget] of [[["prior"], true], [["source"], false]] as const) {
    provider.mockResolvedValue(response(JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget,
      evidenceMessageIds, reason: "Untrusted review verdict" })));
    const result = await validateMemoryUpdate(seed(), config, "brain", "Hermione", "", '{"thoughts":{"new_key":"I reconsider the offer."}}',
      undefined, false, false, { id: "h", type: "brain" }, undefined, ["source"]);
    expect(result.changed).toBe(false);
  }
});

it("enqueues once and consumes atomically only on successful Brain group commits", () => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione" })]; const delta = { brainId: "h", sourceId: "prior", sourceTurn: 1,
    sourceContent: a.messages[0].content, delta: "I reconsider the offer.", evidenceMessageIds: ["prior"] };
  a.activeState.pendingBrainDeltas = [delta];
  const next = { ...delta, sourceId: "source", sourceContent: a.messages.at(-1)!.content };
  const commit = { type: "COMMIT_MEMORY_EVALUATION_GROUP" as const, source: { id: "source", content: a.messages.at(-1)!.content },
    group: "brains" as const, dependencies: [], targets: [], actions: [], brainBatch: { enqueue: [delta, next, next], consumeKeys: ["prior:h"] } };
  expect(reduce(a, commit).activeState.pendingBrainDeltas).toEqual([next]);
  expect(reduce(a, { ...commit, error: "Offline failure" }).activeState.pendingBrainDeltas).toEqual([delta]);
  expect(reduce(a, { ...commit, group: "storyCards" }).activeState.pendingBrainDeltas).toEqual([delta]);
});

function recoverySeed() {
  const a = batchSeed();
  a.messages = ["one", "two", "three", "four"].map(id => ({ id, role: "assistant", content: `Hermione establishes ${id}.`, createdAt: "2026-10-25" }));
  a.activeState.pendingBrainDeltas = a.messages.slice(0, 3).map((m, i) => ({ brainId: "h", sourceId: m.id,
    sourceTurn: i + 1, sourceContent: m.content, delta: `I reconsider ${m.id}.`, evidenceMessageIds: [m.id] }));
  return a;
}
function freezeRecovery(a: Adventure) {
  const deltas = a.activeState.pendingBrainDeltas!;
  a.messages[3].memoryEvaluation = { turn: 4, status: "failed", attempts: 3, completedGroups: ["plot", "storyCards", "discovery"],
    groupWork: { brains: { fingerprint: "old", drafts: { "brain:h": { raw: "stale patch", validationCache: { old: "verdict" } } },
      brainBatch: { enqueue: [], batches: [deltas], consumeKeys: deltas.map(d => `${d.sourceId}:${d.brainId}`) } } } };
}
it("drops edited buffered evidence while preserving valid deltas and source reassessment without requests", () => {
  const a = recoverySeed(); const valid = a.activeState.pendingBrainDeltas!.slice(1);
  a.messages[0].memoryEvaluation = { turn: 1, status: "complete", attempts: 1, completedGroups: ["plot", "storyCards", "brains", "discovery"] };
  const edited = reduce(a, { type: "UPDATE_MESSAGE", messageId: "one", content: "Hermione declines." });
  const recovered = reconcileBrainBatchState(edited);
  expect(recovered.activeState.pendingBrainDeltas).toEqual(valid);
  expect(recovered.messages[0].memoryEvaluation).toMatchObject({ status: "pending", completedGroups: [] });
  expect(provider).not.toHaveBeenCalled();
});
it("deletes only unsupported deltas and releases stale reservations in order", () => {
  const a = recoverySeed(); freezeRecovery(a); const valid = [a.activeState.pendingBrainDeltas![0], a.activeState.pendingBrainDeltas![2]];
  const recovered = reduce(a, { type: "DELETE_MESSAGE", messageId: "two" });
  expect(recovered.activeState.pendingBrainDeltas).toEqual(valid);
  expect(recovered.messages.at(-1)?.memoryEvaluation?.groupWork?.brains).toBeUndefined();
  expect(provider).not.toHaveBeenCalled();
});
it("flushes an older valid narrator outside the standard window with its exact evidence", async () => {
  const a = recoverySeed(); a.activeState.pendingBrainDeltas = a.activeState.pendingBrainDeltas!.slice(0, 1);
  fired = [];
  const r = await autoSource(a, "four");
  expect(r.logEntry.errors).toEqual([]);
  const review = provider.mock.calls.find(([r]) => r.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION")))![0];
  const body = JSON.parse(review.messages.at(-1)!.content);
  expect(body.latestTurnMessageIds).toEqual(["one"]);
  expect(body.recentEvidence).toContain(a.messages[0].content);
  expect(r.state.activeState.memoryProposals.filter(p => p.proposedType === "brainUpdate")).toHaveLength(1);
});
it.each(["failed", "quarantined", "running"] as const)("releases a %s stale frozen batch idempotently, retaining siblings and committed proposals", status => {
  const a = recoverySeed(); freezeRecovery(a); a.messages[3].memoryEvaluation!.status = status;
  a.messages[3].memoryEvaluation!.groupWork!.plot = { fingerprint: "plot", drafts: {} };
  a.messages[1].content = "Edited second source.";
  const valid = [a.activeState.pendingBrainDeltas![0], a.activeState.pendingBrainDeltas![2]];
  a.activeState.pendingBrainDeltas = []; // Recover from frozen entries, not just the buffer.
  const recovered = reconcileBrainBatchState(a);
  expect(recovered.activeState.pendingBrainDeltas).toEqual(valid);
  expect(recovered.messages[3].memoryEvaluation).toMatchObject({ status: "complete", completedGroups: ["plot", "storyCards", "discovery", "brains"] });
  expect(recovered.messages[3].memoryEvaluation?.groupWork?.brains).toBeUndefined();
  expect(recovered.messages[3].memoryEvaluation?.groupWork?.plot).toEqual(a.messages[3].memoryEvaluation?.groupWork?.plot);
  expect(reconcileBrainBatchState(recovered)).toBe(recovered);
  expect(provider).not.toHaveBeenCalled();
});
it("never replays a completed approved batch after reload and repeated recovery", async () => {
  let a = batchSeed();
  for (const id of ["one", "two", "three"]) a = (await autoTurn(a, id, ["brain:h"])).state;
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: a.activeState.memoryProposals[0].id });
  const thoughts = a.brains[0].thoughts, proposals = a.activeState.memoryProposals;
  provider.mockClear();
  a = reconcileBrainBatchState(reconcileBrainBatchState(normalizeAdventure(JSON.parse(JSON.stringify(a)))));
  await autoSource(a, "three");
  expect(a.brains[0].thoughts).toEqual(thoughts); expect(a.activeState.memoryProposals).toEqual(proposals);
  expect(a.activeState.pendingBrainDeltas).toEqual([]); expect(provider).not.toHaveBeenCalled();
});
it("requests one new assessment for a genuine narrator edit", async () => {
  const first = await cycle(seed()); provider.mockClear();
  const edited = reduce(first.state, { type: "UPDATE_MESSAGE", messageId: "source", content: "Hermione declines the invitation." });
  await cycle(edited); expect(counts().assessment).toBe(1);
});
it("reuses discovery decisions after approval changes while running current downstream checks", async () => {
  const a = seed(); discovery = true;
  const original = provider.getMockImplementation()!;
  provider.mockImplementation(async r => !isAssessment(r.messages) && r.messages.some(m => m.content.includes("STORY CARD MEMORY CHECK")) ? Promise.reject(Error("Disconnected")) : original(r));
  const first = await cycle(a);
  expect(first.state.messages.at(-1)?.memoryEvaluation?.completedGroups).not.toContain("discovery");
  first.state.activeState.memoryProposals.push({ ...makeStoryCardSuggestion(first.state, "source", a.messages.at(-1)!.content,
    { title: "Invitation", content: "Hermione accepted the invitation.", type: "lore", reason: "Observed", evidence: a.messages.at(-1)!.content }), status: "approved" });
  provider.mockImplementation(original); provider.mockClear();
  const result = await cycle(first.state);
  expect(counts().assessment).toBe(0);
  expect(result.state.messages.at(-1)?.memoryEvaluation?.completedGroups).toContain("discovery");
  expect(provider.mock.calls.some(([r]) => r.messages.some(m => m.content.includes("STORY CARD MEMORY CHECK")))).toBe(true);
});
it.each(["condition", "target"])("requests one new assessment after eligible %s changes", async kind => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })]; fired = ["brain:h"]; failValidation = "Hermione";
  const first = await cycle(a); failValidation = undefined; provider.mockClear();
  if (kind === "condition") first.state.brains[0].updateCondition = "Only when the invitation changes.";
  else first.state.brains.push(makeBrain({ id: "d", characterName: "Draconia", active: true }));
  await cycle(first.state); expect(counts().assessment).toBe(1);
});
it("binds Brain validation cache to exact old source content and current Brain state", async () => {
  const a = recoverySeed(); const cache = {};
  const review = () => validateMemoryUpdate(a, config, "brain", "Hermione", "", '{"thoughts":{"new":"I reconsider."}}', undefined,
    false, false, { id: "h", type: "brain" }, cache, ["one"]);
  await review(); await review(); expect(provider).toHaveBeenCalledTimes(1);
  a.messages[0].content += " Updated evidence."; await review(); expect(provider).toHaveBeenCalledTimes(2);
  a.brains[0].thoughts.other = "I remember another fact."; await review(); expect(provider).toHaveBeenCalledTimes(3);
});
it("selects explicit batch narrators and preceding story inputs without substitutions or future evidence", () => {
  const a = seed(); a.messages.push({ id: "future", role: "assistant", content: "Later events", createdAt: "today" });
  expect(brainBatchEvidenceMessages(a, ["source", "prior", "source"]).map(m => m.id)).toEqual(["prior", "player", "source"]);
  for (const ids of [[], ["missing"], ["player"], ["prior", "source", "future", "extra"]]) expect(() => brainBatchEvidenceMessages(a, ids)).toThrow();
  a.messages[0].inputMode = "comms"; expect(() => brainBatchEvidenceMessages(a, ["prior"])).toThrow();
});
it("repairs malformed deltas, missing targets and duplicate keys without altering valid evidence", () => {
  const a = recoverySeed(); const good = a.activeState.pendingBrainDeltas![0];
  a.activeState.pendingBrainDeltas = [good, { ...good }, { ...good, brainId: "deleted" },
    { ...good, sourceTurn: NaN }, { ...good, evidenceMessageIds: [42] as unknown as string[] }];
  expect(reconcileBrainBatchState(a).activeState.pendingBrainDeltas).toEqual([good]); expect(provider).not.toHaveBeenCalled();
});

it("recovers frozen-only survivors when deleting the interrupted batch owner", () => {
  const a = recoverySeed(); freezeRecovery(a); const valid = a.activeState.pendingBrainDeltas!;
  a.activeState.pendingBrainDeltas = [];
  const recovered = reduce(a, { type: "DELETE_MESSAGE", messageId: "four" });
  expect(recovered.activeState.pendingBrainDeltas).toEqual(valid);
  expect(provider).not.toHaveBeenCalled();
});
it("repairs a thirteen-delta regression fixture by discarding six stale sources and preserving seven valid entries", () => {
  const a = batchSeed();
  a.messages = Array.from({ length: 13 }, (_, i) => ({ id: `source_${i}`, role: "assistant", content: `Hermione learns research fact ${i}.`, createdAt: "2026-10-26" }));
  const buffered = a.messages.map((m, i) => ({ brainId: "h", sourceId: m.id, sourceTurn: i,
    sourceContent: m.content, delta: `I reconsider fact ${i}.`, evidenceMessageIds: [m.id] }));
  a.activeState.pendingBrainDeltas = buffered;
  for (let i = 0; i < 3; i++) a.messages[i].content += " Edited.";
  a.messages = a.messages.filter((_, i) => i < 3 || i >= 6);
  const recovered = normalizeAdventure(JSON.parse(JSON.stringify(a)));
  expect(recovered.activeState.pendingBrainDeltas).toEqual(buffered.slice(6));
  expect(reconcileBrainBatchState(recovered)).toBe(recovered);
  expect(provider).not.toHaveBeenCalled();
});

it("processes recovered survivors in the next automatic Brain cycle without retrying their old owner", async () => {
  let a = recoverySeed(); freezeRecovery(a); a.messages[1].content = "Edited second source.";
  a = reconcileBrainBatchState(a); provider.mockClear();
  const old = await autoSource(a, "four");
  expect(provider).not.toHaveBeenCalled();
  a = (await autoTurn(old.state, "five", ["brain:h"])).state;
  expect(counts()).toEqual({ assessment: 1, validation: 1, total: 3 });
  expect(a.activeState.pendingBrainDeltas).toEqual([]);
  const proposal = a.activeState.memoryProposals.find(p => p.proposedType === "brainUpdate")!;
  expect(Object.keys(JSON.parse(proposal.content).thoughts)).toEqual(["reaction_one", "reaction_three", "reaction_five"]);
});
it("uses legacy full-fingerprint validation when a checkpoint has no source identity", async () => {
  const a = seed(); a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })];
  fired = ["brain:h"]; failValidation = "Hermione"; const first = await cycle(a);
  delete first.state.messages.at(-1)!.memoryEvaluation!.assessment!.sourceFingerprint;
  first.state.brains[0].thoughts.changed = "I reconsider an unrelated question.";
  failValidation = undefined; provider.mockClear(); await cycle(first.state);
  expect(counts().assessment).toBe(1);
});

function assessmentBatchSeed() {
  const a = normalizeAdventure(seed()); a.messages = [];
  const events = ["Hermione accepts Draconia's invitation to dinner.", "Draconia agrees to share the notebook as a separate research agreement.",
    "Hermione attempts to kiss Draconia, but Draconia steps away before contact."];
  for (let i = 0; i < 3; i++) a.messages.push({ id: `batch-${i}`, role: "assistant", content: events[i], createdAt: "2026-10-26",
    memoryEvaluation: { turn: i + 1, attempts: 0, completedGroups: [], status: "pending", revision: `r${i}` } });
  return a;
}
it("batches distinct invitation, research and attempted kiss sources without future evidence", async () => {
  const a = assessmentBatchSeed();
  provider.mockImplementation(async request => {
    const payload = JSON.parse(request.messages.at(-1)!.content);
    expect(payload.messagePool).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(payload.sources[i].evidenceMessageIds).toEqual(a.messages.slice(0, i + 1).map(m => m.id));
    return response(JSON.stringify({ sources: payload.sources.map((s: { sourceId: string }) => ({
      ...JSON.parse(mockAssessment([{ role: "user", content: JSON.stringify({ sourceId: s.sourceId, conditions: { plot: [], storyCards: [], brains: [] } }) }])),
      sourceId: s.sourceId, discovery: { needed: true, reason: a.messages.find(m => m.id === s.sourceId)!.content, evidenceMessageIds: [s.sourceId] },
    })) }));
  });
  const batch = await assessMemoryBatch(a, config, ["batch-2", "batch-0", "batch-1"]);
  expect(counts().assessment).toBe(1);
  expect(batch.sources.map(s => s.sourceId)).toEqual(["batch-0", "batch-1", "batch-2"]);
  expect(batch.sources.map(s => s.assessment.discovery.reason)).toEqual(a.messages.map(m => m.content));
  expect(batch.sources.every(s => s.assessment.discovery.evidenceMessageIds.join() === s.sourceId)).toBe(true);
});
it("retains two valid siblings after one malformed batch record without a paid repair", async () => {
  const a = assessmentBatchSeed();
  provider.mockImplementation(async request => {
    if (isAssessment(request.messages)) {
      const decision = JSON.parse(mockAssessment(request.messages)); delete decision.sources[1].brains;
      return response(JSON.stringify(decision));
    }
    expect(JSON.stringify(request.messages)).not.toContain(a.messages[0].content);
    return response("malformed repair");
  });
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  expect(batch.sources.map(s => s.sourceId)).toEqual(["batch-0", "batch-2"]);
  expect(batch.invalidSourceIds).toEqual(["batch-1"]); expect(provider).toHaveBeenCalledTimes(1);
});
it("rejects duplicated IDs, missing sources, foreign evidence and duplicate source records independently", async () => {
  const a = assessmentBatchSeed();
  await expect(assessMemoryBatch(a, config, ["batch-0", "batch-0"])).rejects.toThrow();
  await expect(assessMemoryBatch(a, config, ["absent"])).rejects.toThrow();
  const conditions = { plot: [], storyCards: [], brains: [] };
  const record = JSON.parse(mockAssessment([{ role: "user", content: JSON.stringify({ sourceId: "batch-0", conditions }) }], [], true));
  const input = [{ sourceId: "batch-0", conditions, requestedGroups: ["discovery" as const], evidenceMessageIds: ["batch-0"] }];
  expect(parseMemoryAssessmentBatch(JSON.stringify({ sources: [{ ...record, sourceId: "batch-0", discovery: { ...record.discovery, evidenceMessageIds: ["batch-2"] } }] }), input).invalidSourceIds).toEqual(["batch-0"]);
  expect(parseMemoryAssessmentBatch(JSON.stringify({ sources: [{ ...record, sourceId: "batch-0" }, { ...record, sourceId: "batch-0" }] }), input).invalidSourceIds).toEqual(["batch-0"]);
});
it("persists valid siblings independently, rejects edits during flight and makes identical storage a no-op", async () => {
  let a = assessmentBatchSeed();
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  a = reduce(a, { type: "UPDATE_MESSAGE", messageId: "batch-1", content: "Corrected research outcome." });
  a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
  expect(a.messages[0].memoryEvaluation?.assessment).toBeDefined();
  expect(a.messages[1].memoryEvaluation?.assessment).toBeUndefined();
  expect(a.messages[2].memoryEvaluation?.assessment).toBeUndefined();
  expect(reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources })).toBe(a);
});
it("reuses persisted batch checkpoints after reload and proposal status changes, invalidating edited sources and targets", async () => {
  let a = assessmentBatchSeed(); const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  a = normalizeAdventure(JSON.parse(JSON.stringify(reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources }))));
  provider.mockClear();
  const usage = { promptTokens: 0, completionTokens: 0 };
  const sourceId = a.messages[0].id;
  const snapshot = { ...a, messages: a.messages.slice(0, 1) };
  expect((await assessMemory(snapshot, config, sourceId, buildMemoryAssessmentConditions(snapshot), usage)).reused).toBe(true);
  expect(provider).not.toHaveBeenCalled(); expect(usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  snapshot.messages = [{ ...snapshot.messages[0], content: "Hermione declined the invitation." }];
  expect((await assessMemory(snapshot, config, sourceId, buildMemoryAssessmentConditions(snapshot), usage)).reused).toBe(false);
  expect(provider).toHaveBeenCalledTimes(1);
});
it("keeps Hermione and Draconia private targets separate and never grants absent Ron a target", async () => {
  const a = assessmentBatchSeed();
  a.brains = ["Hermione", "Draconia", "Ron"].map(name => makeBrain({ id: name.toLowerCase(), characterName: name, active: true }));
  fired = ["brain:hermione", "brain:draconia", "brain:ron"];
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  for (const source of batch.sources) {
    expect(source.assessment.brains.targets.map(t => t.id)).toEqual(["brain:hermione", "brain:draconia"]);
    expect(source.assessment.brains.targets.every(t => t.evidenceMessageIds.join() === source.sourceId)).toBe(true);
  }
});
it("reuses a batch assessment after downstream failure without duplicating completed proposals", async () => {
  let a = assessmentBatchSeed(); discovery = true;
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
  provider.mockImplementation(async request => { if (isAssessment(request.messages)) throw Error("Unexpected paid reassessment"); throw Error("Offline discovery failure"); });
  let result = await runMemoryCycle(a, config, { sourceId: "batch-0" });
  a = result.actions.reduce(reduce, a);
  expect(a.messages[0].memoryEvaluation?.completedGroups).toEqual(["plot", "storyCards", "brains"]);
  provider.mockImplementation(async request => { if (isAssessment(request.messages)) throw Error("Unexpected paid reassessment"); return response("[]"); });
  result = await runMemoryCycle(a, config, { sourceId: "batch-0" }); a = result.actions.reduce(reduce, a);
  expect(a.messages[0].memoryEvaluation?.status).toBe("complete");
  const before = provider.mock.calls.length;
  await runMemoryCycle(a, config, { sourceId: "batch-0" }); expect(provider).toHaveBeenCalledTimes(before);
  expect(a.activeState.memoryProposals).toHaveLength(0);
});

it("a relevant target edit invalidates a persisted batch classification while incidental metadata does not", async () => {
  let a = assessmentBatchSeed();
  a.storyCards = [makeStoryCard({ id: "research", type: "lore", title: "Research", keys: ["research"], content: "The notebook was sealed." })];
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
  const id = a.messages[1].id;
  a.messages = a.messages.slice(0, 2);
  a.storyCards[0].updatedAt = "2030-01-01"; provider.mockClear();
  expect((await assessMemory(a, config, id, buildMemoryAssessmentConditions(a), { promptTokens: 0, completionTokens: 0 })).reused).toBe(true);
  expect(provider).not.toHaveBeenCalled();
  a.storyCards[0].content = "The notebook archive is now open.";
  expect((await assessMemory(a, config, id, buildMemoryAssessmentConditions(a), { promptTokens: 0, completionTokens: 0 })).reused).toBe(false);
  expect(provider).toHaveBeenCalledTimes(1);
});
it("batch request guards prevent a cancelled provider request from reaching HTTP", async () => {
  const { guardMemoryRequests } = await import("../providers/memoryCompletion");
  const { sendMemoryCompletion } = await import("../providers/memoryCompletion");
  const { memoryBatchProvider } = await import("../providers/memoryCompletion");
  const a = assessmentBatchSeed();
  const guarded = memoryBatchProvider(guardMemoryRequests({ ...config }, () => false), a.messages.map(m => m.id));
  provider.mockClear();
  await expect(sendMemoryCompletion(a, guarded, [], "assessment")).rejects.toThrow("memory_work_cancelled");
  expect(provider).not.toHaveBeenCalled();
});

it("pools exact shared canon/card/plot reference bodies only once", async () => {
  const a = assessmentBatchSeed();
  a.components = [makeComponent({ id: "plot", type: "plotEssentials", title: "Research premise", content: "UNIQUE_PLOT_REFERENCE_BODY", autoUpdate: true })];
  a.storyCards = [makeStoryCard({ id: "research", title: "Research", type: "lore", keys: ["research"], pinned: true, content: "UNIQUE_CARD_REFERENCE_BODY" })];
  provider.mockImplementation(async r => response(mockAssessment(r.messages)));
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  const payload = provider.mock.calls[0][0].messages.at(-1)!.content;
  expect(payload.split("UNIQUE_PLOT_REFERENCE_BODY")).toHaveLength(2);
  expect(payload.split("UNIQUE_CARD_REFERENCE_BODY")).toHaveLength(2);
  expect(JSON.parse(payload).sources.every((s: { canonIds: string[]; cardIds: string[]; plotIds: string[] }) => s.canonIds.length && s.plotIds.length)).toBe(true);
  expect(batch.invalidSourceIds).toEqual([]); expect(provider).toHaveBeenCalledTimes(1);
});

it("uses the same evidence window as runMemoryCycle for long histories and excludes OOC narrators", async () => {
  let a = assessmentBatchSeed();
  a.brains = [makeBrain({ id: "ron", characterName: "Ron", active: true })];
  a.messages.unshift({ id: "old-ron", role: "assistant", content: "Ron learns the old secret.", createdAt: "2026-01-01" },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `old-routine-${i}`, role: "assistant" as const, content: "The room is quiet.", createdAt: "2026-01-01" })));
  const ids = ["batch-0", "batch-1", "batch-2"];
  const batch = await assessMemoryBatch(a, config, ids);
  const payload = JSON.parse(provider.mock.calls[0][0].messages.at(-1)!.content);
  expect(payload.sources.every((s: { eligibleConditions: { brains: unknown[] } }) => s.eligibleConditions.brains.length === 0)).toBe(true);
  a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
  for (const id of ids) {
    const result = await runMemoryCycle(a, config, { sourceId: id }); a = result.actions.reduce(reduce, a);
  }
  expect(counts().assessment).toBe(1);
  a.messages.push({ id: "ooc-player", role: "user", inputMode: "comms", content: "Explain this.", createdAt: "2026-10-26" },
    { id: "ooc-narrator", role: "assistant", content: "An explanation.", createdAt: "2026-10-26", memoryEvaluation: { turn: 4, attempts: 0, status: "pending", completedGroups: [] } });
  await expect(assessMemoryBatch(a, config, ["ooc-narrator"])).rejects.toThrow();
});


it("reuses all batch decisions after an automatic Brain write and still invalidates author edits", async () => {
  let a = assessmentBatchSeed();
  a.brains = [makeBrain({ id: "h", characterName: "Hermione", active: true })];
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
  a = reduce(a, { type: "APPLY_BRAIN_UPDATE", diagnosticSourceId: "batch-0", brainId: "h", patch: { thoughts: { dinner: "I accept the invitation." } } });
  expect(a.brains[0].thoughts.dinner).toBeDefined();
  provider.mockClear();
  for (const id of a.messages.map(m => m.id)) {
    const snapshot = { ...a, messages: a.messages.slice(0, a.messages.findIndex(m => m.id === id) + 1) };
    expect((await assessMemory(snapshot, config, id, buildMemoryAssessmentConditions(snapshot), { promptTokens: 0, completionTokens: 0 })).reused).toBe(true);
  }
  expect(provider).not.toHaveBeenCalled();
  a.brains[0].thoughts.author = "An explicit author correction.";
  // A later automatic write must not conceal an earlier author edit.
  a = reduce(a, { type: "APPLY_BRAIN_UPDATE", diagnosticSourceId: "batch-1", brainId: "h", patch: { thoughts: { research: "I will share the notebook." } } });
  const snapshot = { ...a, messages: a.messages.slice(0, 1) };
  expect((await assessMemory(snapshot, config, "batch-0", buildMemoryAssessmentConditions(snapshot), { promptTokens: 0, completionTokens: 0 })).reused).toBe(false);
  expect(provider).toHaveBeenCalledTimes(1);
});

it("reuses sibling assessments through actual automatic Lore appends without losing any distinct delta", async () => {
  let a = assessmentBatchSeed();

  a.memoryAutoApprove.loreStoryCard = true; a.memoryAutoApprove.otherStoryCard = true;
  a.storyCards = [makeStoryCard({ id: "research", type: "lore", title: "Research", keys: ["research", "invitation", "kiss"], content: "Research history." })];
  fired = ["storyCard:research"];
  const base = provider.getMockImplementation()!;
  provider.mockImplementation(async request => {
    if (!isAssessment(request.messages)) return base(request);
    const value = JSON.parse(mockAssessment(request.messages, fired));
    for (const record of value.sources ?? [value]) {
      const id = record.sourceId ?? JSON.parse(request.messages.at(-1)!.content).sourceId;
      record.storyCards.targets[0].delta = a.messages.find(m => m.id === id)!.content;
    }
    return response(JSON.stringify(value));
  });
  const batch = await assessMemoryBatch(a, config, a.messages.map(m => m.id));
  a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
  for (const id of a.messages.map(m => m.id)) {
    const result = await runMemoryCycle(a, config, { sourceId: id });
    a = result.actions.reduce(reduce, a);
  }
  expect(counts().assessment).toBe(1);
  expect(a.activeState.memoryProposals.filter(p => p.status === "approved")).toHaveLength(3);
  for (const message of a.messages) expect(a.storyCards[0].content).toContain(message.content);
  expect(a.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true);
  expect(a.messages.every(m => m.memoryEvaluation?.assessment?.reusableState === undefined)).toBe(true);
});

it("uses identical frozen Brain evidence for generation and review and excludes saved metadata", async () => {
  let a = batchSeed();
  for (const id of ["one", "two"]) a = (await autoTurn(a, id, ["brain:h"])).state;
  provider.mockClear();
  const result = await autoTurn(a, "three", []);
  const generation = provider.mock.calls.find(([r]) => r.messages.some(m => m.content.includes("Bounded Brain batch:")))![0];
  const validation = provider.mock.calls.find(([r]) => r.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION")))![0];
  const evidence = JSON.parse(validation.messages.at(-1)!.content).recentEvidence;
  expect(generation.messages.at(-1)!.content).toContain(evidence);
  expect(JSON.parse(validation.messages.at(-1)!.content).brainSourceIds).toEqual(["one", "two"]);
  expect(generation.messages.at(-1)!.content).not.toContain("research agreement three");
  const payload = JSON.stringify(generation.messages);
  for (const forbidden of ["memoryEvaluation", "reusableState", "completedGroups", "promptTokens"]) expect(payload).not.toContain(forbidden);
  expect(result.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
});

// These legacy assertions inspect detailed logging. OFF contracts are tested separately.
const debugLogging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: true }));
vi.mock("../config/debugLogging", () => debugLogging);
