import type { Adventure, ContextItem } from "../types/adventure";
import { selectEventMemories } from "../memory/eventMemory";
import { isHistoricalLore } from "../memory/storyCardArchitecture";
import { matchPatterns } from "../triggers/matching";

export const MAX_CHAINED_STORY_CARDS_PER_BUILD = 6;

export interface ChainedStoryCardCandidate {
  destinationId: string;
  sourceType: "component" | "storyCard";
  sourceId: string;
  sourceTitle: string;
  matchedTriggerPhrase: string;
  sourceContent: string;
}

/** A single pass over frozen, budget-selected sources. Never scans its own results. */
export function resolveChainedStoryCardTriggers(
  adventure: Adventure,
  includedComponents: readonly ContextItem[],
  includedStoryCards: readonly ContextItem[],
): ChainedStoryCardCandidate[] {
  const includedIds = new Set(includedStoryCards.map(source => source.id));
  const candidates = new Map<string, ChainedStoryCardCandidate>();
  // Prefer Story Cards, then stable source IDs when several sources match.
  const sources = [
    ...[...includedStoryCards].sort((a, b) => a.id.localeCompare(b.id)),
    ...[...includedComponents].sort((a, b) => a.id.localeCompare(b.id)),
  ];
  for (const source of sources) {
    const recalledEvents = selectEventMemories(adventure.storyCards, source.content);
    for (const card of adventure.storyCards) {
      if (!card.active || card.inclusionPolicy === "manual" || includedIds.has(card.id) || candidates.has(card.id)) continue;
      const match = isHistoricalLore(card)
        ? { matched: recalledEvents.has(card.id), pattern: recalledEvents.get(card.id) }
        : matchPatterns(source.content, [card.title, ...card.keys], card.matchType ?? "phrase");
      if (!match.matched || !match.pattern) continue;
      candidates.set(card.id, {
        destinationId: card.id,
        sourceType: source.sourceType === "storyCard" ? "storyCard" : "component",
        sourceId: source.id,
        sourceTitle: source.title,
        matchedTriggerPhrase: match.pattern,
        sourceContent: source.content,
      });
    }
  }
  const priorities = new Map(adventure.storyCards.map(card => [card.id, card.priority]));
  return [...candidates.values()]
    .sort((a, b) =>
      Number(b.sourceType === "storyCard") - Number(a.sourceType === "storyCard") ||
      (priorities.get(b.destinationId) ?? 0) - (priorities.get(a.destinationId) ?? 0) ||
      a.destinationId.localeCompare(b.destinationId))
    .slice(0, MAX_CHAINED_STORY_CARDS_PER_BUILD);
}
