import type { TriggerMatchType } from "../types/adventure";

export interface MatchResult {
  matched: boolean;
  pattern?: string;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase();
}

function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchPatterns(text: string, patterns: string[], matchType: TriggerMatchType = "keyword"): MatchResult {
  const cleanPatterns = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  if (cleanPatterns.length === 0) return { matched: false };

  const normalizedText = normalize(text);
  for (const pattern of cleanPatterns) {
    if (matchType === "regex") {
      try {
        if (new RegExp(pattern, "i").test(text)) return { matched: true, pattern };
      } catch {
        continue;
      }
    }

    if (matchType === "phrase") {
      if (normalizedText.includes(normalize(pattern))) return { matched: true, pattern };
    }

    if (matchType === "keyword") {
      const regex = new RegExp(`(^|\\W)${escapeRegExp(pattern)}($|\\W)`, "i");
      if (regex.test(text)) return { matched: true, pattern };
    }
  }

  return { matched: false };
}

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
