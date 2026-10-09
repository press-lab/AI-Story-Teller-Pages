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
  const interval = Math.max(MEMORY_RECOVERY_INTERVAL, adventure.memoryDetectionSettings.everyNTurns ?? 1);
  const last = adventure.activeState.lastMemoryRecoveryAttemptTurn;
  const turn = adventure.activeState.memoryRecoveryStoryTurn ?? 0;
  const due = turn - pending[0].memoryRecovery!.turn >= interval - 1
    && (last === undefined || turn - last >= interval);
  // A failed batch stays ahead of newer work. Ten sources allow catching up after a failure.
  return due ? pending.slice(0, 10) : [];
}
