/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard, makeTriggerRule } from "../state/defaults";
import type { Adventure, MemoryDetectionSettings } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { beginProviderRequest } from "../providers/requestAccounting";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runMemoryCycle, runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
vi.mock("../triggers/semanticEngine", async importOriginal => ({
  ...await importOriginal<typeof import("../triggers/semanticEngine")>(),
  runMemoryCycle: vi.fn(async () => ({ actions: [] })),
  runSemanticPostTurnEvaluation: vi.fn(),
}));

function setup(enabled = true, customRule = false, worldEnabled = true) {
  const initial = createDefaultAdventure("Call accounting");
  initial.worldEvolutionSettings!.enabled = worldEnabled;
  initial.memoryDetectionSettings = { ...initial.memoryDetectionSettings, enabled: !enabled }; // deliberately stale saved settings
  initial.memoryAutoApprove = { ...initial.memoryAutoApprove, storyCard: true };
  if (customRule) initial.triggerRules.push(makeTriggerRule({ name: "Explicit custom rule", condition: "When Mira learns something", evaluationMode: "semantic" }));
  initial.storyCards = [makeStoryCard({ id: "mira", title: "Mira", content: "Mira is a scout.", active: true, pinned: true, protected: false })];
  const globalMemory: MemoryDetectionSettings = { enabled, everyNTurns: 3, generateContent: true };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined, globalMemory);
    return { runtime, adventure };
  });
}

const story = "Mira explains that silver burns her skin.";
const response = `${story}\n<memory_updates>${JSON.stringify({ updates: [{ kind: "card", target: "Mira", effects: [], content: "Silver burns Mira's skin.", evidence: story, reason: "Lasting vulnerability" }] })}</memory_updates>`;

describe("runtime one-pass call accounting", () => {
  it("persists categorized actual requests without counting aggregated message usage again", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementationOnce(async options => {
      const usage = { promptTokens: 120, completionTokens: 35, totalTokens: 155 };
      beginProviderRequest(options.config, options.messages)(true, response, usage);
      return { content: response, raw: {}, usage };
    });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(result.current.adventure?.activeState.providerRequests).toHaveLength(1);
    expect(result.current.adventure?.activeState.providerRequests?.[0]).toMatchObject({ purpose: "narration", turn: 1, usage: { promptTokens: 120, completionTokens: 35 } });
  });
  it("makes only one compact recovery attempt in an empty world sandbox and surfaces failure", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: story, raw: {} }).mockResolvedValueOnce({ content: "invalid JSON", raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await waitFor(() => expect(result.current.adventure?.worldEvolutionState?.issues[0].reason).toContain("Compact recovery failed"));
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.activeState.lastMemoryCycleTurn).toBe(1);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: response, raw: {}, usage: { promptTokens: 2000, completionTokens: 140, totalTokens: 2140 } });
  });
  afterEach(cleanup);

  it("uses one API call per submit/continue/regenerate with automatic memory ON and no follow-up cycle", async () => {
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.current.adventure?.storyCards[0].content).toContain("Silver");
    expect(result.current.adventure?.memoryDetectionSettings.enabled).toBe(true);
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    await act(async () => { await result.current.runtime.continueTurn(); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.runtime.regenerateLastResponse(); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(3);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.activeState.memoryProposals).toHaveLength(1);
    expect(result.current.adventure?.activeState.turn).toBe(2);
  });

  it("honors global memory OFF despite a saved ON setting", async () => {
    const { result } = setup(false);
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
    const payload = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0];
    expect(payload.messages.map(m => m.content).join("\n")).not.toContain("[ONE-PASS MEMORY]");
  });

  it("preserves the story and starts the fallback cycle for a malformed memory tail", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: `${story}<memory_updates>{"updates": [${"you agree ".repeat(300)}`, raw: {} })
      .mockResolvedValueOnce({ content: '{"updates":[]}', raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await waitFor(() => expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2));
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    expect(result.current.adventure?.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("Incomplete")))).toBe(true);
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
  });

  it("keeps the agency correction exception, discards memory from its rejected draft, and accounts for both calls", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: "You agree to the duke's terms. " + response, raw: {}, usage: { promptTokens: 2000, completionTokens: 150, totalTokens: 2150 } })
      .mockResolvedValueOnce({ content: "The duke waits for an answer.", raw: {}, usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 } })
      .mockResolvedValueOnce({ content: '{"updates":[]}', raw: {}, usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("I listen."); });
    await waitFor(() => expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(3));
    expect(result.current.adventure?.messages.at(-1)?.content).toBe("The duke waits for an answer.");
    expect(result.current.adventure?.messages.at(-1)?.usage?.totalTokens).toBe(2370);
    expect(result.current.adventure?.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("visible-story correction")))).toBe(true);
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
    const correction = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[1][0];
    expect(correction.messages.map(m => m.content).join("\n")).not.toContain("<memory_updates>");
    expect(runMemoryCycle).not.toHaveBeenCalled();
  });

  it("recovers a missing memory envelope with one focused background call", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: story, raw: {} })
      .mockResolvedValueOnce({ content: '{"updates":[]}', raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await waitFor(() => expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2));
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    expect(result.current.adventure?.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("Memory envelope missing")))).toBe(true);
  });

  it("uses the legacy memory cycle if the focused recovery is invalid", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: story, raw: {} })
      .mockResolvedValueOnce({ content: "invalid JSON", raw: {} });
    const { result } = setup(true, false, false);
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await waitFor(() => expect(runMemoryCycle).toHaveBeenCalledTimes(1));
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
  });

  it("blocks duplicate submissions before React has rendered loading state", async () => {
    const { result } = setup();
    await act(async () => {
      await Promise.all([result.current.runtime.submitTurn("Mira explains."), result.current.runtime.submitTurn("Mira explains.")]);
    });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("retains continuity correction and discards the superseded draft's memory", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: "The deadline is tonight. " + response, raw: {} })
      .mockResolvedValueOnce({ content: "Mira has no deadline to report.", raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
    expect(result.current.adventure?.messages.at(-1)?.content).toBe("Mira has no deadline to report.");
    expect(result.current.adventure?.activeState.evaluationLog[0].errors[0]).toContain("continuity correction");
  });

  it("does not overlap explicitly configured background rule evaluations", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof runSemanticPostTurnEvaluation>>) => void;
    vi.mocked(runSemanticPostTurnEvaluation).mockReturnValue(new Promise(done => { resolve = done; }));
    const { result } = setup(true, true);
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    await act(async () => { await result.current.runtime.continueTurn(); });
    expect(runSemanticPostTurnEvaluation).toHaveBeenCalledTimes(1);
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    await act(async () => { resolve({ actions: [], logEntry: { id: "eval", turn: 1, createdAt: "2026-09-28", conditionsEvaluated: [], conditionsFired: [], generatedContent: [], actionsExecuted: [], errors: [] } }); });
  });
});
