import type { TriggerAction, TriggerRule } from "../types/adventure";

// Older saves can retain these actions, but they no longer have a current memory target.
export function activeSemanticActions(rule: TriggerRule): TriggerAction[] {
  return (rule.actions ?? []).filter((action) => action.type !== "updateSummary" && action.type !== "updateComponentMomentum");
}

export function isRunnableSemanticRule(rule: TriggerRule): boolean {
  return rule.enabled && (rule.evaluationMode ?? "semantic") === "semantic"
    && Boolean(rule.condition?.trim()) && activeSemanticActions(rule).length > 0;
}
