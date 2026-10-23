import type { StoryTime, StoryClock, Message, Adventure } from "../types/adventure";

export const STORY_TIME_PRECISIONS = ["unknown", "relative", "approximate", "year", "month", "day", "time"] as const;
export const DEFAULT_STORY_DATE = "2000-01-01";

export function initialStoryClock(adventure?: Pick<Adventure, "openingScene" | "messages">): StoryClock {
  const time: StoryTime = { text: DEFAULT_STORY_DATE, date: DEFAULT_STORY_DATE, precision: "day" };
  let clock: StoryClock = { current: time, anchor: time, origin: "assumed" };
  const opening = readStoryTime(adventure?.openingScene ?? "", clock);
  if (opening.advances && opening.time) clock = { current: opening.time, anchor: opening.time, origin: "established" };
  let previous: Message | undefined;
  for (const message of adventure?.messages ?? []) {
    if (message.role === "system" || message.inputMode === "comms") continue;
    const observed = readStoryTime(message.content, clock);
    // Do not assign the new assumed date retroactively to undated imported entries.
    const duplicate = message.role === "assistant" && previous?.role === "user" && Boolean(transitionKey(message.content)) && transitionKey(message.content) === transitionKey(previous.content);
    if (observed.advances && observed.time && !duplicate) clock = { ...clock, current: observed.time, sourceMessageId: message.id,
      origin: transitionKey(message.content) ? clock.origin : "established" };
    previous = message;
  }
  return clock;
}

export function transitionKey(text: string): string | undefined {
  if (/\b(flashback|years? earlier|days? earlier)\b/i.test(text)) return undefined;
  if (/(?:^|\n)\s*(?:the )?next (?:morning|day)\b/i.test(text)) return "days:1";
  const match = text.match(/(?:^|\n)\s*(?:(?:time skip|time passes)\s*:\s*)?(one|two|three|four|five|six|seven|\d+)\s+(days?|weeks?)\s+later\b/i);
  if (!match) return undefined;
  const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  return `days:${(numbers[match[1].toLowerCase()] ?? Number(match[1])) * (/week/i.test(match[2]) ? 7 : 1)}`;
}

function explicitGregorianDate(raw: string): string | undefined {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\b|T)/);
  const named = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const year = Number(iso?.[1] ?? named?.[3]);
  const month = iso ? Number(iso[2]) - 1 : months.indexOf(named?.[1].toLowerCase() ?? "");
  const day = Number(iso?.[3] ?? named?.[2]);
  if (!Number.isInteger(year) || year < 100 || month < 0 || month > 11 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : undefined;
}

/** Only explicit scene headings/clock statements advance time; incidental dates do not. */
export function readStoryTime(text: string, clock?: StoryClock): { time?: StoryTime; flashback: boolean; advances: boolean } {
  const flashback = /\b(flashback|years? earlier|days? earlier|remember(?:s|ed)? when)\b/i.test(text);
  const heading = text.match(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:current story (?:date|time)|story (?:date|time)|date|flashback|back to the present)\s*:\s*([^\n]+)/i);
  const statement = text.match(/(?:\b(?:it is|the date is|today is)\s+|(?:^|\n)\s*on\s+)((?:\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})(?:\s+\d{1,2}:\d{2})?)/i);
  const raw = heading?.[1]?.trim() ?? statement?.[1]?.trim();
  if (raw) {
    const approximate = /\b(about|around|approximately|circa|early|late|mid)\b/i.test(raw);
    // Parse only the explicitly recognized Gregorian forms. Fantasy/relative dates stay textual.
    const value = !approximate ? explicitGregorianDate(raw) : undefined;
    const precision = approximate ? "approximate" : value ? (/\d{1,2}:\d{2}/.test(raw) ? "time" : "day") : /^\d{4}$/.test(raw) ? "year" : /^(?:\d{4}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})$/i.test(raw) ? "month" : /\b(ago|later|before|after|yesterday|tomorrow)\b/i.test(raw) ? "relative" : "unknown";
    return { time: { text: raw, precision, ...(value ? { date: value } : {}) }, flashback, advances: !flashback };
  }
  if (/(?:^|\n)\s*(?:the )?next (?:morning|day)\b/i.test(text) && !flashback) return readStoryTime("One day later", clock);
  const skip = text.match(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:(?:time skip|time passes)\s*:\s*)?(one|two|three|four|five|six|seven|\d+)\s+(days?|weeks?|months?|years?|hours?)\s+later\b/i);
  if (skip && !flashback) {
    const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const days = (numbers[skip[1].toLowerCase()] ?? Number(skip[1])) * (/weeks?/i.test(skip[2]) ? 7 : 1);
    if (/^(day|week)/i.test(skip[2]) && clock?.current?.date && clock.current.precision === "day" && Number.isFinite(days)) {
      const date = new Date(clock.current.date + "T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + days);
      const value = date.toISOString().slice(0, 10);
      return { time: { text: value, date: value, precision: "day" }, flashback, advances: true };
    }
    return { time: { text: skip[0].trim() + (clock?.current?.text ? ` after ${clock.current.text}` : ""), precision: "relative" }, flashback, advances: true };
  }
  return { flashback, advances: false };
}

/** Recompute only after an edit/undo, retaining an explicit user clock anchor. No provider work. */
export function reconcileStoryClock(clock: StoryClock | undefined, messages: Message[]): StoryClock | undefined {
  if (!clock?.sourceMessageId) return clock;
  let current: StoryClock = { current: clock.anchor, anchor: clock.anchor, origin: clock.origin };
  let previous: Message | undefined;
  for (const message of messages) {
    if (message.inputMode === "comms" || message.role === "system") continue;
    const observed = readStoryTime(message.content, current);
    const duplicate = message.role === "assistant" && previous?.role === "user" && Boolean(transitionKey(message.content)) && transitionKey(message.content) === transitionKey(previous.content);
    if (observed.advances && observed.time && !duplicate) current = { ...current, current: observed.time, sourceMessageId: message.id };
    previous = message;
  }
  return current;
}

export function formatStoryTime(time?: StoryTime): string {
  return time?.text ? `${time.text}${time.precision === "day" || time.precision === "time" ? "" : ` (${time.precision})`}` : "unknown";
}
