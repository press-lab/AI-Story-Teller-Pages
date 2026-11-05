import type { ProviderConfig } from "../types/adventure";
import { MEMORY_OUTPUT_RESERVE } from "../memory/onePassMemory";

/** Shared by narration context budgeting and the request sent to the model. */
export function applyResponseLengthHint<T extends ProviderConfig>(config: T, hint: number, hiddenReserveTokens = 0): T {
  const wordTarget = Number.isFinite(hint) ? Math.max(50, Math.min(500, Math.round(hint))) : 250;
  const visibleTokenCap = Math.ceil(wordTarget * 1.5) + 80;
  const hiddenReserve = Math.max(0, Math.min(MEMORY_OUTPUT_RESERVE, Math.ceil(hiddenReserveTokens)));
  const lengthBoundedCap = visibleTokenCap + hiddenReserve;
  const configuredCap = Number.isFinite(config.maxOutputTokens) && config.maxOutputTokens > 0
    ? config.maxOutputTokens
    : lengthBoundedCap;
  return { ...config, maxOutputTokens: Math.min(configuredCap, lengthBoundedCap) };
}
