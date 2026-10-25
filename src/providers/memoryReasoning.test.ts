import { offlinePlacementReview } from "../test/memoryPlacement";
import { afterEach, expect, it, vi } from "vitest";
import { memoryReasoningFields } from "./memoryReasoning";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";
import { sendOpenAIMemoryResponse } from "./openAIMemoryResponses";
import { defaultModelConfig, normalizeAdventure, createDefaultAdventure } from "../state/defaults";
import { pendingMemoryRecovery } from "../memory/memoryRecoveryBatch";
import { adventureReducer } from "../state/adventureReducer";
import { resolveBackgroundProviderConfig } from "./backgroundProvider";
import { runCompactMemoryFallback } from "../memory/compactMemoryFallback";
import { subscribeApiCalls } from "./apiCallAccounting";
import type { ApiCallRecord } from "../types/adventure";
const base = { ...defaultModelConfig, baseUrl: "https://provider.example/v1", model: "any-model-name", apiKey: "test" };
afterEach(() => vi.restoreAllMocks());
function reply(raw: unknown) { return vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(raw) } as Response); }

it.each(["any-model-name", "future-fast-model", "local/fiction-memory"])('uses declared capabilities independently of the model name: %s', async model => {
  const spy = reply({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"turns":[]}' }] }] });
  await sendOpenAIMemoryResponse({ config: { ...base, model, memoryReasoningControl: "none", maxOutputTokens: 900 }, messages: [] });
  const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ model, reasoning: { effort: "none" }, max_output_tokens: 900 });
  expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined();
});
it.each(["required", "auto"] as const)("fails visibly without sending when capability is %s", async memoryReasoningControl => {
  const spy = reply({});
  await expect(sendOpenAIMemoryResponse({ config: { ...base, memoryReasoningControl }, messages: [] })).rejects.toThrow(/memory_reasoning_required|memory_non_thinking_capability_unknown/);
  expect(spy).not.toHaveBeenCalled();
});
it("omits incompatible reasoning fields for a declared non-thinking provider", async () => {
  const spy = reply({ choices: [{ finish_reason: "stop", message: { content: '{"updates":[]}' } }] });
  await sendOpenAICompatibleChatCompletion({ config: { ...base, memoryReasoningControl: "omit" }, messages: [], thinking: "disabled", memoryEvaluation: true });
  const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
  expect(body.reasoning).toBeUndefined(); expect(body.reasoning_effort).toBeUndefined(); expect(body.thinking).toBeUndefined();
  expect(spy).toHaveBeenCalledTimes(1);
});
it("does not translate disabled into low or medium reasoning on OpenRouter", async () => {
  const spy = reply({ choices: [{ message: { content: '{"updates":[]}' } }] });
  await sendOpenAICompatibleChatCompletion({ config: { ...base, baseUrl: "https://openrouter.ai/api/v1", model: "vendor/arbitrary-model", memoryReasoningControl: "openRouterDisabled" }, messages: [], memoryEvaluation: true, retry: true });
  expect(JSON.parse(spy.mock.calls[0][1]!.body as string).reasoning).toEqual({ enabled: false });
});
it("never converts a non-thinking Messages request to OpenAI reasoning fields", () => {
  expect(memoryReasoningFields({ ...base, memoryReasoningControl: "thinkingDisabled" }, "messages")).toEqual({ thinking: { type: "disabled" } });
  expect(() => memoryReasoningFields({ ...base, memoryReasoningControl: "none" }, "messages")).toThrow("incompatible");
});
it.each([undefined, "auto"] as const)("recognizes OpenRouter Chat with control %s independently of model names", memoryReasoningControl => {
  expect(memoryReasoningFields({ ...base, baseUrl: "https://openrouter.ai/api/v1", memoryReasoningControl })).toEqual({ reasoning: { enabled: false } });
});
it.each(["messages", "responses"] as const)("does not infer OpenRouter Chat controls for %s", transport => {
  expect(() => memoryReasoningFields({ ...base, baseUrl: "https://openrouter.ai/api/v1" }, transport)).toThrow("memory_non_thinking_capability_unknown");
});
it.each(["https://openrouter.ai.example/v1", "https://example.com/openrouter.ai", "https://openrouter.ai@example.com/v1"])("rejects unverified OpenRouter hostname: %s", baseUrl => {
  expect(() => memoryReasoningFields({ ...base, baseUrl, model: "z-ai/glm-5.3-flash" })).toThrow("memory_non_thinking_capability_unknown");
});
it("still rejects reported reasoning tokens from OpenRouter auto", async () => {
  const spy = reply({ choices: [{ message: { content: '{"updates":[]}' } }], usage: { completion_tokens_details: { reasoning_tokens: 1 } } });
  await expect(sendOpenAICompatibleChatCompletion({ config: { ...base, baseUrl: "https://openrouter.ai/api/v1", memoryReasoningControl: "auto" }, messages: [], memoryEvaluation: true })).rejects.toThrow("memory_reasoning_not_disabled");
  expect(spy).toHaveBeenCalledTimes(1);
});
it("fails if a provider reports reasoning after receiving its off control", async () => {
  reply({ choices: [{ message: { content: '{"updates":[]}', reasoning_content: "hidden work" } }], usage: { completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 20 } } });
  await expect(sendOpenAICompatibleChatCompletion({ config: { ...base, memoryReasoningControl: "omit" }, messages: [], memoryEvaluation: true })).rejects.toThrow("memory_reasoning_not_disabled");
});
it("retains evaluator capability through old-save normalization and independent provider selection", () => {
  const a = createDefaultAdventure();
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://memory.example/v1", model: "semantic-custom", memoryReasoningControl: "omit", apiKey: "must-not-persist" };
  const imported = normalizeAdventure(JSON.parse(JSON.stringify(a)));
  expect(imported.semanticEvaluationSettings.backgroundProviderConfig).toEqual({ baseUrl: "https://memory.example/v1", model: "semantic-custom", memoryReasoningControl: "omit" });
  expect(resolveBackgroundProviderConfig(imported, { ...base, model: "narrator-custom" })).toMatchObject({ model: "semantic-custom", memoryReasoningControl: "omit" });
  expect(imported.modelConfig.model).toBe(a.modelConfig.model);
});
it("reports the real provider payload and finish reason without logging private data", async () => {
  const spy = reply({ choices: [{ finish_reason: "length", message: { content: 'Visible story.<memory_updates>{' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  const records: ApiCallRecord[] = []; const stop = subscribeApiCalls(record => records.push(record));
  try {
    await sendOpenAICompatibleChatCompletion({ config: { ...base, baseUrl: "https://user:password@provider.example/private?secret=token", maxOutputTokens: 432 }, messages: [{ role: "system", content: "[ONE-PASS MEMORY] private context" }], purpose: "narration" });
    expect(records.at(-1)).toMatchObject({ provider: "provider.example", model: base.model, memoryInstructionPresent: true, outputTokenLimit: 432, finishReason: "length", memoryEnvelope: "incomplete" });
    expect(JSON.stringify(records)).not.toMatch(/private|password|secret|Bearer/);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally { stop(); }
});
it("does not send memory evaluation to a fallback provider when an imported Base URL is invalid", async () => {
  const a = createDefaultAdventure(); a.messages = [{ id: "source", role: "assistant", content: "The door opens.", createdAt: "2001-01-01" }];
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "1", model: "" };
  const spy = reply({});
  const result = await runCompactMemoryFallback(a, { ...base, memoryReasoningControl: "omit" }, a.messages);
  expect(result.valid).toBe(false); expect(result.error).toContain("memory_background_base_url_invalid"); expect(spy).not.toHaveBeenCalled();
});

const glm = { ...base, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash" };
it("accepts reported reasoning only for the automatically selected GLM low effort", async () => {
  const spy = reply({ choices: [{ message: { content: '{"updates":[]}', reasoning: "brief work" } }], usage: { completion_tokens_details: { reasoning_tokens: 12 } } });
  const result = await sendOpenAICompatibleChatCompletion({ config: glm, messages: [], memoryEvaluation: true });
  expect(result.content).toBe('{"updates":[]}');
  expect(JSON.parse(spy.mock.calls[0][1]!.body as string)).toMatchObject({ model: glm.model, reasoning: { effort: "low" }, max_tokens: glm.maxOutputTokens });
  expect(spy).toHaveBeenCalledTimes(1);
});
it.each(["openRouterDisabled", "thinkingDisabled", "none", "omit"] as const)("preserves explicit GLM off declaration %s and rejects unexpected reasoning", async memoryReasoningControl => {
  const spy = reply({ choices: [{ message: { content: '{"updates":[]}' } }], usage: { completion_tokens_details: { reasoning_tokens: 12 } } });
  await expect(sendOpenAICompatibleChatCompletion({ config: { ...glm, memoryReasoningControl }, messages: [], memoryEvaluation: true })).rejects.toThrow("memory_reasoning_not_disabled");
  expect(JSON.parse(spy.mock.calls[0][1]!.body as string).reasoning?.effort).not.toBe("low");
});
it.each(["z-ai/glm-5", "z-ai/glm-5.3", "z-ai/glm-5.3-flash:free", "other/glm-5.3-flash"])("does not expand the exception to %s", model => {
  expect(memoryReasoningFields({ ...glm, model })).toEqual({ reasoning: { enabled: false } });
});
it.each([
  [{ param: "reasoning.enabled", message: "Unsupported reasoning control secret https://private.example" }, "reasoning_control"],
  [{ message: "response_format is not supported secret" }, "response_format"],
  [{ param: "temperature", message: "Invalid value secret" }, "unknown_parameter"],
  [{ message: "Bad request secret" }, "unknown_parameter"],
] as const)("classifies a rejected memory request safely: %j", async (error, cause) => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error }), { status: 400 }));
  const a = createDefaultAdventure();
  a.messages = [{ id: "source", role: "assistant", content: "The tower fell.", createdAt: "2001-01-01" }];
  a.semanticEvaluationSettings = { ...a.semanticEvaluationSettings, backgroundProviderConfig: { baseUrl: glm.baseUrl, model: glm.model, memoryReasoningControl: "auto" } };
  a.messages[0].memoryRecovery = { status: "pending", turn: 1 };
  const before = JSON.stringify(a);
  const result = await runCompactMemoryFallback(a, glm, a.messages);
  expect(result.valid).toBe(false);
  expect(result.error).toContain(`memory_provider_http_400_${cause}`);
  expect(result.error).not.toMatch(/secret|private.example|Bearer/);
  expect(result.actions).toEqual([]);
  expect(result.processedSources).toBeUndefined();
  expect(JSON.stringify(a)).toBe(before);
  expect(pendingMemoryRecovery(result.actions.reduce(adventureReducer, a))).toEqual(a.messages);
  expect(spy).toHaveBeenCalledTimes(1);
});
it("delivers a grounded GLM low-reasoning Lore proposal through the Memory Inbox", async () => {
  const a = createDefaultAdventure();
  a.semanticEvaluationSettings = { ...a.semanticEvaluationSettings, backgroundProviderConfig: { baseUrl: glm.baseUrl, model: glm.model, memoryReasoningControl: "auto" } };
  const evidence = "The ancient tower fell, permanently sealing the northern pass.";
  a.messages = [{ id: "source", role: "assistant", content: evidence, createdAt: "2001-01-01" }];
  const spy = reply({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ turns: [{ sourceTurnId: "source", updates: [{
    kind: "lore", target: "The Fall of the Northern Tower", content: evidence, evidence,
    reason: "A consequential completed event blocks future travel.", category: "plot_beat", triggers: ["northern pass", "ancient tower"], sourceMessageIds: ["source"],
  }] }] }) } }], usage: { completion_tokens_details: { reasoning_tokens: 8 } } });
  const result = await runCompactMemoryFallback(a, glm, a.messages);
  expect(result.valid).toBe(true);
  const next = result.actions.reduce(adventureReducer, a);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ status: "pending", proposedType: "storyCard", storyCardType: "lore", content: evidence }));
  expect(result.processedSources).toEqual([{ id: "source", content: evidence }]);
  expect(spy).toHaveBeenCalledTimes(1);
});


it("does not inherit a narrator's endpoint-specific control on a different evaluator endpoint", () => {
  const a = createDefaultAdventure();
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
  const config = resolveBackgroundProviderConfig(a, { ...glm, memoryReasoningControl: "openRouterDisabled" });
  expect(config.memoryReasoningControl).toBeUndefined();
  expect(memoryReasoningFields(config)).toEqual({ thinking: { type: "disabled" } });
});

// These legacy transport fixtures supply an explicit synthetic placement reviewer.
vi.mock("./memoryCompletion", async importOriginal => {
  const actual = await importOriginal<typeof import("./memoryCompletion")>();
  return { ...actual, sendMemoryCompletion: vi.fn(async (...args: Parameters<typeof actual.sendMemoryCompletion>) =>
    offlinePlacementReview({ messages: args[2] }) ?? actual.sendMemoryCompletion(...args)) };
});
