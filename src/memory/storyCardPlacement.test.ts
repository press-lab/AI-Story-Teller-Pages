import { reviewedProposal } from "../test/memoryPlacement";
import { memoryTargetSnapshot } from "./memoryCycleState";
import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { makeStoryCardSuggestion } from "./storyCardSuggestions";
import { validateStoryCardProposal } from "./validateStoryCardProposal";
import { placementValidationError } from "./storyCardPlacement";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import { regenerateProposalContent } from "./memoryDetection";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import moody from "./fixtures/moody-placement.json";
import type { MemoryProposal } from "../types/adventure";
vi.mock("../providers/memoryCompletion", () => ({ sendMemoryCompletion: vi.fn() }));
const provider = vi.mocked(sendMemoryCompletion);
const config = { ...defaultModelConfig, apiKey: "offline" };
function seed() {
  const a = createDefaultAdventure(); a.storyCards = [makeStoryCard({ id: "moody", title: "Alastor Moody", type: "character", content: moody.biography, autoUpdate: false })];
  a.messages = [{ id: "source", role: "assistant", content: moody.source, createdAt: "2026-01-01" }];
  return a;
}
function draft(a = seed()) { return makeStoryCardSuggestion(a, "source", moody.source, { title: "Alastor Moody", type: "character", targetId: "moody", content: moody.proposal, evidence: moody.source, reason: "Synthetic mixed draft", evidenceReviewed: true }); }
function loreVerdict(content = moody.lore) { return { accepted: true, meaningfulChange: true, evidenceMessageIds: ["source"], identityMatchesTarget: true, reason: "Supported lesson history.",
  placement: { kind: "historicalLore", title: "Moody’s Unforgivable Curses Demonstration", content, newFact: content, reason: "A completed classroom demonstration belongs in Lore." } }; }
function respond(value: unknown) { return { content: JSON.stringify(value), raw: {} }; }
beforeEach(() => { provider.mockReset(); });
it("extracts and revalidates the Moody lesson before approval, leaving the biography byte-for-byte unchanged", async () => {
  const a = seed(); provider.mockResolvedValue(respond(loreVerdict()));
  const result = await validateStoryCardProposal(a, config, draft(a));
  const p = result.proposal!;
  expect(provider).toHaveBeenCalledTimes(2);
  expect(p).toMatchObject({ storyCardType: "lore", targetId: undefined, memoryMode: "historical", content: moody.lore });
  expect(placementValidationError(a, p)).toBeUndefined();
  let next = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  next = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards[0]).toEqual(a.storyCards[0]);
  expect(next.storyCards.find(c => c.type === "lore")?.content).toBe(moody.lore);
  expect(next.storyCards.find(c => c.type === "lore")?.content).not.toMatch(/VOICE|weapon|paranoid/);
  expect(adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id }).storyCards).toEqual(next.storyCards);
  expect(importAdventureJson(exportAdventureJson(next)).activeState.memoryProposals[0].placementValidation).toEqual(p.placementValidation);
});
it("does not approve reviewer-extracted content if its final review fails", async () => {
  provider.mockResolvedValueOnce(respond(loreVerdict())).mockRejectedValueOnce(new Error("temporary failure"));
  const result = await validateStoryCardProposal(seed(), config, draft());
  expect(result).toMatchObject({ changed: false, retryable: true }); expect(result.proposal).toBeUndefined();
});
it("bounds repeated repairs rather than approving unstable content", async () => {
  provider.mockResolvedValueOnce(respond(loreVerdict())).mockResolvedValueOnce(respond(loreVerdict("A different draft.")));
  expect(await validateStoryCardProposal(seed(), config, draft())).toMatchObject({ changed: false, retryable: true, failureCode: "memory_placement_unstable" });
  expect(provider).toHaveBeenCalledTimes(2);
});
it.each([{}, { kind: "identity", identityChange: true }])("rejects malformed placement rather than trusting a model flag", async placement => {
  provider.mockResolvedValue(respond({ ...loreVerdict(), placement }));
  expect(await validateStoryCardProposal(seed(), config, draft())).toMatchObject({ retryable: true, failureCode: "memory_placement_schema_invalid" });
});
it("keeps an explicit unsupported interpretation rejected", async () => {
  provider.mockResolvedValue(respond({ ...loreVerdict(), accepted: false, reason: "The eye lingering does not establish Moody considers Seth a weapon." }));
  const result = await validateStoryCardProposal(seed(), config, draft());
  expect(result).toMatchObject({ changed: false, error: expect.stringContaining("does not establish") }); expect(result.retryable).not.toBe(true);
});
it.each(["content", "destination", "source", "card"])("invalidates reviewed placement when %s changes", async change => {
  const a = seed(); provider.mockResolvedValue(respond(loreVerdict()));
  let p = (await validateStoryCardProposal(a, config, draft())).proposal!;
  let next = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  if (change === "content") next = adventureReducer(next, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { content: p.content + " He distrusts Seth." } });
  if (change === "destination") next = adventureReducer(next, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { targetId: "moody" } });
  if (change === "source") next = adventureReducer(next, { type: "UPDATE_MESSAGE", messageId: "source", content: moody.source + " The demonstration was a dream." });
  if (change === "card") {
    // Identity reviews also bind the complete destination snapshot.
    a.storyCards[0].autoUpdate = true; a.messages[0].content = "Alastor Moody permanently lost his magical eye.";
    const content = "Alastor Moody permanently lost his magical eye.";
    provider.mockResolvedValue(respond({ ...loreVerdict(), placement: { kind: "identity", title: "Alastor Moody", content, newFact: content, reason: "Permanent identity change.", identityChange: { targetId: "moody", kind: "transformation", fact: content, evidenceQuotes: [{ messageId: "source", quote: content }], supportingLore: content } } }));
    const original = { ...draft(a), content, sourceText: content };
    p = (await validateStoryCardProposal(a, config, original)).proposal!;
    next = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
    next = adventureReducer(next, { type: "UPSERT_STORY_CARD", storyCard: { ...a.storyCards[0], content: "Changed identity." } });
  }
  const before = next.storyCards;
  next = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id, automatic: true });
  expect(next.storyCards).toEqual(before); expect(next.activeState.memoryProposals[0].status).toBe("pending");
  next = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards).not.toEqual(before);
  expect(next.activeState.memoryProposals[0].status).toBe("approved");
});
it("reviews a genuine identity transformation and records only its supporting event as Lore", async () => {
  const a = seed(), content = "Alastor Moody permanently lost his magical eye."; a.messages[0].content = content;
  provider.mockResolvedValue(respond({ ...loreVerdict(), placement: { kind: "identity", title: "Alastor Moody", content, newFact: content, reason: "Permanent identity change.", identityChange: { targetId: "moody", kind: "transformation", fact: content, evidenceQuotes: [{ messageId: "source", quote: content }], supportingLore: content } } }));
  const p = (await validateStoryCardProposal(a, config, { ...draft(a), content, sourceText: content, appendContent: true })).proposal!;
  expect(p.requiresReview).toBe(true);
  let next = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  next = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards[0].content).toContain(content);
  expect(next.storyCards.find(c => c.type === "lore")?.content).toBe(content);
});
it.each(["Alastor Moody died defending the class.", "Alastor Moody permanently lost his magical eye."])("keeps even a major event in Lore when identity replacement is unnecessary: %s", async content => {
  const a = seed(); a.messages[0].content = content;
  const v = loreVerdict(content); v.placement.title = "Moody: Defence class aftermath";
  provider.mockResolvedValue(respond(v));
  const p = (await validateStoryCardProposal(a, config, { ...draft(a), content: moody.biography + "\n" + content, sourceText: content })).proposal!;
  expect(p).toMatchObject({ storyCardType: "lore", memoryMode: "historical", targetId: undefined, content });
  const saved = adventureReducer(adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }), { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(saved.storyCards[0]).toEqual(a.storyCards[0]);
  expect(saved.storyCards.find(card => card.type === "lore")?.content).toBe(content);
});
it("requires supporting Lore even for an evidenced exceptional identity change", async () => {
  const a = seed(), content = "Alastor Moody permanently lost his magical eye."; a.messages[0].content = content;
  provider.mockResolvedValue(respond({ ...loreVerdict(), placement: { kind: "identity", title: "Alastor Moody", content, newFact: content, reason: "Exceptional irreversible transformation.",
    identityChange: { targetId: "moody", kind: "transformation", fact: content, evidenceQuotes: [{ messageId: "source", quote: content }] } } }));
  expect(await validateStoryCardProposal(a, config, { ...draft(a), content })).toMatchObject({ changed: false, retryable: true, failureCode: "memory_placement_schema_invalid" });
});
it("converts an older mixed suggestion to a fully reviewed Lore proposal patch", async () => {
  provider.mockResolvedValueOnce(respond({ title: "Moody’s Unforgivable Curses Demonstration", content: moody.lore, storyCardType: "lore", memoryMode: "historical" })).mockResolvedValue(respond(loreVerdict()));
  const patch = await regenerateProposalContent(draft(), seed(), config, true);
  expect(patch).toMatchObject({ storyCardType: "lore", content: moody.lore, targetId: undefined, placementValidation: { kind: "historicalLore" } });
});
it("keeps stale regeneration from overwriting an edited draft", async () => {
  const a = seed(), p = { ...draft(a), content: "A generated event draft." }; let next = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  const { placementFingerprint } = await import("./storyCardPlacement");
  const fingerprint = placementFingerprint(next.activeState.memoryProposals[0]);
  next = adventureReducer(next, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { content: "User revised text." } });
  const unchanged = adventureReducer(next, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, expectedFingerprint: fingerprint, patch: { content: "Late model reply." } });
  expect(unchanged).toBe(next);
});

it.each(["foreign-target", "invented quote"])("rejects an identity review with %s evidence", async mistake => {
  const a = seed(), content = "Alastor Moody permanently lost his magical eye."; a.messages[0].content = content;
  provider.mockResolvedValue(respond({ ...loreVerdict(), placement: { kind: "identity", title: "Alastor Moody", content, newFact: content, reason: "Transformation.",
    identityChange: { targetId: mistake === "foreign-target" ? "harry" : "moody", kind: "transformation", fact: content,
      evidenceQuotes: [{ messageId: "source", quote: mistake === "invented quote" ? "Moody died." : content }] } } }));
  expect(await validateStoryCardProposal(a, config, { ...draft(a), content })).toMatchObject({ changed: false, retryable: true, failureCode: "memory_placement_schema_invalid" });
});
it("revalidates separately extracted supporting history before committing an identity change", async () => {
  const a = seed(), fact = "Alastor Moody permanently lost his magical eye."; a.messages[0].content = fact;
  const content = moody.biography + "\n" + fact;
  provider.mockImplementation(async (_a, _config, messages) => {
    const body = JSON.parse(messages.at(-1)!.content);
    const placement = body.targetInfo.type === "lore"
      ? { kind: "historicalLore", title: body.title, content: fact, newFact: fact, reason: "Supporting historical event." }
      : { kind: "identity", title: "Alastor Moody", content, newFact: fact, reason: "Transformation of Moody himself.", identityChange: { targetId: "moody", kind: "transformation", fact,
        evidenceQuotes: [{ messageId: "source", quote: fact }], supportingLore: fact } };
    return respond({ ...loreVerdict(), placement });
  });
  const result = await validateStoryCardProposal(a, config, { ...draft(a), content, appendContent: false });
  expect(provider).toHaveBeenCalledTimes(2); expect(result.proposal?.placementValidation?.identityChange?.supportingLore).toBe(fact);
});
it("loads older pending drafts without inventing placement approval", () => {
  const a = seed(); a.activeState.memoryProposals = [{ ...draft(a), content: "A focused but unreviewed event." }];
  const loaded = importAdventureJson(exportAdventureJson(a));
  expect(provider).not.toHaveBeenCalled();
  expect(loaded.activeState.memoryProposals[0].placementValidation).toBeUndefined();
  expect(placementValidationError(loaded, loaded.activeState.memoryProposals[0])).toContain("needs validation");
});

it.each(["legacy", "deleted source", "regenerated source", "inactive target", "historical target", "deleted target", "changed target type", "rejected", "ignored"] as const)("allows manual approval with %s while automatic approval remains guarded", scenario => {
  let a = seed();
  a.storyCards.push(makeStoryCard({ id: "lesson-history", title: "Moody lessons", type: "lore", memoryMode: "living", content: "Earlier lessons remain recorded." }));
  const content = "Moody demonstrated three curses to the class.";
  const p = reviewedProposal(a, makeStoryCardSuggestion(a, "source", moody.source, {
    title: "Moody lessons", type: "lore", targetId: "lesson-history", content, evidence: moody.source, reason: "A reviewed lesson", evidenceReviewed: true,
  }));
  p.evaluationSource = { messages: [{ id: "source", content: moody.source }], target: memoryTargetSnapshot(a, "storyCard", "lesson-history") };
  a.activeState.memoryProposals = [p];
  if (scenario === "legacy") a = adventureReducer(a, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { placementValidation: undefined } });
  if (scenario === "deleted source" || scenario === "regenerated source") {
    a = adventureReducer(a, { type: "DELETE_MESSAGE", messageId: "source" });
    if (scenario === "regenerated source") a = adventureReducer(a, { type: "ADD_MESSAGE", id: "replacement", role: "assistant", content: "A regenerated classroom scene." });
  }
  const target = a.storyCards[1];
  if (scenario === "inactive target") a = adventureReducer(a, { type: "DEACTIVATE_STORY_CARD", storyCardId: target.id });
  if (scenario === "historical target") a = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: target.id, patch: { memoryMode: "historical" } });
  if (scenario === "deleted target") a = adventureReducer(a, { type: "DELETE_STORY_CARD", storyCardId: target.id });
  if (scenario === "changed target type") a = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: target.id, patch: { type: "custom" } });
  if (scenario === "rejected") a = adventureReducer(a, { type: "REJECT_MEMORY_PROPOSAL", proposalId: p.id });
  if (scenario === "ignored") a = adventureReducer(a, { type: "IGNORE_MEMORY_PROPOSAL", proposalId: p.id });
  if (scenario !== "rejected" && scenario !== "ignored") {
    const automatic = adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id, automatic: true });
    expect(automatic.storyCards).toEqual(a.storyCards);
    expect(automatic.activeState.memoryProposals[0].status).toBe("pending");
  }
  const approved = adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(approved.activeState.memoryProposals[0].status).toBe("approved");
  const card = approved.storyCards.find(c => scenario === "deleted target" ? c.title === "Moody lessons" : c.id === target.id)!;
  expect(card.content).toContain(content);
  expect(approved.storyCards[0]).toEqual(a.storyCards[0]);
  if (scenario !== "deleted target") expect(card.content).toContain("Earlier lessons remain recorded.");
  if (scenario === "changed target type") expect(card.type).toBe("custom");
  if (scenario === "inactive target") expect(card.active).toBe(false);
  if (scenario === "historical target") expect(card.memoryMode).toBe("historical");
  expect(adventureReducer(approved, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(approved);
});
