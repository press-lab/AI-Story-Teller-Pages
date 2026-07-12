import type { Adventure } from "../types/adventure";

export interface RollingSummaryPayload {
  messages: { role: "system" | "user"; content: string }[];
  lastIndex: number;
  fromIndex: number;
}

export interface SceneStatePayload {
  messages: { role: "system" | "user"; content: string }[];
}

export function clampedSummaryStartIndex(adventure: Adventure): number {
  const rawIndex = adventure.rollingSummary.lastSummarizedMessageIndex ?? 0;
  if (!Number.isFinite(rawIndex)) return 0;
  return Math.max(0, Math.min(Math.floor(rawIndex), adventure.messages.length));
}

/**
 * Build the LLM payload for an incremental durable-summary update.
 * Captures only story-level canon — arc state, permanent changes, relationships,
 * open plot threads. Does NOT recap recent actions already in Recent Messages.
 */
export function buildRollingSummaryPayload(adventure: Adventure): RollingSummaryPayload {
  const allMessages = adventure.messages;
  const fromIndex = clampedSummaryStartIndex(adventure);
  const newMessages = allMessages.slice(fromIndex).slice(-60);
  const lastIndex = allMessages.length;

  const currentSummary = adventure.rollingSummary.content?.trim();
  const newEventsText = newMessages.length
    ? newMessages.map((message) => `${message.role === "assistant" ? "Story" : "Player"}: ${message.content}`).join("\n\n")
    : "No new events.";

  const userContent = currentSummary
    ? `## Current Durable Summary\n${currentSummary}\n\n## New Story Events\n${newEventsText}\n\nList only the new permanent facts to append. Do NOT repeat anything already in the summary above.`
    : `## Story Events\n${newEventsText}\n\nWrite a brief durable summary of the permanent facts established in these events.`;

  return {
    messages: [
      {
        role: "system",
        content:
          "You are a continuity keeper for an interactive fiction adventure. " +
          "Review recent story events and identify NEW PERMANENT facts not already captured in the current summary. " +
          "Write ONLY the new additions as concise bullet points (• one fact per line). " +
          "Include: completed arc beats, sealed consequences, permanent character changes, revealed secrets, key relationship shifts. " +
          "Exclude: anything already in the current summary, ephemeral scene details, moment-to-moment actions. " +
          "If nothing new and permanent happened, respond with an empty string. " +
          "Write in past tense, third person. Return ONLY the new bullet points — no preamble, no headers.",
      },
      { role: "user", content: userContent },
    ],
    lastIndex,
    fromIndex,
  };
}

/**
 * Build the LLM payload for a scene-state snapshot.
 * Captures only the immediate present: location, characters, situation, last beat.
 */
export function buildSceneStatePayload(adventure: Adventure): SceneStatePayload {
  const recentMessages = adventure.messages.slice(-12);
  const recentText = recentMessages.length
    ? recentMessages.map((m) => `${m.role === "assistant" ? "Story" : "Player"}: ${m.content}`).join("\n\n")
    : "No recent story turns.";

  const existingSceneState = adventure.sceneState?.content?.trim();

  const userContent = existingSceneState
    ? `## Previous Scene State\n${existingSceneState}\n\n## Recent Story Turns\n${recentText}\n\nUpdate the scene state. Carry forward the Active directive and Pending fields unless the story text shows they were explicitly resolved.`
    : `## Recent Story Turns\n${recentText}\n\nCapture the current scene state.`;

  return {
    messages: [
      {
        role: "system",
        content:
          "You are a scene-state tracker for an interactive fiction adventure. " +
          "Write a CURRENT SCENE STATE using exactly these labeled fields. Keep the total under 150 words.\n\n" +
          "IMPORTANT: Never record a claim as fact unless it is explicitly stated in the story text. Do not infer from tone, implication, or narrative logic.\n\n" +
          "Location: current physical setting.\n" +
          "Present: who is here and their immediate mood or posture.\n" +
          "Last beat: the most recent significant action, revelation, or exchange.\n" +
          "Active directive: Record ONLY if the exact text establishing it appears in the recent messages or previous state. " +
          "Required format: [description] (established: \"[exact quote or paraphrase with turn context]\"). " +
          "Never infer promises, agreements, obligations, or deadlines from context — if it was not said explicitly, write None. " +
          "Carry a directive forward only when it is still unresolved and was explicitly established.\n" +
          "Pending: any open question or decision the player faces right now. If none, write None.\n\n" +
          "Write present tense, third person. Do not recap history. Do not fabricate obligations.",
      },
      { role: "user", content: userContent },
    ],
  };
}
