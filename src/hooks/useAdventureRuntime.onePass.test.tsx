import { suggestionSourceValid } from "../memory/storyCardSuggestions";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure, makeStoryCard, makeTriggerRule } from "../state/defaults";
import type { Adventure, MemoryDetectionSettings } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runMemoryCycle, runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
vi.mock("../triggers/semanticEngine", async importOriginal => ({
  ...await importOriginal<typeof import("../triggers/semanticEngine")>(),
  runMemoryCycle: vi.fn(async () => ({ actions: [] })),
  runSemanticPostTurnEvaluation: vi.fn(),
}));

afterEach(cleanup);

function setup(enabled = true, customRule = false, saved?: Adventure, memoryOverrides: Partial<MemoryDetectionSettings> = {}) {
  const initial = createDefaultAdventure("Call accounting");
  initial.memoryDetectionSettings = { ...initial.memoryDetectionSettings, enabled: !enabled }; // deliberately stale saved settings
  initial.memoryAutoApprove = { ...initial.memoryAutoApprove, storyCard: false };
  if (customRule) initial.triggerRules.push(makeTriggerRule({ name: "Explicit custom rule", condition: "When Mira learns something", evaluationMode: "semantic" }));
  initial.storyCards = [makeStoryCard({ id: "mira", title: "Mira", content: "Mira is a scout.", active: true, pinned: true, protected: false })];
  const globalMemory: MemoryDetectionSettings = { enabled, everyNTurns: 1, generateContent: true, ...memoryOverrides };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(saved ?? initial);
    const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined, globalMemory);
    return { runtime, adventure };
  });
}

const story = "Mira explains that silver burns her skin.";
const response = `${story}\n<memory_updates>${JSON.stringify({ updates: [{ kind: "card", target: "Mira", content: "Silver burns Mira's skin.", evidence: story, reason: "Lasting vulnerability" }] })}</memory_updates>`;

describe("runtime one-pass call accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: response, raw: {}, usage: { promptTokens: 2000, completionTokens: 140, totalTokens: 2140 } });
  });

  it("uses one API call per submit/continue/regenerate with automatic memory ON and no follow-up cycle", async () => {
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
    expect(result.current.adventure?.activeState.memoryProposals).toContainEqual(expect.objectContaining({ content: expect.stringContaining("Silver"), requiresReview: false }));
    expect(result.current.adventure?.memoryDetectionSettings.enabled).toBe(true);
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    await act(async () => { await result.current.runtime.continueTurn(); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.runtime.regenerateLastResponse(); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(3);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.activeState.memoryProposals.filter(p => suggestionSourceValid(result.current.adventure!, p))).toHaveLength(1);
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

  it("preserves the story and queues a malformed memory tail", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: `${story}<memory_updates>{"updates": [${"you agree ".repeat(300)}`, raw: {} })
      .mockResolvedValueOnce({ content: '{"updates":[]}', raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
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
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.current.adventure?.messages.at(-1)?.content).toBe("The duke waits for an answer.");
    expect(result.current.adventure?.messages.at(-1)?.usage?.totalTokens).toBe(2370);
    expect(result.current.adventure?.storyCards[0].content).toBe("Mira is a scout.");
    const correction = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[1][0];
    expect(correction.messages.map(m => m.content).join("\n")).toContain("[ONE-PASS MEMORY]");
    expect(correction.messages.at(-1)?.content).not.toContain("<memory_updates>");
    expect(runMemoryCycle).not.toHaveBeenCalled();
  });

  it("queues a missing envelope without an immediate background call", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: story, raw: {} })
      .mockResolvedValueOnce({ content: '{"updates":[]}', raw: {} });
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.messages.at(-1)?.content).toBe(story);
    expect(result.current.adventure?.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("Memory envelope missing")))).toBe(true);
  });

  it("retains failed recovery without calling the legacy cycle or retrying on regeneration", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => ({ content: options.responseFormat ? "invalid JSON" : story, raw: {} }));
    const { result } = setup();
    for (let i = 0; i < 5; i++) await act(async () => { await result.current.runtime.submitTurn("I listen."); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(6);
    expect(runMemoryCycle).not.toHaveBeenCalled();
    expect(result.current.adventure?.messages.filter(m => m.memoryRecovery?.status === "pending")).toHaveLength(5);
    await act(async () => { await result.current.runtime.regenerateLastResponse(); });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(7);
    expect(result.current.adventure?.activeState.lastMemoryRecoveryAttemptTurn).toBe(5);
    expect(result.current.adventure?.messages.filter(m => m.memoryRecovery?.status === "pending")).toHaveLength(5);
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


function batchReply(options: Parameters<typeof sendOpenAICompatibleChatCompletion>[0]) {
  const text = options.messages.map(message => message.content).join("\n");
  const ids: string[] = JSON.parse(/EVERY source ID: (\[[^\]]*\])/.exec(text)![1]);
  return JSON.stringify({ turns: ids.map(sourceTurnId => ({ sourceTurnId, updates: [] })) });
}

it.each(["missing", "malformed", "inline", "invalidRecovery"])("measures twenty %s turns across save/reload", async kind => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => ({
    content: options.responseFormat ? kind === "invalidRecovery" ? "invalid JSON" : batchReply(options) : kind === "inline" ? response : kind === "malformed" ? story + '<memory_updates>{bad' : story, raw: {},
  }));
  let hook = setup();
  for (let i = 0; i < 20; i++) {
    await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
    if (i === 2 || i === 8) {
      const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
      hook.unmount();
      hook = setup(true, false, saved);
    }
  }
  const calls = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls;
  expect(calls.filter(([options]) => !options.responseFormat)).toHaveLength(20);
  expect(calls.filter(([options]) => options.responseFormat)).toHaveLength(kind === "inline" ? 0 : 4);
  expect(hook.result.current.adventure?.messages.filter(m => m.memoryRecovery?.status === "pending")).toHaveLength(kind === "invalidRecovery" ? 20 : 0);
  expect(runMemoryCycle).not.toHaveBeenCalled();
  hook.unmount();
});

it("recovers the corrected narrative and a regenerated source, never the discarded drafts", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => ({ content: options.responseFormat ? batchReply(options) : story, raw: {} }));
  const { result } = setup();
  await act(async () => { await result.current.runtime.submitTurn("I listen."); });
  const discardedId = result.current.adventure!.messages.at(-1)!.id;
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: "You agree to the discarded terms.", raw: {} })
    .mockResolvedValueOnce({ content: "The duke waits for a decision.", raw: {} });
  await act(async () => { await result.current.runtime.regenerateLastResponse(); });
  for (let i = 0; i < 4; i++) await act(async () => { await result.current.runtime.continueTurn(); });
  const recovery = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.find(([o]) => o.responseFormat)![0];
  const payload = recovery.messages.map(m => m.content).join("\n");
  expect(payload).toContain("The duke waits for a decision.");
  expect(payload).not.toContain("discarded terms");
  expect(payload).not.toContain(discardedId);
  expect(runMemoryCycle).not.toHaveBeenCalled();
});


it("does not count communications or failed story requests toward the batch interval", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => ({ content: options.responseFormat ? batchReply(options) : story, raw: {} }));
  const { result } = setup();
  await act(async () => { await result.current.runtime.submitTurn("I listen."); });
  for (let i = 0; i < 8; i++) await act(async () => { await result.current.runtime.submitTurn("OOC question", "comms"); });
  vi.mocked(sendOpenAICompatibleChatCompletion).mockRejectedValueOnce(new Error("Disconnected"));
  await act(async () => { await result.current.runtime.continueTurn(); });
  expect(result.current.adventure!.activeState.memoryRecoveryStoryTurn).toBe(1);
  expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.filter(([o]) => o.responseFormat)).toHaveLength(0);
  for (let i = 0; i < 4; i++) await act(async () => { await result.current.runtime.continueTurn(); });
  expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.filter(([o]) => o.responseFormat)).toHaveLength(1);
  expect(result.current.adventure!.activeState.memoryRecoveryStoryTurn).toBe(5);
});


it("resumes a due batch on reload without requesting another narration", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => ({ content: options.responseFormat ? "invalid JSON" : story, raw: {} }));
  const first = setup();
  for (let i = 0; i < 5; i++) await act(async () => { await first.result.current.runtime.continueTurn(); });
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(first.result.current.adventure)));
  // Model a crash after the fifth narrative was saved, before the recovery claim committed.
  delete saved.activeState.lastMemoryRecoveryAttemptTurn;
  delete saved.activeState.lastMemoryRecoveryAttemptKind;
  // A crash BEFORE the claim also predates all per-source attempt/failure metadata.
  saved.messages = saved.messages.map(message => message.memoryRecovery ? { ...message,
    memoryRecovery: { turn: message.memoryRecovery.turn, status: "pending" as const } } : message);
  first.unmount();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockClear();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => ({ content: batchReply(options), raw: {} }));
  const second = setup(true, false, saved);
  await waitFor(() => expect(second.result.current.runtime.loading).toBe(false));
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0].purpose).toBe("memoryRecovery");
  expect(second.result.current.adventure!.messages.filter(m => m.memoryRecovery?.status === "pending")).toHaveLength(0);
  second.unmount();
});

it("evaluates the corrected final story in the existing rewrite request", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset()
    .mockResolvedValueOnce({ content: "You agree to the duke's terms. " + response, raw: {} })
    .mockResolvedValueOnce({ content: response, raw: {} });
  const { result } = setup();
  await act(async () => { await result.current.runtime.submitTurn("I listen."); });
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
  expect(result.current.adventure?.messages.at(-1)?.memoryRecovery).toBeUndefined();
  expect(result.current.adventure?.activeState.memoryProposals).toContainEqual(expect.objectContaining({ storyCardReview: expect.objectContaining({ sourceContent: story }) }));
  const calls = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls;
  expect(calls[1][0].config.maxOutputTokens).toBeGreaterThan(1400);
});


it("runs a dedicated evaluator only at the explicitly selected cadence", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset().mockImplementation(async options => {
    if (!options.responseFormat) return { content: story + '<memory_updates>{"updates":[]}</memory_updates>', raw: {} };
    const sources = JSON.parse(options.messages.at(-1)!.content.split("\nReturn only ")[0].replace("Completed source exchanges and in-world dates: ", "")) as Array<{ sourceTurnId: string }>;
    return { content: JSON.stringify({ turns: sources.map(source => ({ sourceTurnId: source.sourceTurnId, updates: [] })) }), raw: {} };
  });
  const { result } = setup(true, false, undefined, { evaluator: "dedicated", everyNTurns: 2 });
  for (let turn = 0; turn < 4; turn++) await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
  const calls = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.map(([options]) => options);
  expect(calls.filter(options => options.purpose === "narration")).toHaveLength(4);
  expect(calls.filter(options => options.purpose === "memoryRecovery")).toHaveLength(2);
  expect(result.current.adventure?.messages.filter(message => message.role === "assistant").every(message => message.memoryRecovery?.status === "complete")).toBe(true);
});

it("makes no automatic evaluator calls when dedicated mode is manual only", async () => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset().mockResolvedValue({ content: story + '<memory_updates>{"updates":[]}</memory_updates>', raw: {} });
  const { result } = setup(true, false, undefined, { evaluator: "dedicated", everyNTurns: 0 });
  for (let turn = 0; turn < 6; turn++) await act(async () => { await result.current.runtime.submitTurn("Mira explains."); });
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(6);
  expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.every(([options]) => options.purpose === "narration")).toBe(true);
});


it("completes accepted recovery sources and records bounded failures from the same response", async () => {
  const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
  provider.mockReset();
  provider.mockImplementation(async options => {
    if (!options.responseFormat) return { content: story, raw: {} };
    const { turns } = JSON.parse(batchReply(options));
    turns[0].updates = [{ kind: "lore", target: "Unsupported history", content: "Harry defeated Voldemort.",
      evidence: "Harry defeated Voldemort.", reason: "Historical event" }];
    turns[1].updates = [{ kind: "card", target: "Mira", content: "Silver burns Mira's skin.",
      evidence: story, reason: "Enduring weakness" }];
    return { content: JSON.stringify({ turns }), raw: {}, finishReason: "stop" };
  });
  const { result } = setup();
  for (let i = 0; i < 5; i++) await act(async () => { await result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(result.current.adventure?.messages.filter(m => m.memoryRecovery?.status === "complete")).toHaveLength(4));
  const sources = result.current.adventure!.messages.filter(m => m.role === "assistant");
  expect(sources[0].memoryRecovery).toMatchObject({ status: "pending", failures: 1 });
  expect(sources[0].memoryRecovery?.nextEligibleTurn).toBeGreaterThan(5);
  expect(sources.slice(1).every(source => source.memoryRecovery?.status === "complete")).toBe(true);
  expect(result.current.adventure!.activeState.memoryProposals).toContainEqual(expect.objectContaining({
    sourceTurnId: sources[1].id, status: "pending", content: "Silver burns Mira's skin.",
  }));
  expect(provider.mock.calls.filter(([options]) => options.responseFormat)).toHaveLength(1);
  expect(provider).toHaveBeenCalledTimes(6);
});
