import type { Adventure, MemoryProposal, Message, StoryTime } from "../types/adventure";
import { suggestionSourceValid } from "./storyCardSuggestions";
import { placementValidationError } from "./storyCardPlacement";
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
export function resolveLoreEventDate(adventure: Adventure, proposal: LoreInformation, source?: Message): StoryTime | undefined {
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
  const evidence = source ? resolveLoreEventDate(adventure, proposal, source)
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

/** Confirmation is bound to the displayed draft and live source, never a generic bypass. */
export function loreChronologyFingerprint(adventure: Adventure, proposal: MemoryProposal): string {
  const text = JSON.stringify([proposal.sourceTurnId, sourceText(adventure, proposal),
    adventure.messages.find(m => m.id === proposal.sourceTurnId)?.storyTime,
    proposal.title, proposal.content, proposal.targetId, proposal.cardOperation, proposal.appendContent,
    proposal.lore?.occurredAt, proposal.lore?.lastChangedAt,
    proposal.proposedType, proposal.storyCardType, proposal.sourceText, proposal.storyCardPatch,
    // Multi-exchange evidence is as authoritative as the primary source. A later
    // edit to any reviewed source must invalidate its chronology confirmation.
    [...new Set([...(proposal.evaluationSource?.messages.map(m => m.id) ?? []),
      ...(proposal.storyCardReview?.additionalSources?.map(m => m.id) ?? []),
      ...(proposal.storyCardReview?.playerMessageId ? [proposal.storyCardReview.playerMessageId] : [])])]
      .map(id => { const message = adventure.messages.find(m => m.id === id); return [id, message?.content, message?.storyTime]; })]);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `chronology-v1:${(hash >>> 0).toString(16)}:${text.length}`;
}

export function loreDateConfirmed(adventure: Adventure, proposal: MemoryProposal): boolean {
  return Boolean(proposal.chronologyConfirmationFingerprint
    && proposal.chronologyConfirmationFingerprint === loreChronologyFingerprint(adventure, proposal)
    && validLoreDate(proposal.lore?.occurredAt) && validLoreDate(proposal.lore?.lastChangedAt));
}

export type DateCorrectionEligibility = { eligible: true } | { eligible: false; reason: string };

/** Explicit batch correction may override stored chronology, never source evidence. */
export function pendingLoreDateCorrectionEligibility(adventure: Adventure, proposal: MemoryProposal, current: StoryTime | undefined): DateCorrectionEligibility {
  const exclude = (reason: string): DateCorrectionEligibility => ({ eligible: false, reason });
  if (proposal.status !== "pending" || proposal.archivedMemoryHistoryId) return exclude("Only pending suggestions can be corrected.");
  if (!isLoreProposal(adventure, proposal)) return exclude("Only Lore Story Card suggestions can be corrected.");
  if (!current?.date || !["day", "time"].includes(current.precision) || !validLoreDate(current)
    || readStoryTime("Date: " + current.text).time?.date !== current.date) return exclude("The current story date must be a valid exact Gregorian date.");
  if (adventure.storyClock?.origin !== "established") return exclude("Establish the current story date first; the default assumed clock cannot date a batch.");
  const source = adventure.messages.find(m => m.id === proposal.sourceTurnId);
  if (!source || !source.content.trim() || !suggestionSourceValid(adventure, proposal)) return exclude("The source evidence is missing or changed.");
  const evidence = [source, ...(proposal.evaluationSource?.messages ?? []), ...(proposal.storyCardReview?.additionalSources ?? [])];
  // Generated suggestions can contain multiple joined quotes or labelled exchange
  // excerpts. Their existing snapshot/placement guards validate that evidence;
  // only unsnapshotted manual drafts need a direct quote match here.
  const boundEvidence = Boolean(proposal.storyCardReview || proposal.evaluationSource || proposal.placementValidation);
  if (!proposal.content.trim() || !proposal.sourceText.trim()
    || !boundEvidence && !evidence.some(m => m.content.includes(proposal.sourceText.trim()))) return exclude("There is insufficient matching source evidence for this event.");
  const target = adventure.storyCards.find(c => c.id === proposal.targetId);
  if (proposal.targetId && (!target || target.type !== "lore")
    || proposal.cardOperation === "append" && !target
    || target && (proposal.cardOperation !== "append" || !proposal.appendContent)
    || !target && proposal.cardOperation !== "create") return exclude("The Lore destination or operation is no longer valid.");
  const placementError = placementValidationError(adventure, proposal);
  if (placementError) return exclude(placementError);
  const observed = readStoryTime(source.content);
  if (observed.flashback) return exclude("The source explicitly describes a flashback; review its Event Date individually.");
  if (observed.time && !transitionKey(source.content)
    && (!observed.time.date || observed.time.date !== current.date || !validLoreDate(observed.time))) return exclude("The source establishes a different or ambiguous explicit event date.");
  const sourcePrefix = eventPrefix(source.content);
  if (sourcePrefix && !prefixAgrees(sourcePrefix, current.date)) return exclude("The source establishes a different explicit event-date heading.");
  const prefixes = [eventPrefix(proposal.content), eventPrefix(proposal.title)];
  if (prefixes.some(prefix => prefix && !prefixAgrees(prefix, current.date!))) return exclude("The proposed title or event-content prefix identifies a different event date.");
  if (target && !validLoreDate(target.lore?.occurredAt)) return exclude("The destination occurrence date needs individual review.");
  return { eligible: true };
}
