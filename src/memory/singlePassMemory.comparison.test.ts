import { afterEach, it, expect, vi } from "vitest";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { mockAssessment } from "../test/memoryAssessment";
import { offlinePlacementReview } from "../test/memoryPlacement";
import { createDefaultAdventure, makeBrain, makeStoryCard, makeComponent, defaultModelConfig } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { assessMemoryBatch } from "./memoryAssessment";
import { runManualBrainUpdate, runManualStoryCardsUpdate, runManualPEComponentUpdate, runMemoryCycle } from "../triggers/semanticEngine";
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

it.each(["brain", "card", "plotEssentials", "activePressure", "currentArc"] as const)("uses one actual HTTP attempt for manual %s and none for local validation", async kind => {
  const a = createDefaultAdventure(); a.semanticEvaluationSettings.memoryEvaluationApi = "chat";
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  a.messages = [{ id: "source", role: "assistant", content: "Mira finds the sealed harbor gate. The watch orders her to leave before dusk.", createdAt: "2026-10-26" }];
  a.brains = [makeBrain({ id: "brain", characterName: "Mira", active: true, thoughts: {} })];
  a.storyCards = [makeStoryCard({ id: "card", type: "lore", title: "Harbor gate", content: "The gate stands at the harbor." })];
  a.components = [makeComponent({ id: "component", title: "Test component", type: kind === "plotEssentials" || kind === "activePressure" || kind === "currentArc" ? kind : "plotEssentials", active: true, content: "Old constraints." })];
  const raw = kind === "brain" ? JSON.stringify({ thoughts: { harbor_order: "1 â†’ I must leave the harbor before dusk." } })
    : kind === "card" ? JSON.stringify({ content: "The watch ordered Mira to leave before dusk.", title: "Harbor gate", storyCardType: "lore", targetId: "card" })
    : kind === "activePressure" ? "The watch requires Mira to leave the harbor before dusk." : "Mira discovered the harbor gate was sealed by the watch.";
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: raw } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })));
  const config = { ...defaultModelConfig, apiKey: "offline", baseUrl: "https://example.test/v1", model: "fixture-model", memoryReasoningControl: "omit" as const };
  const result = kind === "brain" ? await runManualBrainUpdate(a, config, "brain") : kind === "card" ? await runManualStoryCardsUpdate(a, config) : await runManualPEComponentUpdate(a, config, "component");
  expect(fetch).toHaveBeenCalledTimes(1); expect(result.logEntry.errors).toEqual([]);
  const next = result.actions.reduce(reduce, a);
  if (kind === "brain") expect(next.brains[0].thoughts.harbor_order).toContain("before dusk");
  else expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ status: "pending", requiresReview: true }));
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not retry a failed manual HTTP attempt", async () => {
  const a = createDefaultAdventure(); a.semanticEvaluationSettings.memoryEvaluationApi = "chat"; a.brains = [makeBrain({ id: "brain", characterName: "Mira", active: true })];
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"error":{"message":"unavailable"}}', { status: 503 }));
  await runManualBrainUpdate(a, { ...defaultModelConfig, apiKey: "offline", baseUrl: "https://example.test/v1", memoryReasoningControl: "omit" }, "brain");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("uses zero HTTP attempts for local recovery, validation and duplicate suppression", async () => {
  const { parseSinglePassMemoryResponse } = await import("./singlePassMemory");
  const { validateSinglePassSource } = await import("./singlePassMemoryValidation");
  let { a, ids } = singlePassFixture(1); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No local step can request a model."));
  const record = JSON.stringify({ sourceId: ids[0], findings: [groundedFinding(), groundedFinding()] });
  const result = parseSinglePassMemoryResponse('{"sources":[' + record + ',{"sourceId":"cut', ids, a).sources[0];
  const validated = validateSinglePassSource(a, result, batch.checkpoints[0].checkpoint);
  expect(validated.proposals).toHaveLength(1);
  expect(validated.suppressed).toEqual([1]);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ result, checkpoint: batch.checkpoints[0].checkpoint }] });
  expect(a.activeState.memoryProposals).toHaveLength(1);
  expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation?.singlePass?.suppressedCount).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([false, true])("keeps Brain-derived Lore notes review-only when global review=%s", async review => {
  const a = createDefaultAdventure(); a.semanticEvaluationSettings.memoryEvaluationApi = "chat";
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = review; a.memoryAutoApprove.storyCard = true;
  a.messages = [{ id: "source", role: "assistant", content: "Mira sees the gate close.", createdAt: "2026-10-26" }];
  a.storyCards = [makeStoryCard({ id: "card", title: "Harbor gate", type: "lore", content: "The harbor has a gate." })];
  a.brains = [makeBrain({ id: "brain", characterName: "Mira", active: true, linkedStoryCardId: "card", thoughts: {} })];
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ currentState: "I must inspect the harbor.", storyCardNote: "Mira privately interprets the closure as a warning." }) } }] })));
  const result = await runManualBrainUpdate(a, { ...defaultModelConfig, apiKey: "offline", baseUrl: "https://example.test/v1", memoryReasoningControl: "omit" }, "brain");
  expect(fetch).toHaveBeenCalledTimes(1);
  const next = result.actions.reduce(reduce, a);
  expect(next.storyCards[0].content).toBe(a.storyCards[0].content);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ proposedType: "storyCard", requiresReview: true, status: "pending", sourceTurnId: "source" }));
});
it("rejects a Brain note on a Character profile without making a second request", async () => {
  const a = createDefaultAdventure(); a.semanticEvaluationSettings.memoryEvaluationApi = "chat"; a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  a.messages = [{ id: "source", role: "assistant", content: "Mira sees the gate close.", createdAt: "2026-10-26" }];
  a.storyCards = [makeStoryCard({ id: "card", title: "Mira", type: "character", content: "Mira is a harbor guard." })];
  a.brains = [makeBrain({ id: "brain", characterName: "Mira", active: true, linkedStoryCardId: "card", thoughts: {} })];
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ currentState: "I must inspect the harbor.", storyCardNote: "Mira is permanently distrustful." }) } }] })));
  const result = await runManualBrainUpdate(a, { ...defaultModelConfig, apiKey: "offline", baseUrl: "https://example.test/v1", memoryReasoningControl: "omit" }, "brain");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL" && action.proposal.proposedType === "storyCard")).toBe(false);
  expect(result.actions.some(action => action.type === "RECORD_MEMORY_DIAGNOSTIC" && action.entry.outcome === "validation_rejected")).toBe(true);
});
