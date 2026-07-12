export function normalizeCleanupText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^[-*\u2022]\s*/, "")
    .replace(/[^\p{L}\p{N}'"\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeTextLines(text: string): { text: string; removedCount: number } {
  const seen = new Set<string>();
  const lines: string[] = [];
  let removedCount = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmedRight = line.trimEnd();
    const normalized = normalizeCleanupText(trimmedRight);
    if (normalized) {
      if (seen.has(normalized)) {
        removedCount += 1;
        continue;
      }
      seen.add(normalized);
    }
    lines.push(trimmedRight);
  }

  return { text: lines.join("\n").trim(), removedCount };
}

export function dedupeStringList(
  values: string[],
  normalize: (value: string) => string = normalizeCleanupText,
): { values: string[]; removedCount: number } {
  const seen = new Set<string>();
  const deduped: string[] = [];
  let removedCount = 0;

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalize(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) {
      removedCount += 1;
      continue;
    }
    seen.add(normalized);
    deduped.push(trimmed);
  }

  return { values: deduped, removedCount };
}

export function cleanupWordSet(text: string): Set<string> {
  return new Set(
    normalizeCleanupText(text)
      .split(/\s+/)
      .filter((word) => word.length > 4),
  );
}

export function cleanupContentOverlap(a: string, b: string): number {
  const wordsA = cleanupWordSet(a);
  const wordsB = cleanupWordSet(b);
  if (wordsA.size < 10 || wordsB.size < 10) return 0;
  const intersection = [...wordsA].filter((word) => wordsB.has(word)).length;
  return intersection / Math.min(wordsA.size, wordsB.size);
}

export function compactFirstSentence(text: string, maxWords: number): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const firstSentence = firstLine.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? firstLine;
  return firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ").trim();
}
