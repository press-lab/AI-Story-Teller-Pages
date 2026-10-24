import type { Adventure } from "../types/adventure";

/** Three complete exchanges ending at the establishing narrator. Never cross a
 * private/out-of-story boundary or include a later (not yet established) event. */
export function memoryEvidenceWindow(adventure: Adventure, sourceId: string) {
  const end = adventure.messages.findIndex(message => message.id === sourceId && message.role === "assistant");
  if (end < 0) return [];
  let start = end, narrators = 0;
  for (let index = end; index >= 0 && end - index < 12; index--) {
    const message = adventure.messages[index];
    if (message.role === "system" || message.inputMode === "comms") break;
    if (message.role === "assistant" && ++narrators > 3) break;
    start = index;
  }
  return adventure.messages.slice(start, end + 1);
}
