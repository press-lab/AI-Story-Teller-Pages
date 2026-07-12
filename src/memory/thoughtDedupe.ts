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

export function dedupeBrainThoughts(
  thoughts: Record<string, string>,
  archivedThoughts: Record<string, string>,
): { thoughts: Record<string, string>; archivedThoughts: Record<string, string> } {
  const dedupedThoughts = dedupeThoughtRecord(thoughts);
  const dedupedArchivedThoughts = dedupeThoughtRecord(archivedThoughts, Object.values(dedupedThoughts));
  return { thoughts: dedupedThoughts, archivedThoughts: dedupedArchivedThoughts };
}
