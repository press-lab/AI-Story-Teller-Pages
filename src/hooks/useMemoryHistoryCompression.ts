import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Adventure } from "../types/adventure";
import { nextHistoryRecord } from "../memory/memoryHistory";
import { compressHistoryInWorker } from "../memory/memoryHistoryWorker";
import { adventureReducer } from "../state/adventureReducer";
import { saveAdventure } from "../db/adventureDb";

export function useMemoryHistoryCompression(adventure: Adventure | undefined, setAdventure: Dispatch<SetStateAction<Adventure | undefined>>) {
  const latest = useRef(adventure);
  const [error, setError] = useState<string>();
  useEffect(() => { latest.current = adventure; }, [adventure]);
  useEffect(() => {
    if (!adventure) return;
    if (typeof Worker === "undefined") { setError("Background history compression is unavailable in this browser. Original history retained."); return; }
    const adventureId = adventure.id;
    const attempted = new WeakSet<object>();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setError(undefined);
    async function tick() {
      if (controller.signal.aborted || latest.current?.id !== adventureId) return;
      const record = nextHistoryRecord(latest.current, attempted);
      if (record) {
        attempted.add(record.value);
        try {
          const block = await compressHistoryInWorker(record, controller.signal);
          if (controller.signal.aborted) return;
          setAdventure(current => current?.id === adventureId ? adventureReducer(current, { type: "ARCHIVE_MEMORY_HISTORY", adventureId, record, block }) : current);
        } catch (e) {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "History compression failed. Original retained.");
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, record ? 100 : 2000);
    }
    timer = setTimeout(tick, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [adventure?.id, setAdventure]);
  // Compression never gates narrator or memory saves. Each replacement is one
  // immutable adventure containing BOTH the portable block and compact record.
  useEffect(() => {
    if (!adventure) return;
    let active = true;
    let persisted: Adventure["activeState"]["compressedMemoryHistory"];
    let saving = false;
    const timer = setInterval(() => {
      const current = latest.current;
      const history = current?.activeState.compressedMemoryHistory;
      if (!current || current.id !== adventure?.id || !history || history === persisted || saving) return;
      saving = true;
      void saveAdventure(current).then(() => { persisted = history; if (active) setError(previous => previous?.startsWith("History save failed") ? undefined : previous); })
        .catch(e => { if (active) setError(`History save failed; history remains in memory and the previous save is intact. ${e instanceof Error ? e.message : ""}`); })
        .finally(() => { saving = false; });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [adventure?.id]);
  return error;
}
