import type { ProviderConfig } from "../types/adventure";

/** A provider/model capability declaration, not a model-name catalogue. "none"
 * asserts documented support for that effort; "omit" asserts no default reasoning.
 * Custom endpoints use the same persisted configuration as built-in providers. */
export type MemoryReasoningControl = "auto" | "omit" | "none" | "thinkingDisabled" | "openRouterDisabled" | "required";

export function memoryReasoningFields(config: ProviderConfig, transport: "chat" | "responses" | "messages" = "chat"): Record<string, unknown> {
  const control = config.memoryReasoningControl ?? "auto";
  if (control === "required") throw new Error("memory_reasoning_required: This configuration requires reasoning. Select an evaluator that can disable it.");
  if (control === "none" && transport === "messages") throw new Error("memory_reasoning_control_incompatible: This Messages endpoint uses thinking disabled or no reasoning fields, not reasoning effort none.");
  if (control === "none") return transport === "responses" ? { reasoning: { effort: "none" } } : { reasoning_effort: "none" };
  if (control === "omit") return {};
  if (control === "thinkingDisabled") {
    if (transport === "responses") throw new Error("memory_reasoning_control_incompatible: Responses requires a documented effort none capability; the Chat thinking toggle is not interchangeable.");
    return { thinking: { type: "disabled" } };
  }
  if (control === "openRouterDisabled") {
    if (transport !== "chat") throw new Error("memory_reasoning_control_incompatible: OpenRouter disabled uses the compatible Chat API.");
    return { reasoning: { enabled: false } };
  }
  // OpenRouter documents reasoning.enabled=false for Chat Completions.
  // Verify the endpoint hostname; model names do not declare this capability.
  if (transport === "chat" && /(?:^|\.)openrouter\.ai$/.test(new URL(config.baseUrl).hostname)) {
    // This evaluator needs the same bounded effort as narration. Explicit off
    // declarations above remain authoritative for compatible configurations.
    if (config.model.trim().toLowerCase() === "z-ai/glm-5.3-flash") return { reasoning: { effort: "low" } };
    return { reasoning: { enabled: false } };
  }
  // DeepSeek documents this toggle for both API formats, independently of model
  // name. Other providers must declare a documented capability in Settings.
  if (/(?:^|\.)deepseek\.com$/.test(new URL(config.baseUrl).hostname)) {
    return transport === "responses" ? { reasoning: { effort: "none" } } : { thinking: { type: "disabled" } };
  }
  throw new Error("memory_non_thinking_capability_unknown: Declare this evaluator's documented non-thinking control in Memory evaluation settings. No request was sent.");
}

/** A provider ignoring its declared off control must not become silent success.
 * This can detect reported reasoning, but cannot prove unreported internal work. */
export function assertMemoryReasoningDisabled(raw: unknown) {
  const body = raw as { usage?: { completion_tokens_details?: { reasoning_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
    choices?: Array<{ message?: { reasoning_content?: string; reasoning?: string; reasoning_details?: unknown[]; content?: unknown } }>;
    content?: Array<{ type: string; thinking?: string }>;
    output?: Array<{ type: string; encrypted_content?: string; summary?: Array<{ text?: string }> }> };
  const message = body?.choices?.[0]?.message;
  if ((body?.usage?.completion_tokens_details?.reasoning_tokens ?? body?.usage?.output_tokens_details?.reasoning_tokens ?? 0) > 0
    || message?.reasoning_content?.trim() || message?.reasoning?.trim() || message?.reasoning_details?.length
    || body?.content?.some(block => block.type === "thinking" && block.thinking?.trim())
    || body?.output?.some(block => block.type === "reasoning" && (block.encrypted_content || block.summary?.some(item => item.text?.trim())))
    || (typeof message?.content === "string" && /<think>\s*\S/i.test(message.content))) {
    throw new Error("memory_reasoning_not_disabled: Provider returned reasoning despite the configured off control. Review evaluator capabilities; result was not applied.");
  }
}
