import { expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { overlookedCharacterEvidence } from "./discoveryEvidence";

it("retrieves overlooked named traders while respecting existing aliases and bounding evidence", () => {
  let adventure = createDefaultAdventure("Discovery retrieval");
  adventure.storyCards = [makeStoryCard({ title: "Kori / Nova", content: "A teammate.", keys: ["Kori", "Nova"], type: "character" })];
  for (const content of [
    "Brann is the haulage trader. Tolo operates the lifters. Kori guides their ship.",
    "Brann brings Tolo to headquarters. Kori greets them.",
    ...Array(8).fill("The team waits by the ocean."),
  ]) adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", role: "assistant", content });
  const excerpts = overlookedCharacterEvidence(adventure, 6);
  expect(excerpts.join("\n")).toContain("Brann is the haulage trader. Tolo operates the lifters.");
  expect(excerpts).toHaveLength(1);
  expect(excerpts.join("").length).toBeLessThanOrEqual(1500);
  adventure.storyCards.push(makeStoryCard({ title: "Brann", content: "A trader.", type: "character" }), makeStoryCard({ title: "Tolo", content: "A crew member.", type: "character" }));
  expect(overlookedCharacterEvidence(adventure, 6)).toEqual([]);
});
