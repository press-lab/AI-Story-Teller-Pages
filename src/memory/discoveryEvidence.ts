import type { Adventure } from "../types/adventure";

/** Local retrieval only: these excerpts are candidates for AI review, never facts or proposals. */
export function overlookedCharacterEvidence(adventure: Adventure, recentCount: number): string[] {
  const known = new Set([
    ...adventure.storyCards.flatMap(card => [card.title, ...card.keys]),
    ...adventure.activeState.memoryProposals.filter(p => p.proposedType === "storyCard").map(p => p.title),
  ].flatMap(text => text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []));
  const common = new Set("The This That Then There They Their You Your Yes No What When Where Why How Behind Below Above Outside Inside Open Everyone Which Shall Good Fine Now After Before Meanwhile Lord Lady Captain Earth Planet Saiyan SDN Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split(" "));
  const stories = adventure.messages.filter(message => message.role === "assistant");
  const counts = new Map<string, number>();
  for (const message of stories) {
    // Repetition across messages is a retrieval hint, not proof of a durable character.
    for (const name of new Set(message.content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])) {
      if (!known.has(name) && !common.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const recentText = adventure.messages.slice(-recentCount).map(m => m.content).join("\n");
  const names = [...counts].filter(([name, count]) => count >= 2 && !new RegExp(`\\b${name}\\b`).test(recentText))
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const excerpts: string[] = [];
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\b`);
    const paragraph = adventure.messages.slice(0, -recentCount).filter(m => m.role === "assistant")
      .flatMap(m => m.content.split(/\n\s*\n/)).find(text => pattern.test(text));
    if (paragraph && !excerpts.includes(paragraph.slice(0, 500))) excerpts.push(paragraph.slice(0, 500));
  }
  return excerpts;
}
