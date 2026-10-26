import type { Adventure, MemoryEvaluationGroup, PendingBrainDelta } from "../types/adventure";
import { storyMemoryMessages } from "./memoryEvidenceWindow";

const groups: MemoryEvaluationGroup[] = ["plot", "storyCards", "brains", "discovery"];
const key = (delta: PendingBrainDelta) => `${delta.sourceId}:${delta.brainId}`;

/** Local evidence repair only. Never applies a patch or replays an approval. */
export function reconcileBrainBatchState(adventure: Adventure): Adventure {
  const sources = new Map(storyMemoryMessages(adventure).filter(m => m.role === "assistant").map(m => [m.id, m]));
  const brains = new Set(adventure.brains.map(b => b.id));
  const valid = (d: PendingBrainDelta): boolean => Boolean(d && typeof d.sourceId === "string"
    && typeof d.brainId === "string" && brains.has(d.brainId)
    && typeof d.sourceContent === "string" && sources.get(d.sourceId)?.content === d.sourceContent
    && typeof d.delta === "string" && typeof d.sourceTurn === "number" && Number.isFinite(d.sourceTurn)
    && Array.isArray(d.evidenceMessageIds) && d.evidenceMessageIds.every(id => typeof id === "string"));
  const pending = new Map<string, PendingBrainDelta>();
  const add = (d: PendingBrainDelta) => { if (valid(d) && !pending.has(key(d))) pending.set(key(d), d); };
  for (const delta of adventure.activeState.pendingBrainDeltas ?? []) add(delta);
  let changed = false;
  const messages = adventure.messages.map(message => {
    const evaluation = message.memoryEvaluation;
    const work = evaluation?.groupWork?.brains;
    const batch = work?.brainBatch;
    if (!evaluation || !batch || evaluation.completedGroups.includes("brains")) return message;
    const deltas = [...batch.enqueue, ...batch.batches.flat()];
    const frozen = new Map(deltas.filter(d => d && typeof d.sourceId === "string" && typeof d.brainId === "string").map(d => [key(d), d]));
    const stale = deltas.some(d => !valid(d)) || batch.consumeKeys.some(k => {
      const delta = frozen.get(k) ?? pending.get(k);
      return !delta || !valid(delta);
    });
    if (!stale) return message;
    for (const delta of deltas) add(delta);
    const ownSourceChanged = deltas.some(d => d?.sourceId === message.id && d.sourceContent !== message.content);
    const completedGroups = ownSourceChanged ? evaluation.completedGroups : [...evaluation.completedGroups, "brains" as const];
    changed = true;
    return { ...message, memoryEvaluation: { ...evaluation, completedGroups,
      groupWork: { ...evaluation.groupWork, brains: undefined },
      ...(ownSourceChanged ? { assessment: undefined } : {}),
      status: groups.every(g => completedGroups.includes(g)) ? "complete" as const : "pending" as const,
      lastError: undefined,
    } };
  });
  // Recovered entries may precede entries already buffered by later cycles.
  const order = new Map(adventure.messages.map((m, i) => [m.id, i]));
  const deltas = [...pending.values()].sort((a, b) => order.get(a.sourceId)! - order.get(b.sourceId)!);
  const original = adventure.activeState.pendingBrainDeltas;
  if (!changed && (original ?? []).length === deltas.length && deltas.every((d, i) => d === original?.[i])) return adventure;
  return { ...adventure, messages, activeState: { ...adventure.activeState, pendingBrainDeltas: deltas } };
}
