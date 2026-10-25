import { guardMemoryRequests } from "../providers/memoryCompletion";
import { flushSync } from "react-dom";
import { placementFingerprint } from "../memory/storyCardPlacement";
import { evaluateStoryCardEntries } from "../memory/evaluateStoryCardEntries";
import { subscribeApiCalls } from "../providers/apiCallAccounting";
import { ONE_PASS_MEMORY_ID, MEMORY_OUTPUT_RESERVE } from "../memory/onePassMemory";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { buildContext } from "../contextBuilder/contextBuilder";
import { saveAdventure } from "../db/adventureDb";
import { scanEventMemories } from "../memory/eventMemoryScan";
import { regenerateProposalContent } from "../memory/memoryDetection";
import { memoryCycleSources } from "../memory/memoryCycleState";
import { generateArcContinuations, generateArcDirector, generateArcFromHistory, generateBrainFromName as generateBrainEntry, generateComponentContent, pickConvergentContinuation } from "../ai/generators";
import { PLOT_ESSENTIALS_BEST_PRACTICES } from "../ai/authoringBestPractices";
import { runStoryCardAudit, type AuditRecommendation } from "../memory/storyCardAudit";
import { runComponentAudit, type ComponentAuditRecommendation } from "../memory/componentAudit";
import { runBrainAudit, type BrainAuditRecommendation } from "../memory/brainAudit";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { resolveBackgroundProviderConfig, resolveMemoryEvaluationProviderConfig } from "../providers/backgroundProvider";
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
  runMemoryCycle,
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
import type { MemoryWorkStatus, RuntimeProviderSettings } from "../pages/pageTypes";

function mergeProviderConfig(adventure: Adventure, settings: RuntimeProviderSettings): RuntimeProviderSettings {
  const sessionId = `ai-story-teller:${adventure.id}`.slice(0, 256);
  return { ...adventure.modelConfig, ...settings, apiKey: settings.apiKey, sessionId };
}

export function applyResponseLengthHint(config: RuntimeProviderSettings, hint: number, hiddenReserveTokens = 0): RuntimeProviderSettings {
  const wordTarget = Number.isFinite(hint) ? Math.max(50, Math.min(500, Math.round(hint))) : 250;
  const visibleTokenCap = Math.ceil(wordTarget * 1.5) + 80;
  const hiddenReserve = Math.max(0, Math.min(MEMORY_OUTPUT_RESERVE, Math.ceil(hiddenReserveTokens)));
  const lengthBoundedCap = visibleTokenCap + hiddenReserve;
  const configuredCap = Number.isFinite(config.maxOutputTokens) && config.maxOutputTokens > 0
    ? config.maxOutputTokens
    : lengthBoundedCap;
  return { ...config, maxOutputTokens: Math.min(configuredCap, lengthBoundedCap) };
}

function hiddenOutputReserveTokens(context: ContextBuildResult): number {
  return context.sections.some(s => s.items.some(i => i.id === ONE_PASS_MEMORY_ID)) ? MEMORY_OUTPUT_RESERVE : 0;
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
}): Promise<{ content: string; usage?: ProviderUsage; finishReason?: string; memoryDiscarded?: boolean; narrationRewritten?: boolean }> {
  const response = await sendOpenAICompatibleChatCompletion({ messages, config, purpose: "narration" });
  const guard = evaluateStoryResponseGuard(response.content, responseLengthHint, playerInput);
  if (!guard.needsCorrection) return response;

  const correctionMessages = buildStoryResponseCorrectionMessages({
    playerInput,
    draft: response.content,
    wordLimit: guard.visibleWordLimit,
    reasons: guard.reasons,
  });
  const hasMemoryInstruction = messages.some(message => message.content.includes("[ONE-PASS MEMORY]"));
  if (hasMemoryInstruction) {
    correctionMessages[0].content = correctionMessages[0].content
      .replace("Return only the corrected visible story response.", "Return the corrected story, then the hidden <memory_updates> envelope required by the supplied ONE-PASS MEMORY rules. Evaluate ONLY the corrected story, never discarded draft events.")
      .replace("or <memory> tags.", "or legacy <memory> tags. The required <memory_updates> JSON envelope is allowed and does not count toward the visible word limit.");
  }
  const correctedConfig = correctionConfig(config, responseLengthHint);
  const corrected = await sendOpenAICompatibleChatCompletion({
    // Retain canon and eligible Brain targets for evaluation of the rewritten source.
    messages: hasMemoryInstruction ? [...messages, ...correctionMessages] : correctionMessages,
    config: hasMemoryInstruction ? { ...correctedConfig, maxOutputTokens: correctedConfig.maxOutputTokens + MEMORY_OUTPUT_RESERVE } : correctedConfig,
    // This tightly constrained rewrite does not benefit from hidden reasoning. DeepSeek's
    // default thinking mode can otherwise consume the entire small correction budget.
    thinking: "disabled",
    purpose: "correction",
  });
  return { narrationRewritten: true, content: corrected.content, finishReason: corrected.finishReason, memoryDiscarded: !hasMemoryInstruction, usage: combineProviderUsage(response.usage, corrected.usage) };
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
  const [memoryWorkState, setMemoryWork] = useState<MemoryWorkStatus>();
  const memoryWorkerRef = useRef<{ adventureId: string; promise: Promise<void> } | undefined>(undefined);
  const memoryEpochRef = useRef(0);
  const isNarratingRef = useRef(false);
  const [error, setError] = useState<string | undefined>();
  const adventureRef = useRef<Adventure | undefined>(adventure);
  const providerSettingsRef = useRef(providerSettings);
  const globalMemorySettingsRef = useRef(globalMemorySettings);
  const isSubmittingRef = useRef(false);
  const semanticInFlight = useRef(new Set<string>());
  const arcInFlight = useRef(new Set<string>());
  const apiActionsRef = useRef<AdventureAction[]>([]);
  const queuedUpdatesRef = useRef<PendingAdventureUpdate[]>([]);
  const wasHiddenRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const continueTurnRef = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => { adventureRef.current = adventure; }, [adventure]);
  useEffect(() => {
    memoryEpochRef.current += 1;
    memoryWorkerRef.current = undefined;
    setMemoryWork(undefined);
    return () => { memoryEpochRef.current += 1; };
  }, [adventure?.id]);
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

  useEffect(() => subscribeApiCalls(record => {
    if (!adventureRef.current || record.sessionId !== `ai-story-teller:${adventureRef.current.id}`.slice(0, 256)) return;
    const action: AdventureAction = { type: "RECORD_API_CALL", record };
    if (isNarratingRef.current) apiActionsRef.current.push(action);
    else applyActionsAndPersist([action]);
  }), [applyActionsAndPersist]);

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
    adventureState = reduceActions(adventureState, apiActionsRef.current);
    apiActionsRef.current = [];
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

  function memoryFailures(snapshot: Adventure) {
    return snapshot.messages.filter(message => message.role === "assistant" && message.memoryEvaluation
      && (["failed", "quarantined", "running"].includes(message.memoryEvaluation.status)
        || message.memoryEvaluation.status === "pending" && message.memoryEvaluation.attempts > 0));
  }

  // Historical failures remain inspectable in Decisions, never a new load-time demand.
  const memoryWork = memoryWorkState?.adventureId === adventure?.id ? memoryWorkState : undefined;

  function continueWithExistingMemory() {
    if (!adventureRef.current || memoryWorkerRef.current) return;
    setMemoryWork(undefined);
  }

  async function prepareNarration() {
    const current = adventureRef.current;
    if (!current) return;
    // The UI permits composing, but a new context cannot overtake the ordered worker.
    if (memoryWorkerRef.current?.adventureId === current.id) await memoryWorkerRef.current.promise;
    const latest = adventureRef.current;
    if (!latest || latest.id !== current.id) return;
    // Use successful commits even if another group failed. Retry is a Memory action, not a prerequisite for Play.
    return flushPendingBeforeContext(latest);
  }

  function startIndependentMemory(initial: Adventure, sourceIds?: string[]): Promise<void> {
    if (memoryWorkerRef.current?.adventureId === initial.id) return memoryWorkerRef.current.promise;
    const selected = sourceIds ? initial.messages.filter(message => sourceIds.includes(message.id)
      && message.role === "assistant" && message.inputMode !== "comms" && message.memoryEvaluation?.status !== "complete").slice(0, 10)
      : memoryCycleSources(initial);
    if (!selected.length) return Promise.resolve();
    const epoch = memoryEpochRef.current;
    const currentJob = () => memoryEpochRef.current === epoch && adventureRef.current?.id === initial.id;
    const ids = selected.map(message => message.id);
    setMemoryWork({ adventureId: initial.id, status: "running", sourceIds: ids, remaining: ids.length });
    const persistActions = async (actions: AdventureAction[]) => {
      if (!currentJob()) return;
      let committed: Adventure | undefined;
      const pendingActions = apiActionsRef.current;
      apiActionsRef.current = [];
      const pendingUpdates = queuedUpdatesRef.current;
      queuedUpdatesRef.current = [];
      const allActions: AdventureAction[] = [...pendingActions,
        ...pendingUpdates.map(update => ({ type: "QUEUE_PENDING_UPDATE" as const, update })), ...actions];
      // Read the latest React state (including user edits) before persisting a group.
      // Drain queues once, outside the pure updater, including under StrictMode.
      flushSync(() => setAdventure(current => {
        if (!currentJob() || current?.id !== initial.id) return current;
        committed = reduceActions(current, allActions);
        return committed;
      }));
      if (!committed) return;
      adventureRef.current = committed;
      await saveAdventure(committed);
      return currentJob() ? adventureRef.current : undefined;
    };
    const promise = (async () => {
      try {
        for (const [index, selectedSource] of selected.entries()) {
          if (!currentJob()) return;
          const snapshot = adventureRef.current!;
          const source = snapshot.messages.find(message => message.id === selectedSource.id);
          if (!source || source.memoryEvaluation?.status === "complete") continue;
          setMemoryWork({ adventureId: initial.id, status: "running", sourceIds: ids, remaining: ids.length - index });
          let validConfig = true;
          try { resolveMemoryEvaluationProviderConfig(snapshot, mergeProviderConfig(snapshot, providerSettingsRef.current)); }
          catch { validConfig = false; }
          // Invalid configuration never consumes a claim or starts an HTTP request.
          const claimed = validConfig ? await persistActions([{ type: "CLAIM_MEMORY_EVALUATION", sourceId: source.id,
            turn: snapshot.activeState.memoryRecoveryStoryTurn ?? 0, manual: Boolean(sourceIds) }]) : snapshot;
          if (!claimed || !currentJob()) return;
          const memoryConfig = guardMemoryRequests(mergeProviderConfig(claimed, providerSettingsRef.current), currentJob);
          const result = await runMemoryCycle(claimed, memoryConfig, {
            sourceId: source.id, manual: Boolean(sourceIds), shouldContinue: currentJob,
            onProgress: group => { if (currentJob()) setMemoryWork({ adventureId: initial.id, status: "running",
              sourceIds: ids, remaining: ids.length - index, group }); },
            onGroupComplete: (commit, usage) => persistActions([commit, { type: "ACCUMULATE_BACKGROUND_TOKENS", ...usage }]),
          });
          if (!currentJob()) return;
          await persistActions(result.actions.filter(action => action.type !== "COMMIT_MEMORY_EVALUATION_GROUP"
            && action.type !== "ACCUMULATE_BACKGROUND_TOKENS"));
          const latestSource = adventureRef.current!.messages.find(message => message.id === source.id);
          if (sourceIds && latestSource?.memoryEvaluation?.status === "complete" && source.memoryRecovery?.status === "pending") {
            await persistActions([{ type: "COMPLETE_MEMORY_RECOVERY", sources: [{ id: source.id, content: source.content }], actions: [] }]);
          }
          if (!validConfig) break;
        }
        if (!currentJob()) return;
        const unfinished = ids.filter(id => adventureRef.current!.messages.some(message => message.id === id
          && message.memoryEvaluation?.status !== "complete"));
        setMemoryWork(unfinished.length ? { adventureId: initial.id, status: "failed", sourceIds: unfinished,
          remaining: unfinished.length, error: "Some memory checks could not finish. Completed groups are saved and Play can continue. A retry may incur API costs." } : undefined);
      } catch (error) {
        if (currentJob()) setMemoryWork({ adventureId: initial.id, status: "failed", sourceIds: ids, remaining: ids.length,
          error: error instanceof Error ? error.message : "Memory evaluation failed; story saved." });
      } finally {
        if (currentJob()) memoryWorkerRef.current = undefined;
      }
    })();
    memoryWorkerRef.current = { adventureId: initial.id, promise };
    return promise;
  }

  async function evaluateMemorySources(sourceIds: string[]) {
    const snapshot = adventureRef.current;
    if (!snapshot || loading || isSubmittingRef.current) return;
    if (!sourceIds.length || sourceIds.length > 10) throw new Error("Select one to ten completed sources.");
    await startIndependentMemory(snapshot, sourceIds);
  }

  async function retryMemory() {
    if (!adventureRef.current || memoryWorkerRef.current) return;
    const ids = memoryWork?.sourceIds.length ? memoryWork.sourceIds : memoryFailures(adventureRef.current).map(message => message.id);
    if (ids.length) await evaluateMemorySources(ids.slice(0, 10));
  }

  async function startPostTurnWork(snapshot: Adventure, includeArcContinuation = true) {
    const epoch = memoryEpochRef.current;
    await startIndependentMemory(snapshot);
    if (epoch !== memoryEpochRef.current || adventureRef.current?.id !== snapshot.id) return;
    const latest = adventureRef.current;
    void startSemanticEvaluation(latest);
    if (includeArcContinuation) void checkArcContinuation(latest);
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
      if (isNarratingRef.current) {
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

  async function submitTurn(text: string, mode: InputMode = "story"): Promise<boolean> {
    if (!adventure || loading || isSubmittingRef.current) return false;
    isSubmittingRef.current = true;
    setLoading(true);
    setError(undefined);

    let base: Adventure = adventure;
    let snapshotWithUserMsg: typeof adventure | undefined;

    try {
      const ready = await prepareNarration();
      if (!ready) return false;
      base = ready;
      if (mode !== "comms" && CHALLENGE_PHRASES.some(re => re.test(text))) base = adventureReducer(base, { type: "SET_CHALLENGE_MODE" });
      isNarratingRef.current = true;
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
            return sendOpenAICompatibleChatCompletion({ messages, config: storyConfig, purpose: "narration" });
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
      isNarratingRef.current = false;
      adventureRef.current = next;
      if (mode !== "comms") void startPostTurnWork(next);
      return true;
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
      const errorState = mergeQueuedUpdates(snapshotWithUserMsg ?? base);
      setAdventure(errorState);
      await saveAdventure(errorState);
      return snapshotWithUserMsg !== undefined;
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
      isNarratingRef.current = false;
      if (apiActionsRef.current.length) {
        const actions = apiActionsRef.current;
        apiActionsRef.current = [];
        applyActionsAndPersist(actions);
      }
      void refreshAdventures();
    }
  }

  async function continueTurn() {
    if (!adventure || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    setError(undefined);

    try {
      const base = await prepareNarration();
      if (!base) return;
      isNarratingRef.current = true;
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
      isNarratingRef.current = false;
      adventureRef.current = next;
      void startPostTurnWork(next);
    } catch (providerError) {
      setError(providerError instanceof Error ? providerError.message : "Continue failed.");
      const failed = mergeQueuedUpdates(adventure);
      setAdventure(failed);
      await saveAdventure(failed);
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
      isNarratingRef.current = false;
      if (apiActionsRef.current.length) {
        const actions = apiActionsRef.current;
        apiActionsRef.current = [];
        applyActionsAndPersist(actions);
      }
      void refreshAdventures();
    }
  }

  async function regenerateLastResponse() {
    if (!adventure || loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    setError(undefined);

    const ready = await prepareNarration();
    if (!ready) { isSubmittingRef.current = false; setLoading(false); return; }
    isNarratingRef.current = true;
    let next = ready;
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
      isNarratingRef.current = false;
      adventureRef.current = next;
      void startPostTurnWork(next, false);
    } catch (providerError) {
      setError(providerError instanceof Error ? providerError.message : "Regeneration failed.");
      const failed = mergeQueuedUpdates(adventure);
      setAdventure(failed);
      await saveAdventure(failed);
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
      isNarratingRef.current = false;
      if (apiActionsRef.current.length) {
        const actions = apiActionsRef.current;
        apiActionsRef.current = [];
        applyActionsAndPersist(actions);
      }
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

  async function evaluateStoryCards(sourceIds: string[]): Promise<void> {
    const snapshot = adventureRef.current;
    if (!snapshot || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await evaluateStoryCardEntries(snapshot, buildBackgroundConfig(snapshot, providerSettingsRef.current), sourceIds);
      if (adventureRef.current?.id !== snapshot.id) return;
      applyActionsAndPersist([...result.actions, { type: "ACCUMULATE_BACKGROUND_TOKENS", ...result.tokenUsage }]);
      if (!result.valid) throw new Error(result.error ?? "Model evaluation failed; local candidates were retained for review.");
      if ((result.processedSources?.length ?? 0) < sourceIds.length) throw new Error("The request budget allowed only part of the range. Evaluated sources were retained; select the remaining entries to continue.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Story Card evaluation failed.");
      throw err;
    } finally { setLoading(false); }
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

  async function regenerateMemoryProposal(proposalId: string, convertToLore = false): Promise<void> {
    if (!adventure) return;
    const proposal = adventure.activeState.memoryProposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const reviewedPatch = await regenerateProposalContent(proposal, adventure, activeProviderConfig, convertToLore);
    if (!reviewedPatch.content) return;
    applyActionsAndPersist([{ type: "UPDATE_MEMORY_PROPOSAL", proposalId, expectedFingerprint: placementFingerprint(proposal), patch: reviewedPatch }]);
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
    memoryWork,
    retryMemory,
    continueWithExistingMemory,
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
    evaluateStoryCards,
    evaluateMemorySources,
    regeneratePlotEssentials,
    generateComponent,
    generateArc,
    proposeArcFromHistory,
    generateBrainFromName,
    applyActionsAndPersist,
  };
}
