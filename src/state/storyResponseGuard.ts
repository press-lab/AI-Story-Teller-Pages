import type { ChatMessage } from "../types/adventure";

const PLAYER_ACTION_VERBS = [
  "accept",
  "agree",
  "answer",
  "ask",
  "decide",
  "draw",
  "feel",
  "follow",
  "glance",
  "grab",
  "let",
  "look",
  "make",
  "move",
  "nod",
  "pivot",
  "press",
  "promise",
  "pull",
  "push",
  "reach",
  "refuse",
  "say",
  "shake",
  "step",
  "take",
  "tell",
  "think",
  "turn",
  "walk",
];

const PLAYER_ACTION_RE_GLOBAL = new RegExp(`\\byou\\s+(?:${PLAYER_ACTION_VERBS.join("|")})\\b`, "gi");

export interface StoryResponseGuardResult {
  visibleWordCount: number;
  visibleWordLimit: number;
  overWordLimit: boolean;
  playerAgencyViolation: boolean;
  needsCorrection: boolean;
  reasons: string[];
}

export function storyResponseWordLimit(hint: number): number {
  return Number.isFinite(hint) ? Math.max(50, Math.min(500, Math.round(hint))) : 250;
}

function stripHiddenTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thought[^>]*>[\s\S]*?<\/thought>/gi, "")
    .replace(/<memory\b[^>]*>/gi, "")
    .replace(/<thought[\s\S]*$/gi, "")
    .replace(/<memory\b[\s\S]*$/gi, "");
}

function stripQuotedText(text: string): string {
  return text
    .replace(/"[^"]*"/g, "")
    .replace(/'[^']*'/g, "");
}

export function visibleWordCount(text: string): number {
  const visible = stripHiddenTags(text);
  return visible.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g)?.length ?? 0;
}

function playerActionPhrases(text: string): string[] {
  const stripped = stripQuotedText(stripHiddenTags(text));
  return [...stripped.matchAll(PLAYER_ACTION_RE_GLOBAL)].map((match) => match[0].toLowerCase());
}

export function hasPlayerAgencyViolation(text: string, playerInput = ""): boolean {
  const playerAuthoredActions = new Set(playerActionPhrases(playerInput));
  return playerActionPhrases(text).some((phrase) => !playerAuthoredActions.has(phrase));
}

export function evaluateStoryResponseGuard(text: string, hint: number, playerInput = ""): StoryResponseGuardResult {
  const visibleWordLimit = storyResponseWordLimit(hint);
  const visibleWords = visibleWordCount(text);
  const overWordLimit = visibleWords > visibleWordLimit;
  const playerAgencyViolation = hasPlayerAgencyViolation(text, playerInput);
  const reasons = [
    overWordLimit ? `visible response is ${visibleWords} words over the ${visibleWordLimit}-word limit` : undefined,
    playerAgencyViolation ? "response appears to narrate unspoken player action" : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    visibleWordCount: visibleWords,
    visibleWordLimit,
    overWordLimit,
    playerAgencyViolation,
    needsCorrection: reasons.length > 0,
    reasons,
  };
}

export function buildStoryResponseCorrectionMessages({
  playerInput,
  draft,
  wordLimit,
  reasons,
}: {
  playerInput: string;
  draft: string;
  wordLimit: number;
  reasons: string[];
}): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        `You are a strict rewrite pass for AI Story Teller. Return only the corrected visible story response.\n` +
        `Hard limit: ${wordLimit} words maximum.\n` +
        `Fix these violations: ${reasons.join("; ") || "turn scope"}.\n` +
        `Do not add new events, new plans, new locations, or extra consequences. Preserve only the earliest playable beat from the draft.\n` +
        `Do not narrate the player's unspoken actions, reactions, dialogue, consent, movement, decisions, acceptance, or internal conclusions.\n` +
        `NPCs and the world may react. Stop as soon as the player can reasonably answer, interrupt, refuse, choose, or redirect.\n` +
        `Do not include OOC commentary, explanations, word counts, option menus, <thought> tags, or <memory> tags.`,
    },
    {
      role: "user",
      content: `Player input for this turn:\n${playerInput || "(none; continue request)"}\n\nDraft to correct:\n${draft}`,
    },
  ];
}
