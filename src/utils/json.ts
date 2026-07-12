import type { Adventure } from "../types/adventure";
import { createId, nowIso } from "./id";
import { normalizeAdventure, sanitizeAdventureForPersistence } from "../state/defaults";

export function exportAdventureJson(adventure: Adventure): string {
  return JSON.stringify(sanitizeAdventureForPersistence(adventure), null, 2);
}

export function importAdventureJson(text: string, duplicate = false): Adventure {
  const parsed = JSON.parse(text) as Adventure;
  if (!parsed || typeof parsed !== "object" || !parsed.id || !parsed.title) {
    throw new Error("Imported JSON is not a valid adventure.");
  }
  const timestamp = nowIso();
  const adventure = duplicate
    ? {
        ...parsed,
        id: createId("adv"),
        title: `${parsed.title} Copy`,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    : { ...parsed, updatedAt: timestamp };
  return normalizeAdventure(sanitizeAdventureForPersistence(adventure as Adventure));
}
