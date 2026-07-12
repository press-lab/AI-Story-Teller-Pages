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
- Plot Essentials are the compact current operating truth: what is happening now, the active story situation, open tensions, obligations, and major constraints that should shape every scene.
- They are always-on context, so keep them short and non-redundant.
- Replace the full block when the story drifts; do not append a chronological log.
- Remove resolved or outgoing facts. The reducer will turn outgoing PE facts into pending historical Story Card proposals for review.
- Do not include temporary room position, who is standing where, momentary emotions, or one-off scenery.
- Put situational lore, character identity, relationships, secrets, recurring objects, locations, factions, and completed past events in Story Cards instead.`;

export const STORY_CARD_BEST_PRACTICES = `Story Card best practices:
- A Story Card is durable triggered memory for one subject: a character, location, faction, object, relationship, secret, rule, or completed event.
- The entry must be self-contained. Repeat the subject name in the body; do not rely on the title alone.
- Keep entries concise, concrete, and unambiguous. Avoid temporary scene state and excessive appearance details unless they matter.
- Use present tense for static always-true facts and living current-state cards. Use past tense for historical/completed events.
- Character cards should carry a VOICE CONTRACT with rhythm, default move, emotional defense, never-sounds-like, and example lines.
- Living cards are for evolving current relationships, arrangements, statuses, searches, obligations, and recurring dynamic subjects. Updates merge/archive instead of creating sibling cards.
- Historical cards are for completed events and outgoing Plot Essentials facts.`;

export const TRIGGER_BEST_PRACTICES = `Trigger best practices:
- Triggers decide whether a card enters context, so false matches are harmful.
- Character aliases belong on the character identity card.
- Event, relationship, location, and subplot cards should not use broad character names as triggers if those names already belong to character cards.
- Prefer specific phrases, nicknames, object names, faction names, place names, case names, or consequences that uniquely identify the subject.
- Avoid generic triggers such as "the team", "the agency", "current", "relationship", "status", "mission", or "event".`;

export const ADVENTURE_GENERATION_BEST_PRACTICES = `${AI_INSTRUCTIONS_BEST_PRACTICES}

${PLOT_ESSENTIALS_BEST_PRACTICES}

${STORY_CARD_BEST_PRACTICES}

${TRIGGER_BEST_PRACTICES}`;

export function storyCardModeGuidance(mode: StoryCardMemoryMode | undefined): string {
  if (mode === "living") {
    return "This is a living Story Card: keep only the subject's current evolving state in live content. Preserve still-current facts, replace obsolete claims, and write in present tense. Do not create sibling cards for the same evolving subject.";
  }
  if (mode === "historical") {
    return "This is a historical Story Card: record completed past events or retired Plot Essentials facts in past tense. Do not make resolved events sound current.";
  }
  return "This is a static Story Card: record durable always-true facts, traits, rules, identity, voice, location, or lore in present tense.";
}

export function storyCardCreationGuidance(mode: StoryCardMemoryMode | undefined): string {
  return `${storyCardModeGuidance(mode)}
Use concise bullet points, one fact per line. Include the subject name in the body. Do not include temporary scene position, who is currently standing nearby, next-action instructions, or momentary feelings.`;
}
