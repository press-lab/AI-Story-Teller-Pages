import type { Adventure } from "../types/adventure";

export const MEMORY_RECOVERY_INTERVAL = 5;

/** Read the persisted final transcript, never draft text or the rolling evaluation log. */
export function pendingMemoryRecovery(adventure: Adventure) {
  return adventure.messages.filter(message => message.role === "assistant" && message.memoryRecovery?.status === "pending");
}

export function memoryRecoveryBatch(adventure: Adventure) {
  if (!adventure.memoryDetectionSettings.enabled) return [];
  const pending = pendingMemoryRecovery(adventure);
  if (!pending.length) return [];
  const dedicated = adventure.memoryDetectionSettings.evaluator === "dedicated";
  const cadence = adventure.memoryDetectionSettings.everyNTurns ?? 5;
  if (dedicated && cadence === 0) return [];
  const interval = dedicated ? Math.max(1, Math.min(100, Math.floor(cadence))) : Math.max(MEMORY_RECOVERY_INTERVAL, cadence);
  const last = adventure.activeState.lastMemoryRecoveryAttemptTurn;
  const turn = adventure.activeState.memoryRecoveryStoryTurn ?? 0;
  const due = turn - pending[0].memoryRecovery!.turn >= interval - 1
    && (last === undefined || turn - last >= interval);
  // A failed batch stays ahead of newer work. Ten sources allow catching up after a failure.
  return due ? pending.slice(0, 10) : [];
}
