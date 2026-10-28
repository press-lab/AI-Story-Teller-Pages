/** Transport only. IndexedDB and exported JSON still contain complete Adventures. */
export type PersistencePatch = { kind: "replace"; value: unknown }
  | { kind: "array"; length: number; changes: Array<[number, unknown]>; holes: number[] }
  | { kind: "object"; keys: string[]; changes: Array<[string, PersistencePatch]> };
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function createPersistencePatch(before: unknown, after: unknown, depth = 0): PersistencePatch {
  if (Array.isArray(before) && Array.isArray(after) && [before, after].every(a => Object.keys(a).every(k => /^(0|[1-9]\d*)$/.test(k) && Number(k) < a.length))) {
    const changes: Array<[number, unknown]> = [];
    const holes: number[] = [];
    // Changed records are sent whole; unchanged historical evidence stays in the worker.
    for (let i = 0; i < after.length; i++) {
      if (!(i in after)) { if (i in before) holes.push(i); }
      else if (!(i in before) || before[i] !== after[i]) changes.push([i, after[i]]);
    }
    return { kind: "array", length: after.length, changes, holes };
  }
  if (depth < 5 && plain(before) && plain(after)) {
    return { kind: "object", keys: Object.keys(after), changes: Object.keys(after).filter(k => !Object.hasOwn(before, k) || before[k] !== after[k])
      .map(k => [k, createPersistencePatch(before[k], after[k], depth + 1)]) };
  }
  return { kind: "replace", value: after };
}
export function applyPersistencePatch(before: unknown, patch: PersistencePatch): unknown {
  if (patch.kind === "replace") return patch.value;
  if (patch.kind === "array") {
    if (!Array.isArray(before)) throw new Error("Persistence array baseline is missing.");
    const result = before.slice(0, patch.length); result.length = patch.length;
    for (const index of patch.holes) delete result[index];
    for (const [index, value] of patch.changes) {
      if (index < 0 || index >= patch.length) throw new Error("Invalid persistence array position.");
      result[index] = value;
    }
    return result;
  }
  if (!plain(before)) throw new Error("Persistence object baseline is missing.");
  const changes = new Map(patch.changes);
  return Object.fromEntries(patch.keys.map(key => [key, changes.has(key) ? applyPersistencePatch(before[key], changes.get(key)!) : before[key]]));
}
export interface PersistenceRequest { id: number; adventureId: string; baseRevision?: number; patch: PersistencePatch }
export interface PersistenceResponse { id: number; error?: string }
