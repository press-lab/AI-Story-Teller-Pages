import { subscribeApiCalls } from "./apiCallAccounting";
import type { ApiCallRecord } from "../types/adventure";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GLM_REASONING_RESERVE_TOKENS,
  GLM_RETRY_REASONING_RESERVE_TOKENS,
  isGlmReasoningModel,
  isNativeDeepSeekProvider,
  resetProviderThrottleForTests,
  sendOpenAICompatibleChatCompletion,
} from "./openAICompatible";
import type { ProviderConfig } from "../types/adventure";

const config: ProviderConfig = {
  name: "test",
  baseUrl: "https://api.example.com",
  apiKey: "sk-test",
  model: "test-model",
  temperature: 0.8,
  maxOutputTokens: 256,
};

function mockFetch(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response);
}

afterEach(() => {
  vi.useRealTimers();
  resetProviderThrottleForTests();
  vi.restoreAllMocks();
});

describe("sendOpenAICompatibleChatCompletion", () => {
  it("recognizes only native DeepSeek API hosts", () => {
    expect(isNativeDeepSeekProvider({ baseUrl: "https://api.deepseek.com" })).toBe(true);
    expect(isNativeDeepSeekProvider({ baseUrl: "https://deepseek.com/v1" })).toBe(true);
    expect(isNativeDeepSeekProvider({ baseUrl: "https://openrouter.ai/api/v1" })).toBe(false);
    expect(isNativeDeepSeekProvider({ baseUrl: "https://deepseek.com.example.test" })).toBe(false);
  });

  it("throws when API key is missing", async () => {
    await expect(
      sendOpenAICompatibleChatCompletion({ messages: [], config: { ...config, apiKey: "" } }),
    ).rejects.toThrow("Missing API key");
    await expect(
      sendOpenAICompatibleChatCompletion({ messages: [], config: { ...config, apiKey: "   " } }),
    ).rejects.toThrow("Missing API key");
  });

  it("sends the correct payload to the v1/chat/completions endpoint", async () => {
    const spy = mockFetch(200, { choices: [{ message: { content: "Hello." } }] });
    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Hi" }],
      config,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.8,
      max_tokens: 256,
    });
  });

  it("sends optional JSON output and thinking controls", async () => {
    const spy = mockFetch(200, { choices: [{ message: { content: "{}" } }] });
    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Return JSON." }],
      config,
      responseFormat: "json_object",
      thinking: "disabled",
    });

    const [, init] = spy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("does not double-append v1 when base URL already ends with /v1", async () => {
    mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    const spy = vi.spyOn(globalThis, "fetch");
    await sendOpenAICompatibleChatCompletion({
      messages: [],
      config: { ...config, baseUrl: "https://api.example.com/v1" },
    });
    expect(spy.mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
  });

  it("does not modify base URL that already ends with /chat/completions", async () => {
    mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    const spy = vi.spyOn(globalThis, "fetch");
    await sendOpenAICompatibleChatCompletion({
      messages: [],
      config: { ...config, baseUrl: "https://api.example.com/v1/chat/completions" },
    });
    expect(spy.mock.calls[0][0]).toBe("https://api.example.com/v1/chat/completions");
  });

  it("returns content from the first choice", async () => {
    mockFetch(200, { choices: [{ message: { content: "The storm broke." } }] });
    const result = await sendOpenAICompatibleChatCompletion({ messages: [], config });
    expect(result.content).toBe("The storm broke.");
  });

  it("throws the provider error message on non-2xx with error body", async () => {
    mockFetch(401, { error: { message: "Invalid authentication credentials." } });
    await expect(
      sendOpenAICompatibleChatCompletion({ messages: [], config }),
    ).rejects.toThrow("Invalid authentication credentials.");
  });

  it("throws HTTP status fallback on non-2xx without error body", async () => {
    mockFetch(500, {});
    await expect(
      sendOpenAICompatibleChatCompletion({ messages: [], config }),
    ).rejects.toThrow("Provider error 500");
  });

  it("throws when response has no message content", async () => {
    mockFetch(200, { choices: [{ message: {} }] });
    await expect(
      sendOpenAICompatibleChatCompletion({ messages: [], config }),
    ).rejects.toThrow("Provider returned no content");
  });

  it("throws when choices array is empty", async () => {
    mockFetch(200, { choices: [] });
    await expect(
      sendOpenAICompatibleChatCompletion({ messages: [], config }),
    ).rejects.toThrow("Provider returned no content");
  });

  it("throttles provider calls by minimum seconds between requests", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    } as Response);
    const throttledConfig: ProviderConfig = {
      ...config,
      requestThrottle: { enabled: true, minSecondsBetweenRequests: 5, maxRequestsPerMinute: 0 },
    };

    await sendOpenAICompatibleChatCompletion({ messages: [], config: throttledConfig });
    expect(spy).toHaveBeenCalledTimes(1);

    const second = sendOpenAICompatibleChatCompletion({ messages: [], config: throttledConfig });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(spy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("wraps the system message in a cache_control content block when promptCaching is enabled", async () => {
    const spy = mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    await sendOpenAICompatibleChatCompletion({
      messages: [
        { role: "system", content: "You are a story engine." },
        { role: "user", content: "Continue." },
      ],
      config: { ...config, baseUrl: "https://openrouter.ai/api/v1", promptCaching: true },
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.messages[0].role).toBe("system");
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0]).toEqual({
      type: "text",
      text: "You are a story engine.",
      cache_control: { type: "ephemeral" },
    });
    // Non-system messages are unchanged
    expect(body.messages[1]).toEqual({ role: "user", content: "Continue." });
  });

  it("adds OpenRouter sticky session and routing preferences when configured", async () => {
    const spy = mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Hi" }],
      config: {
        ...config,
        baseUrl: "https://openrouter.ai/api/v1",
        promptCaching: true,
        sessionId: "ai-story-teller:adv-test",
        openRouterProviderSort: "latency",
      },
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.session_id).toBe("ai-story-teller:adv-test");
    expect(body.provider).toEqual({ sort: "latency" });
  });

  it("does not send OpenRouter-specific request fields to native providers", async () => {
    const spy = mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "system", content: "Stable context" }],
      config: {
        ...config,
        baseUrl: "https://api.deepseek.com",
        promptCaching: true,
        sessionId: "ai-story-teller:adv-test",
        openRouterProviderSort: "price",
      },
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.session_id).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect(body.messages[0].content).toBe("Stable context");
  });

  it("reports OpenAI-compatible cache usage fields", async () => {
    mockFetch(200, {
      choices: [{ message: { content: "ok" } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 40 },
      },
    });

    const result = await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Hi" }],
      config,
    });

    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 80,
      cacheCreationTokens: 40,
    });
  });

  it("uses Anthropic system cache blocks and reports cache usage", async () => {
    const spy = mockFetch(200, {
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 30,
      },
    });

    const result = await sendOpenAICompatibleChatCompletion({
      messages: [
        { role: "system", content: "Stable context" },
        { role: "user", content: "Continue." },
      ],
      config: { ...config, baseUrl: "https://api.example.com/anthropic/v1", promptCaching: true },
    });

    const [url, init] = spy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(init?.body as string);
    expect(url).toBe("https://api.example.com/anthropic/v1/messages");
    expect(headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
    expect(body.system).toEqual([
      { type: "text", text: "Stable context", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages).toEqual([{ role: "user", content: "Continue." }]);
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 70,
      cacheCreationTokens: 30,
    });
  });

  it("disables DeepSeek thinking for Anthropic-format requests when requested", async () => {
    const spy = mockFetch(200, { content: [{ type: "text", text: "ok" }] });

    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Rewrite this." }],
      config: { ...config, baseUrl: "https://api.deepseek.com/anthropic" },
      thinking: "disabled",
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning).toBeUndefined();
  });

  it("defaults DeepSeek Anthropic-format requests to non-thinking output", async () => {
    const spy = mockFetch(200, { content: [{ type: "text", text: "ok" }] });

    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Update the plot essentials." }],
      config: { ...config, baseUrl: "https://api.deepseek.com/anthropic" },
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning).toBeUndefined();
  });

  it("enables DeepSeek Anthropic reasoning only when explicitly requested", async () => {
    const spy = mockFetch(200, { content: [{ type: "text", text: "ok" }] });

    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Solve this carefully." }],
      config: { ...config, baseUrl: "https://api.deepseek.com/anthropic" },
      thinking: "enabled",
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning).toBeUndefined();
  });

  it("does not send DeepSeek reasoning controls to other Anthropic-compatible providers", async () => {
    const spy = mockFetch(200, { content: [{ type: "text", text: "ok" }] });

    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Rewrite this." }],
      config: { ...config, baseUrl: "https://api.example.com/anthropic/v1" },
      thinking: "disabled",
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.reasoning).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("recognizes GLM 5.x reasoning models", () => {
    expect(isGlmReasoningModel({ model: "z-ai/glm-5.3-flash" })).toBe(true);
    expect(isGlmReasoningModel({ model: "glm-5.3" })).toBe(true);
    expect(isGlmReasoningModel({ model: "glm-5" })).toBe(true);
    expect(isGlmReasoningModel({ model: "deepseek-chat" })).toBe(false);
    expect(isGlmReasoningModel({ model: "deepseek/deepseek-v3.2" })).toBe(false);
    expect(isGlmReasoningModel({ model: "glm-50-turbo" })).toBe(false);
  });

  it("reserves hidden reasoning headroom and low OpenRouter effort for GLM 5.3 Flash", async () => {
    const spy = mockFetch(200, { choices: [{ finish_reason: "stop", message: { content: "The door creaks." } }] });
    const result = await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Continue." }],
      config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash" },
      thinking: "disabled",
    });

    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.max_tokens).toBe(256 + GLM_REASONING_RESERVE_TOKENS);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.thinking).toBeUndefined();
    expect(result.content).toBe("The door creaks.");
  });

  it.each([undefined, "auto"] as const)("uses low OpenRouter GLM 5.3 Flash memory reasoning with control %s in one request", async memoryReasoningControl => {
    const spy = mockFetch(200, { choices: [{ finish_reason: "stop", message: { content: '{"updates":[]}' } }] });
    await sendOpenAICompatibleChatCompletion({
      config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash", memoryReasoningControl },
      messages: [], memoryEvaluation: true, purpose: "memoryRecovery", retry: true,
    });
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.max_tokens).toBe(256);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(spy.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps OpenRouter narration reasoning unchanged with memory auto configured", async () => {
    const spy = mockFetch(200, { choices: [{ finish_reason: "stop", message: { content: "The door creaks." } }] });
    await sendOpenAICompatibleChatCompletion({
      config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash", memoryReasoningControl: "auto" },
      messages: [], purpose: "narration", thinking: "disabled",
    });
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string).reasoning).toEqual({ effort: "low" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown automatic memory capabilities before sending Chat requests", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(sendOpenAICompatibleChatCompletion({ config: { ...config, memoryReasoningControl: "auto" }, messages: [], memoryEvaluation: true })).rejects.toThrow("memory_non_thinking_capability_unknown");
    expect(spy).not.toHaveBeenCalled();
  });

  it("retries a GLM reply that ran out of tokens while reasoning, with more headroom", async () => {
    const lengthBody = {
      model: "z-ai/glm-5.3-flash",
      choices: [{ finish_reason: "length", message: { content: null, reasoning: "Let me think..." } }],
      usage: { prompt_tokens: 100, completion_tokens: 2304, total_tokens: 2404 },
    };
    const okBody = {
      choices: [{ finish_reason: "stop", message: { content: "Rain hammers the roof." } }],
      usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000 },
    };
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(lengthBody)) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(okBody)) } as Response);

    const result = await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Continue." }],
      config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash" },
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(spy.mock.calls[1][1]?.body as string).max_tokens).toBe(256 + GLM_RETRY_REASONING_RESERVE_TOKENS);
    expect(result.content).toBe("Rain hammers the roof.");
    expect(result.usage).toMatchObject({ promptTokens: 200, completionTokens: 3204, totalTokens: 3404 });
  });

  it("explains the failure when GLM still returns no visible text after the retry", async () => {
    const lengthBody = { choices: [{ finish_reason: "length", message: { content: null } }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(lengthBody)),
    } as Response);

    await expect(
      sendOpenAICompatibleChatCompletion({
        messages: [],
        config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash" },
      }),
    ).rejects.toThrow(/hidden reasoning/);
  });

  it("leaves native DeepSeek OpenAI-format requests unchanged", async () => {
    const spy = mockFetch(200, { choices: [{ finish_reason: "length", message: { content: "Partial" } }] });
    const result = await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "user", content: "Continue." }],
      config: { ...config, baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
      thinking: "disabled",
    });

    expect(spy).toHaveBeenCalledOnce();
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.max_tokens).toBe(256);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning).toBeUndefined();
    expect(result.content).toBe("Partial");
  });

  it("does not modify messages when promptCaching is false or unset", async () => {
    const spy = mockFetch(200, { choices: [{ message: { content: "ok" } }] });
    await sendOpenAICompatibleChatCompletion({
      messages: [{ role: "system", content: "context" }],
      config,
    });
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.messages[0].content).toBe("context");
  });

  it("throttles provider calls by requests per minute", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    } as Response);
    const throttledConfig: ProviderConfig = {
      ...config,
      requestThrottle: { enabled: true, minSecondsBetweenRequests: 0, maxRequestsPerMinute: 1 },
    };

    await sendOpenAICompatibleChatCompletion({ messages: [], config: throttledConfig });
    expect(spy).toHaveBeenCalledTimes(1);

    const second = sendOpenAICompatibleChatCompletion({ messages: [], config: throttledConfig });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(spy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(spy).toHaveBeenCalledTimes(2);
  });
});


it("accounts for each actual retry and its reported usage", async () => {
  const records: ApiCallRecord[] = [];
  const unsubscribe = subscribeApiCalls(record => records.push(record));
  try {
    const fetchMock = mockFetch(200, { choices: [{ finish_reason: "length", message: { content: null } }], usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130, reasoning_tokens: 30, cost: 0.02 } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "A final answer." } }], usage: { prompt_tokens: 55, completion_tokens: 20, total_tokens: 75, reasoning_tokens: 10, cost: 0.01 } })));
    const result = await sendOpenAICompatibleChatCompletion({ config: { ...config, model: "z-ai/glm-5.3-flash", sessionId: "test-adventure" }, messages: [], purpose: "narration" });
    const finished = records.filter(record => record.status !== "started");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.usage).toMatchObject({ completionTokens: 100, reasoningTokens: 40, reportedCostUsd: 0.03 });
    expect(new Set(finished.map(record => record.id)).size).toBe(2);
    expect(finished.map(record => record.usage?.promptTokens)).toEqual([50, 55]);
    expect(finished.every(record => record.purpose === "narration" && record.sessionId === "test-adventure")).toBe(true);
  } finally { unsubscribe(); }
});

it("does not retry recovery even when a reasoning model runs out of output tokens", async () => {
  const fetchMock = mockFetch(200, { choices: [{ finish_reason: "length", message: { content: null } }] });
  await expect(sendOpenAICompatibleChatCompletion({ config: { ...config, model: "z-ai/glm-5.3-flash" }, messages: [], purpose: "memoryRecovery", retry: false })).rejects.toThrow("no content");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


it("records default background usage without requiring a provider total_tokens field", async () => {
  const records: ApiCallRecord[] = [];
  const unsubscribe = subscribeApiCalls(record => records.push(record));
  try {
    mockFetch(200, { choices: [{ message: { content: "Done." } }], usage: { prompt_tokens: 70, completion_tokens: 15 } });
    await sendOpenAICompatibleChatCompletion({ config, messages: [] });
    expect(records.at(-1)).toMatchObject({ purpose: "otherBackground", status: "succeeded",
      usage: { promptTokens: 70, completionTokens: 15, totalTokens: 85 } });
  } finally { unsubscribe(); }
});


it("preserves all Anthropic text blocks and stop reason while excluding reasoning", async () => {
  mockFetch(200, { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "Story." },
    { type: "text", text: '<memory_updates>{"updates":[]}</memory_updates>' }], stop_reason: "max_tokens" });
  const result = await sendOpenAICompatibleChatCompletion({ config: { ...config, baseUrl: "https://api.deepseek.com/anthropic" }, messages: [] });
  expect(result.content).toBe('Story.<memory_updates>{"updates":[]}</memory_updates>');
  expect(result.finishReason).toBe("max_tokens");
});

it("preserves OpenAI text-block content and finish reason", async () => {
  mockFetch(200, { choices: [{ message: { content: [{ type: "text", text: "Story." },
    { type: "text", text: '<memory_updates>{"updates":[]}</memory_updates>' }] }, finish_reason: "stop" }] });
  const result = await sendOpenAICompatibleChatCompletion({ config, messages: [] });
  expect(result.content).toBe('Story.<memory_updates>{"updates":[]}</memory_updates>');
  expect(result.finishReason).toBe("stop");
});

it.each([
  [{ completion_tokens_details: { reasoning_tokens: 7 }, output_tokens_details: { reasoning_tokens: 9 }, reasoning_tokens: 11, cost: 0.004 }, 7, 0.004],
  [{ output_tokens_details: { reasoning_tokens: 9 }, reasoning_tokens: 11 }, 9, undefined],
  [{ reasoning_tokens: 11, cost: 0 }, 11, 0],
  [{ cost: -1 }, undefined, undefined],
  [{}, undefined, undefined],
])("preserves optional standard usage without adding reasoning to completion", async (details, reasoning, cost) => {
  const records: ApiCallRecord[] = []; const unsubscribe = subscribeApiCalls(r => records.push(r));
  try {
    const fetch = mockFetch(200, { choices: [{ message: { content: "Done." } }], usage: { prompt_tokens: 70, completion_tokens: 15, total_tokens: 85, prompt_tokens_details: { cached_tokens: 20 }, ...details } });
    const result = await sendOpenAICompatibleChatCompletion({ config, messages: [], retry: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.usage).toMatchObject({ promptTokens: 70, completionTokens: 15, totalTokens: 85, cacheReadTokens: 20 });
    expect(result.usage?.reasoningTokens).toBe(reasoning); expect(result.usage?.reportedCostUsd).toBe(cost);
    expect(records.at(-1)?.usage?.reasoningTokens).toBe(reasoning); expect(records.at(-1)?.usage?.reportedCostUsd).toBe(cost);
  } finally { unsubscribe(); }
});
it("keeps missing token counts unknown in the normalized response", async () => {
  mockFetch(200, { choices: [{ message: { content: "Done." } }], usage: {} });
  expect((await sendOpenAICompatibleChatCompletion({ config, messages: [] })).usage).toBeUndefined();
});

it("keeps aggregate usage unknown when one retry response has no usage", async () => {
  const fetchMock = mockFetch(200, { choices: [{ finish_reason: "length", message: { content: null } }] });
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Final answer." } }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.01, reasoning_tokens: 4 } })));
  const result = await sendOpenAICompatibleChatCompletion({ config: { ...config, model: "z-ai/glm-5.3-flash" }, messages: [], purpose: "narration" });
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(result.usage).toBeUndefined();
});
