import type { Adventure, AdventureAction, ProviderConfig } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { adventureReducer } from "../state/adventureReducer";
import { runCompactMemoryFallback } from "./compactMemoryFallback";

/** Explicit on-demand work: one bounded background request, no narration or Brain writes. */
export async function evaluateStoryCardEntries(adventure: Adventure, config: ProviderConfig, sourceIds: string[]) {
  const ids = [...new Set(sourceIds)];
  if (!ids.length || ids.length > 10) throw new Error("Select between one and ten completed narrator entries.");
  const sources = adventure.messages.filter(message => ids.includes(message.id) && message.role === "assistant" && message.inputMode !== "comms");
  if (sources.length !== ids.length) throw new Error("A selected completed entry is no longer available.");
  const local: AdventureAction[] = sources.map(source => ({ type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: source.id, manual: true }));
  const snapshot = local.reduce(adventureReducer, adventure);
  try {
    const evaluated = await runCompactMemoryFallback(snapshot, config, sources, { storyCardsOnly: true });
    if (!evaluated.valid) {
      const diagnostics: AdventureAction[] = evaluated.actions.some(action => action.type === "LOG_EVALUATION_RESULT") ? [] : [{ type: "LOG_EVALUATION_RESULT", entry: {
        id: createId("eval"), turn: adventure.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [], conditionsFired: [], generatedContent: [],
        actionsExecuted: ["Requested memory evaluation failed; sources retained", `Memory sources: ${ids.join(", ")}`],
        errors: [evaluated.error ?? "Memory evaluation failed schema validation."],
      } }];
      return { ...evaluated, actions: [...local, ...evaluated.actions, ...diagnostics] };
    }
    // Explicit evaluation of already-evaluated history keeps its existing behavior.
    // Pending work uses the same atomic completion path as automatic recovery.
    if (!sources.some(source => source.memoryRecovery?.status === "pending")) return { ...evaluated, actions: [...local, ...evaluated.actions] };
    const completed = evaluated.processedSources ?? [];
    const queue: AdventureAction[] = completed.map(source => ({ type: "QUEUE_MEMORY_RECOVERY", messageId: source.id,
      turn: adventure.activeState.memoryRecoveryStoryTurn ?? 0 }));
    return { ...evaluated, actions: [...local, ...queue, { type: "COMPLETE_MEMORY_RECOVERY" as const,
      sources: completed, dependencies: evaluated.sourceSnapshots, actions: evaluated.actions }] };
  } catch (error) {
    return { valid: false, actions: local, tokenUsage: { promptTokens: 0, completionTokens: 0 },
      error: error instanceof Error ? error.message : "Requested model evaluation failed; local candidates retained.", processedSources: [] };
  }
}
