import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { applyGuardedStoryCardPolicy, storyCardContextContent } from "./storyCardPolicy";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";

describe("storyCardContextContent", () => {
  it("retains a casual deal without injecting it into unrelated scenes", () => {
    const card = applyGuardedStoryCardPolicy(makeStoryCard({
      title: "Eleanor's Track-Day Offer", type: "plot", memoryMode: "living",
      content: "Eleanor agreed to lend Seth her car for a track day. No date is set.",
      keys: ["the car deal", "track day"],
    }));
    const adventure = { ...createDefaultAdventure(), storyCards: [card] };
    expect(card.pinned).toBe(false);
    expect(storyCardContextContent(card)).toContain("No date is set");
    const relevant = buildContext(adventure, { currentInput: "We discuss the track day." });
    expect(relevant.sections.find(s => s.id === "storyCards")?.items.map(i => i.id)).toContain(card.id);
    const unrelated = buildContext(adventure, { currentInput: "I order breakfast." });
    expect(unrelated.sections.find(s => s.id === "storyCards")?.items).toHaveLength(0);
  });

  it("preserves saved pins and honors unpin through updates and reload", () => {
    const card = makeStoryCard({ title: "Binding oath", content: "Seth promised to protect the town.", pinned: true });
    let adventure = normalizeAdventure({ ...createDefaultAdventure(), storyCards: [card] });
    expect(adventure.storyCards[0].pinned).toBe(true);
    adventure = adventureReducer(adventure, { type: "UNPIN_STORY_CARD", storyCardId: card.id });
    const updated = applyGuardedStoryCardPolicy(adventure.storyCards[0]);
    adventure = normalizeAdventure({ ...adventure, storyCards: [updated] });
    expect(adventure.storyCards[0].pinned).toBe(false);
    expect(storyCardContextContent(adventure.storyCards[0])).toContain("protect the town");
  });

  it("renders condensed raw content when compact structured facts are cleared", () => {
    const card = makeStoryCard({
      title: "Seth's Pact",
      content: "Condensed pact context.",
      compactKind: "pact",
      compactStatus: "active",
      coreFacts: [],
      currentFacts: [],
      recentDevelopments: [],
    });

    expect(storyCardContextContent(card)).toBe("Condensed pact context.");
  });
});
