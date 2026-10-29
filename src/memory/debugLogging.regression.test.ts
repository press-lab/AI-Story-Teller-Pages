import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createDefaultAdventure, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { compactCompletedEvaluationWithoutDebug, nextHistoryRecord } from "./memoryHistory";
import { compressHistory } from "./historyCodec";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch } from "./singlePassMemory";
import { buildContext } from "../contextBuilder/contextBuilder";
import { proposalCoverage } from "./factCoverage";
import { suggestionSourceValid } from "./storyCardSuggestions";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { runTurnPipeline } from "../state/turnPipeline";
import * as transport from "../providers/memoryCompletion";
import * as idUtils from "../utils/id";
import type { Adventure, AdventureAction, MemoryHistoryRecord } from "../types/adventure";

const logging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: false }));
vi.mock("../config/debugLogging", () => logging);
afterEach(() => { vi.restoreAllMocks(); logging.MEMORY_DEBUG_LOGGING = false; });

it("the shipped code-level default is false", async () => {
  expect((await vi.importActual<typeof import("../config/debugLogging")>("../config/debugLogging")).MEMORY_DEBUG_LOGGING).toBe(false);
});

it.each([false, true])("logging %s controls only persistent diagnostic/revision records", enabled => {
  logging.MEMORY_DEBUG_LOGGING = enabled;
  let a = createDefaultAdventure();
  a.semanticEvaluationSettings.showLog = !enabled;
  a.components = [makeComponent({ title: "Plot", id: "plot", type: "plotEssentials", content: "Original premise" })];
  a.storyCards = [makeStoryCard({ title: "Lore", id: "lore", type: "lore", content: "Original Lore", sourceTurnIds: ["old"] })];
  const actions: AdventureAction[] = [
    { type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: "d", sourceId: "s", createdAt: "2000-01-01", stage: "independent", outcome: "evaluation_completed" } },
    { type: "LOG_TRIGGER_FIRE", entry: { id: "t", triggerRuleId: "rule", triggerName: "rule", source: "input", turn: 1, matchedPattern: "door", textSnippet: "door", actionCount: 1, createdAt: "2000-01-01" } },
    { type: "LOG_EVALUATION_RESULT", entry: { id: "e", turn: 1, createdAt: "2000-01-01", conditionsEvaluated: [], conditionsFired: [], actionsExecuted: [], generatedContent: [], errors: [] } },
  ];
  for (const action of actions) {
    const before = a; a = reduce(a, action);
    if (!enabled) expect(a).toBe(before);
  }
  a = reduce(a, { type: "APPLY_COMPONENT_UPDATE", componentId: "plot", content: "Updated premise" });
  a = reduce(a, { type: "APPLY_STORY_CARD_UPDATE", storyCardId: "lore", content: "New fact" });
  expect(a.components[0].content).toBe("Updated premise");
  expect(a.storyCards[0].content).toContain("New fact");
  expect(a.storyCards[0].sourceTurnIds).toEqual(["old"]);
  for (const entry of [a.storyCards[0], a.components[0]]) {
    expect(entry.lastMemoryUpdatedAt).toBeTruthy();
    expect(entry.memoryUpdateHistory?.length ?? 0).toBe(enabled ? 1 : 0);
  }
  expect(a.activeState.memoryDiagnostics?.length ?? 0).toBe(enabled ? 1 : 0);
  expect(a.activeState.triggerLog.length).toBe(enabled ? 1 : 0);
  expect(a.activeState.evaluationLog.length).toBe(enabled ? 1 : 0);
  if (enabled) {
    logging.MEMORY_DEBUG_LOGGING = false;
    const oldHistory = a.storyCards[0].memoryUpdateHistory;
    a = reduce(a, { type: "APPLY_STORY_CARD_UPDATE", storyCardId: "lore", content: "Another fact" });
    expect(a.storyCards[0].memoryUpdateHistory).toBe(oldHistory);
    expect(a.activeState.triggerLog).toHaveLength(1);
  }
});

it.each(["REJECT_MEMORY_PROPOSAL", "IGNORE_MEMORY_PROPOSAL", "APPROVE_MEMORY_PROPOSAL"] as const)("OFF preserves coverage and subsequent decisions after %s and cleanup", async type => {
  let { a, ids } = singlePassFixture(1);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [groundedFinding()], rejected: [] } }] });
  const proposal = a.activeState.memoryProposals[0];
  expect(proposal.status).toBe("pending");
  a = reduce(a, { type, proposalId: proposal.id });
  const resolved = a.activeState.memoryProposals[0];
  vi.spyOn(Math, "random").mockReturnValue(0.42);
  vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.spyOn(idUtils, "nowIso").mockReturnValue("2000-01-01T00:00:00.000Z");
  const clean = reduce(a, { type: "PRUNE_DEBUG_HISTORY" });
  expect(clean.activeState.memoryProposals[0]).toBe(resolved);
  expect(suggestionSourceValid(clean, resolved)).toBe(suggestionSourceValid(a, resolved));
  expect(proposalCoverage(clean, { ...proposal, id: "duplicate" })).toBe(true);
  expect(reduce(clean, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, id: "duplicate" } }).activeState.memoryProposals).toHaveLength(1);
  expect(reduce(clean, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id }).storyCards)
    .toEqual(reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id }).storyCards);
});

it("compacts completed records purely and leaves unfinished guards intact", async () => {
  const { a, ids } = singlePassFixture(1);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const e = { ...a.messages.find(m => m.id === ids[0])!.memoryEvaluation!, singlePass: batch.checkpoints[0].checkpoint };
  for (const status of ["running", "failed", "pending", "quarantined"] as const) {
    const unfinished = { ...e, status };
    expect(compactCompletedEvaluationWithoutDebug(unfinished)).toBe(unfinished);
  }
  const completed = { ...e, status: "complete" as const, completedGroups: ["plot", "brains", "storyCards", "discovery"] as const };
  const input = { ...completed, completedGroups: [...completed.completedGroups] };
  const serialized = JSON.stringify(input), compact = compactCompletedEvaluationWithoutDebug(input);
  expect(JSON.stringify(input)).toBe(serialized);
  expect(compact).toMatchObject({ turn: input.turn, attempts: input.attempts, revision: input.revision, completedGroups: input.completedGroups, singlePass: { batchId: batch.batchId, referenceState: "", sourceContent: "", evidence: [] } });
  expect(JSON.stringify(compact).length).toBeLessThan(serialized.length);
});

it.each([false, true])("explicit cleanup logging %s keeps resumable content, old source markers and pending/failed work", async enabled => {
  logging.MEMORY_DEBUG_LOGGING = true;
  let { a, ids } = singlePassFixture(3);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[2].checkpoint, result: { sourceId: ids[2], findings: [groundedFinding()], rejected: [] } }] });
  a = reduce(a, { type: "FAIL_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sourceIds: [ids[0]], reason: "interrupted" });
  a.components = [makeComponent({ title: "Plot", id: "plot", type: "plotEssentials", content: "The premise" })];
  a = reduce(a, { type: "APPLY_COMPONENT_UPDATE", componentId: "plot", content: "The updated premise" });
  a = reduce(a, { type: "APPLY_STORY_CARD_UPDATE", storyCardId: a.storyCards[0].id, content: "An enduring fact" });
  const old = a.messages.find(m => m.role === "assistant" && !m.memoryEvaluation)!;
  a = reduce(a, { type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: "legacy", sourceId: old.id, createdAt: "2000-01-01", stage: "independent", outcome: "evaluation_completed", reason: "Old historical marker" } });
  const record: MemoryHistoryRecord = { kind: "evaluation", id: ids[2], value: a.messages.find(m => m.id === ids[2])!.memoryEvaluation! };
  a = reduce(a, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: a.id, record, block: await compressHistory(record) });
  logging.MEMORY_DEBUG_LOGGING = enabled;
  const before = JSON.stringify(a), clean = reduce(a, { type: "PRUNE_DEBUG_HISTORY" });
  expect(JSON.stringify(a)).toBe(before);
  expect(JSON.stringify(clean).length).toBeLessThan(before.length);
  expect(clean.messages.map(({ id, role, content }) => ({ id, role, content }))).toEqual(a.messages.map(({ id, role, content }) => ({ id, role, content })));
  expect(clean.storyCards.map(({ memoryUpdateHistory: _h, ...c }) => c)).toEqual(a.storyCards.map(({ memoryUpdateHistory: _h, ...c }) => c));
  expect(clean.components.map(({ memoryUpdateHistory: _h, ...c }) => c)).toEqual(a.components.map(({ memoryUpdateHistory: _h, ...c }) => c));
  expect(clean.brains).toBe(a.brains);
  expect(clean.activeState.memoryProposals).toEqual(a.activeState.memoryProposals);
  for (const key of ["storyUndoStack", "storyRedoStack", "apiCalls", "apiCallTotals", "backgroundTokenUsage", "pendingBrainDeltas"] as const) expect(clean.activeState[key]).toBe(a.activeState[key]);
  for (const id of ids.slice(0, 2)) expect(clean.messages.find(m => m.id === id)!.memoryEvaluation).toBe(a.messages.find(m => m.id === id)!.memoryEvaluation);
  expect(clean.activeState.compressedMemoryHistory).toBeUndefined();
  expect(clean.messages.every(m => !m.memoryEvaluation?.archivedMemoryHistoryId)).toBe(true);
  expect(clean.activeState.memoryDiagnostics).toEqual([]);
  expect(clean.activeState.legacyMemoryEvaluationSourceIds).toContain(old.id);
  const editOld = (state: Adventure) => reduce(state, { type: "UPDATE_MESSAGE", messageId: old.id, content: old.content + " Corrected." });
  expect(editOld(clean).messages.find(m => m.id === old.id)?.memoryEvaluation?.status).toBe(editOld(a).messages.find(m => m.id === old.id)?.memoryEvaluation?.status);
  const imported = importAdventureJson(exportAdventureJson(clean));
  // Imported interrupted work becomes explicitly retryable, never automatically replayed.
  expect(imported.messages.find(m => m.id === ids[1])!.memoryEvaluation?.status).toBe("failed");
  const retry = await prepareSinglePassMemoryBatch(imported, [ids[0]]);
  const claimed = reduce(imported, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: retry.checkpoints, manual: true });
  const continued = reduce(claimed, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: retry.batchId, sources: [{ checkpoint: retry.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [], rejected: [] } }] });
  expect(continued.messages.find(m => m.id === ids[0])!.memoryEvaluation?.status).toBe("complete");
  if (enabled) {
    const completed = continued.messages.find(m => m.id === ids[0])!.memoryEvaluation!;
    expect(completed.debugHistoryOmitted).toBeUndefined();
    const record: MemoryHistoryRecord = { kind: "evaluation", id: ids[0], value: completed };
    const archived = reduce(continued, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: continued.id, record, block: await compressHistory(record) });
    expect(archived.messages.find(m => m.id === ids[0])!.memoryEvaluation?.archivedMemoryHistoryId).toBeTruthy();
  }
  expect(buildContext(clean).messages).toEqual(buildContext(a).messages);
});

/** Same scripted providers, actual preparation/validation/reducer/context paths.
 * Accounting records are synthetic; no paid network requests are made.
 */
async function tenTurns(initial: Adventure, enabled: boolean) {
  logging.MEMORY_DEBUG_LOGGING = enabled;
  let a = initial;
  const payloads: unknown[] = [];
  const counters: Record<string, number> = {};
  vi.spyOn(idUtils, "createId").mockImplementation(prefix => `${prefix}_simulation_${counters[prefix] = (counters[prefix] ?? 0) + 1}`);
  vi.spyOn(idUtils, "nowIso").mockReturnValue("2000-01-01T00:00:00.000Z");
  const memory = vi.spyOn(transport, "sendMemoryCompletion");
  let requests = 0;
  const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };
  for (let turn = 1; turn <= 10; turn++) {
    const content = `The workshop signed agreement number ${turn}.`;
    a = (await runTurnPipeline({ adventure: a, text: `Inspect agreement ${turn}.`, userMessageId: `sim-user-${turn}`, assistantMessageId: `sim-source-${turn}`,
      sendChatCompletion: async messages => { requests++; payloads.push(messages); return { content, usage }; } })).adventure;
    const batch = await prepareSinglePassMemoryBatch(a, [`sim-source-${turn}`]);
    a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    memory.mockImplementationOnce(async (_a, _config, messages) => {
      requests++; payloads.push(messages);
      return { raw: {}, usage, content: JSON.stringify({ sources: [{ sourceId: `sim-source-${turn}`, findings: [{ ...groundedFinding(), title: `Workshop agreement ${turn}`, content, evidenceQuotes: [{ messageId: `sim-source-${turn}`, quote: content }] }] }] }) };
    });
    const response = await runSinglePassMemoryBatch(a, a.modelConfig, batch);
    a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: response.sources.map(result => ({ result, checkpoint: batch.checkpoints[0].checkpoint })) });
    expect(a.messages.find(m => m.id === `sim-source-${turn}`)!.memoryEvaluation?.status).toBe("complete");
    for (const p of a.activeState.memoryProposals.filter(p => p.sourceTurnId === `sim-source-${turn}` && p.status === "pending")) a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    if (a.components.some(c => c.id === "simulation-plot")) a = reduce(a, { type: "APPLY_COMPONENT_UPDATE", componentId: "simulation-plot", content: `Premise progress ${turn}.` });
    for (const purpose of ["narration", "memoryEvaluation"] as const) a = reduce(a, { type: "RECORD_API_CALL", record: { id: `sim-api-${purpose}-${turn}`, purpose, startedAt: "2000-01-01", status: "succeeded", model: purpose === "narration" ? "scripted-narrator" : "scripted-memory", provider: "offline", usage } });
    a = reduce(a, { type: "ACCUMULATE_BACKGROUND_TOKENS", promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
    if (enabled) {
      const attempted = new WeakSet<object>(); let record;
      while ((record = nextHistoryRecord(a, attempted))) {
        attempted.add(record.value);
        a = reduce(a, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: a.id, record, block: await compressHistory(record) });
      }
    }
  }
  vi.restoreAllMocks();
  return { a, payloads, requests };
}

it("ten identical turns preserve payloads, API counts, costs and memories in both modes", async () => {
  const a = createDefaultAdventure();
  a.memoryDetectionSettings = { ...a.memoryDetectionSettings, enabled: true, pipeline: "singlePass", everyNTurns: 1 };
  a.components = [makeComponent({ title: "Plot", id: "simulation-plot", type: "plotEssentials", content: "Initial premise", autoUpdate: true })];
  const off = await tenTurns(a, false), on = await tenTurns(a, true);
  expect(off.requests).toBe(20); expect(on.requests).toBe(20);
  expect(off.payloads).toEqual(on.payloads);
  expect(off.a.activeState.apiCalls).toEqual(on.a.activeState.apiCalls);
  expect(off.a.activeState.apiCallTotals).toEqual(on.a.activeState.apiCallTotals);
  expect(off.a.activeState.backgroundTokenUsage).toEqual(on.a.activeState.backgroundTokenUsage);
  expect(off.a.storyCards.map(c => c.content)).toEqual(on.a.storyCards.map(c => c.content));
  expect(off.a.storyCards).toHaveLength(10);
  expect(off.a.activeState.compressedMemoryHistory).toBeUndefined();
  expect(Object.keys(on.a.activeState.compressedMemoryHistory!.blocks).length).toBeGreaterThan(0);
});

const fixturePath = process.env.AIST_DEBUG_LOGGING_SAVE_FIXTURE;
it.skipIf(!fixturePath)("compares private large-save cleanup and ten-turn growth without copying private contents", async () => {
  const original = readFileSync(fixturePath!);
  const hash = createHash("sha256").update(original).digest("hex");
  const parsed = JSON.parse(original.toString("utf8"));
  const a = importAdventureJson(JSON.stringify(parsed.adventure ?? parsed));
  const clean = reduce(a, { type: "PRUNE_DEBUG_HISTORY" });
  expect(buildContext(clean).messages).toEqual(buildContext(a).messages);
  expect(clean.activeState.memoryProposals.map(p => suggestionSourceValid(clean, p)))
    .toEqual(a.activeState.memoryProposals.map(p => suggestionSourceValid(a, p)));
  // Identical explicit simulation controls; do not modify private fixtures on disk.
  const start = { ...clean, memoryDetectionSettings: { ...clean.memoryDetectionSettings, enabled: true, pipeline: "singlePass" as const, everyNTurns: 1 },
    components: [...clean.components, makeComponent({ title: "Plot", id: "simulation-plot", type: "plotEssentials", content: "Initial simulated premise", autoUpdate: true })] };
  const off = await tenTurns(start, false), on = await tenTurns(start, true);
  const bytes = (value: Adventure) => Buffer.byteLength(exportAdventureJson(value));
  const report = { originalFileBytes: original.length, normalizedJsonBytes: bytes(a), afterCleanupJsonBytes: bytes(clean),
    tenTurnGrowthOffBytes: bytes(off.a) - bytes(start), tenTurnGrowthOnBytes: bytes(on.a) - bytes(start),
    apiRequestsOff: off.requests, apiRequestsOn: on.requests,
    caveat: "Ten scripted narration and ten scripted single-pass requests per mode; synthetic usage, no live provider charges. ON includes background archive compression." };
  console.log("DEBUG_LOGGING_SIZE_COMPARISON " + JSON.stringify(report));
  expect(off.payloads).toEqual(on.payloads);
  expect(off.a.activeState.apiCalls).toEqual(on.a.activeState.apiCalls);
  expect(report.afterCleanupJsonBytes).toBeLessThan(report.normalizedJsonBytes);
  expect(report.tenTurnGrowthOffBytes).toBeLessThan(report.tenTurnGrowthOnBytes);
  expect(createHash("sha256").update(readFileSync(fixturePath!)).digest("hex")).toBe(hash);
}, 120_000);

it("undo restores an archived message safely after cleanup without rewriting story edit history", async () => {
  logging.MEMORY_DEBUG_LOGGING = true;
  let { a, ids } = singlePassFixture(1);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [], rejected: [] } }] });
  const record: MemoryHistoryRecord = { kind: "evaluation", id: ids[0], value: a.messages.at(-1)!.memoryEvaluation! };
  a = reduce(a, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: a.id, record, block: await compressHistory(record) });
  const original = a.messages.at(-1)!;
  a = reduce(a, { type: "DELETE_MESSAGE", messageId: ids[0] });
  const clean = reduce(a, { type: "PRUNE_DEBUG_HISTORY" });
  expect(clean.activeState.storyUndoStack).toBe(a.activeState.storyUndoStack);
  const undo = reduce(clean, { type: "UNDO_STORY_EDIT" });
  expect(undo.messages.at(-1)!.content).toBe(original.content);
  expect(undo.messages.at(-1)!.memoryEvaluation?.archivedMemoryHistoryId).toBeUndefined();
  expect(undo.messages.at(-1)!.memoryEvaluation?.status).toBe("complete");
  expect(reduce(undo, { type: "REDO_STORY_EDIT" }).messages).toEqual(clean.messages);
});

it("cleanup preserves running validation even with legacy Momentum revision history", async () => {
  logging.MEMORY_DEBUG_LOGGING = true;
  let { a, ids } = singlePassFixture(1);
  a.components.push(makeComponent({ id: "momentum", title: "Momentum", type: "immediateMomentum", content: "Old momentum", autoUpdate: true }));
  a = reduce(a, { type: "APPLY_COMPONENT_UPDATE", componentId: "momentum", content: "Updated momentum" });
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "PRUNE_DEBUG_HISTORY" });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [], rejected: [] } }] });
  expect(a.messages.at(-1)!.memoryEvaluation?.status).toBe("complete");
});

it.each([false, true])("legacy group completion compacts only after the final validated group with logging %s", enabled => {
  logging.MEMORY_DEBUG_LOGGING = enabled;
  const a = createDefaultAdventure();
  a.messages = [{ id: "legacy", role: "assistant", content: "A durable event.", createdAt: "2000-01-01", memoryEvaluation: {
    turn: 1, attempts: 1, status: "running", completedGroups: ["plot", "storyCards", "brains"],
    groupWork: { discovery: { fingerprint: "exact", drafts: {} } } } }];
  const action: AdventureAction = { type: "COMMIT_MEMORY_EVALUATION_GROUP", source: { id: "legacy", content: a.messages[0].content }, group: "discovery", dependencies: [], targets: [], actions: [] };
  const final = reduce(a, action).messages[0].memoryEvaluation!;
  expect(final.status).toBe("complete"); expect(final.completedGroups).toHaveLength(4);
  expect(final.debugHistoryOmitted).toBe(enabled ? undefined : true);
  if (!enabled) expect(final.groupWork).toBeUndefined();
});
