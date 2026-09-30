import type { Adventure, MemoryProposalType, StoryCard, StoryCardMemoryMode } from "../types/adventure";
import { isFirstPersonRecallTrigger, isGuardedStoryCardMemory } from "./storyCardPolicy";

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

function triggerBelongsToOtherCard(adventure: Adventure, normalizedTrigger: string, targetId?: string): boolean {
  return adventure.storyCards.some((card) => {
    if (card.id === targetId) return false;
    return [card.title, ...card.keys].some((key) => normalize(key) === normalizedTrigger);
  });
}

function triggerBelongsToCharacterCard(adventure: Adventure, normalizedTrigger: string, targetId?: string): boolean {
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
  adventure: Adventure,
  title: string,
  triggers: string[] | undefined,
  targetId?: string,
  memoryMode?: StoryCardMemoryMode,
): string[] {
  const titleNorm = normalize(title);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of triggers ?? []) {
    const clean = raw.trim();
    if (!clean) continue;
    const norm = normalize(clean);
    if (!norm || norm === titleNorm) continue;
    if (seen.has(norm)) continue;
    if (isWeakTrigger(norm)) continue;
    // Recall phrasings never appear in narration; event memories keep them as recall cues instead.
    if (memoryMode !== "historical" && isFirstPersonRecallTrigger(clean)) continue;
    if ((memoryMode === "living" || memoryMode === "historical") && triggerBelongsToCharacterCard(adventure, norm, targetId)) continue;
    if (triggerBelongsToOtherCard(adventure, norm, targetId)) continue;
    seen.add(norm);
    result.push(clean);
    if (result.length >= 5) break;
  }
  return result;
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
  const suggestedTriggers = sanitizeStoryCardTriggers(adventure, title, draft.suggestedTriggers, target?.id, memoryMode);
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
