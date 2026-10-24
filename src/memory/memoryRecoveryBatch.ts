import type { Adventure } from "../types/adventure";

export const MEMORY_RECOVERY_INTERVAL = 5;
export const MEMORY_RECOVERY_MAX_FAILURES = 4;

export function memoryRecoveryInterval(adventure: Adventure) {
  const dedicated = adventure.memoryDetectionSettings.evaluator === "dedicated";
  const cadence = adventure.memoryDetectionSettings.everyNTurns ?? 5;
  return dedicated ? Math.max(1, Math.min(100, Math.floor(cadence))) : Math.max(MEMORY_RECOVERY_INTERVAL, cadence);
}

/** Persisted final sources only. Quarantined sources remain available for manual evaluation. */
export function pendingMemoryRecovery(adventure: Adventure) {
  return adventure.messages.filter(message => message.role === "assistant" && message.memoryRecovery?.status === "pending");
}

export function memoryRecoveryBatch(adventure: Adventure) {
  if (!adventure.memoryDetectionSettings.enabled
    || (adventure.memoryDetectionSettings.evaluator === "dedicated" && adventure.memoryDetectionSettings.everyNTurns === 0)) return [];
  const interval = memoryRecoveryInterval(adventure);
  const turn = adventure.activeState.memoryRecoveryStoryTurn ?? 0;
  const last = adventure.activeState.lastMemoryRecoveryAttemptTurn;
  if (last !== undefined && turn - last < interval) return [];
  const pending = pendingMemoryRecovery(adventure);
  if (!pending.length || turn - pending[0].memoryRecovery!.turn < interval - 1) return [];
  const eligible = pending.filter(message => turn >= (message.memoryRecovery!.nextEligibleTurn ?? 0));
  const fresh = eligible.filter(message => !message.memoryRecovery?.failures);
  const retry = eligible.filter(message => message.memoryRecovery?.failures);
  // Alternate fresh work and retries when both exist. Never place a known failing
  // prefix in front of fresh work in the same request. Sources stay chronological.
  const pool = fresh.length && (!retry.length || adventure.activeState.lastMemoryRecoveryAttemptKind !== "fresh") ? fresh : retry;
  const limit = Math.min(10, ...pool.map(message => message.memoryRecovery?.batchLimit ?? 10));
  return pool.slice(0, limit);
}
