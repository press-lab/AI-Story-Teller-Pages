export function approximateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  const normalized = text.replace(/\s+/g, " ").trim();
  const wordEstimate = normalized.split(" ").length * 1.25;
  const characterEstimate = normalized.length / 4;
  return Math.max(1, Math.ceil(Math.max(wordEstimate, characterEstimate)));
}
