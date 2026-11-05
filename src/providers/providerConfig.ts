import type { ChatMessage, ProviderConfig } from "../types/adventure";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";

export const LOCAL_CONTEXT_MARGIN = 512;
export const localProviderDefaults = {
  connectionType: "local", localRuntime: "llamaCpp", authMode: "none",
  name: "Local llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", model: "aist-qwen",
  apiKey: "", contextWindowTokens: 8192, requestTimeoutMs: 600_000,
  promptCaching: false, openRouterProviderSort: undefined,
  memoryReasoningControl: "auto",
} as const;

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname.toLowerCase())
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function providerApiBase(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses)$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function providerTimeoutMs(config: ProviderConfig): number {
  const timeout = config.requestTimeoutMs ?? (config.connectionType === "local" ? 600_000 : 180_000);
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 3_600_000) {
    throw new Error("Set the request timeout between 1 and 3600 seconds.");
  }
  return timeout;
}

export function validateProviderConfig(config: ProviderConfig, requireModel = true): void {
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new Error("Set an absolute HTTP(S) provider Base URL."); }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Use an HTTP(S) Base URL.");
  }
  if (config.connectionType === "local" && !isLoopbackUrl(config.baseUrl)) {
    throw new Error("Local models must use 127.0.0.1, localhost, or [::1]. Network addresses are not allowed.");
  }
  if ((config.authMode ?? (config.connectionType === "local" ? "none" : "apiKey")) === "apiKey" && !config.apiKey?.trim()) {
    throw new Error("Missing API key. Add one in Settings before generating.");
  }
  if (requireModel && !config.model.trim()) throw new Error("Set a provider Model in Settings.");
  providerTimeoutMs(config);
  if (requireModel && config.connectionType === "local") localPromptBudget(config);
}

export function providerAuthHeaders(config: ProviderConfig): Record<string, string> {
  const auth = config.authMode ?? (config.connectionType === "local" ? "none" : "apiKey");
  return auth === "apiKey" && config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {};
}

/** The existing adventure budget counts prompt tokens, excluding generated output. */
export function localPromptBudget(config: ProviderConfig): number {
  const capacity = config.contextWindowTokens ?? 8192;
  if (!Number.isInteger(capacity) || capacity < 1024 || !Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 1) {
    throw new Error("Set a valid local context capacity (at least 1024 tokens) and positive output limit.");
  }
  const available = capacity - config.maxOutputTokens - LOCAL_CONTEXT_MARGIN;
  if (available < 256) throw new Error("Local context capacity must leave at least 256 prompt tokens after output and the 512-token safety margin.");
  return available;
}

export function assertLocalRequestFits(config: ProviderConfig, messages: ChatMessage[]): void {
  if (config.connectionType !== "local") return;
  const estimated = messages.reduce((sum, message) => sum + approximateTokenCount(message.content) + 8, 0);
  if (estimated > localPromptBudget(config)) {
    throw new Error("Local request exceeds the configured context capacity. Reduce context/output or increase the server and preset context capacity together. No request was sent.");
  }
}

export function sameProviderEndpoint(a: string, b: string): boolean {
  try { return providerApiBase(new URL(a).toString()) === providerApiBase(new URL(b).toString()); }
  catch { return false; }
}
