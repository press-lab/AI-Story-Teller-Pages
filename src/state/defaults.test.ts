import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "./defaults";
import { buildContext } from "../contextBuilder/contextBuilder";

describe("normalizeAdventure", () => {
  it("loads old summary and scene data without reactivating their controls or context sections", () => {
    const old = createDefaultAdventure("Legacy Save");
    old.rollingSummary = { content: "An old summary", updatedAt: old.updatedAt, lastSummarizedMessageIndex: 999 };
    old.sceneState = { content: "An old scene", updatedAt: old.updatedAt };
    old.tokenBudgetSettings = {
      ...old.tokenBudgetSettings,
      autoSummarize: true,
      summaryEnabled: true,
      sceneStateEnabled: true,
      sectionBudgets: { rollingSummary: 10, sceneState: 10, recentMessages: 2500 },
    };
    old.memoryAutoApprove = { ...old.memoryAutoApprove, summaryUpdate: true, plotEssentialsUpdate: true, arcProposal: true };

    const loaded = normalizeAdventure(JSON.parse(JSON.stringify(old)));
    expect(loaded.rollingSummary.content).toBe("An old summary");
    expect(loaded.sceneState?.content).toBe("An old scene");
    expect(loaded.tokenBudgetSettings.autoSummarize).toBeUndefined();
    expect(loaded.tokenBudgetSettings.summaryEnabled).toBeUndefined();
    expect(loaded.tokenBudgetSettings.sceneStateEnabled).toBeUndefined();
    expect(loaded.tokenBudgetSettings.sectionBudgets).toEqual({ recentMessages: 2500 });
    expect(loaded.memoryAutoApprove.summaryUpdate).toBe(false);
    expect(loaded.memoryAutoApprove.plotEssentialsUpdate).toBe(false);
    expect(loaded.memoryAutoApprove.arcProposal).toBe(false);
    const sections = buildContext(loaded, { currentInput: "Continue" }).sections;
    expect(sections.some((section) => section.id === "rollingSummary")).toBe(false);
    expect(sections.some((section) => section.id === "sceneState")).toBe(false);
  });
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
