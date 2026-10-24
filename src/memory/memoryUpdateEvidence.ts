import { storyMemoryMessages } from "./memoryEvidenceWindow";
import type { Adventure } from "../types/adventure";

/** The newest player turn and its response, separate from older attribution context. */
export function latestMemoryTurn(adventure: Adventure) {
  const messages = storyMemoryMessages(adventure);
  const lastUser = messages.map(m => m.role).lastIndexOf("user");
  const lastAssistant = messages.map(m => m.role).lastIndexOf("assistant");
  const previousAssistant = messages.slice(0, lastAssistant).map(m => m.role).lastIndexOf("assistant");
  return messages.slice(Math.max(lastUser, previousAssistant + 1, 0));
}
