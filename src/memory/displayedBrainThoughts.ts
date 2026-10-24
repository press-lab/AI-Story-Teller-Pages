import type { Adventure, Message } from "../types/adventure";
import { suggestionSourceValid } from "./storyCardSuggestions";

/** Optional display layer: never rewrite the evidence snapshot or transcript sent to providers. */
export function displayedBrainThoughts(adventure: Adventure, message: Message) {
  if (message.role !== "assistant") return [];
  const thoughts: string[] = [];
  for (const proposal of adventure.activeState.memoryProposals) {
    if (proposal.status !== "approved" || proposal.proposedType !== "brainUpdate" || proposal.sourceTurnId !== message.id || !suggestionSourceValid(adventure, proposal)) continue;
    const brain = adventure.brains.find(brain => brain.id === proposal.targetId && brain.printThoughts);
    if (!brain) continue;
    try {
      const patch = JSON.parse(proposal.content);
      for (const value of Object.values(patch.thoughts ?? {})) if (typeof value === "string" && value.trim() && !message.content.includes(value)) thoughts.push(`${brain.characterName}: ${value}`);
    } catch { /* Legacy plain-text proposals retain their original rendering. */ }
  }
  return [...new Set(thoughts)];
}
