import { withArchivedRecord } from "../test/archivedMemoryFixture";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createDefaultAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { compressHistory, decompressHistory } from "../memory/historyCodec";
import { saveAdventure, getAdventure, listAdventures } from "./adventureDb";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import type { MemoryHistoryRecord } from "../types/adventure";
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const a = createDefaultAdventure("Atomic history");
  const p = makeMemoryProposal({ status: "approved" });
  p.placementValidation = { version: 3, kind: "create", fingerprint: "exact snapshot".repeat(100), sources: [], reason: "test", newFact: p.content };
  a.activeState.memoryProposals = [p];
  const record: MemoryHistoryRecord = { kind: "proposal", id: p.id, value: p };
  const archived = await withArchivedRecord(a, record);
  const block = Object.values(archived.activeState.compressedMemoryHistory!.blocks)[0];
  return { a, archived, record, block };
}
it("commits archive, compact replacement and summary together and survives JSON duplication", async () => {
  const { archived, record, block } = await setup();
  await saveAdventure(archived);
  const loaded = (await getAdventure(archived.id))!;
  expect(loaded.activeState.memoryProposals[0].archivedMemoryHistoryId).toBe(block.id);
  expect(await decompressHistory(loaded.activeState.compressedMemoryHistory!.blocks[block.id])).toStrictEqual(record);
  expect((await listAdventures())[0].id).toBe(loaded.id);
  const duplicate = importAdventureJson(exportAdventureJson(loaded), true);
  await saveAdventure(duplicate);
  expect((await getAdventure(duplicate.id))!.activeState.compressedMemoryHistory).toEqual(loaded.activeState.compressedMemoryHistory);
});
it("an aborted/quota-failed replacement leaves the entire previous save and allows retry", async () => {
  const { a, archived, record, block } = await setup();
  await saveAdventure(a);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "adventures") throw new DOMException("Quota exceeded", "QuotaExceededError");
    return put.apply(this, args);
  });
  await expect(saveAdventure(archived)).rejects.toThrow();
  failure.mockRestore();
  const previous = (await getAdventure(a.id))!;
  expect(previous.activeState.compressedMemoryHistory).toBeUndefined();
  expect(previous.activeState.memoryProposals[0].placementValidation!.fingerprint).toBe(a.activeState.memoryProposals[0].placementValidation!.fingerprint);
  expect(await decompressHistory(block)).toStrictEqual(record); // current state also retains all bytes
  await saveAdventure(archived);
  expect((await getAdventure(a.id))!.activeState.compressedMemoryHistory!.blocks[block.id]).toEqual(block);
});
it("queued older snapshots cannot erase an already committed archive, including a separate writer", async () => {
  const { a, archived, block } = await setup();
  await Promise.all([saveAdventure(archived), saveAdventure({ ...a, title: "Latest user edit" })]);
  const loaded = (await getAdventure(a.id))!;
  expect(loaded.title).toBe("Latest user edit");
  expect(loaded.activeState.compressedMemoryHistory!.blocks[block.id]).toEqual(block);
  expect(loaded.activeState.memoryProposals[0]).toEqual(a.activeState.memoryProposals[0]);
  // Old-snapshot writer may retain originals; both representations are recoverable.
  await saveAdventure(archived);
  expect((await getAdventure(a.id))!.activeState.memoryProposals[0].archivedMemoryHistoryId).toBe(block.id);
});

// These legacy assertions inspect detailed logging. OFF contracts are tested separately.
const debugLogging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: true }));
vi.mock("../config/debugLogging", () => debugLogging);

it("explicit cleanup persists without the previous archive merge resurrecting blocks", async () => {
  const { archived } = await setup();
  await saveAdventure(archived);
  const cleaned = adventureReducer(archived, { type: "PRUNE_DEBUG_HISTORY" });
  await saveAdventure(cleaned);
  const loaded = (await getAdventure(cleaned.id))!;
  expect(loaded.activeState.compressedMemoryHistory).toBeUndefined();
  expect(loaded.activeState.memoryProposals.every(p => !p.archivedMemoryHistoryId)).toBe(true);
  expect(importAdventureJson(exportAdventureJson(loaded)).activeState.debugHistoryGeneration).toBe(1);
  // Re-enabling logging cannot resurrect archives after explicit cleanup.
  const later = { ...cleaned, activeState: { ...cleaned.activeState, memoryProposals: [makeMemoryProposal({ id: "later", status: "approved" })] } };
  const record: MemoryHistoryRecord = { kind: "proposal", id: "later", value: later.activeState.memoryProposals[0] };
  const block = await compressHistory(record);
  await saveAdventure(adventureReducer(later, { type: "ARCHIVE_MEMORY_HISTORY", adventureId: later.id, record, block }));
  expect((await getAdventure(later.id))!.activeState.compressedMemoryHistory).toBeUndefined();
});
