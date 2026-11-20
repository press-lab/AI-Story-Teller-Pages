import { expect, it } from "vitest";
import { buildContext } from "./contextBuilder";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";

it("uses final Character membership and never chains out of linked history", () => {
  const a = createDefaultAdventure("Relationship context test");
  const character = (id: string, title: string) => makeStoryCard({ id, type: "character", title, content: title + " is a student." });
  const relationship = (id: string, characterIds: string[], content: string) =>
    makeStoryCard({ id, title: id, type: "relationship", relationship: { characterIds }, content, pinned: true, protected: true });
  a.storyCards = [character("a", "Seth"), character("b", "Elliot"), character("c", "Margo"), character("d", "Julia"),
    relationship("ab", ["a", "b"], "Julia appears in this piece of shared history."),
    relationship("bc", ["b", "c"], "Elliot trusts Margo."),
    relationship("abc", ["a", "b", "c"], "They have a weekly study group."),
    relationship("abd", ["a", "b", "d"], "They share a secret.")];
  const build = (currentInput: string) => buildContext(a, { currentInput });
  const relationshipIds = (input: string) => build(input).sections.find(section => section.id === "storyCards")?.items
    .map(card => card.id).filter(id => id.length > 1);
  expect(relationshipIds("Seth enters.")).toEqual([]);
  expect(relationshipIds("Seth and Elliot enter.")).toEqual(["ab"]);
  expect(relationshipIds("Seth, Elliot and Margo enter.")?.sort()).toEqual(["ab", "abc", "bc"]);
  const result = build("Seth and Elliot enter.");
  expect(result.triggeredThreadIds).toContain("ab");
  expect(result.sections.find(section => section.id === "storyCards")?.items.map(card => card.id)).not.toContain("d");
  expect(result.messages.some(message => message.content.includes("Established interpersonal history"))).toBe(true);
  expect(build("Seth and Elliot enter.")).toEqual(result);
});

it("uses one-hop Character Cards and leaves the baseline intact when the full relationship cannot fit", () => {
  const a = createDefaultAdventure("Relationship budget");
  a.components = [];
  a.storyCards = [
    makeStoryCard({ id: "a", title: "Alice", type: "character", content: "Brian is her colleague." }),
    makeStoryCard({ id: "b", title: "Brian", type: "character", content: "Brian teaches." }),
    makeStoryCard({ id: "ab", title: "Colleagues", type: "relationship", content: "Alice and Brian started a school. ".repeat(200),
      relationship: { characterIds: ["a", "b"] } }),
  ];
  const build = () => buildContext(a, { currentInput: "Alice enters." });
  expect(build().triggeredThreadIds).toContain("ab");
  const baseline = buildContext({ ...a, storyCards: a.storyCards.slice(0, 2) }, { currentInput: "Alice enters." });
  a.tokenBudgetSettings.maxContextTokens = baseline.totalEstimatedTokens;
  const tight = build();
  expect(tight.sections).toEqual(baseline.sections);
  expect(tight.messages).toEqual(baseline.messages);
  expect(tight.excludedItems).toContainEqual(expect.objectContaining({ id: "ab", reason: "budget_exceeded" }));
  expect(tight.triggeredThreadIds).not.toContain("ab");
  a.storyCards[1].active = false;
  expect(build().excludedItems).toContainEqual(expect.objectContaining({ id: "ab", reason: "relationship_members_missing" }));
  a.storyCards[2].relationship = { characterIds: ["a", "missing"] };
  expect(build().excludedItems).toContainEqual(expect.objectContaining({ id: "ab", reason: "relationship_invalid_links" }));
});
