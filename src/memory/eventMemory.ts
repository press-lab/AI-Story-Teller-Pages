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
export function selectEventMemories(cards: StoryCard[], text: string): Map<string, string> {
  const textWords = words(text);
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
        // Short anchors ("hot tub") are too common alone; they recall only alongside a participant.
        if (mentions(text, phrase)) return Boolean(participant) || normalize(phrase).split(" ").length >= 3;
        const cueWords = words(phrase);
        return Boolean(participant) && cueWords.size >= 2 && [...cueWords].filter(w => textWords.has(w)).length / cueWords.size >= 0.75;
      });
      return { card, cue, score: cue ? 10 + (participant ? 5 : 0) : 0 };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.card.priority - a.card.priority || a.card.id.localeCompare(b.card.id))
    .slice(0, 3)
    .map(({ card, cue }) => [card.id, "event recall: " + cue]));
}
