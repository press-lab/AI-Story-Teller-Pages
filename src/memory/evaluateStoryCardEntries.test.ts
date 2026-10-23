import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { evaluateStoryCardEntries } from "./evaluateStoryCardEntries";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";

vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
beforeEach(() => { provider.mockReset(); });
function fixture() {
  const state = createDefaultAdventure();
  state.memoryDetectionSettings.enabled = false;
  state.storyCards = ["Seth", "Draconia"].map(title => makeStoryCard({ title, type: "character", content: `${title} is established.`, keys: [title] }));
  state.brains = [makeBrain({ id: "draconia-brain", characterName: "Draconia", thoughts: { old: "I distrust the Minister." } })];
  state.messages = [{ id: "old-source", role: "assistant" as const, content: "Seth and Draconia shared their first kiss.", createdAt: "2026-10-23" }];
  return state;
}

it("evaluates selected history once with memory disabled, without narration, Brain writes or invented old dates", async () => {
  let state = fixture();
  const original = structuredClone(state);
  provider.mockResolvedValue({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: "old-source", updates: [
    { kind: "lore", target: "Their first kiss", content: state.messages[0].content, evidence: state.messages[0].content, reason: "Milestone" },
    { kind: "thought", target: "Draconia", content: "I want to marry Seth.", evidence: state.messages[0].content, reason: "Not requested" },
  ] }] }) });
  const result = await evaluateStoryCardEntries(state, defaultModelConfig, ["old-source"]);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider.mock.calls[0][0]).toMatchObject({ responseFormat: "json_object", purpose: "otherBackground" });
  state = result.actions.reduce(adventureReducer, state);
  expect(state.messages.map(({ storyCardScan, ...message }) => message)).toEqual(original.messages);
  expect(state.messages[0].storyCardScan?.fingerprint).toBeDefined();
  expect(state.brains).toEqual(original.brains);
  expect(state.activeState.memoryProposals).toHaveLength(1);
  expect(state.activeState.memoryProposals[0]).toMatchObject({ status: "pending", storyCardType: "lore" });
  expect(state.activeState.memoryProposals[0].lore?.occurredAt).toBeUndefined();
  const repeat = await evaluateStoryCardEntries(state, defaultModelConfig, ["old-source"]);
  state = repeat.actions.reduce(adventureReducer, state);
  expect(state.activeState.memoryProposals).toHaveLength(1);
});

it("retains local review candidates when the requested model evaluation fails", async () => {
  const state = fixture();
  provider.mockImplementation(async () => { throw new Error("offline"); });
  const result = await evaluateStoryCardEntries(state, defaultModelConfig, ["old-source"]);
  expect(result.valid).toBe(false);
  const next = result.actions.reduce(adventureReducer, state);
  expect(next.activeState.memoryProposals).toHaveLength(1);
  expect(next.activeState.memoryProposals[0].storyCardReview?.origin).toBe("deterministic");
  expect(provider).toHaveBeenCalledTimes(1);
});

it("bounds requested history and rejects missing sources before making a request", async () => {
  await expect(evaluateStoryCardEntries(fixture(), defaultModelConfig, ["missing"])).rejects.toThrow("no longer available");
  await expect(evaluateStoryCardEntries(fixture(), defaultModelConfig, Array.from({ length: 11 }, (_, index) => String(index)))).rejects.toThrow("one and ten");
  expect(provider).not.toHaveBeenCalled();
});
