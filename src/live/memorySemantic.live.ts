import { it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defaultModelConfig, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runCompactMemoryFallback } from "../memory/compactMemoryFallback";
import { semanticGoldenAdventure } from "../memory/semanticGoldenFixture";
import type { GoldenMemoryCase } from "../memory/semanticGoldenCases";
import { scoreMemoryCase } from "../memory/memorySemanticBenchmark";
import { subscribeApiCalls } from "../providers/apiCallAccounting";
import type { ApiCallRecord, ProviderConfig, Adventure } from "../types/adventure";

it("discovers memories from real saved exchanges through the configured semantic evaluator", async () => {
  if (process.env.AIST_LIVE_MEMORY !== "1") throw new Error("Use npm run eval:memory explicitly. This suite spends API credits.");
  if (!process.env.AIST_MEMORY_CONFIG) throw new Error("Set AIST_MEMORY_CONFIG to a private provider configuration JSON file.");
  if (!process.env.AIST_MEMORY_API_KEY) throw new Error("Set AIST_MEMORY_API_KEY; no API requests were made.");
  const configured = JSON.parse(readFileSync(process.env.AIST_MEMORY_CONFIG, "utf8")) as Partial<ProviderConfig> & { memoryEvaluationApi?: "chat" | "openaiResponses"; inputUsdPerMillion?: number; outputUsdPerMillion?: number; cachedInputUsdPerMillion?: number };
  if (!configured.baseUrl || !configured.model) throw new Error("Configuration needs baseUrl and model.");
  const config: ProviderConfig = { ...defaultModelConfig, ...configured, apiKey: process.env.AIST_MEMORY_API_KEY };
  if (!process.env.AIST_MEMORY_SAVE || !process.env.AIST_MEMORY_CASES) throw new Error("Set AIST_MEMORY_SAVE and AIST_MEMORY_CASES to local-only export and case-manifest files. No gameplay data is bundled.");
  const imported = normalizeAdventure(JSON.parse(readFileSync(process.env.AIST_MEMORY_SAVE, "utf8").replace(/^\uFEFF/, "")));
  const cases: GoldenMemoryCase[] = JSON.parse(readFileSync(process.env.AIST_MEMORY_CASES, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(cases) || cases.some(test => !test.id || !Array.isArray(test.sourceIds) || !test.sourceIds.length || test.sourceIds.length > 10
    || !["must", "may", "empty"].includes(test.expectation))) throw new Error("Invalid local case manifest.");
  const selected = cases.filter(test => !process.env.AIST_MEMORY_CASE || test.id === process.env.AIST_MEMORY_CASE);
  if (!selected.length) throw new Error("Unknown case ID.");
  const records: ApiCallRecord[] = [];
  const unsubscribe = subscribeApiCalls(record => { if (record.status !== "started") records.push(record); });
  const results: ReturnType<typeof scoreMemoryCase>[] = [];
  try {
    for (const test of selected) {
      let a: Adventure = semanticGoldenAdventure(test, imported);
      // Only connection and transport are overridden. The actual runtime evaluator
      // receives source material and current canon, never the rubric or a target answer.
      a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey, memoryReasoningControl: config.memoryReasoningControl };
      a.semanticEvaluationSettings.memoryEvaluationApi = configured.memoryEvaluationApi ?? a.semanticEvaluationSettings.memoryEvaluationApi ?? "chat";
      const sources = a.messages.filter(message => test.sourceIds.includes(message.id));
      for (const source of sources) a = adventureReducer(a, { type: "QUEUE_MEMORY_RECOVERY", messageId: source.id, turn: 0 });
      const result = await runCompactMemoryFallback(a, config, sources, { storyCardsOnly: true });
      const next = result.valid ? adventureReducer(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources ?? [], dependencies: result.sourceSnapshots, actions: result.actions }) : a;
      const score = scoreMemoryCase(test, result, next.activeState.memoryProposals, a.storyCards);
      results.push(score);
      console.log(`${test.id}: valid=${score.valid} requiredHit=${score.requiredHit} proposals=${score.proposals.length} errors=${score.errors.length}`);
    }
  } finally { unsubscribe(); }
  const required = results.filter(result => result.expectation === "must");
  const tokens = records.reduce((sum, call) => ({ input: sum.input + (call.usage?.promptTokens ?? 0), output: sum.output + (call.usage?.completionTokens ?? 0), cached: sum.cached + (call.usage?.cacheReadTokens ?? 0) }), { input: 0, output: 0, cached: 0 });
  const ratesKnown = configured.inputUsdPerMillion !== undefined && configured.outputUsdPerMillion !== undefined;
  const approximateCostUsd = ratesKnown ? ((tokens.input - tokens.cached) * configured.inputUsdPerMillion! + tokens.cached * (configured.cachedInputUsdPerMillion ?? configured.inputUsdPerMillion!) + tokens.output * configured.outputUsdPerMillion!) / 1e6 : null;
  const report = { executedAt: new Date().toISOString(), model: config.model, provider: new URL(config.baseUrl).hostname,
    transport: configured.memoryEvaluationApi ?? "chat", rubricStatus: "Phrase-based screening; review proposals manually. Provisional cases need human sign-off.",
    requiredEventRecall: { hit: required.filter(result => result.requiredEventFound).length, total: required.length },
    requiredAcceptancePasses: { hit: required.filter(result => result.requiredHit).length, total: required.length },
    falsePositiveSuggestions: results.reduce((sum, result) => sum + result.falsePositiveSuggestions, 0),
    duplicateProposals: results.reduce((sum, result) => sum + result.duplicateProposals, 0),
    invalidEvidence: results.reduce((sum, result) => sum + result.invalidEvidence, 0),
    rejectedProposals: results.reduce((sum, result) => sum + result.rejectedProposals, 0),
    successfulEmptyEvaluations: results.filter(result => result.successfulEmpty).length,
    validEmptyMisses: results.filter(result => result.missedByValidEmpty).map(result => result.id),
    providerOrSchemaFailures: results.filter(result => !result.valid || result.partial).map(result => ({ id: result.id, failure: result.failure })),
    apiCalls: records, tokenUse: tokens, unknownUsageCalls: records.filter(record => !record.usage).length, approximateCostUsd,
    results };
  const directory = resolve(process.env.AIST_MEMORY_REPORT_DIR ?? "codex-artifacts/memory-semantic");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "latest.json"), JSON.stringify(report, null, 2) + "\n");
  expect(report.providerOrSchemaFailures, "Inspect latest.json; provider/schema failures are not empty success").toEqual([]);
  expect(report.requiredEventRecall.hit, "Required events missed; inspect actual proposals in latest.json").toBe(report.requiredEventRecall.total);
  expect(report.requiredAcceptancePasses.hit, "Discoveries must also survive validation and Inbox acceptance; inspect case acceptance checks separately from semantic recall").toBe(report.requiredAcceptancePasses.total);
  expect(report.falsePositiveSuggestions).toBe(0);
  expect(report.duplicateProposals).toBe(0);
  expect(report.invalidEvidence).toBe(0);
  expect(report.results.flatMap(result => result.forbiddenClaims)).toEqual([]);
}, 1_800_000);
