import { expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure, sanitizeAdventureForPersistence } from "../state/defaults";
import { compactMemoryGuards } from "./compactMemoryGuards";
import { snapshotFingerprint } from "../utils/snapshotFingerprint";
import { memoryTargetMatches, memoryTargetSnapshot } from "./memoryCycleState";
import { singlePassFixture } from "../test/singlePassMemory";
import { prepareSinglePassMemoryBatch } from "./singlePassMemory";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { suggestionSourceValid } from "./storyCardSuggestions";
import type { MemoryProposal, SinglePassMemoryCheckpoint } from "../types/adventure";

it("accepts legacy and compact target guards, and rejects changed/deleted destinations", () => {
  const a = createDefaultAdventure();
  const card = makeStoryCard({ id: "target", title: "History", type: "lore", content: "Original event" });
  a.storyCards = [card];
  const legacy = { kind: "storyCard" as const, id: card.id, value: JSON.stringify(card) };
  const digest = memoryTargetSnapshot(a, "storyCard", card.id)!;
  expect(digest.value).toHaveLength(78);
  for (const target of [legacy, digest]) {
    expect(memoryTargetMatches(a, target)).toBe(true);
    expect(memoryTargetMatches({ ...a, storyCards: [{ ...card, content: "Changed event" }] }, target)).toBe(false);
    expect(memoryTargetMatches({ ...a, storyCards: [] }, target)).toBe(false);
  }
});

it("converts large failed guards and resolved target copies without deleting evidence or decisions", () => {
  const { a } = singlePassFixture(1);
  const raw = JSON.stringify({ references: "context".repeat(45000) });
  const card = a.storyCards[0];
  const target = { kind: "storyCard" as const, id: card.id, value: JSON.stringify({ ...card, content: "old".repeat(10000) }) };
  const checkpoint: SinglePassMemoryCheckpoint = { batchId: "failed", sourceContent: a.messages[0].content,
    evidence: [{ id: a.messages[0].id, content: a.messages[0].content }], referenceState: raw,
    status: "failed", failureReason: "Malformed response", findings: [], dispositions: [],
    acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 };
  a.messages = Array.from({ length: 86 }, (_, i) => ({ ...a.messages[0], id: `source${i}`,
    memoryEvaluation: { pipeline: "singlePass", status: "failed", turn: i, attempts: 1, completedGroups: [], singlePass: checkpoint } }));
  a.activeState.memoryProposals = Array.from({ length: 245 }, (_, i) => ({ id: `p${i}`, sourceTurnId: "source0",
    sourceText: "Evidence remains readable", proposedType: "storyCard", storyCardType: "lore", status: i % 2 ? "rejected" : "approved",
    title: "Event", content: "Distinct fact", rationale: "Supported", confidence: 1, createdAt: "2000-01-01", updatedAt: "2000-01-01", suggestedTriggers: [],
    evaluationSource: { messages: checkpoint.evidence, target } } as MemoryProposal));
  const before = JSON.stringify(a);
  const result = compactMemoryGuards(a);
  const after = JSON.stringify(result);
  expect(after.length).toBeLessThan(before.length * 0.1);
  expect(JSON.stringify(a)).toBe(before);
  expect(compactMemoryGuards(result)).toBe(result);
  expect(result.messages[0].memoryEvaluation!.singlePass).toEqual({ ...checkpoint, referenceState: snapshotFingerprint(raw) });
  expect(result.activeState.memoryProposals[0]).toEqual({ ...a.activeState.memoryProposals[0],
    evaluationSource: { messages: checkpoint.evidence, target: { ...target, value: snapshotFingerprint(target.value) } } });
  expect(normalizeAdventure(a).messages[0].memoryEvaluation!.singlePass!.referenceState).toBe(snapshotFingerprint(raw));
  const exported = exportAdventureJson(a);
  expect(exported).not.toContain(raw);
  const loaded = importAdventureJson(exported);
  expect(loaded.messages[0].memoryEvaluation!.status).toBe("failed");
  expect(loaded.activeState.memoryProposals).toEqual(result.activeState.memoryProposals);
  console.info(`Synthetic retention regression: ${before.length} -> ${after.length} JSON code units (86 failures, 245 resolved proposals)`);
});

it("keeps live commit guards stable across persistence and retains explicit retry after reload", async () => {
  let { a, ids } = singlePassFixture(1);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  expect(batch.checkpoints[0].checkpoint.referenceState).toHaveLength(78);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const saved = sanitizeAdventureForPersistence(a);
  expect(saved.messages.find(m => m.id === ids[0])!.memoryEvaluation!.singlePass).toEqual(batch.checkpoints[0].checkpoint);
  a = reduce(saved, { type: "FAIL_SINGLE_PASS_MEMORY_BATCH", sourceIds: ids, batchId: batch.batchId, reason: "Invalid output" });
  a = normalizeAdventure(a);
  expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation).toMatchObject({ status: "failed", attempts: 1 });
  const retry = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: retry.checkpoints, manual: true });
  expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation).toMatchObject({ status: "running", attempts: 2 });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: retry.batchId,
    sources: [{ checkpoint: retry.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [], rejected: [] } }] });
  expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation!.status).toBe("complete");
});

it("resolved suppression keeps its source and destination validity checks after migration", () => {
  const a = createDefaultAdventure();
  a.storyCards = [makeStoryCard({ id: "card", title: "Fact", type: "lore", content: "Established fact" })];
  a.messages = [{ id: "source", role: "assistant", content: "Evidence", createdAt: "2000-01-01" }];
  const p = { id: "proposal", sourceTurnId: "source", sourceText: "Evidence", status: "rejected", proposedType: "storyCard",
    title: "Fact", content: "New fact", rationale: "Supported", confidence: 1, createdAt: "2000-01-01", updatedAt: "2000-01-01", suggestedTriggers: [], evaluationSource: { messages: [{ id: "source", content: "Evidence" }],
      target: { kind: "storyCard", id: "card", value: JSON.stringify(a.storyCards[0]) } } } as MemoryProposal;
  a.activeState.memoryProposals = [p];
  const compact = compactMemoryGuards(a);
  expect(suggestionSourceValid(compact, compact.activeState.memoryProposals[0])).toBe(true);
  expect(suggestionSourceValid({ ...compact, messages: [{ ...a.messages[0], content: "Edited" }] }, compact.activeState.memoryProposals[0])).toBe(false);
  expect(suggestionSourceValid({ ...compact, storyCards: [{ ...a.storyCards[0], content: "Changed" }] }, compact.activeState.memoryProposals[0])).toBe(false);
});

it("undo restores compact failed checkpoints without restoring large guard copies", () => {
  let { a, ids } = singlePassFixture(1);
  const source = a.messages.find(m => m.id === ids[0])!;
  const raw = JSON.stringify({ references: "prior context".repeat(30000) });
  source.memoryEvaluation = { ...source.memoryEvaluation!, status: "failed", attempts: 1,
    singlePass: { batchId: "old", sourceContent: source.content, evidence: [{ id: source.id, content: source.content }],
      referenceState: raw, status: "failed", findings: [], dispositions: [],
      acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 } };
  a = reduce(a, { type: "DELETE_MESSAGE", messageId: source.id });
  const saved = sanitizeAdventureForPersistence(a);
  expect(JSON.stringify(saved.activeState.storyUndoStack)).not.toContain(raw);
  a = reduce(normalizeAdventure(saved), { type: "UNDO_STORY_EDIT" });
  expect(a.messages.find(m => m.id === source.id)!.content).toBe(source.content);
  expect(a.messages.find(m => m.id === source.id)!.memoryEvaluation!.singlePass!.referenceState).toBe(snapshotFingerprint(raw));
  a = reduce(a, { type: "REDO_STORY_EDIT" });
  expect(a.messages.some(m => m.id === source.id)).toBe(false);
});
