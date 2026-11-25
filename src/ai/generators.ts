import type {
  Adventure,
  BrainEntry,
  ComponentEntry,
  ComponentType,
  ProviderConfig,
} from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { makeBrain } from "../state/defaults";
import {
  AI_INSTRUCTIONS_BEST_PRACTICES,
  NARRATION_RULES_BEST_PRACTICES,
  PLOT_ESSENTIALS_BEST_PRACTICES,
  STORY_CARD_BEST_PRACTICES,
  TRIGGER_BEST_PRACTICES,
} from "./authoringBestPractices";

/** Compact snapshot of the adventure, fed to every generator so output is grounded in this world. */
function adventureContext(adventure: Adventure): string {
  const plot = adventure.components.find((component) => component.type === "plotEssentials")?.content ?? "";
  const cast = adventure.brains.map((brain) => brain.characterName).filter(Boolean).join(", ");
  const cards = adventure.storyCards
    .filter((card) => card.active)
    .slice(0, 12)
    .map((card) => card.title)
    .join(", ");
  return [
    `Title: ${adventure.title}`,
    adventure.openingScene ? `Opening scene:\n${adventure.openingScene.slice(0, 800)}` : "",
    plot ? `Plot essentials:\n${plot.slice(0, 800)}` : "",
    cast ? `Known characters: ${cast}` : "",
    cards ? `Known story cards: ${cards}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const text = clean(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const COMPONENT_GEN_PROMPTS: Partial<Record<ComponentType, string>> = {
  narrationRules:
    "Write a Narration Rules block — the per-adventure behavior contract. Cover POV and tense, prose format, player agency (preserve meaningful choices and respect the selected Strict, Minor Actions, or Cinematic Flow preference), continuity discipline, tone, and a few hard \"never\" rules. Make it behavioral and specific to THIS adventure, not generic boilerplate.",
  aiInstructions:
    "Write an AI Instructions block — scenario-specific genre, drift-prevention, scene-loop, and prose behavior rules that complement, and do not duplicate, the narration rules. Do not store character facts, lore facts, current mission state, backstory, or card-like memory here. Use named ALL-CAPS sections with tight bullets.",
};

function componentBestPractices(type: ComponentType): string {
  if (type === "narrationRules") return NARRATION_RULES_BEST_PRACTICES;
  if (type === "aiInstructions") return AI_INSTRUCTIONS_BEST_PRACTICES;
  if (type === "plotEssentials") return PLOT_ESSENTIALS_BEST_PRACTICES;
  return "";
}

/** Generate fresh content for a Narration Rules / AI Instructions component. Returns a string for review. */
export async function generateComponentContent(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  component: ComponentEntry,
): Promise<string> {
  const instruction = COMPONENT_GEN_PROMPTS[component.type];
  if (!instruction) throw new Error(`No generator for component type "${component.type}".`);
  const existing = component.content.trim();
  const systemPrompt = `You are an expert interactive-fiction game designer.

${adventureContext(adventure)}

${instruction}
${componentBestPractices(component.type)}
${existing ? `\nThe current version (improve on it, keep what works):\n${existing.slice(0, 1500)}` : ""}

Respond with ONLY the block content — no preamble, no labels, no markdown fences.`;
  const response = await sendOpenAICompatibleChatCompletion({
    config: providerConfig,
    messages: [{ role: "user", content: systemPrompt }],
  });
  return clean(response.content);
}

/** Generate a character Brain from just a name — behavioral voice contract, not adjectives. */
export async function generateBrainFromName(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  name: string,
): Promise<BrainEntry> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a character name first.");
  const systemPrompt = `You are designing a character for an interactive-fiction adventure.

${adventureContext(adventure)}

Create a Brain (interior state) for the character named "${trimmed}".
Make it BEHAVIORAL, not adjectival: describe what they DO in a room, how they treat the player and others, what they want, and how they push scenes forward. "Encourages the player's worst brave ideas and expects them to keep up" — not "reckless and fun".
Do not use this Brain as a replacement for the character's Story Card. Stable public identity, appearance, powers, voice contract, aliases, and always-true facts belong on a character Story Card. This Brain is only for evolving interior state.
${STORY_CARD_BEST_PRACTICES}
${TRIGGER_BEST_PRACTICES}

Respond with ONLY this JSON (no markdown, no prose):
{"currentState":"2-4 lines of behavioral voice contract — what this character does, wants, and how they act in scenes","triggers":["${trimmed}"],"relationshipPressure":"what they want from or how they lean on the main characters","emotionalInterpretation":"how they tend to read situations and people"}`;
  const response = await sendOpenAICompatibleChatCompletion({
    config: providerConfig,
    messages: [{ role: "user", content: systemPrompt }],
  });
  const parsed = parseJsonObject(response.content);
  if (!parsed) throw new Error("The AI did not return a usable character.");
  const triggers = Array.isArray(parsed.triggers)
    ? (parsed.triggers as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  return makeBrain({
    characterName: trimmed,
    source: "generated",
    currentState: String(parsed.currentState ?? "").trim(),
    triggers: triggers.length > 0 ? triggers : [trimmed],
    relationshipPressure: String(parsed.relationshipPressure ?? "").trim(),
    emotionalInterpretation: String(parsed.emotionalInterpretation ?? "").trim(),
  });
}
