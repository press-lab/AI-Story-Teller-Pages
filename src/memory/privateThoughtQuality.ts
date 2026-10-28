import type { BrainEntry, BrainPatch } from "../types/adventure";

export const thoughtText = (text: string) => text.replace(/^\s*\d+\s*(?:→|:)\s*/, "");
const key = (text: string) => thoughtText(text).normalize("NFKC").toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Quality suppression only. Evidence/eligibility and patch safety are checked separately.
 * A short quotation inside a substantial private interpretation is allowed. */
export function privateThoughtQualityReason(patch: BrainPatch, evidence: readonly string[], brain: BrainEntry): string | undefined {
  const values = Object.values(patch).flatMap(v => typeof v === "string" ? [v] : Object.values(v ?? {}).filter((s): s is string => typeof s === "string"));
  const prior = [brain.currentState, brain.relationshipPressure, brain.emotionalInterpretation, brain.recentDevelopments, brain.notes,
    ...Object.values(brain.thoughts), ...Object.values(brain.archivedThoughts)].map(key).filter(Boolean);
  const quotes = evidence.flatMap(text => [...text.matchAll(/[“"]([^”"\n]+)[”"]|(?:^|\s)'([^'\n]+)'(?=\s|[.,!?]|$)/g)].map(m => key(m[1] ?? m[2])));
  const sources = evidence.map(key);
  const reasons = values.map(value => {
    const normalized = key(value);
    if (prior.includes(normalized)) return "Private memory duplicates existing Brain content after removing its turn prefix.";
    if (quotes.includes(normalized)) return "Private memory copies spoken dialogue without private interpretation.";
    const words = normalized.split(" ");
    if (words.length < 8) return undefined;
    // Require almost the entire proposal to be a contiguous source passage. No bag-of-words semantic deletion.
    const copied = sources.some(source => {
      for (let start = 0; start <= Math.min(2, words.length - 8); start++) {
        for (let end = words.length; end >= words.length - 2 && end - start >= 8; end--) {
          if ((end - start) / words.length >= 0.88 && (` ${source} `).includes(` ${words.slice(start, end).join(" ")} `)) return true;
        }
      }
      return false;
    });
    return copied ? "Private memory reproduces source text with no substantial private interpretation." : undefined;
  });
  return reasons.length && reasons.every(Boolean) ? reasons[0] : undefined;
}
