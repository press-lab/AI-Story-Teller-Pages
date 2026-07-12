import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
