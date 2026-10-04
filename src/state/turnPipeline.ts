import { ONE_PASS_MEMORY_ID, ONE_PASS_PAUSED_LABEL, onePassMemoryActions, parseOnePassMemory } from "../memory/onePassMemory";
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

/** A cue such as "[continue]" goes before the memory reminder so the reminder stays last. */
function withProviderCue(context: ContextBuildResult, cue: string): ChatMessage[] {
  const messages = context.messages;
  const reminder = context.sections.find(s => s.id === "memoryReminder")?.content;
  const last = messages.at(-1);
  if (reminder && last?.role === "user" && last.content === reminder) {
    return [...messages.slice(0, -1), { role: "user", content: `${cue}\n\n${reminder}` }];
  }
  return [...messages, { role: "user", content: cue }];
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
  const memoryEnabled = mode !== "comms" && next.memoryDetectionSettings.enabled
    && preProviderContext.sections.some(s => s.items.some(i => i.id === ONE_PASS_MEMORY_ID));
  const memoryPaused = mode !== "comms" && next.memoryDetectionSettings.enabled
    && preProviderContext.decisions.some(d => d.itemId === ONE_PASS_MEMORY_ID && d.action === "excluded");
  if (memoryPaused) {
    // Visible record that memory was deliberately left to the memory-only call this turn.
    next = adventureReducer(next, { type: "LOG_EVALUATION_RESULT", entry: {
      id: createId("eval"), turn: next.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
      conditionsFired: [], actionsExecuted: [ONE_PASS_PAUSED_LABEL], generatedContent: [], errors: [],
    } });
  }
  if (memoryEnabled) {
    // Never apply memory from a discarded draft after a continuity rewrite.
    const actions = onePassMemoryActions(next, preProviderContext, continuityCorrected ? [] : memory.updates,
      finalContent, messageId, continuityCorrected ? "Memory skipped after continuity correction." : memory.error);
    const before = next;
    next = reduceActions(next, actions);
    const visibleThoughts = next.brains.filter(b => b.printThoughts).flatMap(b => {
      const old = before.brains.find(previous => previous.id === b.id);
      return Object.entries(b.thoughts).filter(([key, value]) => old?.thoughts[key] !== value)
        .map(([, value]) => "*[" + b.characterName + "]: " + value + "*");
    });
    if (visibleThoughts.length) finalContent += "\n\n" + visibleThoughts.join("\n");
  }


  next = adventureReducer(next, {
    type: "ADD_MESSAGE",
    role: "assistant",
    content: finalContent,
    inputMode: undefined,
    id: messageId,
    createdAt,
    usage: response.usage,
  });
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
    ? withProviderCue(preProviderContext, providerCue)
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
