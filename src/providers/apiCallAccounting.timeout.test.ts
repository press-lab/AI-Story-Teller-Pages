import { afterEach, expect, it, vi } from "vitest";
import { fetchWithAccounting, PROVIDER_REQUEST_TIMEOUT_MS, ProviderRequestTimeoutError, subscribeApiCalls } from "./apiCallAccounting";
import { safeMemoryFailure } from "./backgroundProvider";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { sendMemoryCompletion } from "./memoryCompletion";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(["headers", "body"])("times out stalled %s, records one failed attempt and does not retry", async stage => {
  vi.useFakeTimers(); const records: string[] = [];
  const unsubscribe = subscribeApiCalls(record => records.push(record.status));
  const never = new Promise<Response>(() => {});
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => stage === "headers" ? never
    : Promise.resolve({ ok: true, status: 200, text: () => new Promise<string>(() => {}) } as Response));
  const result = fetchWithAccounting("https://example.test/v1/chat/completions", {}, defaultModelConfig, "memoryEvaluation").catch(error => error);
  await vi.advanceTimersByTimeAsync(PROVIDER_REQUEST_TIMEOUT_MS);
  expect(await result).toBeInstanceOf(ProviderRequestTimeoutError);
  expect((fetchMock.mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  expect(records).toEqual(["started", "failed"]);
  expect(fetchMock).toHaveBeenCalledTimes(1); unsubscribe();
});
it.each(["chatCompletions", "openaiResponses"] as const)("retains a safe timeout classification through %s without retrying", async transport => {
  vi.useFakeTimers();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
  const adventure = createDefaultAdventure();
  if (transport === "openaiResponses") adventure.semanticEvaluationSettings.memoryEvaluationApi = transport;
  const request = sendMemoryCompletion(adventure, { ...defaultModelConfig, apiKey: "offline-test" }, []).catch(error => error);
  await vi.advanceTimersByTimeAsync(PROVIDER_REQUEST_TIMEOUT_MS);
  expect(await request).toMatchObject({ code: "memory_provider_request_failed", providerCode: "provider_request_timed_out" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(safeMemoryFailure(new ProviderRequestTimeoutError()).message).toContain("may have billed");
});
