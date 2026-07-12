import type { Adventure, AdventureThumbnailImage } from "../types/adventure";
import { normalizeAdventure, sanitizeAdventureForPersistence } from "../state/defaults";
import { getAdventureThumbnail } from "../utils/adventureImages";

const DB_NAME = "ai-story-teller";
const DB_VERSION = 1;
const STORE_NAME = "adventures";

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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = run(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export async function saveAdventure(adventure: Adventure): Promise<void> {
  await transaction("readwrite", (store) => store.put(sanitizeAdventureForPersistence(adventure)));
}

export async function getAdventure(id: string): Promise<Adventure | undefined> {
  const adventure = await transaction<Adventure | undefined>("readonly", (store) => store.get(id));
  return adventure ? normalizeAdventure(adventure) : undefined;
}

export async function deleteAdventure(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}

export async function listAdventures(): Promise<AdventureSummary[]> {
  const adventures = await transaction<Adventure[]>("readonly", (store) => store.getAll());
  return adventures
    .map(normalizeAdventure)
    .map((adventure) => ({
      id: adventure.id,
      title: adventure.title,
      createdAt: adventure.createdAt,
      updatedAt: adventure.updatedAt,
      turnCount: normalizeCount(adventure.activeState.turn),
      storyEntryCount: countStoryEntries(adventure),
      thumbnailImage: getAdventureThumbnail(adventure),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
