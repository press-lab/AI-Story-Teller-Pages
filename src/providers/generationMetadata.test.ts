import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiCallRecord } from "../types/adventure";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { getAdventure, saveAdventure } from "../db/adventureDb";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { sendOpenAICompatibleChatCompletion } from "./openAICompatible";
import { sendOpenAIMemoryResponse } from "./openAIMemoryResponses";
import { fetchWithAccounting, subscribeApiCalls } from "./apiCallAccounting";
import { generationMetadata } from "./generationMetadata";
import { buildContext } from "../contextBuilder/contextBuilder";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["https://api.example.test/v1", "chatCompletions"],
  ["https://api.example.test/anthropic", "anthropicMessages"],
  ["https://api.example.test/v1/responses", "responses"],
] as const)("records the actual API and requested/reported models for %s", async (baseUrl, api) => {
  const records: ApiCallRecord[] = [];
  const stop = subscribeApiCalls(record => records.push(record));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    model: "resolved-model-version", status: "completed",
    choices: [{ message: { content: "The gate opens." } }],
    content: [{ type: "text", text: "The gate opens." }],
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The gate opens." }] }],
  }))));
  const config = { ...defaultModelConfig, baseUrl, model: "requested-alias", apiKey: "secret-key", memoryReasoningControl: "omit" as const };
  const adventure = adventureReducer(createDefaultAdventure(), { type: "ADD_MESSAGE", role: "assistant", content: "The earlier story.",
    generation: { model: "earlier-model", appCommit: "historic-debug-commit" } });
  const messages = buildContext(adventure).messages;
  try {
    const result = api === "responses"
      ? await sendOpenAIMemoryResponse({ config, messages })
      : await sendOpenAICompatibleChatCompletion({ config, messages });
    const expected = { provider: "api.example.test", api, model: "requested-alias", responseModel: "resolved-model-version", appCommit: __COMMIT_HASH__ };
    expect(result.generation).toEqual(expected);
    const request = JSON.stringify(vi.mocked(fetch).mock.calls[0]);
    expect(request).toContain("The earlier story.");
    expect(request).not.toContain("historic-debug-commit");
    expect(request).not.toContain("appCommit");
    expect(request).not.toContain(__COMMIT_HASH__);
    expect(records.at(-1)).toMatchObject({ ...expected, status: "succeeded" });
    expect(JSON.stringify(records)).not.toContain("secret-key");
  } finally { stop(); }
});

it("logs API identity on failed attempts without URL secrets or request content", async () => {
  const records: ApiCallRecord[] = [];
  const stop = subscribeApiCalls(record => records.push(record));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  try {
    await expect(fetchWithAccounting("https://user:password@api.example.test/private/v1/chat/completions?key=query-secret#fragment", {
      headers: { Authorization: "Bearer header-secret" }, body: JSON.stringify({ messages: [{ content: "private prompt" }] }),
    }, { ...defaultModelConfig, model: "actual-model" }, "memoryEvaluation")).rejects.toThrow("offline");
    expect(records.at(-1)).toMatchObject({ provider: "api.example.test", api: "chatCompletions", model: "actual-model", appCommit: __COMMIT_HASH__, status: "failed" });
    for (const secret of ["password", "private", "query-secret", "header-secret", "fragment"]) expect(JSON.stringify(records)).not.toContain(secret);
  } finally { stop(); }
});

it("preserves per-entry identity through settings changes, JSON and IndexedDB", async () => {
  const adventure = createDefaultAdventure("Generation identity");
  adventure.memoryDetectionSettings.enabled = false;
  adventure.modelConfig.apiKey = "runtime-secret";
  const generation = generationMetadata("https://actual.example.test/v1/chat/completions", { model: "actual-model" }, { model: "actual-version" });
  const result = await runTurnPipeline({ adventure, text: "I listen.", sendChatCompletion: async () => ({ content: "The gate opens.", generation }) });
  const recorded = adventureReducer(result.adventure, { type: "RECORD_API_CALL", record: {
    ...generation, id: "logged-request", purpose: "narration", status: "succeeded", startedAt: new Date().toISOString(),
  } });
  const changed = adventureReducer(recorded, { type: "SET_MODEL_CONFIG", config: { ...defaultModelConfig, model: "future-model" } });
  const json = exportAdventureJson(changed);
  expect(json).not.toContain("runtime-secret");
  const imported = importAdventureJson(json);
  await saveAdventure(imported);
  const loaded = await getAdventure(imported.id);
  expect(loaded?.messages.at(-1)?.generation).toEqual(generation);
  expect(loaded?.messages.at(-1)?.generation?.appCommit).toBe(__COMMIT_HASH__);
  expect(loaded?.activeState.apiCalls?.[0].appCommit).toBe(__COMMIT_HASH__);
  expect(loaded?.messages.find(message => message.role === "user")?.generation).toBeUndefined();
  expect(loaded?.modelConfig.model).toBe("future-model");
});

it("records the background provider when continuity correction supplies the final text", async () => {
  const adventure = createDefaultAdventure();
  adventure.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://review.example.test/v1", model: "review-model" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "review-version", choices: [{ message: { content: "The gate opens." } }] }))));
  const result = await runTurnPipeline({ adventure, text: "I listen.", providerConfig: { ...defaultModelConfig, apiKey: "key" },
    sendChatCompletion: async () => ({ content: "You promised to open the gate.", generation: { model: "narrator-model" } }) });
  expect(result.continuityCorrected).toBe(true);
  expect(result.adventure.messages.at(-1)?.generation).toEqual({ provider: "review.example.test", api: "chatCompletions", model: "review-model", responseModel: "review-version", appCommit: __COMMIT_HASH__ });
});

it("does not invent generation identity for older entries", () => {
  const old = adventureReducer(createDefaultAdventure(), { type: "ADD_MESSAGE", role: "assistant", content: "Old story." });
  expect(importAdventureJson(exportAdventureJson(old)).messages.at(-1)?.generation).toBeUndefined();
});

it("preserves historical commits on load and export without backfilling legacy records", async () => {
  let adventure = adventureReducer(createDefaultAdventure(), { type: "ADD_MESSAGE", role: "assistant", content: "Earlier story.",
    generation: { model: "earlier-model", appCommit: "old-build" } });
  for (const [id, appCommit] of [["old-call", "old-build"], ["legacy-call", undefined]] as const) {
    adventure = adventureReducer(adventure, { type: "RECORD_API_CALL", record: {
      id, model: "earlier-model", appCommit, purpose: "narration", status: "succeeded", startedAt: "2026-01-01T00:00:00Z",
    } });
  }
  const imported = importAdventureJson(exportAdventureJson(adventure));
  await saveAdventure(imported);
  const loaded = await getAdventure(imported.id);
  expect(loaded?.messages.at(-1)?.generation?.appCommit).toBe("old-build");
  expect(loaded?.activeState.apiCalls?.find(call => call.id === "old-call")?.appCommit).toBe("old-build");
  expect(loaded?.activeState.apiCalls?.find(call => call.id === "legacy-call")?.appCommit).toBeUndefined();
});
