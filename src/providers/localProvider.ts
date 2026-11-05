import type { ProviderConfig } from "../types/adventure";
import { readProviderResponse, ProviderRequestTimeoutError } from "./apiCallAccounting";
import { providerApiBase, providerAuthHeaders, validateProviderConfig } from "./providerConfig";

/** Explicit user action only. Discovery does not load or generate with a model. */
export async function discoverLocalModels(config: ProviderConfig, signal?: AbortSignal): Promise<string[]> {
  if (config.connectionType !== "local") throw new Error("Select a Local preset first.");
  validateProviderConfig(config, false);
  let result;
  try {
    result = await readProviderResponse(`${providerApiBase(config.baseUrl)}/models`, {
      signal, headers: providerAuthHeaders(config), redirect: "error", credentials: "omit", cache: "no-store",
    }, 15_000);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof ProviderRequestTimeoutError) throw new Error("Local connection test timed out. The server may still be loading the model.");
    throw new Error("Cannot reach the local server. Start it, check CORS for this AIST origin, and allow local network access in your browser.");
  }
  if (!result.response.ok) throw new Error(`Local server returned HTTP ${result.response.status}. Check authentication and whether the model has finished loading.`);
  let body: { data?: Array<{ id?: unknown }> };
  try { body = JSON.parse(result.text); } catch { throw new Error("Local server did not return a JSON model list. Enter the model ID manually if discovery is unsupported."); }
  if (!body || !Array.isArray(body.data)) throw new Error("Model discovery is unsupported. Enter the model ID manually and use Test Generation.");
  return [...new Set(body.data.flatMap(model => typeof model?.id === "string" && model.id.trim() ? [model.id] : []))];
}
