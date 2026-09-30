import type {
  Adventure,
  AdventureAction,
  TriggerAction,
  TriggerCondition,
  TriggerLogEntry,
  TriggerRule,
} from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { matchPatterns } from "./matching";

export interface TriggerEvaluationEvent {
  source: "input" | "output";
  text: string;
}

export interface TriggerEvaluationResult {
  actions: AdventureAction[];
  firedRuleIds: string[];
}

function prioritySort<T extends { priority: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function compare(value: unknown, condition: TriggerCondition): boolean {
  switch (condition.operator) {
    case "equals":
      return value === condition.value;
    case "notEquals":
      return value !== condition.value;
    case "gte":
      return Number(value) >= Number(condition.value);
    case "lte":
      return Number(value) <= Number(condition.value);
    case "includes":
      return String(value ?? "").toLocaleLowerCase().includes(String(condition.value).toLocaleLowerCase());
    default:
      return false;
  }
}

function conditionsPass(adventure: Adventure, conditions: TriggerCondition[]): boolean {
  return conditions.every((condition) => {
    if (condition.field === "turn") return compare(adventure.activeState.turn, condition);
    if (condition.field === "stateFlag") {
      return compare(adventure.activeState.stateFlags[condition.key ?? ""], condition);
    }
    return false;
  });
}

export function isTriggerOnCooldown(adventure: Adventure, rule: TriggerRule): boolean {
  if (!rule.cooldownTurns || rule.lastFiredTurn === undefined) return false;
  return adventure.activeState.turn - rule.lastFiredTurn < rule.cooldownTurns;
}

function makeLogEntry(
  adventure: Adventure,
  rule: TriggerRule,
  event: TriggerEvaluationEvent,
  matchedPattern: string | undefined,
  actionCount: number,
): TriggerLogEntry {
  return {
    id: createId("triggerLog"),
    triggerRuleId: rule.id,
    triggerName: rule.name,
    source: event.source,
    turn: adventure.activeState.turn,
    matchedPattern,
    textSnippet: event.text.slice(0, 160),
    actionCount,
    createdAt: nowIso(),
  };
}

export function triggerActionToAdventureActions(
  adventure: Adventure,
  triggerAction: TriggerAction,
  depth = 0,
): AdventureAction[] {
  if (depth > 3) return [];

  switch (triggerAction.type) {
    case "activateComponent":
      return [{ type: "ACTIVATE_COMPONENT", componentId: triggerAction.componentId }];
    case "deactivateComponent":
      return [{ type: "DEACTIVATE_COMPONENT", componentId: triggerAction.componentId }];
    case "pinComponent":
      return [{ type: "PIN_COMPONENT", componentId: triggerAction.componentId }];
    case "unpinComponent":
      return [{ type: "UNPIN_COMPONENT", componentId: triggerAction.componentId }];
    case "updateComponent":
      if (!triggerAction.patch) return [];
      return [{ type: "UPDATE_COMPONENT", componentId: triggerAction.componentId, patch: triggerAction.patch }];
    case "activateStoryCard":
      return [{ type: "ACTIVATE_STORY_CARD", storyCardId: triggerAction.storyCardId }];
    case "deactivateStoryCard":
      return [{ type: "DEACTIVATE_STORY_CARD", storyCardId: triggerAction.storyCardId }];
    case "pinStoryCard":
      return [{ type: "PIN_STORY_CARD", storyCardId: triggerAction.storyCardId }];
    case "unpinStoryCard":
      return [{ type: "UNPIN_STORY_CARD", storyCardId: triggerAction.storyCardId }];
    case "updateStoryCard":
      if (!triggerAction.patch) return [];
      return [{ type: "UPDATE_STORY_CARD", storyCardId: triggerAction.storyCardId, patch: triggerAction.patch }];
    case "activateBrain":
      return [{ type: "ACTIVATE_BRAIN", brainId: triggerAction.brainId }];
    case "deactivateBrain":
      return [{ type: "DEACTIVATE_BRAIN", brainId: triggerAction.brainId }];
    case "updateBrain":
    case "appendBrain":
      return [];
    case "appendBrainState":
      return [{ type: "APPEND_BRAIN_STATE", brainId: triggerAction.brainId, field: triggerAction.field, text: triggerAction.text }];
    case "replaceBrainState":
      return [{ type: "REPLACE_BRAIN_STATE", brainId: triggerAction.brainId, field: triggerAction.field, text: triggerAction.text }];
    case "updateComponentPressure":
    case "updateComponentMomentum":
    case "updateComponentArc":
    case "updateSummary":
      return [];
    case "forceIncludeNextTurn":
      return [{ type: "FORCE_INCLUDE_NEXT_TURN", targetType: triggerAction.targetType, targetId: triggerAction.targetId }];
    default: {
      const exhaustive: never = triggerAction;
      return exhaustive;
    }
  }
}

export function evaluateTriggerRules(adventure: Adventure, event: TriggerEvaluationEvent): TriggerEvaluationResult {
  const actions: AdventureAction[] = [];
  const firedRuleIds = new Set<string>();

  for (const rule of prioritySort(adventure.triggerRules)) {
    if (!rule.enabled) continue;
    const evaluationMode = rule.evaluationMode ?? (rule.matchType === "regex" ? "regex" : "keyword");
    if (evaluationMode === "semantic") continue;
    if (rule.source !== "both" && rule.source !== event.source) continue;
    if (firedRuleIds.has(rule.id)) continue;
    if (isTriggerOnCooldown(adventure, rule)) continue;
    if (!conditionsPass(adventure, rule.conditions)) continue;

    const matchType = evaluationMode === "regex" ? "regex" : rule.matchType === "phrase" ? "phrase" : "keyword";
    const match = matchPatterns(event.text, rule.patterns, matchType);
    if (!match.matched) continue;

    const mappedActions = rule.actions.flatMap((triggerAction) =>
      triggerActionToAdventureActions(adventure, triggerAction),
    );
    actions.push(...mappedActions);
    actions.push({ type: "MARK_TRIGGER_FIRED", triggerRuleId: rule.id, turn: adventure.activeState.turn });
    actions.push({ type: "LOG_TRIGGER_FIRE", entry: makeLogEntry(adventure, rule, event, match.pattern, mappedActions.length) });
    firedRuleIds.add(rule.id);
  }

  return { actions, firedRuleIds: [...firedRuleIds] };
}
