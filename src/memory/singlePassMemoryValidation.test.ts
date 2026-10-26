import { it, expect } from "vitest";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { prepareSinglePassMemoryBatch } from "./singlePassMemory";
import { validateSinglePassFinding, validateSinglePassSource } from "./singlePassMemoryValidation";
import { partnershipSourceId } from "./fixtures/syntheticMemoryAdventure";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { makeStoryCard } from "../state/defaults";

it("rejects forged, future and nonverbatim evidence without changing siblings", async () => {
  const { a, ids } = singlePassFixture();
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const checkpoint = batch.checkpoints.at(-1)!.checkpoint;
  for (const messageId of ["future-message", ids[0]]) {
    const finding = { ...groundedFinding(), evidenceQuotes: [{ messageId, quote: "Invented fact" }] };
    expect(validateSinglePassFinding(a, partnershipSourceId, checkpoint, finding)).toBeTruthy();
  }
  const result = validateSinglePassSource(a, { sourceId: partnershipSourceId, findings: [groundedFinding(), { ...groundedFinding(), targetId: "missing" }], rejected: [] }, checkpoint);
  expect(result.proposals).toHaveLength(1); expect(result.rejected).toHaveLength(1);
});
it("rejects missing Brain destinations instead of creating biography", async () => {
  const { a, ids } = singlePassFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const f = { ...groundedFinding(), kind: "brain" as const, targetId: "missing", brainPatch: { notes: "I understand the agreement." } };
  expect(validateSinglePassFinding(a, partnershipSourceId, batch.checkpoints.at(-1)!.checkpoint, f)).toContain("Brain");
});
it("retains protected and uncertain findings for review through existing reducers", async () => {
  let { a, ids } = singlePassFixture();
  a.memoryAutoApprove.storyCard = true;
  const card = makeStoryCard({ type: "lore", title: "Workshop collaboration", content: "The workshop exists.", protected: true }); a.storyCards.push(card);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const f = { ...groundedFinding(), targetId: card.id, operation: "append" as const };
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints.at(-1)!.checkpoint, result: { sourceId: partnershipSourceId, findings: [f], rejected: [] } }] });
  expect(a.storyCards.find(c => c.id === card.id)!.content).toBe(card.content);
  expect(a.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true });
});
it.each(["source", "destination"])("rejects stale %s edits at commit", async edit => {
  let { a, ids } = singlePassFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  if (edit === "source") a = reduce(a, { type: "UPDATE_MESSAGE", messageId: partnershipSourceId, content: "Author correction." });
  else a = { ...a, storyCards: a.storyCards.map((c, i) => i ? c : { ...c, content: "Author correction." }) };
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints.at(-1)!.checkpoint, result: { sourceId: partnershipSourceId, findings: [groundedFinding()], rejected: [] } }] });
  expect(a.activeState.memoryProposals).toHaveLength(0);
  expect(a.messages.find(m => m.id === partnershipSourceId)!.memoryEvaluation?.status).toBe("failed");
});
it("requires the Character identity-change evidence contract", async () => {
  const { a, ids } = singlePassFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const f = { ...groundedFinding(), targetId: a.storyCards[0].id, storyCardType: "character" as const, operation: "append" as const };
  expect(validateSinglePassFinding(a, partnershipSourceId, batch.checkpoints.at(-1)!.checkpoint, f)).toContain("enduring profile");
});

it.each([
  ["An explicit kiss attempt was withdrawn before contact.", "They kissed.", "completed"],
  ["Hermione accepted tomorrow's research dinner invitation; dinner has not occurred.", "Hermione accepted the research dinner invitation.", "completed"],
  ["Hermione privately interpreted the offer as a sign of trust.", "Hermione secretly believed the offer meant trust.", "unresolved"],
])("holds unsupported or interpretive certainty for author review: %s", async (evidence, content, eventStatus) => {
  let { a, ids } = singlePassFixture(1); a.memoryAutoApprove.storyCard = true; a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  a.messages.find(m => m.id === ids[0])!.content = evidence;
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const finding = { ...groundedFinding(), content, eventStatus: eventStatus as "completed" | "unresolved", evidenceQuotes: [{ messageId: ids[0], quote: evidence }] };
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [finding], rejected: [] } }] });
  expect(a.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true, content });
  expect(a.storyCards.some(c => c.type === "lore")).toBe(false);
});
it("validates an evidenced permanent Character ability but keeps profile changes reviewable", async () => {
  let { a, ids } = singlePassFixture(1); a.memoryAutoApprove.storyCard = true; a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  const target = a.storyCards[0];
  const content = "Casey permanently gained the ability to see magical wards.";
  a.messages.find(m => m.id === ids[0])!.content = content;
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const f = { ...groundedFinding(), content, targetId: target.id, storyCardType: "character" as const, operation: "append" as const,
    evidenceQuotes: [{ messageId: ids[0], quote: content }], identityChange: { targetId: target.id, kind: "transformation" as const, fact: content,
      reason: "An explicit permanent capability changes the enduring profile.", evidenceQuotes: [{ messageId: ids[0], quote: content }] } };
  expect(validateSinglePassFinding(a, ids[0], batch.checkpoints[0].checkpoint, f)).toBeUndefined();
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: [f], rejected: [] } }] });
  expect(a.activeState.memoryProposals[0]).toMatchObject({ targetId: target.id, requiresReview: true });
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: a.activeState.memoryProposals[0].id });
  expect(a.storyCards.find(c => c.id === target.id)!.content).toContain(content);
  expect(a.storyCards.find(c => c.id === target.id)!.content).toContain(target.content);
  expect(a.storyCards.find(c => c.id === target.id)!.memoryUpdateHistory?.at(-1)?.sourceTurnId).toBe(ids[0]);
});

it("keeps separate Hermione developments and an attempted kiss distinct without inventing an outcome", async () => {
  let { a, ids } = singlePassFixture(1); a.memoryAutoApprove.storyCard = true; a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  const evidence = "Hermione accepted a research dinner invitation. Later, she attempted a kiss, but withdrew before contact.";
  a.messages.find(m => m.id === ids[0])!.content = evidence;
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const findings = [
    { ...groundedFinding(), title: "Hermione's research dinner agreement", content: "Hermione accepted a research dinner invitation; the dinner has not happened." },
    { ...groundedFinding(), title: "Hermione's withdrawn kiss attempt", content: "Hermione attempted a kiss but withdrew before contact; no kiss occurred.", candidateOnly: true },
  ].map(f => ({ ...f, participants: ["Hermione"], evidenceQuotes: [{ messageId: ids[0], quote: evidence }] }));
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings, rejected: [] } }] });
  expect(a.activeState.memoryProposals).toHaveLength(2);
  expect(a.activeState.memoryProposals.every(p => p.storyCardType === "lore" && p.status === "pending")).toBe(true);
  expect(a.activeState.memoryProposals.some(p => /romantic date|completed kiss/.test(p.content))).toBe(false);
});
it("does not approve absent NPC knowledge or a past event as immediate pressure", async () => {
  const { makeBrain, makeComponent } = await import("../state/defaults");
  let { a, ids } = singlePassFixture(1); a.memoryAutoApprove.brainUpdate = true; a.memoryAutoApprove.plotPressureUpdate = true;
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  a.messages.find(m => m.id === ids[0])!.content = "Yesterday Casey resolved the workshop debt. Draco was absent and did not witness the agreement.";
  const brain = makeBrain({ characterName: "Draco", active: true, triggers: ["Draco"], thoughts: {} }); a.brains = [brain];
  const pressure = makeComponent({ title: "Active Pressure", type: "activePressure", content: "No immediate external pressure.", active: true, autoUpdate: true }); a.components = [pressure];
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const quote = { messageId: ids[0], quote: a.messages.find(m => m.id === ids[0])!.content };
  const findings = [
    { ...groundedFinding(), kind: "brain" as const, targetId: brain.id, title: "Draco", brainPatch: { thoughts: { agreement: "1 → I know Casey's private agreement." } }, reason: "Draco learned the agreement.", evidenceQuotes: [quote] },
    { ...groundedFinding(), kind: "activePressure" as const, targetId: pressure.id, content: "Yesterday's resolved workshop debt threatens Casey.", evidenceQuotes: [quote] },
  ];
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings, rejected: [] } }] });
  expect(a.brains[0].thoughts).toEqual({}); expect(a.components[0].content).toBe(pressure.content);
  expect(a.activeState.memoryProposals.every(p => p.status === "pending")).toBe(true);
});
it("retains a Draconia magical-rule development as retrievable Lore instead of biography", async () => {
  const fixture = (await import("./fixtures/draconia-library-placement.json")).default;
  const { createDefaultAdventure } = await import("../state/defaults");
  const { buildContext } = await import("../contextBuilder/contextBuilder");
  let a = createDefaultAdventure(); a.messages = structuredClone(fixture.messages) as import("../types/adventure").Message[];
  a.storyCards = [fixture.card as import("../types/adventure").StoryCard];
  const sourceId = fixture.proposal.sourceTurnId;
  a.messages.find(m => m.id === sourceId)!.memoryEvaluation = { pipeline: "singlePass", status: "pending", attempts: 0, turn: 1, completedGroups: [] };
  const batch = await prepareSinglePassMemoryBatch(a, [sourceId]);
  const f = { ...groundedFinding(), title: "Flemish marriage-binding research", content: "Draconia offered to disclose additional information about the Flemish marriage-binding renegotiation clause if Seth explained it correctly. The test's outcome remained unsettled.",
    evidenceQuotes: [{ messageId: sourceId, quote: a.messages.find(m => m.id === sourceId)!.content }], participants: ["Draconia Malfoy", "Seth Press"],
    eventStatus: "unresolved" as const, suggestedTriggers: ["Flemish binding theory", "marriage-binding renegotiation", "Draconia's research test"] };
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId, findings: [f], rejected: [] } }] });
  const p = a.activeState.memoryProposals.find(p => p.title === f.title)!;
  expect(p.storyCardType).toBe("lore"); expect(a.storyCards[0].content).toBe(fixture.card.content);
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  a = reduce(a, { type: "ADD_MESSAGE", role: "user", content: "I review Flemish binding theory and marriage-binding renegotiation." });
  expect(JSON.stringify(buildContext(a).messages)).toContain("The test's outcome remained unsettled.");
});

it("rejects existing Brain thought overwrites and empty patches locally", async () => {
  const { makeBrain } = await import("../state/defaults");
  const { normalizeSinglePassFinding } = await import("./singlePassMemory");
  const { a, ids } = singlePassFixture(1);
  const brain = makeBrain({ id: "brain", characterName: "Casey Vale", active: true, triggers: ["Casey"], thoughts: { workshop: "1: I need time to consider the agreement." } }); a.brains = [brain];
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const f = { ...groundedFinding(), kind: "brain" as const, targetId: brain.id, brainPatch: { thoughts: { workshop: "2: I have already agreed." } } };
  expect(validateSinglePassFinding(a, ids[0], batch.checkpoints[0].checkpoint, f)).toMatch(/overwritten|eligible/);
  for (const brainPatch of [{}, { thoughts: {} }, { notes: " " }]) expect(normalizeSinglePassFinding({ ...f, brainPatch }, ids[0], a)).toBeUndefined();
});
