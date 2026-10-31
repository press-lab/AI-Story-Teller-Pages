import { Blob as NodeBlob, Buffer as NodeBuffer } from "node:buffer";
import { withArchivedRecord } from "../test/archivedMemoryFixture";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { decompressHistory } from "../memory/historyCodec";
/**
 * @vitest-environment jsdom
 */
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { legacyAdventure, retiredKeys } from "../test/legacyAdventure";
import { deleteAdventure, getAdventure, listAdventures, saveAdventure } from "./adventureDb";

const DB_NAME = "ai-story-teller";

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe("adventureDb IndexedDB persistence", () => {
  beforeEach(async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: new IDBFactory(),
      configurable: true,
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: IDBKeyRange,
      configurable: true,
    });
    await deleteDb();
  });

  it("sanitizes legacy objects that bypass import before writing IndexedDB", async () => {
    const old = legacyAdventure();
    await saveAdventure(old);
    const raw = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("adventures").objectStore("adventures").get(old.id);
        read.onsuccess = () => { resolve(read.result); db.close(); };
        read.onerror = () => reject(read.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(JSON.stringify(raw)).not.toMatch(retiredKeys);
    const loaded = await getAdventure(old.id);
    expect(loaded?.messages).toEqual(old.messages);
    expect(loaded?.memoryAutoApprove).toMatchObject({ brainUpdate: true, loreStoryCard: true, otherStoryCard: false });
  });

  it("saves and reloads adventures without persisting provider API keys or runtime session ids", async () => {
    const adventure = createDefaultAdventure("Persisted");
    adventure.modelConfig = {
      ...adventure.modelConfig,
      apiKey: "test key should not persist",
      sessionId: "runtime-session-should-not-persist",
    };
    adventure.activeState.storyUndoStack = [
      {
        id: "story-edit-test",
        label: "test edit",
        createdAt: "2026-01-01T00:00:00.000Z",
        undo: { type: "updateOpeningScene", content: "before" },
        redo: { type: "updateOpeningScene", content: "after" },
      },
    ];

    await saveAdventure(adventure);

    const loaded = await getAdventure(adventure.id);
    expect(loaded?.title).toBe("Persisted");
    expect(loaded?.modelConfig.apiKey).toBeUndefined();
    expect(loaded?.modelConfig.sessionId).toBeUndefined();
    expect(loaded?.activeState.storyUndoStack).toEqual([
      {
        id: "story-edit-test",
        label: "test edit",
        createdAt: "2026-01-01T00:00:00.000Z",
        undo: { type: "updateOpeningScene", content: "before" },
        redo: { type: "updateOpeningScene", content: "after" },
      },
    ]);
    expect(loaded?.activeState.storyRedoStack).toEqual([]);
  });

  it("lists adventures newest-first and deletes by id", async () => {
    const older = createDefaultAdventure("Older");
    older.updatedAt = "2026-01-01T00:00:00.000Z";
    older.activeState.turn = 3;
    older.messages = [
      { id: "old-system", role: "system", content: "System note", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "old-user", role: "user", content: "I open the gate.", createdAt: "2026-01-01T00:01:00.000Z" },
      { id: "old-assistant", role: "assistant", content: "The gate groans open.", createdAt: "2026-01-01T00:02:00.000Z" },
    ];
    const newer = createDefaultAdventure("Newer");
    newer.updatedAt = "2026-01-02T00:00:00.000Z";
    newer.activeState.turn = 12;
    newer.messages = [
      { id: "new-user-1", role: "user", content: "I call Margo.", createdAt: "2026-01-02T00:01:00.000Z" },
      { id: "new-assistant-1", role: "assistant", content: "Margo answers.", createdAt: "2026-01-02T00:02:00.000Z" },
      { id: "new-user-2", role: "user", content: "I ask about the ward.", createdAt: "2026-01-02T00:03:00.000Z" },
      { id: "new-assistant-2", role: "assistant", content: "She lowers her voice.", createdAt: "2026-01-02T00:04:00.000Z" },
    ];

    await saveAdventure(older);
    await saveAdventure(newer);

    expect((await listAdventures()).map((adventure) => adventure.title)).toEqual(["Newer", "Older"]);
    expect((await listAdventures()).map((adventure) => adventure.turnCount)).toEqual([12, 3]);
    expect((await listAdventures()).map((adventure) => adventure.storyEntryCount)).toEqual([4, 2]);

    await deleteAdventure(newer.id);

    expect(await getAdventure(newer.id)).toBeUndefined();
    expect((await listAdventures()).map((adventure) => adventure.title)).toEqual(["Older"]);
  });

  it("backfills metadata from a version-one database without rewriting the save", async () => {
    const legacy = createDefaultAdventure("Legacy large save");
    legacy.activeState.turn = 25;
    legacy.messages = [{ id: "legacy-message", role: "assistant", content: "An old entry.", createdAt: legacy.createdAt }];
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("adventures", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("adventures", "readwrite");
        tx.objectStore("adventures").put(legacy);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    expect(await listAdventures()).toEqual([expect.objectContaining({ id: legacy.id, title: legacy.title, turnCount: 25, storyEntryCount: 1 })]);
    const raw = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("adventures", "readonly");
        const get = tx.objectStore("adventures").get(legacy.id);
        tx.oncomplete = () => { db.close(); resolve(get.result); };
        tx.onerror = () => reject(tx.error);
      };
    });
    expect(raw).toEqual(legacy);
  });

  it("refreshes library metadata without reading full saves and updates metadata on save", async () => {
    const adventure = createDefaultAdventure("Before");
    await saveAdventure(adventure);
    adventure.title = "After";
    adventure.activeState.turn = 44;
    await saveAdventure(adventure);
    const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
    try {
      expect(await listAdventures()).toEqual([expect.objectContaining({ title: "After", turnCount: 44 })]);
      expect(reads.mock.contexts.map(store => (store as IDBObjectStore).name)).toEqual(["adventureSummaries"]);
    } finally { reads.mockRestore(); }
    await deleteAdventure(adventure.id);
    expect(await listAdventures()).toEqual([]);
  });

  it("preserves historical archive bytes across ordinary saves and never compresses new saves", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    // Keep real SHA-256 verification; adapt JSDOM buffers for Node 20 Web Crypto.
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => digest(algorithm, NodeBuffer.from(data as ArrayBuffer)));
    try {
      const a = createDefaultAdventure("Existing compressed save");
      const p = makeMemoryProposal({ status: "approved" });
      a.activeState.memoryProposals = [p];
      const record = { kind: "proposal" as const, id: p.id, value: p };
      const archived = await withArchivedRecord(a, record);
      await saveAdventure(archived);
      const loaded = (await getAdventure(a.id))!;
      expect(loaded.activeState.compressedMemoryHistory).toStrictEqual(archived.activeState.compressedMemoryHistory);
      const block = Object.values(loaded.activeState.compressedMemoryHistory!.blocks)[0];
      expect(await decompressHistory(block)).toStrictEqual(record);
      await saveAdventure({ ...loaded, title: "Normal save" });
      expect((await getAdventure(a.id))!.activeState.compressedMemoryHistory).toStrictEqual(archived.activeState.compressedMemoryHistory);
      const fresh = createDefaultAdventure("New save"); fresh.activeState.memoryProposals = [p];
      await saveAdventure(fresh);
      expect((await getAdventure(fresh.id))!.activeState.compressedMemoryHistory).toBeUndefined();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

});
