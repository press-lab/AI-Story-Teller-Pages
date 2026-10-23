/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { suggestionSourceValid } from "../memory/storyCardSuggestions";
import { useAdventureRuntime } from "./useAdventureRuntime";
import type { Adventure } from "../types/adventure";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { vi.mocked(sendOpenAICompatibleChatCompletion).mockReset(); });

function setup() {
  const initial = createDefaultAdventure();
  initial.memoryDetectionSettings.enabled = false;
  initial.messages = [{ id: "source", role: "assistant", content: "Seth and Draconia shared their first kiss.", createdAt: "2026-01-01" }];
  initial.brains = [makeBrain({ characterName: "Draconia", thoughts: { old: "I must keep this secret." } })];
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined, initial.memoryDetectionSettings);
    return { adventure, runtime };
  });
}

it("completes an explicit evaluation with one background call and no narrative or Brain change", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: "source", updates: [] }] }) });
  const hook = setup();
  const before = hook.result.current.adventure!;
  await act(async () => { await hook.result.current.runtime.evaluateStoryCards(["source"]); });
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0].purpose).toBe("otherBackground");
  expect(hook.result.current.runtime.error).toBeUndefined();
  const next = hook.result.current.adventure!;
  expect(next.messages).toEqual(before.messages);
  expect(next.brains).toEqual(before.brains);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ proposedType: "storyCard", requiresReview: true, status: "pending" }));
});

it("cannot apply a model finding after the source changes during evaluation", async () => {
  let finish!: (response: { raw: object; content: string }) => void;
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const hook = setup();
  let pending!: Promise<void>;
  await act(async () => { pending = hook.result.current.runtime.evaluateStoryCards(["source"]); });
  await act(async () => { hook.result.current.runtime.applyActionsAndPersist([{ type: "UPDATE_MESSAGE", messageId: "source", content: "Seth and Draconia talked about the weather." }]); });
  await act(async () => {
    finish({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: "source", updates: [{ kind: "lore", target: "First kiss", content: "They shared their first kiss.", evidence: "Seth and Draconia shared their first kiss.", reason: "A milestone" }] }] }) });
    await pending;
  });
  const next = hook.result.current.adventure!;
  const stale = next.activeState.memoryProposals.find(p => p.storyCardReview?.origin === "model")!;
  expect(stale).toBeDefined();
  expect(suggestionSourceValid(next, stale)).toBe(false);
  expect(adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: stale.id }).storyCards).toEqual(next.storyCards);
});
