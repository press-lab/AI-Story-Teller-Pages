import { AUTHORING_STANDARDS, PLOT_ESSENTIALS_FOUNDATIONS_RULE } from "./authoringPolicy";
import type { StoryCardMemoryMode } from "../types/adventure";

export const betterRepositoryGuideSources = [
  "https://better-repository.netlify.app/guides?tab=ai-instructions",
  "https://better-repository.netlify.app/guides?tab=plot-components",
  "https://better-repository.netlify.app/guides?tab=story-cards",
];

export const AI_INSTRUCTIONS_BEST_PRACTICES = `AI Instructions best practices:
- Use AI Instructions for enduring scenario tone, genre, drift prevention, an optional scene loop, and scenario-specific prose rules. Keep general narrator behavior in Narration Rules.
- Keep character and location profiles, relationship facts, current mission state, and backstory in their proper surfaces. An optional hidden narrator-only mechanism belongs here; its observed events belong in Lore.
- Keep them scenario-specific and non-redundant with Narration Rules.
- Prefer named sections with a few concrete bullets over one large lore paragraph.
- Per-character voice belongs on that character's Story Card, not in AI Instructions.`;

export const PLOT_ESSENTIALS_BEST_PRACTICES = `Plot Essentials best practices:
- Plot Essentials hold the overarching premise, optional central long-term conflict, and persistent story-wide constraints. The ongoing storyline and pacing belong in Current Arc. Immediate scene details do not belong in Plot Essentials.
- ${PLOT_ESSENTIALS_FOUNDATIONS_RULE}
- Historical dates may establish durable background; active gameplay dates do not belong here.
- They are always-on context, so keep them short and non-redundant.
- Change this block only when those foundations materially change. Preserve still-valid foundations; do not append a chronological log.
- Replaced text remains in component history. Removing a fact is not evidence for a historical event card.
- Do not include temporary room position, who is standing where, momentary emotions, or one-off scenery.
- Put situational lore, character identity, relationships, secrets, recurring objects, locations, factions, and completed past events in Story Cards instead.`;

export const STORY_CARD_BEST_PRACTICES = `Story Card best practices:
- Use Character, Location, Lore or Custom to describe the subject. Default to Lore for events, agreements, research and shared developments; reuse existing Lore about that topic before creating a new card. Append to Character only for an evidenced enduring profile change (identity, lasting capability, role/status, explicit enduring relationship or correction) with a specific reason beyond scene participation.
- A Story Card is durable triggered memory for one subject: a character, location, faction, object, relationship, secret, rule, or completed event.
- The entry must be self-contained. Repeat the subject name in the body; do not rely on the title alone.
- Keep entries concise, concrete, and unambiguous. Avoid temporary scene state and excessive appearance details unless they matter.
- Use tense appropriate to the fact: plans remain plans and completed events remain history.
- Newly created Character cards should carry a VOICE CONTRACT with rhythm, default move, emotional defense, never-sounds-like, and example lines.
- Every card evolves by append. Preserve original content and voice; return only new facts. Record later corrections with dates instead of deleting history.
- Historical Lore records evidenced events and their consequences. Include an established occasion when it helps place the event. Summarize related events only when useful and avoid repeating their full records. Removing or correcting a Plot Essentials fact does not establish a historical event.`;

export const TRIGGER_BEST_PRACTICES = `Trigger best practices:
- Choose natural phrases a character or narrator might use, such as "our first date", "first date with Kori", or "ward design". Avoid word permutations and generic filler.
- Use the same keys array for occasion and specific event phrases. Use "Thanksgiving" for a relevant occasion summary and "Thanksgiving bonfire" for the specific event.
- Use bare names and aliases primarily on Character cards and bare place names primarily on Location cards. For Lore, use the name with a distinguishing event.
- Aim for 3-6 useful keys for new cards, with a maximum of eight. Keep valid existing keys and check likely phrases for missed or unrelated matches.`;

export const PLOT_MEMORY_THRESHOLD = `Plot and relationship memory threshold:
- Create a new Lore card only for a lasting change in an obligation, alliance, relationship, secret, or consequential unresolved situation. Routine hospitality, casual invitations, flirting, repeated affection, and ordinary conversation do not by themselves qualify.
- Prefer updating the existing subject over a sibling card. If the fact is already captured in canon or a proposal, omit it even when a different title would describe it.
- A casual offer is not a binding pact. Preserve an explicitly accepted consequential commitment, but never promote a tentative plan into a completed event or obligation.`;

export const ADVENTURE_GENERATION_BEST_PRACTICES = AUTHORING_STANDARDS;

export function storyCardModeGuidance(mode: StoryCardMemoryMode | undefined): string {
  return "All Story Cards accept new supported facts by append. Return only new facts for an existing card, preserving the entire existing body and voice contract. Keep dates, plans, claims and completed outcomes distinct.";
}

export function storyCardCreationGuidance(mode: StoryCardMemoryMode | undefined): string {
  return `${storyCardModeGuidance(mode)}
Use concise bullet points, one fact per line. Include the subject name in the body. Do not include temporary scene position, who is currently standing nearby, next-action instructions, or momentary feelings.`;
}
