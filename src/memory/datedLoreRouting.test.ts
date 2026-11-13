import { routeDatedLoreProposal } from "./datedLoreRouting";
import { expect, it } from "vitest";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { makeStoryCard } from "../state/defaults";
import { prepareSinglePassMemoryBatch } from "./singlePassMemory";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { placementValidationError } from "./storyCardPlacement";

it.each(["same", "different", "missing", "fantasy"])("routes dated Lore by title and occurrence: %s", async mode => {
  let { a, ids } = singlePassFixture(1);
  a.memoryAutoApprove.loreStoryCard = true;
  const time = mode === "fantasy" ? { text: "Imperial Year 417, 1 Harvestfall", date: "0417-09-01", precision: "day" as const }
    : { text: "2001-09-05", date: "2001-09-05", precision: "day" as const };
  const oldDate = { text: "2001-09-03", date: "2001-09-03", precision: "day" as const };
  a.storyClock = { current: time, anchor: time, origin: "established" };
  a.messages.find(m => m.id === ids[0])!.storyTime = time;
  const old = makeStoryCard({ id: "old-event", title: "Workshop collaboration agreement", type: "lore", content: "An older agreement expired.",
    lore: { status: "completed", sourceMessageIds: [], ...(mode === "missing" ? {} : { occurredAt: oldDate, lastChangedAt: time }) } });
  const same = makeStoryCard({ id: "correct-event", title: old.title, type: "lore", content: "They reserved a workshop.",
    lore: { status: "ongoing", sourceMessageIds: [], occurredAt: time } });
  a.storyCards = mode === "same" ? [old, same] : [old];
  const before = structuredClone(old);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  // Even a model-selected wrong-date destination is corrected locally.
  const finding = { ...groundedFinding(), targetId: old.id, operation: "append" as const };
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId,
    sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [finding], rejected: [] } }] });
  const p = a.activeState.memoryProposals[0];
  expect(p).toMatchObject({ title: `[${time.text}] ${old.title}`, status: "approved", requiresReview: false, cardOperation: mode === "same" ? "append" : "create",
    lore: { occurredAt: time, lastChangedAt: time } });
  expect(p.targetId).toBe(mode === "same" ? same.id : undefined);
  expect(placementValidationError(a, p)).not.toBe("The draft or destination changed since placement was validated.");
  expect(a.storyCards.find(c => c.id === old.id)).toEqual(before);
  expect(a.storyCards).toHaveLength(2);
  expect(a.storyCards[1].title).toBe(mode === "same" ? old.title : `[${time.text}] ${old.title}`);
  expect(a.storyCards[1].content).toContain(finding.content);
  // Later deltas on that occurrence reuse its card, never a numbered copy.
  const next = { ...finding, targetId: old.id, content: "Avery received a silver workshop key." };
  const nextSource = a.messages.find(m => m.id === ids[0])!;
  nextSource.content += " Avery received a silver workshop key.";
  next.evidenceQuotes = [{ messageId: ids[0], quote: nextSource.content }];
  nextSource.memoryEvaluation = { pipeline: "singlePass", status: "pending", attempts: 0, turn: 46, revision: "new-evidence", completedGroups: [] };
  const again = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: again.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: again.batchId,
    sources: [{ checkpoint: again.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [next], rejected: [] } }] });
  expect(a.storyCards).toHaveLength(2);
  expect(a.storyCards[1].content).toContain(next.content);
});

it("rechecks title plus date when a matching card appears before automatic approval", async () => {
  const { toSinglePassProposal } = await import("./singlePassMemoryValidation");
  let { a, ids } = singlePassFixture(1);
  a.storyCards = [];
  a.memoryAutoApprove.loreStoryCard = false;
  const time = a.storyClock!.current;
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const p = toSinglePassProposal(a, ids[0], batch.checkpoints[0].checkpoint, groundedFinding());
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  expect(a.activeState.memoryProposals[0].status).toBe("pending");
  const card = makeStoryCard({ id: "newly-created", type: "lore", title: p.title, content: "They reserved a workshop.",
    lore: { status: "ongoing", sourceMessageIds: [], occurredAt: time } });
  a.storyCards.push(card);
  a.memoryAutoApprove.loreStoryCard = true;
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id, automatic: true });
  expect(a.activeState.memoryProposals[0]).toMatchObject({ status: "approved", targetId: card.id, title: card.title });
  expect(a.storyCards).toHaveLength(1);
  expect(a.storyCards[0].content).toContain(p.content);
});

it("does not suppress an identical fact belonging to a different dated occurrence", async () => {
  const { toSinglePassProposal, validateSinglePassSource } = await import("./singlePassMemoryValidation");
  const { a, ids } = singlePassFixture(1);
  const f = groundedFinding();
  a.storyCards = [makeStoryCard({ type: "lore", title: f.title, content: f.content!,
    lore: { status: "completed", sourceMessageIds: [], occurredAt: { text: "1999-12-31", date: "1999-12-31", precision: "day" } } })];
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const validated = validateSinglePassSource(a, { sourceId: ids[0], findings: [f], rejected: [] }, batch.checkpoints[0].checkpoint);
  expect(validated.suppressed).toEqual([]);
  expect(validated.proposals).toHaveLength(1);
  const p = toSinglePassProposal(a, ids[0], batch.checkpoints[0].checkpoint, f);
  expect(p).toMatchObject({ title: `[${a.storyClock!.current!.text}] ${f.title}`, cardOperation: "create", lore: { occurredAt: a.storyClock!.current } });
});

it.each(["0100-01-03", "Imperial Year 417, 1 Harvestfall"])("saves a single literal date prefix and matches older undated titles: %s", text => {
  const a = singlePassFixture(1).a;
  const time = { text, date: text.startsWith("0100") ? text : "0417-09-01", precision: "day" as const };
  a.storyClock = { current: time, origin: "established" };
  a.messages = [];
  const p = { id: "dated", proposedType: "storyCard" as const, storyCardType: "lore" as const, title: "Wine Duel Challenge", content: "Kori issued a challenge.",
    sourceTurnId: "source", sourceText: "Kori issued a challenge.", status: "pending" as const, createdAt: "", updatedAt: "", rationale: "", confidence: 0.8, suggestedTriggers: [], requiresReview: false };
  const once = routeDatedLoreProposal(a, p);
  expect(once.title).toBe(`[${text}] Wine Duel Challenge`);
  expect(routeDatedLoreProposal(a, once).title).toBe(once.title);
  a.storyCards = [makeStoryCard({ id: "existing", type: "lore", title: once.title, content: "Prior facts.", lore: once.lore })];
  expect(routeDatedLoreProposal(a, p)).toMatchObject({ title: once.title, targetId: "existing", cardOperation: "append" });
  expect(JSON.parse(JSON.stringify(once)).title).toBe(once.title);
});
