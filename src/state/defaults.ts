import type {
  Adventure,
  ArcPacingState,
  BackgroundProviderConfig,
  BrainEntry,
  ComponentEntry,
  MemoryAutoApproveSettings,
  MemoryDetectionSettings,
  NextTurnNote,
  ProviderConfig,
  SemanticEvaluationSettings,
  StoryCard,
  SystemTriggerSettings,
  TokenBudgetSettings,
  TriggerRule,
  ProviderRequestThrottle,
} from "../types/adventure";
import { dedupeBrainThoughts } from "../memory/thoughtDedupe";
import { applyGuardedStoryCardPolicy, restoreGuardedFactsToLiveContent } from "../memory/storyCardPolicy";
import { createId, nowIso } from "../utils/id";

export const defaultTokenBudgetSettings: TokenBudgetSettings = {
  maxContextTokens: 16000,
  maxRecentMessages: 40,
  memoryPriorityMode: "userLocked",
  allowSystemToPrioritizeMemory: false,
  allowSystemToDropUnpinnedTriggeredCards: true,
  allowSystemToTruncateSummary: true,
  recentMessageWindow: 12,
  sectionBudgets: {
    rollingSummary: 1800,
    sceneState: 400,
    recentMessages: 6000,
  },
  autoSummarize: true,
  autoSummarizeEveryNTurns: 20,
  autoSceneStateEveryNTurns: 1,
  sceneStateEnabled: true,
  summaryEnabled: true,
};

export const lightTokenBudgetPreset: Partial<TokenBudgetSettings> = {
  maxContextTokens: 8000,
  maxRecentMessages: 15,
  sectionBudgets: { rollingSummary: 800, recentMessages: 3000 },
  autoSummarize: true,
  autoSummarizeEveryNTurns: 10,
};

export const heavyTokenBudgetPreset: Partial<TokenBudgetSettings> = {
  maxContextTokens: 32000,
  maxRecentMessages: 80,
  sectionBudgets: { rollingSummary: 4000, recentMessages: 12000 },
  autoSummarize: true,
  autoSummarizeEveryNTurns: 30,
};

export const defaultProviderRequestThrottle: ProviderRequestThrottle = {
  enabled: false,
  minSecondsBetweenRequests: 2,
  maxRequestsPerMinute: 20,
};

export const defaultModelConfig: ProviderConfig = {
  name: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  // Storytelling profile (mirrors AID): cooler temp + nucleus trim + a strong presence penalty so
  // prose stays coherent without looping. topK left unset — DeepSeek rejects it; set it per-provider.
  temperature: 0.7,
  maxOutputTokens: 1200,
  topP: 0.95,
  presencePenalty: 0.8,
  frequencyPenalty: 0,
  requestThrottle: defaultProviderRequestThrottle,
  promptCaching: true,
};

export const defaultSemanticEvaluationSettings: SemanticEvaluationSettings = {
  evaluationModel: "",
  messagesIncluded: 8,
  enabled: true,
  showLog: true,
  maxParallelUpdateCalls: 3,
  requireApprovalForAutoUpdates: true,
  semanticEvalEveryNTurns: 1,
};

export const defaultMemoryDetectionSettings: MemoryDetectionSettings = {
  enabled: true,
  generateContent: true,
  everyNTurns: 1,
};

export const defaultMemoryAutoApproveSettings: MemoryAutoApproveSettings = {
  summaryUpdate: false,
  plotEssentialsUpdate: false,
  currentArcUpdate: false,
  arcProposal: false,
  plotPressureUpdate: true,
  plotMomentumUpdate: false,
  storyCard: false,
  brainUpdate: false,
  relationshipUpdate: false,
};

export const defaultSystemTriggerSettings: SystemTriggerSettings = {
  enabled: true,
  categories: {
    character_reveal: true,
    world_fact: true,
    // Balanced by default: the prompt asks for one strongest durable update per response,
    // and reducer dedupe guards repeated event cards.
    relationship: true,
    plot_beat: true,
    status_change: true,
  },
};


export function defaultNextTurnNote(): NextTurnNote {
  return {
    content: "",
    active: true,
    pinned: true,
    protected: false,
    priority: 85,
    expiresAfterUse: true,
  };
}

function clampSummaryIndex(index: number | undefined, messageCount: number): number | undefined {
  if (index === undefined) return undefined;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.floor(index), messageCount));
}

const legacyDefaultNarrationRulesContent = `You are the narrator of a collaborative interactive fiction adventure.
Continue the story in response to the player, then leave the scene open for their next action.

END OPEN: Never resolve a decision for the player. End each response on an actionable moment, not a conclusion. Do NOT end with explicit choices, questions directed at the player, or option menus ("Want to X, or Y?"). End at a natural story beat — the player decides what happens next.

PERSPECTIVE: Follow the perspective the player has established — first person, second person, or third person. Match it exactly. Do not override or reassign it.

PLAYER INPUT MODES:
- Messages starting with "You " are direct player actions. Continue the scene from them.
- Plain narrative messages are story direction from the author. Incorporate and continue.
- [Out of Character: ...] messages are author notes. Step out of the story, respond briefly as a collaborator, then stop. Do not write story prose in this mode.

CONTINUITY: All context sections (plot essentials, story cards, character brains, rolling summary) are established canon. Never contradict them. When details are absent, invent consistently with what is established. Even if this adventure uses names, places, factions, or concepts from a published setting or fandom, the adventure context is the only canon. Do not import outside biography, relationships, motives, powers, locations, or events unless they are established in the active context.

TONE: Match the tone the adventure has established. Do not break the fourth wall, moralize, or editorialize unless in [Out of Character] mode.

CHARACTERS: Every character with a Story Card has an established voice, history, and personality. Write them from their card — their speech patterns, concerns, and reactions must reflect what is established. Do not flatten characters into generic helpful or friendly behavior. If two characters would respond differently to the same situation, write them differently. A character's card is their identity; treat it as binding. If a familiar or famous character name appears without a matching active Story Card, Brain, Plot Essential, or Recent Message detail, treat those missing details as unknown instead of filling them from outside canon.

LANGUAGE: Write only in the language the player is using. Never translate or repeat the response in another language. One language, one response.

NARRATOR STANCE: Never flag a decision point. Never write "the choice is yours," "she's leaving it up to you," or any line that announces the player has options. The player always has options — the narrator does not need to say so. End at a story beat. The player acts next.

SCENE TRANSITIONS: Do not skip or decide meaningful player choices — if an NPC proposes going somewhere and the player hasn't agreed, end at the threshold. But if the player's action clearly implies movement ("I follow her," "we head to the market"), carry through it naturally. Don't stall the camera when the player has already moved. The rule is: don't resolve decisions the player hasn't made, not "never move."

PROSE: Write with varied sentence rhythm — short punchy lines for action, longer sentences for atmosphere or tension. Favor dialogue, physical behavior, and sensory detail over internal summary or exposition. Scenes should feel like they are happening, not being described.`;

export const defaultNarrationRulesContent = `You are the narrator of a collaborative interactive fiction adventure.
Continue the active scene in response to the player, keeping the fiction live and unresolved.

END OPEN: Never resolve a meaningful decision for the player. Do NOT end with explicit choices, questions directed at the player, option menus ("Want to X, or Y?"), summaries, fade-outs, or tidy scene conclusions. Write only the next immediate consequence, NPC reaction, dialogue exchange, or motion needed to keep the scene live, then stop when the player could reasonably act.

PERSPECTIVE: Follow the perspective the player has established — first person, second person, or third person. Match it exactly. Do not override or reassign it.

PLAYER INPUT MODES:
- Messages starting with "You " are direct player actions. Continue the scene from them.
- Plain narrative messages are story direction from the author. Incorporate and continue.
- [Out of Character: ...] messages are author notes. Step out of the story, respond briefly as a collaborator, then stop. Do not write story prose in this mode.

CONTINUITY: All context sections (plot essentials, story cards, character brains, rolling summary) are established canon. Never contradict them. When details are absent, invent consistently with what is established. Even if this adventure uses names, places, factions, or concepts from a published setting or fandom, the adventure context is the only canon. Do not import outside biography, relationships, motives, powers, locations, or events unless they are established in the active context.

TONE: Match the tone the adventure has established. Do not break the fourth wall, moralize, or editorialize unless in [Out of Character] mode.

CHARACTERS: Every character with a Story Card has an established voice, history, and personality. Write them from their card — their speech patterns, concerns, and reactions must reflect what is established. Do not flatten characters into generic helpful or friendly behavior. If two characters would respond differently to the same situation, write them differently. A character's card is their identity; treat it as binding. If a familiar or famous character name appears without a matching active Story Card, Brain, Plot Essential, or Recent Message detail, treat those missing details as unknown instead of filling them from outside canon.

LANGUAGE: Write only in the language the player is using. Never translate or repeat the response in another language. One language, one response.

NARRATOR STANCE: Never flag a decision point. Never write "the choice is yours," "she's leaving it up to you," or any line that announces the player has options. The player always has options — the narrator does not need to say so. Stop before deciding the player's exact words, reactions, commitments, movement, consent, or major actions. Keep the scene responsive, not exhaustive.

SCENE TRANSITIONS: Do not skip or decide meaningful player choices — if an NPC proposes going somewhere and the player hasn't agreed, stay with the live moment instead of narrating the whole trip. But if the player's action clearly implies movement ("I follow her," "we head to the market"), carry through it naturally. Don't stall the camera when the player has already moved. The rule is: don't resolve decisions the player hasn't made, not "never move."

PROSE: Write with varied sentence rhythm — short punchy lines for action, longer sentences for atmosphere or tension. Favor dialogue, physical behavior, and sensory detail over internal summary or exposition. Scenes should feel like they are happening, not being described.`;

export function createDefaultAdventure(title = "Untitled Adventure"): Adventure {
  const timestamp = nowIso();
  return {
    id: createId("adv"),
    title,
    openingScene: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {},
    autoSaveEnabled: true,
    autoSaveEveryNTurns: 3,
    components: [
      makeComponent({
        title: "Global Generation Rules",
        type: "narrationRules",
        content: defaultNarrationRulesContent,
        priority: 100,
        alwaysOn: true,
        pinned: true,
      }),
      makeComponent({ title: "Active Pressure", type: "activePressure", content: "", priority: 245, active: true }),
    ],
    storyCards: [],
    brains: [],
    triggerRules: [],
    rollingSummary: { content: "", updatedAt: timestamp },
    sceneState: { content: "", updatedAt: timestamp },
    messages: [],
    activeState: {
      turn: 0,
      forceIncludeNextTurn: [],
      triggerLog: [],
      evaluationLog: [],
      memoryProposals: [],
      pendingUpdates: [],
      storyUndoStack: [],
      storyRedoStack: [],
      nextTurnNote: defaultNextTurnNote(),
      rawImports: [],
      stateFlags: {},
      responseLengthHint: 250,
      backgroundTokenUsage: { promptTokens: 0, completionTokens: 0 },
      challengeMode: false,
      lastMemoryCycleTurn: undefined,
    },
    tokenBudgetSettings: defaultTokenBudgetSettings,
    modelConfig: defaultModelConfig,
    semanticEvaluationSettings: defaultSemanticEvaluationSettings,
    memoryAutoApprove: { ...defaultMemoryAutoApproveSettings },
    memoryDetectionSettings: defaultMemoryDetectionSettings,
    systemTriggers: defaultSystemTriggerSettings,
  };
}

export function makeComponent(
  overrides: Partial<ComponentEntry> & Pick<ComponentEntry, "title" | "content">,
): ComponentEntry {
  const timestamp = nowIso();
  const type = overrides.type ?? "custom";
  const defaultProtected = type === "narrationRules" || type === "aiInstructions" || type === "plotEssentials" || type === "authorNote";
  const alwaysOn = overrides.alwaysOn ?? false;
  return {
    id: overrides.id ?? createId("component"),
    title: overrides.title,
    type,
    content: overrides.content,
    arcPremise: overrides.arcPremise,
    arcThreadKeys: overrides.arcThreadKeys,
    arcPace: overrides.arcPace,
    arcTriggerMode: overrides.arcTriggerMode,
    arcSimmerInstruction: overrides.arcSimmerInstruction,
    arcBreakInstruction: overrides.arcBreakInstruction,
    arcState: overrides.arcState ?? (type === "currentArc" ? defaultArcState() : undefined),
    priority: overrides.priority ?? 0,
    alwaysOn,
    active: overrides.active ?? true,
    pinned: overrides.pinned ?? false,
    protected: overrides.protected ?? defaultProtected,
    inclusionPolicy: overrides.inclusionPolicy ?? (alwaysOn || defaultProtected ? "always" : "manual"),
    state: overrides.state ?? "",
    tokenBudget: overrides.tokenBudget,
    autoUpdate: overrides.autoUpdate,
    lastAutoUpdateTurn: overrides.lastAutoUpdateTurn,
    lastMemoryUpdatedAt: overrides.lastMemoryUpdatedAt,
    memoryUpdateHistory: overrides.memoryUpdateHistory,
    autoUpdateCooldownTurns: overrides.autoUpdateCooldownTurns,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  };
}

export function defaultArcState(): ArcPacingState {
  return { phase: "simmer", tier: 0, threadEngagement: {}, pendingBreak: false };
}

export function makeStoryCard(overrides: Partial<StoryCard> & Pick<StoryCard, "title" | "content">): StoryCard {
  const timestamp = nowIso();
  const memoryMode = overrides.type === "event" ? "historical" : overrides.memoryMode ?? "static";
  return {
    id: overrides.id ?? createId("story"),
    title: overrides.title,
    keys: overrides.keys ?? [],
    matchType: overrides.matchType ?? "phrase",
    content: overrides.content,
    type: overrides.type ?? "custom",
    eventMemory: overrides.eventMemory,
    memoryMode,
    compactKind: overrides.compactKind,
    compactStatus: overrides.compactStatus,
    coreFacts: overrides.coreFacts,
    currentFacts: overrides.currentFacts,
    recentDevelopments: overrides.recentDevelopments,
    sourceTurnIds: overrides.sourceTurnIds,
    active: overrides.active ?? true,
    pinned: overrides.pinned ?? false,
    protected: overrides.protected ?? false,
    inclusionPolicy: overrides.inclusionPolicy ?? "triggered",
    priority: overrides.priority ?? 0,
    autoUpdate: overrides.type === "event" ? false : overrides.autoUpdate ?? false,
    autoUpdateCooldownTurns: overrides.autoUpdateCooldownTurns ?? 3,
    lastAutoUpdateTurn: overrides.lastAutoUpdateTurn,
    lastMemoryUpdatedAt: overrides.lastMemoryUpdatedAt,
    memoryUpdateHistory: overrides.memoryUpdateHistory,
    state: overrides.state ?? "",
    tokenBudget: overrides.tokenBudget,
    archivedFacts: overrides.archivedFacts,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  };
}

/**
 * True if `name` refers to this card — by its exact title OR any of its trigger keys (aliases),
 * case-insensitive. Used so a development about "Toph" lands on the "Toph Beifong" card (whose keys
 * include "Toph") instead of spawning a duplicate.
 */
export function cardMatchesName(card: Pick<StoryCard, "title" | "keys">, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (card.title.trim().toLowerCase() === n) return true;
  return (card.keys ?? []).some((k) => k.trim().toLowerCase() === n);
}

export function makeBrain(overrides: Partial<BrainEntry> & Pick<BrainEntry, "characterName">): BrainEntry {
  const timestamp = nowIso();
  return {
    id: overrides.id ?? createId("brain"),
    characterName: overrides.characterName,
    triggers: overrides.triggers ?? [],
    source: overrides.source ?? "manual",
    currentState: overrides.currentState ?? "",
    thoughts: overrides.thoughts ?? {},
    archivedThoughts: overrides.archivedThoughts ?? {},
    linkedStoryCardId: overrides.linkedStoryCardId,
    relationships: overrides.relationships ?? [],
    relationshipPressure: overrides.relationshipPressure ?? "",
    emotionalInterpretation: overrides.emotionalInterpretation ?? "",
    recentDevelopments: overrides.recentDevelopments ?? "",
    notes: overrides.notes ?? "",
    active: overrides.active ?? true,
    pinned: overrides.pinned ?? false,
    protected: overrides.protected ?? false,
    inclusionPolicy: overrides.inclusionPolicy ?? "triggered",
    priority: overrides.priority ?? 0,
    tokenBudget: overrides.tokenBudget,
    updateCondition:
      overrides.updateCondition ??
      `when ${overrides.characterName} appears in the scene or is meaningfully referenced`,
    updatePrompt: overrides.updatePrompt ?? "",
    // Brains accumulate thoughts by default (Inner Self style). "replace" keeps only
    // the latest thought and is opt-in via the Brains UI dropdown.
    updateMode: overrides.updateMode ?? "append",
    condenseThreshold: overrides.condenseThreshold,
    autoUpdateCooldownTurns: overrides.autoUpdateCooldownTurns,
    lastUpdatedTurn: overrides.lastUpdatedTurn,
    lastUpdatedAt: overrides.lastUpdatedAt,
    lastGeneratedUpdatePreview: overrides.lastGeneratedUpdatePreview,
    printThoughts: overrides.printThoughts ?? false,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  };
}


export function makeTriggerRule(overrides: Partial<TriggerRule> & Pick<TriggerRule, "name">): TriggerRule {
  const timestamp = nowIso();
  return {
    id: overrides.id ?? createId("trigger"),
    name: overrides.name,
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? "both",
    evaluationMode: overrides.evaluationMode ?? "semantic",
    condition: overrides.condition ?? "",
    updatePrompt: overrides.updatePrompt ?? "",
    matchType: overrides.matchType ?? "keyword",
    patterns: overrides.patterns ?? [],
    conditions: overrides.conditions ?? [],
    actions: overrides.actions ?? [],
    priority: overrides.priority ?? 0,
    cooldownTurns: overrides.cooldownTurns ?? 0,
    lastFiredTurn: overrides.lastFiredTurn,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
  };
}

function migrateThoughts(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, string>;
  if (typeof raw === "string" && raw.trim()) return { legacy: raw.trim() };
  return {};
}

function migrateBrainThoughts(brain: BrainEntry): Pick<BrainEntry, "thoughts" | "archivedThoughts"> {
  return dedupeBrainThoughts(
    migrateThoughts((brain as unknown as Record<string, unknown>).thoughts),
    brain.archivedThoughts ?? {},
  );
}

function normalizedStoryText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function removeMirroredOpeningMessage(adventure: Adventure): Adventure["messages"] {
  const messages = adventure.messages ?? [];
  const openingScene = normalizedStoryText(adventure.openingScene ?? "");
  const firstMessage = messages[0];
  if (
    openingScene &&
    firstMessage?.role === "assistant" &&
    normalizedStoryText(firstMessage.content) === openingScene
  ) {
    return messages.slice(1);
  }
  return messages;
}

function normalizeComponentEntry(component: ComponentEntry): ComponentEntry {
  const isLegacyStockNarrationRules =
    component.type === "narrationRules" &&
    component.title === "Global Generation Rules" &&
    normalizedStoryText(component.content) === normalizedStoryText(legacyDefaultNarrationRulesContent);

  return isLegacyStockNarrationRules
    ? { ...component, content: defaultNarrationRulesContent }
    : component;
}

function normalizeStoryCardEntry(card: StoryCard, migrateGuardedFacts: boolean): StoryCard {
  const normalized: StoryCard = {
    ...card,
    matchType: card.matchType ?? "phrase",
    memoryMode: card.type === "event" ? "historical" : card.memoryMode ?? (
      (card.state ?? "").split(/\s+/).includes("living")
        ? "living"
        : (card.state ?? "").split(/\s+/).includes("archivedArc")
          ? "historical"
          : "static"
    ),
    protected: card.protected ?? false,
    inclusionPolicy: card.inclusionPolicy ?? "triggered",
    autoUpdate: card.type === "event" ? false : card.autoUpdate ?? false,
    autoUpdateCooldownTurns: card.autoUpdateCooldownTurns ?? 3,
    coreFacts: card.coreFacts ?? [],
    currentFacts: card.currentFacts ?? [],
    recentDevelopments: card.recentDevelopments ?? [],
    sourceTurnIds: card.sourceTurnIds ?? [],
  };
  return migrateGuardedFacts
    ? applyGuardedStoryCardPolicy(restoreGuardedFactsToLiveContent(normalized))
    : normalized;
}

function persistedProviderConfig(config: ProviderConfig | undefined): Partial<ProviderConfig> {
  if (!config) return {};
  const { apiKey: _apiKey, sessionId: _sessionId, ...persisted } = config;
  return persisted;
}

export function persistedBackgroundProviderConfig(
  config: BackgroundProviderConfig | undefined,
): BackgroundProviderConfig | undefined {
  if (!config) return undefined;
  const baseUrl = config.baseUrl?.trim() ?? "";
  const model = config.model?.trim() ?? "";
  if (!baseUrl && !model) return undefined;
  return { baseUrl, model };
}

export function persistedSemanticEvaluationSettings(
  settings: SemanticEvaluationSettings | undefined,
): SemanticEvaluationSettings {
  const merged = {
    ...defaultSemanticEvaluationSettings,
    ...(settings ?? {}),
    semanticEvalEveryNTurns: settings?.semanticEvalEveryNTurns ?? 1,
  };
  const backgroundProviderConfig = persistedBackgroundProviderConfig(merged.backgroundProviderConfig);
  return {
    ...merged,
    ...(backgroundProviderConfig ? { backgroundProviderConfig } : { backgroundProviderConfig: undefined }),
  };
}

export function sanitizeAdventureForPersistence(adventure: Adventure): Adventure {
  return {
    ...adventure,
    modelConfig: persistedProviderConfig(adventure.modelConfig) as ProviderConfig,
    semanticEvaluationSettings: persistedSemanticEvaluationSettings(adventure.semanticEvaluationSettings),
  };
}

export function normalizeAdventure(adventure: Adventure): Adventure {
  const baseline = createDefaultAdventure(adventure.title || "Untitled Adventure");
  const messages = removeMirroredOpeningMessage(adventure);
  const migrateGuardedStoryCards = !adventure.activeState?.stateFlags?.compactStoryCardsMigrated;
  return {
    ...baseline,
    ...adventure,
    openingScene: adventure.openingScene ?? "",
    messages,
    metadata: adventure.metadata ?? {},
    autoSaveEnabled: adventure.autoSaveEnabled ?? true,
    autoSaveEveryNTurns: adventure.autoSaveEveryNTurns ?? 3,
    activeState: {
      ...baseline.activeState,
      ...adventure.activeState,
      evaluationLog: adventure.activeState?.evaluationLog ?? [],
      memoryProposals: adventure.activeState?.memoryProposals ?? [],
      pendingUpdates: adventure.activeState?.pendingUpdates ?? [],
      storyUndoStack: adventure.activeState?.storyUndoStack ?? [],
      storyRedoStack: adventure.activeState?.storyRedoStack ?? [],
      nextTurnNote: {
        ...defaultNextTurnNote(),
        ...(adventure.activeState?.nextTurnNote ?? {}),
      },
      rawImports: adventure.activeState?.rawImports ?? [],
      stateFlags: {
        ...(adventure.activeState?.stateFlags ?? {}),
        brainsAppendMigrated: true,
        guardedStoryCardsMigrated: true,
        compactStoryCardsMigrated: true,
      },
      triggerLog: adventure.activeState?.triggerLog ?? [],
      forceIncludeNextTurn: adventure.activeState?.forceIncludeNextTurn ?? [],
      // Coerce old string hints ("short"/"medium"/"long") from pre-slider saves to numbers
      responseLengthHint: typeof adventure.activeState?.responseLengthHint === "number"
        ? adventure.activeState.responseLengthHint
        : adventure.activeState?.responseLengthHint === "short" ? 75
        : adventure.activeState?.responseLengthHint === "long" ? 175
        : 150,
      backgroundTokenUsage: adventure.activeState?.backgroundTokenUsage ?? { promptTokens: 0, completionTokens: 0 },
      challengeMode: adventure.activeState?.challengeMode ?? false,
      lastMemoryCycleTurn: adventure.activeState?.lastMemoryCycleTurn,
      lastSemanticEvalTurn: adventure.activeState?.lastSemanticEvalTurn,
      lastSceneStateTurn: adventure.activeState?.lastSceneStateTurn,
    },
    rollingSummary: {
      ...baseline.rollingSummary,
      ...(adventure.rollingSummary ?? {}),
      lastSummarizedMessageIndex: clampSummaryIndex(
        adventure.rollingSummary?.lastSummarizedMessageIndex,
        messages.length,
      ),
    },
    sceneState: adventure.sceneState ?? { content: "", updatedAt: nowIso() },
    brains: (adventure.brains ?? []).map((brain) => ({
      ...brain,
      relationships: brain.relationships ?? [],
      source: brain.source ?? "manual",
      protected: brain.protected ?? false,
      inclusionPolicy: brain.inclusionPolicy ?? "triggered",
      updateCondition: (() => {
        const old = brain.updateCondition?.trim();
        if (!old || /^when \S.* appears in the scene or is meaningfully referenced$/.test(old)) {
          return `when something in this scene causes a genuine shift for ${brain.characterName}: a new realization, emotional pivot, changed read on another character, or meaningful reaction to events — do NOT fire just because they appear or speak`;
        }
        return old;
      })(),
      updatePrompt: brain.updatePrompt ?? "",
      // One-time migration: brains created under the old "replace" default never
      // accumulated thoughts. Flip them to "append" once (gated by the stateFlag
      // below) so existing adventures heal; users can still opt back to replace.
      updateMode: !adventure.activeState?.stateFlags?.brainsAppendMigrated && (brain.updateMode ?? "replace") === "replace"
        ? "append"
        : (brain.updateMode ?? "append"),
      ...migrateBrainThoughts(brain),
      linkedStoryCardId: brain.linkedStoryCardId,
    })),
    storyCards: (adventure.storyCards ?? []).map((card) => normalizeStoryCardEntry(card, migrateGuardedStoryCards)),
    components: (() => {
      const existing = adventure.components ?? baseline.components;
      const normalized = existing.map((component) => {
        const migrated = normalizeComponentEntry(component);
        const defaultProtected =
          migrated.type === "narrationRules" || migrated.type === "aiInstructions" || migrated.type === "plotEssentials" || migrated.type === "authorNote";
        return {
          ...migrated,
          protected: migrated.protected ?? defaultProtected,
          inclusionPolicy: migrated.inclusionPolicy ?? (migrated.alwaysOn || defaultProtected ? "always" : "manual"),
          // Arc Director: every Current Arc carries pacing state so the gate has something to read.
          // No behavior change until the user actually configures threads + a break instruction.
          arcState: migrated.type === "currentArc" ? (migrated.arcState ?? defaultArcState()) : migrated.arcState,
        };
      });
      // Deduplicate singleton types: keep the first occurrence of each singleton type.
      // This fixes adventures that were created with duplicate narrationRules (or other
      // singleton) components due to a bug in createAdventure merging baseline + setup.
      const singletonTypes = new Set(["narrationRules", "aiInstructions", "plotEssentials", "authorNote", "currentArc"]);
      const seenSingletons = new Set<string>();
      const deduped = normalized.filter((component) => {
        if (!singletonTypes.has(component.type)) return true;
        if (seenSingletons.has(component.type)) return false;
        seenSingletons.add(component.type);
        return true;
      });
      const hasActivePressure = deduped.some((c) => c.type === "activePressure");
      return [
        ...deduped,
        ...(hasActivePressure ? [] : [makeComponent({ title: "Active Pressure", type: "activePressure", content: "", priority: 245, active: true })]),
      ];
    })(),
    triggerRules: (adventure.triggerRules ?? []).map((rule) => ({
      ...rule,
      evaluationMode: rule.evaluationMode ?? "semantic",
      condition: rule.condition ?? "",
      updatePrompt: rule.updatePrompt ?? "",
    })),
    semanticEvaluationSettings: persistedSemanticEvaluationSettings(adventure.semanticEvaluationSettings),
    memoryAutoApprove: {
      ...defaultMemoryAutoApproveSettings,
      ...(adventure.memoryAutoApprove ?? {}),
      plotMomentumUpdate: false,
    },
    memoryDetectionSettings: {
      ...defaultMemoryDetectionSettings,
      ...(adventure.memoryDetectionSettings ?? {}),
    },
    systemTriggers: {
      ...defaultSystemTriggerSettings,
      ...(adventure.systemTriggers ?? {}),
      categories: {
        ...defaultSystemTriggerSettings.categories,
        ...(adventure.systemTriggers?.categories ?? {}),
      },
    },
    tokenBudgetSettings: {
      ...defaultTokenBudgetSettings,
      ...(adventure.tokenBudgetSettings ?? {}),
      // Ensure new fields always present even on old saves
      autoSummarize: adventure.tokenBudgetSettings?.autoSummarize ?? true,
      autoSummarizeEveryNTurns: adventure.tokenBudgetSettings?.autoSummarizeEveryNTurns ?? 20,
      autoSceneStateEveryNTurns: adventure.tokenBudgetSettings?.autoSceneStateEveryNTurns ?? 1,
      sceneStateEnabled: adventure.tokenBudgetSettings?.sceneStateEnabled ?? true,
    },
    modelConfig: {
      ...defaultModelConfig,
      ...persistedProviderConfig(adventure.modelConfig),
      requestThrottle: {
        ...defaultProviderRequestThrottle,
        ...(adventure.modelConfig?.requestThrottle ?? {}),
      },
    },
  };
}
