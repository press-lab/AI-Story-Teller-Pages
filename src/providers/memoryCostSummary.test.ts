import { it, expect } from "vitest";
import { summarizeMemoryCosts, type VerifiedTariff } from "./memoryCostSummary";
import type { ApiCallRecord } from "../types/adventure";
const base: ApiCallRecord = { id: "request", model: "configured", responseModel: "returned", provider: "example.test", purpose: "memoryEvaluation", status: "succeeded", startedAt: "2000-01-01",
  memoryRequest: { sourceId: "a", batchSourceIds: ["a", "b", "c"], stage: "singlePass", attempt: 1 }, usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100, cacheReadTokens: 600 } };
const synthetic: VerifiedTariff = { provider: "example.test", model: "returned", source: "synthetic test tariff, not provider pricing", verifiedAt: "2000-01-01", inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 4 };
it("counts shared HTTP requests once and prices only exact verified provider/returned-model matches", () => {
  const summary = summarizeMemoryCosts([base, base], [synthetic]);
  expect(summary.requests).toBe(1); expect(summary.counts.singlePass).toBe(1);
  expect(summary.estimatedCost).toBeCloseTo((400 * 2 + 600 * 0.5 + 100 * 4) / 1e6);
  expect(summarizeMemoryCosts([base], [{ ...synthetic, model: "other" }]).unpriced).toBe(1);
});
it("keeps unknown, partial and unpriced usage separate without fabricated zero consumption", () => {
  const summary = summarizeMemoryCosts([{ ...base, usage: undefined, partialUsage: { outputTokens: 23 } }, { ...base, id: "uncached-unknown", usage: { ...base.usage!, cacheReadTokens: undefined } }], [synthetic]);
  expect(summary.unknownUsage).toBe(1); expect(summary.unpriced).toBe(1);
  expect(summary.output).toBe(123); expect(summary.priced).toBe(0);
});
it("separates narration, corrections, continuity checks, legacy memory and other calls", () => {
  const purposes = ["narration", "correction", "continuityCheck", "memoryEvaluation", "otherBackground"] as const;
  const summary = summarizeMemoryCosts(purposes.map((purpose, i) => ({ ...base, id: String(i), purpose, memoryRequest: undefined })));
  expect(summary.counts).toEqual({ narration: 1, corrections: 1, continuity: 1, singlePass: 0, legacy: 1, other: 1 });
});

it("keeps Anthropic fresh-input usage separate from its additional cache reads and writes", () => {
  const summary = summarizeMemoryCosts([{ ...base, api: "anthropicMessages", usage: { ...base.usage!, promptTokens: 400, cacheCreationTokens: 100 } }], [{ ...synthetic, cacheWritePerMillion: 2.5 }]);
  expect(summary.estimatedCost).toBeCloseTo((400 * 2 + 600 * 0.5 + 100 * 2.5 + 100 * 4) / 1e6);
});

it("keeps reasoning within billed completion and reported cost separate from estimates", () => {
  const record = { ...base, usage: { ...base.usage!, reasoningTokens: 40, reportedCostUsd: 0.007 } };
  const summary = summarizeMemoryCosts([record], [synthetic]);
  expect(summary).toMatchObject({ output: 100, reasoning: 40, visibleOutput: 60, reportedCost: 0.007, reportedCostKnown: 1 });
  expect(summary.estimatedCost).toBeCloseTo((400 * 2 + 600 * 0.5 + 100 * 4) / 1e6);
  const partial = summarizeMemoryCosts([record, { ...base, id: "unknown" }], [synthetic]);
  expect(partial.reportedCost).toBeUndefined(); expect(partial.reasoning).toBeUndefined(); expect(partial.visibleOutput).toBeUndefined();
  expect(partial.reportedCostKnown).toBe(1);
  expect(summarizeMemoryCosts([]).reportedCost).toBeUndefined();
});
it("does not derive visible output from inconsistent provider counts", () => {
  expect(summarizeMemoryCosts([{ ...base, usage: { ...base.usage!, reasoningTokens: 101 } }]).visibleOutput).toBeUndefined();
});
