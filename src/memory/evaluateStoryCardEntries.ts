import type { Adventure, AdventureAction, ProviderConfig } from "../types/adventure";
import { adventureReducer } from "../state/adventureReducer";
import { runCompactMemoryFallback } from "./compactMemoryFallback";

/** Explicit on-demand work: one bounded background request, no narration or Brain writes. */
export async function evaluateStoryCardEntries(adventure: Adventure, config: ProviderConfig, sourceIds: string[]) {
  const ids = [...new Set(sourceIds)];
  if (!ids.length || ids.length > 10) throw new Error("Select between one and ten completed narrator entries.");
  const sources = adventure.messages.filter(message => ids.includes(message.id) && message.role === "assistant" && message.inputMode !== "comms");
  if (sources.length !== ids.length) throw new Error("A selected completed entry is no longer available.");
  const local: AdventureAction[] = sources.map(source => ({ type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: source.id, manual: true }));
  const snapshot = local.reduce(adventureReducer, adventure);
  try {
    const evaluated = await runCompactMemoryFallback(snapshot, config, sources, { storyCardsOnly: true });
    return { ...evaluated, actions: [...local, ...evaluated.actions] };
  } catch (error) {
    return { valid: false, actions: local, tokenUsage: { promptTokens: 0, completionTokens: 0 },
      error: error instanceof Error ? error.message : "Requested model evaluation failed; local candidates retained.", processedSources: [] };
  }
}
