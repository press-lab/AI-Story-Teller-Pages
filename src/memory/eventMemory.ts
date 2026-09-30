import type { EventMemory, StoryCard } from "../types/adventure";

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const GENERIC_RECALL_CUES = new Set(["how we met", "first meeting", "first time", "remember when", "our promise", "shared experience"]);
const words = (text: string) => new Set(normalize(text).split(" ").filter(w => w.length > 3 && !["with", "that", "this", "they", "their", "were", "from"].includes(w)));
const mentions = (text: string, phrase: string) => Boolean(normalize(phrase)) && (" " + normalize(text) + " ").includes(" " + normalize(phrase) + " ");

/** Evidence overlap alone cannot merge two different events in the same scene. */
export function sameEventMemory(a: { content: string; eventMemory?: EventMemory }, b: { content: string; eventMemory?: EventMemory }): boolean {
  if (!a.eventMemory || !b.eventMemory) return false;
  if (normalize(a.content) && normalize(a.content) === normalize(b.content)) return true;
  if (!a.eventMemory.participants.some(name => b.eventMemory!.participants.some(other => normalize(name) === normalize(other)))) return false;
  const left = words(a.content), right = words(b.content);
  const overlap = [...left].filter(w => right.has(w)).length / Math.max(1, Math.max(left.size, right.size));
  const sharedSource = a.eventMemory.sourceMessageIds.some(id => b.eventMemory!.sourceMessageIds.includes(id));
  const sharedCue = a.eventMemory.recallCues.some(c => b.eventMemory!.recallCues.some(d => normalize(c) === normalize(d)));
  return a.eventMemory.kind === b.eventMemory.kind && overlap >= (sharedSource && sharedCue ? 0.5 : 0.8);
}

/** Deterministic, inspectable recall; no extra model request. Global context budgets still apply. */
/** Most event memories a single turn can recall. Kept small: events are history, not current truth. */
export const MAX_EVENT_RECALL = 2;

const TITLE_STOP_WORDS = new Set(["first", "night", "morning", "evening", "day", "time", "about", "after", "before", "again", "continued", "when", "what", "into", "over", "with", "that", "this", "they", "their", "were", "from", "asks", "tells", "says"]);

/** Distinctive title nouns ("piano", "hangar", "cleaver"), excluding participant names and filler. */
function titleNouns(card: StoryCard, participants: string[]): string[] {
  const names = new Set(participants.flatMap(name => normalize(name).split(" ")));
  return [...words(card.title)]
    .map(word => word.replace(/s$/, ""))
    .filter(word => word.length >= 4 && !names.has(word) && !TITLE_STOP_WORDS.has(word));
}

export function selectEventMemories(cards: StoryCard[], text: string): Map<string, string> {
  const textWords = words(text);
  const textStems = new Set([...textWords].map(word => word.replace(/s$/, "")));
  return new Map(cards.filter(c => c.type === "event" && c.active && !c.pinned && c.inclusionPolicy !== "manual" && c.inclusionPolicy !== "always")
    .map(card => {
      const participants = card.eventMemory?.participants ?? [];
      const participant = participants.find(name => {
        if (mentions(text, name)) return true;
        const identity = cards.find(c => c.type === "character" && [c.title, ...c.keys].some(alias => normalize(alias) === normalize(name)));
        return identity && [identity.title, ...identity.keys].some(alias => mentions(text, alias));
      });
      const cue = [...(card.eventMemory?.recallCues ?? []), ...card.keys, card.title].find(phrase => {
        if (participants.some(p => normalize(p) === normalize(phrase))) return false;
        if (GENERIC_RECALL_CUES.has(normalize(phrase)) && !participant) return false;
        if (mentions(text, phrase)) return true;
        const cueWords = words(phrase);
        return Boolean(participant) && cueWords.size >= 2 && [...cueWords].filter(w => textWords.has(w)).length / cueWords.size >= 0.75;
      });
      // Recall cues are often first-person phrasings that never appear verbatim in narration.
      // A participant plus the event's distinctive nouns (e.g. Edythe + piano) is a real match.
      const nouns = participant ? titleNouns(card, participants) : [];
      const nounHits = nouns.filter(noun => textStems.has(noun));
      const nounMatch = Boolean(participant) && nouns.length > 0 && nounHits.length >= Math.min(2, nouns.length);
      const label = cue ?? (nounMatch ? `${participant} + ${nounHits.join(", ")}` : undefined);
      return { card, cue: label, score: label ? 10 + (participant ? 5 : 0) + (cue ? 3 : 0) + nounHits.length : 0 };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.card.priority - a.card.priority || a.card.id.localeCompare(b.card.id))
    .slice(0, MAX_EVENT_RECALL)
    .map(({ card, cue }) => [card.id, "event recall: " + cue]));
}
