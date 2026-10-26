import type { Adventure, Message } from "../types/adventure";

/** Infer the mode of legacy assistant replies from their player input without
 * rewriting stored messages or their original IDs/content. */
export function storyMemoryMessages(adventure: Adventure): Message[] {
  let mode: Message["inputMode"];
  return adventure.messages.filter(message => {
    if (message.role === "user" || message.role === "system") mode = message.inputMode;
    return message.role !== "system" && (message.inputMode ?? mode) !== "comms";
  });
}

/** Three in-story exchanges ending at the establishing narrator. OOC replies
 * consume no story budget. System boundaries still stop evidence traversal. */
export function memoryEvidenceWindow(adventure: Adventure, sourceId: string) {
  const story = new Set(storyMemoryMessages(adventure).map(message => message.id));
  const end = adventure.messages.findIndex(message => message.id === sourceId && message.role === "assistant" && story.has(message.id));
  if (end < 0) return [];
  const selected: Message[] = [];
  let narrators = 0;
  for (let index = end; index >= 0; index--) {
    const message = adventure.messages[index];
    if (message.role === "system") break;
    if (!story.has(message.id)) continue;
    if (message.role === "assistant" && ++narrators > 3) break;
    selected.unshift(message);
    if (selected.length >= 12) break;
  }
  return selected;
}

/** Explicit batch sources are independent of the normal three-exchange window. */
export function brainBatchEvidenceMessages(adventure: Adventure, sourceIds: readonly string[]): Message[] {
  if (sourceIds.length < 1 || sourceIds.length > 3 || sourceIds.some(id => typeof id !== "string")) {
    throw new Error("memory_brain_batch_source_stale: Expected one to three narrator sources.");
  }
  const story = storyMemoryMessages(adventure);
  const indices = new Map(story.map((message, index) => [message.id, index]));
  const selected = new Set<string>();
  for (const id of sourceIds) {
    const index = indices.get(id);
    if (index === undefined || story[index].role !== "assistant") {
      throw new Error("memory_brain_batch_source_stale: Missing in-story narrator source.");
    }
    selected.add(id);
    if (index > 0 && story[index - 1].role === "user") selected.add(story[index - 1].id);
  }
  return story.filter(message => selected.has(message.id));
}
