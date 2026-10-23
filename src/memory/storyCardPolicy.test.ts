import { makeMemoryProposal } from "../test/goldenAdventure";
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


describe("content-only suggestion routing", () => {
  it("approves suggestions into an existing card and keeps content editable after reload", () => {
    const card = makeStoryCard({ title: "Promise", content: "Original promise.", keys: ["Margo"], coreFacts: ["Legacy promise."] });
    const proposal = makeMemoryProposal({ title: "Promise", content: "Margo promised to return.", proposedType: "storyCard", suggestedTriggers: ["Margo"], targetId: card.id });
    let adventure = normalizeAdventure({ ...createDefaultAdventure(), storyCards: [card] });
    adventure = adventureReducer(adventure, { type: "ADD_MEMORY_PROPOSAL", proposal });
    adventure = adventureReducer(adventure, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    adventure = normalizeAdventure(adventure);
    expect(adventure.storyCards).toHaveLength(1);
    const updated = adventure.storyCards[0];
    expect(updated.content).toContain("Legacy promise.");
    expect(updated.content).toContain("Margo promised to return.");
    expect(updated.coreFacts).toBeUndefined();
    expect(updated.currentFacts).toBeUndefined();
    expect(updated.recentDevelopments).toBeUndefined();
    expect(storyCardContextContent(updated)).toBe(updated.content);
    adventure = adventureReducer(adventure, { type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { content: "Edited promise." } });
    expect(normalizeAdventure(adventure).storyCards[0].content).toContain("Edited promise.");
  });
});
