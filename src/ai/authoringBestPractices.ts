import type { StoryCardMemoryMode } from "../types/adventure";

export const betterRepositoryGuideSources = [
  "https://better-repository.netlify.app/guides?tab=ai-instructions",
  "https://better-repository.netlify.app/guides?tab=plot-components",
  "https://better-repository.netlify.app/guides?tab=story-cards",
];

export const AI_INSTRUCTIONS_BEST_PRACTICES = `AI Instructions best practices:
- Use AI Instructions for global behavior, genre, drift prevention, scene loop, and prose rules.
- Do not store character facts, location facts, relationship facts, current mission state, or backstory here.
- Keep them scenario-specific and non-redundant with Narration Rules.
- Prefer named sections with a few concrete bullets over one large lore paragraph.
- Per-character voice belongs on that character's Story Card, not in AI Instructions.`;

export const PLOT_ESSENTIALS_BEST_PRACTICES = `Plot Essentials best practices:
- Plot Essentials hold the overarching premise, central long-term conflict, and persistent story-wide constraints. Immediate threats and obligations belong in Active Pressure; the ongoing storyline and pacing belong in Current Arc.
- They are always-on context, so keep them short and non-redundant.
- Change this block only when those foundations materially change. Preserve still-valid foundations; do not append a chronological log.
- Replaced text remains in component history. Removing a fact is not evidence for a historical event card.
- Do not include temporary room position, who is standing where, momentary emotions, or one-off scenery.
- Put situational lore, character identity, relationships, secrets, recurring objects, locations, factions, and completed past events in Story Cards instead.`;

export const STORY_CARD_BEST_PRACTICES = `Story Card best practices:
- Use Character, Location, Lore or Custom to describe the subject. All types accept new supported facts by append; create a focused subject when no existing card fits. No identity transformation or supporting Lore is required.
- A Story Card is durable triggered memory for one subject: a character, location, faction, object, relationship, secret, rule, or completed event.
- The entry must be self-contained. Repeat the subject name in the body; do not rely on the title alone.
- Keep entries concise, concrete, and unambiguous. Avoid temporary scene state and excessive appearance details unless they matter.
- Use tense appropriate to the fact: plans remain plans and completed events remain history.
- Newly created Character cards should carry a VOICE CONTRACT with rhythm, default move, emotional defense, never-sounds-like, and example lines.
- Every card evolves by append. Preserve original content and voice; return only new facts. Record later corrections with dates instead of deleting history.
- Historical cards are for evidenced, completed durable events. Removing or correcting a Plot Essentials fact does not establish a historical event.`;

export const TRIGGER_BEST_PRACTICES = `Trigger best practices:
- Triggers decide whether a card enters context, so false matches are harmful.
- Character aliases belong on the character identity card.
- Event, relationship, location, and subplot cards should not use broad character names as triggers if those names already belong to character cards.
- Supply 3-6 short, reusable topic phrases covering the card content: its subjects, activities and concepts. Prefer ordinary phrases such as "runic research", "ward design", "government reform", or "British exiles" over exact scene wording or an elaborate full title. Never return empty triggers. Related cards can share relevant topic phrases.
- Avoid generic triggers such as "the team", "the agency", "current", "relationship", "status", "mission", or "event".`;

export const PLOT_MEMORY_THRESHOLD = `Plot and relationship memory threshold:
- Create a new Lore card only for a lasting change in an obligation, alliance, relationship, secret, or consequential unresolved situation. Routine hospitality, casual invitations, flirting, repeated affection, and ordinary conversation do not by themselves qualify.
- Prefer updating the existing subject over a sibling card. If the fact is already captured in canon or a proposal, omit it even when a different title would describe it.
- A casual offer is not a binding pact. Preserve an explicitly accepted consequential commitment, but never promote a tentative plan into a completed event or obligation.`;

export const ADVENTURE_GENERATION_BEST_PRACTICES = `${AI_INSTRUCTIONS_BEST_PRACTICES}

${PLOT_ESSENTIALS_BEST_PRACTICES}

${STORY_CARD_BEST_PRACTICES}

${TRIGGER_BEST_PRACTICES}`;

export function storyCardModeGuidance(mode: StoryCardMemoryMode | undefined): string {
  return "All Story Cards accept new supported facts by append. Return only new facts for an existing card, preserving the entire existing body and voice contract. Keep dates, plans, claims and completed outcomes distinct.";
}

export function storyCardCreationGuidance(mode: StoryCardMemoryMode | undefined): string {
  return `${storyCardModeGuidance(mode)}
Use concise bullet points, one fact per line. Include the subject name in the body. Do not include temporary scene position, who is currently standing nearby, next-action instructions, or momentary feelings.`;
}
