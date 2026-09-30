import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { buildContext } from "../contextBuilder/contextBuilder";
import { saveAdventure } from "../db/adventureDb";
import { scanEventMemories } from "../memory/eventMemoryScan";
import { regenerateProposalContent } from "../memory/memoryDetection";
import { runBackgroundMemoryPass } from "../memory/compactMemoryFallback";
import { generateArcContinuations, generateArcDirector, generateArcFromHistory, generateBrainFromName as generateBrainEntry, generateComponentContent, pickConvergentContinuation } from "../ai/generators";
import { PLOT_ESSENTIALS_BEST_PRACTICES } from "../ai/authoringBestPractices";
import { runStoryCardAudit, type AuditRecommendation } from "../memory/storyCardAudit";
import { runComponentAudit, type ComponentAuditRecommendation } from "../memory/componentAudit";
import { runBrainAudit, type BrainAuditRecommendation } from "../memory/brainAudit";
import { isNativeDeepSeekProvider, sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { resolveBackgroundProviderConfig } from "../providers/backgroundProvider";
import { adventureReducer } from "../state/adventureReducer";
import {
  applyProviderResponse,
  latestAssistantOutput,
  reduceActions,
  runTurnPipeline,
} from "../state/turnPipeline";
import {
  buildStoryResponseCorrectionMessages,
  evaluateStoryResponseGuard,
  storyResponseWordLimit,
} from "../state/storyResponseGuard";
import {
  runManualBrainUpdate,
  runManualPEComponentUpdate,
  runManualPlotEssentialsUpdate,
  runManualStoryCardsUpdate,
  runMemoryReconcile,
  runPlotAIBuilder,
  runRememberThis,
  runSemanticPostTurnEvaluation,
  runStoryCardAIBuilder,
} from "../triggers/semanticEngine";
import type {
  Adventure,
  AdventureAction,
  ChatMessage,
  ContextBuildResult,
  InputMode,
  MemoryDetectionSettings,
  MemoryReconcileRequest,
  PendingAdventureUpdate,
  PlotAIBuilderRequest,
  ProviderUsage,
  StoryCardAIBuilderRequest,
} from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import type { RuntimeProviderSettings } from "../pages/pageTypes";

function mergeProviderConfig(adventure: Adventure, settings: RuntimeProviderSettings): RuntimeProviderSettings {
  const sessionId = `ai-story-teller:${adventure.id}`.slice(0, 256);
  return { ...adventure.modelConfig, ...settings, apiKey: settings.apiKey, sessionId };
}

export function applyResponseLengthHint(config: RuntimeProviderSettings, hint: number, hiddenReserveTokens = 0): RuntimeProviderSettings {
  const wordTarget = Number.isFinite(hint) ? Math.max(50, Math.min(500, Math.round(hint))) : 250;
  const visibleTokenCap = Math.ceil(wordTarget * 1.5) + 80;
  const hiddenReserve = Math.max(0, Math.ceil(hiddenReserveTokens));
  const lengthBoundedCap = visibleTokenCap + hiddenReserve;
  const configuredCap = Number.isFinite(config.maxOutputTokens) && config.maxOutputTokens > 0
    ? config.maxOutputTokens
    : lengthBoundedCap;
  return { ...config, maxOutputTokens: Math.min(configuredCap, lengthBoundedCap) };
}

/** Extra output budget for DeepSeek reasoning on out-of-character correction turns. */
export const CORRECTION_REASONING_RESERVE = 2500;

/** The narrator no longer writes hidden memory output, so no extra output budget is reserved. */
function hiddenOutputReserveTokens(_context: ContextBuildResult): number {
  return 0;
}

function correctionConfig(config: RuntimeProviderSettings, responseLengthHint: number): RuntimeProviderSettings {
  const bounded = applyResponseLengthHint(
    {
      ...config,
      temperature: Math.min(config.temperature, 0.2),
      presencePenalty: 0,
      frequencyPenalty: 0,
    },
    responseLengthHint,
    0,
  );
  const correctionCap = Math.ceil(storyResponseWordLimit(responseLengthHint) * 1.15) + 35;
  return { ...bounded, maxOutputTokens: Math.min(bounded.maxOutputTokens, correctionCap) };
}

export function combineProviderUsage(...usages: Array<ProviderUsage | undefined>): ProviderUsage | undefined {
  const present = usages.filter((usage): usage is ProviderUsage => usage !== undefined);
  if (present.length === 0) return undefined;
  const promptTokens = present.reduce((sum, usage) => sum + usage.promptTokens, 0);
  const completionTokens = present.reduce((sum, usage) => sum + usage.completionTokens, 0);
  const totalTokens = present.reduce(
    (sum, usage) => sum + (usage.totalTokens || usage.promptTokens + usage.completionTokens),
    0,
  );
  const cacheRead = present.reduce((sum, usage) => sum + (usage.cacheReadTokens ?? 0), 0);
  const cacheWrite = present.reduce((sum, usage) => sum + (usage.cacheCreationTokens ?? 0), 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(present.some((usage) => usage.cacheReadTokens !== undefined) ? { cacheReadTokens: cacheRead } : {}),
    ...(present.some((usage) => usage.cacheCreationTokens !== undefined) ? { cacheCreationTokens: cacheWrite } : {}),
  };
}

async function sendStoryCompletionWithGuard({
  messages,
  config,
  responseLengthHint,
  playerInput,
}: {
  messages: ChatMessage[];
  config: RuntimeProviderSettings;
  responseLengthHint: number;
  playerInput: string;
}): Promise<{ content: string; usage?: ProviderUsage }> {
  const response = await sendOpenAICompatibleChatCompletion({ messages, config });
  const guard = evaluateStoryResponseGuard(response.content, responseLengthHint, playerInput);
  if (!guard.needsCorrection) return response;

  const correctionMessages = buildStoryResponseCorrectionMessages({
    playerInput,
    draft: response.content,
    wordLimit: guard.visibleWordLimit,
    reasons: guard.reasons,
  });
  const corrected = await sendOpenAICompatibleChatCompletion({
    messages: correctionMessages,
    config: correctionConfig(config, responseLengthHint),
    // This tightly constrained rewrite does not benefit from hidden reasoning. DeepSeek's
    // default thinking mode can otherwise consume the entire small correction budget.
    thinking: "disabled",
  });
  return { content: corrected.content, usage: combineProviderUsage(response.usage, corrected.usage) };
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

const CHALLENGE_PHRASES = [
  /i don'?t remember that/i,
  /that didn'?t happen/i,
  /\bcontinuity\b/i,
  /that'?s not (right|correct|what happened)/i,
  /you'?re making that up/i,
  /that was never (said|established|agreed)/i,
  /where did (you|that) come from/i,
];

function buildBackgroundConfig(adventure: Adventure, settings: RuntimeProviderSettings): RuntimeProviderSettings {
  const base = mergeProviderConfig(adventure, settings);
  return resolveBackgroundProviderConfig(adventure, base) as RuntimeProviderSettings;
}

export function useAdventureRuntime(
  adventure: Adventure | undefined,
  setAdventure: Dispatch<SetStateAction<Adventure | undefined>>,
  providerSettings: RuntimeProviderSettings,
  setSaveStatus: (status: string) => void,
  setContextResult: (result: ContextBuildResult | undefined) => void,
  openTab: (tabId: "memoryInbox") => void,
  refreshAdventures: () => Promise<void>,
  globalMemorySettings: MemoryDetectionSettings,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const adventureRef = useRef<Adventure | undefined>(adventure);
  const providerSettingsRef = useRef(providerSettings);
  const globalMemorySettingsRef = useRef(globalMemorySettings);
  const isSubmittingRef = useRef(false);
  const semanticInFlight = useRef(new Set<string>());
  const memoryFallbackInFlight = useRef(new Set<string>());
  const arcInFlight = useRef(new Set<string>());
  const queuedUpdatesRef = useRef<PendingAdventureUpdate[]>([]);
  const wasHiddenRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const continueTurnRef = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => { adventureRef.current = adventure; }, [adventure]);
  useEffect(() => { providerSettingsRef.current = providerSettings; }, [providerSettings]);
  useEffect(() => { globalMemorySettingsRef.current = globalMemorySettings; }, [globalMemorySettings]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
      } else if (pendingRetryRef.current) {
        pendingRetryRef.current = false;
        wasHiddenRef.current = false;
        setError(undefined);
        void continueTurnRef.current?.();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const activeProviderConfig = useMemo(
    () => adventure ? mergeProviderConfig(adventure, providerSettings) : providerSettings,
    [adventure, providerSettings],
  );

  const applyActionsAndPersist = useCallback((actions: AdventureAction[]) => {
    setAdventure((current) => {
      if (!current) return current;
      const next = reduceActions(current, actions);
      adventureRef.current = next;
      void saveAdventure(next).then(() => {
        setSaveStatus("saved");
        void refreshAdventures();
      });
      return next;
    });
  }, [setAdventure, setSaveStatus, refreshAdventures]);

  function queuePendingUpdate(actions: AdventureAction[], source: PendingAdventureUpdate["source"]) {
    const update: PendingAdventureUpdate = {
      id: createId("pending"),
      createdAt: nowIso(),
      source,
      actions,
    };
    queuedUpdatesRef.current = [...queuedUpdatesRef.current, update];
    setAdventure((current) => current ? adventureReducer(current, { type: "QUEUE_PENDING_UPDATE", update }) : current);
  }

  function mergeQueuedUpdates(adventureState: Adventure): Adventure {
    if (queuedUpdatesRef.current.length === 0) return adventureState;
    let next = adventureState;
    for (const update of queuedUpdatesRef.current) {
      next = adventureReducer(next, { type: "QUEUE_PENDING_UPDATE", update });
    }
    queuedUpdatesRef.current = [];
    return next;
  }

  function flushPendingBeforeContext(adventureState: Adventure): Adventure {
    const next = adventureReducer(mergeQueuedUpdates(adventureState), { type: "FLUSH_PENDING_UPDATES" });
    return { ...next, memoryDetectionSettings: { ...globalMemorySettingsRef.current } };
  }

  /**
   * The single automatic memory writer: one background call every `everyNTurns` story turns.
   * It never cascades into the multi-call semantic memory cycle; a failed pass waits for the next slot.
   */
  async function startMemoryPass(snapshot: Adventure) {
    if (!snapshot.memoryDetectionSettings.enabled || memoryFallbackInFlight.current.has(snapshot.id)) return;
    const everyN = Math.max(1, snapshot.memoryDetectionSettings.everyNTurns ?? 3);
    const last = snapshot.activeState.lastMemoryCycleTurn;
    if (last !== undefined && snapshot.activeState.turn - last < everyN) return;

    memoryFallbackInFlight.current.add(snapshot.id);
    try {
      const config = buildBackgroundConfig(snapshot, providerSettingsRef.current);
      const pass = await runBackgroundMemoryPass(snapshot, config);
      const actions: AdventureAction[] = [
        ...pass.actions,
        ...(pass.valid ? [] : [{ type: "LOG_EVALUATION_RESULT" as const, entry: {
          id: createId("eval"), turn: snapshot.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
          conditionsFired: [], actionsExecuted: ["Background memory pass: one API call"], generatedContent: [],
          errors: ["Background memory pass returned no usable JSON; it will run again at the next scheduled turn."],
        } }]),
        { type: "SET_LAST_MEMORY_CYCLE_TURN", turn: snapshot.activeState.turn, messageId: snapshot.messages.at(-1)?.id },
        { type: "ACCUMULATE_BACKGROUND_TOKENS", promptTokens: pass.tokenUsage.promptTokens, completionTokens: pass.tokenUsage.completionTokens },
      ];
      if (adventureRef.current?.id !== snapshot.id) return;
      if (isSubmittingRef.current) {
        queuePendingUpdate(actions, "memoryCycle");
        return;
      }
      applyActionsAndPersist(actions);
    } catch (passError) {
      if (adventureRef.current?.id === snapshot.id) {
        setError(passError instanceof Error ? passError.message : "Background memory pass failed.");
      }
    } finally {
      memoryFallbackInFlight.current.delete(snapshot.id);
    }
  }

  async function startSemanticEvaluation(snapshot: Adventure) {
    if (!snapshot.semanticEvaluationSettings.enabled || semanticInFlight.current.has(snapshot.id)) return;
    if (!snapshot.triggerRules.some(rule => rule.enabled && (rule.evaluationMode ?? "semantic") === "semantic")) return;
    const everyN = snapshot.semanticEvaluationSettings.semanticEvalEveryNTurns ?? 1;
    if (everyN === 0) return;
    const last = snapshot.activeState.lastSemanticEvalTurn;
    if (last !== undefined && snapshot.activeState.turn - last < everyN) return;
    semanticInFlight.current.add(snapshot.id);
    try {
      const result = await runSemanticPostTurnEvaluation(
        snapshot,
        mergeProviderConfig(snapshot, providerSettingsRef.current),
      );
      if (adventureRef.current?.id !== snapshot.id) return;
      const stampAction: AdventureAction = { type: "SET_LAST_SEMANTIC_EVAL_TURN", turn: snapshot.activeState.turn };
      const tokenAction: AdventureAction | undefined = result.tokenUsage
        ? { type: "ACCUMULATE_BACKGROUND_TOKENS", promptTokens: result.tokenUsage.promptTokens, completionTokens: result.tokenUsage.completionTokens }
        : undefined;
      const allActions = [...result.actions, stampAction, ...(tokenAction ? [tokenAction] : [])];
      if (isSubmittingRef.current) {
        queuePendingUpdate(allActions, "semanticEvaluation");
        return;
      }
      applyActionsAndPersist(allActions);
    } catch (error) {
      if (adventureRef.current?.id === snapshot.id) setError(error instanceof Error ? error.message : "Custom rule evaluation failed.");
    } finally {
      semanticInFlight.current.delete(snapshot.id);
    }
  }


  const buildPreview = useCallback(() => {
    if (!adventure) return;
    setContextResult(buildContext({ ...adventure, memoryDetectionSettings: globalMemorySettings }, { latestModelOutput: latestAssistantOutput(adventure) }));
  }, [adventure, globalMemorySettings, setContextResult]);

  // When an arc reaches aftermath, draft next-arc directions once so the player can pick
  // where the story goes next without architecting it. Gated by arcContinuationOptions
  // being undefined so it runs a single time per resolution.
  async function checkArcContinuation(snapshot: Adventure) {
    const arc = snapshot.components.find(
      (c) =>
        c.type === "currentArc" &&
        c.arcState?.phase === "aftermath" &&
        c.arcContinuationOptions === undefined &&
        (c.arcThreadKeys?.length ?? 0) > 0,
    );
    if (!arc || arcInFlight.current.has(snapshot.id)) return;
    arcInFlight.current.add(snapshot.id);
    try {
      const options = await generateArcContinuations(snapshot, activeProviderConfig, arc);
      if (adventureRef.current?.id !== snapshot.id) return;
      if (arc.arcAutoContinue) {
        // Silent auto-continue: the Director picks the most convergent direction and seeds it
        // itself — no chooser, no spoiler. The new threat surfaces through play.
        const pick = pickConvergentContinuation(options, arc.arcState?.threadEngagement ?? {});
        if (pick) applyActionsAndPersist([{ type: "APPLY_ARC_CONTINUATION", componentId: arc.id, option: pick }]);
        else applyActionsAndPersist([{ type: "SET_ARC_CONTINUATIONS", componentId: arc.id, options: [] }]);
      } else {
        applyActionsAndPersist([{ type: "SET_ARC_CONTINUATIONS", componentId: arc.id, options }]);
      }
    } catch {
      // non-fatal — options stay ungenerated and we retry next turn
    } finally {
      arcInFlight.current.delete(snapshot.id);
    }
  }

  async function submitTurn(text: string, mode: InputMode = "story") {
    if (!adventure || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    setError(undefined);

    let base = flushPendingBeforeContext(adventure);
    if (mode !== "comms" && CHALLENGE_PHRASES.some((re) => re.test(text))) {
      base = adventureReducer(base, { type: "SET_CHALLENGE_MODE" });
    }
    let snapshotWithUserMsg: typeof adventure | undefined;

    try {
      const result = await runTurnPipeline({
        adventure: base,
        text,
        mode,
        providerConfig: mergeProviderConfig(base, providerSettings),
        sendChatCompletion: async (messages, snapshot, context) => {
          snapshotWithUserMsg = snapshot;
          setAdventure(snapshot);
          setContextResult(context);
          const storyConfig = applyResponseLengthHint(
            mergeProviderConfig(snapshot, providerSettings),
            snapshot.activeState.responseLengthHint,
            hiddenOutputReserveTokens(context),
          );
          if (mode === "comms") {
            const reasoning = Boolean(storyConfig.reasoningForCorrections) && isNativeDeepSeekProvider(storyConfig);
            return sendOpenAICompatibleChatCompletion({
              messages,
              // Reasoning tokens count as output, so give them room beyond the visible length cap.
              config: reasoning
                ? applyResponseLengthHint(mergeProviderConfig(snapshot, providerSettings), snapshot.activeState.responseLengthHint, CORRECTION_REASONING_RESERVE)
                : storyConfig,
              ...(reasoning ? { thinking: "enabled" as const } : {}),
            });
          }
          return sendStoryCompletionWithGuard({
            messages,
            config: storyConfig,
            responseLengthHint: snapshot.activeState.responseLengthHint,
            playerInput: text,
          });
        },
      });

      let next = mergeQueuedUpdates(result.adventure);
      setAdventure(next);
      setContextResult(result.postTurnContext);
      await saveAdventure(next);
      setSaveStatus("saved");
      isSubmittingRef.current = false;
      if (mode !== "comms") {
        void startMemoryPass(next);
        void startSemanticEvaluation(next);
        void checkArcContinuation(next);
      }
    } catch (providerError) {
      const errMsg = providerError instanceof Error ? providerError.message : "Provider request failed.";
      const isNetworkError = errMsg.startsWith("Network error");
      if (isNetworkError && wasHiddenRef.current) {
        pendingRetryRef.current = true;
        if (document.visibilityState === "visible") {
          pendingRetryRef.current = false;
          wasHiddenRef.current = false;
          setError(undefined);
          setTimeout(() => void continueTurnRef.current?.(), 0);
        } else {
          setError("Connection lost — will retry automatically when you return.");
        }
      } else {
        wasHiddenRef.current = false;
        setError(errMsg);
      }
      const errorState = snapshotWithUserMsg ?? base;
      setAdventure(errorState);
      await saveAdventure(errorState);
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
      void refreshAdventures();
    }
  }

  async function continueTurn() {
    if (!adventure || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    setError(undefined);

    try {
      const base = flushPendingBeforeContext(adventure);
      const result = await runTurnPipeline({
        adventure: base,
        text: "[continue]",
        mode: "story",
        recordUserInput: false,
        providerCue: "[continue]",
        providerConfig: mergeProviderConfig(base, providerSettings),
        sendChatCompletion: async (messages, snapshot, context) => {
          setAdventure(snapshot);
          setContextResult(context);
          const continueConfig = applyResponseLengthHint(
            mergeProviderConfig(snapshot, providerSettings),
            snapshot.activeState.responseLengthHint,
            hiddenOutputReserveTokens(context),
          );
          return sendStoryCompletionWithGuard({
            messages,
            config: continueConfig,
            responseLengthHint: snapshot.activeState.responseLengthHint,
            playerInput: "[continue]",
          });
        },
      });
      let next = result.adventure;
      next = mergeQueuedUpdates(next);
      setAdventure(next);
      setContextResult(result.postTurnContext);
      await saveAdventure(next);
      setSaveStatus("saved");
      isSubmittingRef.current = false;
      void startMemoryPass(next);
      void startSemanticEvaluation(next);
      void checkArcContinuation(next);
    } catch (providerError) {
      setError(providerError instanceof Error ? providerError.message : "Continue failed.");
      setAdventure(adventure);
      await saveAdventure(adventure);
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
      void refreshAdventures();
    }
  }

  async function regenerateLastResponse() {
    if (!adventure || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    setError(undefined);

    let next = flushPendingBeforeContext(adventure);
    next = adventureReducer(next, { type: "REMOVE_LAST_ASSISTANT_MESSAGE" });
    const lastUser = [...next.messages].reverse().find((m) => m.role === "user")?.content ?? "Continue.";
    const context = buildContext(next, { currentInput: lastUser, latestModelOutput: latestAssistantOutput(next) });
    setContextResult(context);

    try {
      const regenConfig = applyResponseLengthHint(
        mergeProviderConfig(next, providerSettings),
        next.activeState.responseLengthHint,
        hiddenOutputReserveTokens(context),
      );
      const response = await sendStoryCompletionWithGuard({
        messages: context.messages,
        config: regenConfig,
        responseLengthHint: next.activeState.responseLengthHint,
        playerInput: lastUser,
      });
      const applied = await applyProviderResponse({
        adventure: next,
        response,
        mode: "story",
        providerConfig: regenConfig,
        preProviderContext: context,
        incrementTurn: false,
        advanceArcPacing: false,
      });
      next = applied.adventure;
      next = mergeQueuedUpdates(next);
      setAdventure(next);
      setContextResult(buildContext(next, { latestModelOutput: applied.responseContent }));
      await saveAdventure(next);
      setSaveStatus("saved");
      isSubmittingRef.current = false;
      void startMemoryPass(next);
      void startSemanticEvaluation(next);
    } catch (providerError) {
      setError(providerError instanceof Error ? providerError.message : "Regeneration failed.");
      setAdventure(next);
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  }

  async function rememberThis(fact: string) {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runRememberThis(adventure, activeProviderConfig, fact);
      const proposalCount = result.actions.filter((action) => action.type === "ADD_MEMORY_PROPOSAL").length;
      if (proposalCount === 0) {
        throw new Error(result.logEntry.errors[0] ?? "The AI did not produce a Story Card suggestion.");
      }
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
    } catch (rememberError) {
      setError(rememberError instanceof Error ? rememberError.message : "Remember This failed.");
    } finally {
      setLoading(false);
    }
  }

  async function updateBrainNow(brainId: string) {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runManualBrainUpdate(adventure, activeProviderConfig, brainId);
      applyActionsAndPersist(result.actions);
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Manual brain update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function updatePEComponentNow(componentId: string) {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runManualPEComponentUpdate(adventure, activeProviderConfig, componentId);
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manual PE update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function suggestPlotUpdates() {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runManualPlotEssentialsUpdate(adventure, activeProviderConfig);
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plot update suggestions failed.");
    } finally {
      setLoading(false);
    }
  }

  async function suggestCardUpdates() {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runManualStoryCardsUpdate(adventure, activeProviderConfig);
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Story card update suggestions failed.");
    } finally {
      setLoading(false);
    }
  }

  async function buildStoryCardMemory(request: StoryCardAIBuilderRequest) {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runStoryCardAIBuilder(adventure, activeProviderConfig, request);
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Story Card builder failed.");
    } finally {
      setLoading(false);
    }
  }

  async function buildPlotMemory(request: PlotAIBuilderRequest) {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runPlotAIBuilder(adventure, activeProviderConfig, request);
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plot builder failed.");
    } finally {
      setLoading(false);
    }
  }

  async function reconcileMemory(request: MemoryReconcileRequest) {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await runMemoryReconcile(adventure, activeProviderConfig, request);
      const proposalCount = result.actions.filter((action) => action.type === "ADD_MEMORY_PROPOSAL").length;
      applyActionsAndPersist(result.actions);
      openTab("memoryInbox");
      if (proposalCount === 0 && result.logEntry.errors.length > 0) {
        setError(result.logEntry.errors[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory reconcile failed.");
    } finally {
      setLoading(false);
    }
  }

  async function auditStoryCards(nTurns: number, includeAI = false): Promise<AuditRecommendation[]> {
    if (!adventure) return [];
    return runStoryCardAudit(adventure, activeProviderConfig, nTurns, { includeAI });
  }

  async function auditComponents(nTurns: number, includeAI = false): Promise<ComponentAuditRecommendation[]> {
    if (!adventure) return [];
    return runComponentAudit(adventure, activeProviderConfig, nTurns, { includeAI });
  }

  async function auditBrains(nTurns: number, includeAI = false): Promise<BrainAuditRecommendation[]> {
    if (!adventure) return [];
    return runBrainAudit(adventure, activeProviderConfig, nTurns, { includeAI });
  }

  async function findEventMemories(onProgress: (message: string) => void, signal: AbortSignal): Promise<void> {
    if (!adventure || loading) return;
    setLoading(true);
    try {
      await scanEventMemories(adventure, activeProviderConfig, actions => {
        if (adventureRef.current?.id !== adventure.id) throw new Error("Event scan stopped because the active adventure changed.");
        applyActionsAndPersist(actions);
      }, onProgress, signal);
    } finally { setLoading(false); }
  }

  async function regenerateMemoryProposal(proposalId: string): Promise<void> {
    if (!adventure) return;
    const proposal = adventure.activeState.memoryProposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const newContent = await regenerateProposalContent(proposal, adventure, activeProviderConfig);
    if (!newContent) return;
    const appendContent = proposal.appendContent ?? (proposal.proposedType === "plotEssentialsUpdate" ? false : undefined);
    applyActionsAndPersist([{ type: "UPDATE_MEMORY_PROPOSAL", proposalId, patch: { content: newContent, appendContent } }]);
  }

  async function regeneratePlotEssentials(componentId: string): Promise<string> {
    if (!adventure) throw new Error("No adventure loaded.");
    const component = adventure.components.find((c) => c.id === componentId && c.type === "plotEssentials");
    if (!component) throw new Error("Plot Essentials component not found.");
    const recentTurns = adventure.messages.slice(-20).map((m) => `${m.role}: ${m.content}`).join("\n");
    const systemPrompt = `You are maintaining plot essentials for an interactive fiction game.
${PLOT_ESSENTIALS_BEST_PRACTICES}

Current plot essentials:
${component.content}

Recent story turns:
${recentTurns}

Rewrite the plot essentials as a clean, current, non-redundant replacement block.
Remove resolved events and outdated constraints. Keep active pressures, open tensions, obligations, and major constraints.
Write 4-7 tight bullets or short labeled lines. Do not append a small update note.
Respond with ONLY the new content — no preamble, no labels, no explanation.`;
    const response = await sendOpenAICompatibleChatCompletion({
      config: activeProviderConfig,
      messages: [{ role: "user", content: systemPrompt }],
    });
    return response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }

  /** Generate fresh content for a Narration Rules / AI Instructions / Author's Note component. Returns a string for review. */
  async function generateComponent(componentId: string): Promise<string> {
    if (!adventure) throw new Error("No adventure loaded.");
    const component = adventure.components.find((c) => c.id === componentId);
    if (!component) throw new Error("Component not found.");
    return generateComponentContent(adventure, activeProviderConfig, component);
  }

  /** Generate an Arc Director setup from a concept and apply it to the Current Arc component. */
  async function generateArc(componentId: string, concept: string): Promise<void> {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const arc = await generateArcDirector(adventure, activeProviderConfig, concept);
      applyActionsAndPersist([{ type: "UPDATE_COMPONENT", componentId, patch: arc }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Arc generation failed.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Read recent play and draft an arc, dropping it into the Memory Inbox for approval (does not
   * apply it). For a story that's gone stale in aftermath and wants a new direction.
   */
  async function proposeArcFromHistory(componentId: string): Promise<void> {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const arc = await generateArcFromHistory(adventure, activeProviderConfig);
      const timestamp = nowIso();
      applyActionsAndPersist([
        {
          type: "ADD_MEMORY_PROPOSAL",
          proposal: {
            id: createId("proposal"),
            sourceTurnId: adventure.messages.at(-1)?.id ?? "manual",
            sourceText: "Arc suggested from recent play.",
            proposedType: "arcProposal",
            title: arc.label,
            content: JSON.stringify(
              {
                arcPremise: arc.arcPremise,
                arcSimmerInstruction: arc.arcSimmerInstruction,
                arcBreakInstruction: arc.arcBreakInstruction,
                arcPace: arc.arcPace,
                arcTriggerMode: arc.arcTriggerMode,
                arcThreadKeys: arc.arcThreadKeys,
              },
              null,
              2,
            ),
            suggestedTriggers: [],
            confidence: 0.7,
            rationale: arc.rationale,
            status: "pending",
            targetId: componentId,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Arc suggestion failed.");
    } finally {
      setLoading(false);
    }
  }

  /** Generate a character Brain from just a name and add it to the adventure. */
  async function generateBrainFromName(name: string): Promise<void> {
    if (!adventure || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const brain = await generateBrainEntry(adventure, activeProviderConfig, name);
      applyActionsAndPersist([{ type: "UPSERT_BRAIN", brain }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Character generation failed.");
    } finally {
      setLoading(false);
    }
  }

  continueTurnRef.current = continueTurn;

  return {
    loading,
    error,
    clearError: () => setError(undefined),
    activeProviderConfig,
    buildPreview,
    submitTurn,
    continueTurn,
    regenerateLastResponse,
    rememberThis,
    updateBrainNow,
    updatePEComponentNow,
    suggestPlotUpdates,
    suggestCardUpdates,
    buildStoryCardMemory,
    buildPlotMemory,
    reconcileMemory,
    auditStoryCards,
    auditComponents,
    auditBrains,
    regenerateMemoryProposal,
    findEventMemories,
    regeneratePlotEssentials,
    generateComponent,
    generateArc,
    proposeArcFromHistory,
    generateBrainFromName,
    applyActionsAndPersist,
  };
}
