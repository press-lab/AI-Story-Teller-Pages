import type { Adventure, MemoryProposal, Message, StoryTime } from "../types/adventure";
import { readStoryTime, transitionKey } from "./storyTime";

export type LoreChronologyValidation =
  | { status: "valid" }
  | { status: "uncertain"; reason: string }
  | { status: "conflict"; reason: string };

type LoreInformation = Pick<MemoryProposal, "sourceTurnId"> & Partial<Pick<MemoryProposal, "evaluationSource" | "sourceText">>
  & { storyCardReview?: Pick<NonNullable<MemoryProposal["storyCardReview"]>, "sourceContent"> };

function sourceText(adventure: Adventure, proposal: LoreInformation, source?: Message): string {
  return source?.content ?? adventure.messages.find(m => m.id === proposal.sourceTurnId)?.content
    ?? proposal.storyCardReview?.sourceContent
    ?? proposal.evaluationSource?.messages.find(m => m.id === proposal.sourceTurnId)?.content ?? "";
}

/** Source chronology, never wall-clock timestamps or generated title dates. */
export function sourceLoreEventDate(adventure: Adventure, proposal: LoreInformation, source?: Message): StoryTime | undefined {
  source ??= adventure.messages.find(m => m.id === proposal.sourceTurnId);
  const text = sourceText(adventure, proposal, source);
  const observed = readStoryTime(text, source ? undefined : adventure.storyClock);
  // Explicit scene/event declarations supersede a stale recorded source date.
  // A flashback dates its own event, while readStoryTime never advances the present.
  if (observed.time && !transitionKey(text)) return observed.time;
  if (source) return source.storyTime ?? observed.time;
  const player = adventure.messages.at(-1);
  const echoed = player?.role === "user" && player.id === adventure.storyClock?.sourceMessageId
    && Boolean(transitionKey(text)) && transitionKey(text) === transitionKey(player.content);
  return (echoed ? adventure.storyClock?.current : observed.time)
    ?? (!observed.flashback ? adventure.storyClock?.current : undefined);
}

export function isLoreProposal(adventure: Adventure, proposal: MemoryProposal): boolean {
  return proposal.proposedType === "storyCard" && (proposal.storyCardType === "lore"
    || adventure.storyCards.some(c => c.id === proposal.targetId && c.type === "lore")
    || (!proposal.storyCardType && !adventure.storyCards.some(c => c.id === proposal.targetId)));
}

/** A selected precision cannot legitimize an invalid Gregorian date. Fantasy dates stay textual. */
export function validLoreDate(time?: StoryTime): boolean {
  if (!time) return true;
  if (time.precision === "unknown" && !time.date) return true;
  const parsed = readStoryTime("Date: " + time.text).time;
  const gregorian = /\b\d{4}-\d{2}-\d{2}\b/.test(time.text)
    || /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i.test(time.text)
    || /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i.test(time.text);
  if (gregorian && !parsed?.date && !["approximate", "relative"].includes(time.precision)) return false;
  if (time.precision === "time" && gregorian) {
    const clock = time.text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) return false;
  }
  if (time.date && (parsed?.date !== time.date || !["day", "time"].includes(time.precision))) return false;
  if (["day", "time", "month", "year"].includes(time.precision) && !time.text.trim()) return false;
  if (time.precision === "year" && /^\d/.test(time.text) && !/^\d{4}$/.test(time.text)) return false;
  if (time.precision === "month" && /^\d/.test(time.text) && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(time.text)) return false;
  return true;
}

// Only an event-date prefix is compared. Incidental dates, historical references,
// and future plans inside ordinary prose are not declarations of completed events.
function eventPrefix(text: string): string | undefined {
  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  return text.trim().replace(/^(?:#{1,6}\s+|\*\*)/, "").match(new RegExp(
    `^\\[?((?:\\d{4}-\\d{2}-\\d{2})|(?:\\d{1,2}\\s+(?:${months})(?:\\s+\\d{4})?)|(?:(?:${months})\\s+\\d{1,2}(?:,?\\s+\\d{4})?))(?=\\](?:\\s|$)|\\s*(?:[—–:|]| - |$))`, "i"))?.[1];
}
function prefixAgrees(prefix: string, date: string): boolean {
  const full = readStoryTime("Date: " + prefix).time?.date;
  if (full) return full === date;
  // A missing year is compared only with an independently established event year.
  const expanded = readStoryTime("Date: " + prefix + " " + date.slice(0, 4)).time?.date;
  return expanded === date;
}

export function validateLoreChronology(adventure: Adventure, proposal: MemoryProposal, source?: Message): LoreChronologyValidation {
  if (!isLoreProposal(adventure, proposal)) return { status: "valid" };
  source ??= adventure.messages.find(m => m.id === proposal.sourceTurnId);
  // Once a proposal exists, a missing source cannot borrow the moving clock.
  // Pre-persistence clock fallback belongs only to proposal construction.
  const evidence = source ? sourceLoreEventDate(adventure, proposal, source)
    : readStoryTime(sourceText(adventure, proposal)).time;
  const append = proposal.cardOperation === "append" || Boolean(proposal.targetId);
  const event = append ? proposal.lore?.lastChangedAt ?? proposal.lore?.occurredAt : proposal.lore?.occurredAt;
  const conflict = (reason: string): LoreChronologyValidation => ({ status: "conflict", reason });
  for (const [label, time] of [["Occurrence", proposal.lore?.occurredAt], ["Last development", proposal.lore?.lastChangedAt]] as const) {
    if (!validLoreDate(time)) return conflict(`${label} date is invalid: ${time?.text || "empty"}.`);
  }
  const observed = readStoryTime(sourceText(adventure, proposal, source));
  if (observed.time && !validLoreDate(observed.time.precision === "unknown" ? { ...observed.time, precision: "day" } : observed.time)) return conflict(`Source scene date is inconsistent or invalid: ${observed.time.text}.`);
  if (evidence?.date && event?.date && evidence.date !== event.date)
    return conflict(`Source event date ${evidence.date}; proposed ${append ? "last development" : "occurrence"} ${event.date}.`);
  if (!append && proposal.lore?.occurredAt?.date && proposal.lore.lastChangedAt?.date
    && proposal.lore.occurredAt.date !== proposal.lore.lastChangedAt.date)
    return conflict(`Occurrence ${proposal.lore.occurredAt.date}; last development ${proposal.lore.lastChangedAt.date}.`);
  const prefixes = [eventPrefix(proposal.content), ...(!append ? [eventPrefix(proposal.title)] : [])].filter((p): p is string => Boolean(p));
  // Generated dates can contradict one another, but never establish evidence.
  const reference = evidence?.date ?? event?.date ?? prefixes.map(prefix => readStoryTime("Date: " + prefix).time?.date).find(Boolean);
  for (const prefix of prefixes) {
    if (reference && !prefixAgrees(prefix, reference)) return conflict(`Source/proposed event date ${reference}; generated event-date prefix ${prefix}.`);
  }
  if (!evidence?.date || !event?.date) return { status: "uncertain", reason: "No reliable exact source and event date are both available." };
  return { status: "valid" };
}

/** The saved, established clock alone dates new memory operations. */
export function resolveLoreEventDate(adventure: Adventure, _proposal?: LoreInformation, _source?: Message): StoryTime | undefined {
  return adventure.storyClock?.origin === "established" ? adventure.storyClock.current : undefined;
}
