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
    expect(card?.coreFacts?.join("\n")).toContain("secret pact");
    expect(card?.coreFacts?.join("\n")).toContain("official cover story");
    expect([...(card?.currentFacts ?? []), ...(card?.recentDevelopments ?? [])].join("\n")).toContain("Sump air filter");
    expect(card?.pinned).toBe(false);
    expect(card?.protected).toBe(false);
  });
});

describe("Story State review routing", () => {
  it("adds Story State to older saves and routes its updates through Memory Suggestions once", () => {
    const legacy = createDefaultAdventure("Legacy");
    const older = {
      ...legacy,
      components: legacy.components.filter((component) => component.type !== "storyState"),
      memoryAutoApprove: { ...legacy.memoryAutoApprove, storyStateUpdate: true },
      activeState: { ...legacy.activeState, stateFlags: {} },
    };
    const normalized = normalizeAdventure(older);
    expect(normalized.components.filter((component) => component.type === "storyState")).toHaveLength(1);
    expect(normalized.memoryAutoApprove.storyStateUpdate).toBe(false);

    // Once migrated, the player's own choice sticks.
    const optedIn = normalizeAdventure({ ...normalized, memoryAutoApprove: { ...normalized.memoryAutoApprove, storyStateUpdate: true } });
    expect(optedIn.memoryAutoApprove.storyStateUpdate).toBe(true);
  });
});
