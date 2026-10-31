import type { Adventure } from "../types/adventure";
import { snapshotFingerprint } from "../utils/snapshotFingerprint";

// Immutable state permits memoizing unchanged subtrees across worker saves.
const compacted = new WeakMap<object, object>();
function compact<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const cached = compacted.get(value);
  if (cached) return cached as T;
  let changed = false;
  const record = value as Record<string, unknown>;
  const target = typeof record.id === "string" && typeof record.value === "string"
    && ["brain", "storyCard", "component"].includes(String(record.kind));
  const checkpoint = typeof record.batchId === "string" && typeof record.sourceContent === "string" && Array.isArray(record.evidence);
  const next = (Array.isArray(value) ? value.slice() : { ...value }) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const old = record[key];
    // Only equality guards are replaced. Evidence, drafts, errors, counters and
    // retry checkpoints remain intact, including rejected/ignored proposals.
    const item = typeof old === "string" && ((checkpoint && key === "referenceState" && old !== "") || (target && key === "value"))
      ? snapshotFingerprint(old) : compact(old);
    if (item !== old) { next[key] = item; changed = true; }
  }
  const result = changed ? next as T : value;
  compacted.set(value, result as object);
  compacted.set(result as object, result as object);
  return result;
}

/** Upgrade legacy guards on load/save/export without changing story or evidence.
 * Undo/redo message snapshots are included so restoring an entry cannot bring
 * the large reference copies back. No archive decoding or background job runs.
 */
export function compactMemoryGuards(a: Adventure): Adventure {
  const messages = a.messages.map(m => {
    const evaluation = compact(m.memoryEvaluation);
    return evaluation === m.memoryEvaluation ? m : { ...m, memoryEvaluation: evaluation };
  });
  const proposals = compact(a.activeState.memoryProposals);
  const undo = compact(a.activeState.storyUndoStack);
  const redo = compact(a.activeState.storyRedoStack);
  const sameMessages = messages.every((m, i) => m === a.messages[i]);
  if (sameMessages && proposals === a.activeState.memoryProposals && undo === a.activeState.storyUndoStack && redo === a.activeState.storyRedoStack) return a;
  return { ...a, messages: sameMessages ? a.messages : messages,
    activeState: { ...a.activeState, memoryProposals: proposals, storyUndoStack: undo, storyRedoStack: redo } };
}
