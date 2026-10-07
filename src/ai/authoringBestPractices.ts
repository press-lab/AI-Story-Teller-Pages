/**
 * Scenario-authoring documentation: docs/fact-ownership.md (also shown in UI Help).
 * One canonical fact has one authoritative home. Self-contained means enough
 * local context for the surface's role, not copied profiles or implicit card loading.
 * Narration Rules/optional AI Instructions own distinct behavior rules; Plot
 * Essentials owns compact current operating truth needed almost every response.
 * Character cards own biography, durable psychology, capabilities and Voice Contract.
 * Brains own event-specific reactions, not enduring wants/values/beliefs. Enrolled
 * directional relationships explicitly own their tracked mutable pair state.
 * Current Story Arc owns the active thread and running developments; Arc Director
 * instructions are future direction, not established events. Notes steer narration;
 * Chronicle, historical cards and archives preserve evidence rather than current state.
 * Reconcile established changes at the owner, remove stale live copies, preserve history,
 * and run the reference's overlap audit. Never equate NPC belief or a plan with fact.
 *
 * The strings below are executable authoring prompts. Keep their ownership guidance
 * aligned with the current Play Loop and post-generation reconciliation behavior.
 */
import type { StoryCardMemoryMode } from "../types/adventure";

export const betterRepositoryGuideSources = [
  "https://better-repository.netlify.app/guides?tab=ai-instructions",
  "https://better-repository.netlify.app/guides?tab=plot-components",
  "https://better-repository.netlify.app/guides?tab=story-cards",
];

export const AI_INSTRUCTIONS_BEST_PRACTICES = `AI Instructions best practices:
- Use AI Instructions for stable scenario behavior, genre, drift prevention, and prose rules. Keep the repeatable sandbox scene loop in the designated Play Loop custom component so it can be temporarily omitted during earned progression.
- Do not store character facts, location facts, relationship facts, current mission state, or backstory here.
- Keep them scenario-specific and non-redundant with Narration Rules.
- Prefer named sections with a few concrete bullets over one large lore paragraph.
- Per-character voice belongs on that character's Story Card, not in AI Instructions.`;

export const PLOT_ESSENTIALS_BEST_PRACTICES = `Plot Essentials best practices:
- Plot Essentials hold compact current operating truth, premise, and persistent constraints needed in nearly every plausible next response. Current Arc owns an active larger thread when used; immediate scene beats stay in the transcript. Do not put a plot beat plan here.
- They are always-on context, so keep them short and non-redundant.
- Change this block only when those foundations materially change. Preserve still-valid foundations; do not append a chronological log.
- Replaced text remains in component history. Removing a fact is not evidence for a historical event card.
- Do not include temporary room position, who is standing where, momentary emotions, or one-off scenery.
- Put situational lore, character identity, relationships, secrets, recurring objects, locations, factions, and completed past events in Story Cards instead.`;

export const STORY_CARD_BEST_PRACTICES = `Story Card best practices:
- A Story Card is durable triggered memory for one subject: a character, location, faction, object, relationship, secret, rule, or completed event.
- The entry must be self-contained. Repeat the subject name in the body; do not rely on the title alone.
- Keep entries concise, concrete, and unambiguous. Avoid temporary scene state and excessive appearance details unless they matter.
- Use present tense for static always-true facts and living current-state cards. Use past tense for historical/completed events.
- Character cards should carry a VOICE CONTRACT with rhythm, default move, emotional defense, never-sounds-like, and example lines.
- Living cards are for evolving current relationships, arrangements, statuses, searches, obligations, and recurring dynamic subjects. Updates merge/archive instead of creating sibling cards.
- Historical cards are for evidenced, completed durable events. Removing or correcting a Plot Essentials fact does not establish a historical event.`;

export const TRIGGER_BEST_PRACTICES = `Trigger best practices:
- Triggers decide whether a card enters context, so false matches are harmful.
- Character aliases belong on the character identity card.
- Event, relationship, location, and subplot cards should not use broad character names as triggers if those names already belong to character cards.
- Prefer specific phrases, nicknames, object names, faction names, place names, case names, or consequences that uniquely identify the subject.
- Avoid generic triggers such as "the team", "the agency", "current", "relationship", "status", "mission", or "event".`;

export const PLOT_MEMORY_THRESHOLD = `Plot and relationship memory threshold:
- Create a new plot card only for a lasting change in an obligation, alliance, relationship, secret, or consequential unresolved situation. Routine hospitality, casual invitations, flirting, repeated affection, and ordinary conversation do not by themselves qualify.
- Prefer updating the existing subject over a sibling card. If the fact is already captured in canon or a proposal, omit it even when a different title would describe it.
- A casual offer is not a binding pact. Preserve an explicitly accepted consequential commitment, but never promote a tentative plan into a completed event or obligation.`;

export const PLAY_LOOP_BEST_PRACTICES = `Play Loop best practices:
- New adventures already include one designated Play Loop custom component. Do not create a second loop or embed its repeatable sandbox instructions in Narration Rules or AI Instructions.
- Use it for ordinary life, NPC autonomy, incidental scenes, dormant possibilities, and low forced payoff velocity. Edit that existing component in Components if the scenario needs a specific mission rhythm.
- It is included during normal play, temporarily omitted after accepted story events demonstrate earned progression or closure, and restored when that need ends. Do not script beats, an ending, or a fixed turn count.`;

export const ADVENTURE_GENERATION_BEST_PRACTICES = `${AI_INSTRUCTIONS_BEST_PRACTICES}

${PLOT_ESSENTIALS_BEST_PRACTICES}

${PLAY_LOOP_BEST_PRACTICES}

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
