import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { validateMemoryUpdate } from "./validateMemoryUpdate";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
vi.mock("../providers/memoryCompletion", () => ({ sendMemoryCompletion: vi.fn() }));
const provider = vi.mocked(sendMemoryCompletion);
function seed() {
  const a = createDefaultAdventure(); a.components = []; a.storyCards = [];
  a.messages = [{ id: "ask", role: "user", content: "I ask Ron about the charms.", createdAt: "2026-01-01" },
    { id: "source", role: "assistant", content: "Ron asks for first refusal if Seth and Fred sell their tattoo charms. No deal is agreed.", createdAt: "2026-01-01" }];
  return a;
}
const verdict = () => ({ accepted: true, meaningfulChange: true, evidenceMessageIds: ["source"], reason: "Ron expressed interest; the makers do not acquire off-screen knowledge.", identityMatchesTarget: true, placement: { kind: "historicalLore", newFact: "Ron expressed interest.", reason: "Observable interest.", title: "Product interest", content: "Ron expressed interest; no sale was agreed." } });
beforeEach(() => provider.mockReset());
it.each([undefined, null, "true", 1])("retries a missing or incorrectly typed required identity verdict: %s", async identityMatchesTarget => {
  provider.mockResolvedValue({ content: JSON.stringify({ ...verdict(), identityMatchesTarget }), raw: {} });
  expect(await validateMemoryUpdate(seed(), defaultModelConfig, "storyCard", "Fred & George Partnership", "", "Ron expressed interest."))
    .toMatchObject({ changed: false, retryable: true, failureCode: "memory_validation_schema_invalid" });
});
it("preserves an explicit negative identity verdict and its explanation without retrying it as malformed output", async () => {
  provider.mockResolvedValue({ content: JSON.stringify({ ...verdict(), identityMatchesTarget: false, reason: "Fred never heard Ron." }), raw: {} });
  const result = await validateMemoryUpdate(seed(), defaultModelConfig, "brain", "Fred", "", '{"thoughts":{"sale":"I promised Ron a sale."}}');
  expect(result).toMatchObject({ changed: false, failureCode: "memory_identity_rejected", error: expect.stringContaining("Fred never heard Ron") });
  expect(result.retryable).not.toBe(true);
});
it("supplies Lore target metadata and accepts observable interest without asserting a sale", async () => {
  provider.mockResolvedValue({ content: JSON.stringify(verdict()), raw: {} });
  expect(await validateMemoryUpdate(seed(), defaultModelConfig, "storyCard", "Product interest", "", "Ron expressed interest; no sale was agreed.", undefined, true, false,
    { type: "lore", memoryMode: "historical" })).toMatchObject({ changed: true });
  const messages = provider.mock.calls[0][2];
  expect(JSON.parse(messages.at(-1)!.content).targetInfo).toEqual({ type: "lore", memoryMode: "historical" });
  expect(messages.some(m => m.content.includes("title can name a topic or partnership"))).toBe(true);
});
it.each([{}, { ...verdict(), accepted: "false" }, { ...verdict(), meaningfulChange: "yes" }, { ...verdict(), evidenceMessageIds: "source" }])("fails closed on malformed verdicts", async result => {
  provider.mockResolvedValue({ content: JSON.stringify(result), raw: {} });
  expect(await validateMemoryUpdate(seed(), defaultModelConfig, "storyCard", "Product", "", "Ron expressed interest."))
    .toMatchObject({ changed: false, retryable: true, failureCode: "memory_validation_schema_invalid" });
});
