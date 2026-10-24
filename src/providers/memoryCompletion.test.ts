import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { sendMemoryCompletion } from "./memoryCompletion";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";
import { sendOpenAIMemoryResponse } from "./openAIMemoryResponses";
vi.mock("./openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
vi.mock("./openAIMemoryResponses", () => ({ sendOpenAIMemoryResponse: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: "[]", raw: {} }); });
it.each(["https://evaluator.test/v1", defaultModelConfig.baseUrl])("uses the evaluator endpoint/model without inheriting narrator reasoning controls: %s", async baseUrl => {
  const a = { ...createDefaultAdventure(), semanticEvaluationSettings: { ...createDefaultAdventure().semanticEvaluationSettings } };
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl, model: "different-evaluator" };
  await sendMemoryCompletion(a, { ...defaultModelConfig, memoryReasoningControl: "required" }, [{ role: "user", content: "Evaluate" }]);
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledWith(expect.objectContaining({ memoryEvaluation: true, retry: false,
    config: expect.objectContaining({ baseUrl, model: "different-evaluator", memoryReasoningControl: undefined }) }));
});
it("rejects an invalid configured evaluator endpoint without sending a request", async () => {
  const a = { ...createDefaultAdventure(), semanticEvaluationSettings: { ...createDefaultAdventure().semanticEvaluationSettings } }; a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "broken", model: "model" };
  await expect(sendMemoryCompletion(a, defaultModelConfig, [])).rejects.toThrow("memory_background_base_url_invalid");
  expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
});
it("uses a task-specific strict Responses envelope while preserving the original targeted task output", async () => {
  const a = { ...createDefaultAdventure(), semanticEvaluationSettings: { ...createDefaultAdventure().semanticEvaluationSettings } }; a.semanticEvaluationSettings.memoryEvaluationApi = "openaiResponses";
  vi.mocked(sendOpenAIMemoryResponse).mockResolvedValue({ content: '{"content":"[\\"brain:mira\\"]"}', raw: {} });
  const result = await sendMemoryCompletion(a, defaultModelConfig, [{ role: "user", content: "Evaluate Mira" }]);
  expect(result.content).toBe('["brain:mira"]');
  expect(sendOpenAIMemoryResponse).toHaveBeenCalledWith(expect.objectContaining({ schema: expect.objectContaining({ required: ["content"] }) }));
  expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
});
