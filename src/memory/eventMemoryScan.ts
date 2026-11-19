import type { Adventure, AdventureAction, ProviderConfig } from "../types/adventure";
import { adventureReducer } from "../state/adventureReducer";
import { detectStoryCardProposals } from "./memoryDetection";

/** Incremental catch-up: preserve completed excerpts if cancelled or a later call fails. */
export async function scanEventMemories(
  adventure: Adventure,
  config: ProviderConfig,
  onActions: (actions: AdventureAction[]) => void,
  onProgress: (message: string) => void,
  signal: AbortSignal,
  range?: { start: number; end: number },
): Promise<number> {
  let snapshot = adventure;
  if (range && (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.end < range.start || range.end > adventure.messages.length)) throw new Error("Enter a valid inclusive Chronicle entry range.");
  const entries = range ? adventure.messages.slice(range.start - 1, range.end) : adventure.messages;
  const messages = entries.filter(m => m.role === "user" || m.role === "assistant");
  let found = 0;
  // Overlap excerpts to retain events crossing a chunk boundary.
  for (let start = 0; start < messages.length && !signal.aborted; start += 20) {
    onProgress("Reading messages " + (start + 1) + "–" + Math.min(start + 24, messages.length) + " of " + messages.length + "; " + found + " suggestions added.");
    const result = await detectStoryCardProposals(snapshot, config, { messages: messages.slice(start, start + 24), eventsOnly: true });
    if (result.errors.length) throw new Error(result.errors.join(" "));
    const next = result.actions.reduce(adventureReducer, snapshot);
    found += next.activeState.memoryProposals.length - snapshot.activeState.memoryProposals.length;
    snapshot = next;
    onActions(result.actions);
  }
  onProgress((signal.aborted ? "Stopped" : "Finished") + ": " + found + " Event Memory suggestions added for review.");
  return found;
}
