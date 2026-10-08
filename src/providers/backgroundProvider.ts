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
      baseUrl,
      apiKey: bg.apiKey?.trim() ? bg.apiKey : providerConfig.apiKey,
      model: bg.model?.trim() || providerConfig.model,
      promptCaching: baseUrl === providerConfig.baseUrl ? providerConfig.promptCaching : undefined,
    };
  }
  return {
    ...providerConfig,
    model: adventure.semanticEvaluationSettings.evaluationModel || providerConfig.model,
  };
}
