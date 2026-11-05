import { afterEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";
import { discoverLocalModels } from "./localProvider";
import { isLoopbackUrl, localPromptBudget, localProviderDefaults, validateProviderConfig } from "./providerConfig";
import { resolveBackgroundProviderConfig } from "./backgroundProvider";
import { sendMemoryCompletion } from "./memoryCompletion";
import { sendOpenAIMemoryResponse } from "./openAIMemoryResponses";
import { buildContext } from "../contextBuilder/contextBuilder";
import { fetchWithAccounting, ProviderRequestTimeoutError } from "./apiCallAccounting";
import { adventureReducer } from "../state/adventureReducer";

const local = { ...defaultModelConfig, ...localProviderDefaults, maxOutputTokens: 256 };
const messages = [{ role: "user" as const, content: "Hello." }];
function response(content = "Local ready.") {
  return new Response(JSON.stringify({ model: "aist-qwen", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["http://127.0.0.1:8080/v1", "http://localhost:8080/v1", "http://[::1]:8080/v1"])("accepts a loopback endpoint %s", baseUrl => {
  expect(isLoopbackUrl(baseUrl)).toBe(true);
  expect(() => validateProviderConfig({ ...local, baseUrl })).not.toThrow();
});
it.each(["http://0.0.0.0:8080", "http://192.168.1.5:8080", "https://example.com", "https://localhost.evil.test", "http://localhost@evil.test", "http://127.0.0.1/v1?key=secret"])("blocks non-local or credential-bearing endpoints before fetch: %s", async baseUrl => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(sendOpenAICompatibleChatCompletion({ config: { ...local, baseUrl }, messages })).rejects.toThrow("Local models must use");
  expect(fetch).not.toHaveBeenCalled();
});
it("sends no credentials or cloud routing fields, disables thinking and prevents redirects", async () => {
  const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
  const result = await sendOpenAICompatibleChatCompletion({ config: { ...local, apiKey: "old-cloud-key", promptCaching: true, openRouterProviderSort: "price" }, messages, thinking: "enabled" });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("http://127.0.0.1:8080/v1/chat/completions");
  expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
  expect(init.headers).not.toHaveProperty("Authorization");
  const body = JSON.parse(init.body);
  expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(body).not.toHaveProperty("thinking"); expect(body).not.toHaveProperty("provider"); expect(body).not.toHaveProperty("session_id");
  expect(result.usage?.totalTokens).toBe(13);
});
it("supports explicit local authentication and preserves the online key requirement", async () => {
  const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
  await sendOpenAICompatibleChatCompletion({ config: { ...local, authMode: "apiKey", apiKey: "local-secret" }, messages });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer local-secret");
  await expect(sendOpenAICompatibleChatCompletion({ config: { ...defaultModelConfig, apiKey: "" }, messages })).rejects.toThrow("Missing API key");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not send runtime-specific fields to another compatible local server", async () => {
  const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
  await sendOpenAICompatibleChatCompletion({ config: { ...local, localRuntime: "compatible" }, messages, thinking: "disabled" });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("chat_template_kwargs");
});
it("discovers model IDs without inference, duplicates, credentials or redirects", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "aist-qwen" }, { id: "aist-qwen" }, { id: 9 }] })));
  vi.stubGlobal("fetch", fetch);
  expect(await discoverLocalModels({ ...local, model: "" })).toEqual(["aist-qwen"]);
  expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v1/models");
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit" });
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
});
it("fails offline without retry or cloud fallback", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")); vi.stubGlobal("fetch", fetch);
  await expect(sendOpenAICompatibleChatCompletion({ config: local, messages })).rejects.toThrow("No online fallback");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not inherit credentials or local capabilities when changing background endpoints", () => {
  const a = createDefaultAdventure();
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: local.baseUrl, model: local.model };
  const resolved = resolveBackgroundProviderConfig(a, { ...defaultModelConfig, apiKey: "cloud-secret" });
  expect(resolved).toMatchObject({ connectionType: "local", authMode: "none", localRuntime: "compatible" });
  expect(resolved.apiKey).toBeUndefined();
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://cloud.example/v1", model: "cloud" };
  const cloud = resolveBackgroundProviderConfig(a, { ...local, apiKey: "local-secret" });
  expect(cloud).toMatchObject({ connectionType: "online", authMode: "apiKey" });
  expect(cloud.apiKey).toBeUndefined(); expect(cloud.contextWindowTokens).toBeUndefined();
});
it("retains credentials on the same endpoint and rejects invalid overrides", () => {
  const a = createDefaultAdventure();
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: local.baseUrl + "/", model: local.model };
  expect(resolveBackgroundProviderConfig(a, { ...local, authMode: "apiKey", apiKey: "same-key" }).apiKey).toBe("same-key");
  a.semanticEvaluationSettings.backgroundProviderConfig.baseUrl = "broken";
  expect(() => resolveBackgroundProviderConfig(a, local)).toThrow("absolute HTTP(S)");
});
it("uses the local thinking-off capability for memory and retains reasoning rejection", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response('{"updates":[]}')).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{}", reasoning_content: "thinking" } }] })));
  vi.stubGlobal("fetch", fetch);
  const a = createDefaultAdventure(); a.semanticEvaluationSettings.backgroundProviderConfig = undefined;
  await sendMemoryCompletion(a, local, messages);
  expect(JSON.parse(fetch.mock.calls[0][1].body).chat_template_kwargs).toEqual({ enable_thinking: false });
  await expect(sendMemoryCompletion(a, local, messages)).rejects.toThrow("memory_reasoning_not_disabled");
  await expect(sendOpenAIMemoryResponse({ config: local, messages })).rejects.toThrow("local_responses_unsupported");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("caps context building without changing saved budgets and refuses oversized protected input", async () => {
  let a = createDefaultAdventure();
  a = adventureReducer(a, { type: "ADD_MESSAGE", role: "assistant", content: "Old story. ".repeat(4000) });
  a = adventureReducer(a, { type: "ADD_MESSAGE", role: "user", content: "Continue." });
  const budget = a.tokenBudgetSettings.maxContextTokens;
  const smallerWindow = { ...local, contextWindowTokens: 8192 };
  const context = buildContext(a, { providerConfig: smallerWindow });
  expect(context.totalEstimatedTokens).toBeLessThanOrEqual(localPromptBudget(smallerWindow));
  expect(a.tokenBudgetSettings.maxContextTokens).toBe(budget);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(sendOpenAICompatibleChatCompletion({ config: local, messages: [{ role: "system", content: "Protected. ".repeat(20_000) }] })).rejects.toThrow("exceeds the configured context");
  expect(fetch).not.toHaveBeenCalled();
});
it("times out and aborts the underlying fetch using the configured limit", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
  const request = fetchWithAccounting(local.baseUrl, {}, { ...local, requestTimeoutMs: 1000 }, "otherBackground");
  const assertion = expect(request).rejects.toBeInstanceOf(ProviderRequestTimeoutError);
  await vi.advanceTimersByTimeAsync(1000); await assertion;
  expect(signal?.aborted).toBe(true);
});
