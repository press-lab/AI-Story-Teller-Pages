import type { ChatMessage, ProviderConfig, ProviderRequestThrottle, ProviderUsage } from "../types/adventure";

type CacheBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type CacheableContent = string | CacheBlock[];
type CacheableMessage = { role: string; content: CacheableContent };
type OpenRouterProviderPreferences = { sort?: "price" | "throughput" | "latency" };

/** Mark the last system message with an ephemeral cache breakpoint so stable context is reused. */
function applyPromptCaching(messages: ChatMessage[]): CacheableMessage[] {
  let lastSystemIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "system") { lastSystemIdx = i; break; }
  }
  return messages.map((msg, i) =>
    i === lastSystemIdx
      ? { role: msg.role, content: [{ type: "text" as const, text: msg.content, cache_control: { type: "ephemeral" as const } }] }
      : msg,
  );
}

export interface SendChatCompletionOptions {
  messages: ChatMessage[];
  config: ProviderConfig;
  signal?: AbortSignal;
  responseFormat?: "json_object";
  thinking?: "enabled" | "disabled";
}

export interface ProviderResponse {
  content: string;
  raw: unknown;
  usage?: ProviderUsage;
}

let throttleQueue: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;
let recentRequestStarts: number[] = [];

function isAnthropicFormat(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).pathname.includes("/anthropic");
  } catch {
    return baseUrl.includes("/anthropic");
  }
}

function openAIEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function isOpenRouterProvider(config: Pick<ProviderConfig, "baseUrl">): boolean {
  try {
    const hostname = new URL(config.baseUrl).hostname.toLowerCase();
    return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
  } catch {
    return config.baseUrl.toLowerCase().includes("openrouter.ai");
  }
}

function openRouterSessionId(config: ProviderConfig): string | undefined {
  if (!config.promptCaching || !config.sessionId || !isOpenRouterProvider(config)) return undefined;
  return config.sessionId.slice(0, 256);
}

function openRouterProviderPreferences(config: ProviderConfig): OpenRouterProviderPreferences | undefined {
  if (!isOpenRouterProvider(config) || !config.openRouterProviderSort) return undefined;
  return { sort: config.openRouterProviderSort };
}

function shouldApplyOpenAIMessageCacheControl(config: ProviderConfig): boolean {
  return Boolean(config.promptCaching && isOpenRouterProvider(config));
}

function anthropicEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function completionEndpoint(baseUrl: string): string {
  return isAnthropicFormat(baseUrl) ? anthropicEndpoint(baseUrl) : openAIEndpoint(baseUrl);
}

function normalizedThrottle(config: ProviderConfig): ProviderRequestThrottle {
  return {
    enabled: config.requestThrottle?.enabled ?? false,
    minSecondsBetweenRequests: Math.max(0, config.requestThrottle?.minSecondsBetweenRequests ?? 0),
    maxRequestsPerMinute: Math.max(0, Math.floor(config.requestThrottle?.maxRequestsPerMinute ?? 0)),
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Provider request was aborted."));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Provider request was aborted."));
      },
      { once: true },
    );
  });
}

async function waitForProviderThrottle(config: ProviderConfig, signal?: AbortSignal): Promise<void> {
  const throttle = normalizedThrottle(config);
  if (!throttle.enabled) return;

  const run = throttleQueue.then(async () => {
    const now = Date.now();
    let waitMs = 0;
    const minIntervalMs = throttle.minSecondsBetweenRequests * 1000;
    if (minIntervalMs > 0 && lastRequestStartedAt > 0) {
      waitMs = Math.max(waitMs, lastRequestStartedAt + minIntervalMs - now);
    }
    if (throttle.maxRequestsPerMinute > 0) {
      recentRequestStarts = recentRequestStarts.filter((startedAt) => now - startedAt < 60_000);
      if (recentRequestStarts.length >= throttle.maxRequestsPerMinute) {
        waitMs = Math.max(waitMs, recentRequestStarts[0] + 60_000 - now);
      }
    }

    await wait(waitMs, signal);
    const startedAt = Date.now();
    lastRequestStartedAt = startedAt;
    recentRequestStarts = [...recentRequestStarts.filter((timestamp) => startedAt - timestamp < 60_000), startedAt];
  });

  throttleQueue = run.catch(() => undefined);
  await run;
}

export function resetProviderThrottleForTests(): void {
  throttleQueue = Promise.resolve();
  lastRequestStartedAt = 0;
  recentRequestStarts = [];
}

async function sendOpenAIRequest(
  endpoint: string,
  messages: ChatMessage[],
  config: ProviderConfig,
  signal?: AbortSignal,
  responseFormat?: SendChatCompletionOptions["responseFormat"],
  thinking?: SendChatCompletionOptions["thinking"],
): Promise<ProviderResponse> {
  const outMessages = shouldApplyOpenAIMessageCacheControl(config) ? applyPromptCaching(messages) : messages;
  const sessionId = openRouterSessionId(config);
  const provider = openRouterProviderPreferences(config);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: outMessages,
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        ...(config.topP !== undefined ? { top_p: config.topP } : {}),
        ...(config.topK !== undefined && config.topK > 0 ? { top_k: config.topK } : {}),
        ...(config.presencePenalty !== undefined ? { presence_penalty: config.presencePenalty } : {}),
        ...(config.frequencyPenalty !== undefined ? { frequency_penalty: config.frequencyPenalty } : {}),
        ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
        ...(thinking ? { thinking: { type: thinking } } : {}),
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(provider ? { provider } : {}),
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error (${endpoint}): ${msg}. If using a local server, check CORS headers and that the server is reachable.`);
  }

  const rawText = await response.text().catch(() => "");
  let raw: { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } } };
  try {
    raw = JSON.parse(rawText) as typeof raw;
  } catch {
    raw = {};
  }

  if (!response.ok) {
    const detail = raw.error?.message ?? rawText.slice(0, 300) ?? `HTTP ${response.status}`;
    throw new Error(`Provider error ${response.status} (${endpoint}): ${detail}`);
  }

  const content = raw.choices?.[0]?.message?.content;
  if (content == null) throw new Error(`Provider returned no content. Body: ${rawText.slice(0, 300)}`);

  const usage: ProviderUsage | undefined = raw.usage
    ? {
        promptTokens: raw.usage.prompt_tokens ?? 0,
        completionTokens: raw.usage.completion_tokens ?? 0,
        totalTokens: raw.usage.total_tokens ?? 0,
        cacheReadTokens: raw.usage.cache_read_input_tokens ?? raw.usage.prompt_tokens_details?.cached_tokens,
        cacheCreationTokens: raw.usage.cache_creation_input_tokens ?? raw.usage.prompt_tokens_details?.cache_write_tokens,
      }
    : undefined;

  return { content, raw, usage };
}

async function sendAnthropicRequest(
  endpoint: string,
  messages: ChatMessage[],
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<ProviderResponse> {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const chatMessages = messages.filter((m) => m.role !== "system");
  const systemText = systemParts.join("\n\n");
  const systemParam = systemParts.length === 0
    ? undefined
    : config.promptCaching
      ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
      : systemText;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "anthropic-version": "2023-06-01",
        ...(config.promptCaching ? { "anthropic-beta": "prompt-caching-2024-07-31" } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        ...(systemParam !== undefined ? { system: systemParam } : {}),
        messages: chatMessages,
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        // Anthropic supports top_p / top_k but NOT presence/frequency penalties.
        ...(config.topP !== undefined ? { top_p: config.topP } : {}),
        ...(config.topK !== undefined && config.topK > 0 ? { top_k: config.topK } : {}),
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error (${endpoint}): ${msg}.`);
  }

  const rawText = await response.text().catch(() => "");
  let raw: { error?: { message?: string }; content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
  try {
    raw = JSON.parse(rawText) as typeof raw;
  } catch {
    raw = {};
  }

  if (!response.ok) {
    const detail = raw.error?.message ?? rawText.slice(0, 300) ?? `HTTP ${response.status}`;
    throw new Error(`Provider error ${response.status} (${endpoint}): ${detail}`);
  }

  const content = raw.content?.find((c) => c.type === "text")?.text;
  if (content == null) throw new Error(`Provider returned no content. Body: ${rawText.slice(0, 300)}`);

  const usage: ProviderUsage | undefined = raw.usage
    ? {
        promptTokens: raw.usage.input_tokens ?? 0,
        completionTokens: raw.usage.output_tokens ?? 0,
        totalTokens: (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
        cacheReadTokens: raw.usage.cache_read_input_tokens,
        cacheCreationTokens: raw.usage.cache_creation_input_tokens,
      }
    : undefined;

  return { content, raw, usage };
}

export async function sendOpenAICompatibleChatCompletion({
  messages,
  config,
  signal,
  responseFormat,
  thinking,
}: SendChatCompletionOptions): Promise<ProviderResponse> {
  if (!config.apiKey?.trim()) {
    throw new Error("Missing API key. Add one in Settings before generating.");
  }

  await waitForProviderThrottle(config, signal);

  const endpoint = completionEndpoint(config.baseUrl);
  if (isAnthropicFormat(config.baseUrl)) {
    return sendAnthropicRequest(endpoint, messages, config, signal);
  }
  return sendOpenAIRequest(endpoint, messages, config, signal, responseFormat, thinking);
}

export function isNativeDeepSeekProvider(config: Pick<ProviderConfig, "baseUrl">): boolean {
  try {
    const hostname = new URL(config.baseUrl).hostname.toLowerCase();
    return hostname === "deepseek.com" || hostname.endsWith(".deepseek.com");
  } catch {
    return config.baseUrl.toLowerCase().includes("deepseek.com");
  }
}
