import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { loadEnv } from "vite";
import { memoryPassConfig, runBackgroundMemoryPass } from "../memory/compactMemoryFallback";
import { parseMemoryPassResponse } from "../memory/memoryPassResponse";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { normalizeAdventure } from "../state/defaults";
import type { Adventure, AdventureAction, ChatMessage, ProviderConfig } from "../types/adventure";

/**
 * Live comparison of the background memory pass across providers, on a real save.
 *
 * Put these in .env.test.local (never committed), then run `npm run test:live -- memoryPass`:
 *   AIST_MEMORY_SAVE=C:/path/to/Seattle-Hunger-Restoration.json
 *   VITE_TEST_DEEPSEEK_API_KEY=...        (optional VITE_TEST_DEEPSEEK_BASE_URL, VITE_TEST_DEEPSEEK_MODEL)
 *   VITE_TEST_OPENROUTER_API_KEY=...      (optional VITE_TEST_OPENROUTER_MODEL, default z-ai/glm-5.3)
 *
 * For each route it sends the save's next memory chunk twice and records the HTTP request parameters,
 * prompt size, output budget, finish reason, reasoning tokens, raw reply, JSON validity, and the
 * validator's verdict:
 *   - "legacy budget": the pre-fix request shape (2000 max tokens, reasoning left at the route default);
 *   - "current": the production pass (reply budget + reasoning reserve, thinking off/low).
 * Results are printed and written to memory-pass-live-report.json (git-ignored path recommended).
 */
const env = loadEnv("test", ".", "");
const SAVE = env.AIST_MEMORY_SAVE?.trim() || process.env.AIST_MEMORY_SAVE;

interface Route { name: string; config: ProviderConfig }

function routes(save: Adventure): Route[] {
  const list: Route[] = [];
  if (env.VITE_TEST_DEEPSEEK_API_KEY?.trim()) {
    list.push({ name: "deepseek", config: { ...save.modelConfig, apiKey: env.VITE_TEST_DEEPSEEK_API_KEY.trim(), baseUrl: env.VITE_TEST_DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/anthropic", model: env.VITE_TEST_DEEPSEEK_MODEL?.trim() || "deepseek-flash" } });
  }
  if (env.VITE_TEST_OPENROUTER_API_KEY?.trim()) {
    list.push({ name: "openrouter", config: { ...save.modelConfig, apiKey: env.VITE_TEST_OPENROUTER_API_KEY.trim(), baseUrl: "https://openrouter.ai/api/v1", model: env.VITE_TEST_OPENROUTER_MODEL?.trim() || "z-ai/glm-5.3", promptCaching: false } });
  }
  return list;
}

/** Wrap fetch to record the request parameters (minus messages and auth) and the raw reply. */
function recordFetch() {
  const original = globalThis.fetch;
  const record: { request?: Record<string, unknown>; status?: number; raw?: string } = {};
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const { messages, system, ...params } = body;
    const all = [...(system ? [system] : []), ...((messages as unknown[]) ?? [])];
    record.request = { ...params, promptChars: JSON.stringify(all).length, messageCount: all.length };
    const response = await original(input, init);
    record.status = response.status;
    record.raw = await response.clone().text();
    return response;
  };
  return { record, restore: () => { globalThis.fetch = original; } };
}

const errorsOf = (actions: AdventureAction[]) => actions.flatMap(a => a.type === "LOG_EVALUATION_RESULT" ? a.entry.errors : []);
const diagnosticsOf = (actions: AdventureAction[]) => actions.flatMap(a => a.type === "LOG_EVALUATION_RESULT" ? a.entry.diagnostics ?? [] : []);

describe.skipIf(!SAVE || !existsSync(SAVE))("live memory pass comparison", () => {
  it("compares the memory pass across configured providers", async () => {
    const save = normalizeAdventure(JSON.parse(readFileSync(SAVE!, "utf8"))) as Adventure;
    const report: Record<string, unknown>[] = [];
    for (const route of routes(save)) {
      // Current production pass.
      const current = recordFetch();
      const started = Date.now();
      const result = await runBackgroundMemoryPass(save, route.config).finally(current.restore);
      report.push({
        route: route.name, variant: "current", ms: Date.now() - started, request: current.record.request, httpStatus: current.record.status,
        status: result.status, failure: result.failure, tokenUsage: result.tokenUsage,
        diagnostics: diagnosticsOf(result.actions), validationErrors: errorsOf(result.actions), rawReply: current.record.raw?.slice(0, 8000),
      });

      // Legacy budget: the same prompt, the old request shape (2000 max tokens; no thinking option, so
      // GLM 5.3 runs at high reasoning effort as it did before the fix).
      const messages = await currentPassMessages(save, route.config);
      const legacy = recordFetch();
      try {
        const response = await sendOpenAICompatibleChatCompletion({ config: { ...memoryPassConfig(route.config), maxOutputTokens: 2000 }, messages, responseFormat: route.config.baseUrl.includes("/anthropic") ? undefined : "json_object" });
        const parse = parseMemoryPassResponse(response.content, response.finishReason);
        report.push({ route: route.name, variant: "legacy budget", request: legacy.record.request, finishReason: response.finishReason, usage: response.usage, reasoningTokens: response.reasoningTokens, replyChars: response.content.length, parse: { status: parse.status, error: parse.error, updates: parse.updates.length }, rawReply: response.content.slice(0, 8000) });
      } catch (error) {
        report.push({ route: route.name, variant: "legacy budget", request: legacy.record.request, error: error instanceof Error ? error.message : String(error), rawReply: legacy.record.raw?.slice(0, 2000) });
      } finally {
        legacy.restore();
      }
    }
    if (report.length === 0) console.info("No live provider keys configured; nothing compared.");
    writeFileSync("memory-pass-live-report.json", JSON.stringify(report, null, 2));
    console.info(JSON.stringify(report.map(({ rawReply: _raw, ...rest }) => rest), null, 2));
  }, 300000);
});

/** The exact messages the current pass sends for this save, captured without a network call. */
async function currentPassMessages(save: Adventure, config: ProviderConfig) {
  const sink: { messages?: ChatMessage[] } = {};
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: unknown }>; system?: unknown };
    const system = typeof body.system === "string" ? [{ role: "system", content: body.system }] : Array.isArray(body.system) ? [{ role: "system", content: (body.system as Array<{ text: string }>).map(b => b.text).join("") }] : [];
    sink.messages = [...system, ...(body.messages ?? [])].map(m => ({ role: m.role as ChatMessage["role"], content: typeof m.content === "string" ? m.content : (m.content as Array<{ text: string }>).map(b => b.text).join("") }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"updates":[]}' } }], content: [{ type: "text", text: '{"updates":[]}' }] }), { status: 200 });
  };
  try {
    await runBackgroundMemoryPass(save, { ...config, apiKey: config.apiKey || "dry-run" });
  } finally {
    globalThis.fetch = original;
  }
  return sink.messages ?? [];
}
