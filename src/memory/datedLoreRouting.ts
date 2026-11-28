import type { Adventure, MemoryProposal, StoryCard, StoryTime } from "../types/adventure";
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

export function sameDayLoreCards(a: Adventure, sourceTurnId: string): StoryCard[] {
  const sourceDay = dayKey(establishedLoreTime(a, { sourceTurnId }));
  if (!sourceDay) return [];
  return a.storyCards.filter(card => card.type === "lore" && !card.lore?.autonomous && dayKey(card.lore?.occurredAt) === sourceDay);
}

export function loreAppendDayError(a: Adventure, p: MemoryProposal): string | undefined {
  if (p.proposedType !== "storyCard" || !p.targetId || p.userInitiated) return undefined;
  const target = a.storyCards.find(card => card.id === p.targetId && card.type === "lore");
  if (!target) return undefined;
  const originalError = loreOriginalEventError(a, p);
  if (originalError) return originalError;
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
  const target = p.lore?.autonomous ? undefined : a.storyCards.find(card => card.id === p.targetId && card.type === "lore");
  const targetDay = dayKey(target?.lore?.occurredAt);
  if (target && (!sourceDay || !targetDay)) {
    return { ...p, requiresReview: true };
  }
  if (p.lore?.autonomous && time && time.precision !== "unknown" && !sourceDay)
    return { ...p, lore: { ...p.lore, occurredAt: time, lastChangedAt: time } };
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

export function originalLoreEvidence(a: Adventure, card: StoryCard) {
  if (card.lore?.autonomous) return [];
  const ids = new Set([...(card.sourceTurnIds ?? []), ...(card.lore?.sourceMessageIds ?? [])]);
  return a.messages.filter(message => ids.has(message.id)).slice(0, 1)
    .map(({ id, content, storyTime }) => ({ id, content, storyTime }));
}

export function loreOriginalEventError(a: Adventure, p: MemoryProposal): string | undefined {
  const target = a.storyCards.find(card => card.id === p.targetId && card.type === "lore");
  if (!target || p.userInitiated) return undefined;
  if (target.lore?.autonomous) return "Automatic Lore cannot append to an autonomous event.";
  const original = originalLoreEvidence(a, target)[0];
  if (!original) return "Original Lore event evidence is unavailable; select a destination manually.";
  const originalDay = dayKey(original.storyTime);
  const cardDay = dayKey(target.lore?.occurredAt);
  if (!originalDay || !cardDay || originalDay !== cardDay)
    return "Original Lore source date is missing or conflicts with its occurrence date.";
  const placement = p.placementValidation;
  const incoming = a.messages.find(message => message.id === p.sourceTurnId);
  if (placement?.loreOriginalSourceId) {
    const originalIndex = a.messages.findIndex(message => message.id === original.id);
    const incomingIndex = incoming ? a.messages.indexOf(incoming) : -1;
    if (placement.loreOriginalSourceId === original.id && originalIndex >= 0 && originalIndex <= incomingIndex
      && placement.sources.some(source => source.id === original.id && source.content === original.content)
      && placement.sources.some(source => source.id === incoming?.id && source.content === incoming.content)) return undefined;
    return "The bound Lore evidence no longer matches the original event and incoming turn.";
  }
  const reason = placement?.reason ?? p.rationale;
  const sentences = original.content.split(/[.!?\n]+/).map(text => text.trim());
  if (!sentences.some(sentence => sentence.length >= 24 && reason.includes(sentence)))
    return "Lore append needs an exact original-event quote and a continuity explanation.";
  return undefined;
}
