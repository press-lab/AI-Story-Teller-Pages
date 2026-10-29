import { MEMORY_DEBUG_LOGGING } from "../config/debugLogging";
import type { Adventure, MemoryEvaluationState, MemoryHistoryRecord, MemoryProposal } from "../types/adventure";

/** Keep every field read by routing, coverage, suppression, displayed thoughts
 * and source validity. Only finalized debugging copies leave the active object.
 * Rejected/ignored target snapshots remain exact because source validity reads them.
 */
export function compactHistoricalProposal(p: MemoryProposal, archiveId: string): MemoryProposal {
  return { ...p, archivedMemoryHistoryId: archiveId,
    placementValidation: p.placementValidation ? { ...p.placementValidation, fingerprint: "", target: undefined } : undefined,
    evaluationSource: p.status === "approved" && p.evaluationSource
      ? { ...p.evaluationSource, target: undefined } : p.evaluationSource };
}
export function compactHistoricalEvaluation(e: MemoryEvaluationState, archiveId: string): MemoryEvaluationState {
  return { ...e, archivedMemoryHistoryId: archiveId, archivedFindingCount: e.singlePass?.findings.length,
    singlePass: e.singlePass ? { ...e.singlePass, sourceContent: "", referenceState: "", evidence: [], findings: [], dispositions: [] } : undefined,
    assessment: undefined, groupWork: undefined, discoveryCheckpoint: undefined };
}
export function eligibleHistory(record: MemoryHistoryRecord): boolean {
  return !record.value.archivedMemoryHistoryId && !(record.kind === "evaluation" && record.value.debugHistoryOmitted) && (record.kind === "proposal"
    ? ["approved", "rejected", "ignored"].includes(record.value.status) : record.value.status === "complete");
}
/** One record per job: never clone the entire adventure to a worker. */
export function nextHistoryRecord(a: Adventure, attempted: WeakSet<object>): MemoryHistoryRecord | undefined {
  if (!MEMORY_DEBUG_LOGGING) return;
  if (a.activeState.compressedMemoryHistory && a.activeState.compressedMemoryHistory.version !== 1) return;
  for (const m of a.messages) {
    const value = m.memoryEvaluation;
    if (value && !attempted.has(value)) {
      const r: MemoryHistoryRecord = { kind: "evaluation", id: m.id, value };
      if (eligibleHistory(r)) return r;
    }
  }
  for (const value of a.activeState.memoryProposals) {
    if (!attempted.has(value)) {
      const r: MemoryHistoryRecord = { kind: "proposal", id: value.id, value };
      if (eligibleHistory(r)) return r;
    }
  }
}

/** Called only after successful validation/application, or explicit history cleanup.
 * Identity, revision, groups, attempts and result counters still prevent replay.
 * Unfinished records are returned by identity: their exact guards enable retry.
 */
export function compactCompletedEvaluationWithoutDebug(e: MemoryEvaluationState): MemoryEvaluationState {
  if (e.status !== "complete") return e;
  return { ...e, archivedMemoryHistoryId: undefined, debugHistoryOmitted: true,
    archivedFindingCount: e.archivedFindingCount ?? e.singlePass?.findings.length,
    singlePass: e.singlePass ? { ...e.singlePass, sourceContent: "", referenceState: "", evidence: [], findings: [], dispositions: [] } : undefined,
    assessment: undefined, groupWork: undefined, discoveryCheckpoint: undefined };
}

/** Explicit reducer cleanup only. Never invoked during load, import or ordinary save. */
export function pruneDebugHistory(a: Adventure): Adventure {
  // Legacy diagnostics were also source-edit invalidation markers. Move that
  // operational information into compact source IDs before removing diagnostics.
  // Include deleted sources: undo can restore them without changing edit history.
  const tracked = new Set([...(a.activeState.legacyMemoryEvaluationSourceIds ?? []), ...(a.activeState.memoryDiagnostics ?? []).filter(d => d.stage === "independent"
    && ["evaluation_queued", "evaluation_started", "evaluation_completed", "evaluation_failed"].includes(d.outcome)).map(d => d.sourceId)]);
  return { ...a,
    messages: a.messages.map(m => {
      const evaluation = m.memoryEvaluation;
      if (evaluation?.status === "complete") return { ...m, memoryEvaluation: compactCompletedEvaluationWithoutDebug(evaluation) };
      if (evaluation?.archivedMemoryHistoryId) return { ...m, memoryEvaluation: { ...evaluation, archivedMemoryHistoryId: undefined } };
      return m;
    }),
    components: a.components.map(c => ({ ...c, memoryUpdateHistory: undefined })),
    storyCards: a.storyCards.map(c => ({ ...c, memoryUpdateHistory: undefined })),
    activeState: { ...a.activeState, debugHistoryGeneration: (a.activeState.debugHistoryGeneration ?? 0) + 1,
      legacyMemoryEvaluationSourceIds: [...tracked],
      memoryDiagnostics: [], evaluationLog: [], triggerLog: [], compressedMemoryHistory: undefined,
      // Resolved suggestions remain exact coverage/source/decision records. In
      // particular rejected/ignored destination snapshots govern suppression.
      memoryProposals: a.activeState.memoryProposals.map(p => p.archivedMemoryHistoryId
        ? { ...p, archivedMemoryHistoryId: undefined } : p) } };
}
