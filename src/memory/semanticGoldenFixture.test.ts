import { expect, it } from "vitest";
import { semanticGoldenAdventure } from "./semanticGoldenFixture";
import { syntheticMemoryAdventure, offerSourceId } from "./fixtures/syntheticMemoryAdventure";
import type { GoldenMemoryCase } from "./semanticGoldenCases";

it("builds bounded benchmark input from private source selection and reviewed canon without injecting expectations", () => {
  const original = syntheticMemoryAdventure();
  const card = original.storyCards[0];
  const test: GoldenMemoryCase = { id: "external-case", sourceIds: [offerSourceId], expectation: "must", review: "developer-provisional",
    rationale: "An expected outcome must not reach inference.", concepts: [["SECRET_EXPECTED_ANSWER"]],
    acceptance: { title: "SECRET_EXPECTED_TITLE" }, canon: { cardContents: { [card.id]: "Known identity before the selected exchange." } } };
  const input = semanticGoldenAdventure(test, original);
  expect(input.messages.at(-1)?.id).toBe(offerSourceId);
  expect(input.storyCards[0].content).toBe("Known identity before the selected exchange.");
  expect(JSON.stringify(input)).not.toContain("SECRET_EXPECTED");
  expect(original.messages).toHaveLength(30);
  expect(original.storyCards[0].content).toBe(card.content);
});

it("rejects missing original source IDs without fabricating transcript entries", () => {
  expect(() => semanticGoldenAdventure({ sourceIds: ["nonexistent"] }, syntheticMemoryAdventure())).toThrow("Golden source missing");
});
