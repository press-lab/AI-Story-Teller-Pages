import { offlinePlacementReview } from "../test/memoryPlacement";
import { afterEach, expect, it, vi } from "vitest";
import { syntheticMemoryAdventure, offerSourceId, partnershipSourceId, acceptanceId, recordedLoreId, offerQuote, acceptanceQuote, confirmationQuote } from "./fixtures/syntheticMemoryAdventure";
import type { GoldenMemoryCase } from "./semanticGoldenCases";
import { runCompactMemoryFallback } from "./compactMemoryFallback";
import { memoryRecoveryBatch, pendingMemoryRecovery } from "./memoryRecoveryBatch";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { normalizeAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { suggestionSourceValid, scanStoryCardExchange } from "./storyCardSuggestions";
import { matchingStoryCardEntities } from "./storyCardEntities";
import { evaluateStoryCardEntries } from "./evaluateStoryCardEntries";
import { scoreMemoryCase } from "./memorySemanticBenchmark";

const config = { ...defaultModelConfig, baseUrl: "https://provider.example/v1", model: "arbitrary-fast-model", memoryReasoningControl: "omit" as const, apiKey: "test" };
const syntheticCases: GoldenMemoryCase[] = [
  { id: "partnership", sourceIds: [offerSourceId, partnershipSourceId], expectation: "must", review: "developer-provisional",
    rationale: "Invented confirmed collaboration used only for software regression.", concepts: [["Casey"], ["Avery"], ["Blair"], ["custom"], ["sales"], ["handshake"]],
    acceptance: { singleLore: true, historical: true, title: "1 January 2000 — Casey Joins the Workshop Collaboration",
      requiredEvidenceMessageIds: [offerSourceId, acceptanceId, partnershipSourceId] } },
  { id: "recorded-meeting", sourceIds: [partnershipSourceId], expectation: "empty", review: "developer-provisional",
    rationale: "Invented meeting already recorded in the supplied canon." },
];
function fixture(id = "partnership") {
  return syntheticMemoryAdventure(id === "recorded-meeting");
}
function reply(turns: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200,
    text: async () => JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ turns }) } }], usage: { prompt_tokens: 700, completion_tokens: 160 } }) } as Response);
}
const partnership = () => ({ memoryMode: "historical", eventStatus: "completed", kind: "lore", operation: "create", cardType: "lore", targetId: null,
  target: "1 January 2000 — Casey Joins the Workshop Collaboration",
  content: "Casey accepted Avery and Blair's offer to contribute custom designs to their workshop products. Avery proposed compensation through a share of sales. A handshake confirmed the collaboration, while precise commercial terms remain unsettled. No products have been completed.",
  evidence: confirmationQuote,
  evidenceQuotes: [
    { messageId: offerSourceId, quote: offerQuote },
    { messageId: acceptanceId, quote: acceptanceQuote },
    { messageId: partnershipSourceId, quote: confirmationQuote },
  ], sourceMessageIds: [offerSourceId, acceptanceId, partnershipSourceId],
  eventDate: "2000-01-01", participants: ["Casey Vale", "Avery Stone", "Blair Reed"],
  triggers: ["custom designs", "workshop collaboration"], reason: "An invented confirmed agreement with unresolved terms." });
afterEach(() => vi.restoreAllMocks());

it("lets the newest synthetic exchange run after an old ten-source batch fails", async () => {
  let a = fixture();
  a.memoryDetectionSettings = { ...a.memoryDetectionSettings, evaluator: "narrator", everyNTurns: 1 };
  a.activeState.lastMemoryRecoveryAttemptTurn = undefined;
  const first = memoryRecoveryBatch(a);
  expect(first).toHaveLength(10);
  expect(first.some(source => source.id === partnershipSourceId)).toBe(false);
  a = reduce(a, { type: "CLAIM_MEMORY_RECOVERY", sources: first, turn: 45 });
  a = reduce(a, { type: "FAIL_MEMORY_RECOVERY", sources: first, turn: 45, error: "memory_evidence_rejected" });
  a.activeState.memoryRecoveryStoryTurn = 50;
  const fresh = memoryRecoveryBatch(normalizeAdventure(JSON.parse(JSON.stringify(a))));
  expect(fresh.some(source => source.id === partnershipSourceId)).toBe(true);
  expect(fresh.some(source => first.some(old => old.id === source.id))).toBe(false);
  reply(fresh.map(source => ({ sourceTurnId: source.id, updates: source.id === partnershipSourceId ? [partnership()] : [] })));
  const result = await runCompactMemoryFallback(a, config, fresh);
  expect(result.valid, result.error).toBe(true);
  const next = reduce(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources!, dependencies: result.sourceSnapshots, actions: result.actions });
  expect(next.activeState.memoryProposals.filter(proposal => proposal.storyCardType === "lore")).toHaveLength(1);
  expect(next.messages.find(source => source.id === partnershipSourceId)?.memoryRecovery?.status).toBe("complete");
  expect(pendingMemoryRecovery(next)).toHaveLength(10);
});

it("bounds retries, splits failed batches, and allows manual evaluation of quarantined sources", async () => {
  let a = fixture();
  const source = a.messages.find(source => source.id === partnershipSourceId)!;
  a.messages = a.messages.map(message => message.id === source.id ? message : { ...message, memoryRecovery: undefined });
  for (let failures = 1; failures <= 4; failures++) {
    a = reduce(a, { type: "CLAIM_MEMORY_RECOVERY", sources: [source], turn: failures * 100 });
    a = reduce(a, { type: "FAIL_MEMORY_RECOVERY", sources: [source], turn: failures * 100, error: "provider_invalid_json" });
    expect(a.messages.at(-1)?.memoryRecovery?.failures).toBe(failures);
    expect(a.messages.at(-1)?.memoryRecovery?.batchLimit).toBe(1);
  }
  a = normalizeAdventure(JSON.parse(JSON.stringify(a)));
  a.activeState.memoryRecoveryStoryTurn = 1000;
  expect(a.messages.at(-1)?.memoryRecovery?.status).toBe("quarantined");
  expect(memoryRecoveryBatch(a)).toEqual([]);
  reply([{ sourceTurnId: source.id, updates: [partnership()] }]);
  const result = await evaluateStoryCardEntries(a, config, [source.id]);
  expect(result.valid, result.error).toBe(true);
  const next = result.actions.reduce(reduce, a);
  expect(next.messages.at(-1)?.memoryRecovery?.status).toBe("complete");
  expect(memoryRecoveryBatch(next)).toEqual([]);
});

it("preserves a valid chronological prefix and never marks a failed suffix complete", async () => {
  let a = fixture();
  const sources = a.messages.filter(source => [offerSourceId, partnershipSourceId].includes(source.id));
  reply([{ sourceTurnId: sources[0].id, updates: [] }, { sourceTurnId: sources[1].id, updates: [{ ...partnership(), evidence: "A fabricated handshake quote." }] }]);
  const result = await runCompactMemoryFallback(a, config, sources);
  expect(result.valid).toBe(true);
  expect(result.processedSources?.map(source => source.id)).toEqual([offerSourceId]);
  a = reduce(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources!, dependencies: result.sourceSnapshots, actions: result.actions });
  expect(a.messages.find(source => source.id === offerSourceId)?.memoryRecovery?.status).toBe("complete");
  expect(a.messages.at(-1)?.memoryRecovery?.status).toBe("pending");
  expect(a.activeState.memoryProposals).toEqual([]);
  expect(a.activeState.evaluationLog.flatMap(entry => entry.errors).join(" ")).toContain("evidence");
});

it("binds one accurate historical partnership proposal to offer, acceptance and handshake snapshots", async () => {
  const a = fixture();
  a.systemTriggers.enabled = false; // Lore evaluation is independent of local identity nominations.
  const spy = reply([{ sourceTurnId: offerSourceId, updates: [] }, { sourceTurnId: partnershipSourceId, updates: [partnership()] }]);
  const result = await runCompactMemoryFallback(a, config, a.messages.filter(source => [offerSourceId, partnershipSourceId].includes(source.id)));
  expect(result.valid, result.error).toBe(true);
  const next = reduce(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources!, dependencies: result.sourceSnapshots, actions: result.actions });
  const proposal = next.activeState.memoryProposals[0];
  expect(next.activeState.memoryProposals).toHaveLength(1);
  expect(proposal).toMatchObject({ title: partnership().target, content: partnership().content, status: "pending", memoryMode: "historical", sourceTurnId: partnershipSourceId });
  expect(proposal.storyCardReview?.evidenceQuotes).toEqual(partnership().evidenceQuotes);
  for (const id of [offerSourceId, acceptanceId, partnershipSourceId]) {
    const edited = { ...next, messages: next.messages.map(source => source.id === id ? { ...source, content: "Edited" } : source) };
    expect(suggestionSourceValid(edited, proposal)).toBe(false);
    expect(reduce(edited, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id, automatic: true }).storyCards).toEqual(edited.storyCards);
    expect(reduce(edited, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id }).activeState.memoryProposals[0].status).toBe("approved");
  }
  expect(JSON.stringify(JSON.parse(spy.mock.calls[0][1]!.body as string).messages)).not.toContain(partnership().target);
  const score = scoreMemoryCase(syntheticCases.find(test => test.id === "partnership")!, result, next.activeState.memoryProposals);
  expect(score.requiredHit).toBe(true); // SOFTWARE routing only; this response is mocked.
});

it.each([
  { sourceMessageIds: [partnershipSourceId, "made-up"] },
  { evidenceQuotes: [{ messageId: offerSourceId, quote: "We signed away half the company." }] },
  { evidence: "A share of sales. I accept. Confirmed!" },
  { sourceMessageIds: [partnershipSourceId, "synthetic-source-1"] },
])("rejects fabricated, concatenated, out-of-window or unlisted evidence: %j", async bad => {
  const a = fixture(); reply([{ sourceTurnId: partnershipSourceId, updates: [{ ...partnership(), ...bad }] }]);
  const result = await runCompactMemoryFallback(a, config, [a.messages.at(-1)!]);
  expect(result.valid).toBe(false);
  expect(result.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
});

it("expands to three story exchanges and excludes a legacy OOC reply", () => {
  const a = fixture();
  const window = memoryEvidenceWindow(a, partnershipSourceId);
  expect(window.map(source => source.id)).toContain("synthetic-source-13");
  const index = a.messages.findIndex(source => source.id === acceptanceId);
  a.messages[index].inputMode = "comms";
  expect(memoryEvidenceWindow(a, partnershipSourceId).map(source => source.id)).toEqual([]);
});

it("recognizes Pat Jordan by a context-supported first name without joining unrelated identities", () => {
  const known = makeStoryCard({ id: "known", title: "Pat Jordan", type: "character", content: "An established visitor.", keys: ["Pat Jordan"] });
  const other = makeStoryCard({ id: "other", title: "Pat Smith", type: "character", content: "An unrelated person.", keys: ["Pat Smith"] });
  expect(matchingStoryCardEntities([known, other], "Pat", "Pat Jordan joins other visitors.")).toEqual([known]);
  expect(matchingStoryCardEntities([known, other], "Pat", "Pat arrives.")).toEqual([]);
  expect(matchingStoryCardEntities([known], "Pat Smith", "Pat Jordan and Pat Smith speak.")).toEqual([]);
  const a = fixture();
  expect(scanStoryCardExchange(a, a.messages.find(source => source.id === offerSourceId)!).some(proposal => proposal.title === "Robin")).toBe(false);
});

it("supplies preexisting meeting Lore and accepts a valid empty result without duplicating it", async () => {
  const a = fixture("recorded-meeting");
  const spy = reply([{ sourceTurnId: a.messages.at(-1)!.id, updates: [] }]);
  const result = await runCompactMemoryFallback(a, config, [a.messages.at(-1)!]);
  expect(result.valid, result.error).toBe(true);
  const payload = JSON.stringify(JSON.parse(spy.mock.calls[0][1]!.body as string).messages);
  expect(payload).toContain("This records the first on-screen introduction between Morgan and Rowan");
  expect(result.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL" && action.proposal.storyCardType === "lore")).toBe(false);
});

it("scores a schema-valid empty partnership as a semantic miss without runtime retries", () => {
  const test = syntheticCases.find(test => test.id === "partnership")!;
  const result = { valid: true, actions: [], evaluatedTurns: test.sourceIds.map(sourceTurnId => ({ sourceTurnId, updates: [] })), processedSources: test.sourceIds.map(id => ({ id, content: "source" })), tokenUsage: { promptTokens: 100, completionTokens: 10 } };
  const score = scoreMemoryCase(test, result, []);
  expect(score.requiredHit).toBe(false);
  expect(score.successfulEmpty).toBe(true);
  expect(score.missedByValidEmpty).toBe(true);
});

it("does not let software suppression hide raw semantic false positives or canon repetitions", () => {
  const test = syntheticCases.find(test => test.id === "recorded-meeting")!;
  const a = fixture(test.id);
  const existing = a.storyCards.find(card => card.id === recordedLoreId)!;
  const result = { valid: true, actions: [], evaluatedTurns: [{ sourceTurnId: test.sourceIds[0], updates: [{ kind: "lore", target: existing.title, content: existing.content }] }],
    processedSources: [{ id: test.sourceIds[0], content: "source" }], tokenUsage: { promptTokens: 100, completionTokens: 10 } };
  const score = scoreMemoryCase(test, result, [], a.storyCards);
  expect(score.falsePositiveSuggestions).toBe(1);
  expect(score.canonRepeats).toBe(1);
  expect(score.acceptedSuggestions).toBe(0);
});

it("splits failed retries while giving fresh work and older retries alternating opportunities", () => {
  let a = fixture(); a.memoryDetectionSettings = { ...a.memoryDetectionSettings, evaluator: "narrator", everyNTurns: 1 };
  a.activeState.lastMemoryRecoveryAttemptTurn = undefined;
  const old = memoryRecoveryBatch(a);
  a = reduce(a, { type: "CLAIM_MEMORY_RECOVERY", sources: old, turn: 45 });
  a = reduce(a, { type: "FAIL_MEMORY_RECOVERY", sources: old, turn: 45, error: "invalid schema" });
  expect(a.messages.filter(message => old.some(source => source.id === message.id)).every(message => message.memoryRecovery?.batchLimit === 5)).toBe(true);
  a.activeState.memoryRecoveryStoryTurn = 50;
  const fresh = memoryRecoveryBatch(a);
  a = reduce(a, { type: "CLAIM_MEMORY_RECOVERY", sources: fresh, turn: 50 });
  a = reduce(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: fresh, actions: [] });
  a = reduce(a, { type: "ADD_MESSAGE", id: "new-source", role: "assistant", content: "New narration." });
  a = reduce(a, { type: "QUEUE_MEMORY_RECOVERY", messageId: "new-source", turn: 50 });
  a.activeState.memoryRecoveryStoryTurn = 55;
  const retry = memoryRecoveryBatch(a);
  expect(retry).toHaveLength(5);
  expect(retry.every(source => old.some(previous => source.id === previous.id))).toBe(true);
  a = reduce(a, { type: "CLAIM_MEMORY_RECOVERY", sources: retry, turn: 55 });
  a = reduce(a, { type: "FAIL_MEMORY_RECOVERY", sources: retry, turn: 55, error: "still invalid" });
  expect(a.messages.filter(message => retry.some(source => source.id === message.id)).every(message => message.memoryRecovery?.batchLimit === 2)).toBe(true);
  a.activeState.memoryRecoveryStoryTurn = 60;
  expect(memoryRecoveryBatch(a).map(source => source.id)).toEqual(["new-source"]);
});

// These legacy transport fixtures supply an explicit synthetic placement reviewer.
vi.mock("../providers/memoryCompletion", async importOriginal => {
  const actual = await importOriginal<typeof import("../providers/memoryCompletion")>();
  return { ...actual, sendMemoryCompletion: vi.fn(async (...args: Parameters<typeof actual.sendMemoryCompletion>) =>
    offlinePlacementReview({ messages: args[2] }) ?? actual.sendMemoryCompletion(...args)) };
});

it("single-pass repeated Lore respects a prior rejection and preserves distinct deltas", async () => {
  const { singlePassFixture, groundedFinding } = await import("../test/singlePassMemory");
  const { prepareSinglePassMemoryBatch } = await import("./singlePassMemory");
  const { validateSinglePassSource } = await import("./singlePassMemoryValidation");
  let { a, ids } = singlePassFixture(1);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const result = { sourceId: ids[0], findings: [groundedFinding()], rejected: [] };
  const draft = validateSinglePassSource(a, result, batch.checkpoints[0].checkpoint).proposals[0].proposal;
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: draft });
  a = reduce(a, { type: "REJECT_MEMORY_PROPOSAL", proposalId: draft.id });
  const repeated = validateSinglePassSource(a, result, batch.checkpoints[0].checkpoint);
  expect(repeated.proposals).toHaveLength(0); expect(repeated.suppressed).toHaveLength(1);
  const separate = { ...groundedFinding(), title: "A future workshop tour", content: "Blair Reed will arrange a workshop tour later.", evidenceQuotes: [{ messageId: ids[0], quote: "Blair Reed will arrange a workshop tour later." }] };
  expect(validateSinglePassSource(a, { ...result, findings: [separate] }, batch.checkpoints[0].checkpoint).proposals).toHaveLength(1);
});
