import { parseOnePassMemory } from "../memory/onePassMemory";
import { buildContext, extractInlineThoughts } from "../contextBuilder/contextBuilder";
import { runContinuityCheck, scanForRiskyClaims } from "../continuityLint";
import { evaluateTriggerRules, type TriggerEvaluationEvent } from "../triggers/triggerEngine";
import type {
  Adventure,
  AdventureAction,
  ChatMessage,
  ContextBuildResult,
  InputMode,
  ProviderConfig,
  ProviderUsage,
} from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { adventureReducer } from "./adventureReducer";

export interface MockableProviderResponse {
  content: string;
  usage?: ProviderUsage;
  finishReason?: string;
  memoryDiscarded?: boolean;
  narrationRewritten?: boolean;
}

export interface RunTurnPipelineOptions {
  adventure: Adventure;
  text: string;
  mode?: InputMode;
  sendChatCompletion: (
    messages: ChatMessage[],
    adventureSnapshot: Adventure,
    context: ContextBuildResult,
  ) => Promise<MockableProviderResponse>;
  providerConfig?: ProviderConfig;
  userMessageId?: string;
  assistantMessageId?: string;
  createdAt?: string;
  recordUserInput?: boolean;
  providerCue?: string;
  currentInputForContext?: string;
  incrementTurn?: boolean;
  advanceArcPacing?: boolean;
}

export interface RunTurnPipelineResult {
  adventure: Adventure;
  preProviderContext: ContextBuildResult;
  postTurnContext: ContextBuildResult;
  providerPayload: ChatMessage[];
  responseContent: string;
  continuityCorrected?: boolean;
}

export function reduceActions(adventure: Adventure, actions: AdventureAction[]): Adventure {
  return actions.reduce((next, action) => adventureReducer(next, action), adventure);
}

export function applyRuntimeEngines(adventure: Adventure, event: TriggerEvaluationEvent): Adventure {
  const triggerResult = evaluateTriggerRules(adventure, event);
  return reduceActions(adventure, triggerResult.actions);
}

export function latestAssistantOutput(adventure: Adventure): string | undefined {
  return [...adventure.messages].reverse().find((message) => message.role === "assistant")?.content;
}

interface ApplyProviderResponseOptions {
  adventure: Adventure;
  response: MockableProviderResponse;
  mode: InputMode;
  providerConfig?: ProviderConfig;
  preProviderContext: ContextBuildResult;
  assistantMessageId?: string;
  createdAt?: string;
  incrementTurn?: boolean;
  advanceArcPacing?: boolean;
}

export async function applyProviderResponse({
  adventure,
  response,
  mode,
  providerConfig,
  preProviderContext,
  assistantMessageId,
  createdAt,
  incrementTurn = true,
  advanceArcPacing = true,
}: ApplyProviderResponseOptions): Promise<{ adventure: Adventure; responseContent: string; continuityCorrected: boolean }> {
  let next = adventure;

  // Extract inline thought tags and memory tags from the response before the player sees it.
  const memory = parseOnePassMemory(response.content);
  if (response.memoryDiscarded) memory.error = "memory_draft_discarded: narration rewrite requires recovery of final story.";
  if (memory.error && ["length", "max_tokens"].includes(response.finishReason ?? "")) {
    memory.error = `provider_output_truncated: finish_reason=${response.finishReason}; ${memory.error}`;
  }
  const { cleanContent: thoughtCleanContent } = extractInlineThoughts(memory.story);
  if (!thoughtCleanContent.trim()) throw new Error("The model returned no visible story. No memory was applied.");
  const rawContentForLint = thoughtCleanContent;

  // Continuity lint: scan for risky claims and, if found, run a targeted LLM check.
  // Uses only the last 8 messages as context to keep tokens low.
  let finalContent = thoughtCleanContent;
  let continuityCorrected = false;
  if (mode !== "comms" && providerConfig && scanForRiskyClaims(rawContentForLint)) {
    const lintAccum = { promptTokens: 0, completionTokens: 0 };
    const lintResult = await runContinuityCheck(next, providerConfig, rawContentForLint, lintAccum);
    if (lintResult.correctedText) {
      finalContent = lintResult.correctedText;
      continuityCorrected = true;
    }
    if (lintAccum.promptTokens > 0 || lintAccum.completionTokens > 0) {
      next = adventureReducer(next, { type: "ACCUMULATE_BACKGROUND_TOKENS", ...lintAccum });
    }
  }

  const messageId = assistantMessageId ?? createId("message");
  next = adventureReducer(next, {
    type: "ADD_MESSAGE",
    role: "assistant",
    content: finalContent,
    inputMode: undefined,
    id: messageId,
    createdAt,
    usage: response.usage,
  });
  if (mode !== "comms" && incrementTurn) {
    next = adventureReducer(next, { type: "ADVANCE_MEMORY_RECOVERY_TURN" });
  }
  if (mode !== "comms" && next.memoryDetectionSettings.enabled && next.memoryDetectionSettings.everyNTurns > 0) {
    next = adventureReducer(next, { type: "QUEUE_MEMORY_EVALUATION", sourceId: messageId,
      turn: next.activeState.turn + (incrementTurn ? 1 : 0) });
  } else {
    next = adventureReducer(next, { type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: createId("decision"), sourceId: messageId,
      createdAt: nowIso(), stage: "independent", outcome: "not_attempted",
      reason: mode === "comms" ? "Out-of-story communication." : !next.memoryDetectionSettings.enabled ? "Automatic memory is disabled." : "Automatic cadence is manual-only." } });
  }
  next = adventureReducer(next, { type: "CONSUME_NEXT_TURN_NOTE" });

  next = applyRuntimeEngines(next, { source: "output", text: finalContent });

  // Arc Director: count only Story Card / Brain ids whose trigger patterns matched turn text.
  // Pinned or always-on context can be included without counting as engagement.
  const triggeredIds = preProviderContext.triggeredThreadIds;
  if (advanceArcPacing && triggeredIds.length > 0) {
    next = adventureReducer(next, { type: "ADVANCE_ARC_PACING", triggeredIds, turn: next.activeState.turn });
  }

  if (incrementTurn) {
    next = adventureReducer(next, { type: "INCREMENT_TURN" });
  }

  return { adventure: next, responseContent: finalContent, continuityCorrected };
}

export async function runTurnPipeline({
  adventure,
  text,
  mode = "story",
  sendChatCompletion,
  providerConfig,
  userMessageId,
  assistantMessageId,
  createdAt,
  recordUserInput = true,
  providerCue,
  currentInputForContext,
  incrementTurn = true,
  advanceArcPacing = true,
}: RunTurnPipelineOptions): Promise<RunTurnPipelineResult> {
  let next = adventure;
  if (recordUserInput) {
    next = adventureReducer(adventure, {
      type: "ADD_MESSAGE",
      role: "user",
      content: text,
      inputMode: mode,
      id: userMessageId,
      createdAt,
    });
    next = applyRuntimeEngines(next, { source: "input", text });
  }

  const preProviderContext = buildContext(next, {
    skipThoughtCapture: mode === "comms",
    currentInput: currentInputForContext ?? (recordUserInput ? text : undefined),
    latestModelOutput: latestAssistantOutput(next),
  });
  const providerPayload = providerCue
    ? [...preProviderContext.messages, { role: "user" as const, content: providerCue }]
    : preProviderContext.messages;
  const response = await sendChatCompletion(providerPayload, next, preProviderContext);

  const applied = await applyProviderResponse({
    adventure: next,
    response,
    mode,
    providerConfig,
    preProviderContext,
    assistantMessageId,
    createdAt,
    incrementTurn,
    advanceArcPacing,
  });
  next = applied.adventure;

  return {
    adventure: next,
    preProviderContext,
    postTurnContext: buildContext(next, { latestModelOutput: applied.responseContent }),
    providerPayload,
    responseContent: applied.responseContent,
    continuityCorrected: applied.continuityCorrected,
  };
}
