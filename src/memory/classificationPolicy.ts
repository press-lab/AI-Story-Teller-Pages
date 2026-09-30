import type { MemoryProposalType } from "../types/adventure";

export interface MemoryClassificationOptions {
  important?: boolean;
  recurring?: boolean;
  immediateAlwaysOn?: boolean;
  characterName?: string;
  existingBrainNames?: string[];
  existingStoryCards?: Array<{ id: string; title: string; keys: string[] }>;
}

export interface MemoryClassification {
  proposedType: MemoryProposalType;
  title: string;
  content: string;
  suggestedTriggers: string[];
  confidence: number;
  rationale: string;
  targetId?: string;
}

function titleFromText(text: string): string {
  const named = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  return named?.[1] ?? text.slice(0, 48);
}

const STOP_WORDS = new Set(["The", "A", "An", "He", "She", "They", "It", "We", "You", "Your", "His", "Her", "Their", "This", "That", "These", "Those", "My", "Our", "Its", "I"]);

function triggersFromText(text: string): string[] {
  const quoted = [...text.matchAll(/[""']([^""']{2,40})[""']/g)].map((match) => match[1]);
  const names = [...text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g)]
    .map((match) => match[0])
    .filter((word) => !STOP_WORDS.has(word));
  return Array.from(new Set([...names, ...quoted])).slice(0, 6);
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function hasExistingBrain(options: MemoryClassificationOptions, title: string): boolean {
  const expected = normalized(options.characterName ?? title);
  return (options.existingBrainNames ?? []).some((name) => normalized(name) === expected);
}

function matchingStoryCard(options: MemoryClassificationOptions, text: string): { id: string; title: string; keys: string[] } | undefined {
  const lower = text.toLocaleLowerCase();
  return (options.existingStoryCards ?? []).find((card) =>
    [card.title, ...card.keys].some((key) => key.trim() && lower.includes(key.toLocaleLowerCase())),
  );
}

export function classifyMemory(text: string, options: MemoryClassificationOptions = {}): MemoryClassification {
  const clean = text.trim();
  const lower = clean.toLocaleLowerCase();
  const title = options.characterName ?? titleFromText(clean);
  const suggestedTriggers = triggersFromText(clean);

  const ephemeral = containsAny(lower, [
    /\bwalked?\s+to\b/,
    /\bmoved?\s+to\b/,
    /\bhallway\b/,
    /\belevator\b/,
    /\bfurniture\b/,
    /\bcouch\b/,
    /\bsofa\b/,
    /\bwest wall\b/,
    /\broom layout\b/,
  ]);

  if (ephemeral && !options.important && !options.recurring) {
    return {
      proposedType: "ignore",
      title,
      content: clean,
      suggestedTriggers,
      confidence: 0.86,
      rationale: "Ephemeral movement, room layout, or throwaway scene detail without an important or recurring marker.",
    };
  }

  if (
    containsAny(lower, [
      /\bfeels?\b/,
      /\bjealous\b/,
      /\bhides?\s+it\b/,
      /\bafraid\b/,
      /\bresent\b/,
      /\binternal\b/,
      /\bemotional\b/,
    ])
  ) {
    if (!hasExistingBrain(options, title)) {
      const target = matchingStoryCard(options, clean);
      const durableFallback = options.important || options.recurring || Boolean(target);
      return {
        proposedType: durableFallback ? "storyCard" : "ignore",
        title,
        content: durableFallback ? "" : clean,
        suggestedTriggers,
        confidence: durableFallback ? 0.66 : 0.7,
        rationale: durableFallback
          ? "No existing BrainEntry for this character; routed to Story Card instead of Brain."
          : "No existing BrainEntry for this character, and the detail looks temporary rather than durable.",
        targetId: target?.id,
      };
    }
    return {
      proposedType: "brainUpdate",
      title,
      content: clean,
      suggestedTriggers,
      confidence: 0.82,
      rationale: "Character-specific evolving internal or emotional state belongs in a Brain entry.",
    };
  }

  if (options.immediateAlwaysOn || containsAny(lower, [/\btonight\b/, /\bcurrently\b/, /\bright now\b/, /\bactively hunting\b/])) {
    return {
      proposedType: "plotEssentialsUpdate",
      title,
      content: clean,
      suggestedTriggers,
      confidence: 0.78,
      rationale: "Immediate current-state constraint should be visible as Plot Essentials while it is active.",
    };
  }

  if (
    containsAny(lower, [
      /\bprivate joke\b/,
      /\bnickname\b/,
      /\bcalls?\b.*[“”']/,
      /\bpromis(?:e|ed|es|ing)\b/,
      /\boath\b/,
      /\bsecret\b/,
      /\bengaged\b/,
      /\bmarried\b/,
      /\bcannot\b/,
      /\bcan't\b/,
      /\bmagic\b/,
      /\bwarded\b/,
      /\bnamed object\b/,
      /\brecurring\b/,
    ]) ||
    options.recurring ||
    options.important
  ) {
    const target = matchingStoryCard(options, clean);
    return {
      proposedType: "storyCard",
      title: target?.title ?? title,
      content: "",
      suggestedTriggers,
      confidence: 0.84,
      rationale: target
        ? "Durable character fact routed to an existing Story Card."
        : "Durable recurring facts, relationship facts, rules, promises, secrets, nicknames, and important named objects belong in Story Cards.",
      targetId: target?.id,
    };
  }

  return {
    proposedType: "ignore",
    title,
    content: clean,
    suggestedTriggers,
    confidence: 0.58,
    rationale: "No durable memory signal was detected.",
  };
}
