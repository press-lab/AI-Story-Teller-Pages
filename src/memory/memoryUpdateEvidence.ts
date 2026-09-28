import type { Adventure } from "../types/adventure";

/** The newest player turn and its response, separate from older attribution context. */
export function latestMemoryTurn(adventure: Adventure) {
  const messages = adventure.messages.filter(m => m.role === "user" || m.role === "assistant");
  const lastUser = messages.map(m => m.role).lastIndexOf("user");
  return messages.slice(lastUser < 0 ? -1 : lastUser);
}
