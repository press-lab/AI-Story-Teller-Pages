import type { LegacyAdventureInput } from "../state/legacyAdventureInput";
import type { Adventure } from "../types/adventure";
import { createId, nowIso } from "./id";
import { normalizeAdventure, sanitizeAdventureForPersistence } from "../state/defaults";

export function exportAdventureJson(adventure: Adventure): string {
  return JSON.stringify(sanitizeAdventureForPersistence(adventure), null, 2);
}

export function importAdventureJson(text: string, duplicate = false): Adventure {
  const parsed = JSON.parse(text) as LegacyAdventureInput;
  if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || !parsed.id.trim()
    || typeof parsed.title !== "string" || !parsed.title.trim()
    || (parsed.messages !== undefined && (!Array.isArray(parsed.messages) || parsed.messages.some(message =>
      !message || typeof message.id !== "string" || typeof message.content !== "string"
      || !["user", "assistant", "system"].includes(message.role))))) {
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
