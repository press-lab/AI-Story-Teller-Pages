import type { ComponentType, ProviderConfig, StoryCardMemoryMode, StoryCardType } from "../types/adventure";
import { isNativeDeepSeekProvider, sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { ADVENTURE_GENERATION_BEST_PRACTICES } from "./authoringBestPractices";

export interface GenComponent {
  title: string;
  type: ComponentType;
  content: string;
  alwaysOn: boolean;
  pinned: boolean;
  priority: number;
}

export interface GenStoryCard {
  title: string;
  type: StoryCardType;
  memoryMode?: StoryCardMemoryMode;
  keys: string[];
  content: string;
  pinned: boolean;
  priority: number;
}

export interface AdventureGenResult {
  title: string;
  openingScene: string;
  components: GenComponent[];
  storyCards: GenStoryCard[];
}

export type AdventureStoryShape =
  | "balanced"
  | "sandbox"
  | "missionLoop"
  | "mystery"
  | "factionPolitics"
  | "romanceDrama"
  | "survivalHorror";

export type AdventureProseMode =
  | "balanced"
  | "minimalist"
  | "novelistic"
  | "cinematic"
  | "dialogueHeavy";

export type AdventurePlayerControlMode = "strict" | "minorActions" | "cinematicFlow";
export type AdventureAdultContentMode = "off" | "romanceOnly" | "explicitAdult";

export interface AdventureGenPreferences {
  storyShape: AdventureStoryShape;
  proseMode: AdventureProseMode;
  playerControl: AdventurePlayerControlMode;
  adultContent: AdventureAdultContentMode;
  boundaries?: string;
}

const generatedComponentTypes = new Set<ComponentType>([
  "aiInstructions",
  "plotEssentials",
  "activePressure",
  "authorNote",
  "custom",
]);
const storyCardTypes = new Set<StoryCardType>(["character", "location", "lore", "plot", "custom"]);
const storyCardMemoryModes = new Set<StoryCardMemoryMode>(["static", "living", "historical"]);

const defaultPreferences: AdventureGenPreferences = {
  storyShape: "balanced",
  proseMode: "balanced",
  playerControl: "strict",
  adultContent: "off",
  boundaries: "",
};

function parseJsonFenced<T>(text: string): T {
  const trimmed = text.trim();

  const attempts: Array<() => string | undefined> = [
    // 1. Fenced block spanning the whole response
    () => trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1],
    // 2. Any fenced block anywhere in the response
    () => trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1],
    // 3. Outermost {...}
    () => { const s = trimmed.indexOf("{"); const e = trimmed.lastIndexOf("}"); return s !== -1 && e > s ? trimmed.slice(s, e + 1) : undefined; },
    // 4. Raw response as-is
    () => trimmed,
  ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    const candidate = attempt();
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  const preview = trimmed.slice(0, 300);
  throw new Error(`Could not parse model response as JSON. Raw response (first 300 chars): ${preview}\n\nParse error: ${String(lastErr)}`);
}

const SYSTEM_PROMPT = `You are an expert interactive fiction game master and world builder. Given a premise, generate a complete starter setup for an AI-powered text adventure.

Output ONLY valid JSON — no explanation, no preamble, no markdown prose outside the JSON block. All field values must be in English regardless of the premise language.
{
  "title": "string — evocative adventure name",
  "openingScene": "string — 2-4 paragraphs setting the scene and immediately immersing the player",
  "components": [
    {
      "title": "string",
      "type": "aiInstructions | plotEssentials | activePressure | authorNote | custom",
      "content": "string",
      "alwaysOn": true,
      "pinned": true,
      "priority": 80
    }
  ],
  "storyCards": [
    {
      "title": "string",
      "type": "character | location | lore | plot | custom",
      "memoryMode": "static | living | historical",
      "keys": ["trigger1", "trigger2"],
      "content": "string — concise durable reference facts; bullet format preferred",
      "pinned": false,
      "priority": 0
    }
  ]
}

Authoring contract:
${ADVENTURE_GENERATION_BEST_PRACTICES}

Component guidelines:
- Always include one "plotEssentials" component containing the current operating truth: current situation, active tensions, obligations, and constraints that must shape every scene. Use 4-7 tight bullets and keep it under 140 words. Do not turn it into a full backstory or lore encyclopedia.
- Include one "activePressure" component for the immediate external threat, obligation, deadline, or unresolved problem driving the opening. Keep it to exactly one concise sentence.
- Add "aiInstructions" for scenario-specific generation constraints or drift prevention not covered by narration mechanics. Do not put story facts there. Structure it with named ALL-CAPS sections (SETTING, PLAYER POWER, STORY BEHAVIOR, PROSE, etc.) relevant to the premise. Each section should be 2-5 tight bullet points. Always include a PROSE section with guidance on sentence rhythm, dialogue voice diversity, and sensory vs. expository balance. Include a STORY BEHAVIOR section that specifies what the story should be driven by and what drift patterns to prevent. If the premise involves a powerful or exceptional player character, include a PLAYER POWER section with explicit rules about how NPCs engage without worship or constant nerf attempts. Omit sections that are not relevant to the premise.
- Add "authorNote" only for concise tone, mood, pacing, or prose influence.
- Add a "custom" component only for broad world context that is relevant every turn. If it matters only when a character, place, faction, object, or secret appears, use a Story Card instead.
- Do NOT include narrationRules — those are managed separately.

Story card guidelines:
- Create cards for recurring named characters, significant recurring locations, factions, and key lore items introduced by the premise or opening scene.
- Do not create cards for current scene position, temporary mission status, one-off scenery, or throwaway objects. Put immediate danger in activePressure and let the recent messages carry the next concrete beat.
- memoryMode: use "static" for always-true facts, "living" for evolving current relationships/status/searches/arrangements, and "historical" for completed events or past-tense facts.
- keys array: use the specific trigger phrases that should summon THIS card. Character aliases belong on character identity cards. Do not put broad character names on event, relationship, or subplot cards when those names already have character cards.
- Aim for 4–12 cards depending on the complexity of the premise. Quality over quantity.
- Each card's content should be self-contained reference material the AI will use mid-story.
- Location, faction, and lore cards: 3-6 bullet facts. Present tense unless memoryMode is "historical". What the AI needs to know to write it correctly.
- Character cards MUST include a VOICE CONTRACT section. This is the single most important part of the card — it tells the AI how the character sounds, not just who they are. Also include a section on HOW THEY ENGAGE THE PLAYER: the specific tactics, tests, or social maneuvers this character uses with the player character specifically — not just their general personality. Use this exact structure:

[brief 1–2 sentence description of who they are and their role]

VOICE CONTRACT
Rhythm: [sentence length and pacing — e.g. "Short declaratives. Never explains herself." or "Long enthusiastic tangents that land on something surprisingly accurate."]
Default move: [what they do first when speaking or entering a scene — their instinctive social action]
Emotional defense: [how they protect vulnerability — deflection, humor, aggression, pivot to task, silence]
Never sounds like: [specific behaviors the AI must not give this character — be concrete: "warm", "offering choices", "saying I feel..."]
Example lines: "[a line in their actual voice]" / "[another line]" / "[a third line]"

HOW THEY ENGAGE THE PLAYER
[2–4 bullet points describing this character's specific tactics, tests, or moves when dealing with the player character. Not generic personality — the active moves they make. E.g. "Recruits by demonstrating she already knows something useful about him before he speaks." or "Tests loyalty through small escalating requests before revealing the real ask."]

The example lines carry the most weight. Write them as the character would actually say them in the story. The HOW THEY ENGAGE section is what separates a card that controls behavior from one that only describes it.`;

function setupPreferenceGuidance(preferences: AdventureGenPreferences): string {
  const storyShapeGuidance: Record<AdventureStoryShape, string> = {
    balanced: "Balanced adventure: use a tight premise, a small recurring cast, one active pressure, and a few Story Cards. Keep PE compact and broadly useful.",
    sandbox: "Sandbox: prioritize a reactive world, player agency, faction/location cards, and loose hooks. Keep AI Instructions light; do not over-plan the plot in PE.",
    missionLoop: "Mission loop: create an explicit custom loop component whose phases feed each other. PE should name the current assignment/obligation and recurring constraints; Story Cards should hold the team, handler, enemy factions, and recurring mission assets.",
    mystery: "Mystery: PE should state the current known question and immediate investigative pressure, not the answer. Put clues, suspects, secrets, and locations in Story Cards. AI Instructions should prevent premature reveals.",
    factionPolitics: "Faction politics: PE should name the current public pressure and power balance. Use Story Cards for factions, leaders, alliances, leverage, and secrets. AI Instructions should keep consequences social, legal, and material.",
    romanceDrama: "Romance drama: keep romance pressure choice-driven. Put recurring relationship state on living Story Cards or Brains, not bloated PE. AI Instructions should preserve tension, banter, boundaries, and competing agendas without forcing commitment.",
    survivalHorror: "Survival or horror: PE should name the current threat, scarcity, and constraints. Story Cards should capture rules of the threat, safe places, recurring dangers, and costs. AI Instructions should preserve dread, uncertainty, and consequences.",
  };

  const proseGuidance: Record<AdventureProseMode, string> = {
    balanced: "Balanced prose: mix dialogue, action, and sensory detail without padding.",
    minimalist: "Minimalist prose: short paragraphs, clear action, fast dialogue, no ornate description or summary padding.",
    novelistic: "Novelistic prose: richer atmosphere, interior nuance for NPCs, slower emotional texture, and polished sentence rhythm without stalling play.",
    cinematic: "Cinematic prose: visible behavior, blocking, sound, motion, and consequences. Frame scenes like a camera; avoid unsupported internal narration.",
    dialogueHeavy: "Dialogue-heavy prose: prioritize distinct voices, interruptions, subtext, and social moves. Use narration mainly to anchor action and physical cues.",
  };

  const playerGuidance: Record<AdventurePlayerControlMode, string> = {
    strict: "Player control: never write the player character's dialogue, thoughts, choices, actions, or reactions. End at a natural beat for the player to act.",
    minorActions: "Player control: the AI may bridge tiny implied motions for flow, but must not decide the player character's words, emotions, major actions, or turning-point choices.",
    cinematicFlow: "Player control: the AI may write minor player-character beats needed for a full scene's flow, but major choices, consent, commitments, and consequences remain player-owned.",
  };

  const adultGuidance: Record<AdventureAdultContentMode, string> = {
    off: "Adult content: off. Do not include sexual setup, erotic instructions, or NSFW content unless the user explicitly adds it later.",
    romanceOnly: "Adult content: romance-only. Build attraction, intimacy, flirtation, and emotional/relationship tension, but do not include explicit sexual content or adult scene mechanics.",
    explicitAdult: "Adult content: explicit opt-in adult layer. All romantic/sexual participants must be clearly consenting adults. Avoid minor-coded, school-age, or ambiguous-age framing. Keep adult rules and boundaries in a clearly named AI Instructions section rather than mixing them into general prose rules.",
  };

  const boundaries = preferences.adultContent === "off" ? "" : preferences.boundaries?.trim();

  return `Setup preferences:
- Story shape: ${storyShapeGuidance[preferences.storyShape]}
- Prose mode: ${proseGuidance[preferences.proseMode]}
- ${playerGuidance[preferences.playerControl]}
- ${adultGuidance[preferences.adultContent]}${boundaries ? `\n- Boundaries and limits to respect: ${boundaries}` : ""}

Apply these preferences by routing facts to the correct surfaces:
- AI Instructions: behavior, player-control contract, prose mode, drift prevention, adult-content policy if opted in.
- Plot Essentials: 4-7 bullets of current operating truth only.
- Active Pressure: exactly one sentence naming the current external pressure.
- Author's Note: brief tone/mood/pacing nudge only.
- Story Cards/Brains: recurring people, relationships, locations, factions, secrets, rules, and evolving internal state.`;
}

export async function runAdventureGen(
  premise: string,
  config: ProviderConfig,
  preferences: Partial<AdventureGenPreferences> = {},
): Promise<AdventureGenResult> {
  const resolvedPreferences: AdventureGenPreferences = {
    ...defaultPreferences,
    ...preferences,
    boundaries: preferences.boundaries ?? defaultPreferences.boundaries,
  };
  const response = await sendOpenAICompatibleChatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Premise:\n${premise.trim()}\n\n${setupPreferenceGuidance(resolvedPreferences)}` },
    ],
    config,
    ...(isNativeDeepSeekProvider(config)
      ? { responseFormat: "json_object" as const, thinking: "disabled" as const }
      : {}),
  });

  const raw = parseJsonFenced<Partial<AdventureGenResult>>(response.content);

  return {
    title: typeof raw.title === "string" ? raw.title : "New Adventure",
    openingScene: typeof raw.openingScene === "string" ? raw.openingScene : "",
    components: Array.isArray(raw.components) ? raw.components.filter(isValidComponent) : [],
    storyCards: Array.isArray(raw.storyCards) ? raw.storyCards.filter(isValidCard) : [],
  };
}

function isValidComponent(c: unknown): c is GenComponent {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.title === "string"
    && typeof obj.type === "string"
    && generatedComponentTypes.has(obj.type as ComponentType)
    && typeof obj.content === "string"
    && (obj.alwaysOn === undefined || typeof obj.alwaysOn === "boolean")
    && (obj.pinned === undefined || typeof obj.pinned === "boolean")
    && (obj.priority === undefined || typeof obj.priority === "number")
  );
}

function isValidCard(c: unknown): c is GenStoryCard {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.title === "string"
    && typeof obj.type === "string"
    && storyCardTypes.has(obj.type as StoryCardType)
    && typeof obj.content === "string"
    && (obj.memoryMode === undefined || (typeof obj.memoryMode === "string" && storyCardMemoryModes.has(obj.memoryMode as StoryCardMemoryMode)))
    && (obj.keys === undefined || (Array.isArray(obj.keys) && obj.keys.every((key) => typeof key === "string")))
    && (obj.pinned === undefined || typeof obj.pinned === "boolean")
    && (obj.priority === undefined || typeof obj.priority === "number")
  );
}
