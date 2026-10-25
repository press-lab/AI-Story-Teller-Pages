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
  next = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards).toEqual(before); expect(next.activeState.memoryProposals[0].status).toBe("pending");
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
