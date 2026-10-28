import type { Adventure } from "../types/adventure";
import { sanitizeAdventureForPersistence } from "../state/defaults";
import { createPersistencePatch, type PersistenceResponse } from "./adventurePersistenceProtocol";
import { writeAdventure } from "./adventureDbCore";
let worker: Worker | undefined;
let baseline: Adventure | undefined;
let revision: number | undefined;
let serial = 0;
let pending: { id: number; resolve: () => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
function reset() { worker?.terminate(); worker = undefined; baseline = undefined; revision = undefined; }
export function releasePersistenceWorker(id?: string) {
  if (!pending && (!id || baseline?.id === id)) reset();
}
/** Called by the shared coordinator, with at most one request in flight. */
export async function persistAdventure(adventure: Adventure): Promise<void> {
  const safe = sanitizeAdventureForPersistence(adventure);
  if (typeof Worker === "undefined") { await writeAdventure(safe); return; }
  if (pending) throw new Error("A persistence request is already running.");
  if (!worker) {
    const instance = new Worker(new URL("./adventurePersistence.worker.ts", import.meta.url), { type: "module" });
    worker = instance;
    instance.onmessage = ({ data }: MessageEvent<PersistenceResponse>) => {
      if (worker !== instance || !pending || data?.id !== pending.id) return;
      const done = pending; pending = undefined; clearTimeout(done.timer);
      if (data.error) { reset(); done.reject(new Error(data.error)); } else done.resolve();
    };
    const fail = () => {
      if (worker !== instance) return;
      const done = pending; pending = undefined;
      if (done) clearTimeout(done.timer);
      reset(); done?.reject(new Error("Background save worker failed. Retry saving; stored transactions remain atomic."));
    };
    instance.onerror = fail;
    instance.onmessageerror = fail;
  }
  const previous = baseline?.id === adventure.id ? baseline : undefined;
  const id = ++serial;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.id !== id) return;
        pending = undefined; reset(); reject(new Error("Background save timed out. Retry saving; the previous complete transaction is retained."));
      }, 60_000);
      pending = { id, resolve, reject, timer };
      try { worker!.postMessage({ id, adventureId: adventure.id, baseRevision: previous ? revision : undefined,
        patch: createPersistencePatch(previous, safe) }); }
      catch (error) { pending = undefined; clearTimeout(timer); reject(error); }
    });
    baseline = safe; revision = id;
  } catch (error) { reset(); throw error; }
}
