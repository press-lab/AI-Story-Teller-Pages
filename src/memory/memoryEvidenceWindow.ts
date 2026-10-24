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
