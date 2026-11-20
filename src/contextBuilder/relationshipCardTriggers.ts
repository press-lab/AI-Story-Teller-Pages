import type { Adventure, ContextItem, ExcludedReason } from "../types/adventure";
import { relationshipCardError } from "../memory/relationshipCards";

export function resolveRelationshipCardTriggers(adventure: Adventure, includedStoryCards: readonly ContextItem[]) {
  const characters = new Map(adventure.storyCards.filter(card => card.type === "character").map(card => [card.id, card.title]));
  const included = new Set(includedStoryCards.filter(item => item.sourceType === "storyCard" && characters.has(item.id)).map(item => item.id));
  return adventure.storyCards.filter(card => card.type === "relationship")
    .sort((a, b) => Number(b.protected) - Number(a.protected) || Number(b.pinned) - Number(a.pinned)
      || b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(card => {
      const error = relationshipCardError(adventure.storyCards, card);
      const ids = Array.isArray(card.relationship?.characterIds) ? card.relationship.characterIds : [];
      const names = ids.map(id => characters.get(id) ?? String(id));
      const label = (id: string) => (characters.get(id) ?? id) + " (" + id + ")";
      const missing = ids.filter(id => !included.has(id));
      const satisfied = ids.filter(id => included.has(id));
      const reason: ExcludedReason | undefined = error ? "relationship_invalid_links" : !card.active ? "inactive" : missing.length ? "relationship_members_missing" : undefined;
      const detail = [
        error, "Required: " + ids.map(label).join(", "), "Included: " + satisfied.map(label).join(", "),
        "Missing: " + missing.map(label).join(", "), "Priority: " + card.priority,
      ].filter(Boolean).join(". ");
      return { card, names, reason, detail };
    });
}
