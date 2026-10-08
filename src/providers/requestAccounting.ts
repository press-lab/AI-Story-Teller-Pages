import type { ChatMessage, ProviderConfig, ProviderRequestRecord, ProviderUsage } from "../types/adventure";
import { approximateTokenCount as estimateTokens } from "../tokenizer/approximateTokenCount";
import { createId, nowIso } from "../utils/id";

const listeners = new Set<(record: ProviderRequestRecord) => void>();
export function subscribeProviderRequests(listener: (record: ProviderRequestRecord) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One completion per HTTP attempt, before retry/correction usage aggregation. */
export function beginProviderRequest(config: ProviderConfig, messages: ChatMessage[]) {
  const id = createId("request"), startedAt = nowIso();
  let finished = false;
  return (success: boolean, content = "", usage?: ProviderUsage, reportedCost?: number) => {
    if (finished || !config.requestContext) return;
    finished = true;
    const prices = config.pricing;
    const validPrices = prices && Number.isFinite(prices.inputPerMillionUSD) && prices.inputPerMillionUSD >= 0 && Number.isFinite(prices.outputPerMillionUSD) && prices.outputPerMillionUSD >= 0;
    // Cached token prices differ by provider. Do not pretend the ordinary rate applies.
    const costUSD = Number.isFinite(reportedCost) && reportedCost! >= 0 ? reportedCost : usage && validPrices && !usage.cacheReadTokens && !usage.cacheCreationTokens
      ? (usage.promptTokens * prices.inputPerMillionUSD + usage.completionTokens * prices.outputPerMillionUSD) / 1_000_000 : undefined;
    const hidden = content.match(/<memory_updates\b[^>]*>([\s\S]*?)(?:<\/memory_updates>|$)/i)?.[1]
      ?? (["compactMemoryFallback", "fullMemoryFallback"].includes(config.requestContext.purpose) ? content : "");
    const record: ProviderRequestRecord = { id, ...config.requestContext, model: config.model, startedAt, success, usage,
      inputTokensEstimate: messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
      outputTokensEstimate: estimateTokens(content), structuredOutputTokensEstimate: estimateTokens(hidden), costUSD };
    if (record.purpose === "continuity") record.continuityCorrected = success && !!content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() && content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() !== "null";
    listeners.forEach(listener => listener(record));
  };
}
