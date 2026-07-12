import type {
  Adventure,
  ArcContinuationOption,
  ArcPace,
  ArcTriggerMode,
  BrainEntry,
  ComponentEntry,
  ComponentType,
  ProviderConfig,
} from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { makeBrain } from "../state/defaults";
import {
  AI_INSTRUCTIONS_BEST_PRACTICES,
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
    "Write a Narration Rules block — the per-adventure behavior contract. Cover POV and tense, prose format, player agency (never decide the player's actions, words, or feelings), continuity discipline, tone, and a few hard \"never\" rules. Make it behavioral and specific to THIS adventure, not generic boilerplate.",
  aiInstructions:
    "Write an AI Instructions block — scenario-specific genre, drift-prevention, scene-loop, and prose behavior rules that complement, and do not duplicate, the narration rules. Do not store character facts, lore facts, current mission state, backstory, or card-like memory here. Use named ALL-CAPS sections with tight bullets.",
  authorNote:
    "Write a single concise Author's Note — near-context steering for the next few responses. Keep characters active and initiating and the scene moving. One or two sentences.",
};

function componentBestPractices(type: ComponentType): string {
  if (type === "aiInstructions") return AI_INSTRUCTIONS_BEST_PRACTICES;
  if (type === "plotEssentials") return PLOT_ESSENTIALS_BEST_PRACTICES;
  return "";
}

/** Generate fresh content for a Narration Rules / AI Instructions / Author's Note component. Returns a string for review. */
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

export interface GeneratedArc {
  arcPremise: string;
  arcSimmerInstruction: string;
  arcBreakInstruction: string;
  arcPace: ArcPace;
  arcTriggerMode: ArcTriggerMode;
}

const ARC_PACES: ArcPace[] = ["short", "medium", "long", "epic"];

/** Generate an Arc Director setup from a one-line concept, following the break-license best practices. */
export async function generateArcDirector(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  concept: string,
): Promise<GeneratedArc> {
  const systemPrompt = `You are designing a story arc for an interactive-fiction adventure.

${adventureContext(adventure)}

Arc concept from the author: ${concept}

Design an arc that climbs out of the moment-to-moment loop and is allowed to actually break.
Follow these rules:
- The simmer instruction keeps the antagonist recurring, hinting, and mostly off-screen — connected to a larger plan, never monologuing every scene.
- The break instruction licenses a real confrontation that cannot be deferred. It is allowed to cost the cast (named allies can die, ground can be lost). The player stays the strongest — the win is just expensive. "OP in the loop, costly in the climax."

Respond with ONLY this JSON (no markdown, no prose):
{"arcPremise":"one line — what this arc builds toward","arcSimmerInstruction":"how the antagonist behaves while building","arcBreakInstruction":"how the confrontation lands and what it costs","arcPace":"short|medium|long|epic","arcTriggerMode":"ask|auto"}`;
  const response = await sendOpenAICompatibleChatCompletion({
    config: providerConfig,
    messages: [{ role: "user", content: systemPrompt }],
  });
  const parsed = parseJsonObject(response.content);
  if (!parsed) throw new Error("The AI did not return a usable arc.");
  const pace = ARC_PACES.includes(parsed.arcPace as ArcPace) ? (parsed.arcPace as ArcPace) : "medium";
  const trigger = parsed.arcTriggerMode === "auto" ? "auto" : "ask";
  return {
    arcPremise: String(parsed.arcPremise ?? "").trim(),
    arcSimmerInstruction: String(parsed.arcSimmerInstruction ?? "").trim(),
    arcBreakInstruction: String(parsed.arcBreakInstruction ?? "").trim(),
    arcPace: pace,
    arcTriggerMode: trigger,
  };
}

/**
 * When an arc resolves (aftermath), draft 2–3 "where the story goes next" directions that
 * continue from how it ended — escalating or converging on threats that survived, not new
 * strangers. The player picks one; it becomes the next arc.
 */
export async function generateArcContinuations(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  arc: ComponentEntry,
): Promise<ArcContinuationOption[]> {
  const threads = [
    ...adventure.storyCards.filter((card) => card.active).map((card) => ({ id: card.id, label: card.title })),
    ...adventure.brains.filter((brain) => brain.active).map((brain) => ({ id: brain.id, label: brain.characterName })),
  ];
  const validIds = new Set(threads.map((t) => t.id));
  const recent = adventure.messages.slice(-12).map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 2500);

  const systemPrompt = `You are the story director for an interactive-fiction adventure. An arc just resolved — propose where the story goes next.

Resolved arc premise: ${arc.arcPremise?.trim() || "(none)"}
What built up over the arc:
${(arc.content ?? "").slice(0, 1500) || "(none)"}

Recent story:
${recent || "(none)"}

Threads you may carry forward (use these exact ids in threadKeys):
${threads.map((t) => `[${t.id}] ${t.label}`).join("\n") || "(none)"}

Propose 2-3 DISTINCT next-arc directions that CONTINUE from how this resolved — escalate or converge on a threat that survived (the antagonist's organization, an ally turned, a seeded wildcard rising), never a brand-new stranger. Each should be a tier up: bigger, more personal, or more dangerous than what just ended.
Follow the break-license rule: the cost lands on the world and the cast (allies can die, loyalties are tested); the player stays the strongest — victory is just expensive.

Respond with ONLY this JSON:
{"options":[{"label":"<6 words or fewer>","premise":"<one line>","threadKeys":["<id>","<id>"],"simmerInstruction":"<how the threat behaves while building — off-screen, hinting, recurring>","breakInstruction":"<the eventual confrontation and what it costs>","pace":"short|medium|long|epic"}]}`;

  const response = await sendOpenAICompatibleChatCompletion({
    config: providerConfig,
    messages: [{ role: "user", content: systemPrompt }],
  });
  const parsed = parseJsonObject(response.content);
  const raw = Array.isArray((parsed as { options?: unknown })?.options) ? (parsed as { options: unknown[] }).options : [];
  const options: ArcContinuationOption[] = [];
  for (const item of raw.slice(0, 3)) {
    const o = item as Record<string, unknown>;
    const label = String(o.label ?? "").trim();
    const premise = String(o.premise ?? "").trim();
    if (!label || !premise) continue;
    const threadKeys = Array.isArray(o.threadKeys)
      ? (o.threadKeys as unknown[]).filter((k): k is string => typeof k === "string" && validIds.has(k))
      : [];
    options.push({
      label,
      premise,
      threadKeys: threadKeys.length > 0 ? threadKeys : (arc.arcThreadKeys ?? []),
      simmerInstruction: String(o.simmerInstruction ?? "").trim(),
      breakInstruction: String(o.breakInstruction ?? "").trim(),
      pace: ARC_PACES.includes(o.pace as ArcPace) ? (o.pace as ArcPace) : "long",
    });
  }
  return options;
}

/**
 * Pick the most convergent continuation for silent auto-continue: the option whose carried-forward
 * threads had the most engagement in the resolved arc (reuses what the player was most invested in),
 * falling back to the generator's lead option. Pure + deterministic.
 */
export function pickConvergentContinuation(
  options: ArcContinuationOption[],
  priorEngagement: Record<string, number>,
): ArcContinuationOption | undefined {
  if (options.length === 0) return undefined;
  const score = (o: ArcContinuationOption) => o.threadKeys.reduce((sum, key) => sum + (priorEngagement[key] ?? 0), 0);
  return options.reduce((best, o) => (score(o) > score(best) ? o : best), options[0]);
}

export interface ProposedArc {
  /** Short human-readable label for the Inbox title (≤6 words). */
  label: string;
  arcPremise: string;
  arcSimmerInstruction: string;
  arcBreakInstruction: string;
  arcPace: ArcPace;
  arcTriggerMode: ArcTriggerMode;
  /** Ids of existing story cards / brains to carry as this arc's threads. */
  arcThreadKeys: string[];
  /** Why this arc grows out of what just happened — shown as the proposal rationale. */
  rationale: string;
}

/**
 * Read the last ~50 turns and draft an arc that grows out of what's actually been happening —
 * for a story that's gone stale in aftermath and wants a new direction. Returns a proposal for
 * review (it does not apply anything); approving it seeds the Current Arc.
 */
export async function generateArcFromHistory(
  adventure: Adventure,
  providerConfig: ProviderConfig,
): Promise<ProposedArc> {
  const threads = [
    ...adventure.storyCards.filter((card) => card.active).map((card) => ({ id: card.id, label: card.title })),
    ...adventure.brains.filter((brain) => brain.active).map((brain) => ({ id: brain.id, label: brain.characterName })),
  ];
  const validIds = new Set(threads.map((t) => t.id));
  const recent = adventure.messages.slice(-50).map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 6000);

  const systemPrompt = `You are the story director for an interactive-fiction adventure. The story has been running without a driving arc — read what's been happening and propose ONE arc that grows naturally out of it.

${adventureContext(adventure)}

Recent play (most recent last):
${recent || "(none)"}

Threads you may carry forward (use these exact ids in arcThreadKeys — only ids from this list):
${threads.map((t) => `[${t.id}] ${t.label}`).join("\n") || "(none)"}

Design an arc that climbs out of the moment-to-moment loop and is allowed to actually break. Follow these rules:
- It must grow from threads, tensions, or characters already present in the recent play — never a brand-new stranger.
- The simmer instruction keeps the antagonist recurring, hinting, and mostly off-screen — connected to a larger plan, never monologuing every scene.
- The break instruction licenses a real confrontation that cannot be deferred and is allowed to cost the cast (named allies can die, ground can be lost). The player stays the strongest — the win is just expensive. "OP in the loop, costly at the climax."

Respond with ONLY this JSON (no markdown, no prose):
{"label":"<6 words or fewer>","arcPremise":"one line — what this arc builds toward","arcSimmerInstruction":"how the antagonist behaves while building","arcBreakInstruction":"how the confrontation lands and what it costs","arcPace":"short|medium|long|epic","arcTriggerMode":"ask|auto","arcThreadKeys":["<id>","<id>"],"rationale":"one or two lines on how this grows from the recent play"}`;
  const response = await sendOpenAICompatibleChatCompletion({
    config: providerConfig,
    messages: [{ role: "user", content: systemPrompt }],
  });
  const parsed = parseJsonObject(response.content);
  if (!parsed) throw new Error("The AI did not return a usable arc.");
  const pace = ARC_PACES.includes(parsed.arcPace as ArcPace) ? (parsed.arcPace as ArcPace) : "long";
  const trigger = parsed.arcTriggerMode === "auto" ? "auto" : "ask";
  const threadKeys = Array.isArray(parsed.arcThreadKeys)
    ? (parsed.arcThreadKeys as unknown[]).filter((k): k is string => typeof k === "string" && validIds.has(k))
    : [];
  const premise = String(parsed.arcPremise ?? "").trim();
  if (!premise) throw new Error("The AI did not return a usable arc.");
  return {
    label: String(parsed.label ?? "").trim() || premise.slice(0, 60),
    arcPremise: premise,
    arcSimmerInstruction: String(parsed.arcSimmerInstruction ?? "").trim(),
    arcBreakInstruction: String(parsed.arcBreakInstruction ?? "").trim(),
    arcPace: pace,
    arcTriggerMode: trigger,
    arcThreadKeys: threadKeys,
    rationale: String(parsed.rationale ?? "").trim(),
  };
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
