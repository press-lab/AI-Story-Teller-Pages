import { buildContext, extractInlineThoughts } from "../contextBuilder/contextBuilder";
import type { MemoryProposal } from "../types/adventure";
import { runContinuityCheck, scanForRiskyClaims } from "../continuityLint";
import { resolveMemoryTarget } from "../memory/resolveMemoryTarget";
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
import { cardMatchesName } from "./defaults";

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
  const { cleanContent: thoughtCleanContent, thoughts: inlineThoughts, memoryTags } = extractInlineThoughts(response.content);
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

  // Apply inline thought captures to brains (zero extra API calls).
  // Also collect thoughts from brains with printThoughts enabled so they can be appended visibly.
  const visibleThoughtLines: string[] = [];
  if (inlineThoughts.length > 0) {
    const turn = next.activeState.turn;
    for (const thought of inlineThoughts) {
      const brain = next.brains.find(
        (b) => b.characterName.toLowerCase() === thought.name.toLowerCase(),
      );
      if (brain && thought.key && thought.value) {
        next = adventureReducer(next, {
          type: "APPLY_BRAIN_UPDATE",
          brainId: brain.id,
          patch: {
            thoughts: { [`${turn}_${thought.key}`]: `${turn} → ${thought.value}` },
          },
          mode: "append",
          turn,
          preview: thought.value,
        });
        if (brain.printThoughts) {
          visibleThoughtLines.push(`*[${brain.characterName}]: ${thought.value}*`);
        }
      }
    }
  }
  if (visibleThoughtLines.length > 0) {
    finalContent = `${finalContent}\n\n${visibleThoughtLines.join("\n")}`;
  }

  // Convert inline memory tags to story card proposals (zero extra API calls).
  // Living-card routing: if a tag's subject already has a card (matched by exact title), it becomes
  // an UPDATE to that card (append + archive on approval) instead of a duplicate sibling. Otherwise
  // it's a new card. Either way it lands in the Memory Inbox for approval.
  if (memoryTags.length > 0) {
    const turn = next.activeState.turn;
    for (const tag of memoryTags) {
      const routed = resolveMemoryTarget(next, {
        proposedType: "storyCard",
        title: tag.title,
        content: tag.content,
        suggestedTriggers: tag.triggers,
        memoryMode: tag.memoryMode,
        category: tag.category,
        sourceText: "",
        rationale: `Inline memory tag: ${tag.category}`,
      });
      const existing = routed.targetId ? next.storyCards.find((c) => c.id === routed.targetId) : next.storyCards.find((c) => cardMatchesName(c, routed.title));
      const now = nowIso();
      const proposal: MemoryProposal = {
        id: createId("proposal"),
        sourceTurnId: String(turn),
        sourceText: "",
        proposedType: "storyCard",
        title: routed.title,
        content: routed.content,
        suggestedTriggers: routed.suggestedTriggers,
        confidence: 0.75,
        rationale: routed.rationale ?? (existing ? `Update to "${existing.title}" (inline memory tag: ${tag.category})` : `Inline memory tag: ${tag.category}`),
        status: "pending",
        targetId: routed.targetId ?? existing?.id,
        appendContent: routed.appendContent ?? Boolean(existing),
        memoryMode: routed.memoryMode,
        createdAt: now,
        updatedAt: now,
      };
      next = adventureReducer(next, { type: "ADD_MEMORY_PROPOSAL", proposal });
    }
  }

  next = adventureReducer(next, {
    type: "ADD_MESSAGE",
    role: "assistant",
    content: finalContent,
    inputMode: undefined,
    id: assistantMessageId,
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
