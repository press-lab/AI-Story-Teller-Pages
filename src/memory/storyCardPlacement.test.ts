import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { makeStoryCardSuggestion } from "./storyCardSuggestions";
import { regenerateProposalContent } from "./memoryDetection";
import { validateStoryCardProposal } from "./validateStoryCardProposal";
import { placementValidationError } from "./storyCardPlacement";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import { importAdventureJson, exportAdventureJson } from "../utils/json";
import type { StoryCardType, StoryCardMemoryMode } from "../types/adventure";
vi.mock("../providers/memoryCompletion", () => ({ sendMemoryCompletion: vi.fn() }));
const provider = vi.mocked(sendMemoryCompletion);
const config = { ...defaultModelConfig, apiKey: "offline" };
const fact = "Seth demonstrated a lie-detecting rune on Ron's forearm.";
function seed(type: StoryCardType = "character", mode: StoryCardMemoryMode = "static") {
  const a = createDefaultAdventure(); a.components = []; a.brains = [];
  a.storyCards = [makeStoryCard({ id: "subject", title: "Seth's runecraft", type, memoryMode: mode, autoUpdate: false,
    active: false, content: "  Original authored facts.\n\nVOICE CONTRACT\nDry and precise.  ", keys: ["runecraft"], tokenBudget: 10, priority: 2 })];
  a.messages = [{ id: "source", role: "assistant", content: fact, createdAt: "2026-01-01" }];
  return a;
}
function draft(a = seed(), content = fact) { return makeStoryCardSuggestion(a, "source", fact, { title: a.storyCards[0].title,
  targetId: "subject", type: a.storyCards[0].type, content, evidence: fact, reason: "Demonstrated capability", evidenceReviewed: true }); }
function response(value: unknown) { return { content: JSON.stringify(value), raw: {} }; }
function verdict(content = fact, targetId: string | undefined = "subject") { return { accepted: true, meaningfulChange: true,
  evidenceMessageIds: ["source"], identityMatchesTarget: true, reason: "Supported new fact attributed to this subject.",
  placement: { kind: targetId ? "append" : "create", targetId, title: "Seth's runecraft", content, newFact: content, reason: "Same durable subject." } }; }
beforeEach(() => { provider.mockReset(); });
const cases = (["character", "location", "lore", "custom"] as const).flatMap(type => (["static", "living", "historical"] as const).map(mode => ({ type, mode })));
it.each(cases)("appends to a legacy $mode $type card without opt-in, archiving or replacement", async ({ type, mode }) => {
  const a = seed(type, mode), original = a.storyCards[0]; provider.mockResolvedValue(response(verdict()));
  const p = (await validateStoryCardProposal(a, config, { ...draft(a), appendContent: false })).proposal!;
  expect(p).toMatchObject({ targetId: "subject", storyCardType: type, cardOperation: "append", appendContent: true, placementValidation: { version: 2, kind: "append" } });
  expect(placementValidationError(a, p)).toBeUndefined();
  let next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  next = reduce(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards).toHaveLength(1);
  expect(next.storyCards[0].content.startsWith(original.content)).toBe(true);
  expect(next.storyCards[0].content).toContain(fact);
  expect(next.storyCards[0]).toMatchObject({ id: original.id, type, active: false, memoryMode: mode, autoUpdate: false,
    tokenBudget: 10, priority: 2, archivedFacts: original.archivedFacts });
  expect(next.storyCards[0].memoryUpdateHistory?.[0].operation).toBe("append");
  expect(reduce(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(next);
  const loaded = importAdventureJson(exportAdventureJson(next));
  expect(loaded.storyCards[0].content).toBe(next.storyCards[0].content);
  expect(loaded.storyCards[0].memoryMode).toBe(mode);
});
it("creates a focused card when no subject fits", async () => {
  const a = seed(); a.storyCards = []; provider.mockResolvedValue(response({ ...verdict(), placement: { ...verdict().placement, kind: "create", targetId: undefined } }));
  const proposal = makeStoryCardSuggestion(a, "source", fact, { title: "Tattoo venture", content: fact, type: "lore", evidence: fact, reason: "New subject", evidenceReviewed: true });
  const p = (await validateStoryCardProposal(a, config, proposal)).proposal!;
  expect(p).toMatchObject({ cardOperation: "create", targetId: undefined, placementValidation: { kind: "create" } });
});
it("repairs exaggerated outcomes then separately reviews the corrected factual delta", async () => {
  const a = seed(); const described = "Seth described a paper-transfer technique; production has not begun.";
  a.messages[0].content = described;
  provider.mockResolvedValueOnce(response({ ...verdict(described), accepted: false, reason: "No production run occurred." })).mockResolvedValueOnce(response(verdict(described)));
  const p = (await validateStoryCardProposal(a, config, draft(a, "Seth completed mass production."))).proposal!;
  expect(provider).toHaveBeenCalledTimes(2);
  expect(p.content).toBe(described);
  expect(JSON.parse(provider.mock.calls[1][2].at(-1)!.content).targetInfo.finalReview).toBe(true);
});
it("freezes a corrected draft during final review instead of chasing stylistic rewrites", async () => {
  provider.mockResolvedValueOnce(response(verdict("A focused supported fact."))).mockResolvedValueOnce(response(verdict("A stylistic rewording.")));
  const p = (await validateStoryCardProposal(seed(), config, draft())).proposal!;
  expect(p.content).toBe("A focused supported fact."); expect(provider).toHaveBeenCalledTimes(2);
});
it.each(["rejected", "transport"])("does not approve a repaired draft when final review is $0", async failure => {
  provider.mockResolvedValueOnce(response(verdict("A focused fact.")));
  if (failure === "transport") provider.mockRejectedValueOnce(new Error("offline failure"));
  else provider.mockResolvedValueOnce(response({ ...verdict("A focused fact."), accepted: false, identityMatchesTarget: false }));
  expect((await validateStoryCardProposal(seed(), config, draft())).proposal).toBeUndefined();
});
it.each(["content", "source", "destination"])("blocks stale automatic approval after the $0 changes", async change => {
  const a = seed(); provider.mockResolvedValue(response(verdict())); const p = (await validateStoryCardProposal(a, config, draft(a))).proposal!;
  let next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  if (change === "content") next = reduce(next, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { content: "Edited draft." } });
  if (change === "source") next = reduce(next, { type: "UPDATE_MESSAGE", messageId: "source", content: "The demonstration never happened." });
  if (change === "destination") next = reduce(next, { type: "UPDATE_STORY_CARD", storyCardId: "subject", patch: { content: "User edited body." } });
  const before = next.storyCards;
  expect(reduce(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id, automatic: true }).storyCards).toEqual(before);
});
it("keeps protected destinations eligible but requires review", async () => {
  const a = seed(); a.storyCards[0].protected = true; a.memoryAutoApprove.storyCard = true;
  provider.mockResolvedValue(response(verdict())); const p = (await validateStoryCardProposal(a, config, draft(a))).proposal!;
  expect(p).toMatchObject({ targetId: "subject", requiresReview: true });
  const next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  expect(next.activeState.memoryProposals[0].status).toBe("pending"); expect(next.storyCards).toEqual(a.storyCards);
});
it.each([{}, { kind: "append", content: fact }])("fails closed on malformed placement: %j", async placement => {
  provider.mockResolvedValue(response({ ...verdict(), placement }));
  expect(await validateStoryCardProposal(seed(), config, draft())).toMatchObject({ changed: false, retryable: true });
});
it("loads old pending proposals without approving them or making provider requests", () => {
  const a = seed(); a.activeState.memoryProposals = [{ ...draft(a), cardOperation: undefined, placementValidation: undefined }];
  const loaded = importAdventureJson(exportAdventureJson(a));
  expect(provider).not.toHaveBeenCalled(); expect(loaded.activeState.memoryProposals[0].status).toBe("pending");
  expect(placementValidationError(loaded, loaded.activeState.memoryProposals[0])).toContain("needs validation");
});

it("regenerates an append without requiring a legacy memory mode", async () => {
  const a = seed();
  provider.mockResolvedValueOnce(response({ title: a.storyCards[0].title, content: fact, storyCardType: "character" }))
    .mockResolvedValueOnce(response(verdict()));
  const p = await regenerateProposalContent(draft(a), a, config);
  expect(p).toMatchObject({ cardOperation: "append", targetId: "subject", appendContent: true, content: fact });
  expect(provider).toHaveBeenCalledTimes(2);
});
