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
  return !record.value.archivedMemoryHistoryId && (record.kind === "proposal"
    ? ["approved", "rejected", "ignored"].includes(record.value.status) : record.value.status === "complete");
}
/** One record per job: never clone the entire adventure to a worker. */
export function nextHistoryRecord(a: Adventure, attempted: WeakSet<object>): MemoryHistoryRecord | undefined {
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
