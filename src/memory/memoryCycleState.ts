import { storyMemoryMessages } from "./memoryEvidenceWindow";
import type { Adventure, MemoryTargetSnapshot } from "../types/adventure";

export const MEMORY_EVALUATION_GROUPS = ["plot", "storyCards", "brains", "discovery"] as const;

/** One cadence window, bounded to ten sources. No load effect calls this scheduler. */
export function memoryCycleSources(adventure: Adventure) {
  const settings = adventure.memoryDetectionSettings;
  const cadence = Math.max(0, Math.floor(settings.everyNTurns));
  const turn = adventure.activeState.memoryRecoveryStoryTurn ?? 0;
  if (!settings.enabled || !cadence || turn % cadence !== 0) return [];
  return storyMemoryMessages(adventure).filter(message => message.role === "assistant" && message.inputMode !== "comms"
    && message.memoryEvaluation && ["pending", "failed", "running"].includes(message.memoryEvaluation.status)
    && message.memoryEvaluation.attempts < 3
    && (message.memoryEvaluation.nextEligibleTurn ?? 0) <= turn).slice(0, 10);
}

export function memoryTargetSnapshot(adventure: Adventure, kind: MemoryTargetSnapshot["kind"], id: string): MemoryTargetSnapshot | undefined {
  const entry = (kind === "brain" ? adventure.brains : kind === "storyCard" ? adventure.storyCards : adventure.components).find(item => item.id === id);
  return entry ? { kind, id, value: JSON.stringify(entry) } : undefined;
}

export function memoryTargetMatches(adventure: Adventure, target: MemoryTargetSnapshot) {
  return memoryTargetSnapshot(adventure, target.kind, target.id)?.value === target.value;
}
