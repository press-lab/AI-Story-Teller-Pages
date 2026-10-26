import type { GenerationMetadata, ProviderConfig } from "../types/adventure";

/** Persist only the hostname and API format, never URL credentials, paths or query strings. */
export function generationMetadata(endpoint: string, config: Pick<ProviderConfig, "model">, raw?: unknown): GenerationMetadata {
  let provider: string | undefined;
  let api: GenerationMetadata["api"];
  try {
    const url = new URL(endpoint);
    provider = url.hostname;
    if (url.pathname.endsWith("/chat/completions")) api = "chatCompletions";
    else if (url.pathname.endsWith("/messages")) api = "anthropicMessages";
    else if (url.pathname.endsWith("/responses")) api = "responses";
  } catch { /* Invalid endpoints have no provider identity. */ }
  const model = raw && typeof raw === "object" && "model" in raw ? raw.model : undefined;
  return { provider, api, model: config.model,
    ...(typeof model === "string" && model.trim() ? { responseModel: model.slice(0, 120) } : {}) };
}
