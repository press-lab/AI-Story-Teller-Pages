import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNativeDeepSeekProvider,
  providerRouteLabel,
  structuredOutputMode,
  resetProviderThrottleForTests,
  sendOpenAICompatibleChatCompletion,
} from "./openAICompatible";
import { subscribeProviderUsage, type ProviderUsageEvent } from "./usage";
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
  it.each([undefined, "disabled"] as const)("uses supported OpenRouter GLM reasoning for %s", async (thinking) => {
    const spy = mockFetch(200, { choices: [{ message: { content: "A story." } }] });
    await sendOpenAICompatibleChatCompletion({ messages: [], config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash", maxOutputTokens: 24000 }, thinking });
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.reasoning).toEqual({ effort: thinking === "disabled" ? "low" : "high" });
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(24000);
  });

  it.each([null, "", "   "])("reports exhausted reasoning budget for empty content %s", async (content) => {
    const spy = mockFetch(200, { choices: [{ finish_reason: "length", message: { content } }], usage: { completion_tokens: 455, completion_tokens_details: { reasoning_tokens: 455 } } });
    await expect(sendOpenAICompatibleChatCompletion({ messages: [], config })).rejects.toThrow("finish reason: length; output tokens: 455; reasoning tokens: 455");
    expect(spy).toHaveBeenCalledOnce();
  });

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

  it("reads DeepSeek prompt_cache_hit_tokens as cache reads", async () => {
    mockFetch(200, {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 },
    });
    const result = await sendOpenAICompatibleChatCompletion({ messages: [{ role: "user", content: "Hi" }], config: { ...config, baseUrl: "https://api.deepseek.com" } });
    expect(result.usage?.cacheReadTokens).toBe(64);
  });

  it("reports every billed response to usage listeners, including ones with no usable content", async () => {
    const events: ProviderUsageEvent[] = [];
    const unsubscribe = subscribeProviderUsage((event) => events.push(event));
    try {
      mockFetch(200, { choices: [{ message: {} }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } });
      await expect(sendOpenAICompatibleChatCompletion({
        messages: [{ role: "user", content: "Hi" }],
        config: { ...config, sessionId: "ai-story-teller:adv-test" },
      })).rejects.toThrow("no content");
      expect(events).toEqual([{ sessionId: "ai-story-teller:adv-test", usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } }]);
    } finally {
      unsubscribe();
    }
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
    // Anthropic input_tokens exclude cache reads/writes; promptTokens is normalized to all input tokens.
    expect(result.usage).toEqual({
      promptTokens: 200,
      completionTokens: 20,
      totalTokens: 220,
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

describe("finish reason, reasoning tokens, and structured-output capability", () => {
  it("reports OpenAI-format finish reason and reasoning tokens billed inside the ceiling", async () => {
    mockFetch(200, { choices: [{ finish_reason: "length", message: { content: '{"updates":[' } }], usage: { prompt_tokens: 9000, completion_tokens: 2000, completion_tokens_details: { reasoning_tokens: 1800 } } });
    const response = await sendOpenAICompatibleChatCompletion({ messages: [], config: { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3" } });
    expect(response).toMatchObject({ finishReason: "length", reasoningTokens: 1800 });
  });

  it("normalizes an Anthropic-format max_tokens stop to length, so truncation is detected on that route too", async () => {
    mockFetch(200, { content: [{ type: "text", text: '{"updates":[' }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 2000 } });
    const response = await sendOpenAICompatibleChatCompletion({ messages: [], config: { ...config, baseUrl: "https://api.deepseek.com/anthropic" } });
    expect(response.finishReason).toBe("length");
  });

  it("never sends response_format to an Anthropic-format endpoint, and labels it prompt-only", async () => {
    const spy = mockFetch(200, { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" });
    await sendOpenAICompatibleChatCompletion({ messages: [], config: { ...config, baseUrl: "https://api.deepseek.com/anthropic" }, responseFormat: "json_object" });
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string).response_format).toBeUndefined();
    expect(structuredOutputMode({ baseUrl: "https://api.deepseek.com/anthropic" })).toBe("prompt_only");
    expect(structuredOutputMode({ baseUrl: "https://openrouter.ai/api/v1" })).toBe("json_object");
    expect(providerRouteLabel({ baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-flash" })).toBe("api.deepseek.com (Anthropic format) · deepseek-flash");
  });
});
