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
  const record: ApiCallRecord = { id: createId("api"), sessionId: config.sessionId,
    purpose, model: config.model, startedAt: nowIso(), status: "started" };
  publish(record);
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let usage: ProviderUsage | undefined;
    try {
      const raw = JSON.parse(text).usage;
      if (raw) usage = {
        promptTokens: raw.prompt_tokens ?? raw.input_tokens ?? 0,
        completionTokens: raw.completion_tokens ?? raw.output_tokens ?? 0,
        totalTokens: raw.total_tokens ?? ((raw.prompt_tokens ?? raw.input_tokens ?? 0) + (raw.completion_tokens ?? raw.output_tokens ?? 0)),
        cacheReadTokens: raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens,
        cacheCreationTokens: raw.cache_creation_input_tokens ?? raw.prompt_tokens_details?.cache_write_tokens,
      };
    } catch { /* Missing usage stays unknown; it is never estimated as zero consumption. */ }
    publish({ ...record, status: response.ok ? "succeeded" : "failed", usage });
    return { ok: response.ok, status: response.status, text: async () => text };
  } catch (error) {
    publish({ ...record, status: "failed" });
    throw error;
  }
}
