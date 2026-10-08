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

const CURRENT_FACT_PATTERN = /\b(currently|now|still|remains?|ongoing|active|officially|has filed|is using|is repairing|is conducting)\b/i;

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

function partitionCompactFacts(card: StoryCardPolicyInput): Pick<StoryCard, "coreFacts" | "currentFacts" | "recentDevelopments" | "content"> {
  const archivedFacts = splitStoryCardFacts(card.archivedFacts ?? "");
  const contentFacts = splitStoryCardFacts(card.content);
  const core: string[] = [...(card.coreFacts ?? [])];
  const current: string[] = [...(card.currentFacts ?? [])];
  const recent: string[] = [...(card.recentDevelopments ?? [])];
  const content: string[] = [];

  for (const fact of [...archivedFacts, ...contentFacts]) {
    if (isGuardedStoryCardFact(card, fact)) {
      core.push(fact);
    } else if (CURRENT_FACT_PATTERN.test(fact)) {
      current.push(fact);
    } else {
      recent.push(fact);
    }
  }

  return {
    coreFacts: uniqueFacts(core),
    currentFacts: uniqueFacts(current),
    recentDevelopments: uniqueFacts(recent),
    content: uniqueFacts(content).join("\n"),
  };
}

export function applyGuardedStoryCardPolicy<T extends StoryCardPolicyInput>(card: T): T {
  const compactKind = inferredCompactKind(card);
  if (!compactKind) return card;
  const compactStatus = card.compactStatus ?? DEFAULT_COMPACT_STATUS;
  const prominent = isProminentCompactStatus(compactStatus);
  const tokenBudget = card.tokenBudget && card.tokenBudget > 0
    ? card.tokenBudget
    : GUARDED_STORY_CARD_MIN_TOKEN_BUDGET;
  const compactFacts = partitionCompactFacts({ ...card, compactKind, compactStatus });
  return {
    ...card,
    ...compactFacts,
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

/** Keep a character's existing profile in the same editable card, outside the
 * rolling additions budget. Recover only recognizable archived profiles; do not
 * promote arbitrary historical events or superseded assertions into current canon.
 */
export function retainCharacterFoundation(card: StoryCard): StoryCard {
  if (card.type !== "character" || card.memoryMode !== "living" || card.coreFacts?.length) return card;
  const archived = splitStoryCardFacts(card.archivedFacts ?? "");
  const history = card.memoryUpdateHistory ?? [];
  const lastReplacement = history.map(h => h.operation).lastIndexOf("replace");
  const original = history.slice(lastReplacement + 1).find(h => h.operation === "append" && h.previous)?.previous?.content;
  const originalFacts = splitStoryCardFacts(original ?? "");
  const archivedSet = new Set(archived.map(normalizeStoryCardFact));
  const liveSet = new Set(splitStoryCardFacts(card.content).map(normalizeStoryCardFact));
  const recoverable = originalFacts.some(f => archivedSet.has(normalizeStoryCardFact(f))) && originalFacts.every(f => archivedSet.has(normalizeStoryCardFact(f)) || liveSet.has(normalizeStoryCardFact(f)))
    ? originalFacts
    : archived.filter(f => /\bVOICE\s*(?:CONTRACT|\/BEHAVIOR)\s*:/i.test(f));
  const foundation = recoverable.length ? recoverable : splitStoryCardFacts(card.content);
  const core = new Set(foundation.map(normalizeStoryCardFact));
  return {
    ...card,
    coreFacts: foundation,
    content: splitStoryCardFacts(card.content).filter(f => !core.has(normalizeStoryCardFact(f))).join("\n"),
    archivedFacts: archived.filter(f => !core.has(normalizeStoryCardFact(f))).join("\n"),
  };
}

export function storyCardContextContent(card: StoryCard): string {
  const hasStructuredFacts =
    (card.coreFacts?.length ?? 0) > 0 ||
    (card.currentFacts?.length ?? 0) > 0 ||
    (card.recentDevelopments?.length ?? 0) > 0;
  if (!hasStructuredFacts) {
    return card.content;
  }

  const sections: string[] = [
    card.type === "character" ? "Character profile:" : `Compact: ${card.compactKind ?? "unspecified"} (${card.compactStatus ?? DEFAULT_COMPACT_STATUS})`,
  ];
  if (card.coreFacts?.length) sections.push(["Core facts:", ...card.coreFacts.map((fact) => `- ${fact.replace(/^[-*\u2022]\s*/, "")}`)].join("\n"));
  if (card.currentFacts?.length) sections.push(["Current facts:", ...card.currentFacts.map((fact) => `- ${fact.replace(/^[-*\u2022]\s*/, "")}`)].join("\n"));
  if (card.recentDevelopments?.length) sections.push(["Recent developments:", ...card.recentDevelopments.map((fact) => `- ${fact.replace(/^[-*\u2022]\s*/, "")}`)].join("\n"));
  if (card.content.trim()) sections.push(`Notes:\n${card.content}`);
  return sections.join("\n\n");
}
