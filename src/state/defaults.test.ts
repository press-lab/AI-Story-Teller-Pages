import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "./defaults";

describe("normalizeAdventure", () => {
  it("rehydrates guarded archived story-card facts once when loading old saves", () => {
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
    expect(card?.pinned).toBe(false);
    expect(card?.protected).toBe(false);
  });
});

it("defaults old saves safely and preserves explicit authorization for every card type", () => {
  const a = createDefaultAdventure();
  a.storyCards = (["character", "location", "object", "lore", "relationship", "custom"] as const)
    .map(type => makeStoryCard({ title: type, content: type, type, autonomousDevelopment: true }));
  delete a.memoryAutoApprove.autonomousLoreStoryCard;
  a.memoryAutoApprove.otherStoryCard = true;
  delete a.storyCards[0].autonomousDevelopment;
  const saved = normalizeAdventure(a);
  expect(saved.storyCards.map(card => card.autonomousDevelopment)).toEqual([false, true, true, true, true, true]);
  expect(saved.memoryAutoApprove).toMatchObject({ autonomousLoreStoryCard: false, otherStoryCard: true });
});