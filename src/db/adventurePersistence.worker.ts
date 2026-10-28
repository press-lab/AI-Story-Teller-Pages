import type { Adventure } from "../types/adventure";
import { applyPersistencePatch, type PersistenceRequest } from "./adventurePersistenceProtocol";
import { writeAdventure } from "./adventureDbCore";
let mirror: Adventure | undefined;
let revision: number | undefined;
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<PersistenceRequest>) => void; postMessage: (value: unknown) => void };
scope.onmessage = async ({ data }) => {
  try {
    if (data.baseRevision !== undefined && (data.baseRevision !== revision || mirror?.id !== data.adventureId)) throw new Error("Persistence baseline changed; retry the save.");
    const next = applyPersistencePatch(data.baseRevision === undefined ? undefined : mirror, data.patch) as Adventure;
    if (next.id !== data.adventureId) throw new Error("Persistence adventure identity mismatch.");
    // Publish a new mirror/revision only after the complete transaction commits.
    const saved = await writeAdventure(next);
    mirror = saved; revision = data.id;
    scope.postMessage({ id: data.id });
  } catch (error) { scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Adventure save failed." }); }
};
