import type { Adventure, BrainEntry, Message, ProviderConfig } from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { dedupeBrainThoughts } from "./thoughtDedupe";
import { lastNTurns } from "./storyCardAudit";
import { activeStoryCanon } from "./auditContext";

export type BrainAuditAction = "edit" | "delete" | "create";
export type BrainAuditDecision = "pending" | "approved" | "rejected";
export type BrainAuditSource = "deterministic" | "llm";

export interface BrainAuditRecommendation {
  id: string;
  action: BrainAuditAction;
  source: BrainAuditSource;
  brainId?: string;
  title: string;
  rationale: string;
  suggestedCharacterName: string;
  suggestedTriggers: string[];
  suggestedCurrentState: string;
  suggestedRelationshipPressure: string;
  suggestedEmotionalInterpretation: string;
  suggestedRecentDevelopments: string;
  suggestedNotes: string;
  suggestedThoughts: Record<string, string>;
  decision: BrainAuditDecision;
  editedCharacterName: string;
  editedTriggers: string;
  editedCurrentState: string;
  editedRelationshipPressure: string;
  editedEmotionalInterpretation: string;
  editedRecentDevelopments: string;
  editedNotes: string;
  editedThoughts: string;
}

export interface BrainAuditOptions {
  includeAI?: boolean;
}

const BROAD_ALIAS_WORDS = new Set([
  "a", "an", "any", "he", "her", "hers", "him", "his", "it", "she", "that", "the", "their", "them", "they", "this", "those", "we", "you", "your",
]);

function resolvedProviderConfig(adventure: Adventure, providerConfig: ProviderConfig): ProviderConfig {
  const bg = adventure.semanticEvaluationSettings.backgroundProviderConfig;
  if (bg?.baseUrl) {
    return {
      ...providerConfig,
      baseUrl: bg.baseUrl,
      apiKey: bg.apiKey ?? providerConfig.apiKey,
      model: bg.model || providerConfig.model,
      promptCaching: bg.baseUrl === providerConfig.baseUrl ? providerConfig.promptCaching : undefined,
    };
  }
  return { ...providerConfig, model: adventure.semanticEvaluationSettings.evaluationModel || providerConfig.model };
}

function formatMessages(messages: Message[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Player" : "Story"}: ${m.content}`)
    .join("\n\n");
}

function formatThoughts(thoughts: Record<string, string>): string {
  return Object.entries(thoughts).map(([key, value]) => `${key}: ${value}`).join("\n");
}

function thoughtTurnValue(key: string, value: string): number {
  return Number(value.match(/^(\d+)/)?.[1] ?? key.match(/\d+/)?.[0] ?? 0);
}

function recentThoughtsForReview(brain: BrainEntry, count: number): string {
  const entries = [
    ...Object.entries(brain.thoughts).map(([key, value]) => ({ key, value, state: "current" })),
    ...Object.entries(brain.archivedThoughts).map(([key, value]) => ({ key, value, state: "archived" })),
  ]
    .filter((entry) => entry.value.trim())
    .sort((a, b) => thoughtTurnValue(b.key, b.value) - thoughtTurnValue(a.key, a.value) || b.key.localeCompare(a.key))
    .slice(0, count);

  return entries.map((entry) => `  [${entry.state}] ${entry.key}: ${entry.value}`).join("\n");
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

function isBroadAlias(alias: string, brain: BrainEntry): boolean {
  const norm = normalizeName(alias);
  if (!norm || norm === normalizeName(brain.characterName)) return true;
  const tokens = norm.split(/\s+/).filter(Boolean);
  if (BROAD_ALIAS_WORDS.has(norm) || tokens.every((token) => BROAD_ALIAS_WORDS.has(token))) return true;
  return tokens.length === 1 && norm.length < 3;
}

function thoughtCount(brain: BrainEntry): number {
  return Object.keys(brain.thoughts).length + Object.keys(brain.archivedThoughts).length;
}

function hasAnyBrainContent(brain: BrainEntry): boolean {
  return Boolean(
    brain.currentState.trim() ||
    brain.relationshipPressure.trim() ||
    brain.emotionalInterpretation.trim() ||
    brain.recentDevelopments.trim() ||
    brain.notes.trim() ||
    thoughtCount(brain) > 0
  );
}

function makeRec(
  id: string,
  action: BrainAuditAction,
  brain: BrainEntry,
  rationale: string,
  overrides: Partial<BrainAuditRecommendation> = {},
): BrainAuditRecommendation {
  const suggestedThoughts = overrides.suggestedThoughts ?? brain.thoughts;
  return {
    id,
    action,
    source: "deterministic",
    brainId: brain.id,
    title: brain.characterName,
    rationale,
    suggestedCharacterName: brain.characterName,
    suggestedTriggers: brain.triggers,
    suggestedCurrentState: brain.currentState,
    suggestedRelationshipPressure: brain.relationshipPressure,
    suggestedEmotionalInterpretation: brain.emotionalInterpretation,
    suggestedRecentDevelopments: brain.recentDevelopments,
    suggestedNotes: brain.notes,
    suggestedThoughts,
    decision: "pending",
    editedCharacterName: brain.characterName,
    editedTriggers: brain.triggers.join(", "),
    editedCurrentState: brain.currentState,
    editedRelationshipPressure: brain.relationshipPressure,
    editedEmotionalInterpretation: brain.emotionalInterpretation,
    editedRecentDevelopments: brain.recentDevelopments,
    editedNotes: brain.notes,
    editedThoughts: formatThoughts(suggestedThoughts),
    ...overrides,
  };
}

function deterministicRecommendations(brains: BrainEntry[]): BrainAuditRecommendation[] {
  const results: BrainAuditRecommendation[] = [];
  const seenNames = new Map<string, BrainEntry>();

  for (const brain of brains) {
    const norm = normalizeName(brain.characterName);
    const first = seenNames.get(norm);
    if (norm && first) {
      const keep = thoughtCount(first) >= thoughtCount(brain) ? first : brain;
      const drop = keep.id === first.id ? brain : first;
      results.push(makeRec(
        `det-duplicate-brain-${drop.id}`,
        "delete",
        drop,
        `Duplicate brain for "${keep.characterName}"; keep the entry with the stronger thought history.`,
        {
          suggestedCharacterName: drop.characterName,
          suggestedTriggers: [],
          suggestedThoughts: {},
          editedTriggers: "",
          editedThoughts: "",
        },
      ));
      seenNames.set(norm, keep);
      continue;
    }
    if (norm) seenNames.set(norm, brain);

    if (brain.active && !hasAnyBrainContent(brain)) {
      results.push(makeRec(
        `det-empty-brain-${brain.id}`,
        "edit",
        brain,
        "This active brain has no thoughts or useful state yet; either seed it or deactivate it.",
      ));
    }

    if (brain.triggers.some((alias) => isBroadAlias(alias, brain))) {
      const suggestedTriggers = brain.triggers.filter((alias) => !isBroadAlias(alias, brain));
      results.push(makeRec(
        `det-broad-aliases-${brain.id}`,
        "edit",
        brain,
        "Broad or duplicate aliases can pull this brain into unrelated context; remove pronouns, articles, tiny aliases, and name duplicates.",
        {
          suggestedTriggers,
          editedTriggers: suggestedTriggers.join(", "),
        },
      ));
    }

    const deduped = dedupeBrainThoughts(brain.thoughts, brain.archivedThoughts);
    const thoughtsChanged =
      Object.keys(deduped.thoughts).length !== Object.keys(brain.thoughts).length ||
      Object.entries(deduped.thoughts).some(([key, value]) => brain.thoughts[key] !== value);
    if (thoughtsChanged) {
      results.push(makeRec(
        `det-duplicate-thoughts-${brain.id}`,
        "edit",
        brain,
        "Duplicate thought entries repeat the same internal beat under multiple keys; keep only the strongest current copy.",
        {
          suggestedThoughts: deduped.thoughts,
          editedThoughts: formatThoughts(deduped.thoughts),
        },
      ));
    }
  }

  return results;
}

function buildPrompt(brains: BrainEntry[], storyCanon: string, recentStory: string, thoughtReviewWindow: number): string {
  const brainList = brains
    .map((brain) => {
      const thoughts = recentThoughtsForReview(brain, thoughtReviewWindow);
      const archivedCount = Object.keys(brain.archivedThoughts).length;
      return `[${brain.id}] "${brain.characterName}" aliases: ${brain.triggers.join(", ") || "(name only)"}
currentState: ${brain.currentState || "(empty)"}
relationshipPressure: ${brain.relationshipPressure || "(empty)"}
emotionalInterpretation: ${brain.emotionalInterpretation || "(empty)"}
recentDevelopments: ${brain.recentDevelopments || "(empty)"}
notes: ${brain.notes || "(empty)"}
thoughts under review (last ${thoughtReviewWindow} current/archived entries):
${thoughts || "  (none)"}
archivedThoughts: ${archivedCount}`;
    })
    .join("\n\n---\n\n");

  return `You are cleaning up Character Brains for an interactive fiction game. Brains are private, evolving inner-state for major recurring characters. They are not public biography cards and they are not always-on world lore.

BRAINS UNDER REVIEW:
${brainList || "(none)"}

ACTIVE STORY CANON:
${storyCanon || "(none)"}

RECENT STORY:
${recentStory || "(none)"}

Return ONLY a JSON array - no markdown, no prose. Each item must be one of:
- {"action":"edit","brainId":"...","title":"...","rationale":"...","suggestedCharacterName":"...","suggestedTriggers":["..."],"suggestedCurrentState":"...","suggestedRelationshipPressure":"...","suggestedEmotionalInterpretation":"...","suggestedRecentDevelopments":"...","suggestedNotes":"...","suggestedThoughts":{"key":"value"}}
- {"action":"delete","brainId":"...","title":"...","rationale":"..."}
- {"action":"create","title":"...","rationale":"...","suggestedCharacterName":"...","suggestedTriggers":["..."],"suggestedCurrentState":"...","suggestedRelationshipPressure":"...","suggestedEmotionalInterpretation":"...","suggestedRecentDevelopments":"...","suggestedNotes":"...","suggestedThoughts":{"key":"value"}}

Rules:
- Brains should hold private internal reactions, suspicions, motives, pressure, and plans for major recurring characters only.
- Stable public identity, appearance, powers, biography, voice contract, locations, factions, and completed public events belong on Story Cards, not Brains.
- Keep current thoughts distinct. Remove duplicate thoughts that restate the same beat.
- Keep thoughts in the brain character's own first-person perspective. Rewrite or remove thoughts that are in narrator voice, second person, player perspective, or another character's interiority.
- Keep thoughts specific to a recent or durable private interpretation.
- Do not preserve generic emotions like "I am worried" unless tied to a named pressure, person, plan, or reveal.
- suggestedTriggers should contain useful aliases only; no pronouns, articles, tiny aliases, or duplicate character-name keys.
- For edit recommendations, suggestedThoughts must be the cleaned full CURRENT thought set for that brain after removing duplicates and wrong-perspective thoughts. Do not include archivedThoughts in suggestedThoughts.
- Delete only duplicate, empty, or one-scene NPC brains with no real future value.
- Create only for a major recurring character with clear private-state signal in recent story.
- Be selective - only changes with clear story justification.
- Rationale: one specific sentence.
- Return [] if no changes are needed.`;
}

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.trim()) result[key] = item.trim();
  }
  return result;
}

function parseLLMResponse(raw: string): BrainAuditRecommendation[] {
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned || cleaned === "[]") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).recommendations)
      ? (parsed as Record<string, unknown>).recommendations as unknown[]
      : [];

  return items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => typeof item.action === "string" && ["edit", "delete", "create"].includes(item.action as string))
    .filter((item) => typeof item.title === "string" && (item.title as string).trim())
    .filter((item) => typeof item.rationale === "string" && (item.rationale as string).trim())
    .filter((item) => item.action === "create" || typeof item.brainId === "string")
    .map((item, i) => {
      const suggestedCharacterName =
        typeof item.suggestedCharacterName === "string" ? item.suggestedCharacterName :
        typeof item.characterName === "string" ? item.characterName :
        item.title as string;
      const suggestedTriggers = Array.isArray(item.suggestedTriggers)
        ? (item.suggestedTriggers as unknown[]).filter((entry): entry is string => typeof entry === "string")
        : Array.isArray(item.triggers)
          ? (item.triggers as unknown[]).filter((entry): entry is string => typeof entry === "string")
          : [];
      const suggestedThoughts = objectOfStrings(item.suggestedThoughts ?? item.thoughts);
      const rec: BrainAuditRecommendation = {
        id: `llm-brain-${Date.now()}-${i}`,
        action: item.action as BrainAuditAction,
        source: "llm",
        brainId: typeof item.brainId === "string" ? item.brainId : undefined,
        title: (item.title as string).trim(),
        rationale: (item.rationale as string).trim(),
        suggestedCharacterName: suggestedCharacterName.trim(),
        suggestedTriggers,
        suggestedCurrentState: typeof item.suggestedCurrentState === "string" ? item.suggestedCurrentState : "",
        suggestedRelationshipPressure: typeof item.suggestedRelationshipPressure === "string" ? item.suggestedRelationshipPressure : "",
        suggestedEmotionalInterpretation: typeof item.suggestedEmotionalInterpretation === "string" ? item.suggestedEmotionalInterpretation : "",
        suggestedRecentDevelopments: typeof item.suggestedRecentDevelopments === "string" ? item.suggestedRecentDevelopments : "",
        suggestedNotes: typeof item.suggestedNotes === "string" ? item.suggestedNotes : "",
        suggestedThoughts,
        decision: "pending",
        editedCharacterName: suggestedCharacterName.trim(),
        editedTriggers: suggestedTriggers.join(", "),
        editedCurrentState: typeof item.suggestedCurrentState === "string" ? item.suggestedCurrentState : "",
        editedRelationshipPressure: typeof item.suggestedRelationshipPressure === "string" ? item.suggestedRelationshipPressure : "",
        editedEmotionalInterpretation: typeof item.suggestedEmotionalInterpretation === "string" ? item.suggestedEmotionalInterpretation : "",
        editedRecentDevelopments: typeof item.suggestedRecentDevelopments === "string" ? item.suggestedRecentDevelopments : "",
        editedNotes: typeof item.suggestedNotes === "string" ? item.suggestedNotes : "",
        editedThoughts: formatThoughts(suggestedThoughts),
      };
      return rec;
    });
}

export async function runBrainAudit(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  nTurns: number,
  options: BrainAuditOptions = {},
): Promise<BrainAuditRecommendation[]> {
  const reviewWindow = Number.isFinite(nTurns) ? Math.max(1, Math.min(500, Math.floor(nTurns))) : 20;
  const recentMessages = lastNTurns(adventure.messages, reviewWindow);
  const deterministic = deterministicRecommendations(adventure.brains);
  if (!options.includeAI) return deterministic;

  const flaggedDeleteIds = new Set(deterministic.filter((rec) => rec.action === "delete").map((rec) => rec.brainId).filter(Boolean) as string[]);
  const llmBrains = adventure.brains.filter((brain) => !flaggedDeleteIds.has(brain.id));

  let llmRecs: BrainAuditRecommendation[] = [];
  if (llmBrains.length > 0) {
    const config = resolvedProviderConfig(adventure, providerConfig);
    const prompt = buildPrompt(llmBrains, activeStoryCanon(adventure), formatMessages(recentMessages), reviewWindow);
    try {
      const response = await sendOpenAICompatibleChatCompletion({
        config,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Clean up these Character Brains and return your recommendations as a JSON array." },
        ],
      });
      llmRecs = parseLLMResponse(response.content);
    } catch {
      // LLM failure - return deterministic results only.
    }
    llmRecs = llmRecs.filter((rec) => !rec.brainId || !flaggedDeleteIds.has(rec.brainId));
  }

  return [...deterministic, ...llmRecs];
}
