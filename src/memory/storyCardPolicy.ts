import type { StoryCard, StoryCardCompactKind, StoryCardCompactStatus } from "../types/adventure";

type StoryCardPolicyInput = Pick<StoryCard, "title" | "content" | "memoryMode"> &
  Partial<Pick<StoryCard,
    | "keys"
    | "state"
    | "archivedFacts"
    | "pinned"
    | "protected"
    | "priority"
    | "tokenBudget"
    | "type"
    | "compactKind"
    | "compactStatus"
    | "coreFacts"
    | "currentFacts"
    | "recentDevelopments"
    | "sourceTurnIds"
    | "inclusionPolicy"
  >>;

export const GUARDED_STORY_CARD_STATE_TAG = "guardedMemory";
export const GUARDED_STORY_CARD_MIN_PRIORITY = 80;
export const GUARDED_STORY_CARD_MIN_TOKEN_BUDGET = 450;
export const DEFAULT_COMPACT_STATUS: StoryCardCompactStatus = "active";

const GUARDED_CARD_TERMS = [
  "alliance",
  "bargain",
  "compact",
  "cover story",
  "deal",
  "official cover",
  "official story",
  "oath",
  "pact",
  "political shield",
  "promise",
  "secret alliance",
  "shield",
  "truce",
  "vow",
];

const GUARDED_FACT_PATTERNS = [
  /\b(alliance|bargain|compact|deal|oath|pact|promise|promised|truce|vow)\b/i,
  /\b(agreed|agreement|condition|conditional|terms?)\b/i,
  /\b(no more killing|self-protection|repent|mentor|mentorship|visit|visits)\b/i,
  /\b(rune(?:-etched)? coin|summon)\b/i,
  /\b(secret|cover story|official cover|official story|political shield|shielded|shielding|shield)\b/i,
  /\b(councilor|stay(?:ing)? on (?:the )?council|remain(?:s|ed|ing)? on (?:the )?council)\b/i,
  /\b(accomplice|fugitive|harboring|reprisal|leash|obligation|debt|blackmail|betrayal)\b/i,
];

function normalizePolicyText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendStateTag(state: string | undefined, tag: string): string {
  const tags = new Set((state ?? "").split(/\s+/).filter(Boolean));
  tags.add(tag);
  return Array.from(tags).join(" ");
}

export function splitStoryCardFacts(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeStoryCardFact(fact: string): string {
  return normalizePolicyText(fact.replace(/^[-*\u2022]\s*/, ""));
}

export function isGuardedStoryCardMemory(card: StoryCardPolicyInput, incomingContent = ""): boolean {
  const titleText = normalizePolicyText([card.title, ...(card.keys ?? [])].join(" "));
  if (GUARDED_CARD_TERMS.some((term) => titleText.includes(term))) return true;

  const bodyText = [card.content, card.archivedFacts, incomingContent, card.state]
    .filter(Boolean)
    .map((value) => normalizePolicyText(value ?? ""))
    .join(" ");
  return GUARDED_FACT_PATTERNS.some((pattern) => pattern.test(bodyText));
}

export function isGuardedStoryCardFact(card: StoryCardPolicyInput, fact: string): boolean {
  if (!isGuardedStoryCardMemory(card)) return false;
  const normalized = normalizePolicyText(fact);
  return GUARDED_FACT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function uniqueFacts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const fact = value?.trim();
    if (!fact) continue;
    const normalized = normalizeStoryCardFact(fact);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(fact);
  }
  return result;
}

function inferredCompactKind(card: StoryCardPolicyInput, incomingContent = ""): StoryCardCompactKind | undefined {
  if (card.compactKind) return card.compactKind;
  if (card.type === "character") return undefined;
  const text = normalizePolicyText([card.title, ...(card.keys ?? []), card.content, card.archivedFacts, incomingContent].filter(Boolean).join(" "));
  if (/\b(cover story|official cover|official story|political shield|shield)\b/.test(text)) return "coverStory";
  if (/\b(pact|compact|deal|bargain|agreement|terms?)\b/.test(text)) return "pact";
  if (/\b(promise|promised|vow|oath)\b/.test(text)) return "promise";
  if (/\btruce\b/.test(text)) return "truce";
  if (/\b(alliance|ally|allies)\b/.test(text)) return "alliance";
  if (/\b(debt|obligation|leash|blackmail|accomplice|fugitive|harboring)\b/.test(text)) return "debt";
  if (/\b(secret)\b/.test(text)) return "secret";
  return undefined;
}

function isProminentCompactStatus(status: StoryCardCompactStatus | undefined): boolean {
  return status === undefined || status === "active" || status === "strained" || status === "broken";
}

/** Fold the former four text fields into the one editable and prompted Content field. */
export function consolidateStoryCardContent<T extends StoryCardPolicyInput>(card: T): T {
  if (!card.coreFacts?.length && !card.currentFacts?.length && !card.recentDevelopments?.length) return card;
  const facts = uniqueFacts([
    ...(card.coreFacts ?? []),
    ...(card.currentFacts ?? []),
    ...(card.recentDevelopments ?? []),
    ...splitStoryCardFacts(card.content),
  ]);
  return { ...card, content: facts.join("\n"), coreFacts: [], currentFacts: [], recentDevelopments: [] };
}

export function applyGuardedStoryCardPolicy<T extends StoryCardPolicyInput>(card: T): T {
  const unified = consolidateStoryCardContent(card);
  const compactKind = inferredCompactKind(unified);
  if (!compactKind) return unified;
  const compactStatus = card.compactStatus ?? DEFAULT_COMPACT_STATUS;
  const prominent = isProminentCompactStatus(compactStatus);
  const tokenBudget = card.tokenBudget && card.tokenBudget > 0
    ? card.tokenBudget
    : GUARDED_STORY_CARD_MIN_TOKEN_BUDGET;
  return {
    ...unified,
    compactKind,
    compactStatus,
    // Guarding facts against loss must not force a subplot into every scene.
    // Preserve explicit/saved pins, including an explicit user unpin.
    pinned: card.pinned ?? false,
    priority: prominent ? Math.max(card.priority ?? 0, GUARDED_STORY_CARD_MIN_PRIORITY) : (card.priority ?? 0),
    tokenBudget,
    state: appendStateTag(card.state, GUARDED_STORY_CARD_STATE_TAG),
  };
}

export function restoreGuardedFactsToLiveContent<T extends StoryCardPolicyInput>(card: T): T {
  if (!isGuardedStoryCardMemory(card) || !card.archivedFacts?.trim()) return card;

  const seen = new Set<string>();
  const orderedFacts = [
    ...splitStoryCardFacts(card.archivedFacts).filter((fact) => isGuardedStoryCardFact(card, fact)),
    ...splitStoryCardFacts(card.content),
  ].filter((fact) => {
    const normalized = normalizeStoryCardFact(fact);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return { ...card, content: orderedFacts.join("\n") };
}

export function appendSourceTurnIds(existing: string[] | undefined, sourceTurnId?: string): string[] | undefined {
  if (!sourceTurnId) return existing;
  return Array.from(new Set([...(existing ?? []), sourceTurnId]));
}

export function storyCardContextContent(card: StoryCard): string {
  return consolidateStoryCardContent(card).content;
}
