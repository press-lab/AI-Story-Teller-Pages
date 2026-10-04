import { describe, expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { parseAidStoryCards } from "../importers/aidCardParser";
import { importAdventureJson } from "../utils/json";
import {
  createDevelopmentAdventure,
  createDevelopmentAdventureJson,
  createDevelopmentStoryCardsJson,
  developmentAdventureTitle,
} from "./developmentAdventure";

describe("development adventure seed", () => {
  it("creates a complete playtest adventure without provider secrets", () => {
    const adventure = createDevelopmentAdventure();

    expect(adventure.title).toBe(developmentAdventureTitle);
    expect(adventure.modelConfig.apiKey).toBeUndefined();
    expect(adventure.components.length).toBeGreaterThanOrEqual(6);
    expect(adventure.storyCards).toHaveLength(23);
    expect(adventure.brains).toHaveLength(6);
    expect(adventure.triggerRules).toHaveLength(4);
    expect(adventure.messages).toHaveLength(1);
    expect(adventure.components.find((component) => component.title === "AI Instructions")?.content).toContain(
      "second person",
    );
  });

  it("ships a configured Arc Director on the Current Story Arc", () => {
    const adventure = createDevelopmentAdventure();
    const arc = adventure.components.find((component) => component.type === "currentArc");

    expect(arc).toBeDefined();
    expect(arc?.arcThreadKeys?.length).toBeGreaterThan(0);
    expect(arc?.arcPace).toBe("epic");
    expect(arc?.arcTriggerMode).toBe("ask");
    expect(arc?.arcSimmerInstruction).toBeTruthy();
    expect(arc?.arcBreakInstruction).toBeTruthy();
    // Starts simmering (slow burn). The break (cost) instruction stays withheld from
    // context until the phase actually reaches break.
    expect(arc?.arcState?.phase).toBe("simmer");
    const result = buildContext(adventure, { currentInput: "Setu reports to the palace." });
    const arcText = result.sections.find((section) => section.id === "currentArc")?.items.map((item) => item.content).join("\n") ?? "";
    expect(arcText).not.toContain(arc?.arcBreakInstruction ?? "NO BREAK");
    expect(arcText).toContain(arc?.arcSimmerInstruction ?? "NO SIMMER");
  });

  it("builds inspectable context with triggered cards, brains, and summary", () => {
    const adventure = createDevelopmentAdventure();
    const result = buildContext(adventure, {
      currentInput: "Setu studies Nyx and Zuko before the mission briefing.",
      latestModelOutput: adventure.messages[0].content,
    });

    const sectionIds = result.sections.map((section) => section.id);
    expect(sectionIds).toEqual([
      "system",
      "aiInstructions",
      "plotEssentials",
      "currentArc",
      "components",
      "storyCards",
      "brains",
      "authorNote",
      "nextTurnNote",
      "challengeMode",
      "recentMessages",
    ]);

    const storyCardIds = result.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id) ?? [];
    expect(storyCardIds).toContain("dev-card-setu");
    expect(storyCardIds).toContain("dev-card-nyx");
    expect(storyCardIds).toContain("dev-card-zuko");

    const brainIds = result.sections.find((section) => section.id === "brains")?.items.map((item) => item.id) ?? [];
    expect(brainIds).toContain("dev-brain-setu");
    expect(brainIds).toContain("dev-brain-nyx");
    expect(brainIds).toContain("dev-brain-zuko");

    expect(result.messages[0].content).toContain("# B. AI Instructions");
    expect(result.messages[0].content).toContain("# C. Plot Essentials");
    expect(result.messages[0].content).toContain("# F. Story Cards");
    expect(result.sections.find((section) => section.id === "components")?.items.map((item) => item.id)).toEqual([
      "dev-component-mission-loop",
      "dev-component-dragon-fire",
    ]);
  });

  it("can load every development component and every development story card when card keys are present", () => {
    const adventure = createDevelopmentAdventure();
    const allCardKeys = adventure.storyCards.flatMap((card) => card.keys).join(" ");
    const result = buildContext(adventure, {
      currentInput: allCardKeys,
      latestModelOutput: adventure.messages[0].content,
    });

    const includedStoryCardIds = result.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id) ?? [];
    expect(includedStoryCardIds).toEqual(expect.arrayContaining(adventure.storyCards.map((card) => card.id)));
    expect(result.excludedItems.filter((item) => item.sourceType === "storyCard")).toEqual([]);
  });

  it("exports re-importable full adventure JSON and Story Card JSON", () => {
    const imported = importAdventureJson(createDevelopmentAdventureJson());
    expect(imported.title).toBe(developmentAdventureTitle);
    expect(imported.storyCards).toHaveLength(23);
    expect(imported.brains).toHaveLength(6);

    const parsedCards = parseAidStoryCards(createDevelopmentStoryCardsJson());
    expect(parsedCards.error).toBeUndefined();
    expect(parsedCards.cards).toHaveLength(23);
    expect(parsedCards.cards.map((card) => card.storyCard.title)).toContain("Prince Setu");
    expect(parsedCards.cards.map((card) => card.storyCard.title)).toContain("Nyxa");
  });

  it("gives every non-player character card a VOICE CONTRACT", () => {
    const adventure = createDevelopmentAdventure();
    const characterCards = adventure.storyCards.filter((card) => card.type === "character" && card.id !== "dev-card-setu");
    expect(characterCards.length).toBeGreaterThan(0);
    for (const card of characterCards) {
      expect(card.content, `${card.title} should have a VOICE CONTRACT`).toContain("VOICE CONTRACT");
      expect(card.content, `${card.title} should have example lines`).toContain("Example lines:");
    }
  });
});
