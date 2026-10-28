import { useEffect, useState, type ReactNode } from "react";
import type { Adventure, MemoryHistoryRecord } from "../types/adventure";
import { readHistoryInWorker } from "../memory/memoryHistoryWorker";

export function ArchivedMemoryDetails({ adventure, archiveId, children }: {
  adventure: Adventure; archiveId: string; children?: (record: MemoryHistoryRecord) => ReactNode;
}) {
  const [record, setRecord] = useState<MemoryHistoryRecord>();
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const block = adventure.activeState.compressedMemoryHistory?.blocks[archiveId];
  useEffect(() => {
    if (!opened) { setRecord(undefined); setError(undefined); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError(undefined); setRecord(undefined);
    if (!block) { setError("Historical archive block is missing. Restore an intact backup to recover its details."); setLoading(false); return; }
    void readHistoryInWorker(block).then(value => { if (!cancelled) setRecord(value); })
      .catch(e => { if (!cancelled) setError(`Historical archive cannot be decoded: ${e instanceof Error ? e.message : "corrupted data"}. The archive has been preserved.`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [opened, block, adventure.id]);
  return <details onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Original archived details</summary>
    {loading && <p role="status">Decompressing history…</p>}
    {error && <p role="alert">{error}</p>}
    {record && <>{children?.(record)}<details><summary>Complete original record (JSON)</summary>
      <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(record.value, null, 2)}</pre>
    </details></>}
  </details>;
}

/** Prior versions stay inspectable even after a source edit or explicit retry. */
export function ArchivedMemoryVersions({ adventure, kind, recordId }: { adventure: Adventure; kind: MemoryHistoryRecord["kind"]; recordId: string }) {
  const blocks = Object.values(adventure.activeState.compressedMemoryHistory?.blocks ?? {}).filter(b => b.kind === kind && b.recordId === recordId);
  return <>{blocks.map((block, index) => <div key={block.id}>
    {blocks.length > 1 && <p>Historical version {index + 1}</p>}
    <ArchivedMemoryDetails adventure={adventure} archiveId={block.id} />
  </div>)}</>;
}
