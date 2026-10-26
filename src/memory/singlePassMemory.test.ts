import { describe, it, expect, vi, afterEach } from "vitest";
import { syntheticMemoryAdventure, partnershipSourceId, confirmationQuote } from "./fixtures/syntheticMemoryAdventure";
import { defaultModelConfig, normalizeAdventure } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { singlePassCycleSources } from "./memoryCycleState";
import { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch, parseSinglePassMemoryResponse, normalizeSinglePassFinding } from "./singlePassMemory";
import * as transport from "../providers/memoryCompletion";
import type { SinglePassMemoryFinding } from "../types/adventure";

import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
afterEach(() => vi.restoreAllMocks());
describe("single-pass extraction request bound", () => {
  it.each([1, 2, 3])("uses one provider request for %i independently empty sources", async count => {
    const { a, ids } = singlePassFixture(count);
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content: JSON.stringify({ sources: ids.map(sourceId => ({ sourceId, findings: [] })) }), usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    const result = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][3]).toBe("singlePass");
    expect(result.sources.every(s => !s.failureReason && !s.findings.length)).toBe(true);
    expect(result.usage?.promptTokens).toBe(100);
  });
  it.each(["multiple", "malformed", "missing", "invalidJson", "timeout", "uncertain"])("never fans out after %s", async mode => {
    const { a, ids } = singlePassFixture();
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    const sources = ids.map(sourceId => ({ sourceId, findings: sourceId === partnershipSourceId ? [groundedFinding(), { ...groundedFinding(), title: "Separate agreement", content: "Blair Reed will arrange a workshop tour later." }] : [] }));
    if (mode === "malformed") sources[0].findings.push({ kind: "storyCard" } as SinglePassMemoryFinding);
    if (mode === "missing") sources.shift();
    if (mode === "uncertain") sources.at(-1)!.findings[0].candidateOnly = true;
    const send = vi.spyOn(transport, "sendMemoryCompletion");
    if (mode === "timeout") send.mockRejectedValue(new Error("timeout"));
    else send.mockResolvedValue({ raw: {}, content: mode === "invalidJson" ? "{" : JSON.stringify({ sources }) });
    try { await runSinglePassMemoryBatch(a, defaultModelConfig, batch); } catch { expect(mode).toBe("timeout"); }
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("preserves valid findings and source siblings", () => {
    const result = parseSinglePassMemoryResponse(JSON.stringify({ sources: [{ sourceId: "a", findings: [groundedFinding(), {}] }, { sourceId: "b", findings: [] }] }), ["a", "b", "c"]);
    expect(result.sources[0].findings).toHaveLength(1);
    expect(result.sources[0].rejected).toHaveLength(1);
    expect(result.sources[1].failureReason).toBeUndefined();
    expect(result.sources[2].failureReason).toBeTruthy();
  });
  it("does not replay old, completed, failed, running or quarantined sources", () => {
    const { a, ids } = singlePassFixture();
    expect(singlePassCycleSources(a).map(m => m.id)).toEqual(ids);
    for (const status of ["complete", "failed", "running", "quarantined"] as const) {
      a.messages.find(m => m.id === ids[0])!.memoryEvaluation!.status = status;
      expect(singlePassCycleSources(a).some(m => m.id === ids[0])).toBe(false);
    }
    const restored = normalizeAdventure(JSON.parse(JSON.stringify(a)));
    expect(singlePassCycleSources(restored).some(m => !ids.includes(m.id))).toBe(false);
  });
  it("commits valid siblings once and preserves the failed source across reload", async () => {
    let { a, ids } = singlePassFixture();
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    const parsed = parseSinglePassMemoryResponse(JSON.stringify({ sources: ids.slice(1).map(sourceId => ({ sourceId, findings: sourceId === partnershipSourceId ? [groundedFinding()] : [] })) }), ids);
    const commit = { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH" as const, batchId: batch.batchId, sources: parsed.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) };
    a = reduce(a, commit);
    expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation?.status).toBe("failed");
    expect(a.messages.find(m => m.id === ids[1])!.memoryEvaluation?.status).toBe("complete");
    expect(a.activeState.memoryProposals.some(p => p.sourceTurnId === partnershipSourceId)).toBe(true);
    expect(reduce(a, commit)).toBe(a);
    expect(normalizeAdventure(JSON.parse(JSON.stringify(a))).messages.find(m => m.id === ids[0])!.memoryEvaluation?.singlePass?.status).toBe("failed");
  });
});

it.each([
  (s: string) => s,
  (s: string) => "\uFEFF" + s,
  (s: string) => "```json\n" + s + "\n```",
  (s: string) => "<think>Internal reasoning.</think>\n" + s,
  (s: string) => "```json\n<think>Internal reasoning.</think>\n" + s + "\n```",
])("parses complete response wrappers locally", wrap => {
  const result = parseSinglePassMemoryResponse(wrap(JSON.stringify({ sources: [{ sourceId: "a", findings: [groundedFinding()] }] })), ["a"]);
  expect(result.sources[0].findings).toHaveLength(1);
});
it.each(["title", "reason", "candidateOnly", "suggestedTriggers", "participants", "eventStatus", "operation", "memoryMode", "storyCardType"])("recovers missing %s conservatively", field => {
  const { a } = singlePassFixture();
  const raw = { ...groundedFinding() } as Record<string, unknown>;
  delete raw[field];
  const finding = normalizeSinglePassFinding(raw, "a", a);
  expect(finding).toBeDefined(); expect(finding?.candidateOnly).toBe(true);
  if (field === "eventStatus") expect(finding?.eventStatus).toBe("unresolved");
});
it("recovers the minimum factual contract without inventing metadata facts", () => {
  const { a } = singlePassFixture(); const full = groundedFinding();
  const result = parseSinglePassMemoryResponse(JSON.stringify({ sources: [{ sourceId: "a", findings: [{ kind: "storyCard", targetId: null, content: full.content, evidenceQuotes: full.evidenceQuotes, extra: "ignored" }] }] }), ["a"], a);
  expect(result.sources[0].findings[0]).toMatchObject({ title: full.content!.split(/\s+/).slice(0, 8).join(" "), reason: "Extracted from narrator source a.", candidateOnly: true, operation: "create", storyCardType: "lore", memoryMode: "static", eventStatus: "unresolved", participants: [] });
  expect(result.sources[0].diagnostics).toContainEqual({ index: 0, reason: "Ignored unknown finding field: extra." });
});
it.each(["content", "evidenceQuotes", "kind", "targetId"])("does not recover missing factual field %s", field => {
  const raw = { ...groundedFinding() } as Record<string, unknown>; delete raw[field];
  expect(normalizeSinglePassFinding(raw, "a")).toBeUndefined();
});
it("uses existing target metadata and retains valid explicit metadata", () => {
  const { a } = singlePassFixture(); const target = a.storyCards[0];
  const f = normalizeSinglePassFinding({ ...groundedFinding(), title: undefined, operation: undefined, memoryMode: undefined, storyCardType: undefined, targetId: target.id }, "a", a);
  expect(f).toMatchObject({ title: target.title, storyCardType: target.type, memoryMode: target.memoryMode, operation: "append" });
  expect(normalizeSinglePassFinding(groundedFinding(), "a", a)).toEqual(groundedFinding());
});
it("recovers balanced sibling sources from truncated JSON without reconstructing the last object", () => {
  const finding = { ...groundedFinding(), content: 'Literal braces { } and escaped "quotes".' };
  const first = JSON.stringify({ sourceId: "a", findings: [finding] });
  const result = parseSinglePassMemoryResponse('{"sources":[' + first + ',{"sourceId":"b","findings":[{"content":"cut', ["a", "b"]);
  expect(result.sources[0].findings[0].content).toBe(finding.content);
  expect(result.sources[0].findingIndexes).toEqual([0]); expect(result.sources[1].failureReason).toBeTruthy();
});
it("rejects duplicate and unknown source records without guessing attribution", () => {
  const result = parseSinglePassMemoryResponse('{"sources":[{"sourceId":"a","findings":[]},{"sourceId":"a","findings":[]},{"sourceId":"unknown","findings":[]},{"sourceId":"b","findings":[]}', ["a", "b", "c"]);
  expect(result.sources[0].failureReason).toBeTruthy(); expect(result.sources[1].failureReason).toBeUndefined(); expect(result.sources[2].failureReason).toBeTruthy();
  expect(result.sources[1].diagnostics?.some(d => d.reason.includes("unknown source"))).toBe(true);
});
it("does not remove unmatched thought tags or recover objects outside sources", () => {
  expect(parseSinglePassMemoryResponse('<think>{"sourceId":"a","findings":[]}', ["a"]).sources[0].failureReason).toBeTruthy();
  expect(parseSinglePassMemoryResponse('{"other":[{"sourceId":"a","findings":[]}', ["a"]).sources[0].failureReason).toBeTruthy();
});

it("does not strip unmatched thought tags to recover a source from private reasoning", () => {
  expect(parseSinglePassMemoryResponse('<think>{"sources":[{"sourceId":"a","findings":[]}]}', ["a"]).sources[0].failureReason).toBeTruthy();
});
it("does not identify a later array from an earlier sources string", () => {
  expect(parseSinglePassMemoryResponse('{"sources":"invalid","other":[{"sourceId":"a","findings":[]}', ["a"]).sources[0].failureReason).toBeTruthy();
});
