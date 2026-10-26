/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, it, expect, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure } from "../state/defaults";
import type { Adventure } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import * as semantic from "../triggers/semanticEngine";
import * as assessment from "../memory/memoryAssessment";
import * as discovery from "../memory/memoryDetection";
import * as review from "../memory/validateMemoryUpdate";
import * as cardReview from "../memory/validateStoryCardProposal";
vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
const nativeTimeout = globalThis.setTimeout;
const settle = () => new Promise<void>(resolve => nativeTimeout(resolve, 30));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup(initial = createDefaultAdventure()) {
  initial.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://example.test/v1", model: "evaluator", memoryReasoningControl: "omit" };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    return { adventure, runtime: useAdventureRuntime(adventure, setAdventure,
      { ...defaultModelConfig, model: "narrator", baseUrl: "https://example.test/v1", apiKey: "offline" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined,
      { pipeline: "singlePass", enabled: true, everyNTurns: 1, generateContent: true }) };
  });
}
function mockHttp(mode = "empty") {
  let memoryCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const memory = body.model === "evaluator";
    let content = "Mira waits beside the gate.";
    if (memory) {
      memoryCalls++;
      if (mode === "timeout") throw new Error("network");
      const ids = JSON.parse(body.messages.at(-1).content).sources.map((s: { sourceId: string }) => s.sourceId);
      content = mode === "invalid" ? "{" : JSON.stringify({ sources: (mode === "missing" ? ids.slice(1) : ids).map((sourceId: string) => ({ sourceId, findings: [] })) });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
  });
  return () => memoryCalls;
}
it("three sources use one HTTP request and no legacy discovery, generation or paid review", async () => {
  const forbidden = [vi.spyOn(semantic, "runMemoryCycle"), vi.spyOn(assessment, "assessMemoryBatch"), vi.spyOn(assessment, "assessMemory"),
    vi.spyOn(discovery, "detectStoryCardProposals"), vi.spyOn(review, "validateMemoryUpdate"), vi.spyOn(cardReview, "validateStoryCardProposal")];
  const calls = mockHttp(); const hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.submitTurn("I wait."); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.messages.filter(m => m.role === "assistant").every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
  expect(calls()).toBe(1);
  for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
  const records = hook.result.current.adventure!.activeState.apiCalls!;
  expect(records.filter(c => c.memoryRequest?.stage === "singlePass")).toHaveLength(1);
  expect(records.filter(c => c.purpose === "narration")).toHaveLength(3);
});
it.each([1, 2])("idle flush uses one request for %i sources", async count => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const calls = mockHttp(); const hook = setup();
  for (let i = 0; i < count; i++) await act(async () => { await hook.result.current.runtime.submitTurn("I wait."); });
  expect(calls()).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); await settle(); });
  vi.useRealTimers();
  await waitFor(() => expect(calls()).toBe(1));
});
it.each(["invalid", "missing", "timeout"])("does not retry %s on later turns or reopen; explicit Retry uses one new request", async mode => {
  const calls = mockHttp(mode); let hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).toBe("failed"));
  expect(calls()).toBe(1);
  const failedId = hook.result.current.adventure!.messages.find(m => m.memoryEvaluation?.status === "failed")!.id;
  await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  expect(calls()).toBe(1);
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)) as Adventure);
  hook.unmount(); hook = setup(saved);
  await act(async () => { await settle(); }); expect(calls()).toBe(1);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources([failedId]); await settle(); });
  expect(calls()).toBe(2);
});
it("opening pending historical legacy or marked single-pass sources starts no request", async () => {
  const calls = mockHttp(); const a = createDefaultAdventure();
  a.messages = ["legacy", "singlePass"].map((id, i) => ({ id, role: "assistant", content: "Mira waits.", createdAt: "2000-01-01", memoryEvaluation: { pipeline: i ? "singlePass" : undefined, turn: 1, attempts: 0, status: "pending", completedGroups: [] } }));
  setup(a); await act(async () => { await settle(); }); expect(calls()).toBe(0);
});
