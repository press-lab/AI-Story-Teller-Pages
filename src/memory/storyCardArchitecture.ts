import type { Adventure, LoreMetadata, MemoryProposal, StoryCard, StoryCardType, LegacyStoryCardType } from "../types/adventure";
import { readStoryTime, formatStoryTime } from "./storyTime";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";

export const PRIMARY_STORY_CARD_TYPES = ["character", "location", "lore", "custom"] as const;

/** Legacy values are accepted at data boundaries, never offered as creation choices. */
export function primaryStoryCardType(type: string | undefined): StoryCardType {
  if (type === "plot" || type === "event") return "lore";
  return type === "character" || type === "location" || type === "lore" ? type : "custom";
}

export function isHistoricalLore(card: Pick<StoryCard, "memoryMode" | "eventMemory"> & { type: StoryCardType | LegacyStoryCardType }): boolean {
  return card.type === "event" || (card.type === "lore" && (card.memoryMode === "historical" || Boolean(card.eventMemory)));
}

export function mergeLoreMetadata(previous: LoreMetadata | undefined, next: LoreMetadata): LoreMetadata {
  const older = previous?.lastChangedAt?.date && next.lastChangedAt?.date && next.lastChangedAt.date < previous.lastChangedAt.date;
  return {
    ...previous, ...next,
    occurredAt: previous?.occurredAt ?? next.occurredAt,
    lastChangedAt: older ? previous.lastChangedAt : next.lastChangedAt ?? previous?.lastChangedAt,
    knownTo: next.knownTo ?? previous?.knownTo,
    sourceMessageIds: Array.from(new Set([...(previous?.sourceMessageIds ?? []), ...next.sourceMessageIds])),
  };
}

export function migrateStoryCard(card: Omit<StoryCard, "type"> & { type: StoryCardType | LegacyStoryCardType }): StoryCard {
  const historical = card.type === "event";
  const type = primaryStoryCardType(card.type);
  const lore = type === "lore" ? card.lore ?? {
    status: historical || card.memoryMode === "historical" ? "completed" : "unresolved",
    sourceMessageIds: card.eventMemory?.sourceMessageIds ?? card.sourceTurnIds ?? [],
  } satisfies LoreMetadata : card.lore;
  return { ...card, type, ...(historical ? { memoryMode: "historical" } : {}), ...(lore ? { lore } : {}) };
}

/** Conservative identity boundary, shared by automatic writes and reviewed proposals. */
export function isExceptionalIdentityChange(type: string, content: string): boolean {
  if (type === "character") return /\b(dead|died|dies|killed|confirmed alive|presumed dead|permanent(?:ly)?|identity correction|erroneous identity)\b/i.test(content);
  if (type === "location") return /\b(destroyed|destruction|relocated|permanent(?:ly)?|fundamental(?:ly)? transform|location correction)\b/i.test(content);
  return true;
}

export function proposalLore(adventure: Adventure, proposal: MemoryProposal): LoreMetadata {
  const source = adventure.messages.find(m => m.id === proposal.sourceTurnId);
  const sourceContent = "sourceContent" in proposal && typeof proposal.sourceContent === "string" ? proposal.sourceContent : undefined;
  const observed = readStoryTime(sourceContent ?? source?.content ?? proposal.sourceText ?? "", adventure.storyClock);
  const time = proposal.lore?.occurredAt ?? source?.storyTime ?? observed.time;
  return {
    status: proposal.memoryMode === "historical" || proposal.eventMemory ? "completed" : "unresolved",
    ...proposal.lore,
    ...(time ? { occurredAt: time, lastChangedAt: proposal.lore?.lastChangedAt ?? time } : {}),
    sourceMessageIds: Array.from(new Set([...(proposal.lore?.sourceMessageIds ?? []), ...(proposal.eventMemory?.sourceMessageIds ?? []), ...(source ? [source.id] : sourceContent && proposal.sourceTurnId ? [proposal.sourceTurnId] : [])])),
  };
}

export function loreContext(card: StoryCard): string {
  if (card.type !== "lore" || !card.lore) return "";
  const lore = card.lore;
  return [
    `Lore: ${lore.status}; occurred ${formatStoryTime(lore.occurredAt)}${lore.lastChangedAt ? `; last changed ${formatStoryTime(lore.lastChangedAt)}` : ""}.`,
    lore.knownTo?.length ? `Private knowledge: ${lore.knownTo.join(", ")}; other characters do not automatically know this.` : "",
    "Past events are history, not instructions to replay scenes. Age alone does not resolve an ongoing subject.",
  ].filter(Boolean).join("\n") + "\n";
}

/** Preserve the full history in Content; retrieve a bounded excerpt instead of deleting old events. */
export function loreExcerpt(card: StoryCard, content: string, query: string): { content: string; truncated: boolean } {
  const header = loreContext(card);
  const limit = card.tokenBudget && card.tokenBudget > 0 ? card.tokenBudget : 200;
  if (card.type !== "lore" || card.protected || approximateTokenCount(header + content) <= limit) {
    return { content: header + content, truncated: false };
  }
  const terms = new Set(query.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []);
  const lines = content.split("\n").filter(line => line.trim());
  const ranked = lines.map((line, index) => ({ line, index, score: (line.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).filter(word => terms.has(word)).length }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const selected: typeof ranked = [];
  for (const entry of ranked) {
    if (approximateTokenCount(header + [...selected, entry].map(e => e.line).join("\n")) <= limit) selected.push(entry);
  }
  let excerpt = selected.sort((a, b) => a.index - b.index).map(e => e.line).join("\n");
  if (!excerpt) {
    // A single long paragraph still obeys the existing card budget; full text stays editable.
    excerpt = (ranked[0]?.line ?? "").slice(0, Math.max(0, (limit - approximateTokenCount(header) - 1) * 4));
  }
  let result = header + excerpt;
  while (approximateTokenCount(result) > limit && result.length > 0) result = result.slice(0, -4);
  return { content: result, truncated: true };
}
