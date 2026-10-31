import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { compressHistory, decompressHistory } from "./historyCodec";
import { eligibleHistory, nextHistoryRecord } from "./memoryHistory";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { normalizeAdventure } from "../state/defaults";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { prepareSinglePassMemoryBatch, singlePassReferenceState, buildSinglePassMemoryMessages, parseSinglePassMemoryResponse } from "./singlePassMemory";
import { buildContext } from "../contextBuilder/contextBuilder";
import { proposalCoverage, relevantProposalCoverage } from "./factCoverage";
import { suggestionSourceValid, equivalentStoryCardSuggestions, makeStoryCardSuggestion, scanStoryCardExchange } from "./storyCardSuggestions";
import { memoryTargetSnapshot } from "./memoryCycleState";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { displayedBrainThoughts } from "./displayedBrainThoughts";
import type { Adventure, MemoryHistoryRecord, MemoryProposal } from "../types/adventure";

afterEach(() => vi.restoreAllMocks());
export async function archiveAll(initial: Adventure) {
  let a = initial;
  let record: MemoryHistoryRecord | undefined;
  const attempted = new WeakSet<object>();
  while ((record = nextHistoryRecord(a, attempted))) {
    attempted.add(record.value);
    a = reduce(a, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: a.id, record, block: await compressHistory(record) });
  }
  return a;
}
export async function expandAll(initial: Adventure) {
  let a = { ...initial, activeState: { ...initial.activeState, compressedMemoryHistory: undefined } };
  for (const block of Object.values(initial.activeState.compressedMemoryHistory?.blocks ?? {})) {
    const r = await decompressHistory(block);
    if (r.kind === "proposal") a = { ...a, activeState: { ...a.activeState, memoryProposals: a.activeState.memoryProposals.map(p => p.id === r.id ? r.value : p) } };
    else a = { ...a, messages: a.messages.map(m => m.id === r.id ? { ...m, memoryEvaluation: r.value } : m) };
  }
  return a;
}
function fixture() {
  const { a, ids } = singlePassFixture();
  const m = a.messages.find(m => m.id === ids[0])!;
  m.memoryEvaluation = { ...m.memoryEvaluation!, status: "complete", singlePass: {
    batchId: "past", sourceContent: m.content, evidence: [{ id: m.id, content: m.content }],
    referenceState: singlePassReferenceState(a, m.id).repeat(3), status: "complete", findings: [groundedFinding()],
    dispositions: [{ index: 0, status: "review", reason: "Exact evidence" }], acceptedCount: 0, reviewCount: 1, suppressedCount: 0, rejectedCount: 0 } };
  const f = groundedFinding();
  const proposal = makeStoryCardSuggestion(a, ids.at(-1)!, a.messages.at(-1)!.content, {
    title: f.title!, content: f.content!, evidence: f.evidenceQuotes[0].quote, reason: f.reason!, participants: f.participants });
  proposal.placementValidation = { version: 3, kind: "create", reason: "Reviewed", newFact: f.content!,
    fingerprint: "opaque snapshot \ud800 \n".repeat(200), sources: [{ id: proposal.sourceTurnId, content: a.messages.at(-1)!.content }] };
  a.activeState.memoryProposals = ["approved", "rejected", "ignored", "pending"].map((status, i) => ({ ...proposal, id: `p${i}`, status: status as MemoryProposal["status"] }));
  return { a, ids, proposal };
}
describe("portable finalized memory history", () => {
  it("round-trips every field, code unit, optional undefined, unknown metadata and property order", async () => {
    const p = makeMemoryProposal({ status: "approved", sourceText: "\ud800 \u{1f600} e\u0301\r\n\u0000", targetId: undefined });
    const record: MemoryHistoryRecord = { kind: "proposal", id: p.id, value: Object.assign(p, { unknown: { optional: undefined, array: ["object", undefined, -0, NaN], sparse: new Array(3) } }) };
    const b = await compressHistory(record);
    const decoded = await decompressHistory(JSON.parse(JSON.stringify(b)));
    expect(decoded).toStrictEqual(record);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(record));
    expect(gunzipSync(Buffer.from(b.data, "base64")).length).toBe(b.decodedBytes);
  });
  it("keeps narrator and memory payloads, exact guards, routing and considered facts identical", async () => {
    const { a, ids, proposal } = fixture();
    const archived = await archiveAll(a);
    expect(await expandAll(archived)).toStrictEqual({ ...a, activeState: { ...a.activeState, compressedMemoryHistory: undefined } });
    expect(buildContext(archived)).toEqual(buildContext(a));
    const before = await prepareSinglePassMemoryBatch(a, [ids.at(-1)!]);
    const after = await prepareSinglePassMemoryBatch(archived, [ids.at(-1)!]);
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));
    expect(JSON.stringify(buildSinglePassMemoryMessages(after))).toBe(JSON.stringify(buildSinglePassMemoryMessages(before)));
    expect(singlePassReferenceState(archived, ids.at(-1)!)).toBe(singlePassReferenceState(a, ids.at(-1)!));
    const reply = JSON.stringify({ sources: [{ sourceId: ids.at(-1), findings: [groundedFinding()] }] });
    expect(parseSinglePassMemoryResponse(reply, [ids.at(-1)!])).toEqual(parseSinglePassMemoryResponse(reply, [ids.at(-1)!]));
    expect(proposalCoverage(archived, proposal)).toBe(proposalCoverage(a, proposal));
    expect(relevantProposalCoverage(archived, proposal.content, [], ids)).toEqual(relevantProposalCoverage(a, proposal.content, [], ids));
    expect(scanStoryCardExchange(archived, a.messages.at(-1)!)).toEqual(scanStoryCardExchange(a, a.messages.at(-1)!));
    for (let i = 0; i < 4; i++) {
      const p = a.activeState.memoryProposals[i], q = archived.activeState.memoryProposals[i];
      expect(suggestionSourceValid(archived, q)).toBe(suggestionSourceValid(a, p));
      expect(equivalentStoryCardSuggestions(proposal, q)).toBe(equivalentStoryCardSuggestions(proposal, p));
      expect(displayedBrainThoughts(archived, a.messages.at(-1)!)).toEqual(displayedBrainThoughts(a, a.messages.at(-1)!));
    }
    const add = { type: "ADD_MEMORY_PROPOSAL" as const, proposal: { ...proposal, id: "incoming" } };
    const clock = vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2000-01-01T00:00:00.000Z");
    const left = reduce(a, add), right = reduce(archived, add);
    expect(right.activeState.memoryProposals.map(p => [p.id, p.status, p.content])).toEqual(left.activeState.memoryProposals.map(p => [p.id, p.status, p.content]));
    expect(right.activeState.memoryDiagnostics?.at(-1)?.reason).toBe(left.activeState.memoryDiagnostics?.at(-1)?.reason);
    clock.mockRestore();
  });
  it.each(["approved", "rejected", "ignored"] as const)("keeps source/destination validity and decisions for %s proposals", async status => {
    const { a, ids } = fixture();
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2000-01-01T00:00:00.000Z");
    const p = a.activeState.memoryProposals[0]; p.status = status;
    p.targetId = a.storyCards[0].id;
    p.evaluationSource = { messages: [{ id: ids[0], content: a.messages.find(m => m.id === ids[0])!.content }], target: memoryTargetSnapshot(a, "storyCard", p.targetId) };
    const archived = await archiveAll(a), q = archived.activeState.memoryProposals[0];
    expect(suggestionSourceValid(archived, q)).toBe(suggestionSourceValid(a, p));
    for (const input of [a, archived]) {
      input.storyCards = input.storyCards.map(c => c.id === p.targetId ? { ...c, content: "Changed" } : c);
      input.messages = input.messages.map(m => m.id === ids[0] ? { ...m, content: "Edited evidence" } : m);
    }
    expect(suggestionSourceValid(archived, q)).toBe(suggestionSourceValid(a, p));
    for (const type of ["APPROVE_MEMORY_PROPOSAL", "REJECT_MEMORY_PROPOSAL", "IGNORE_MEMORY_PROPOSAL", "UPDATE_MEMORY_PROPOSAL"] as const) {
      const action = type === "UPDATE_MEMORY_PROPOSAL" ? { type, proposalId: p.id, patch: { content: "Edited draft" } } : { type, proposalId: p.id };
      const before = reduce(a, action);
      const after = reduce(archived, { type: "APPLY_ARCHIVED_PROPOSAL_ACTION", adventureId: a.id, archiveId: q.archivedMemoryHistoryId!, proposal: p, action });
      expect(after.storyCards).toEqual(before.storyCards);
      expect(after.activeState.memoryProposals[0].status).toBe(before.activeState.memoryProposals[0].status);
      expect(after.activeState.memoryProposals[0].content).toBe(before.activeState.memoryProposals[0].content);
    }
  });
  it("never archives pending, running, failed or quarantined work, including partial retries", async () => {
    const { a, ids } = fixture();
    for (const status of ["pending", "running", "failed", "quarantined"] as const) {
      const value = { ...a.messages.find(m => m.id === ids[0])!.memoryEvaluation!, status,
        groupWork: { brains: { fingerprint: "unchanged evidence and controls", drafts: { target: { raw: "successful draft awaiting retry", validationCache: { evidence: "completed review" }, result: { actions: [], error: "transport interrupted" } } } } } };
      const record: MemoryHistoryRecord = { kind: "evaluation", id: ids[0], value };
      expect(eligibleHistory(record)).toBe(false);
      const input = { ...a, messages: a.messages.map(m => m.id === ids[0] ? { ...m, memoryEvaluation: value } : m) };
      const archived = await archiveAll(input);
      expect(archived.messages.find(m => m.id === ids[0])!.memoryEvaluation).toBe(value);
      expect(archived.activeState.memoryProposals.at(-1)).toBe(a.activeState.memoryProposals.at(-1));
    }
  });
  it("rejects stale results, switched adventures, changed statuses, duplicates and interrupted work", async () => {
    const { a, ids } = fixture();
    const record: MemoryHistoryRecord = { kind: "evaluation", id: ids[0], value: a.messages.find(m => m.id === ids[0])!.memoryEvaluation! };
    const block = await compressHistory(record);
    const action = { type: "ARCHIVE_MEMORY_HISTORY" as const, adventureId: a.id, record, block };
    expect(a.activeState.compressedMemoryHistory).toBeUndefined(); // no result/commit => original untouched
    const switched = { ...a, id: "other" }; expect(reduce(switched, action)).toBe(switched);
    const edited = reduce(a, { type: "UPDATE_MESSAGE", messageId: ids[0], content: "Changed" });
    expect(reduce(edited, action)).toBe(edited);
    const latest = { ...a, title: "User edited title" };
    const archived = reduce(latest, action); expect(archived.title).toBe(latest.title);
    expect(reduce(archived, action)).toBe(archived);
    expect(await decompressHistory(block)).toStrictEqual(record);
  });
  it("retains compression completed during narration and all earlier versions across source retry", async () => {
    const { a, ids } = fixture();
    const archived = await archiveAll(a);
    const narrativeResult = { ...a, title: "New narrated state", messages: [...a.messages, { id: "new", role: "assistant" as const, content: "New narration", createdAt: "2000-01-01" }] };
    const merged = reduce(narrativeResult, { type: "MERGE_MEMORY_HISTORY_PROGRESS", baseline: a, latest: archived });
    expect(merged.activeState.compressedMemoryHistory).toEqual(archived.activeState.compressedMemoryHistory);
    expect(merged.messages.at(-1)?.content).toBe("New narration");
    expect(merged.activeState.memoryProposals).toEqual(archived.activeState.memoryProposals);
    expect(merged.messages.find(m => m.id === ids[0])!.memoryEvaluation).toBe(archived.messages.find(m => m.id === ids[0])!.memoryEvaluation);
    const changed = reduce(archived, { type: "UPDATE_MESSAGE", messageId: ids[0], content: "Edited historical source" });
    const batch = await prepareSinglePassMemoryBatch(changed, [ids[0]]);
    const claimed = reduce(changed, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints, manual: true });
    expect(claimed.messages.find(m => m.id === ids[0])!.memoryEvaluation!.status).toBe("running");
    expect(claimed.messages.find(m => m.id === ids[0])!.memoryEvaluation!.archivedMemoryHistoryId).toBeUndefined();
    expect(claimed.activeState.compressedMemoryHistory).toBe(archived.activeState.compressedMemoryHistory);
  });
  it("rejects corrupt gzip, wrong digests, record identities, unknown versions and oversized data", async () => {
    const p = makeMemoryProposal(); const b = await compressHistory({ kind: "proposal", id: p.id, value: p });
    for (const corrupt of [{ ...b, data: "!!!!" }, { ...b, data: Buffer.from(gzipSync("corrupt payload")).toString("base64") },
      { ...b, sha256: "0".repeat(64) }, { ...b, recordId: "wrong" }, { ...b, version: 2 }, { ...b, decodedBytes: 33 * 1024 * 1024 }]) {
      await expect(decompressHistory(corrupt as typeof b)).rejects.toThrow("memory_history_invalid");
    }
  });
  it("supports old, mixed and archived JSON imports, duplicate imports and portable complete exports", async () => {
    const { a } = fixture();
    const old = importAdventureJson(exportAdventureJson(a));
    const r = nextHistoryRecord(old, new WeakSet())!;
    const mixed = reduce(old, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: old.id, record: r, block: await compressHistory(r) });
    for (const input of [old, mixed, await archiveAll(old)]) {
      const exported = exportAdventureJson(input);
      const imported = importAdventureJson(exported), duplicate = importAdventureJson(exported, true);
      expect(imported.activeState.compressedMemoryHistory).toEqual(input.activeState.compressedMemoryHistory);
      expect(duplicate.id).not.toBe(input.id);
      expect(duplicate.activeState.compressedMemoryHistory).toEqual(input.activeState.compressedMemoryHistory);
      expect((await expandAll(imported)).messages).toEqual(normalizeAdventure(old).messages);
    }
  });
});
const privateFixture = process.env.STORY_TELLER_SAVE_FIXTURE;
it.skipIf(!privateFixture)("benchmarks the private save without writing its content", async () => {
  const original = readFileSync(privateFixture!);
  const hash = createHash("sha256").update(original).digest("hex");
  const a = importAdventureJson(original.toString("utf8"));
  const before = exportAdventureJson(a);
  const start = performance.now();
  const archived = await archiveAll(a);
  const compressionMs = performance.now() - start;
  const after = exportAdventureJson(archived);
  expect(JSON.stringify(await expandAll(archived))).toBe(JSON.stringify({ ...a, activeState: { ...a.activeState, compressedMemoryHistory: undefined } }));
  expect(buildContext(archived)).toEqual(buildContext(a));
  for (const p of a.activeState.memoryProposals) {
    expect(suggestionSourceValid(archived, archived.activeState.memoryProposals.find(q => q.id === p.id)!)).toBe(suggestionSourceValid(a, p));
    expect(proposalCoverage(archived, p)).toBe(proposalCoverage(a, p));
  }
  const unfinished = a.messages.filter(m => m.role === "assistant" && m.memoryEvaluation?.pipeline === "singlePass" && ["failed", "pending"].includes(m.memoryEvaluation.status)).slice(-3).map(m => m.id);
  if (unfinished.length) {
    expect(JSON.stringify((await prepareSinglePassMemoryBatch(archived, unfinished)).payload)).toBe(JSON.stringify((await prepareSinglePassMemoryBatch(a, unfinished)).payload));
  }
  function measure(task: () => unknown) { const times = Array.from({ length: 3 }, () => { const t = performance.now(); task(); return performance.now() - t; }); return times.sort((a,b) => a-b)[1]; }
  const report = { originalFileBytes: original.length, baselineJsonBytes: Buffer.byteLength(before), archivedJsonBytes: Buffer.byteLength(after),
    reductionPercent: 100 * (1 - Buffer.byteLength(after) / Buffer.byteLength(before)), compressionMs,
    blocks: Object.keys(archived.activeState.compressedMemoryHistory!.blocks).length,
    originalParseMs: measure(() => JSON.parse(before)), archivedParseMs: measure(() => JSON.parse(after)),
    originalSerializeMs: measure(() => exportAdventureJson(a)), archivedSerializeMs: measure(() => exportAdventureJson(archived)),
    originalCloneMs: measure(() => structuredClone(a)), archivedCloneMs: measure(() => structuredClone(archived)),
    sourceUnchanged: createHash("sha256").update(readFileSync(privateFixture!)).digest("hex") === hash,
    environment: "Desktop Node; no mobile/browser timing claims" };
  console.log(JSON.stringify(report));
  if (process.env.STORY_TELLER_VALIDATION_REPORT) writeFileSync(process.env.STORY_TELLER_VALIDATION_REPORT, JSON.stringify(report, null, 2));
  expect(report.sourceUnchanged).toBe(true);
  expect(report.archivedJsonBytes).toBeLessThan(report.baselineJsonBytes);
}, 120_000);

// These legacy assertions inspect detailed logging. OFF contracts are tested separately.
const debugLogging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: true }));
vi.mock("../config/debugLogging", () => debugLogging);

it("OFF does not scan completed evaluations or resolved proposals for new archives", async () => {
  debugLogging.MEMORY_DEBUG_LOGGING = false;
  try {
    const { a } = fixture();
    expect(nextHistoryRecord(a, new WeakSet())).toBeUndefined();
    const p = a.activeState.memoryProposals[0];
    const record: MemoryHistoryRecord = { kind: "proposal", id: p.id, value: p };
    expect(reduce(a, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: a.id, record, block: await compressHistory(record) })).toBe(a);
  } finally { debugLogging.MEMORY_DEBUG_LOGGING = true; }
});

// Isolated legacy writer coverage; this override never applies to the shipped build.
vi.mock("../config/memoryHistoryCompression", () => ({ ENABLE_HISTORY_COMPRESSION: true }));
