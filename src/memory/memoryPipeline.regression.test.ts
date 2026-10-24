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
it.each([negotiation, outreach])("routes LLM development into Memory Inbox with exact evidence: %s", async text => {
  const send = vi.fn(async (messages) => {
    expect(messages.some((m: { content: string }) => m.content.includes("[ONE-PASS MEMORY]"))).toBe(true);
    return { content: text + '<memory_updates>' + JSON.stringify({ updates: [update(text)] }) + '</memory_updates>' };
  });
  const result = await runTurnPipeline({ adventure: fixture(), text: "I listen to Hermione.", sendChatCompletion: send });
  expect(send).toHaveBeenCalledTimes(1);
  expect(result.adventure.activeState.memoryProposals).toContainEqual(expect.objectContaining({ proposedType: "storyCard", status: "pending", sourceText: text, sourceTurnId: result.adventure.messages.at(-1)!.id }));
  expect(result.adventure.messages.at(-1)?.content).toBe(text);
  expect(result.adventure.messages.at(-1)?.memoryRecovery).toBeUndefined();
});
it("queues empty inline evaluation for scheduled recovery without deterministic historical death nomination", async () => {
  const result = await runTurnPipeline({ adventure: fixture(), text: "We discuss history over dinner.", sendChatCompletion: async () => ({ content: 'They discuss Seth killing Voldemort on March 15, 2019.<memory_updates>{"updates":[]}</memory_updates>' }) });
  expect(result.adventure.messages.at(-1)?.memoryRecovery?.status).toBe("pending");
  expect(provider).not.toHaveBeenCalled();
  expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
  expect(result.adventure.activeState.evaluationLog[0].actionsExecuted.join(" ")).toContain("memory_evaluation_empty");
});
it.each(["", '<memory_updates>{"updates":['])("preserves failed narration and reports truncation: %s", async tail => {
  const result = await runTurnPipeline({ adventure: fixture(), text: "I listen.", sendChatCompletion: async () => ({ content: negotiation + tail, finishReason: "length" }) });
  expect(result.adventure.messages.at(-1)?.content).toBe(negotiation);
  expect(result.adventure.messages.at(-1)?.memoryRecovery?.status).toBe("pending");
  expect(result.adventure.activeState.evaluationLog[0].errors.join(" ")).toContain("provider_output_truncated");
});
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

it("retains failed inline work without duplicating an already-applied Brain thought", async () => {
  const a = fixture();
  a.brains = [makeBrain({ id: "Hermione", characterName: "Hermione", active: true })];
  a.memoryAutoApprove.brainUpdate = true;
  const updates = [{ kind: "thought", target: "Hermione", content: "I will review the framework first.", evidence: negotiation, reason: "Conditional plan" },
    { ...update(negotiation), evidence: "This did not happen in this source." }];
  const result = await runTurnPipeline({ adventure: a, text: "I listen to Hermione.", sendChatCompletion: async () => ({ content: negotiation + '<memory_updates>' + JSON.stringify({ updates }) + '</memory_updates>' }) });
  expect(Object.values(result.adventure.brains[0].thoughts)).toHaveLength(1);
  expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
  expect(result.adventure.messages.at(-1)?.memoryRecovery?.status).toBe("pending");
  const source = result.adventure.messages.at(-1)!;
  provider.mockResolvedValueOnce({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: source.id, updates: [{ ...updates[0], content: "I should examine that framework before deciding." }, update(negotiation)] }] }) });
  const recovered = await runCompactMemoryFallback(result.adventure, config, [source]);
  expect(recovered.valid).toBe(true);
  const next = adventureReducer(result.adventure, { type: "COMPLETE_MEMORY_RECOVERY", sources: recovered.processedSources!, dependencies: recovered.sourceSnapshots, actions: recovered.actions });
  expect(Object.values(next.brains[0].thoughts)).toHaveLength(1);
  expect(next.activeState.memoryProposals).toHaveLength(1);
});
it("binds proposals to the final source when Brain reactions are printed", async () => {
  const a = fixture();
  a.brains = [makeBrain({ id: "Hermione", characterName: "Hermione", active: true, printThoughts: true })];
  a.memoryAutoApprove.brainUpdate = true;
  const updates = [{ kind: "thought", target: "Hermione", content: "I will review the framework first.", evidence: negotiation, reason: "Conditional plan" }, update(negotiation)];
  const result = await runTurnPipeline({ adventure: a, text: "I listen to Hermione.", sendChatCompletion: async () => ({ content: negotiation + '<memory_updates>' + JSON.stringify({ updates }) + '</memory_updates>' }) });
  const proposal = result.adventure.activeState.memoryProposals.find(proposal => proposal.storyCardReview)!;
  expect(proposal.storyCardReview?.sourceContent).toBe(result.adventure.messages.at(-1)?.content);
  expect(result.adventure.messages.at(-1)?.content).toContain("*[Hermione]");
});

it("queues valid Brain-only inline evaluation without calling the background provider", async () => {
  const a = fixture();
  a.brains = [makeBrain({ id: "Hermione", characterName: "Hermione", active: true })];
  a.memoryAutoApprove.brainUpdate = true;
  const updates = [{ kind: "thought", target: "Hermione", content: "I will review the framework first.", evidence: negotiation, reason: "Conditional plan" }];
  const send = vi.fn(async () => ({ content: negotiation + '<memory_updates>' + JSON.stringify({ updates }) + '</memory_updates>' }));
  const result = await runTurnPipeline({ adventure: a, text: "I listen to Hermione.", sendChatCompletion: send });
  expect(Object.values(result.adventure.brains[0].thoughts)).toHaveLength(1);
  expect(result.adventure.activeState.evaluationLog[0].errors).toEqual([]);
  expect(pendingMemoryRecovery(result.adventure)).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(provider).not.toHaveBeenCalled();
});
it("retains dedicated recovery even when the narrator supplies Lore", async () => {
  const a = fixture();
  a.memoryDetectionSettings.evaluator = "dedicated";
  const result = await runTurnPipeline({ adventure: a, text: "I listen.", sendChatCompletion: async () => ({ content: negotiation + '<memory_updates>' + JSON.stringify({ updates: [update(negotiation)] }) + '</memory_updates>' }) });
  expect(pendingMemoryRecovery(result.adventure)).toHaveLength(1);
  expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
  expect(provider).not.toHaveBeenCalled();
});
it.each(["narrator", "dedicated"] as const)("never queues recovery with detection disabled (%s)", async evaluator => {
  const a = fixture();
  a.memoryDetectionSettings.enabled = false;
  a.memoryDetectionSettings.evaluator = evaluator;
  const result = await runTurnPipeline({ adventure: a, text: "I listen.", sendChatCompletion: async () => ({ content: negotiation + '<memory_updates>{"updates":[]}</memory_updates>' }) });
  expect(pendingMemoryRecovery(result.adventure)).toHaveLength(0);
  expect(provider).not.toHaveBeenCalled();
});
it("batches empty inline turns and cannot duplicate recovered proposals", async () => {
  let a = fixture();
  a.memoryDetectionSettings.evaluator = "narrator";
  a.memoryDetectionSettings.everyNTurns = 5;
  for (let turn = 1; turn <= 5; turn++) {
    const result = await runTurnPipeline({ adventure: a, text: "I listen.", assistantMessageId: `empty-${turn}`, sendChatCompletion: async () => ({ content: negotiation + '<memory_updates>{"updates":[]}</memory_updates>' }) });
    a = result.adventure;
    if (turn < 5) expect(memoryRecoveryBatch(a)).toEqual([]);
  }
  expect(provider).not.toHaveBeenCalled();
  const sources = memoryRecoveryBatch(a);
  expect(sources).toHaveLength(5);
  expect(new Set(pendingMemoryRecovery(a).map(source => source.id)).size).toBe(5);
  a = adventureReducer(a, { type: "CLAIM_MEMORY_RECOVERY", turn: 5 });
  expect(memoryRecoveryBatch(a)).toEqual([]);
  provider.mockResolvedValueOnce({ raw: {}, content: JSON.stringify({ turns: sources.map((source, index) => ({ sourceTurnId: source.id, updates: index === 0 ? [update(negotiation)] : [] })) }) });
  const recovered = await runCompactMemoryFallback(a, config, sources);
  expect(recovered.valid).toBe(true);
  const complete = { type: "COMPLETE_MEMORY_RECOVERY" as const, sources: recovered.processedSources!, dependencies: recovered.sourceSnapshots, actions: recovered.actions };
  a = adventureReducer(a, complete);
  expect(a.activeState.memoryProposals).toHaveLength(1);
  expect(pendingMemoryRecovery(a)).toEqual([]);
  expect(adventureReducer(a, complete)).toBe(a);
  for (let turn = 0; turn < 10; turn++) a = adventureReducer(a, { type: "ADVANCE_MEMORY_RECOVERY_TURN" });
  expect(memoryRecoveryBatch(a)).toEqual([]);
  expect(a.activeState.memoryProposals).toHaveLength(1);
  expect(provider).toHaveBeenCalledTimes(1);
});
