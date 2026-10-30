import { compressHistory } from "../memory/historyCodec";
import { compactHistoricalEvaluation, compactHistoricalProposal } from "../memory/memoryHistory";
import type { Adventure, MemoryHistoryRecord } from "../types/adventure";

/** Historical save fixture only: no production scheduler or archive reducer action. */
export async function withArchivedRecord(a: Adventure, record: MemoryHistoryRecord): Promise<Adventure> {
  const block = await compressHistory(record);
  return { ...a,
    messages: record.kind === "evaluation" ? a.messages.map(m => m.id === record.id
      ? { ...m, memoryEvaluation: compactHistoricalEvaluation(record.value, block.id) } : m) : a.messages,
    activeState: { ...a.activeState,
      compressedMemoryHistory: { version: 1, blocks: { ...a.activeState.compressedMemoryHistory?.blocks, [block.id]: block } },
      memoryProposals: record.kind === "proposal" ? a.activeState.memoryProposals.map(p => p.id === record.id
        ? compactHistoricalProposal(record.value, block.id) : p) : a.activeState.memoryProposals } };
}
