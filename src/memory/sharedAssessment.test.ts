import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { isAssessment, mockAssessment } from "../test/memoryAssessment";
import { mockPlacementVerdict } from "../test/memoryPlacement";
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
    if (isAssessment(request.messages)) return response(mockAssessment(request.messages, fired, discovery));
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
it.each(["missing discovery", "missing brains", "unknown ID", "missing evidence", "malformed targets"])("fails visibly without legacy fallback on %s", async kind => {
  provider.mockImplementation(async request => {
    const value = JSON.parse(mockAssessment(request.messages));
    if (kind === "missing discovery") delete value.discovery;
    if (kind === "missing brains") delete value.brains;
    if (kind === "unknown ID") value.brains.targets = [{ id: "brain:unknown", delta: "changed", evidenceMessageIds: ["source"] }];
    if (kind === "missing evidence") delete value.discovery.evidenceMessageIds;
    if (kind === "malformed targets") value.plot.targets = null;
    return response(JSON.stringify(value));
  });
  const r = await cycle(seed());
  expect(counts().total).toBe(1); expect(r.state.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
  expect(r.state.messages.at(-1)?.memoryEvaluation?.completedGroups).toEqual([]);
  expect(r.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ failureCategory: "invalid_model_output" }));
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
  expect(counts().assessment).toBe(kind === "metadata" ? 0 : 1);
  expect(counts().total).toBe(kind === "metadata" ? 1 : 3);
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
  const first = await cycle(a); expect(counts()).toEqual({ assessment: 1, validation: 2, total: 4 });
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
