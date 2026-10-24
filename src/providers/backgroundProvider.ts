import type { Adventure, ProviderConfig } from "../types/adventure";

export function isUsableProviderBaseUrl(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function backgroundProviderConfigIssue(adventure: Adventure): string | undefined {
  const bg = adventure.semanticEvaluationSettings.backgroundProviderConfig;
  if (!bg?.baseUrl?.trim()) return undefined;
  return isUsableProviderBaseUrl(bg.baseUrl)
    ? undefined
    : "Memory Suggestions are paused. Correct Background Base URL in the background provider settings to an absolute HTTP(S) URL; no memory request was sent.";
}

export function resolveBackgroundProviderConfig(
  adventure: Adventure,
  providerConfig: ProviderConfig,
): ProviderConfig {
  const bg = adventure.semanticEvaluationSettings.backgroundProviderConfig;
  if (bg?.baseUrl?.trim() && isUsableProviderBaseUrl(bg.baseUrl)) {
    const baseUrl = bg.baseUrl.trim();
    const model = bg.model?.trim() || providerConfig.model;
    return {
      ...providerConfig,
      memoryReasoningControl: bg.memoryReasoningControl ?? (baseUrl === providerConfig.baseUrl.trim() && model === providerConfig.model ? providerConfig.memoryReasoningControl : undefined),
      baseUrl,
      apiKey: bg.apiKey?.trim() ? bg.apiKey : providerConfig.apiKey,
      model,
      promptCaching: baseUrl === providerConfig.baseUrl ? providerConfig.promptCaching : undefined,
    };
  }
  const model = bg?.model?.trim() || adventure.semanticEvaluationSettings.evaluationModel || providerConfig.model;
  return {
    ...providerConfig,
    memoryReasoningControl: bg?.memoryReasoningControl ?? (model === providerConfig.model ? providerConfig.memoryReasoningControl : undefined),
    model,
  };
}

/** Memory evaluation must never silently replace an invalid configured endpoint. */
export function resolveMemoryEvaluationProviderConfig(adventure: Adventure, active: ProviderConfig): ProviderConfig {
  if (backgroundProviderConfigIssue(adventure)) throw new MemoryEvaluationError("configuration", "memory_background_base_url_invalid", backgroundProviderConfigIssue(adventure)!);
  const config = resolveBackgroundProviderConfig(adventure, active);
  if (!isUsableProviderBaseUrl(config.baseUrl)) throw new MemoryEvaluationError("configuration", "memory_provider_base_url_invalid", "Memory Suggestions are paused. Correct the active provider Base URL to an absolute HTTP(S) URL; no memory request was sent.");
  if (!config.model?.trim()) throw new MemoryEvaluationError("configuration", "memory_provider_model_missing",
    "Memory Suggestions are paused. Set a background evaluator Model or an active provider Model; no memory request was sent.");
  return config;
}

export class MemoryEvaluationError extends Error {
  constructor(readonly category: "configuration" | "transport_api" | "invalid_model_output", readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

/** Never copy arbitrary provider exceptions (which may include credentials) into saves. */
export function safeMemoryFailure(error: unknown, received = false): MemoryEvaluationError {
  if (error instanceof MemoryEvaluationError) return error;
  return received
    ? new MemoryEvaluationError("invalid_model_output", "memory_model_output_invalid", "The evaluator returned invalid output; review the memory diagnostics and retry selected sources.")
    : new MemoryEvaluationError("transport_api", "memory_provider_request_failed", "The memory provider request failed; check provider access, credentials, and availability, then retry selected sources.");
}
