import { expect, it } from "vitest";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import type { MemoryProposal } from "../types/adventure";
import { adventureReducer as reduce } from "./adventureReducer";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "./defaults";

function fixture() {
  const a = createDefaultAdventure("Linked card test");
  a.storyCards = ["a", "b", "c"].map(id => makeStoryCard({ id, type: "character", title: id.toUpperCase(), content: "" }));
  return a;
}

function proposal(id: string, content: string): MemoryProposal {
  return { id, title: "A + B", content, sourceText: content, sourceTurnId: "manual", proposedType: "storyCard",
    storyCardType: "relationship", relationship: { characterIds: ["b", "a"] }, status: "pending", userInitiated: true,
    requiresReview: true, rationale: "Explicit draft", suggestedTriggers: [], confidence: 1, createdAt: "", updatedAt: "" };
}

it("reconciles reverse-order approvals into one card without dropping distinct facts", () => {
  let a = fixture();
  const first = proposal("first", "A and B became confidants.");
  const second = proposal("second", "A promised to protect B's privacy.");
  for (const p of [first, second]) a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: second.id });
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: first.id });
  expect(a.activeState.memoryProposals.find(p => p.id === first.id)).toMatchObject({ status: "pending", cardOperation: "append" });
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: first.id });
  const relations = a.storyCards.filter(card => card.type === "relationship");
  expect(relations).toHaveLength(1);
  expect(relations[0].content).toBe(second.content + "\n" + first.content);
  expect(relations[0].relationship?.characterIds).toEqual(["a", "b"]);
  expect(relations[0].memoryUpdateHistory).toHaveLength(2);
});

it("blocks invalid writes and protects linked Characters, while restore preserves broken data", () => {
  const a = fixture();
  const valid = makeStoryCard({ id: "valid", type: "relationship", title: "A + B", content: "History", relationship: { characterIds: ["a", "b"] } });
  const invalid = { ...valid, id: "invalid", relationship: { characterIds: ["a", "missing"] } };
  expect(reduce(a, { type: "IMPORT_STORY_CARDS", storyCards: [valid, invalid] })).toBe(a);
  const linked = reduce(a, { type: "IMPORT_STORY_CARDS", storyCards: [valid] });
  expect(reduce(linked, { type: "DELETE_STORY_CARD", storyCardId: "b" })).toBe(linked);
  expect(reduce(linked, { type: "UPDATE_STORY_CARD", storyCardId: "b", patch: { type: "custom" } })).toBe(linked);
  expect(reduce(linked, { type: "UPDATE_STORY_CARD", storyCardId: "b", patch: { id: "moved" } })).toBe(linked);
  const renamed = reduce(linked, { type: "UPDATE_STORY_CARD", storyCardId: "b", patch: { title: "Renamed" } });
  expect(renamed.storyCards.find(card => card.id === valid.id)).toMatchObject({ title: "A + B", relationship: valid.relationship });
  const restored = normalizeAdventure({ ...linked, storyCards: [...linked.storyCards, invalid] });
  expect(restored.storyCards.find(card => card.id === invalid.id)).toMatchObject({ active: false, relationship: invalid.relationship, content: "History" });
  const duplicated = importAdventureJson(exportAdventureJson(restored), true);
  expect(duplicated.id).not.toBe(restored.id);
  expect(duplicated.storyCards).toEqual(restored.storyCards);
  expect(normalizeAdventure(duplicated).storyCards).toEqual(duplicated.storyCards);
});

it("scopes rejected facts and stale APPEND proposals to their exact linked set", () => {
  let a = fixture();
  const first = proposal("first", "A and B became confidants.");
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: first });
  a = reduce(a, { type: "REJECT_MEMORY_PROPOSAL", proposalId: first.id });
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...first, id: "repeat" } });
  expect(a.activeState.memoryProposals.some(p => p.id === "repeat")).toBe(false);
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...first, id: "group", relationship: { characterIds: ["a", "b", "c"] } } });
  expect(a.activeState.memoryProposals.some(p => p.id === "group")).toBe(true);
  a = reduce(a, { type: "UPSERT_STORY_CARD", storyCard: makeStoryCard({ id: "ab", type: "relationship", title: "A + B",
    relationship: { characterIds: ["a", "b"] }, content: "They knew each other." }) });
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal("append", "A promised to protect B."), targetId: "ab" } });
  a = reduce(a, { type: "UPDATE_STORY_CARD", storyCardId: "ab", patch: { relationship: { characterIds: ["a", "c"] } } });
  a = reduce(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "append" });
  expect(a.activeState.memoryProposals.find(p => p.id === "append")).toMatchObject({ status: "pending", approvalFeedback: expect.stringContaining("no longer matches") });
  expect(a.storyCards.find(card => card.id === "ab")?.content).toBe("They knew each other.");
});
