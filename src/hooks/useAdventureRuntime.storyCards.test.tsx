import { offlinePlacementReview } from "../test/memoryPlacement";
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

it("completes an explicit evaluation with one generation and a placement review, without narrative or Brain changes", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ raw: {}, content: JSON.stringify({ turns: [{ sourceTurnId: "source", updates: [
    { kind: "lore", target: "First kiss", content: "They shared their first kiss.", evidence: "Seth and Draconia shared their first kiss.", reason: "A milestone" },
  ] }] }) });
  const hook = setup();
  const before = hook.result.current.adventure!;
  await act(async () => { await hook.result.current.runtime.evaluateStoryCards(["source"]); });
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0].purpose).toBe("otherBackground");
  expect(hook.result.current.runtime.error).toBeUndefined();
  const next = hook.result.current.adventure!;
  expect(next.messages.map(({ storyCardScan, ...message }) => message)).toEqual(before.messages);
  expect(next.messages[0].storyCardScan?.fingerprint).toBeDefined();
  expect(next.brains).toEqual(before.brains);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ proposedType: "storyCard", status: "pending", storyCardReview: expect.objectContaining({ origin: "model" }) }));
});

it("keeps a finding reviewable after the source changes during evaluation and prevents automatic approval", async () => {
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
  expect(adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: stale.id, automatic: true }).storyCards).toEqual(next.storyCards);
  const approved = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: stale.id });
  expect(approved.storyCards.at(-1)?.content).toBe(stale.content);
  expect(approved.activeState.memoryProposals.find(p => p.id === stale.id)?.status).toBe("approved");
});

// These legacy transport fixtures supply an explicit synthetic placement reviewer.
vi.mock("../providers/memoryCompletion", async importOriginal => {
  const actual = await importOriginal<typeof import("../providers/memoryCompletion")>();
  return { ...actual, sendMemoryCompletion: vi.fn(async (...args: Parameters<typeof actual.sendMemoryCompletion>) =>
    offlinePlacementReview({ messages: args[2] }) ?? actual.sendMemoryCompletion(...args)) };
});
