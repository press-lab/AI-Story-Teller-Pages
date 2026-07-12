import type { Adventure, Message, ProviderConfig, StoryCard, StoryCardMemoryMode, StoryCardType } from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { backgroundProviderConfigIssue, resolveBackgroundProviderConfig } from "../providers/backgroundProvider";
import { STORY_CARD_BEST_PRACTICES, TRIGGER_BEST_PRACTICES } from "../ai/authoringBestPractices";
import { cleanupWordSet, dedupeStringList, dedupeTextLines } from "./deterministicCleanup";
import { storyCardContextContent } from "./storyCardPolicy";

export type AuditAction = "edit" | "delete" | "create";
export type AuditDecision = "pending" | "approved" | "rejected";
export type AuditSource = "deterministic" | "llm";

export interface AuditRecommendation {
  id: string;
  action: AuditAction;
  source: AuditSource;
  cardId?: string;
  title: string;
  rationale: string;
  suggestedContent: string;
  suggestedKeys: string[];
  suggestedType: StoryCardType;
  suggestedMemoryMode: StoryCardMemoryMode;
  decision: AuditDecision;
  editedContent: string;
  editedKeys: string;
}

export interface StoryCardAuditOptions {
  includeAI?: boolean;
}

// ── Provider ──────────────────────────────────────────────────────────────────

function resolvedProviderConfig(adventure: Adventure, providerConfig: ProviderConfig): ProviderConfig {
  return resolveBackgroundProviderConfig(adventure, providerConfig);
}

// ── Message helpers ───────────────────────────────────────────────────────────

export function lastNTurns(messages: Message[], n: number): Message[] {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") count++;
    if (count === n) return messages.slice(i);
  }
  return messages;
}

function formatMessages(messages: Message[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Player" : "Story"}: ${m.content}`)
    .join("\n\n");
}

// ── Deterministic checks ──────────────────────────────────────────────────────

function makeRec(
  id: string,
  action: AuditAction,
  card: StoryCard,
  rationale: string,
  overrides: Partial<AuditRecommendation> = {},
): AuditRecommendation {
  return {
    id,
    action,
    source: "deterministic",
    cardId: card.id,
    title: card.title,
    rationale,
    suggestedContent: card.content,
    suggestedKeys: card.keys,
    suggestedType: card.type,
    suggestedMemoryMode: card.memoryMode ?? "static",
    decision: "pending",
    editedContent: card.content,
    editedKeys: card.keys.join(", "),
    ...overrides,
  };
}

function detectRedundant(cards: StoryCard[]): AuditRecommendation[] {
  const results: AuditRecommendation[] = [];
  const flagged = new Set<string>();
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      if (flagged.has(a.id) || flagged.has(b.id)) continue;
      const wordsA = cleanupWordSet(storyCardContextContent(a));
      const wordsB = cleanupWordSet(storyCardContextContent(b));
      if (wordsA.size < 10 || wordsB.size < 10) continue;
      const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
      const overlap = intersection / Math.min(wordsA.size, wordsB.size);
      if (overlap > 0.5) {
        const [keep, drop] = wordsA.size >= wordsB.size ? [a, b] : [b, a];
        flagged.add(drop.id);
        results.push(makeRec(
          `det-overlap-${drop.id}`,
          "delete",
          drop,
          `${Math.round(overlap * 100)}% word overlap with "${keep.title}" — likely redundant.`,
          { suggestedContent: "", suggestedKeys: [], editedContent: "", editedKeys: "" },
        ));
      }
    }
  }
  return results;
}

function detectNoKeys(cards: StoryCard[]): AuditRecommendation[] {
  return cards
    .filter((c) => c.active && c.keys.length === 0)
    .map((c) => makeRec(
      `det-nokeys-${c.id}`,
      "edit",
      c,
      "No trigger keys — this card will never be automatically included in context.",
    ));
}

function detectTinyContent(cards: StoryCard[]): AuditRecommendation[] {
  return cards
    .filter((c) => c.active && storyCardContextContent(c).trim().split(/\s+/).filter(Boolean).length < 15)
    .map((c) => makeRec(
      `det-tiny-${c.id}`,
      "edit",
      c,
      "Very short content — likely a stub that needs more detail.",
    ));
}

function detectDuplicateContentLines(cards: StoryCard[]): AuditRecommendation[] {
  return cards.flatMap((card) => {
    const cleaned = dedupeTextLines(card.content);
    if (cleaned.removedCount === 0 || cleaned.text === card.content.trim()) return [];
    return [makeRec(
      `det-duplicate-lines-${card.id}`,
      "edit",
      card,
      `${cleaned.removedCount} duplicate content line${cleaned.removedCount === 1 ? "" : "s"} can be removed without changing the card's facts.`,
      {
        suggestedContent: cleaned.text,
        editedContent: cleaned.text,
      },
    )];
  });
}

function detectZeroFrequency(cards: StoryCard[], recentMessages: Message[], rollingSummary: string): AuditRecommendation[] {
  const corpus = [
    ...recentMessages.filter((m) => m.role !== "system").map((m) => m.content),
    rollingSummary,
  ].join(" ").toLowerCase();

  return cards
    .filter((c) => {
      if (!c.active || c.keys.length === 0) return false;
      if (c.inclusionPolicy === "always") return false;
      return !c.keys.some((k) => corpus.includes(k.toLowerCase()));
    })
    .map((c) => makeRec(
      `det-freq-${c.id}`,
      "delete",
      c,
      "Trigger keys not found anywhere in the story — this entity may be stale or the keys may be wrong.",
      { suggestedContent: "", suggestedKeys: [], editedContent: "", editedKeys: "" },
    ));
}

// ── LLM pass ─────────────────────────────────────────────────────────────────

const BROAD_TRIGGER_WORDS = new Set([
  "a", "an", "any", "he", "her", "hers", "him", "his", "it", "she", "that", "the", "their", "them", "they", "this", "those", "we", "you", "your",
]);

function normalizeTrigger(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

function isBroadTrigger(key: string, card: StoryCard): boolean {
  const norm = normalizeTrigger(key);
  if (!norm || norm === normalizeTrigger(card.title)) return true;
  const tokens = norm.split(/\s+/).filter(Boolean);
  if (BROAD_TRIGGER_WORDS.has(norm) || tokens.every((token) => BROAD_TRIGGER_WORDS.has(token))) return true;
  return tokens.length === 1 && norm.length < 4;
}

function detectTriggerKeyCleanup(cards: StoryCard[]): AuditRecommendation[] {
  return cards
    .filter((card) => card.active)
    .map((card) => {
      const deduped = dedupeStringList(card.keys, normalizeTrigger);
      const suggestedKeys = deduped.values.filter((key) => !isBroadTrigger(key, card));
      const changed =
        suggestedKeys.length !== card.keys.length ||
        suggestedKeys.some((key, index) => key !== card.keys[index]);
      return { card, suggestedKeys, changed, removedCount: card.keys.length - suggestedKeys.length };
    })
    .filter((entry) => entry.changed)
    .map((card) => {
      const rationale = [
        card.removedCount > 0 && "broad, blank, duplicate, or title-equivalent keys were removed",
      ].filter(Boolean).join("; ");
      return makeRec(
        `det-trigger-keys-${card.card.id}`,
        "edit",
        card.card,
        `Trigger cleanup is deterministic: ${rationale || "keys were normalized to remove duplicates"}.`,
        {
          suggestedKeys: card.suggestedKeys,
          editedKeys: card.suggestedKeys.join(", "),
        },
      );
    });
}

function buildPrompt(cards: StoryCard[], rollingSummary: string, recentStory: string): string {
  const cardList = cards
    .map((c) => `[${c.id}] "${c.title}" (${c.type}, ${c.memoryMode}) keys: ${c.keys.join(", ") || "(title trigger only)"}\n${storyCardContextContent(c).slice(0, 2200)}`)
    .join("\n\n---\n\n");

  return `You are cleaning up story cards for an interactive fiction game. Structural issues (redundancy, missing keys, stale entries) have already been flagged - focus on semantic accuracy, consolidation, trigger bleed, living-card updates, profile bloat, and missing historical/living child cards.
${STORY_CARD_BEST_PRACTICES}
${TRIGGER_BEST_PRACTICES}

STORY CARDS UNDER REVIEW:
${cardList || "(none)"}

STORY SO FAR (summary):
${rollingSummary || "(none)"}

RECENT STORY:
${recentStory || "(none)"}

Return ONLY a JSON array — no markdown, no prose. Each item must be one of:
- {"action":"edit","cardId":"...","title":"...","rationale":"...","suggestedContent":"...","suggestedKeys":["..."],"suggestedType":"character"|"location"|"lore"|"plot"|"custom","suggestedMemoryMode":"static"|"living"|"historical"}
- {"action":"delete","cardId":"...","title":"...","rationale":"..."}
- {"action":"create","title":"...","rationale":"...","suggestedContent":"...","suggestedKeys":["..."],"suggestedType":"character"|"location"|"lore"|"plot"|"custom","suggestedMemoryMode":"static"|"living"|"historical"}

Rules:
- Edit: card content is outdated or factually wrong based on recent events
- Delete: card covers something that no longer exists in the story
- Create: a recurring entity or fact has no card at all
- Static character/location/lore cards should hold durable identity/rules only. Do not leave current mission state or completed event timelines inside static profile cards.
- If a static profile card contains current-state or completed-event bullets, return BOTH: an edit for the profile card with those dynamic/history bullets removed, and one or more create recommendations for focused living or historical child cards preserving that information.
- Use suggestedMemoryMode "living" for current evolving subjects, relationships, investigations, arrangements, and pressure.
- Use suggestedMemoryMode "historical" for completed decisions, votes, confrontations, deaths, promises kept/broken, discoveries, or resolved beats.
- Prefer editing or consolidating an existing living card over creating a sibling card for the same evolving subject
- Remove broad character-name triggers from subplot/event/relationship cards when those names already belong to identity cards
- Never use pronouns, articles, or broad words as triggers: The, This, That, She, He, His, Her, They, Any.
- Event, relationship, and subplot cards should use event/place/object/relationship phrases instead of broad character names.
- Historical/completed event cards should be past tense
- Be selective — only changes with clear story justification
- Rationale: one specific sentence
- Return [] if no changes are needed`;
}

const VALID_TYPES = new Set(["character", "location", "lore", "plot", "custom"]);
const VALID_MEMORY_MODES = new Set(["static", "living", "historical"]);

function parseLLMResponse(raw: string): AuditRecommendation[] {
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
    .filter((item) => item.action === "create" || typeof item.cardId === "string")
    .map((item, i) => {
      const suggestedContent =
        typeof item.suggestedContent === "string" ? item.suggestedContent :
        typeof item.content === "string" ? item.content :
        "";
      const suggestedKeys = Array.isArray(item.suggestedKeys)
        ? (item.suggestedKeys as unknown[]).filter((k): k is string => typeof k === "string")
        : Array.isArray(item.keys)
          ? (item.keys as unknown[]).filter((k): k is string => typeof k === "string")
        : [];
      const suggestedTypeRaw = typeof item.suggestedType === "string" ? item.suggestedType : typeof item.type === "string" ? item.type : "";
      const suggestedType = VALID_TYPES.has(suggestedTypeRaw) ? suggestedTypeRaw as StoryCardType : "custom";
      const modeRaw = typeof item.suggestedMemoryMode === "string" ? item.suggestedMemoryMode : typeof item.memoryMode === "string" ? item.memoryMode : "";
      const suggestedMemoryMode = VALID_MEMORY_MODES.has(modeRaw) ? modeRaw as StoryCardMemoryMode : "static";
      return {
        id: `llm-${Date.now()}-${i}`,
        action: item.action as AuditAction,
        source: "llm" as AuditSource,
        cardId: typeof item.cardId === "string" ? item.cardId : undefined,
        title: (item.title as string).trim(),
        rationale: (item.rationale as string).trim(),
        suggestedContent,
        suggestedKeys,
        suggestedType,
        suggestedMemoryMode,
        decision: "pending" as AuditDecision,
        editedContent: suggestedContent,
        editedKeys: suggestedKeys.join(", "),
      };
    });
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runStoryCardAudit(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  nTurns: number,
  options: StoryCardAuditOptions = {},
): Promise<AuditRecommendation[]> {
  const recentMessages = lastNTurns(adventure.messages, nTurns);
  const summary = adventure.rollingSummary.content;

  // Deterministic pass — free, runs first
  const detRedundant = detectRedundant(adventure.storyCards);
  const detNoKeys = detectNoKeys(adventure.storyCards);
  const detTiny = detectTinyContent(adventure.storyCards);
  const detFreq = detectZeroFrequency(adventure.storyCards, recentMessages, summary);
  const detDuplicateLines = detectDuplicateContentLines(adventure.storyCards);
  const detTriggerKeys = detectTriggerKeyCleanup(adventure.storyCards);
  const detRecs = [...detRedundant, ...detNoKeys, ...detTiny, ...detFreq, ...detDuplicateLines, ...detTriggerKeys];

  if (!options.includeAI) return detRecs;

  // Delete recommendations are skipped. Editable issues still go to AI cleanup
  // so it can suggest splits, consolidation, or mode changes.
  const flaggedIds = new Set(detRecs.filter((r) => r.action === "delete").map((r) => r.cardId).filter(Boolean) as string[]);

  // Also skip cards auto-updated within the review window
  const currentTurn = adventure.activeState.turn;
  const llmCards = adventure.storyCards.filter((c) => {
    if (flaggedIds.has(c.id)) return false;
    if (c.lastAutoUpdateTurn !== undefined && currentTurn - c.lastAutoUpdateTurn <= nTurns) return false;
    return true;
  });

  // LLM pass
  let llmRecs: AuditRecommendation[] = [];
  if (llmCards.length > 0) {
    const config = resolvedProviderConfig(adventure, providerConfig);
    const recentStory = formatMessages(recentMessages);
    const prompt = buildPrompt(llmCards, summary, recentStory);

    try {
      const response = await sendOpenAICompatibleChatCompletion({
        config,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Clean up these story cards and return your recommendations as a JSON array." },
        ],
      });
      llmRecs = parseLLMResponse(response.content);
    } catch (err) {
      const issue = backgroundProviderConfigIssue(adventure);
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error([issue, `Story Card cleanup AI pass failed: ${cause}`].filter(Boolean).join(" "));
    }

    // Drop LLM recs for cards already handled deterministically
    llmRecs = llmRecs.filter((r) => !r.cardId || !flaggedIds.has(r.cardId));
  }

  return [...detRecs, ...llmRecs];
}
