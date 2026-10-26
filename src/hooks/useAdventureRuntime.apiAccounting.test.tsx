import { mockAssessment } from "../test/memoryAssessment";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure } from "../state/defaults";
import { saveAdventure } from "../db/adventureDb";
import type { Adventure } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

function setup(saved?: Adventure) {
  const initial = saved ?? createDefaultAdventure("HTTP accounting");
  initial.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://example.test/v1", model: "arbitrary-evaluator", memoryReasoningControl: "omit" };
  const settings = { enabled: true, everyNTurns: 1, generateContent: true };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    return { adventure, runtime: useAdventureRuntime(adventure, setAdventure,
      { ...defaultModelConfig, baseUrl: "https://example.test/v1", model: "arbitrary-narrator", apiKey: "test" },
      vi.fn(), vi.fn(), vi.fn(), async () => undefined, settings) };
  });
}
const nativeTimeout = globalThis.setTimeout;
async function settleHttp() { await new Promise<void>(resolve => nativeTimeout(resolve, 100)); }
function reply(content: string, prompt = 100, completion = 10) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } }));
}

describe("actual HTTP call accounting", () => {
  it("measures 20 narration plus seven batched assessment HTTP requests, with separate reported usage", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.model === "arbitrary-evaluator") {
        const saved = vi.mocked(saveAdventure).mock.calls.at(-1)![0];
        expect(saved.messages.at(-1)?.memoryEvaluation?.attempts).toBeGreaterThan(0);
        return reply(mockAssessment(body.messages), 800, 80);
      }
      return reply("Mira waits beside the gate.", 2000, 100);
    });
    const { result } = setup();
    for (let i = 0; i < 20; i++) await act(async () => { await result.current.runtime.submitTurn("I listen."); await settleHttp(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.adventure!.messages.filter(m => m.role === "assistant").every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(27);
    expect(result.current.adventure!.activeState.apiCallTotals).toEqual({
      narration: { requests: 20, failedRequests: 0, unreportedUsage: 0, promptTokens: 40000, completionTokens: 2000 },
      memoryEvaluation: { requests: 7, failedRequests: 0, unreportedUsage: 0, promptTokens: 5600, completionTokens: 560 },
    });
    expect(result.current.adventure!.activeState.apiCalls).toHaveLength(27);
    expect(result.current.adventure!.activeState.apiCalls!.filter(c => c.purpose === "memoryEvaluation").every(c =>
      c.memoryRequest?.sourceId && c.memoryRequest.batchSourceIds?.length && c.memoryRequest.stage === "assessment" && c.memoryRequest.attempt === 1)).toBe(true);
  });

  it("persists independent failures without replaying calls on reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let evaluations = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.model === "arbitrary-evaluator") {
        evaluations++;
        if (evaluations === 1) throw new Error("Disconnected");
        return reply(mockAssessment(body.messages));
      }
      return reply("Mira waits beside the gate.");
    });
    let hook = setup();
    await act(async () => { await hook.result.current.runtime.continueTurn(); await settleHttp(); await vi.advanceTimersByTimeAsync(120_000); });
    vi.useRealTimers();
    await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).toBe("failed"));
    const saved = normalizeAdventure(JSON.parse(JSON.stringify(vi.mocked(saveAdventure).mock.calls.at(-1)![0])));
    expect(saved.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
    expect(saved.activeState.apiCallTotals!.memoryEvaluation).toMatchObject({ requests: 1, failedRequests: 1, unreportedUsage: 1 });
    hook.unmount(); hook = setup(saved); await act(async () => {});
    expect(evaluations).toBe(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { await hook.result.current.runtime.continueTurn(); await settleHttp(); await vi.advanceTimersByTimeAsync(120_000); });
    vi.useRealTimers();
    await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
    expect(evaluations).toBe(2);
    expect(hook.result.current.adventure!.messages[0].memoryEvaluation?.status).toBe("failed");
    await act(async () => { await hook.result.current.runtime.retryMemory(); });
    expect(hook.result.current.adventure!.messages.filter(message => message.role === "assistant").every(message => message.memoryEvaluation?.status === "complete")).toBe(true);
    expect(hook.result.current.adventure!.activeState.apiCallTotals!.memoryEvaluation).toMatchObject({ requests: 3, failedRequests: 1 });
  });

  it("records corrections separately, including narration consumed before a failed correction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply("You agree to the bargain.", 400, 20))
      .mockRejectedValueOnce(new Error("Correction disconnected"));
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("I listen."); await settleHttp(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.adventure!.activeState.apiCallTotals).toMatchObject({
      narration: { requests: 1, promptTokens: 400, completionTokens: 20 },
      correction: { requests: 1, failedRequests: 1, unreportedUsage: 1 },
    });
    expect(result.current.adventure!.messages.filter(m => m.role === "assistant")).toHaveLength(0);
  });
});
