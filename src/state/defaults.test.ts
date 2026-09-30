import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "./defaults";

describe("normalizeAdventure", () => {
  it("combines existing character facts with Content even after the older compact migration ran", () => {
    const adventure = createDefaultAdventure("Character Save");
    adventure.activeState.stateFlags.compactStoryCardsMigrated = true;
    adventure.storyCards = [makeStoryCard({
      id: "character",
      title: "Margo",
      type: "character",
      content: "Margo is an engineer.\nMargo returned to the workshop.",
      coreFacts: ["Margo is an engineer."],
      currentFacts: ["Margo runs the workshop."],
      recentDevelopments: ["Margo returned to the workshop."],
    })];

    const card = normalizeAdventure(adventure).storyCards[0];
    expect(card.content).toBe("Margo is an engineer.\nMargo runs the workshop.\nMargo returned to the workshop.");
    expect(card.coreFacts).toEqual([]);
    expect(card.currentFacts).toEqual([]);
    expect(card.recentDevelopments).toEqual([]);
  });

  it("folds guarded archived story-card facts into the single content field when loading old saves", () => {
    const adventure = {
      ...createDefaultAdventure("Guarded Save"),
      activeState: {
        ...createDefaultAdventure("Guarded Save").activeState,
        stateFlags: {},
      },
      storyCards: [
        makeStoryCard({
          id: "card-jinx-pact",
          title: "Seth's Pact with Jinx",
          memoryMode: "living",
          content: "- Jinx is repairing the Sump air filter with Seth's arcane help.",
          archivedFacts: "- Seth and Jinx have a secret pact: Jinx stops killing except in self-protection.\n- Mel's official cover story keeps Seth on the Council as a political shield.",
          keys: ["Jinx pact"],
        }),
      ],
    };

    const normalized = normalizeAdventure(adventure);
    const card = normalized.storyCards.find((entry) => entry.id === "card-jinx-pact");

    expect(normalized.activeState.stateFlags.compactStoryCardsMigrated).toBe(true);
    expect(card?.compactKind).toBe("coverStory");
    expect(card?.content).toContain("secret pact");
    expect(card?.content).toContain("official cover story");
    expect(card?.content).toContain("Sump air filter");
    expect(card?.coreFacts).toEqual([]);
    expect(card?.currentFacts).toEqual([]);
    expect(card?.recentDevelopments).toEqual([]);
    expect(card?.pinned).toBe(false);
    expect(card?.protected).toBe(false);
  });
});
