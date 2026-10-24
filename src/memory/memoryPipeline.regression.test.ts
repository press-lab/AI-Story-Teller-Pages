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
