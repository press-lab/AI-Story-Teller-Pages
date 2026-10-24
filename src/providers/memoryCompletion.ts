import type { Adventure, ChatMessage, ProviderConfig } from "../types/adventure";
import { resolveMemoryEvaluationProviderConfig } from "./backgroundProvider";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";
import { sendOpenAIMemoryResponse } from "./openAIMemoryResponses";

/** Same provider capability/reasoning checks as October 24 recovery, for original targeted tasks. */
export async function sendMemoryCompletion(adventure: Adventure, provider: ProviderConfig, messages: ChatMessage[]) {
  const config = resolveMemoryEvaluationProviderConfig(adventure, provider);
  if (adventure.semanticEvaluationSettings.memoryEvaluationApi !== "openaiResponses") {
    return sendOpenAICompatibleChatCompletion({ config, messages, memoryEvaluation: true, retry: false, purpose: "memoryEvaluation" });
  }
  const response = await sendOpenAIMemoryResponse({ config, messages: [...messages, { role: "user",
    content: 'Transport format: return {"content":"the requested answer as text"}. If the task requests JSON, encode that JSON as the content string. Do not change the task itself.' }],
    purpose: "memoryEvaluation", schema: { type: "object", additionalProperties: false, required: ["content"], properties: { content: { type: "string" } } },
  });
  const parsed: unknown = JSON.parse(response.content);
  if (!parsed || typeof parsed !== "object" || !("content" in parsed) || typeof parsed.content !== "string") throw new Error("Invalid targeted memory transport response.");
  return { ...response, content: parsed.content };
}
