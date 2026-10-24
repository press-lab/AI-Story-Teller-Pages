import { fetchWithAccounting } from "./apiCallAccounting";
import { waitForProviderThrottle, type ProviderResponse, type SendChatCompletionOptions } from "./openAICompatible";

/** Transport schema only. Existing memory validators still decide evidence, targets and approval. */
export const MEMORY_RESPONSE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["turns"],
  properties: { turns: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["sourceTurnId", "updates"],
    properties: {
      sourceTurnId: { type: "string" },
      updates: { type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["kind", "target", "targetId", "cardType", "operation", "content", "evidence", "reason", "triggers", "participants", "sourceMessageIds", "eventDate"],
        properties: {
          kind: { type: "string", enum: ["lore", "card", "newCard", "thought"] },
          target: { type: "string" }, targetId: { type: ["string", "null"] },
          cardType: { type: "string", enum: ["lore", "character", "location", "custom"] },
          operation: { type: "string", enum: ["create", "update"] },
          content: { type: "string" }, evidence: { type: "string" }, reason: { type: "string" },
          triggers: { type: "array", items: { type: "string" } },
          participants: { type: "array", items: { type: "string" } },
          sourceMessageIds: { type: "array", items: { type: "string" } },
          eventDate: { type: ["string", "null"], description: "Grounded in-world ISO date, or null when unknown. Never a save timestamp." },
        },
      } },
    },
  } } },
};

interface ResponsesBody {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{ type: string; role?: string; content?: Array<{ type: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

export class MemoryResponseError extends Error {
  constructor(readonly classification: string, readonly finishReason?: string,
    readonly usage?: ProviderResponse["usage"]) { super(classification); }
}

/** One HTTP attempt; no tools, persisted conversations, narration settings or automatic retries. */
export async function sendOpenAIMemoryResponse(options: SendChatCompletionOptions): Promise<ProviderResponse> {
  const { config, messages, signal } = options;
  if (!config.apiKey?.trim()) throw new MemoryResponseError("provider_api_key_missing");
  let endpoint: URL;
  try {
    const base = config.baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
    endpoint = new URL(base.endsWith("/responses") ? base : base.endsWith("/v1") ? base + "/responses" : base + "/v1/responses");
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.pathname.includes("/anthropic")) throw new Error();
  } catch { throw new MemoryResponseError("responses_provider_configuration_invalid"); }
  await waitForProviderThrottle(config, signal);
  let response;
  try {
    response = await fetchWithAccounting(endpoint.toString(), {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: messages, store: false,
        reasoning: { effort: "medium" }, max_output_tokens: config.maxOutputTokens + 2048,
        text: { format: { type: "json_schema", name: "memory_evaluation", strict: true, schema: MEMORY_RESPONSE_SCHEMA } },
      }),
    }, config, options.purpose ?? "memoryRecovery");
  } catch { throw new MemoryResponseError("provider_request_failed_network"); }
  if (!response.ok) throw new MemoryResponseError(`provider_request_failed_http_${response.status}`);
  let raw: ResponsesBody;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    raw = parsed as ResponsesBody;
  }
  catch { throw new MemoryResponseError("provider_invalid_json"); }
  const usage = raw.usage ? { promptTokens: raw.usage.input_tokens ?? 0, completionTokens: raw.usage.output_tokens ?? 0,
    totalTokens: raw.usage.total_tokens ?? (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
    cacheReadTokens: raw.usage.input_tokens_details?.cached_tokens } : undefined;
  if (typeof raw.status !== "string") throw new MemoryResponseError("provider_response_schema_invalid", undefined, usage);
  if (raw.status !== "completed") throw new MemoryResponseError("provider_response_incomplete", raw.incomplete_details?.reason ?? raw.status, usage);
  if (!Array.isArray(raw.output)) throw new MemoryResponseError("provider_response_schema_invalid", undefined, usage);
  const content: string[] = [];
  for (const item of raw.output ?? []) {
    if (item.type !== "message" || item.role !== "assistant") continue;
    if (!Array.isArray(item.content)) throw new MemoryResponseError("provider_response_schema_invalid", undefined, usage);
    for (const block of item.content) {
      if (block.type === "refusal") throw new MemoryResponseError("provider_refused", undefined, usage);
      if (block.type === "output_text" && typeof block.text === "string") content.push(block.text);
    }
  }
  if (!content.length) throw new MemoryResponseError("provider_empty_response", undefined, usage);
  return { content: content.join(""), raw, usage, finishReason: raw.status };
}
