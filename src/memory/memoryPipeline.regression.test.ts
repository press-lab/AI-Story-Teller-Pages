import { offlinePlacementReview } from "../test/memoryPlacement";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { memoryRecoveryBatch, pendingMemoryRecovery } from "./memoryRecoveryBatch";
import { runCompactMemoryFallback } from "./compactMemoryFallback";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { ...defaultModelConfig, apiKey: "test" };
const negotiation = "Hermione requests Draconia's government framework in writing before considering cooperation.";
const outreach = "Hermione commits to gathering responses from approximately 400 British exiles.";
function fixture() {
  const a = createDefaultAdventure("Blackfriars regression");
  a.memoryDetectionSettings.enabled = true;
  a.systemTriggers.enabled = true;
  a.memoryAutoApprove.storyCard = false;
  return a;
}
function update(text: string) {
  return { kind: "lore", target: text === negotiation ? "Hermione's cooperation conditions" : "Hermione's exile outreach", content: text,
    evidence: text, reason: "New commitment with consequences beyond this scene", triggers: ["Hermione", "British exiles"] };
}
beforeEach(() => vi.clearAllMocks());
it("commits a valid chronological recovery prefix atomically and cannot replay it", async () => {
  let a = fixture();
  for (const [id, text] of [["first", negotiation], ["second", outreach]]) {
    a = adventureReducer(a, { type: "ADD_MESSAGE", id, role: "assistant", content: text });
    a = adventureReducer(a, { type: "QUEUE_MEMORY_RECOVERY", messageId: id, turn: 1 });
  }
  provider.mockResolvedValue({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: "first", updates: [update(negotiation)] }, { sourceTurnId: "second", updates: null }] }) });
  const recovered = await runCompactMemoryFallback(a, config, a.messages);
  expect(recovered.valid).toBe(true);
  expect(recovered.processedSources?.map(s => s.id)).toEqual(["first"]);
  const complete = { type: "COMPLETE_MEMORY_RECOVERY" as const, sources: recovered.processedSources!, actions: recovered.actions };
  const next = adventureReducer(a, complete);
  expect(next.messages.map(m => m.memoryRecovery?.status)).toEqual(["complete", "pending"]);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ sourceTurnId: "first", sourceText: negotiation }));
  expect(adventureReducer(next, complete)).toBe(next);
  expect(provider).toHaveBeenCalledTimes(1);
  provider.mockResolvedValueOnce({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: "second", updates: [update(outreach)] }] }) });
  const retried = await runCompactMemoryFallback(next, config, next.messages.filter(message => message.memoryRecovery?.status === "pending"));
  const final = adventureReducer(next, { type: "COMPLETE_MEMORY_RECOVERY", sources: retried.processedSources!, dependencies: retried.sourceSnapshots, actions: retried.actions });
  expect(final.messages.map(message => message.memoryRecovery?.status)).toEqual(["complete", "complete"]);
  expect(final.activeState.memoryProposals.filter(proposal => proposal.sourceTurnId === "first")).toHaveLength(1);
  expect(final.activeState.memoryProposals.filter(proposal => proposal.sourceTurnId === "second")).toHaveLength(1);
});
it("reports request errors without copying credentials or response bodies", async () => {
  const a = fixture();
  a.messages.push({ id: "source", role: "assistant", content: negotiation, createdAt: "2026-01-01" });
  provider.mockRejectedValue(new Error("Provider error 401 secret key and body"));
  const result = await runCompactMemoryFallback(a, config, a.messages);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("provider_request_failed_http_401");
  expect(result.error).not.toContain("secret");
  expect(result.actions).toHaveLength(0);
});

it("accepts single-source empty JSON and completes pending work without proposals", async () => {
  let a = fixture();
  a = adventureReducer(a, { type: "ADD_MESSAGE", id: "routine", role: "assistant", content: "They enjoy a quiet meal." });
  a = adventureReducer(a, { type: "QUEUE_MEMORY_RECOVERY", messageId: "routine", turn: 1 });
  provider.mockResolvedValue({ raw: {}, content: '{"updates":[]}' });
  const result = await runCompactMemoryFallback(a, config, a.messages);
  expect(result.valid).toBe(true);
  const next = adventureReducer(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources!, actions: result.actions });
  expect(next.messages[0].memoryRecovery?.status).toBe("complete");
  expect(next.activeState.memoryProposals).toHaveLength(0);
});
it("retains malformed update objects as failed schema evaluation", async () => {
  const a = fixture();
  a.messages.push({ id: "source", role: "assistant", content: negotiation, createdAt: "2026-01-01", memoryRecovery: { status: "pending", turn: 1 } });
  provider.mockResolvedValue({ raw: {}, content: '{"turns":[{"sourceTurnId":"source","updates":[{}]}]}' });
  const result = await runCompactMemoryFallback(a, config, a.messages);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("response_schema_invalid");
  expect(a.messages[0].memoryRecovery?.status).toBe("pending");
});

// These legacy transport fixtures supply an explicit synthetic placement reviewer.
vi.mock("../providers/memoryCompletion", async importOriginal => {
  const actual = await importOriginal<typeof import("../providers/memoryCompletion")>();
  return { ...actual, sendMemoryCompletion: vi.fn(async (...args: Parameters<typeof actual.sendMemoryCompletion>) =>
    offlinePlacementReview({ messages: args[2] }) ?? actual.sendMemoryCompletion(...args)) };
});

it("keeps a recovered source and duplicate dispositions without replaying failed siblings", async () => {
  const { singlePassFixture, groundedFinding } = await import("../test/singlePassMemory");
  const { prepareSinglePassMemoryBatch, parseSinglePassMemoryResponse } = await import("./singlePassMemory");
  const { singlePassCycleSources } = await import("./memoryCycleState");
  let { a, ids } = singlePassFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = adventureReducer(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const first = JSON.stringify({ sourceId: ids[0], findings: [] });
  const last = JSON.stringify({ sourceId: ids[2], findings: [groundedFinding(), groundedFinding()] });
  const result = parseSinglePassMemoryResponse('{"sources":[' + first + ',' + last + ',{"sourceId":"cut', ids, a);
  a = adventureReducer(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: result.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) });
  expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation?.status).toBe("complete");
  expect(a.messages.find(m => m.id === ids[1])!.memoryEvaluation?.status).toBe("failed");
  expect(a.activeState.memoryProposals.filter(p => p.sourceTurnId === ids[2])).toHaveLength(1);
  expect(a.messages.find(m => m.id === ids[2])!.memoryEvaluation?.singlePass?.suppressedCount).toBe(1);
  expect(singlePassCycleSources(a)).toEqual([]); expect(provider).not.toHaveBeenCalled();
});

it.each([0, 1, 2])("retains October 27 fixture case %i with one extraction request", async index => {
  const fixture = (await import("./fixtures/memory-failure-20261027.json")).default;
  const { makeStoryCard } = await import("../state/defaults");
  const { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch } = await import("./singlePassMemory");
  const { validateSinglePassSource } = await import("./singlePassMemoryValidation");
  const transport = await import("../providers/memoryCompletion");
  const c = fixture.cases[index];
  let a = createDefaultAdventure();
  a.memoryDetectionSettings.pipeline = "singlePass";
  a.memoryAutoApprove.storyCard = true;
  a.storyCards = [
    makeStoryCard({ ...fixture.existingLoreTarget, type: "lore", content: "Four product designs exist.", keys: ["production", "supply", "tattoo paper"] }),
    makeStoryCard({ id: "twins", title: "Fred and George", type: "character", content: "The twins are students." }),
  ];
  a.messages = [
    { ...c.precedingPlayer, role: "user", createdAt: "2026-10-27T00:00:00Z", inputMode: "story" },
    { id: c.narratorSourceId, content: c.narratorContent, role: "assistant", createdAt: "2026-10-27T00:00:01Z", inputMode: "story",
      memoryEvaluation: { pipeline: "singlePass", status: "pending", attempts: 0, turn: 1, revision: "original", completedGroups: [] } },
  ];
  const batch = await prepareSinglePassMemoryBatch(a, [c.narratorSourceId]);
  const manifest = batch.outputAliases.S1;
  const target = Object.entries(manifest.cards).find(([, v]) => v.id === (index === 1 ? "twins" : fixture.existingLoreTarget.id))![0];
  // Case 2 has no exported finding body. This deterministic event is based on its saved narration.
  const content = c.originalModelFindings[0]?.content ?? "Fred and George discussed production testing, product designs, and a paper shortage explanation for higher prices.";
  const evidence = Object.entries(manifest.evidence).map(([alias]) => "E " + alias).join("\n");
  const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content:
    "MEM S1 storyCard " + target + "\nTITLE " + (index === 1 ? "Production testing and paper shortage" : fixture.existingLoreTarget.title) + "\n" + evidence + "\nTEXT\n" + content + "\nEND\nDONE S1" });
  const result = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
  const validated = validateSinglePassSource(a, result.sources[0], batch.checkpoints[0].checkpoint);
  expect(validated.rejected).toEqual([]);
  expect(validated.proposals).toHaveLength(1);
  expect(validated.proposals[0]).toMatchObject({ index: 0, findingIndex: 0, proposal: { content, status: "pending", requiresReview: true } });
  const proposal = validated.proposals[0].proposal;
  if (index === 1) {
    expect(result.sources[0].findings[0].targetId).toBeNull();
    expect(proposal.targetId).toBeUndefined();
    expect(proposal.storyCardReview?.targetCandidates).toContain(fixture.existingLoreTarget.id);
  } else expect(proposal.targetId).toBe(fixture.existingLoreTarget.id);
  if (index === 2) expect(content.split(/\s+/)).toHaveLength(98);
  const cards = structuredClone(a.storyCards);
  a = adventureReducer(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const commit = { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH" as const, batchId: batch.batchId, sources: [{ result: result.sources[0], checkpoint: batch.checkpoints[0].checkpoint }] };
  a = adventureReducer(a, commit);
  expect(a.storyCards).toEqual(cards);
  expect(a.messages[1].memoryEvaluation?.singlePass?.status).toBe("complete");
  expect(adventureReducer(a, commit)).toBe(a);
  if (index !== 1) expect(validateSinglePassSource(a, result.sources[0], batch.checkpoints[0].checkpoint).suppressed).toEqual([0]);
  expect(a.activeState.memoryProposals.filter(p => p.sourceTurnId === c.narratorSourceId)).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(1);
  send.mockRestore();
});

it("runs the six-result loose parser to router to validation to reducer production path in one request", async () => {
  const { looseMemoryFixture, looseResponse } = await import("../test/looseMemory");
  const { expectSixLooseProposals } = await import("../test/looseMemoryAssertions");
  const { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch } = await import("./singlePassMemory");
  const { validateSinglePassSource } = await import("./singlePassMemoryValidation");
  const transport = await import("../providers/memoryCompletion");
  let { a, ids } = looseMemoryFixture();
  const originalCards = structuredClone(a.storyCards), originalBrains = structuredClone(a.brains), originalComponents = structuredClone(a.components);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = adventureReducer(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content: looseResponse });
  const result = await runSinglePassMemoryBatch(a, config, batch);
  for (const source of result.sources) {
    const validated = validateSinglePassSource(a, source, batch.checkpoints.find(c => c.sourceId === source.sourceId)!.checkpoint);
    expect(validated.rejected).toEqual([]); expect(validated.proposals).toHaveLength(2);
  }
  const commit = { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH" as const, batchId: batch.batchId,
    sources: result.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) };
  a = adventureReducer(a, commit);
  expectSixLooseProposals(a, ids);
  expect(a.storyCards).toEqual(originalCards); expect(a.brains.filter(b => b.id !== "brain-george")).toEqual(originalBrains.filter(b => b.id !== "brain-george"));
  expect(Object.values(a.brains.find(b => b.id === "brain-george")!.thoughts)).toEqual([expect.stringContaining("I believe the business can grow beyond individual customers.")]); expect(a.components).toEqual(originalComponents);
  expect(adventureReducer(a, commit)).toBe(a);
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][3]).toBe("singlePass");
  send.mockRestore();
});

it("the default OFF pipeline still finalizes narration and queues operational memory evaluation", async () => {
  const a = fixture(); a.memoryDetectionSettings.everyNTurns = 1;
  const result = await runTurnPipeline({ adventure: a, text: "I continue.", assistantMessageId: "off-source", sendChatCompletion: async () => ({ content: negotiation }) });
  expect(result.adventure.messages.at(-1)?.content).toBe(negotiation);
  expect(result.adventure.messages.at(-1)?.memoryEvaluation?.status).toBe("pending");
  expect(result.adventure.activeState.memoryDiagnostics?.length ?? 0).toBe(0);
});
