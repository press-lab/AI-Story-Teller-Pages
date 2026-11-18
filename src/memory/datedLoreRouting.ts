import type { Adventure, MemoryProposal, StoryTime } from "../types/adventure";
import { loreSubjectKey, loreSubjectTitle, loreOccurrenceDate } from "./factCoverage";
import { sourceLoreEventDate } from "./validateLoreChronology";

/** Dates identify occurrences; fantasy dates keep their authored text. */
export function loreEventDateKey(value: { lore?: MemoryProposal["lore"] }): string | undefined {
  return loreOccurrenceDate(value);
}

export function sameLoreEventDate(left: { lore?: MemoryProposal["lore"] }, right: { lore?: MemoryProposal["lore"] }): boolean {
  return loreEventDateKey(left) === loreEventDateKey(right);
}

/** Resolve the source day without using a clock that advanced after the source. */
export function establishedLoreTime(a: Adventure, p: Pick<MemoryProposal, "sourceTurnId">): StoryTime | undefined {
  const index = a.messages.findIndex(message => message.id === p.sourceTurnId);
  if (index < 0) return undefined;
  const clock = a.storyClock;
  const source = a.messages[index];
  const recorded = sourceLoreEventDate(a, p, source);
  if (recorded && (recorded.date !== "2000-01-01" || clock?.origin === "established")) return recorded;
  if (clock?.origin !== "established") return undefined;
  for (const id of [clock.anchorMessageId, clock.sourceMessageId]) {
    if (!id) continue;
    const clockIndex = a.messages.findIndex(message => message.id === id);
    if (clockIndex < 0 || clockIndex > index) return undefined;
  }
  return clock.current;
}

function dayKey(time?: StoryTime): string | undefined {
  return time?.precision === "day" || time?.precision === "time"
    ? loreOccurrenceDate({ lore: { status: "unresolved", sourceMessageIds: [], occurredAt: time } })
    : undefined;
}

export function loreAppendDayError(a: Adventure, p: MemoryProposal): string | undefined {
  if (p.proposedType !== "storyCard" || !p.targetId || p.userInitiated) return undefined;
  const target = a.storyCards.find(card => card.id === p.targetId && card.type === "lore");
  if (!target) return undefined;
  const sourceDay = dayKey(establishedLoreTime(a, p));
  const targetDay = dayKey(target.lore?.occurredAt);
  if (!sourceDay || !targetDay) return "The source and destination need established story days before Lore can append automatically.";
  if (sourceDay !== targetDay) return "The Lore destination is from a different story day.";
  return undefined;
}

export function routeDatedLoreProposal(a: Adventure, p: MemoryProposal): MemoryProposal {
  if (p.proposedType !== "storyCard" || p.storyCardType !== "lore" || p.userInitiated) return p;
  const time = establishedLoreTime(a, p);
  const sourceDay = dayKey(time);
  const target = a.storyCards.find(card => card.id === p.targetId && card.type === "lore");
  const targetDay = dayKey(target?.lore?.occurredAt);
  if (target && (!sourceDay || !targetDay)) {
    return { ...p, requiresReview: true };
  }
  if (!time || !sourceDay) return p.lore ? { ...p, lore: { ...p.lore, occurredAt: undefined, lastChangedAt: undefined } } : p;
  const lore = { ...p.lore, status: p.lore?.status ?? "unresolved", sourceMessageIds: p.lore?.sourceMessageIds ?? [], occurredAt: time, lastChangedAt: time };
  const appendTarget = target && targetDay === sourceDay ? target : undefined;
  // Older proposals may only carry the original card title. Leave those for review.
  if (target && !appendTarget && loreSubjectKey(target) === loreSubjectKey(p)) {
    return { ...p, requiresReview: true };
  }
  const title = appendTarget?.title ?? `[${time.text || time.date}] ${loreSubjectTitle(p)}`;
  return { ...p, title, targetId: appendTarget?.id, cardOperation: appendTarget ? "append" : "create",
    appendContent: appendTarget ? true : undefined, lore,
    ...(p.storyCardReview ? { storyCardReview: { ...p.storyCardReview, operation: appendTarget ? "update" : "create",
      suggestedTitle: title, targetCandidates: appendTarget || !target ? p.storyCardReview.targetCandidates : [] } } : {}) };
}
