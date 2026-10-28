import type { Adventure, AdventureThumbnailImage } from "../types/adventure";
import { normalizeAdventure, sanitizeAdventureForPersistence } from "../state/defaults";
import { getAdventureThumbnail } from "../utils/adventureImages";

const DB_NAME = "ai-story-teller";
const DB_VERSION = 2;
const STORE_NAME = "adventures";
const SUMMARY_STORE_NAME = "adventureSummaries";

export interface AdventureSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  turnCount: number;
  storyEntryCount: number;
  thumbnailImage?: AdventureThumbnailImage;
}

function normalizeCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function countStoryEntries(adventure: Adventure): number {
  return adventure.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  ).length;
}

function adventureSummary(adventure: Adventure): AdventureSummary {
  return {
    id: adventure.id,
    title: adventure.title,
    createdAt: adventure.createdAt,
    updatedAt: adventure.updatedAt,
    turnCount: normalizeCount(adventure.activeState?.turn),
    storyEntryCount: countStoryEntries(adventure),
    thumbnailImage: getAdventureThumbnail(adventure),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SUMMARY_STORE_NAME)) {
        const summaries = db.createObjectStore(SUMMARY_STORE_NAME, { keyPath: "id" });
        // Backfill once on upgrade. Leave the original saves untouched.
        const cursor = request.transaction!.objectStore(STORE_NAME).openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          summaries.put(adventureSummary(normalizeAdventure(entry.value as Adventure)));
          entry.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, tx: IDBTransaction) => IDBRequest<T>,
  storeName = STORE_NAME,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(mode === "readwrite" ? [STORE_NAME, SUMMARY_STORE_NAME] : storeName, mode);
        const store = tx.objectStore(storeName);
        const request = run(store, tx);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Adventure transaction aborted.")); };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

const saveQueues = new Map<string, Promise<void>>();
export function saveAdventure(adventure: Adventure): Promise<void> {
  const prior = saveQueues.get(adventure.id) ?? Promise.resolve();
  const pending = prior.catch(() => undefined).then(async () => {
    await transaction("readwrite", (store, tx) => {
      const read = store.get(adventure.id);
      read.onsuccess = () => {
        try {
          const previous = read.result as Adventure | undefined;
          const previousHistory = previous?.activeState.compressedMemoryHistory;
          const incomingHistory = adventure.activeState.compressedMemoryHistory;
          // Blocks are immutable and append-only. A concurrently queued snapshot
          // must never erase evidence that another save has already committed.
          const history = previousHistory?.version === 1 && (!incomingHistory || incomingHistory.version === 1)
            ? { version: 1 as const, blocks: { ...previousHistory.blocks, ...incomingHistory?.blocks } } : incomingHistory;
          const safe = sanitizeAdventureForPersistence(history ? { ...adventure,
            activeState: { ...adventure.activeState, compressedMemoryHistory: history } } : adventure);
          tx.objectStore(SUMMARY_STORE_NAME).put(adventureSummary(safe));
          store.put(safe);
        } catch { tx.abort(); }
      };
      return read;
    });
  });
  saveQueues.set(adventure.id, pending);
  void pending.finally(() => { if (saveQueues.get(adventure.id) === pending) saveQueues.delete(adventure.id); }).catch(() => undefined);
  return pending;
}

export async function getAdventure(id: string): Promise<Adventure | undefined> {
  const adventure = await transaction<Adventure | undefined>("readonly", (store) => store.get(id));
  return adventure ? normalizeAdventure(adventure) : undefined;
}

export async function deleteAdventure(id: string): Promise<void> {
  await transaction("readwrite", (store, tx) => {
    tx.objectStore(SUMMARY_STORE_NAME).delete(id);
    return store.delete(id);
  });
}

export async function listAdventures(): Promise<AdventureSummary[]> {
  // Refreshing library metadata must never clone and normalize every full save.
  const summaries = await transaction<AdventureSummary[]>("readonly", (store) => store.getAll(), SUMMARY_STORE_NAME);
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
