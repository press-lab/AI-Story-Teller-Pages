import type { Adventure, MemoryProposalType, StoryCard, StoryCardMemoryMode } from "../types/adventure";
import { isGuardedStoryCardMemory } from "./storyCardPolicy";

export interface MemoryTargetDraft {
  proposedType: MemoryProposalType;
  title: string;
  content: string;
  sourceText?: string;
  suggestedTriggers?: string[];
  targetId?: string;
  appendContent?: boolean;
  memoryMode?: StoryCardMemoryMode;
  category?: string;
  rationale?: string;
}

export interface MemoryTargetResolution {
  proposedType: MemoryProposalType;
  title: string;
  content: string;
  suggestedTriggers: string[];
  targetId?: string;
  appendContent?: boolean;
  memoryMode?: StoryCardMemoryMode;
  rationale?: string;
}

const TOKEN_STOPWORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "before", "being", "between", "card",
  "current", "during", "from", "has", "have", "into", "its", "new", "now", "official", "only", "that",
  "the", "their", "them", "this", "through", "turn", "under", "was", "were", "with", "without",
  "any", "he", "her", "hers", "him", "his", "it", "she", "they", "we", "you", "your",
  "a", "an", "to", "of", "for", "i", "me", "my", "our", "us",
]);

const GENERIC_TRIGGER_WORDS = new Set([
  "agency", "case", "current scene", "current status",
  "active", "currently", "connection", "date", "event", "facts", "missing", "mutual interest", "now",
  "mission", "official", "relationship", "romantic", "scene", "search", "specialists", "status", "team",
  "termination", "the agency", "the case", "the mission", "the search", "the team",
]);

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

export function isLivingStoryCard(card: Pick<StoryCard, "memoryMode" | "state">): boolean {
  return card.memoryMode === "living" || (card.state ?? "").split(/\s+/).includes("living");
}

function isHistoricalStoryCard(card: Pick<StoryCard, "memoryMode">): boolean {
  return card.memoryMode === "historical";
}

export function inferStoryCardMemoryMode(draft: Pick<MemoryTargetDraft, "title" | "content" | "sourceText" | "category" | "memoryMode">): StoryCardMemoryMode {
  if (draft.memoryMode) return draft.memoryMode;
  const text = normalize([draft.title, draft.content, draft.sourceText].filter(Boolean).join(" "));
  if (isGuardedStoryCardMemory({ title: draft.title, content: [draft.content, draft.sourceText].filter(Boolean).join("\n"), memoryMode: "living" })) {
    return "living";
  }
  if (draft.category === "plot_beat") return "historical";
  if (draft.category === "relationship" || draft.category === "status_change") return "living";
  if (draft.category === "character_reveal" || draft.category === "world_fact") return "static";
  if (/\b(currently|right now|actively|ongoing|periodic|maintenance|retainer|requires?|mandated|monitoring|searching|hunting)\b/.test(text)) {
    return "living";
  }
  if (/\b(escaped|stole|sold|agreed|revealed|confirmed|completed|defeated|rescued|sealed|concluded|first worked|first time)\b/.test(text)) {
    return "historical";
  }
  return "static";
}

function targetAcceptsMode(card: StoryCard, inferredMode: StoryCardMemoryMode): boolean {
  if (isLivingStoryCard(card)) return inferredMode === "living";
  if (isHistoricalStoryCard(card)) return inferredMode === "historical";
  return inferredMode === "static";
}

function guardedExactTitleTarget(card: StoryCard, draft: MemoryTargetDraft): boolean {
  return card.type !== "character" &&
    normalize(card.title) === normalize(draft.title) &&
    isGuardedStoryCardMemory(
      {
        ...card,
        content: [card.content, draft.content, draft.sourceText].filter(Boolean).join("\n"),
      },
    );
}

function exactStoryCardTarget(adventure: Adventure, draft: MemoryTargetDraft, inferredMode: StoryCardMemoryMode): StoryCard | undefined {
  if (draft.targetId) {
    const target = adventure.storyCards.find((card) => card.id === draft.targetId);
    if (target && guardedExactTitleTarget(target, draft)) return target;
    if (target && targetAcceptsMode(target, inferredMode)) return target;
    return undefined;
  }
  const titleNorm = normalize(draft.title);
  const exactTitle = adventure.storyCards.find((card) => card.active && normalize(card.title) === titleNorm);
  if (exactTitle && guardedExactTitleTarget(exactTitle, draft)) return exactTitle;
  if (
    exactTitle &&
    targetAcceptsMode(exactTitle, inferredMode)
  ) {
    return exactTitle;
  }
  return adventure.storyCards.find((card) =>
    card.active &&
    card.type !== "character" &&
    targetAcceptsMode(card, inferredMode) &&
    card.keys.some((key) => normalize(key) === titleNorm)
  );
}

function incompatibleTarget(adventure: Adventure, draft: MemoryTargetDraft, inferredMode: StoryCardMemoryMode): StoryCard | undefined {
  const target = draft.targetId ? adventure.storyCards.find((card) => card.id === draft.targetId) : undefined;
  if (target && guardedExactTitleTarget(target, draft)) return undefined;
  if (target && !targetAcceptsMode(target, inferredMode)) return target;
  const exactTitle = adventure.storyCards.find((card) => card.active && normalize(card.title) === normalize(draft.title));
  if (exactTitle && guardedExactTitleTarget(exactTitle, draft)) return undefined;
  return exactTitle && !targetAcceptsMode(exactTitle, inferredMode) ? exactTitle : undefined;
}

function childTitleFor(target: StoryCard, draft: MemoryTargetDraft, inferredMode: StoryCardMemoryMode): string {
  const draftTitle = draft.title.trim();
  if (draftTitle && normalize(draftTitle) !== normalize(target.title)) return draftTitle;
  if (inferredMode === "historical") return `${target.title}: History`;
  if (draft.category === "relationship") return `${target.title}: Relationship Status`;
  return `${target.title}: Current Status`;
}

type TriggerContext = { storyCards: Array<Pick<StoryCard, "id" | "title" | "type" | "keys">> };

function triggerBelongsToCharacterCard(adventure: TriggerContext, normalizedTrigger: string, targetId?: string): boolean {
  return adventure.storyCards.some((card) => {
    if (card.id === targetId || card.type !== "character") return false;
    return [card.title, ...card.keys].some((key) => normalize(key) === normalizedTrigger);
  });
}

function isWeakTrigger(norm: string): boolean {
  if (!norm) return true;
  if (TOKEN_STOPWORDS.has(norm) || GENERIC_TRIGGER_WORDS.has(norm)) return true;
  const tokens = norm.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.every((token) => TOKEN_STOPWORDS.has(token))) return true;
  return tokens.length === 1 && norm.length < 4;
}

export function sanitizeStoryCardTriggers(
  adventure: TriggerContext,
  title: string,
  triggers: string[] | undefined,
  targetId?: string,
  memoryMode?: StoryCardMemoryMode,
  content = "",
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of triggers ?? []) {
    const clean = raw.trim().replace(/^(?:the|an?)\s+/i, "");
    if (!clean) continue;
    const norm = normalize(clean);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    const shortName = norm === normalize(title) && norm.length >= 2 && /^\p{Lu}/u.test(clean)
      && !TOKEN_STOPWORDS.has(norm) && !GENERIC_TRIGGER_WORDS.has(norm);
    if (isWeakTrigger(norm) && !shortName) continue;
    if (norm.split(/\s+/).length > 6) continue;
    if ((memoryMode === "living" || memoryMode === "historical") && triggerBelongsToCharacterCard(adventure, norm, targetId)
      && !(norm.includes(" ") && normalize(content).includes(norm))) continue;
    seen.add(norm);
    result.push(clean);
    if (result.length >= 6) break;
  }
  return result;
}

const PHRASE_BREAKS = new Set(("a an to of for on at by in as or but than then when where while who which what and is are was were be been being "
  + "i me my our us it its this that these those his her their your we you he she they "
  + "can could may might must should would will do does did has have had not no never now already later "
  + "says said tells told asks asked agrees agreed accepts accepted confirms confirmed promises promised reveals revealed discovers discovered "
  + "learns learned knows knew wants wanted needs needed becomes became remains remained gives gave gets got makes made uses used "
  + "develops developed creates created establishes established tests tested proves proved finds found recovers recovered studies studied signs signed supports supported recognizes recognized offers offered "
  + "before after during until since from with without through into over under between about also only still "
  + "first new current ongoing completed historical history status event events development developments candidate interpretation unconfirmed "
  + "one two three four five six seven eight nine ten twenty thirty percent").split(/\s+/));

/** No extra model call: recover short, reusable topic phrases only from the card's own text. */
export function generatedStoryCardTriggers(
  adventure: TriggerContext, title: string, content: string, triggers?: string[], targetId?: string,
  memoryMode?: StoryCardMemoryMode, type?: StoryCard["type"],
): string[] {
  const supplied = sanitizeStoryCardTriggers(adventure, title, triggers, targetId, memoryMode, content);
  if (type === "character") return sanitizeStoryCardTriggers(adventure, title, [title, ...supplied], targetId, "static", content);
  if (supplied.length) return supplied;
  let text = `${title}\n${content.split(/VOICE CONTRACT/i)[0]}`.replace(/['’]s\b/gu, "");
  // Names alone recall identity cards. Keep the topic of Lore rather than a participant's name.
  for (const card of adventure.storyCards.filter(card => card.type === "character" && card.id !== targetId)) {
    for (const name of [card.title, ...card.keys.filter(key => /^\p{Lu}/u.test(key))]) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (escaped) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:['’]s)?(?![\\p{L}\\p{N}])`, "giu"), "\n");
    }
  }
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const token of text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}\t ]+/gu) ?? []) {
    if (!/\p{L}/u.test(token) || PHRASE_BREAKS.has(token.toLocaleLowerCase())) {
      if (chunk.length) chunks.push(chunk);
      chunk = [];
    } else chunk.push(token);
  }
  if (chunk.length) chunks.push(chunk);
  // Bigrams match ordinary future mentions more readily than an exact scene sentence.
  const phrases = chunks.flatMap(words => words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`));
  const candidates = [...phrases, ...chunks.filter(words => words.length === 1).flat()];
  return sanitizeStoryCardTriggers(adventure, title, candidates, targetId, memoryMode, content);
}

export function resolveMemoryTarget(adventure: Adventure, draft: MemoryTargetDraft): MemoryTargetResolution {
  if (draft.proposedType !== "storyCard") {
    return {
      proposedType: draft.proposedType,
      title: draft.title,
      content: draft.content,
      suggestedTriggers: draft.suggestedTriggers ?? [],
      targetId: draft.targetId,
      appendContent: draft.appendContent,
      memoryMode: draft.memoryMode,
      rationale: draft.rationale,
    };
  }

  const requestedTarget = draft.targetId ? adventure.storyCards.find((card) => card.id === draft.targetId) : undefined;
  const inferredMode = draft.memoryMode ?? requestedTarget?.memoryMode ?? inferStoryCardMemoryMode(draft);
  const blockedTarget = incompatibleTarget(adventure, draft, inferredMode);
  const target = exactStoryCardTarget(adventure, draft, inferredMode);
  const targetMode = target ? (isLivingStoryCard(target) ? "living" : target.memoryMode) : undefined;
  const memoryMode = target ? (targetMode ?? inferredMode) : inferredMode;
  const appendContent = target ? (draft.appendContent ?? true) : undefined;
  const title = target?.title ?? (blockedTarget ? childTitleFor(blockedTarget, draft, inferredMode) : draft.title);
  const suggestedTriggers = generatedStoryCardTriggers(adventure, title, draft.content, draft.suggestedTriggers, target?.id, memoryMode);
  const rationale = [
    draft.rationale,
    target && !draft.targetId ? `Routed to existing ${memoryMode} Story Card "${target.title}".` : undefined,
    blockedTarget ? `Created a separate ${memoryMode} Story Card instead of appending ${memoryMode} facts to static "${blockedTarget.title}".` : undefined,
  ].filter(Boolean).join(" ") || undefined;

  return {
    proposedType: "storyCard",
    title,
    content: draft.content,
    suggestedTriggers,
    targetId: target?.id,
    appendContent,
    memoryMode,
    rationale,
  };
}
