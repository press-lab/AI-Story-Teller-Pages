/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMemoryHistoryCompression } from "./useMemoryHistoryCompression";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { compressHistoryInWorker } from "../memory/memoryHistoryWorker";
import { saveAdventure } from "../db/adventureDb";
import type { Adventure, CompressedMemoryHistoryBlock, MemoryHistoryRecord } from "../types/adventure";
vi.mock("../memory/memoryHistoryWorker", () => ({ compressHistoryInWorker: vi.fn() }));
vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function initial() {
  const a = createDefaultAdventure();
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://example.test/v1", model: "evaluator", memoryReasoningControl: "omit" };
  a.messages = [{ id: "historical", role: "assistant", content: "A historical exchange.", createdAt: "2000-01-01", memoryEvaluation: { pipeline: "singlePass", status: "complete", attempts: 1, completedGroups: [], turn: 0 } }];
  return a;
}
function block(record: MemoryHistoryRecord): CompressedMemoryHistoryBlock {
  return { id: "verified", version: 1, format: "aist-memory-history", encoding: "typed-json-gzip-base64", kind: record.kind,
    recordId: record.id, decodedBytes: 100, sha256: "0".repeat(64), data: "verified-worker-result" };
}
it("narrates and evaluates three new sources while compression is still unresolved, then merges into the latest state", async () => {
  vi.stubGlobal("Worker", class {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let finish!: (value: CompressedMemoryHistoryBlock) => void;
  vi.mocked(compressHistoryInWorker).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let memoryCalls = 0, narrationCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    let content = "Mira waits beside the gate.";
    if (request.model === "evaluator") {
      memoryCalls++;
      const payload = JSON.parse(request.messages.at(-1).content);
      content = Object.keys(payload.outputAliases).map(key => `DONE ${key}`).join("\n");
    } else narrationCalls++;
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  });
  const hook = renderHook(() => {
    const [a, set] = useState<Adventure | undefined>(initial);
    const error = useMemoryHistoryCompression(a, set);
    const runtime = useAdventureRuntime(a, set, { ...defaultModelConfig, apiKey: "offline", baseUrl: "https://example.test/v1", model: "narrator" },
      vi.fn(), vi.fn(), vi.fn(), async () => undefined, { enabled: true, pipeline: "singlePass", everyNTurns: 1, generateContent: true });
    return { a, set, error, runtime };
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(compressHistoryInWorker).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.submitTurn("I wait."); });
  vi.useRealTimers();
  await waitFor(() => expect(memoryCalls).toBe(1));
  await waitFor(() => expect(hook.result.current.runtime.memoryWork).toBeUndefined());
  expect(narrationCalls).toBe(3);
  expect(hook.result.current.a!.activeState.compressedMemoryHistory).toBeUndefined();
  const record = vi.mocked(compressHistoryInWorker).mock.calls[0][0];
  await act(async () => { hook.result.current.set(current => ({ ...current!, title: "Edited during compression" })); });
  await act(async () => { finish(block(record)); });
  expect(hook.result.current.a!.title).toBe("Edited during compression");
  expect(hook.result.current.a!.messages.filter(m => m.role === "assistant")).toHaveLength(4);
  expect(hook.result.current.a!.activeState.compressedMemoryHistory!.blocks.verified.recordId).toBe("historical");
  expect(hook.result.current.error).toBeUndefined();
});
it("discards results after adventure switching and retains originals on compression failure", async () => {
  vi.stubGlobal("Worker", class {});
  vi.useFakeTimers();
  let finish!: (value: CompressedMemoryHistoryBlock) => void;
  vi.mocked(compressHistoryInWorker).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = initial();
  const hook = renderHook(() => {
    const [a, set] = useState<Adventure | undefined>(first);
    return { a, set, error: useMemoryHistoryCompression(a, set) };
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  const record = vi.mocked(compressHistoryInWorker).mock.calls[0][0];
  const other = createDefaultAdventure("Other");
  await act(async () => { hook.result.current.set(other); });
  await act(async () => { finish(block(record)); });
  expect(hook.result.current.a).toBe(other);
  expect(first.messages[0].memoryEvaluation).toBe(record.value);
  vi.mocked(compressHistoryInWorker).mockRejectedValueOnce(new Error("codec unavailable"));
  await act(async () => { hook.result.current.set(first); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(hook.result.current.a!.messages[0].memoryEvaluation).toBe(record.value);
  expect(hook.result.current.error).toContain("codec unavailable");
});
it("keeps a verified archive recoverable in memory and retries a failed persistence transaction", async () => {
  vi.stubGlobal("Worker", class {}); vi.useFakeTimers();
  vi.mocked(compressHistoryInWorker).mockImplementation(async record => block(record));
  vi.mocked(saveAdventure).mockRejectedValueOnce(new Error("Quota exceeded"));
  const hook = renderHook(() => {
    const [a, set] = useState<Adventure | undefined>(initial);
    return { a, error: useMemoryHistoryCompression(a, set) };
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(hook.result.current.error).toContain("History save failed");
  expect(hook.result.current.a!.activeState.compressedMemoryHistory!.blocks.verified).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(saveAdventure).toHaveBeenCalledTimes(2);
});

it("keeps archive progress completed during a pending narrator request in the published result and JSON", async () => {
  vi.stubGlobal("Worker", class {}); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let finish!: (value: CompressedMemoryHistoryBlock) => void;
  vi.mocked(compressHistoryInWorker).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  let respond!: (value: Response) => void;
  vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(resolve => { respond = resolve; }));
  const hook = renderHook(() => {
    const [a,set] = useState<Adventure | undefined>(initial);
    useMemoryHistoryCompression(a,set);
    return { a, runtime: useAdventureRuntime(a,set,{ ...defaultModelConfig, apiKey: "offline", model: "narrator", baseUrl: "https://example.test/v1" },
      vi.fn(),vi.fn(),vi.fn(),async()=>undefined,{ enabled:true,pipeline:"singlePass",everyNTurns:1,generateContent:true }) };
  });
  await act(async()=>{ await vi.advanceTimersByTimeAsync(500); });
  const record=vi.mocked(compressHistoryInWorker).mock.calls[0][0];
  let story!: Promise<boolean>;
  await act(async()=>{ story=hook.result.current.runtime.submitTurn("I wait."); });
  await act(async()=>{ finish(block(record)); });
  expect(hook.result.current.a!.activeState.compressedMemoryHistory!.blocks.verified).toBeTruthy();
  await act(async()=>{ respond(new Response(JSON.stringify({ choices:[{message:{content:"Mira waits beside the gate."}}] }))); await story; });
  expect(hook.result.current.a!.messages.at(-1)?.content).toBe("Mira waits beside the gate.");
  expect(hook.result.current.a!.messages[0].memoryEvaluation!.archivedMemoryHistoryId).toBe("verified");
  expect(JSON.stringify(hook.result.current.a)).toContain('"compressedMemoryHistory"');
  expect(hook.result.current.a!.activeState.apiCalls).toHaveLength(1);
});
