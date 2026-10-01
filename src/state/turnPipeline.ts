import { parseOnePassMemory } from "../memory/onePassMemory";
import { buildContext, extractInlineThoughts } from "../contextBuilder/contextBuilder";
import { continuityCanon, runContinuityCheck, scanForRiskyClaims } from "../continuityLint";
import { matchPatterns } from "../triggers/matching";
import { cardMatchesName } from "./defaults";
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
import { createId } from "../utils/id";
import { combineProviderUsage } from "../providers/usage";
import { adventureReducer } from "./adventureReducer";

export interface MockableProviderResponse {
  content: string;
  usage?: ProviderUsage;
  /** Why the draft was rewritten before it was kept (length, agency), when it was. */
  repairNotes?: string[];
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

/** Adds a cue to the trailing user turn (e.g. the [TURN CONTEXT] block) instead of sending two user turns in a row. */
export function appendUserCue(messages: ChatMessage[], cue: string): ChatMessage[] {
  const last = messages.at(-1);
  if (last && last.role === "user") return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${cue}` }];
  return [...messages, { role: "user" as const, content: cue }];
}

/**
 * Arc thread ids (Story Cards / Brains) whose trigger patterns match this turn's text.
 * A Brain and a Story Card for the same character are one participant and count once.
 */
export function currentTurnThreadIds(adventure: Adventure, turnText: string): string[] {
  const threadKeys = new Set(adventure.components.filter((c) => c.type === "currentArc").flatMap((c) => c.arcThreadKeys ?? []));
  if (threadKeys.size === 0 || !turnText.trim()) return [];
  const cards = adventure.storyCards.filter((card) =>
    threadKeys.has(card.id) && card.active && matchPatterns(turnText, [card.title, ...card.keys], card.matchType ?? "phrase").matched);
  const brains = adventure.brains.filter((brain) =>
    threadKeys.has(brain.id) && brain.active && matchPatterns(turnText, [brain.characterName, ...brain.triggers].filter(Boolean), "phrase").matched
    && !cards.some((card) => cardMatchesName(card, brain.characterName)));
  return [...cards.map((card) => card.id), ...brains.map((brain) => brain.id)];
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

  // The narrator is no longer asked for memory output; strip any stray envelope or tags defensively.
  const memory = parseOnePassMemory(response.content);
  const { cleanContent: thoughtCleanContent } = extractInlineThoughts(memory.story);
  if (!thoughtCleanContent.trim()) throw new Error("The model returned no visible story. No memory was applied.");
  const rawContentForLint = thoughtCleanContent;

  // Continuity lint: scan for risky claims and, if found, run a targeted LLM check.
  // Uses only the last 8 messages as context to keep tokens low.
  // The check is part of producing this entry, so its usage belongs on the entry, not in background.
  let finalContent = thoughtCleanContent;
  let continuityCorrected = false;
  let entryUsage = response.usage;
  if (mode !== "comms" && providerConfig && scanForRiskyClaims(rawContentForLint)) {
    const lintResult = await runContinuityCheck(next, providerConfig, rawContentForLint, undefined, continuityCanon(preProviderContext));
    if (lintResult.correctedText) {
      finalContent = lintResult.correctedText;
      continuityCorrected = true;
    }
    entryUsage = combineProviderUsage(entryUsage, lintResult.usage);
  }

  // This turn's own text: the player's input (when recorded) plus the response. Used for arc engagement.
  const lastMessage = next.messages.at(-1);
  const currentTurnText = [lastMessage?.role === "user" ? lastMessage.content : "", finalContent].filter(Boolean).join("\n");

  const messageId = assistantMessageId ?? createId("message");
  // Memory is written by the background memory pass (see compactMemoryFallback.ts), never inline.

  next = adventureReducer(next, {
    type: "ADD_MESSAGE",
    role: "assistant",
    content: finalContent,
    inputMode: undefined,
    id: messageId,
    createdAt,
    usage: entryUsage,
  });
  next = adventureReducer(next, { type: "CONSUME_NEXT_TURN_NOTE" });
  // Every rewrite of the narrator's draft is logged, so its effect on the prose can be judged.
  const repairs = [
    ...(response.repairNotes ?? []).map((note) => `Narration rewritten: ${note}`),
    ...(continuityCorrected ? ["Narration rewritten by the continuity check"] : []),
  ];
  if (repairs.length) {
    next = adventureReducer(next, { type: "LOG_EVALUATION_RESULT", entry: {
      id: createId("eval"), turn: next.activeState.turn, createdAt: new Date().toISOString(), conditionsEvaluated: [],
      conditionsFired: [], actionsExecuted: repairs, generatedContent: [], errors: [],
    } });
  }

  next = applyRuntimeEngines(next, { source: "output", text: finalContent });

  // Arc Director: count only arc threads that took part in THIS turn's text. A mention lingering in
  // the recent-history window is not new engagement, and pinned context never counts. The pacing step
  // runs every story turn so a break that has played out can ask whether it resolved.
  if (advanceArcPacing) {
    const triggeredIds = currentTurnThreadIds(next, currentTurnText);
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
    outOfCharacter: mode === "comms",
    currentInput: currentInputForContext ?? (recordUserInput ? text : undefined),
    latestModelOutput: latestAssistantOutput(next),
  });
  const providerPayload = providerCue
    ? appendUserCue(preProviderContext.messages, providerCue)
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
