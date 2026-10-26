import { afterEach, it, expect, vi } from "vitest";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { mockAssessment } from "../test/memoryAssessment";
import { offlinePlacementReview } from "../test/memoryPlacement";
import { defaultModelConfig } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { assessMemoryBatch } from "./memoryAssessment";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch } from "./singlePassMemory";
import { subscribeApiCalls } from "../providers/apiCallAccounting";
import type { ApiCallRecord, SinglePassMemoryFinding } from "../types/adventure";
import { partnershipSourceId } from "./fixtures/syntheticMemoryAdventure";

afterEach(() => vi.restoreAllMocks());
it("compares actual mocked HTTP calls on identical stored sources with a declared fact rubric", async () => {
  const config = { ...defaultModelConfig, apiKey: "offline", baseUrl: "https://example.test/v1", model: "fixture-model", memoryReasoningControl: "omit" as const };
  const records: ApiCallRecord[] = [];
  const unsubscribe = subscribeApiCalls(r => { if (r.status !== "started") records.push(r); });
  const original = singlePassFixture();
  original.a.components = []; original.a.brains = []; original.a.semanticEvaluationSettings.memoryEvaluationApi = "chat";
  const allFindings = (sourceId: string): SinglePassMemoryFinding[] => sourceId === partnershipSourceId ? [groundedFinding(), { ...groundedFinding(), title: "Blair's planned workshop tour",
    content: "Blair Reed will arrange a workshop tour later.", evidenceQuotes: [{ messageId: sourceId, quote: "Blair Reed will arrange a workshop tour later." }], eventStatus: "ongoing" }]
    : sourceId === original.ids[1] ? [{ ...groundedFinding(), title: "Avery's proposed sales arrangement", content: "Avery proposed a share of sales for Casey's custom designs.",
      evidenceQuotes: [{ messageId: sourceId, quote: "I propose a share of sales for your custom designs." }], eventStatus: "ongoing" }] : [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const messages = body.messages;
    const text = messages.map((m: { content: string }) => m.content).join("\n");
    let content: string;
    if (text.includes("SINGLE PASS MEMORY EXTRACTION")) content = JSON.stringify({ sources: JSON.parse(messages.at(-1).content).sources.map((s: { sourceId: string }) => ({ sourceId: s.sourceId, findings: allFindings(s.sourceId) })) });
    else if (text.includes("SHARED MEMORY ASSESSMENT")) content = mockAssessment(messages, [], true);
    else {
      const validation = offlinePlacementReview({ messages });
      if (validation) content = validation.content;
      else {
        const selected = /Establishing narrator ID: ([^\n]+)/.exec(text)?.[1];
        if (!selected) throw new Error("Unrecognized scripted provider request.");
        content = JSON.stringify(allFindings(selected).map(f => ({ title: f.title, content: f.content, storyCardType: "lore", targetId: undefined,
          rationale: f.reason, evidenceMessageIds: f.evidenceQuotes.map(q => q.messageId), evidenceQuotes: f.evidenceQuotes,
          suggestedTriggers: f.suggestedTriggers, memoryMode: f.memoryMode, eventStatus: f.eventStatus })));
      }
    }
    // Synthetic transport-reported usage, not measured provider tokenization or billing.
    return new Response(JSON.stringify({ model: "fixture-model", choices: [{ message: { content } }], usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 } }));
  });
  let legacy = structuredClone(original.a);
  legacy.messages = legacy.messages.map(m => m.memoryEvaluation ? { ...m, memoryEvaluation: { ...m.memoryEvaluation, pipeline: "legacy" } } : m);
  for (const sourceId of original.ids) legacy = reduce(legacy, { type: "CLAIM_MEMORY_EVALUATION", sourceId, turn: 45, manual: true });
  const assessed = await assessMemoryBatch(legacy, config, original.ids);
  legacy = reduce(legacy, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: assessed.sources });
  for (const sourceId of original.ids) {
    const result = await runMemoryCycle(legacy, config, { sourceId, manual: true });
    legacy = result.actions.reduce(reduce, legacy);
  }
  const legacyRecords = records.splice(0);
  let single = structuredClone(original.a);
  const batch = await prepareSinglePassMemoryBatch(single, original.ids);
  single = reduce(single, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const result = await runSinglePassMemoryBatch(single, config, batch);
  single = reduce(single, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: result.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) });
  unsubscribe();
  const expected = ["Avery proposed a share of sales for Casey's custom designs.", groundedFinding().content!, "Blair Reed will arrange a workshop tour later."];
  const score = (a: typeof single, calls: ApiCallRecord[]) => {
    const proposals = a.activeState.memoryProposals;
    return { sources: 3, calls: calls.length, stages: Object.fromEntries(["assessment", "generation", "discovery", "validation", "repair", "singlePass"].map(stage => [stage, calls.filter(c => c.memoryRequest?.stage === stage).length])),
      canonicalFacts: proposals.filter(p => p.status === "approved").length, duplicates: proposals.length - new Set(proposals.map(p => p.content)).size, misattributed: proposals.filter(p => p.sourceTurnId !== (p.content.startsWith("Avery proposed") ? original.ids[1] : partnershipSourceId)).length,
      acceptedDraftFacts: expected.filter(fact => proposals.some(p => p.content === fact)).length, reviewRequired: proposals.filter(p => p.status === "pending").length,
      missed: expected.filter(fact => !proposals.some(p => p.content === fact)).length, unsupported: proposals.filter(p => !expected.includes(p.content)).length,
      incorrectDestinations: proposals.filter(p => p.proposedType !== "storyCard" || p.storyCardType !== "lore").length,
      inputTokens: calls.reduce((n, c) => n + (c.usage?.promptTokens ?? 0), 0), outputTokens: calls.reduce((n, c) => n + (c.usage?.completionTokens ?? 0), 0) };
  };
  const comparison = { legacy: score(legacy, legacyRecords), singlePass: score(single, records), caveat: "Scripted responses; synthetic reported usage; no provider tariff or live quality measurement." };
  console.log("SINGLE_PASS_OFFLINE_COMPARISON", JSON.stringify(comparison));
  expect(records).toHaveLength(1);
  expect(comparison.singlePass.acceptedDraftFacts).toBe(3);
  expect(comparison.singlePass.missed).toBe(0);
  expect(comparison.singlePass.unsupported).toBe(0);
  expect(comparison.singlePass.incorrectDestinations).toBe(0);
  expect(comparison.legacy.acceptedDraftFacts).toBe(3);
  expect(comparison.legacy.missed).toBe(0);
  expect(legacyRecords.length).toBeGreaterThan(1);
});
