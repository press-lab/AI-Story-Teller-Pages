import { beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/draconia-library-placement.json";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { validateStoryCardProposal } from "./validateStoryCardProposal";
import { placementValidationError, STORY_CARD_PLACEMENT_POLICY } from "./storyCardPlacement";
import { storyCardTargets } from "./storyCardSuggestions";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import type { Adventure, MemoryProposal, StoryCard } from "../types/adventure";
vi.mock("../providers/memoryCompletion", async original => ({ ...await original<typeof import("../providers/memoryCompletion")>(), sendMemoryCompletion: vi.fn() }));
const provider = vi.mocked(sendMemoryCompletion);
const config = { ...defaultModelConfig, apiKey: "offline" };
const title = "Flemish binding theory: library test";
function seed() {
  const a = createDefaultAdventure(); a.components = []; a.brains = [];
  a.storyCards = [makeStoryCard({ ...fixture.card, type: "character" } as StoryCard)];
  a.messages = fixture.messages as Adventure["messages"];
  return a;
}
function draft() { return structuredClone(fixture.proposal) as MemoryProposal; }
function verdict(kind = "create", targetId?: string) {
  return { accepted: true, meaningfulChange: true, identityMatchesTarget: true,
    evidenceMessageIds: fixture.messages.map(m => m.id), reason: "Supported observable library exchange, no enduring profile change.",
    placement: { kind, targetId, title, content: fixture.proposal.content, newFact: fixture.proposal.content,
      reason: "An unresolved research interaction belongs in topical Lore, not Draconia's biography." } };
}
const response = (value: unknown) => ({ content: JSON.stringify(value), raw: {} });
beforeEach(() => provider.mockReset());

it("checks Character only for an enduring profile change and includes Lore-first guidance in review", async () => {
  const a = seed();
  provider.mockResolvedValue(response([]));
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: fixture.proposal.sourceTurnId, turn: 0, manual: true });
  await runMemoryCycle(claimed, config, { sourceId: fixture.proposal.sourceTurnId });
  const request = provider.mock.calls.find(([, , messages]) => messages.at(-1)!.content.includes('"conditions"'))!;
  const body = JSON.parse(request[2].at(-1)!.content);
  const condition = body.conditions.storyCards.find((c: { id: string }) => c.id === `storyCard:${fixture.card.id}`)!;
  expect(condition.condition).toContain("specific enduring profile change");
  expect(condition.condition).toContain("Events and shared developments belong in Lore");
  provider.mockClear(); provider.mockResolvedValue(response(verdict()));
  await validateStoryCardProposal(a, config, draft());
  expect(provider.mock.calls[0][2].some(m => m.content.includes(STORY_CARD_PLACEMENT_POLICY))).toBe(true);
});

it.each(["create", "historicalLore"])("reroutes the attached Character draft to %s Lore and separately reviews it", async kind => {
  const a = seed(); provider.mockResolvedValueOnce(response(verdict(kind))).mockResolvedValueOnce(response(verdict()));
  const p = (await validateStoryCardProposal(a, config, draft())).proposal!;
  expect(p).toMatchObject({ title, storyCardType: "lore", targetId: undefined, cardOperation: "create",
    placementValidation: { version: 3, kind: "create" } });
  expect(provider).toHaveBeenCalledTimes(2);
  expect(JSON.parse(provider.mock.calls[1][2].at(-1)!.content).targetInfo).toMatchObject({ type: "lore", finalReview: true });
  const next = reduce(reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }), { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards[0]).toEqual(a.storyCards[0]);
  expect(next.storyCards[1]).toMatchObject({ type: "lore", content: fixture.proposal.content });
});

it("reuses existing topical Lore when the reviewer redirects from a participant", async () => {
  const a = seed(); a.storyCards.push(makeStoryCard({ id: "research", title, type: "lore", content: "Earlier research.", keys: ["Flemish binding theory"] }));
  provider.mockResolvedValue(response(verdict("append", "research")));
  const p = (await validateStoryCardProposal(a, config, draft())).proposal!;
  expect(p).toMatchObject({ targetId: "research", storyCardType: "lore", cardOperation: "append" });
  expect(provider).toHaveBeenCalledTimes(2);
  const next = reduce(reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }), { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards).toHaveLength(2); expect(next.storyCards[0]).toEqual(a.storyCards[0]);
  expect(next.storyCards[1].content).toContain("Earlier research.");
  expect(next.storyCards[1].content).toContain(fixture.proposal.content);
});

it("rejects the attachment's broad interpersonal rationale as permission to append to Character", async () => {
  const v = verdict("append", fixture.card.id); v.placement.reason = fixture.proposal.placementValidation.reason;
  provider.mockResolvedValue(response(v));
  expect(await validateStoryCardProposal(seed(), config, draft())).toMatchObject({ changed: false, failureCode: "memory_character_profile_required" });
});

it.each(["fabricated", "foreign", "no reason", "wrong target"])("rejects a profile exception with %s support", async flaw => {
  const v = verdict("append", fixture.card.id);
  const change = { targetId: fixture.card.id, kind: "profile", fact: "Draconia has a permanent new role.", reason: "A lasting profile change.",
    evidenceQuotes: [{ messageId: fixture.proposal.sourceTurnId, quote: fixture.messages.at(-1)!.content }] };
  if (flaw === "fabricated") change.evidenceQuotes[0].quote = "Draconia became Headmistress.";
  if (flaw === "foreign") change.evidenceQuotes[0].messageId = "not-a-source";
  if (flaw === "no reason") change.reason = "";
  if (flaw === "wrong target") change.targetId = "someone-else";
  provider.mockResolvedValue(response({ ...v, placement: { ...v.placement, identityChange: change } }));
  expect((await validateStoryCardProposal(seed(), config, draft())).proposal).toBeUndefined();
});

it("allows an explicitly evidenced enduring profile change while preserving biography and controls", async () => {
  const a = seed(), content = "Draconia is appointed permanent head of the Binding Research Society.";
  a.messages.at(-1)!.content = content;
  const v = verdict("append", fixture.card.id);
  const identityChange = { targetId: fixture.card.id, kind: "profile", fact: content,
    reason: "An explicit permanent institutional role changes her profile beyond the appointment scene.",
    evidenceQuotes: [{ messageId: fixture.proposal.sourceTurnId, quote: content }] };
  provider.mockResolvedValue(response({ ...v, placement: { ...v.placement, content, newFact: content, identityChange } }));
  const p = (await validateStoryCardProposal(a, config, { ...draft(), content })).proposal!;
  expect(p).toMatchObject({ targetId: fixture.card.id, storyCardType: "character", placementValidation: { identityChange } });
  expect(placementValidationError(a, p)).toBeUndefined();
  const next = reduce(reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p }), { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  expect(next.storyCards[0].content.startsWith(a.storyCards[0].content)).toBe(true);
  expect(next.storyCards[0].content).toContain(content);
  expect(next.storyCards[0].autoUpdate).toBe(a.storyCards[0].autoUpdate);
});

it("requires revalidation of the saved version-2 proposal before automatic approval", () => {
  const a = seed(), p = draft();
  expect(placementValidationError(a, p)).toContain("needs validation");
  a.activeState.memoryProposals = [p];
  expect(reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id, automatic: true }).storyCards).toEqual(a.storyCards);
});

it("does not resolve a Lore finding to a Character via a shared title or explicit mismatched ID", () => {
  const a = seed();
  expect(storyCardTargets(a, { type: "lore", title: fixture.card.title, content: fixture.proposal.content })).toEqual([]);
  expect(storyCardTargets(a, { type: "lore", targetId: fixture.card.id, title, content: fixture.proposal.content })).toEqual([]);
});

it("separately reviews a rejected Character attribution rerouted to Lore without changing its supported text", async () => {
  const a = seed();
  provider.mockResolvedValueOnce(response({ ...verdict(), accepted: false, identityMatchesTarget: false }))
    .mockResolvedValueOnce(response(verdict()));
  const p = (await validateStoryCardProposal(a, config, draft())).proposal!;
  expect(p).toMatchObject({ storyCardType: "lore", targetId: undefined, content: fixture.proposal.content });
  expect(provider).toHaveBeenCalledTimes(2);
});
