import { describe, expect, it } from "vitest";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";

describe("applyAIMemoryUpdate", () => {
  it("rejects protected and non-memory mutation surfaces", () => {
    const authorNote = makeComponent({ id: "author", title: "Author", type: "authorNote", content: "do not change" });
    const aiInstructions = makeComponent({ id: "ai", title: "AI", type: "aiInstructions", content: "do not change" });
    const adventure = { ...createDefaultAdventure("AI Bounds"), components: [authorNote, aiInstructions] };

    const result = applyAIMemoryUpdate(adventure, [
      { type: "componentUpdate", componentId: "author", content: "bad" },
      { type: "componentUpdate", componentId: "ai", content: "bad" },
      { type: "providerConfigUpdate", description: "change provider" },
      { type: "triggerRuleUpdate", targetId: "trigger-1" },
      { type: "questDefinitionUpdate", targetId: "quest-1" },
      { type: "rawImportUpdate", targetId: "raw-1" },
    ]);

    expect(result.actions).toEqual([]);
    expect(result.rejectedUpdates.map((rejection) => rejection.updateType)).toEqual([
      "componentUpdate",
      "componentUpdate",
      "providerConfigUpdate",
      "triggerRuleUpdate",
      "questDefinitionUpdate",
      "rawImportUpdate",
    ]);
    expect(result.rejectedUpdates[0].reason).toContain("authorNote");
    expect(result.rejectedUpdates[1].reason).toContain("aiInstructions");
  });

  it("allows Plot Essentials component content updates through reducer actions", () => {
    const plot = makeComponent({ id: "plot", title: "Plot", type: "plotEssentials", content: "old" });
    const adventure = { ...createDefaultAdventure("AI Bounds"), components: [plot] };

    const result = applyAIMemoryUpdate(adventure, [{ type: "componentUpdate", componentId: "plot", content: "new plot" }]);
    const next = result.actions.reduce((state, action) => adventureReducer(state, action), adventure);

    expect(result.rejectedUpdates).toEqual([]);
    expect(result.appliedUpdates).toEqual([{ targetType: "component", targetId: "plot", actionTypes: ["APPLY_COMPONENT_UPDATE"] }]);
    expect(next.components[0].content).toBe("new plot");
    expect(next.components[0].lastMemoryUpdatedAt).toEqual(expect.any(String));
  });

  it("allows brain and story card memory updates through typed reducer actions", () => {
    const brain = makeBrain({ id: "brain-margo", characterName: "Margo", currentState: "old" });
    const storyCard = makeStoryCard({ id: "card-joke", title: "Joke", content: "old", keys: ["old"] });
    const adventure = { ...createDefaultAdventure("AI Bounds"), brains: [brain], storyCards: [storyCard] };

    const result = applyAIMemoryUpdate(adventure, [
      { type: "brainPatch", brainId: "brain-margo", patch: { currentState: "new" }, mode: "replace", turn: 2 },
      { type: "storyCardUpdate", storyCardId: "card-joke", content: "new card", keys: ["new"], state: "ai-updated" },
    ]);
    const next = result.actions.reduce((state, action) => adventureReducer(state, action), adventure);

    expect(result.rejectedUpdates).toEqual([]);
    expect(result.changedItemIds).toEqual(["brain-margo", "card-joke"]);
    expect(result.appliedUpdates.find((entry) => entry.targetId === "card-joke")?.actionTypes).toEqual(["APPLY_STORY_CARD_UPDATE"]);
    expect(next.brains[0].currentState).toBe("new");
    expect(next.storyCards[0]).toMatchObject({ content: "new card", keys: ["new"], state: "ai-updated" });
    expect(next.storyCards[0].lastMemoryUpdatedAt).toEqual(expect.any(String));
    expect(next.storyCards[0].memoryUpdateHistory?.[0]).toMatchObject({
      source: "aiMemoryUpdate",
      operation: "replace",
      previous: { content: "old", keys: ["old"], state: "" },
      next: { content: "new card", keys: ["new"], state: "ai-updated" },
    });
  });

  it("stamps story cards when AI memory updates only card metadata", () => {
    const storyCard = makeStoryCard({ id: "card-joke", title: "Joke", content: "old", keys: ["old"] });
    const adventure = { ...createDefaultAdventure("AI Bounds"), storyCards: [storyCard] };

    const result = applyAIMemoryUpdate(adventure, [
      { type: "storyCardUpdate", storyCardId: "card-joke", keys: ["new"] },
    ]);
    const next = result.actions.reduce((state, action) => adventureReducer(state, action), adventure);

    expect(result.rejectedUpdates).toEqual([]);
    expect(next.storyCards[0]).toMatchObject({ content: "old", keys: ["new"] });
    expect(next.storyCards[0].lastMemoryUpdatedAt).toEqual(expect.any(String));
    expect(next.storyCards[0].memoryUpdateHistory?.[0]).toMatchObject({
      source: "aiMemoryUpdate",
      operation: "patch",
      previous: { content: "old", keys: ["old"] },
      next: { content: "old", keys: ["new"] },
    });
  });

  it("rejects brain updates when the BrainEntry does not already exist", () => {
    const adventure = createDefaultAdventure("AI Bounds");
    const result = applyAIMemoryUpdate(adventure, [
      { type: "brainPatch", brainId: "missing-brain", patch: { currentState: "new" } },
    ]);

    expect(result.actions).toEqual([]);
    expect(result.rejectedUpdates).toEqual([
      { updateType: "brainPatch", targetId: "missing-brain", reason: "Brain not found." },
    ]);
  });
});
