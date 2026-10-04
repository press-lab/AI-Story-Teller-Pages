function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

export function normalizeThoughtForDedupe(value: string): string {
  return normalizeQuotes(value)
    .normalize("NFKC")
    .replace(/^\s*\d+\s*(?:\u2192|->|=>|:|-)\s*/u, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'"\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeThoughtRecord(
  record: Record<string, string>,
  seed: Iterable<string> = [],
): Record<string, string> {
  const seen = new Set(
    [...seed]
      .map((value) => normalizeThoughtForDedupe(value))
      .filter(Boolean),
  );
  const kept: [string, string][] = [];
  for (const [key, value] of Object.entries(record).reverse()) {
    if (typeof value !== "string") continue;
    const normalized = normalizeThoughtForDedupe(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    kept.push([key, value]);
  }
  return Object.fromEntries(kept.reverse());
}

/**
 * Drop sentences (5+ words) that an existing thought already contains, so a character's stock
 * line ("I keep saying yes and meaning it") is not re-recorded every turn. Returns "" when too
 * little new remains to count as a new reaction.
 */
export function stripRepeatedThoughtLines(thought: string, existingThoughts: string[]): string {
  const known = existingThoughts.map(normalizeThoughtForDedupe);
  const sentences = thought.match(/[^.!?]+[.!?]*/g) ?? [thought];
  const kept = sentences.filter((sentence) => {
    const line = normalizeThoughtForDedupe(sentence);
    return line.split(" ").length < 5 || !known.some((existing) => existing.includes(line));
  });
  const result = kept.join("").trim();
  return result.split(/\s+/).filter(Boolean).length >= 6 ? result : "";
}

export function dedupeBrainThoughts(
  thoughts: Record<string, string>,
  archivedThoughts: Record<string, string>,
): { thoughts: Record<string, string>; archivedThoughts: Record<string, string> } {
  const dedupedThoughts = dedupeThoughtRecord(thoughts);
  const dedupedArchivedThoughts = dedupeThoughtRecord(archivedThoughts, Object.values(dedupedThoughts));
  return { thoughts: dedupedThoughts, archivedThoughts: dedupedArchivedThoughts };
}
