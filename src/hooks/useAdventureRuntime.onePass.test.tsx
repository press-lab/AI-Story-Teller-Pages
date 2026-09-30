/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard, makeTriggerRule } from "../state/defaults";
import type { Adventure, MemoryDetectionSettings } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runMemoryCycle, runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", async importOriginal => ({
  ...await importOriginal<typeof import("../providers/openAICompatible")>(),
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));
vi.mock("../triggers/semanticEngine", async importOriginal => ({
  ...await importOriginal<typeof import("../triggers/semanticEngine")>(),
  runMemoryCycle: vi.fn(async () => ({ actions: [] })),
  runSemanticPostTurnEvaluation: vi.fn(),
}));

function setup(enabled = true, customRule = false, providerOverrides: Partial<typeof defaultModelConfig> = {}) {
  const initial = createDefaultAdventure("Call accounting");
  initial.memoryDetectionSettings = { ...initial.memoryDetectionSettings, enabled: !enabled }; // deliberately stale saved settings
  initial.memoryAutoApprove = { ...initial.memoryAutoApprove, storyCard: true };
  if (customRule) initial.triggerRules.push(makeTriggerRule({ name: "Explicit custom rule", condition: "When Mira learns something", evaluationMode: "semantic" }));
  initial.storyCards = [makeStoryCard({ id: "mira", title: "Mira", content: "Mira is a scout.", active: true, pinned: true, protected: false })];
  const globalMemory: MemoryDetectionSettings = { enabled, everyNTurns: 3, generateContent: true };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, ...providerOverrides, apiKey: "test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined, globalMemory);
    return { runtime, adventure };
  });
}

const story = "Mira explains that silver burns her skin.";
const memoryPass = JSON.stringify({ updates: [{ kind: "card", target: "Mira", content: "Silver burns Mira's skin.", evidence: story, reason: "Lasting vulnerability" }] });

describe("runtime call accounting: narrator plus scheduled background memory pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async ({ responseFormat }) => (
      responseFormat === "json_object"
        ? { content: memoryPass, raw: {}, usage: { promptTokens: 1500, completionTokens: 90, totalTokens: 1590 } }
        : { content: story, raw: {}, usage: { promptTokens: 2000, completionTokens: 140, totalTokens: 2140 } }
    ));
  });
  afterEach(cleanup);

  const storyCalls = () => vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.filter(([options]) => options.responseFormat !== "json_object");
  const memoryCalls = () => vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.filter(([options]) => options.responseFormat === "json_object");

  it("sends a narrator prompt without memory bookkeeping and runs one background pass per N turns", async () => {
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await waitFor(() => expect(memoryCalls()).toHaveLength(1));
    expect(storyCalls()).toHaveLength(1);
    expect(storyCalls()[0][0].messages.map(m => m.content).join("\n")).not.toContain("memory_updates");
    await waitFor(() => expect(result.current.adventure?.storyCards[0].content).toContain("Silver"));
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    expect(result.current.adventure?.activeState.backgroundTokenUsage).toEqual({ promptTokens: 1500, completionTokens: 90 });

    // everyNTurns = 3: the next two turns do not trigger another pass.
    await act(async () => { await result.current.runtime.continueTurn(); });
    await act(async () => { await result.current.runtime.submitTurn("Mira waits."); });
    expect(storyCalls()).toHaveLength(3);
    expect(memoryCalls()).toHaveLength(1);
    await act(async () => { await result.current.runtime.submitTurn("Mira leaves."); });
    await waitFor(() => expect(memoryCalls()).toHaveLength(2));
    expect(runMemoryCycle).not.toHaveBeenCalled();
  });

  it("honors global memory OFF despite a saved ON setting", async () => {
    const { result } = setup(false);
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
  });

  it("does not run the memory pass after an out-of-character turn", async () => {
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("[Out of Character: tomorrow is Tuesday]", "comms"); });
    expect(storyCalls()).toHaveLength(1);
    expect(memoryCalls()).toHaveLength(0);
  });

  it("turns on DeepSeek reasoning only for out-of-character corrections when enabled", async () => {
    const { result } = setup(true, false, { baseUrl: "https://api.deepseek.com/anthropic", reasoningForCorrections: true });
    await act(async () => { await result.current.runtime.submitTurn("[Out of Character: tomorrow is Tuesday]", "comms"); });
    await act(async () => { await result.current.runtime.submitTurn("I nod."); });
    const [ooc, story] = storyCalls().map(([options]) => options);
    expect(ooc.thinking).toBe("enabled");
    expect(ooc.config.maxOutputTokens).toBeGreaterThan(story.config.maxOutputTokens);
    expect(story.thinking).toBeUndefined();
  });

  it("logs an invalid memory pass and never escalates to the multi-call cycle", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async ({ responseFormat }) => (
      responseFormat === "json_object" ? { content: "invalid JSON", raw: {} } : { content: story, raw: {} }
    ));
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await waitFor(() => expect(result.current.adventure?.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("no usable JSON")))).toBe(true));
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    expect(result.current.adventure?.activeState.lastMemoryCycleTurn).toBe(1);
  });

  it("keeps the agency correction exception and accounts for both story calls", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: "You agree to the duke's terms.", raw: {}, usage: { promptTokens: 2000, completionTokens: 150, totalTokens: 2150 } })
      .mockResolvedValueOnce({ content: "The duke waits for an answer.", raw: {}, usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 } })
      .mockResolvedValueOnce({ content: '{"updates":[]}', raw: {}, usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("I listen."); });
    await waitFor(() => expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(3));
    expect(result.current.adventure?.messages.at(-1)?.content).toBe("The duke waits for an answer.");
    expect(result.current.adventure?.messages.at(-1)?.usage?.totalTokens).toBe(2370);
    expect(runMemoryCycle).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions before React has rendered loading state", async () => {
    const { result } = setup();
    await act(async () => {
      await Promise.all([result.current.runtime.submitTurn("Mira explains."), result.current.runtime.submitTurn("Mira explains.")]);
    });
    expect(storyCalls()).toHaveLength(1);
  });

  it("retains continuity correction", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: "The deadline is tonight. " + story, raw: {} })
      .mockResolvedValueOnce({ content: "Mira has no deadline to report.", raw: {} })
      .mockResolvedValue({ content: '{"updates":[]}', raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(result.current.adventure?.messages.at(-1)?.content).toBe("Mira has no deadline to report.");
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
  });

  it("does not overlap explicitly configured background rule evaluations", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof runSemanticPostTurnEvaluation>>) => void;
    vi.mocked(runSemanticPostTurnEvaluation).mockReturnValue(new Promise(done => { resolve = done; }));
    const { result } = setup(true, true);
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await act(async () => { await result.current.runtime.continueTurn(); });
    expect(runSemanticPostTurnEvaluation).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ actions: [], logEntry: { id: "eval", turn: 1, createdAt: "2026-09-28", conditionsEvaluated: [], conditionsFired: [], generatedContent: [], actionsExecuted: [], errors: [] } }); });
  });
});
