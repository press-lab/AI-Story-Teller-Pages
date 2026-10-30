import { describe, expect, it } from "vitest";
import { looseMemoryFixture, looseResponse } from "../test/looseMemory";
import { makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import type { Adventure, ComponentType } from "../types/adventure";
import { prepareSinglePassMemoryBatch, parseSinglePassMemoryResponse } from "./singlePassMemory";
import { parseLooseMemoryOperations } from "./looseMemoryParser";
import { routeLooseMemoryOperations, resolveLooseCategory, resolveLooseSource } from "./looseMemoryRouter";
import { validateSinglePassSource } from "./singlePassMemoryValidation";
import { adventureReducer as reduce } from "../state/adventureReducer";
async function routed(text: string, mutate: (a: Adventure) => void = () => {}) {
  const { a, ids } = looseMemoryFixture(); mutate(a);
  const batch = await prepareSinglePassMemoryBatch(a, [ids[0]]);
  const parsed = parseLooseMemoryOperations(text, ["S1"]);
  const result = routeLooseMemoryOperations(a, batch, parsed).sources[0];
  const checked = validateSinglePassSource(a, result, batch.checkpoints[0].checkpoint);
  return { a, batch, result, checked };
}
const belief = "I believe the business can grow beyond individual customers.";
function expectFinding(r: Awaited<ReturnType<typeof routed>>, kind: string, subtype: string, id: string | null, operation: string, proposalType: string, candidateOnly = kind === "storyCard" ? subtype === "character" || Boolean(r.result.diagnostics?.length) || r.result.findings[0]?.reason.startsWith("Unclassified") : kind !== "brain") {
  expect(r.result.rejected).toEqual([]);
  expect(r.result.findings).toHaveLength(1);
  const f = r.result.findings[0];
  expect(f).toMatchObject({ kind, targetId: id, operation, candidateOnly,
    evidenceQuotes: [{ messageId: "narrator-1", quote: r.a.messages[0].content }] });
  if (kind === "storyCard") expect(f.storyCardType).toBe(subtype);
  if (kind === "brain") expect(Object.keys(f.brainPatch!)).toEqual([subtype]);
  expect(r.checked.proposals).toHaveLength(1);
  expect(r.checked.proposals[0].proposal).toMatchObject({ proposedType: proposalType, requiresReview: candidateOnly || Boolean(r.a.storyCards.find(c => c.id === id)?.protected) || Boolean(r.a.brains.find(b => b.id === id)?.protected) || r.a.semanticEvaluationSettings.requireApprovalForAutoUpdates, status: "pending" });
  expect(r.checked.proposals[0].proposal.targetId ?? null).toBe(id);
}
describe("Brain routing", () => {
  it.each(["George Weasley", "George"])("resolves existing eligible exact character or unique linked alias %s", async name => {
    const r = await routed("(brain: " + name + " = " + belief + ")");
    expectFinding(r, "brain", "thoughts", "brain-george", "patch", "brainUpdate");
    const [key, value] = Object.entries(r.result.findings[0].brainPatch!.thoughts!)[0];
    expect(key).toMatch(/^memory_[a-z0-9_]+$/); expect(value).toBe("1 \u2192 " + belief);
    expect(r.a.brains.find(b => b.id === "brain-george")!.thoughts).toEqual({});
  });
  it.each(["currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"])("routes explicit state field %s", async field => {
    const r = await routed("(brain." + field + ": George Weasley = " + belief + ")");
    expectFinding(r, "brain", field, "brain-george", "patch", "brainUpdate");
  });
  it.each(["missing", "inactive", "duplicate", "ambiguousAlias", "outsideManifest"])("rejects %s without redirecting private thought to Lore", async mode => {
    const r = await routed("(brain: " + (mode === "ambiguousAlias" ? "George" : "George Weasley") + " = " + belief + ")", a => {
      if (mode === "missing") a.brains = [];
      if (mode === "inactive") a.brains[1].active = false;
      if (mode === "duplicate") a.brains.push({ ...a.brains[1], id: "duplicate-brain" });
      if (mode === "ambiguousAlias") {
        a.storyCards[1].keys.push("George"); a.brains[0].triggers = ["George"];
      }
      if (mode === "outsideManifest") a.brains[1].triggers = ["Never present"];
    });
    expect(r.result.findings).toEqual([]); expect(r.checked.proposals).toEqual([]);
    expect(r.result.rejected).toEqual([{ index: 0, reason: expect.stringMatching(/Brain destination/) }]);
    expect(r.result.failureReason).toBeTruthy();
  });
  it("does not overwrite existing or archived thought keys", async () => {
    const first = await routed("(brain: George Weasley = " + belief + ")");
    const key = Object.keys(first.result.findings[0].brainPatch!.thoughts!)[0];
    const r = await routed("(brain: George Weasley = " + belief + ")", a => { a.brains[1].thoughts[key] = "Old unrelated thought."; a.brains[1].archivedThoughts[key + "_1"] = "Archived."; });
    expect(Object.keys(r.result.findings[0].brainPatch!.thoughts!)).toEqual([key + "_2"]);
  });
  it("suppresses repeated thoughts through existing factual coverage", async () => {
    const r = await routed("(brain: George Weasley = " + belief + ")", a => { a.brains[1].thoughts.old = "1 \u2192 " + belief; });
    expect(r.checked.proposals).toEqual([]); expect(r.checked.suppressed).toEqual([0]); expect(r.checked.failureReason).toBeUndefined();
  });
  it("holds explicitly uncertain private knowledge for review and never treats attached evidence as semantic proof", async () => {
    const r = await routed("(brain: George Weasley = I know Draconia's undisclosed secret.)", a => { a.messages[0].content += " George did not learn Draconia's secret."; });
    const uncertain = { ...r.result.findings[0], candidateOnly: true, reason: "Uncertain private knowledge; author review required." };
    r.result = parseSinglePassMemoryResponse(JSON.stringify({ sources: [{ sourceId: "narrator-1", findings: [uncertain] }] }), ["narrator-1"], r.a).sources[0];
    expect(validateSinglePassSource(r.a, r.result, r.batch.checkpoints[0].checkpoint).proposals[0].proposal.requiresReview).toBe(true);
    const claimed = reduce(r.a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: r.batch.checkpoints });
    const saved = reduce(claimed, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: r.batch.batchId, sources: [{ result: r.result, checkpoint: r.batch.checkpoints[0].checkpoint }] });
    expect(saved.brains).toEqual(r.a.brains); expect(saved.activeState.memoryProposals[0].status).toBe("pending");
  });
});
describe("Story Card routing", () => {
  it.each([
    ["storyCard.lore", "Weasley Tattoo Business", "business", "lore", "append"],
    ["lore", "tattoo business", "business", "lore", "append"],
    ["storyCard.lore", "Rune tattoo production agreement", null, "lore", "create"],
    ["lore", "Draconia Research Meeting", null, "lore", "create"],
    ["storyCard.character", "Eleanor Vale", null, "character", "create"],
    ["storyCard.location", "Great Hall", "location", "location", "append"],
    ["storyCard.location", "Hall", "location", "location", "append"],
    ["storyCard.location", "Observatory Annex", null, "location", "create"],
    ["storyCard.custom", "Rune Tattoo System", "custom", "custom", "append"],
    ["storyCard.custom", "rune system", "custom", "custom", "append"],
    ["storyCard.custom", "Wand Amplifier", null, "custom", "create"],
  ])("routes %s %s", async (label, subject, target, type, op) => {
    const content = type === "character" ? "Eleanor is a sixth-year Ravenclaw." : type === "location" ? "A sealed chamber lies under the western tower."
      : type === "custom" ? "The enchantment lasts for three days." : subject === "Draconia Research Meeting" ? "Draconia agreed to meet Seth tomorrow at six." : "Fred and George agreed to produce 96 rune tattoos tomorrow.";
    const r = await routed("(" + label + ": " + subject + " = " + content + ")");
    expectFinding(r, "storyCard", type as string, target, op as string, "storyCard");
    expect(r.checked.proposals[0].proposal.placementValidation?.sources).toEqual([{ id: "narrator-1", content: r.a.messages[0].content }]);
    expect(r.result.findings[0].suggestedTriggers!.length).toBeGreaterThan(0);
  });
  it("retains multiple topical Lore choices without choosing or writing to several cards", async () => {
    const r = await routed("(lore: Rune tattoo production agreement = The production team agreed to ship 96 rune tattoos.)", a => {
      a.storyCards.push(makeStoryCard({ ...a.storyCards[0], id: "other-business", title: "Tattoo business production" }));
    });
    expectFinding(r, "storyCard", "lore", null, "create", "storyCard");
    expect(r.checked.proposals[0].proposal.storyCardReview?.targetCandidates.sort()).toEqual(["business", "other-business"]);
    expect(r.result.diagnostics).toContainEqual({ index: 0, reason: expect.stringContaining("No unique strong Lore topic match") });
  });
  it("keeps protected Lore pending and suppresses an already covered fact", async () => {
    const text = "(lore: Weasley Tattoo Business = The twins agreed to produce 96 rune tattoos tomorrow.)";
    const protectedResult = await routed(text, a => { a.storyCards[0].protected = true; });
    expectFinding(protectedResult, "storyCard", "lore", "business", "append", "storyCard");
    const duplicate = await routed(text, a => { a.storyCards[0].content += " The twins agreed to produce 96 rune tattoos tomorrow."; });
    expect(duplicate.checked.suppressed).toEqual([0]); expect(duplicate.checked.proposals).toEqual([]);
  });
  it("does not recreate an established Character identity", async () => {
    const r = await routed("(character: George Weasley = George Weasley is an established student.)");
    expect(r.result.findings).toEqual([]); expect(r.checked.suppressed).toEqual([0]); expect(r.checked.proposals).toEqual([]);
  });
  it("does not duplicate ambiguous surnames", async () => {
    const r = await routed("(character: Weasley = A student of magical business.)");
    expect(r.result.rejected[0].reason).toMatch(/Ambiguous Character/); expect(r.checked.proposals).toEqual([]);
  });
  it("recovers an ordinary existing Character event as Lore requiring review", async () => {
    const r = await routed("(character: George Weasley = George agreed to reconvene Thursday.)");
    expectFinding(r, "storyCard", "lore", null, "create", "storyCard");
    expect(r.result.findings[0].candidateOnly).toBe(true);
    expect(r.result.findings[0].identityChange).toBeUndefined();
    const claimed = reduce(r.a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: r.batch.checkpoints });
    const saved = reduce(claimed, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: r.batch.batchId, sources: [{ result: r.result, checkpoint: r.batch.checkpoints[0].checkpoint }] });
    expect(saved.activeState.memoryProposals).toHaveLength(1); expect(saved.storyCards).toEqual(r.a.storyCards);
  });
  it("builds the explicit enduring Character correction locally", async () => {
    const r = await routed("(storyCard.character.update: George Weasley = George permanently lost his fire magic. || The experiment established this lasting loss.)",
      a => { a.messages[0].content += " George permanently lost his fire magic; the experiment established this lasting loss."; });
    expectFinding(r, "storyCard", "character", "george", "append", "storyCard");
    expect(r.result.findings[0].identityChange).toEqual({ targetId: "george", kind: "profile", fact: "George permanently lost his fire magic.",
      reason: "The experiment established this lasting loss.", evidenceQuotes: [{ messageId: "narrator-1", quote: r.a.messages[0].content }] });
  });
  it("rejects a correction without an enduring reason", async () => {
    const r = await routed("(storyCard.character.update: George Weasley = George permanently lost his fire magic.)");
    expect(r.result.rejected[0].reason).toMatch(/reason after/); expect(r.checked.proposals).toEqual([]);
  });
  it("recovers an unclassified assignment as review-only Lore", async () => {
    const r = await routed("(Weasley Tattoo Business = Fred and George agreed to produce 96 rune tattoos tomorrow.)");
    expect(r.result.findings[0].candidateOnly).toBe(true);
    expectFinding(r, "storyCard", "lore", "business", "append", "storyCard");
  });
});
describe("Component routing", () => {
  const proposals = { plotEssentials: "plotEssentialsUpdate", currentArc: "currentArcUpdate", activePressure: "plotPressureUpdate", immediateMomentum: "plotMomentumUpdate" };
  it.each(Object.entries(proposals))("routes supported %s and preserves operation", async (type, proposalType) => {
    const r = await routed("(component." + type + ": Target = The Ministry expects the research report tomorrow.)", a => {
      a.components = [makeComponent({ id: "target", title: "Target", type: type as ComponentType, active: true, autoUpdate: true, content: "An existing different constraint.", arcPremise: type === "currentArc" ? "Investigate the Ministry report." : undefined })];
    });
    expectFinding(r, type, type, "target", type === "currentArc" ? "append" : "replace", proposalType);
    expect(r.checked.proposals[0].proposal.appendContent).toBe(type === "currentArc" ? true : undefined);
  });
  it.each(["narrationRules", "aiInstructions", "authorNote", "memory", "custom"])("recognizes unsupported %s without Lore fallback", async type => {
    const r = await routed("(component." + type + ": Target = New instruction.)");
    expect(r.result.findings).toEqual([]); expect(r.result.rejected).toEqual([{ index: 0, reason: "Recognized component subtype; automatic memory routing is not permitted." }]);
  });
  it.each(["missing", "duplicate", "inactive", "optOut", "wrongSubtype", "plotEssentialsPermission"])("rejects unsafe component target %s", async mode => {
    const r = await routed("(component." + (mode === "plotEssentialsPermission" ? "plotEssentials" : "activePressure") + ": Ministry Deadline = The report is due tomorrow.)", a => {
      if (mode === "missing") a.components = [];
      if (mode === "duplicate") a.components.push({ ...a.components[0], id: "second" });
      if (mode === "inactive") a.components[0].active = false;
      if (mode === "optOut") a.components[0].autoUpdate = false;
      if (mode === "wrongSubtype") a.components[0].type = "currentArc";
      if (mode === "plotEssentialsPermission") { a.components[0].type = "plotEssentials"; a.components[0].autoUpdate = undefined; }
    });
    expect(r.checked.proposals).toEqual([]); expect(r.result.rejected[0].reason).toMatch(/component destination/);
  });
  it("requires review for a protected target", async () => {
    const r = await routed("(component.activePressure: Ministry Deadline = The report is due tomorrow.)", a => { a.components[0].protected = true; });
    expectFinding(r, "activePressure", "activePressure", "pressure", "replace", "plotPressureUpdate");
  });
  it("rejects explicit Component creation", async () => {
    const r = await routed("(component.currentArc.create: New Arc = A new investigation began.)");
    expect(r.result.rejected[0].reason).toContain("cannot be created");
  });
  it("applies Immediate Momentum only after manual approval to its exact existing target", async () => {
    const r = await routed("(component.immediateMomentum: Target = The report must be delivered.)", a => {
      a.memoryAutoApprove.plotMomentumUpdate = true;
      a.components = [makeComponent({ id: "target", title: "Target", type: "immediateMomentum", active: true, autoUpdate: true, content: "Old momentum." })];
    });
    let saved = reduce(r.a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: r.batch.checkpoints });
    saved = reduce(saved, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: r.batch.batchId, sources: [{ result: r.result, checkpoint: r.batch.checkpoints[0].checkpoint }] });
    expect(saved.components[0].content).toBe("Old momentum.");
    const proposal = saved.activeState.memoryProposals[0];
    expect(reduce(saved, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id, automatic: true })).toBe(saved);
    saved = reduce(saved, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(saved.components[0].content).toBe("The report must be delivered.");
  });
});
it("keeps malformed operation failures separate from source completion", async () => {
  const r = await routed("(lore: Business = A shipment of 96 rune tattoos was agreed.)\nbrain: Broken");
  expect(r.checked.proposals).toHaveLength(1); expect(r.checked.rejected).toHaveLength(1); expect(r.checked.failureReason).toBeUndefined();
  const all = await routed("(brain: Unknown = I know.)"); expect(all.checked.failureReason).toContain("All recognized operations rejected");
});
it("resolves neither missing sources nor unsupported subtypes", async () => {
  const { a, ids } = looseMemoryFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  expect(resolveLooseSource(a, batch, "S9").error).toMatch(/source/);
  for (const category of ["brain", "storyCard", "component"] as const) {
    expect(resolveLooseCategory({ sourceAlias: "S1", category, subtype: "invalid", subject: "X", content: "Y", ordinal: 0, explicitCreation: false, explicitUpdate: false }).error).toMatch(/Unknown/);
  }
  const result = routeLooseMemoryOperations(a, batch, parseLooseMemoryOperations(looseResponse, ["S1", "S2", "S3"]));
  expect(result.sources.map(s => s.findings.length)).toEqual([2, 2, 2]);
});

it("retains exact-title Lore ambiguity through the reducer", async () => {
  const r = await routed("(lore: Weasley Tattoo Business = The twins agreed to ship 96 tattoos.)", a => {
    a.storyCards.push({ ...a.storyCards[0], id: "second-business" });
  });
  expect(r.result.findings[0]).toMatchObject({ targetId: null, storyCardType: "lore", operation: "create", destinationCandidates: ["business", "second-business"] });
  let saved = reduce(r.a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: r.batch.checkpoints });
  saved = reduce(saved, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: r.batch.batchId, sources: [{ result: r.result, checkpoint: r.batch.checkpoints[0].checkpoint }] });
  expect(saved.activeState.memoryProposals).toHaveLength(1);
  expect(saved.activeState.memoryProposals[0].storyCardReview?.targetCandidates).toEqual(["business", "second-business"]);
  expect(saved.storyCards).toEqual(r.a.storyCards);
});
it("does not bypass stale source revisions, historical evidence, destination or control edits", async () => {
  const { a } = looseMemoryFixture();
  const batch = await prepareSinglePassMemoryBatch(a, ["narrator-1"]);
  const result = routeLooseMemoryOperations(a, batch, parseLooseMemoryOperations("(lore: Weasley Tattoo Business = The twins agreed to ship 96 tattoos.)", ["S1"]));
  for (const mutation of [
    (state: Adventure) => { state.messages[0].memoryEvaluation!.revision = "edited"; },
    (state: Adventure) => { state.messages[0].content += " Edited narration."; },
    (state: Adventure) => { state.storyCards[0].content += " Author changed business."; },
    (state: Adventure) => { state.components[0].autoUpdate = false; },
  ]) {
    let changed = reduce(structuredClone(a), { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    mutation(changed);
    changed = reduce(changed, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ result: result.sources[0], checkpoint: batch.checkpoints[0].checkpoint }] });
    expect(changed.activeState.memoryProposals).toEqual([]);
    expect(changed.messages[0].memoryEvaluation?.status).toBe("failed");
    expect(changed.messages[0].memoryEvaluation?.lastError).toMatch(/changed/);
  }
});
it("keeps valid source siblings when only an earlier narrator revision token becomes stale", async () => {
  let { a, ids } = looseMemoryFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const result = routeLooseMemoryOperations(a, batch, parseLooseMemoryOperations(looseResponse, ["S1", "S2", "S3"]));
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a.messages[0].memoryEvaluation!.revision = "edited";
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: result.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) });
  expect(a.messages.map(m => m.memoryEvaluation?.status)).toEqual(["failed", "complete", "complete"]);
  expect(a.activeState.memoryProposals).toHaveLength(4);
  expect(a.activeState.memoryProposals.every(p => p.sourceTurnId !== ids[0])).toBe(true);
});
it("does not borrow later narrator evidence when creating older-source findings", async () => {
  const { a, ids } = looseMemoryFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const result = routeLooseMemoryOperations(a, batch, parseLooseMemoryOperations(looseResponse, ["S1", "S2", "S3"]));
  for (const [i, source] of result.sources.entries()) {
    expect(source.findings.every(f => f.evidenceQuotes.length === 1 && f.evidenceQuotes[0].messageId === ids[i] && f.evidenceQuotes[0].quote === a.messages[i].content)).toBe(true);
    expect(batch.checkpoints[i].checkpoint.evidence.every(e => !ids.slice(i + 1).includes(e.id))).toBe(true);
  }
});
it("does not recreate a dismissed fact, but retains a genuinely new delta for the same target", async () => {
  const r = await routed("(lore: Weasley Tattoo Business = The twins agreed to ship 96 tattoos.)");
  const proposal = { ...r.checked.proposals[0].proposal, status: "rejected" as const };
  r.a.activeState.memoryProposals.push(proposal);
  const duplicate = validateSinglePassSource(r.a, r.result, r.batch.checkpoints[0].checkpoint);
  expect(duplicate.proposals).toEqual([]); expect(duplicate.suppressed).toEqual([0]);
  const next = await prepareSinglePassMemoryBatch(r.a, ["narrator-1"]);
  const result = routeLooseMemoryOperations(r.a, next, parseLooseMemoryOperations("(lore: Weasley Tattoo Business = The twins ordered waterproof packaging for the next shipment.)", ["S1"])).sources[0];
  expect(validateSinglePassSource(r.a, result, next.checkpoints[0].checkpoint).proposals).toHaveLength(1);
});
it("exposes the active loose route through the direct parse entry point", async () => {
  const { parseSinglePassMemoryResponse } = await import("./singlePassMemory");
  const { a, ids } = looseMemoryFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  expect(parseSinglePassMemoryResponse(looseResponse, ids, a, batch.outputAliases).sources.map(s => s.findings.length)).toEqual([2, 2, 2]);
});

it("routes a location's one-time event classified as Lore without modifying its durable profile", async () => {
  const r = await routed("(lore: Great Hall = George and Seth agreed to reconvene Thursday in the hall.)");
  expectFinding(r, "storyCard", "lore", null, "create", "storyCard");
  expect(r.result.findings[0].title).toMatch(/^Great Hall:/);
  expect(r.checked.proposals[0].proposal.storyCardReview?.targetCandidates).toEqual([]);
});
it.each(["inactive", "optOut", "missing", "wrongType"])("rejects unsafe Immediate Momentum target: %s", async mode => {
  const r = await routed("(component.immediateMomentum: Target = The report must be delivered.)", a => {
    a.components = [makeComponent({ id: "target", title: "Target", type: "immediateMomentum", active: true, autoUpdate: true, content: "Old momentum." })];
    if (mode === "inactive") a.components[0].active = false;
    if (mode === "optOut") a.components[0].autoUpdate = false;
    if (mode === "missing") a.components = [];
    if (mode === "wrongType") a.components[0].type = "activePressure";
  });
  expect(r.result.findings).toEqual([]); expect(r.result.rejected[0].reason).toMatch(/Ineligible component/);
  expect(r.checked.proposals).toEqual([]);
});
it("requires Immediate Momentum review even if a historical internal finding claims automatic eligibility", async () => {
  const { toSinglePassProposal } = await import("./singlePassMemoryValidation");
  const r = await routed("(component.immediateMomentum: Target = The report must be delivered.)", a => {
    a.components = [makeComponent({ id: "target", title: "Target", type: "immediateMomentum", active: true, autoUpdate: true, content: "Old momentum." })];
  });
  const p = toSinglePassProposal(r.a, "narrator-1", r.batch.checkpoints[0].checkpoint, { ...r.result.findings[0], candidateOnly: false });
  expect(p.requiresReview).toBe(true); expect(p.proposedType).toBe("plotMomentumUpdate");
});

it("never places Quidditch facts in public relationship Lore; exact topics append and ambiguous topics stay CREATE", async () => {
  const text = "(lore: Gryffindor Quidditch Tryouts 2001 = Fred announces tryouts; Ron is auditioning for Keeper. Draconia asks Seth about Ron.)";
  const relation = makeStoryCard({ id: "exposure", type: "lore", title: "Seth and Draconia's Public Exposure", keys: ["Seth", "Draconia", "Ron"], content: "Fred knows Seth and Draconia." });
  const unsafe = await routed(text, a => a.storyCards.push(relation));
  expectFinding(unsafe, "storyCard", "lore", null, "create", "storyCard");
  expect(unsafe.checked.proposals[0].proposal.storyCardReview!.targetCandidates).toContain("exposure");
  const topic = makeStoryCard({ id: "quidditch", type: "lore", title: "Gryffindor Quidditch Tryouts 2001", content: "Tryouts are planned." });
  const exact = await routed(text, a => a.storyCards.push(relation, topic));
  expectFinding(exact, "storyCard", "lore", topic.id, "append", "storyCard");
  const ambiguous = await routed(text, a => a.storyCards.push(topic, { ...topic, id: "other-topic" }));
  expectFinding(ambiguous, "storyCard", "lore", null, "create", "storyCard");
  expect(ambiguous.checked.proposals[0].proposal.requiresReview).toBe(true);
});
it("appends different facts about the same explicitly named relationship topic", async () => {
  const text = "(lore: Seth and Draconia's Public Exposure = Draconia publicly committed to supporting Seth's independent designs.)";
  const r = await routed(text, a => a.storyCards.push(makeStoryCard({ id: "exposure", type: "lore", title: "Seth and Draconia's Public Exposure", content: "They wore matching rings." })));
  expectFinding(r, "storyCard", "lore", "exposure", "append", "storyCard");
});

it.each(["create", "append"])("builds complete ordinary Lore metadata before normalization (%s)", async operation => {
  const { normalizeSinglePassFinding } = await import("./singlePassMemory");
  const r = await routed("(lore: Archive access = The research team gained access to the library archives.)", a => {
    a.storyCards = operation === "append" ? [makeStoryCard({ id: "archives", type: "lore", title: "Archive access", content: "The library was founded in 1700." })] : [];
    a.messages[0].content = "The research team gained access to the library archives.";
  });
  const f = r.result.findings[0];
  expect(f).toMatchObject({ candidateOnly: false, operation, eventStatus: "unresolved" });
  expect(f.suggestedTriggers!.length).toBeGreaterThan(0);
  const diagnostics: string[] = [];
  expect(normalizeSinglePassFinding(f, "narrator-1", r.a, diagnostics)?.candidateOnly).toBe(false);
  expect(diagnostics).toEqual([]);
  expect(r.checked.proposals[0].proposal).toMatchObject({ requiresReview: false, storyCardReview: { candidateOnly: false } });
});

it.each(["location", "custom"])("does not auto-approve permanent Character changes disguised as %s updates", async type => {
  const content = "George permanently lost his fire magic.";
  const r = await routed(`(storyCard.${type}: ${type === "location" ? "Great Hall" : "Rune Tattoo System"} = ${content})`, a => { a.messages[0].content = content; });
  expect(r.checked.proposals[0].proposal.requiresReview).toBe(true);
  expect(r.checked.proposals[0].proposal.rationale).toContain("Character profile changes require Character placement");
});
