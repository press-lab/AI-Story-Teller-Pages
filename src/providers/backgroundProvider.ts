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
    : `Background provider Base URL is invalid: "${bg.baseUrl}". Background AI tasks are using the active provider instead.`;
}

export function resolveBackgroundProviderConfig(
  adventure: Adventure,
  providerConfig: ProviderConfig,
): ProviderConfig {
  const bg = adventure.semanticEvaluationSettings.backgroundProviderConfig;
  if (bg?.baseUrl?.trim() && isUsableProviderBaseUrl(bg.baseUrl)) {
    const baseUrl = bg.baseUrl.trim();
    return {
      ...providerConfig,
      memoryReasoningControl: bg.memoryReasoningControl ?? (baseUrl === providerConfig.baseUrl.trim() ? providerConfig.memoryReasoningControl : undefined),
      baseUrl,
      apiKey: bg.apiKey?.trim() ? bg.apiKey : providerConfig.apiKey,
      model: bg.model?.trim() || providerConfig.model,
      promptCaching: baseUrl === providerConfig.baseUrl ? providerConfig.promptCaching : undefined,
    };
  }
  return {
    ...providerConfig,
    memoryReasoningControl: bg?.memoryReasoningControl ?? providerConfig.memoryReasoningControl,
    model: bg?.model?.trim() || adventure.semanticEvaluationSettings.evaluationModel || providerConfig.model,
  };
}

/** Memory evaluation must never silently replace an invalid configured endpoint. */
export function resolveMemoryEvaluationProviderConfig(adventure: Adventure, active: ProviderConfig): ProviderConfig {
  if (backgroundProviderConfigIssue(adventure)) throw new Error("memory_background_base_url_invalid: Background Base URL must be an absolute HTTP(S) URL; evaluation was not sent.");
  const config = resolveBackgroundProviderConfig(adventure, active);
  if (!isUsableProviderBaseUrl(config.baseUrl)) throw new Error("memory_provider_base_url_invalid: Evaluator Base URL must be an absolute HTTP(S) URL; evaluation was not sent.");
  return config;
}
