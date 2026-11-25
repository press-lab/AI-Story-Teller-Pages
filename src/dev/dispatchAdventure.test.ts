import { describe, expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { parseAidStoryCards } from "../importers/aidCardParser";
import { importAdventureJson } from "../utils/json";
import {
  createDispatchAdventure,
  createDispatchAdventureJson,
  createDispatchStoryCardsJson,
  dispatchAdventureTitle,
} from "./dispatchAdventure";

describe("dispatch adventure seed", () => {
  it("creates a complete playtest adventure without provider secrets", () => {
    const adventure = createDispatchAdventure();

    expect(adventure.title).toBe(dispatchAdventureTitle);
    expect(adventure.modelConfig.apiKey).toBeUndefined();
    expect(adventure.components.length).toBeGreaterThanOrEqual(6);
    expect(adventure.storyCards).toHaveLength(21);
    expect(adventure.brains).toHaveLength(8);
    expect(adventure.triggerRules).toHaveLength(4);
    expect(adventure.messages).toHaveLength(1);
    expect(adventure.components.find((component) => component.title === "AI Instructions")?.content).toContain(
      "second person",
    );
  });

  it("gives every non-player character card a VOICE CONTRACT", () => {
    const adventure = createDispatchAdventure();
    const characterCards = adventure.storyCards.filter((card) => card.type === "character" && card.id !== "disp-card-seth");
    expect(characterCards.length).toBeGreaterThan(0);
    for (const card of characterCards) {
      expect(card.content, `${card.title} should have a VOICE CONTRACT`).toContain("VOICE CONTRACT");
      expect(card.content, `${card.title} should have example lines`).toContain("Example lines:");
    }
  });

  it("exports re-importable full adventure JSON and Story Card JSON", () => {
    const imported = importAdventureJson(createDispatchAdventureJson());
    expect(imported.title).toBe(dispatchAdventureTitle);
    expect(imported.storyCards).toHaveLength(21);
    expect(imported.brains).toHaveLength(8);

    const parsedCards = parseAidStoryCards(createDispatchStoryCardsJson());
    expect(parsedCards.error).toBeUndefined();
    expect(parsedCards.cards).toHaveLength(21);
    expect(parsedCards.cards.map((card) => card.storyCard.title)).toContain("Seth Prest");
    expect(parsedCards.cards.map((card) => card.storyCard.title)).toContain("Flambae");
  });
});
