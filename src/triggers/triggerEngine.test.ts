import { describe, expect, it } from "vitest";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeComponent, makeStoryCard, makeTriggerRule } from "../state/defaults";
import type { Adventure } from "../types/adventure";
import { evaluateTriggerRules } from "./triggerEngine";

function applyActions(adventure: Adventure, actions: ReturnType<typeof evaluateTriggerRules>["actions"]): Adventure {
  return actions.reduce((state, action) => adventureReducer(state, action), adventure);
}

describe("evaluateTriggerRules", () => {
  it("fires keyword triggers from input and applies actions through reducer", () => {
    const component = makeComponent({ id: "component-door", title: "Door", content: "Closed", active: false });
    const rule = makeTriggerRule({
      id: "trigger-door",
      name: "Open Door",
      evaluationMode: "keyword",
      matchType: "keyword",
      source: "input",
      patterns: ["door"],
      actions: [{ type: "activateComponent", componentId: component.id }],
      priority: 10,
    });
    const adventure = { ...createDefaultAdventure("Triggers"), components: [component], triggerRules: [rule] };

    const result = evaluateTriggerRules(adventure, { source: "input", text: "Open the door." });
    const next = applyActions(adventure, result.actions);

    expect(result.firedRuleIds).toEqual(["trigger-door"]);
    expect(next.components[0].active).toBe(true);
    expect(next.activeState.triggerLog[0]).toMatchObject({
      triggerRuleId: "trigger-door",
      source: "input",
      matchedPattern: "door",
      actionCount: 1,
    });
  });

  it("fires keyword triggers from output", () => {
    const card = makeStoryCard({ id: "card-lamp", title: "Lamp", content: "Lamp", active: false });
    const rule = makeTriggerRule({
      id: "trigger-lamp",
      name: "Lamp Appears",
      evaluationMode: "keyword",
      source: "output",
      patterns: ["lamp"],
      actions: [{ type: "activateStoryCard", storyCardId: card.id }],
    });
    const adventure = { ...createDefaultAdventure("Triggers"), storyCards: [card], triggerRules: [rule] };

    const next = applyActions(adventure, evaluateTriggerRules(adventure, { source: "output", text: "A lamp flickers." }).actions);
    expect(next.storyCards[0].active).toBe(true);
  });

  it("fires regex triggers only when regex matches", () => {
    const component = makeComponent({ id: "component-chapter", title: "Chapter", content: "old" });
    const rule = makeTriggerRule({
      id: "trigger-regex",
      name: "Chapter Number",
      evaluationMode: "regex",
      source: "both",
      patterns: ["chapter\\s+\\d+"],
      actions: [{ type: "updateComponent", componentId: component.id, patch: { content: "matched" } }],
    });
    const adventure = { ...createDefaultAdventure("Triggers"), components: [component], triggerRules: [rule] };

    expect(evaluateTriggerRules(adventure, { source: "input", text: "chapter forty" }).firedRuleIds).toEqual([]);
    const next = applyActions(adventure, evaluateTriggerRules(adventure, { source: "input", text: "chapter 42" }).actions);
    expect(next.components[0].content).toBe("matched");
  });

  it("does not fire disabled triggers or triggers on cooldown", () => {
    const disabled = makeTriggerRule({
      id: "trigger-disabled",
      name: "Disabled",
      enabled: false,
      evaluationMode: "keyword",
      patterns: ["door"],
      actions: [{ type: "forceIncludeNextTurn", targetType: "storyCard", targetId: "card-x" }],
    });
    const cooling = makeTriggerRule({
      id: "trigger-cooling",
      name: "Cooling",
      evaluationMode: "keyword",
      patterns: ["door"],
      cooldownTurns: 3,
      lastFiredTurn: 4,
      actions: [{ type: "forceIncludeNextTurn", targetType: "storyCard", targetId: "card-y" }],
    });
    const adventure = {
      ...createDefaultAdventure("Triggers"),
      activeState: { ...createDefaultAdventure("Triggers").activeState, turn: 5 },
      triggerRules: [disabled, cooling],
    };

    expect(evaluateTriggerRules(adventure, { source: "input", text: "door" }).firedRuleIds).toEqual([]);
  });

  it("uses deterministic priority order and logs each fired trigger", () => {
    const ruleLow = makeTriggerRule({
      id: "trigger-b",
      name: "B",
      evaluationMode: "keyword",
      patterns: ["signal"],
      priority: 10,
      actions: [{ type: "forceIncludeNextTurn", targetType: "storyCard", targetId: "card-b" }],
    });
    const ruleHigh = makeTriggerRule({
      id: "trigger-a",
      name: "A",
      evaluationMode: "keyword",
      patterns: ["signal"],
      priority: 20,
      actions: [{ type: "forceIncludeNextTurn", targetType: "storyCard", targetId: "card-a" }],
    });
    const adventure = { ...createDefaultAdventure("Triggers"), triggerRules: [ruleLow, ruleHigh] };

    const result = evaluateTriggerRules(adventure, { source: "input", text: "signal" });
    const next = applyActions(adventure, result.actions);

    expect(result.firedRuleIds).toEqual(["trigger-a", "trigger-b"]);
    expect(next.activeState.triggerLog.map((entry) => entry.triggerRuleId)).toEqual(["trigger-b", "trigger-a"]);
    expect(next.triggerRules.find((rule) => rule.id === "trigger-a")?.lastFiredTurn).toBe(0);
    expect(next.triggerRules.find((rule) => rule.id === "trigger-b")?.lastFiredTurn).toBe(0);
  });
});
