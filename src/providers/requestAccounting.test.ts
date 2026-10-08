import { afterEach, expect, it, vi } from "vitest";
import { defaultModelConfig, createDefaultAdventure, sanitizeAdventureForPersistence } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import type { ProviderRequestRecord } from "../types/adventure";
import { subscribeProviderRequests } from "./requestAccounting";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";

afterEach(() => vi.restoreAllMocks());
const config = { ...defaultModelConfig, baseUrl: "https://api.example.com", apiKey: "mock", model: "glm-5.3", requestContext: { adventureId: "a", turn: 1, purpose: "narration" as const } };
function reply(body: unknown, status = 200) { return { ok: status === 200, status, text: async () => JSON.stringify(body) } as Response; }

it("records each GLM retry once, totals measured usage without counting the aggregate, and deduplicates persistence", async () => {
  const records: ProviderRequestRecord[] = [], unsubscribe = subscribeProviderRequests(r => records.push(r));
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ choices: [{ finish_reason: "length", message: { content: null } }], usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 } }))
    .mockResolvedValueOnce(reply({ choices: [{ message: { content: 'Marcus rests. <memory_updates>{"updates":[]}</memory_updates>' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
  const response = await sendOpenAICompatibleChatCompletion({ config, messages: [{ role: "user", content: "Marcus" }] });
  unsubscribe();
  expect(records).toHaveLength(2);
  expect(records.reduce((n, r) => n + r.usage!.totalTokens, 0)).toBe(response.usage!.totalTokens);
  expect(records[0].success).toBe(false);
  expect(records[1].structuredOutputTokensEstimate).toBeGreaterThan(0);
  expect(records[1].costUSD).toBeUndefined();
  let a = createDefaultAdventure(); a.id = "a";
  for (const record of [...records, ...records]) a = adventureReducer(a, { type: "RECORD_PROVIDER_REQUEST", record });
  expect(a.activeState.providerRequests).toHaveLength(2);
  a.modelConfig = config;
  expect(sanitizeAdventureForPersistence(a).modelConfig.requestContext).toBeUndefined();
  expect(sanitizeAdventureForPersistence(a).modelConfig.apiKey).toBeUndefined();
});

it("keeps unknown usage/cost unknown, counts failures, and calculates cost only with supplied pricing", async () => {
  const records: ProviderRequestRecord[] = [], unsubscribe = subscribeProviderRequests(r => records.push(r));
  const base = { ...config, model: "plain", requestContext: { ...config.requestContext, purpose: "compactMemoryFallback" as const } };
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply({ choices: [{ message: { content: '{"updates":[]}' } }] }))
    .mockResolvedValueOnce(reply({ choices: [{ message: { content: "done" } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }))
    .mockRejectedValueOnce(new Error("Offline"));
  await sendOpenAICompatibleChatCompletion({ config: base, messages: [] });
  await sendOpenAICompatibleChatCompletion({ config: { ...base, pricing: { inputPerMillionUSD: 2, outputPerMillionUSD: 4 } }, messages: [] });
  await expect(sendOpenAICompatibleChatCompletion({ config: base, messages: [] })).rejects.toThrow("Offline");
  unsubscribe();
  expect(records).toHaveLength(3);
  expect(records[0].usage).toBeUndefined(); expect(records[0].costUSD).toBeUndefined();
  expect(records[0].structuredOutputTokensEstimate).toBeGreaterThan(0);
  expect(records[1].costUSD).toBeCloseTo(0.0004);
  expect(records[2].success).toBe(false); expect(records[2].costUSD).toBeUndefined();
});
