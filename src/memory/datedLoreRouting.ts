import type { Adventure, MemoryProposal, StoryTime } from "../types/adventure";
import { loreSubjectTitle, loreSubjectKey, loreOccurrenceDate } from "./factCoverage";
import { resolveLoreEventDate } from "./validateLoreChronology";

/** Dates identify occurrences; fantasy dates keep their authored text. */
export function loreEventDateKey(value: { lore?: MemoryProposal["lore"] }): string | undefined {
  return loreOccurrenceDate(value);
}

export function sameLoreEventDate(left: { lore?: MemoryProposal["lore"] }, right: { lore?: MemoryProposal["lore"] }): boolean {
  return loreEventDateKey(left) === loreEventDateKey(right);
}

/** Resolve from saved source chronology, never model-generated proposal dates or wall time. */
export function establishedLoreTime(a: Adventure, p: MemoryProposal): StoryTime | undefined {
  const source = a.messages.find(m => m.id === p.sourceTurnId);
  // The default assumed calendar is not evidence of an event date.
  if (a.storyClock?.origin !== "established" && source?.storyTime?.date === "2000-01-01") return undefined;
  return source?.storyTime ?? resolveLoreEventDate(a);
}

export function routeDatedLoreProposal(a: Adventure, p: MemoryProposal): MemoryProposal {
  if (p.proposedType !== "storyCard" || p.storyCardType !== "lore" || p.userInitiated) return p;
  const time = establishedLoreTime(a, p);
  if (!time || !loreEventDateKey({ lore: { status: "unresolved", sourceMessageIds: [], occurredAt: time } })) return p;
  const existing = a.storyCards.find(c => c.id === p.targetId && c.type === "lore");
  const title = loreSubjectTitle(existing ?? p);
  const dated = { lore: { ...p.lore, status: p.lore?.status ?? "unresolved", sourceMessageIds: p.lore?.sourceMessageIds ?? [], occurredAt: time, lastChangedAt: time } };
  const matches = a.storyCards.filter(c => c.type === "lore" && loreSubjectKey(c) === loreSubjectKey({ title }) && sameLoreEventDate(c, dated))
    .sort((left, right) => left.id === p.targetId ? -1 : right.id === p.targetId ? 1 : left.id.localeCompare(right.id));
  const target = matches[0];
  const datedTitle = `[${time.text || time.date}] ${title}`;
  return { ...p, title: datedTitle, targetId: target?.id, cardOperation: target ? "append" : "create", appendContent: target ? true : undefined,
    lore: dated.lore,
    ...(p.storyCardReview ? { storyCardReview: { ...p.storyCardReview, operation: target ? "update" : "create", suggestedTitle: datedTitle,
      targetCandidates: matches.map(c => c.id) } } : {}) };
}
