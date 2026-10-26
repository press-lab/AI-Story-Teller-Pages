import { mockAssessment, isAssessment } from "../test/memoryAssessment";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeStoryCard } from "../state/defaults";
import type { Adventure } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", async original => ({ ...await original<typeof import("../providers/openAICompatible")>(), sendOpenAICompatibleChatCompletion: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(["plain", "legacy-envelope", "large-archive"])("reports independent offline request costs for twenty %s turns", async kind => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const a = createDefaultAdventure(); a.components = [];
  if (kind === "large-archive") {
    a.brains = [makeBrain({ characterName: "Mira", active: true, thoughts: { old: "I distrust the duke." } })];
    a.storyCards = Array.from({ length: 200 }, (_, i) => makeStoryCard({ title: `Distant history ${i}`, content: `Unrelated archived subject ${i}.`, type: "lore", memoryMode: "historical", keys: [`distant-${i}`] }));
  }
  const provider = vi.mocked(sendOpenAICompatibleChatCompletion); provider.mockReset();
  provider.mockImplementation(async request => ({ content: request.memoryEvaluation ? mockAssessment(request.messages) : "Mira waits at the gate." + (kind === "legacy-envelope" ? '<memory_updates>{"updates":[]}</memory_updates>' : ""), raw: {} }));
  const hook = renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(a);
    return useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "offline-test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined, { pipeline: "legacy", enabled: true, generateContent: true, everyNTurns: 1 });
  });
  for (let turn = 0; turn < 20; turn++) await act(async () => { await hook.result.current.submitTurn("I listen to Mira."); });
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  vi.useRealTimers();
  await waitFor(() => expect(hook.result.current.memoryWork).toBeUndefined());
  const calls = provider.mock.calls.map(([request]) => request);
  const narration = calls.filter(request => !request.memoryEvaluation), evaluation = calls.filter(request => request.memoryEvaluation);
  expect(narration).toHaveLength(20);
  expect(evaluation).toHaveLength(7);
  expect(narration.every(request => !request.messages.some(message => message.content.includes("[ONE-PASS MEMORY]")))).toBe(true);
  expect(calls.every(request => !request.messages.some(message => message.content.includes("Unrelated archived subject")))).toBe(true);
  console.log("FOUNDATION_OFFLINE_COST", kind, JSON.stringify({ narration: narration.length, evaluation: evaluation.length,
    promptTokensEstimated: calls.reduce((sum, request) => sum + request.messages.reduce((count, message) => count + approximateTokenCount(message.content) + 8, 0), 0) }));
});
