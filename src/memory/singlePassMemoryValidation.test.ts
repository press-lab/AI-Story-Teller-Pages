import { it, expect } from "vitest";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { prepareSinglePassMemoryBatch, parseSinglePassMemoryCommands, normalizeSinglePassFinding } from "./singlePassMemory";
import { validateSinglePassFinding, validateSinglePassSource } from "./singlePassMemoryValidation";
import { partnershipSourceId } from "./fixtures/syntheticMemoryAdventure";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { makeStoryCard, makeBrain, makeComponent } from "../state/defaults";

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


async function commandValidationFixture(evidence: string) {
  const { a, ids } = singlePassFixture(1);
  a.messages.find(m => m.id === ids[0])!.content = evidence;
  a.memoryAutoApprove.storyCard = true; a.memoryAutoApprove.brainUpdate = true; a.memoryAutoApprove.plotPressureUpdate = true;
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  a.brains = [makeBrain({ id: "casey-brain", characterName: "Casey Vale", active: true, triggers: ["Casey"], thoughts: {} })];
  a.components = [makeComponent({ id: "pressure", title: "Pressure", type: "activePressure", active: true, autoUpdate: true, content: "No immediate pressure." })];
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const manifest = batch.outputAliases.S1;
  const e = Object.entries(manifest.evidence).find(([, v]) => v.id === ids[0])![0];
  const parse = (kind: string, target: string, content: string, metadata = "") => parseSinglePassMemoryCommands(
    `MEM S1 ${kind} ${target}\nTITLE Development\nREASON Evidence records a change.\nREVIEW no\nMODE historical\nSTATUS completed\n${metadata}\nE ${e} | ${evidence}\nTEXT\n${content}\nEND\nDONE S1`, batch.outputAliases, a).sources[0];
  const commit = (result: ReturnType<typeof parse>, state = a) => {
    state = reduce(state, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    return reduce(state, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result }] });
  };
  return { a, ids, batch, manifest, parse, commit };
}
it.each([
  ["Casey attempted a kiss but withdrew before contact.", "Casey attempted a kiss; no kiss occurred."],
  ["Casey accepted tomorrow's invitation; the meeting has not occurred.", "Casey accepted the invitation to meet tomorrow."],
])("command-derived uncertainty preserves the evidenced outcome: %s", async (evidence, content) => {
  const f = await commandValidationFixture(evidence);
  const r = f.parse("storyCard", "NEW", content);
  expect(validateSinglePassFinding(f.a, f.ids[0], f.batch.checkpoints[0].checkpoint, r.findings[0])).toBeUndefined();
  const state = f.commit(r);
  expect(state.activeState.memoryProposals[0]).toMatchObject({ content, storyCardType: "lore", requiresReview: true, status: "pending" });
});
it("command-derived private interpretation stays in an existing Brain", async () => {
  const f = await commandValidationFixture("Casey privately interpreted the offer as trust.");
  const b = Object.keys(f.manifest.brains)[0]; expect(b).toBeDefined();
  const r = f.parse("brain", b, "I believe the offer means trust.", "FIELD thought");
  const v = validateSinglePassSource(f.a, r, f.batch.checkpoints[0].checkpoint);
  expect(v.rejected).toEqual([]); expect(v.proposals[0].proposal).toMatchObject({ proposedType: "brainUpdate", requiresReview: true });
  expect(f.commit(r).storyCards).toEqual(f.a.storyCards);
});
it("command-derived absent NPC knowledge cannot auto-apply", async () => {
  const f = await commandValidationFixture("Casey was absent and did not witness Avery's private agreement.");
  const r = f.parse("brain", Object.keys(f.manifest.brains)[0], "I learned Avery's private agreement.", "FIELD thought");
  const state = f.commit(r);
  expect(state.brains[0].thoughts).toEqual({});
  expect(state.activeState.memoryProposals.every(p => p.status === "pending")).toBe(true);
});
it("commands route a research agreement away from Character profiles to review-required Lore", async () => {
  const f = await commandValidationFixture("Casey Vale and Avery agreed to share research results.");
  const c = Object.entries(f.manifest.cards).find(([, v]) => v.type === "character")![0];
  const invalid = f.parse("storyCard", c, "Casey agreed to share research results.");
  expect(invalid.rejected).toEqual([]);
  expect(invalid.findings[0]).toMatchObject({ kind: "storyCard", targetId: null, operation: "create", storyCardType: "lore", candidateOnly: true });
  const recovered = f.commit(invalid);
  expect(recovered.storyCards).toEqual(f.a.storyCards);
  expect(recovered.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true, storyCardType: "lore" });
  const r = f.parse("storyCard", "NEW", "Casey and Avery agreed to share research results.");
  const v = validateSinglePassSource(f.a, r, f.batch.checkpoints[0].checkpoint);
  expect(v.proposals[0].proposal.storyCardType).toBe("lore");
});
it("commands construct the evidenced enduring profile exception and force review", async () => {
  const content = "Casey permanently gained the ability to see magical wards.";
  const f = await commandValidationFixture(content);
  const [alias, target] = Object.entries(f.manifest.cards).find(([, v]) => v.id === f.a.storyCards[0].id)!;
  const r = f.parse("storyCard", alias, content, "PROFILE transformation | An explicit permanent capability changes the enduring profile.");
  expect(r.findings[0].identityChange).toEqual({ targetId: target.id, kind: "transformation", fact: content,
    reason: "An explicit permanent capability changes the enduring profile.", evidenceQuotes: [{ messageId: f.ids[0], quote: content }] });
  expect(validateSinglePassFinding(f.a, f.ids[0], f.batch.checkpoints[0].checkpoint, r.findings[0])).toBeUndefined();
  expect(f.commit(r).activeState.memoryProposals[0]).toMatchObject({ requiresReview: true, status: "pending", targetId: target.id });
});
it("command-derived duplicate facts are suppressed by existing validation", async () => {
  const content = "Casey Vale and Avery agreed to share research results.";
  const f = await commandValidationFixture(content);
  const r = f.parse("storyCard", "NEW", content);
  const first = f.commit(r);
  const v = validateSinglePassSource(first, r, f.batch.checkpoints[0].checkpoint);
  expect(v.proposals).toEqual([]); expect(v.suppressed).toEqual([0]);
});
it("command-derived protected Story Card appends stay in the Inbox", async () => {
  const f = await commandValidationFixture("Casey Vale and Avery agreed to share research results.");
  // Prepare again after adding the protected destination so the checkpoint includes it.
  f.a.storyCards.push(makeStoryCard({ id: "protected-lore", title: "Research results", type: "lore", keys: ["research"], content: "Research is underway.", protected: true }));
  const batch = await prepareSinglePassMemoryBatch(f.a, f.ids);
  const alias = Object.entries(batch.outputAliases.S1.cards).find(([, v]) => v.id === "protected-lore")![0];
  const e = Object.entries(batch.outputAliases.S1.evidence).find(([, v]) => v.id === f.ids[0])![0];
  const result = parseSinglePassMemoryCommands(`MEM S1 storyCard ${alias}\nE ${e} | Casey Vale and Avery agreed to share research results.\nTEXT\nCasey and Avery agreed to share research results.\nEND\nDONE S1`, batch.outputAliases, f.a).sources[0];
  let state = reduce(f.a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  state = reduce(state, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ result, checkpoint: batch.checkpoints[0].checkpoint }] });
  expect(state.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true });
  expect(state.storyCards.find(c => c.id === "protected-lore")!.content).toBe("Research is underway.");
});
it.each(["source", "destination"])("command-derived findings fail stale %s checkpoint checks", async edit => {
  const f = await commandValidationFixture("Casey Vale and Avery agreed to share research results.");
  const r = f.parse("storyCard", "NEW", "Casey and Avery agreed to share research results.");
  const state = reduce(f.a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: f.batch.checkpoints });
  if (edit === "source") state.messages.find(m => m.id === f.ids[0])!.content = "Author correction.";
  else state.storyCards[0].content = "Author correction.";
  const committed = reduce(state, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: f.batch.batchId, sources: [{ result: r, checkpoint: f.batch.checkpoints[0].checkpoint }] });
  expect(committed.activeState.memoryProposals).toEqual([]);
  expect(committed.messages.find(m => m.id === f.ids[0])!.memoryEvaluation?.status).toBe("failed");
});
it("rejects a command's colliding thought key and retains validator overwrite protection", async () => {
  const f = await commandValidationFixture("Casey privately considered the research offer.");
  const key = `memory_${f.ids[0].replace(/[^a-z0-9]+/g, "_")}_1`;
  f.a.brains[0].thoughts[key] = "Earlier thought.";
  const r = f.parse("brain", Object.keys(f.manifest.brains)[0], "I suspect the offer is incomplete.", "FIELD thought");
  expect(r.rejected[0].reason).toContain("must not be overwritten");
  const finding = { ...groundedFinding(), kind: "brain" as const, targetId: f.a.brains[0].id, evidenceQuotes: [{ messageId: f.ids[0], quote: f.a.messages.at(-1)!.content }], brainPatch: { thoughts: { [key]: "A changed thought." } } };
  expect(validateSinglePassFinding(f.a, f.ids[0], f.batch.checkpoints[0].checkpoint, finding)).toContain("must not be overwritten");
});
it("command-derived resolved history does not auto-apply as Active Pressure", async () => {
  const f = await commandValidationFixture("Yesterday Casey resolved the workshop debt.");
  const r = f.parse("activePressure", Object.keys(f.manifest.plot)[0], "Yesterday's resolved workshop debt threatens Casey.");
  const state = f.commit(r);
  expect(state.components[0].content).toBe("No immediate pressure.");
  expect(state.activeState.memoryProposals.every(p => p.status === "pending")).toBe(true);
});

it.each([69, 70, 71, 98, 120, 121])("preserves all %i words and enforces review limits", async count => {
  const content = Array.from({ length: count }, (_, i) => "fact" + i).join(" ");
  const f = await commandValidationFixture(content);
  const raw = { ...groundedFinding(), content, evidenceQuotes: [{ messageId: f.ids[0], quote: content }] };
  const diagnostics: string[] = [];
  const normalized = normalizeSinglePassFinding(raw, f.ids[0], f.a, diagnostics)!;
  expect(normalized.content).toBe(content);
  const error = validateSinglePassFinding(f.a, f.ids[0], f.batch.checkpoints[0].checkpoint, normalized);
  if (count > 120) expect(error).toContain("120 words");
  else {
    expect(error).toBeUndefined();
    expect(normalized.candidateOnly).toBe(count > 70);
    if (count > 70) {
      expect(diagnostics).toContain("Story Card exceeds 70 words; manual review required.");
      expect(validateSinglePassFinding(f.a, f.ids[0], f.batch.checkpoints[0].checkpoint, { ...normalized, candidateOnly: false })).toContain("manual review");
      const state = f.commit({ sourceId: f.ids[0], findings: [normalized], rejected: [] });
      expect(state.activeState.memoryProposals[0]).toMatchObject({ content, status: "pending", requiresReview: true });
      expect(state.storyCards).toEqual(f.a.storyCards);
    }
  }
});
it("rejects stale source content after alias resolution", async () => {
  const f = await commandValidationFixture("The workshop opened.");
  const r = f.parse("storyCard", "NEW", "The workshop opened.");
  f.a.messages.find(m => m.id === f.ids[0])!.content = "Corrected source.";
  expect(validateSinglePassSource(f.a, r, f.batch.checkpoints[0].checkpoint).rejected[0].reason).toContain("changed");
});

it.each([true, false])("recovers supported Character events with topical Lore present=%s", async hasLore => {
  const content = "Fred and George discussed production testing and a paper shortage explanation.";
  const f = await commandValidationFixture(content);
  const lore = makeStoryCard({ id: "production-lore", title: "Production testing", type: "lore", content: "Four products exist.", keys: ["production testing"] });
  if (hasLore) f.a.storyCards.push(lore);
  // Prepare again so the destination manifest and source checkpoint match the actual references.
  const batch = await prepareSinglePassMemoryBatch(f.a, [f.ids[0]]);
  const [alias] = Object.entries(batch.outputAliases.S1.cards).find(([, c]) => c.type === "character")!;
  const e = Object.entries(batch.outputAliases.S1.evidence).find(([, e]) => e.id === f.ids[0])![0];
  const r = parseSinglePassMemoryCommands("MEM S1 storyCard " + alias + "\nTITLE Production testing\nSTATUS ongoing\nREASON Supported production event.\nE " + e + "\nTEXT\n" + content + "\nEND\nDONE S1", batch.outputAliases, f.a).sources[0];
  expect(r.findings[0]).toMatchObject({ targetId: null, operation: "create", storyCardType: "lore", candidateOnly: true, title: "Production testing", eventStatus: "ongoing", reason: "Supported production event.", content });
  const v = validateSinglePassSource(f.a, r, batch.checkpoints[0].checkpoint);
  expect(v.rejected).toEqual([]);
  const p = v.proposals[0].proposal;
  expect(p).toMatchObject({ requiresReview: true, status: "pending", cardOperation: "create" });
  expect(p.targetId).toBeUndefined();
  expect(p.storyCardReview!.targetCandidates.includes(lore.id)).toBe(hasLore);
});

import { qualityFixture, spokenFred, privateFred, privateGeorge, privateDraconia, thoughtFinding, loreFinding, repeatedLore } from "../test/memoryQuality";
it.each(["thoughts", "recentDevelopments"])("suppresses Fred's identical spoken line in %s without failing the source", async field => {
  const { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const f = thoughtFinding("Fred", spokenFred);
  if (field === "recentDevelopments") f.brainPatch = { recentDevelopments: spokenFred };
  const result = validateSinglePassSource(a, { sourceId: ids[0], findings: [f], rejected: [] }, batch.checkpoints[0].checkpoint);
  expect(result.proposals).toEqual([]); expect(result.suppressed).toEqual([0]); expect(result.failureReason).toBeUndefined();
  expect(result.suppressionReasons[0]).toContain("spoken dialogue");
});
it("accepts distinct private voices, preserves existing thoughts and rejects an absent unlearned perspective", async () => {
  let { a, ids } = qualityFixture(); const before = structuredClone(a.brains);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const findings = [thoughtFinding("Fred", privateFred), thoughtFinding("George", privateGeorge), thoughtFinding("Draconia", privateDraconia), thoughtFinding("Hermione", "I know their shop agreement now.")];
  const checked = validateSinglePassSource(a, { sourceId: ids[0], findings, rejected: [] }, batch.checkpoints[0].checkpoint);
  expect(checked.proposals).toHaveLength(3); expect(checked.rejected[0].reason).toContain("eligible");
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint, result: { sourceId: ids[0], findings: findings.slice(0, 3), rejected: [] } }] });
  for (const p of a.activeState.memoryProposals) a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  for (let i = 0; i < 3; i++) expect(a.brains[i].thoughts.established).toBe(before[i].thoughts.established);
  expect(a.brains[2].thoughts.new_reaction).toContain("own terms");
  expect(a.brains[3]).toEqual(before[3]);
});
it("suppresses source copying and turn-prefixed existing thoughts but permits a brief quotation with interpretation", async () => {
  const { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const findings = [thoughtFinding("George", "George worries aloud about losing control of the shop"), thoughtFinding("Fred", "I protect the people who trust me."),
    thoughtFinding("Fred", `He says 'one of ours', but I need to judge her by whether she respects the designs. My loyalty doesn't require suspicion.`)];
  const checked = validateSinglePassSource(a, { sourceId: ids[0], findings, rejected: [] }, batch.checkpoints[0].checkpoint);
  expect(checked.suppressed).toEqual([0, 1]); expect(checked.proposals).toHaveLength(1);
  expect(checked.failureReason).toBeUndefined();
});
it("finds sentence-level Lore coverage and suppresses earlier findings in the same batch", async () => {
  const { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const fresh = loreFinding("Draconia negotiated a separate design safeguard.");
  const findings = [...repeatedLore.map(text => loreFinding(text)), fresh, { ...fresh }];
  const checked = validateSinglePassSource(a, { sourceId: ids[0], findings, rejected: [] }, batch.checkpoints[0].checkpoint);
  expect(checked.suppressed).toEqual([0, 1, 2, 4]); expect(checked.proposals).toHaveLength(1); expect(checked.failureReason).toBeUndefined();
});
it("keeps partially overlapping Lore intact for review", async () => {
  const { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const content = repeatedLore[2] + " She promised to keep the design confidential.";
  const checked = validateSinglePassSource(a, { sourceId: ids[0], findings: [loreFinding(content)], rejected: [] }, batch.checkpoints[0].checkpoint);
  expect(checked.proposals[0].proposal).toMatchObject({ content, requiresReview: true }); expect(checked.suppressed).toEqual([]);
});

it("finishes NONE without inventing a Brain proposal", async () => {
  const { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const parsed = (await import("./singlePassMemory")).parseSinglePassMemoryResponse("S1\nNONE", ids, a, batch.outputAliases, batch).sources[0];
  const checked = validateSinglePassSource(a, parsed, batch.checkpoints[0].checkpoint);
  expect(checked.proposals).toEqual([]); expect(checked.failureReason).toBeUndefined();
});
it("invalidates a stale linked personality profile at commit", async () => {
  let { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a.storyCards = a.storyCards.map(c => c.id === "profile-Draconia" ? { ...c, content: "Personality: openly trusting." } : c);
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ checkpoint: batch.checkpoints[0].checkpoint,
    result: { sourceId: ids[0], findings: [thoughtFinding("Draconia", privateDraconia)], rejected: [] } }] });
  expect(a.activeState.memoryProposals).toEqual([]); expect(a.messages[0].memoryEvaluation?.status).toBe("failed");
});
