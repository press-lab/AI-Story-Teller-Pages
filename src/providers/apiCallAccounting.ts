import type { ApiCallPurpose, ApiCallRecord, ProviderConfig, ProviderUsage } from "../types/adventure";
import { createId, nowIso } from "../utils/id";

const listeners = new Set<(record: ApiCallRecord) => void>();
export function subscribeApiCalls(listener: (record: ApiCallRecord) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(record: ApiCallRecord) {
  for (const listener of listeners) listener(record);
}

/** One record per actual HTTP attempt, including retries, HTTP errors and network failures.
 * No prompts, credentials, response bodies, or estimated usage are stored here. */
export async function fetchWithAccounting(url: string, init: RequestInit, config: ProviderConfig, purpose: ApiCallPurpose) {
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(typeof init.body === "string" ? init.body : "{}"); } catch { /* No private request data is logged. */ }
  const requestMessages = (body.messages ?? body.input) as Array<{ content?: unknown }> | undefined;
  const memoryInstructionPresent = Boolean(requestMessages?.some(message => JSON.stringify(message.content ?? "").includes("[ONE-PASS MEMORY]"))
    || JSON.stringify(body.system ?? "").includes("[ONE-PASS MEMORY]"));
  let provider: string | undefined;
  try { provider = new URL(url).hostname; } catch { /* No URL or credentials are logged. */ }
  const record: ApiCallRecord = { provider, outputTokenLimit: Number(body.max_tokens ?? body.max_output_tokens) || undefined,
    memoryInstructionPresent, id: createId("api"), sessionId: config.sessionId,
    purpose, model: config.model, startedAt: nowIso(), status: "started" };
  publish(record);
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let usage: ProviderUsage | undefined;
    let finishReason: string | undefined;
    let responseModel: string | undefined;
    let memoryEnvelope: ApiCallRecord["memoryEnvelope"];
    try {
      const responseBody = JSON.parse(text);
      const finish = responseBody.choices?.[0]?.finish_reason ?? responseBody.stop_reason ?? responseBody.status;
      finishReason = typeof finish === "string" ? finish.slice(0, 64) : undefined;
      responseModel = typeof responseBody.model === "string" ? responseBody.model.slice(0, 120) : undefined;
      if (memoryInstructionPresent && (purpose === "narration" || purpose === "correction")) {
        const content = responseBody.choices?.[0]?.message?.content ?? responseBody.content?.filter((block: { type: string }) => block.type === "text").map((block: { text: string }) => block.text).join("") ?? "";
        const visible = typeof content === "string" ? content : JSON.stringify(content);
        memoryEnvelope = !visible.includes("<memory_updates") ? "missing" : visible.includes("</memory_updates>") ? "present" : "incomplete";
      }
      const raw = responseBody.usage;
      if (raw) usage = {
        promptTokens: raw.prompt_tokens ?? raw.input_tokens ?? 0,
        completionTokens: raw.completion_tokens ?? raw.output_tokens ?? 0,
        totalTokens: raw.total_tokens ?? ((raw.prompt_tokens ?? raw.input_tokens ?? 0) + (raw.completion_tokens ?? raw.output_tokens ?? 0)),
        cacheReadTokens: raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens,
        cacheCreationTokens: raw.cache_creation_input_tokens ?? raw.prompt_tokens_details?.cache_write_tokens,
      };
    } catch { /* Missing usage stays unknown; it is never estimated as zero consumption. */ }
    publish({ ...record, status: response.ok ? "succeeded" : "failed", usage, finishReason, responseModel, memoryEnvelope });
    return { ok: response.ok, status: response.status, text: async () => text };
  } catch (error) {
    publish({ ...record, status: "failed" });
    throw error;
  }
}
