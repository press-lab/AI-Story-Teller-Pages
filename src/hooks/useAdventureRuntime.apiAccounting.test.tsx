/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure } from "../state/defaults";
import { saveAdventure } from "../db/adventureDb";
import type { Adventure } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function setup(saved?: Adventure) {
  const initial = saved ?? createDefaultAdventure("HTTP accounting");
  const settings = { enabled: true, everyNTurns: 1, generateContent: true };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    return { adventure, runtime: useAdventureRuntime(adventure, setAdventure,
      { ...defaultModelConfig, baseUrl: "https://example.test/v1", model: "deepseek-flash", apiKey: "test" },
      vi.fn(), vi.fn(), vi.fn(), async () => undefined, settings) };
  });
}
function reply(content: string, prompt = 100, completion = 10) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } }));
}
function recoveryResponse(body: { messages: Array<{ content: string }> }) {
  const text = body.messages.map(m => m.content).join("\n");
  const ids: string[] = JSON.parse(/EVERY source ID: (\[[^\]]*\])/.exec(text)![1]);
  return JSON.stringify({ turns: ids.map(sourceTurnId => ({ sourceTurnId, updates: [] })) });
}

describe("actual HTTP call accounting", () => {
  it("measures 20 narration plus 4 recovery HTTP requests, with separate reported usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.response_format) {
        const saved = vi.mocked(saveAdventure).mock.calls.at(-1)![0];
        expect(saved.activeState.lastMemoryRecoveryAttemptTurn).toBe(saved.activeState.turn);
        return reply(recoveryResponse(body), 800, 80);
      }
      return reply("Mira waits beside the gate.", 2000, 100);
    });
    const { result } = setup();
    for (let i = 0; i < 20; i++) await act(async () => { await result.current.runtime.submitTurn("I listen."); });
    expect(fetchMock).toHaveBeenCalledTimes(24);
    expect(result.current.adventure!.activeState.apiCallTotals).toEqual({
      narration: { requests: 20, failedRequests: 0, unreportedUsage: 0, promptTokens: 40000, completionTokens: 2000 },
      memoryRecovery: { requests: 4, failedRequests: 0, unreportedUsage: 0, promptTokens: 3200, completionTokens: 320 },
    });
    expect(result.current.adventure!.activeState.apiCalls).toHaveLength(24);
  });

  it("persists failure counts and retries the retained sources only after five more turns", async () => {
    let recoveries = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.response_format) {
        recoveries++;
        if (recoveries === 1) throw new Error("Disconnected");
        return reply(recoveryResponse(body));
      }
      return reply("Mira waits beside the gate.");
    });
    let hook = setup();
    for (let i = 0; i < 5; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); });
    const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
    hook.unmount();
    hook = setup(saved);
    await act(async () => { await hook.result.current.runtime.regenerateLastResponse(); });
    expect(recoveries).toBe(1);
    for (let i = 0; i < 5; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); });
    expect(fetchMock).toHaveBeenCalledTimes(13); // ten turns, one regeneration, two recoveries
    expect(hook.result.current.adventure!.activeState.apiCallTotals!.memoryRecovery).toMatchObject({ requests: 2, failedRequests: 1, unreportedUsage: 1 });
    expect(hook.result.current.adventure!.messages.filter(m => m.memoryRecovery?.status === "pending")).toHaveLength(0);
  });

  it("records corrections separately, including narration consumed before a failed correction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply("You agree to the bargain.", 400, 20))
      .mockRejectedValueOnce(new Error("Correction disconnected"));
    const { result } = setup();
    await act(async () => { await result.current.runtime.submitTurn("I listen."); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.adventure!.activeState.apiCallTotals).toMatchObject({
      narration: { requests: 1, promptTokens: 400, completionTokens: 20 },
      correction: { requests: 1, failedRequests: 1, unreportedUsage: 1 },
    });
    expect(result.current.adventure!.messages.filter(m => m.role === "assistant")).toHaveLength(0);
  });
});
