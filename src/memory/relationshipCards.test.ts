import { describe, expect, it } from "vitest";
import { makeStoryCard } from "../state/defaults";
import { relationshipCardError, relationshipCharacterMatches, relationshipKey, relationshipMatches, relationshipTitle, validateRelationshipIds } from "./relationshipCards";

const characters = ["a", "b", "c", "d"].map(id => makeStoryCard({ id, type: "character", title: id.toUpperCase(), content: "" }));
const pair = makeStoryCard({ id: "ab", type: "relationship", title: "A + B", content: "History", relationship: { characterIds: ["a", "b"] } });

describe("relationship card identity", () => {
  it("identifies unordered groups without mutating participant order", () => {
    const ids = ["b", "a"];
    expect(relationshipKey(ids)).toBe(relationshipKey(["a", "b"]));
    expect(ids).toEqual(["b", "a"]);
    expect(relationshipKey(ids)).not.toBe(relationshipKey(["a", "b", "c"]));
    expect(validateRelationshipIds(characters, ["a", "b", "c", "d"])).toBeUndefined();
    expect(relationshipTitle(characters, ids)).toBe("A + B");
  });

  it.each([[], ["a"], ["a", "a"], ["a", ""], ["a", "z"], ["a", "ab"], null])("rejects invalid links %j", ids => {
    expect(validateRelationshipIds([...characters, pair], ids)).toBeTruthy();
  });

  it("detects duplicate exact sets even when inactive", () => {
    const duplicate = { ...pair, id: "duplicate", active: false };
    const cards = [...characters, pair, duplicate];
    expect(relationshipMatches(cards, ["b", "a"])).toEqual([pair, duplicate]);
    expect(relationshipCardError(cards, pair)).toContain("exact set");
  });
});

it("uses exact normalized titles before aliases and reports ambiguous aliases", () => {
  const identities = [{ id: "1", title: "A. Name", keys: ["Shared"] }, { id: "2", title: "Second", keys: ["A Name", "Shared"] }];
  expect(relationshipCharacterMatches(identities, "Ａ name").map(card => card.id)).toEqual(["1"]);
  expect(relationshipCharacterMatches(identities, "Shared").map(card => card.id)).toEqual(["1", "2"]);
  expect(relationshipCharacterMatches(identities, "Second name")).toEqual([]);
});
