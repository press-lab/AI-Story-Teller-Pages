import type { Adventure, ChatMessage, ProviderConfig } from "../types/adventure";
import { resolveMemoryEvaluationProviderConfig, safeMemoryFailure } from "./backgroundProvider";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";
import { sendOpenAIMemoryResponse } from "./openAIMemoryResponses";

// Runtime guards are tied to the exact per-run config, never persisted in a save.
const requestGuards = new WeakMap<ProviderConfig, () => boolean>();
export function guardMemoryRequests(config: ProviderConfig, shouldSend: () => boolean): ProviderConfig {
  requestGuards.set(config, shouldSend);
  return config;
}

/** Same provider capability/reasoning checks as October 24 recovery, for original targeted tasks. */
export async function sendMemoryCompletion(adventure: Adventure, provider: ProviderConfig, messages: ChatMessage[]) {
  const shouldSend = requestGuards.get(provider);
  if (shouldSend && !shouldSend()) throw new Error("memory_work_cancelled");
  const config = resolveMemoryEvaluationProviderConfig(adventure, provider);
  let received = false;
  try {
    if (adventure.semanticEvaluationSettings.memoryEvaluationApi !== "openaiResponses") {
      return await sendOpenAICompatibleChatCompletion({ config, messages, shouldSend, memoryEvaluation: true, retry: false, purpose: "memoryEvaluation" });
    }
    const response = await sendOpenAIMemoryResponse({ config, shouldSend, messages: [...messages, { role: "user",
      content: 'Transport format: return {"content":"the requested answer as text"}. If the task requests JSON, encode that JSON as the content string. Do not change the task itself.' }],
      purpose: "memoryEvaluation", schema: { type: "object", additionalProperties: false, required: ["content"], properties: { content: { type: "string" } } },
    });
    received = true;
    const parsed: unknown = JSON.parse(response.content);
    if (!parsed || typeof parsed !== "object" || !("content" in parsed) || typeof parsed.content !== "string") throw new Error("Invalid targeted memory transport response.");
    return { ...response, content: parsed.content };
  } catch (error) { throw safeMemoryFailure(error, received); }
}
