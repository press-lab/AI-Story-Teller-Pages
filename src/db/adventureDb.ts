import type { Adventure } from "../types/adventure";
import { readAdventure, removeAdventure } from "./adventureDbCore";
import { persistAdventure, releasePersistenceWorker } from "./adventurePersistenceClient";
export { listAdventures } from "./adventureDbCore";
export type { AdventureSummary } from "./adventureDbCore";

export interface SaveOptions { priority?: "checkpoint" | "background" }
interface Job {
  adventure: Adventure; background: boolean; promise: Promise<void>;
  resolve: () => void; reject: (error: unknown) => void;
}
const queue: Job[] = [];
let running: Job | undefined;
const committed = new WeakSet<Adventure>();
function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = job;
  const result = job.background && committed.has(job.adventure) ? Promise.resolve() : persistAdventure(job.adventure);
  void result.then(() => {
    committed.add(job.adventure); running = undefined; job.resolve(); pump();
  }, error => { running = undefined; job.reject(error); pump(); });
}
/** Checkpoints remain ordered barriers; routine requests can share a newer save. */
export function saveAdventure(adventure: Adventure, options: SaveOptions = {}): Promise<void> {
  const background = options.priority === "background";
  if (background && committed.has(adventure)) return Promise.resolve();
  const existing = running?.adventure === adventure ? running : queue.find(job => job.adventure === adventure);
  if (existing) { if (!background) existing.background = false; return existing.promise; }
  if (background) {
    const index = queue.findIndex(job => job.background && job.adventure.id === adventure.id);
    if (index >= 0) {
      const [pending] = queue.splice(index, 1);
      pending.adventure = adventure;
      queue.push(pending); // never move a newer autosave in front of a checkpoint
      return pending.promise;
    }
  }
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  queue.push({ adventure, background, promise, resolve, reject });
  pump();
  return promise;
}
export const getAdventure = readAdventure;
export async function deleteAdventure(id: string): Promise<void> {
  // Drain already-enqueued saves before deletion; new UI saves are cancelled on switch.
  const pending = [running, ...queue].filter((job): job is Job => !!job && job.adventure.id === id);
  await Promise.all(pending.map(job => job.promise.catch(() => undefined)));
  await removeAdventure(id);
  releasePersistenceWorker(id);
}
export function releaseAdventurePersistence(id?: string) {
  const pending = [running, ...queue].filter((job): job is Job => !!job && job.adventure.id === id);
  void Promise.all(pending.map(job => job.promise.catch(() => undefined))).then(() => releasePersistenceWorker(id));
}
