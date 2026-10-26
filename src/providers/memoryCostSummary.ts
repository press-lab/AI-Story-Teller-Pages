import type { ApiCallRecord } from "../types/adventure";
/** Tariffs are separate from accounting. Callers must supply verified model-specific rates, never defaults. */
export interface VerifiedTariff {
  model: string;
  provider: string;
  source: string;
  verifiedAt: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion?: number;
}
export function summarizeMemoryCosts(records: ApiCallRecord[], rates: VerifiedTariff[] = []) {
  const calls = [...new Map(records.map(r => [r.id, r])).values()];
  const counts = { narration: 0, corrections: 0, continuity: 0, singlePass: 0, legacy: 0, other: 0 };
  let input = 0, cached = 0, output = 0, unknownUsage = 0, unpriced = 0, estimatedCost = 0;
  let cachedKnown = 0;
  let reasoning = 0, reasoningKnown = 0, visibleOutput = 0, visibleOutputKnown = 0, reportedCost = 0, reportedCostKnown = 0;
  for (const c of calls) {
    const stage = c.purpose === "continuityCheck" ? "continuity" : c.purpose === "narration" ? "narration" : c.purpose === "correction" ? "corrections"
      : c.memoryRequest?.stage === "singlePass" ? "singlePass" : c.purpose === "memoryEvaluation" || c.purpose === "memoryRecovery" ? "legacy" : "other";
    counts[stage]++;
    const metrics = c.usage ?? c.partialUsage;
    if (metrics?.cacheReadTokens !== undefined) cachedKnown++;
    if (metrics?.reasoningTokens !== undefined) {
      reasoning += metrics.reasoningTokens; reasoningKnown++;
      const completion = c.usage?.completionTokens ?? c.partialUsage?.outputTokens;
      if (completion !== undefined && completion >= metrics.reasoningTokens) { visibleOutput += completion - metrics.reasoningTokens; visibleOutputKnown++; }
    }
    if (metrics?.reportedCostUsd !== undefined) { reportedCost += metrics.reportedCostUsd; reportedCostKnown++; }
    if (!c.usage) { unknownUsage++; input += c.partialUsage?.inputTokens ?? 0; output += c.partialUsage?.outputTokens ?? 0; continue; }
    const u = c.usage;
    input += u.promptTokens; cached += u.cacheReadTokens ?? 0; output += u.completionTokens;
    const rate = rates.find(r => r.model === (c.responseModel ?? c.model) && r.provider === c.provider && r.source && r.verifiedAt && [r.inputPerMillion, r.cachedInputPerMillion, r.outputPerMillion].every(n => Number.isFinite(n) && n >= 0));
    if (!rate || u.cacheReadTokens === undefined || (u.cacheCreationTokens && rate.cacheWritePerMillion === undefined)) { unpriced++; continue; }
    const write = u.cacheCreationTokens ?? 0;
    estimatedCost += ((c.api === "anthropicMessages" ? u.promptTokens : Math.max(0, u.promptTokens - u.cacheReadTokens - write)) * rate.inputPerMillion
      + u.cacheReadTokens * rate.cachedInputPerMillion + write * (rate.cacheWritePerMillion ?? 0) + u.completionTokens * rate.outputPerMillion) / 1e6;
  }
  return { reasoning: reasoningKnown === calls.length && calls.length ? reasoning : undefined, reasoningKnown,
    visibleOutput: visibleOutputKnown === calls.length && calls.length ? visibleOutput : undefined, visibleOutputKnown,
    reportedCost: reportedCostKnown === calls.length && calls.length ? reportedCost : undefined, reportedCostKnown,
    cachedKnown, counts, input, cached, output, unknownUsage, unpriced, estimatedCost, priced: calls.filter(c => c.usage).length - unpriced, requests: calls.length };
}
