import { mockAssessment, isAssessment } from "../test/memoryAssessment";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure } from "../state/defaults";
import type { Adventure, MemoryDetectionSettings } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { saveAdventure } from "../db/adventureDb";
vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", async original => ({ ...await original<typeof import("../providers/openAICompatible")>(), sendOpenAICompatibleChatCompletion: vi.fn() }));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const story = "Mira waits beside the gate.";
function setup(saved?: Adventure, overrides: Partial<MemoryDetectionSettings> = {}) {
  const initial = saved ?? createDefaultAdventure("Independent runtime");
  initial.components = [];
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "offline-test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined,
      { enabled: true, everyNTurns: 1, generateContent: true, ...overrides });
    return { adventure, runtime, setAdventure };
  });
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); provider.mockReset();
  provider.mockImplementation(async request => ({ content: request.memoryEvaluation ? mockAssessment(request.messages) : story, raw: {} }));
});
it("evaluates finalized submit, continue and regenerated sources independently", async () => {
  const hook = setup();
  await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  await act(async () => { await hook.result.current.runtime.regenerateLastResponse(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(provider.mock.calls.filter(([request]) => request.memoryEvaluation)).toHaveLength(3);
  expect(provider.mock.calls.filter(([request]) => !request.memoryEvaluation)).toHaveLength(3);
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(hook.result.current.adventure!.activeState.turn).toBe(2);
  expect(provider.mock.calls.filter(([request]) => !request.memoryEvaluation).every(([request]) => !request.messages.some(message => message.content.includes("[ONE-PASS MEMORY]")))).toBe(true);
});
it("honors global OFF and manual-only cadence over saved ON settings", async () => {
  for (const overrides of [{ enabled: false }, { everyNTurns: 0 }]) {
    provider.mockClear(); const hook = setup(undefined, overrides);
    await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation).toBeUndefined(); hook.unmount();
  }
});
it.each([story, story + '<memory_updates>{invalid}', story + '<memory_updates>{"updates":[]}</memory_updates>'])("preserves prose and evaluates independently of legacy tail %s", async content => {
  provider.mockImplementation(async request => ({ content: request.memoryEvaluation ? mockAssessment(request.messages) : content, raw: {} }));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.at(-1)?.content).toBe(story);
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(provider).toHaveBeenCalledTimes(2);
});
it("saves and claims final narration before sending any independent request", async () => {
  provider.mockImplementation(async request => {
    if (request.memoryEvaluation) {
      const saved = vi.mocked(saveAdventure).mock.calls.at(-1)![0];
      expect(saved.messages.at(-1)?.content).toBe(story);
      expect(saved.messages.at(-1)?.memoryEvaluation?.attempts).toBeGreaterThan(0);
    }
    return { content: request.memoryEvaluation ? mockAssessment(request.messages) : story, raw: {} };
  });
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
});
it("keeps agency correction and evaluates only the corrected final story", async () => {
  let narration = 0;
  provider.mockImplementation(async request => ({ content: request.memoryEvaluation ? mockAssessment(request.messages) : ++narration === 1 ? "You agree to the duke's terms." : story, raw: {} }));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(provider).toHaveBeenCalledTimes(3);
  expect(hook.result.current.adventure!.messages.at(-1)?.content).toBe(story);
  const evaluation = provider.mock.calls.find(([request]) => request.memoryEvaluation)![0];
  expect(evaluation.messages.map(message => message.content).join("\n")).toContain(story);
  expect(evaluation.messages.map(message => message.content).join("\n")).not.toContain("You agree to the duke");
});
it("does not replay legacy or new pending memory on load", async () => {
  const saved = createDefaultAdventure();
  saved.messages = Array.from({ length: 80 }, (_, i) => ({ id: String(i), role: "assistant" as const, content: story, createdAt: "2026-01-01", memoryRecovery: { status: "pending" as const, turn: i } }));
  saved.messages[0].memoryEvaluation = { status: "failed", turn: 1, attempts: 1, completedGroups: [] };
  const hook = setup(normalizeAdventure(saved)); await act(async () => {});
  expect(provider).not.toHaveBeenCalled(); expect(hook.result.current.adventure!.messages).toHaveLength(80);
});
it("retains failed groups and saved narration, then retries only unfinished work on a later turn", async () => {
  let fail = true;
  provider.mockImplementation(async request => ({ content: request.memoryEvaluation ? fail ? "malformed" : mockAssessment(request.messages) : story, raw: {} }));
  let hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure))); hook.unmount();
  provider.mockClear(); hook = setup(saved); await act(async () => {}); expect(provider).not.toHaveBeenCalled();
  fail = false; await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.filter(message => message.role === "assistant").every(message => message.memoryEvaluation?.status === "complete")).toBe(true);
});
it("evaluates all queued new sources at cadence, with no missing intermediate developments", async () => {
  const hook = setup(undefined, { everyNTurns: 5 });
  for (let turn = 0; turn < 4; turn++) await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(provider).toHaveBeenCalledTimes(4);
  await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(provider.mock.calls.filter(([request]) => request.memoryEvaluation)).toHaveLength(5);
  expect(hook.result.current.adventure!.messages.filter(message => message.role === "assistant").every(message => message.memoryEvaluation?.status === "complete")).toBe(true);
});
it("blocks duplicate submissions before React rerenders loading", async () => {
  const hook = setup();
  await act(async () => { await Promise.all([hook.result.current.runtime.submitTurn("I listen."), hook.result.current.runtime.submitTurn("I listen.")]); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(provider).toHaveBeenCalledTimes(2);
});
it("does not count OOC or failed narration as an evaluated story source", async () => {
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("Explain this.", "comms"); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(provider).toHaveBeenCalledTimes(1);
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation).toBeUndefined();
  provider.mockRejectedValueOnce(new Error("offline narration"));
  await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.activeState.memoryRecoveryStoryTurn ?? 0).toBe(0);
});
it("allows explicit bounded evaluation of a legacy source while automatic memory is disabled", async () => {
  const a = createDefaultAdventure(); a.messages = [{ id: "legacy", role: "assistant", content: story, createdAt: "2026-01-01" }];
  const hook = setup(a, { enabled: false });
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources(["legacy"]); });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(hook.result.current.adventure!.messages[0].memoryEvaluation?.status).toBe("complete");
});

it("pauses invalid memory configuration before claims while narration continues, then allows explicit recovery", async () => {
  const a = createDefaultAdventure("Invalid evaluator");
  a.semanticEvaluationSettings = { ...a.semanticEvaluationSettings, backgroundProviderConfig: { baseUrl: "1", model: "" } };
  const hook = setup(a);
  for (let n = 0; n < 4; n++) {
    await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
    await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  }
  expect(provider.mock.calls.filter(([request]) => request.memoryEvaluation)).toHaveLength(0);
  const state = hook.result.current.adventure!;
  const sources = state.messages.filter(message => message.role === "assistant");
  expect(sources).toHaveLength(4);
  expect(sources.every(message => message.memoryEvaluation?.attempts === 0 && message.memoryEvaluation.status === "pending")).toBe(true);
  expect(state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "not_attempted", failureCategory: "configuration" }));
  await act(async () => { hook.result.current.setAdventure({ ...state, semanticEvaluationSettings: { ...state.semanticEvaluationSettings, backgroundProviderConfig: undefined } }); });
  expect(provider.mock.calls.filter(([request]) => request.memoryEvaluation)).toHaveLength(0);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources([sources[0].id]); });
  expect(hook.result.current.adventure!.messages.find(message => message.id === sources[0].id)?.memoryEvaluation?.status).toBe("complete");
  expect(hook.result.current.adventure!.messages.find(message => message.id === sources[1].id)?.memoryEvaluation?.attempts).toBe(0);
});
