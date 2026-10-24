import { afterEach, expect, it, vi } from "vitest";
import { sendOpenAIMemoryResponse, MEMORY_RESPONSE_SCHEMA } from "./openAIMemoryResponses";
import { subscribeApiCalls } from "./apiCallAccounting";
import { defaultModelConfig } from "../state/defaults";
const config = { ...defaultModelConfig, baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-sol", apiKey: "test", maxOutputTokens: 1400 };
function reply(raw: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: status === 200, status, text: async () => JSON.stringify(raw) } as Response);
}
afterEach(() => vi.restoreAllMocks());
it.each(["gpt-6.1-sol", "gpt-6-astra"])("uses strict Responses JSON and accounts for %s", async model => {
  const spy = reply({ status: "completed", output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: '{"turns":[]}' }] }], usage: { input_tokens: 500, output_tokens: 40, total_tokens: 540, input_tokens_details: { cached_tokens: 200 } } });
  const records: unknown[] = [];
  const stop = subscribeApiCalls(record => records.push(record));
  try {
    const result = await sendOpenAIMemoryResponse({ config: { ...config, model }, messages: [{ role: "system", content: "Evaluate memory." }] });
    expect(spy.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model, store: false, text: { format: { type: "json_schema", strict: true, schema: MEMORY_RESPONSE_SCHEMA } } });
    expect(body.temperature).toBeUndefined();
    expect(body.max_output_tokens).toBe(3448);
    expect(result.content).toBe('{"turns":[]}');
    expect(result.usage?.cacheReadTokens).toBe(200);
    expect(records).toContainEqual(expect.objectContaining({ purpose: "memoryRecovery", status: "succeeded", usage: expect.objectContaining({ cacheReadTokens: 200 }) }));
  } finally { stop(); }
});
it("classifies reasoning exhaustion and retains reported usage", async () => {
  reply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 20, output_tokens: 1400 }, output: [] });
  await expect(sendOpenAIMemoryResponse({ config, messages: [] })).rejects.toMatchObject({ classification: "provider_response_incomplete", finishReason: "max_output_tokens", usage: expect.objectContaining({ completionTokens: 1400 }) });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("handles refusal without treating it as an empty result", async () => {
  reply({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "No" }] }] });
  await expect(sendOpenAIMemoryResponse({ config, messages: [] })).rejects.toMatchObject({ classification: "provider_refused" });
});
it("does not expose HTTP response bodies in memory errors", async () => {
  reply({ error: { message: "private credentials" } }, 401);
  await expect(sendOpenAIMemoryResponse({ config, messages: [] })).rejects.toMatchObject({ message: "provider_request_failed_http_401" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["https://api.openai.com", "https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/responses"])("normalizes the configured endpoint %s", async baseUrl => {
  const spy = reply({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"turns":[]}' }] }] });
  await sendOpenAIMemoryResponse({ config: { ...config, baseUrl }, messages: [] });
  expect(spy.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
});
