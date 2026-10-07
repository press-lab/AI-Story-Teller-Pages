import { applyRelationship, duplicateRelationship, relationshipFocusCard, relationshipIsCurrent, stateKey, validRelationshipState } from "../memory/relationships";
import { sameEventMemory } from "../memory/eventMemory";
import type {
  Adventure,
  AdventureAction,
  ArcPace,
  ArcPacingState,
  ArcPhase,
  ArcTriggerMode,
  BrainEntry,
  BrainPatch,
  BrainStateField,
  ComponentEntry,
  MemoryUpdateHistoryEntry,
  MemoryUpdateOperation,
  MemoryUpdateSnapshot,
  MemoryUpdateSource,
  MemoryProposal,
  Message,
  ProviderConfig,
  RawImportEntry,
  StoryEditHistoryEntry,
  StoryEditPatch,
  StoryCard,
  TriggerRule,
} from "../types/adventure";
import { defaultArcState, defaultNextTurnNote, makeComponent, makeStoryCard } from "./defaults";
import { createId, nowIso } from "../utils/id";
import { isLivingStoryCard, resolveMemoryTarget, sanitizeStoryCardTriggers } from "../memory/resolveMemoryTarget";
import {
  appendSourceTurnIds,
  applyGuardedStoryCardPolicy,
  isGuardedStoryCardFact,
  isGuardedStoryCardMemory,
  normalizeStoryCardFact,
  restoreGuardedFactsToLiveContent,
} from "../memory/storyCardPolicy";
import { dedupeBrainThoughts, normalizeThoughtForDedupe } from "../memory/thoughtDedupe";

function touch<T extends { updatedAt: string }>(entry: T): T {
  return { ...entry, updatedAt: nowIso() };
}

interface MemoryUpdateMeta {
  source: MemoryUpdateSource;
  operation: MemoryUpdateOperation;
  proposalId?: string;
  sourceTurnId?: string;
}

function componentMemorySnapshot(component: ComponentEntry): MemoryUpdateSnapshot {
  return {
    title: component.title,
    content: component.content,
    state: component.state,
    type: component.type,
    arcPremise: component.arcPremise,
    arcThreadKeys: component.arcThreadKeys ? [...component.arcThreadKeys] : undefined,
    arcSimmerInstruction: component.arcSimmerInstruction,
    arcBreakInstruction: component.arcBreakInstruction,
    arcPhase: component.arcState?.phase,
  };
}

function storyCardMemorySnapshot(card: StoryCard): MemoryUpdateSnapshot {
  return {
    title: card.title,
    content: card.content,
    state: card.state,
    keys: [...card.keys],
    type: card.type,
    eventMemory: card.eventMemory,
    memoryMode: card.memoryMode,
    compactKind: card.compactKind,
    compactStatus: card.compactStatus,
    coreFacts: card.coreFacts ? [...card.coreFacts] : undefined,
    currentFacts: card.currentFacts ? [...card.currentFacts] : undefined,
    recentDevelopments: card.recentDevelopments ? [...card.recentDevelopments] : undefined,
    sourceTurnIds: card.sourceTurnIds ? [...card.sourceTurnIds] : undefined,
    archivedFacts: card.archivedFacts,
  };
}

function memoryHistoryEntry(
  previous: MemoryUpdateSnapshot | null,
  next: MemoryUpdateSnapshot,
  meta: MemoryUpdateMeta,
  timestamp: string,
): MemoryUpdateHistoryEntry {
  return {
    id: createId("memoryRevision"),
    source: meta.source,
    operation: meta.operation,
    proposalId: meta.proposalId,
    sourceTurnId: meta.sourceTurnId,
    previous,
    next,
    updatedAt: timestamp,
  };
}

function recordComponentMemoryUpdate(
  previous: ComponentEntry | undefined,
  next: ComponentEntry,
  meta: MemoryUpdateMeta,
): ComponentEntry {
  const timestamp = nowIso();
  const stamped = { ...next, updatedAt: timestamp, lastMemoryUpdatedAt: timestamp };
  return {
    ...stamped,
    memoryUpdateHistory: [
      ...(previous?.memoryUpdateHistory ?? next.memoryUpdateHistory ?? []),
      memoryHistoryEntry(
        previous ? componentMemorySnapshot(previous) : null,
        componentMemorySnapshot(stamped),
        meta,
        timestamp,
      ),
    ],
  };
}

function recordStoryCardMemoryUpdate(
  previous: StoryCard | undefined,
  next: StoryCard,
  meta: MemoryUpdateMeta,
): StoryCard {
  const timestamp = nowIso();
  const stamped = { ...next, updatedAt: timestamp, lastMemoryUpdatedAt: timestamp };
  return {
    ...stamped,
    memoryUpdateHistory: [
      ...(previous?.memoryUpdateHistory ?? next.memoryUpdateHistory ?? []),
      memoryHistoryEntry(
        previous ? storyCardMemorySnapshot(previous) : null,
        storyCardMemorySnapshot(stamped),
        meta,
        timestamp,
      ),
    ],
  };
}

function touchAdventure(state: Adventure, patch: Partial<Adventure>): Adventure {
  const next = { ...state, ...patch, updatedAt: nowIso() };
  const summarizedIndex = next.rollingSummary.lastSummarizedMessageIndex;
  if (summarizedIndex !== undefined && summarizedIndex > next.messages.length) {
    return {
      ...next,
      rollingSummary: {
        ...next.rollingSummary,
        lastSummarizedMessageIndex: next.messages.length,
      },
    };
  }
  return next;
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((existing) => (existing.id === item.id ? item : existing));
}

function updateById<T extends { id: string; updatedAt?: string }>(
  items: T[],
  id: string,
  updater: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? updater(item) : item));
}

function deleteById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

function moveByPriority<T extends { id: string; priority: number; updatedAt: string }>(
  items: T[],
  id: string,
  direction: "up" | "down",
): T[] {
  const sorted = [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const index = sorted.findIndex((item) => item.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= sorted.length) return items;
  const current = sorted[index];
  const other = sorted[swapIndex];
  return items.map((item) => {
    if (item.id === current.id) return touch({ ...item, priority: other.priority });
    if (item.id === other.id) return touch({ ...item, priority: current.priority });
    return item;
  });
}

function mergePatch<T extends { updatedAt: string }>(item: T, patch: Partial<T>): T {
  const sanitizedPatch = { ...patch };
  delete sanitizedPatch.updatedAt;
  return touch({ ...item, ...sanitizedPatch });
}

// ---- Arc Director: deterministic story pacing ----
// Tier/phase advance purely on counted player engagement with an arc's threads —
// never on an LLM verdict. The code owns *timing* (when the break instruction is
// allowed into context); it never owns *outcome* (that is the break card's text).

const ARC_PACE_THRESHOLDS: Record<ArcPace, { escalate: number; break: number }> = {
  short: { escalate: 4, break: 8 },
  medium: { escalate: 8, break: 16 },
  long: { escalate: 16, break: 32 },
  epic: { escalate: 30, break: 60 },
};

/** Turns the arc holds in the break phase before settling into aftermath. */
const ARC_BREAK_DURATION = 6;

function emptyArcState(): ArcPacingState {
  return { phase: "simmer", tier: 0, threadEngagement: {}, pendingBreak: false };
}

function arcTier(total: number, breakThreshold: number): number {
  if (breakThreshold <= 0) return 0;
  return Math.max(0, Math.min(5, Math.floor((total / breakThreshold) * 5)));
}

/**
 * Advance one Current Arc after a turn: count engagement from the threads that were
 * active in-scene, derive the display tier, and move the phase forward one-way.
 * In "ask" mode the break gate opens a pending prompt instead of firing.
 */
function advanceArcComponent(component: ComponentEntry, triggeredIds: string[], turn: number): ComponentEntry {
  const threadKeys = component.arcThreadKeys ?? [];
  if (component.type !== "currentArc" || threadKeys.length === 0) return component;
  const state = component.arcState ?? emptyArcState();

  // 1. Count engagement for any of this arc's threads triggered this turn.
  const triggered = new Set(triggeredIds);
  const nextEngagement = { ...state.threadEngagement };
  let changed = false;
  for (const key of threadKeys) {
    if (triggered.has(key)) {
      nextEngagement[key] = (nextEngagement[key] ?? 0) + 1;
      changed = true;
    }
  }

  const { escalate, break: breakAt } = ARC_PACE_THRESHOLDS[component.arcPace ?? "medium"];
  const total = threadKeys.reduce((sum, key) => sum + (nextEngagement[key] ?? 0), 0);
  const tier = arcTier(total, breakAt);

  let phase = state.phase;
  let pendingBreak = state.pendingBreak;
  let brokeAtTurn = state.brokeAtTurn;

  // 2. One-way phase transitions.
  if (phase === "simmer" && total >= escalate) phase = "escalate";
  if (phase === "escalate" && total >= breakAt) {
    if ((component.arcTriggerMode ?? "ask") === "auto") {
      phase = "break";
      brokeAtTurn = turn;
      pendingBreak = false;
    } else {
      pendingBreak = true; // leash: hold at escalate, surface the "let it break?" prompt
    }
  }
  // 3. The break settles into aftermath so the arc resolves and the next can seed.
  if (phase === "break" && brokeAtTurn !== undefined && turn - brokeAtTurn >= ARC_BREAK_DURATION) {
    phase = "aftermath";
  }

  const unchanged =
    !changed && phase === state.phase && pendingBreak === state.pendingBreak && brokeAtTurn === state.brokeAtTurn && tier === state.tier;
  if (unchanged) return component;
  return touch({ ...component, arcState: { phase, tier, threadEngagement: nextEngagement, pendingBreak, brokeAtTurn } });
}

/** Manual phase override (UI: "Spring it now", confirm a pending break, "Resolve arc", "Reset"). */
function setArcPhase(component: ComponentEntry, phase: ArcPhase, turn: number | undefined): ComponentEntry {
  const state = component.arcState ?? emptyArcState();
  const brokeAtTurn = phase === "break" ? (turn ?? state.brokeAtTurn ?? 0) : state.brokeAtTurn;
  // Resetting to simmer clears the counters so the next arc climbs fresh.
  const threadEngagement = phase === "simmer" ? {} : state.threadEngagement;
  const tier = phase === "simmer" ? 0 : state.tier;
  return touch({ ...component, arcState: { ...state, phase, pendingBreak: false, brokeAtTurn, threadEngagement, tier } });
}

function arcArchiveCard(component: ComponentEntry): StoryCard | undefined {
  const cardTitle = component.arcPremise?.trim() || component.title;
  const cardBody = [component.arcPremise?.trim() ? `Arc: ${component.arcPremise.trim()}` : "", component.content.trim()]
    .filter(Boolean)
    .join("\n");
  if (!cardBody.trim()) return undefined;
  return makeStoryCard({
    title: cardTitle,
    content: cardBody,
    type: "plot",
    memoryMode: "historical",
    active: true,
    state: "archivedArc",
  });
}

function clearCompletedArc(component: ComponentEntry): ComponentEntry {
  return touch({
    ...component,
    arcPremise: "",
    content: "",
    arcThreadKeys: [],
    arcSimmerInstruction: "",
    arcBreakInstruction: "",
    arcContinuationOptions: undefined,
    arcState: defaultArcState(),
  });
}

function updateBrainField(brain: BrainEntry, field: BrainStateField | undefined, text: string, mode: "append" | "replace"): BrainEntry {
  const targetField = field ?? "currentState";
  if (targetField === "thoughts") return brain; // thoughts is a Record — use APPLY_BRAIN_UPDATE instead
  const current = brain[targetField] as string;
  const nextValue = mode === "append" ? [current, text].filter(Boolean).join("\n") : text;
  return touch({ ...brain, [targetField]: nextValue });
}

function mergeThoughts(
  existing: Record<string, string>,
  archived: Record<string, string>,
  patch: Record<string, string | null>,
  dedupeAgainstArchived = true,
): { thoughts: Record<string, string>; archivedThoughts: Record<string, string> } {
  const nextThoughts = { ...existing };
  const nextArchived = { ...archived };
  const seen = new Set(
    [
      ...Object.values(existing),
      ...(dedupeAgainstArchived ? Object.values(archived) : []),
    ]
      .map((value) => normalizeThoughtForDedupe(value))
      .filter(Boolean),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (nextThoughts[key]) {
        const normalized = normalizeThoughtForDedupe(nextThoughts[key]);
        if (normalized) seen.delete(normalized);
        nextArchived[key] = nextThoughts[key];
      }
      delete nextThoughts[key];
    } else {
      const normalized = normalizeThoughtForDedupe(value);
      const currentForKey = nextThoughts[key] ?? nextArchived[key];
      const currentNormalized = currentForKey ? normalizeThoughtForDedupe(currentForKey) : "";
      if (normalized && seen.has(normalized) && normalized !== currentNormalized) continue;
      if (currentNormalized) seen.delete(currentNormalized);
      nextThoughts[key] = value;
      delete nextArchived[key];
      if (normalized) seen.add(normalized);
    }
  }
  return dedupeBrainThoughts(nextThoughts, nextArchived);
}

/** Default character budget for a brain's live thought log before old entries get archived. */
const DEFAULT_THOUGHT_BUDGET = 1600;

/** Default character budget for a living story card's content (~200 tokens) before old facts archive. */
const DEFAULT_CARD_CONTENT_BUDGET = 900;

/** Split a card body into individual facts (one per non-empty line), preserving bullet markers. */
function splitCardFacts(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Living story-card merge: append the new fact(s) to the card's current content, then keep the live
 * content under budget by moving the OLDEST facts into archivedFacts (never deleted, never injected).
 * Mirrors pruneThoughtsToBudget — context stays bounded no matter how long a relationship/subject runs.
 */
function mergeCardContentToBudget(
  existingContent: string,
  newContent: string,
  archived: string,
  budget: number,
  guardedCard?: StoryCard,
): { content: string; archivedFacts: string } {
  const archivedFacts = splitCardFacts(archived);
  const guardSource = guardedCard && isGuardedStoryCardMemory(guardedCard, newContent)
    ? { ...guardedCard, content: [guardedCard.content, newContent].filter(Boolean).join("\n") }
    : undefined;
  const kept: string[] = [];
  const seen = new Set<string>();
  const addFact = (fact: string) => {
    const normalized = normalizeStoryCardFact(fact);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    kept.push(fact);
  };

  if (guardSource) {
    archivedFacts
      .filter((fact) => isGuardedStoryCardFact(guardSource, fact))
      .forEach(addFact);
  }
  splitCardFacts(existingContent).forEach(addFact);
  splitCardFacts(newContent).forEach(addFact); // newest facts last
  const total = (facts: string[]) => facts.reduce((sum, f) => sum + f.length, 0);
  while (kept.length > 1 && total(kept) > budget) {
    if (guardSource) {
      const archiveIndex = kept.findIndex((fact) => !isGuardedStoryCardFact(guardSource, fact));
      if (archiveIndex < 0) break;
      if (archiveIndex > 0) {
        const [archivedFact] = kept.splice(archiveIndex, 1);
        const normalized = normalizeStoryCardFact(archivedFact);
        if (!archivedFacts.some((fact) => normalizeStoryCardFact(fact) === normalized)) {
          archivedFacts.push(archivedFact);
        }
        continue;
      }
    }
    archivedFacts.push(kept.shift()!); // oldest live fact → archive
  }
  return { content: kept.join("\n"), archivedFacts: archivedFacts.join("\n") };
}

function appendCardContent(existingContent: string, newContent: string): string {
  const existingFacts = splitCardFacts(existingContent);
  const seen = new Set(existingFacts.map((fact) => normalizedReplacementContent(fact)));
  const incoming = splitCardFacts(newContent).filter((fact) => {
    const normalized = normalizedReplacementContent(fact);
    return normalized && !seen.has(normalized);
  });
  return [...existingFacts, ...incoming].join("\n");
}

function guardStoryCard(card: StoryCard): StoryCard {
  return applyGuardedStoryCardPolicy(restoreGuardedFactsToLiveContent(card));
}

function replacementContentWithGuardedFacts(existing: StoryCard, replacementContent: string): string {
  const archivedFacts = [existing.archivedFacts, existing.content].filter(Boolean).join("\n");
  return restoreGuardedFactsToLiveContent({
    ...existing,
    content: replacementContent,
    archivedFacts,
  }).content;
}

/**
 * Keep a brain's accumulating thought log bounded. While the total thought text
 * exceeds the budget, move the oldest entries (insertion order) to archivedThoughts.
 * Always retains at least the most recent thought. Non-destructive — archived thoughts
 * are preserved, not deleted. Runs on every append so it bounds both the auto-update
 * path and the approval path, regardless of the semantic engine's LLM condense pass.
 */
function pruneThoughtsToBudget(
  thoughts: Record<string, string>,
  archived: Record<string, string>,
  budget: number,
): { thoughts: Record<string, string>; archivedThoughts: Record<string, string> } {
  const kept = Object.entries(thoughts);
  const totalChars = (entries: [string, string][]) => entries.reduce((sum, [, value]) => sum + value.length, 0);
  if (totalChars(kept) <= budget) return { thoughts, archivedThoughts: archived };
  const nextArchived = { ...archived };
  while (kept.length > 1 && totalChars(kept) > budget) {
    const [oldKey, oldValue] = kept.shift()!;
    nextArchived[oldKey] = oldValue;
  }
  return { thoughts: Object.fromEntries(kept), archivedThoughts: nextArchived };
}

function applyBrainUpdate(
  brain: BrainEntry,
  patch: BrainPatch,
  mode: "replace" | "append" = "replace",
  turn?: number,
  preview?: string,
): BrainEntry {
  const timestamp = nowIso();
  // Custom semantic rules and legacy Brain proposals cannot write enrolled relationships.
  const allowed = new Set(["thoughts", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"]);
  const { thoughts: thoughtsPatch, ...stringPatch } = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key))) as BrainPatch;

  const { thoughts: nextThoughts, archivedThoughts: nextArchivedThoughts } = thoughtsPatch
    ? mode === "replace"
      ? mergeThoughts({}, { ...brain.archivedThoughts, ...brain.thoughts }, thoughtsPatch, false)
      : mergeThoughts(brain.thoughts, brain.archivedThoughts, thoughtsPatch)
    : { thoughts: brain.thoughts, archivedThoughts: brain.archivedThoughts };

  if (mode === "append") {
    const perField: Partial<Record<Exclude<BrainStateField, "thoughts">, string>> = {};
    for (const [key, value] of Object.entries(stringPatch) as [Exclude<BrainStateField, "thoughts">, string][]) {
      if (typeof value === "string") {
        const existing = brain[key] as string;
        perField[key] = existing ? `${existing}\n${value}` : value;
      }
    }
    const { thoughts: boundedThoughts, archivedThoughts: boundedArchived } = pruneThoughtsToBudget(
      nextThoughts,
      nextArchivedThoughts,
      brain.condenseThreshold ?? DEFAULT_THOUGHT_BUDGET,
    );
    return touch({
      ...brain,
      ...perField,
      thoughts: boundedThoughts,
      archivedThoughts: boundedArchived,
      lastUpdatedTurn: turn ?? brain.lastUpdatedTurn,
      lastUpdatedAt: timestamp,
      lastGeneratedUpdatePreview: preview ?? JSON.stringify(patch).slice(0, 500),
    });
  }

  return touch({
    ...brain,
    ...stringPatch,
    thoughts: nextThoughts,
    archivedThoughts: nextArchivedThoughts,
    lastUpdatedTurn: turn ?? brain.lastUpdatedTurn,
    lastUpdatedAt: timestamp,
    lastGeneratedUpdatePreview: preview ?? JSON.stringify(patch).slice(0, 500),
  });
}

function stripProviderKey(config: ProviderConfig): ProviderConfig {
  const { apiKey: _apiKey, sessionId: _sessionId, ...safeConfig } = config;
  return safeConfig;
}

function addMessage(state: Adventure, action: Extract<AdventureAction, { type: "ADD_MESSAGE" }>): Message {
  return {
    id: action.id ?? createId("msg"),
    role: action.role,
    content: action.content,
    inputMode: action.inputMode,
    usage: action.usage,
    createdAt: action.createdAt ?? nowIso(),
  };
}

const STORY_HISTORY_LIMIT = 100;

function applyStoryPatch(state: Adventure, patch: StoryEditPatch): Partial<Adventure> {
  if (patch.type === "insertMessage") {
    const index = patch.index ?? state.messages.length;
    return {
      messages: [
        ...state.messages.slice(0, index),
        patch.message,
        ...state.messages.slice(index),
      ],
    };
  }
  if (patch.type === "deleteMessage") {
    return { messages: deleteById(state.messages, patch.messageId) };
  }
  if (patch.type === "updateMessage") {
    return {
      messages: state.messages.map((message) =>
        message.id === patch.messageId ? { ...message, content: patch.content } : message,
      ),
    };
  }
  return { openingScene: patch.content };
}

function storyHistoryEntry(label: string, undo: StoryEditPatch, redo: StoryEditPatch): StoryEditHistoryEntry {
  return {
    id: createId("storyEdit"),
    label,
    createdAt: nowIso(),
    undo,
    redo,
  };
}

function withStoryHistory(state: Adventure, patch: Partial<Adventure>, entry: StoryEditHistoryEntry): Adventure {
  return touchAdventure(state, {
    ...patch,
    activeState: {
      ...state.activeState,
      storyUndoStack: [entry, ...state.activeState.storyUndoStack].slice(0, STORY_HISTORY_LIMIT),
      storyRedoStack: [],
    },
  });
}

function undoStoryEdit(state: Adventure): Adventure {
  const [entry, ...remaining] = state.activeState.storyUndoStack;
  if (!entry) return state;
  return touchAdventure(state, {
    ...applyStoryPatch(state, entry.undo),
    activeState: {
      ...state.activeState,
      storyUndoStack: remaining,
      storyRedoStack: [entry, ...state.activeState.storyRedoStack].slice(0, STORY_HISTORY_LIMIT),
    },
  });
}

function redoStoryEdit(state: Adventure): Adventure {
  const [entry, ...remaining] = state.activeState.storyRedoStack;
  if (!entry) return state;
  return touchAdventure(state, {
    ...applyStoryPatch(state, entry.redo),
    activeState: {
      ...state.activeState,
      storyUndoStack: [entry, ...state.activeState.storyUndoStack].slice(0, STORY_HISTORY_LIMIT),
      storyRedoStack: remaining,
    },
  });
}

function updateMemoryProposal(proposal: MemoryProposal, patch: Partial<MemoryProposal>): MemoryProposal {
  const sanitizedPatch = { ...patch };
  delete sanitizedPatch.updatedAt;
  return { ...proposal, ...sanitizedPatch, updatedAt: nowIso() };
}

function proposalWithEdits(proposal: MemoryProposal, editedProposal?: Partial<MemoryProposal>): MemoryProposal {
  return editedProposal ? updateMemoryProposal(proposal, editedProposal) : proposal;
}

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function stripLeadingCardTitle(title: string, content: string): string {
  if (!title || !content) return content;
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(`^(?:#{1,3}\\s*|\\*{1,2})?${escaped}\\*{0,2}\\s*\\n?`, "i"), "").trimStart();
}

/**
 * Normalize a proposal/card title for duplicate detection: lowercase, drop a leading article,
 * strip punctuation, collapse whitespace. So "The Escape from Gutterglass" and "Escape from
 * Gutterglass!" collapse to the same key and the second suggestion is recognized as a duplicate.
 */
function normalizeProposalTitle(title: string): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/^\s*(the|a|an)\s+/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DUPLICATE_CONTENT_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "and",
  "are",
  "been",
  "being",
  "but",
  "can",
  "for",
  "from",
  "has",
  "have",
  "her",
  "his",
  "into",
  "its",
  "now",
  "only",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "through",
  "with",
  "you",
]);

function normalizedContentTokens(content: string): Set<string> {
  const words = stripThink(content)
    .toLowerCase()
    .replace(/[•*#"'’]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, "").trim())
    .filter((word) => word.length > 2 && !DUPLICATE_CONTENT_STOPWORDS.has(word));
  return new Set(words);
}

function contentLooksDuplicate(a: string, b: string): boolean {
  const aTokens = normalizedContentTokens(a);
  const bTokens = normalizedContentTokens(b);
  const smaller = Math.min(aTokens.size, bTokens.size);
  if (smaller < 10) return false;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / smaller >= 0.72;
}

function normalizedReplacementContent(content: string): string {
  return stripThink(content)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeProposal(proposal: MemoryProposal): MemoryProposal | null {
  const rawContent = stripThink(proposal.content ?? "").trim();
  const title = stripThink(proposal.title ?? "").trim();
  const content = proposal.proposedType === "storyCard" ? stripLeadingCardTitle(title, rawContent) : rawContent;
  const autoUpdateCooldownTurns = Number.isFinite(proposal.autoUpdateCooldownTurns)
    ? Math.max(0, Math.round(proposal.autoUpdateCooldownTurns ?? 0))
    : undefined;

  // summaryUpdate with blank content would immediately overwrite the real summary — hard drop
  if (proposal.proposedType === "summaryUpdate" && !content) return null;

  // arcProposal: content must be JSON carrying a non-empty premise, or the seed is meaningless
  if (proposal.proposedType === "arcProposal") {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed.arcPremise !== "string" || !(parsed.arcPremise as string).trim()) return null;
    } catch {
      return null;
    }
  }

  // brainUpdate: if the content looks like JSON, validate it has at least one recognised field
  if (proposal.proposedType === "brainUpdate" && content.startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const stringFields = new Set(["currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"]);
      const hasString = Object.entries(parsed).some(([k, v]) => stringFields.has(k) && typeof v === "string" && (v as string).trim());
      const hasThoughts = parsed.thoughts && typeof parsed.thoughts === "object" && !Array.isArray(parsed.thoughts) && Object.keys(parsed.thoughts as object).length > 0;
      if (!hasString && !hasThoughts) return null;
    } catch {
      // Not JSON — allow as plain-text append (falls into recentDevelopments on apply)
    }
  }

  // Fall back title to first 60 chars of content when both are present
  const safeTitle = title || (content ? content.slice(0, 60) : "");

  return {
    ...proposal,
    content,
    title: safeTitle,
    suggestedTriggers: proposal.suggestedTriggers ?? [],
    autoUpdateCooldownTurns,
  };
}

function routedProposal(state: Adventure, proposal: MemoryProposal): MemoryProposal {
  if (proposal.proposedType === "relationshipUpdate") return proposal;
  if (proposal.proposedType === "storyCard" && proposal.storyCardType === "event") return { ...proposal, memoryMode: "historical", autoUpdate: false, targetId: undefined, appendContent: undefined };
  const routed = resolveMemoryTarget(state, {
    proposedType: proposal.proposedType,
    title: proposal.title,
    content: proposal.content,
    sourceText: proposal.sourceText,
    suggestedTriggers: proposal.suggestedTriggers,
    targetId: proposal.targetId,
    appendContent: proposal.appendContent,
    memoryMode: proposal.memoryMode,
    rationale: proposal.rationale,
  });
  return {
    ...proposal,
    title: routed.title,
    content: routed.content,
    suggestedTriggers: routed.suggestedTriggers,
    targetId: routed.targetId,
    appendContent: routed.appendContent,
    memoryMode: routed.memoryMode,
    rationale: routed.rationale ?? proposal.rationale,
  };
}

const BRAIN_ARCHIVE_FIELDS: Array<[Exclude<BrainStateField, "thoughts">, string]> = [
  ["currentState", "Current state"],
  ["relationshipPressure", "Relationship pressure"],
  ["emotionalInterpretation", "Emotional interpretation"],
  ["recentDevelopments", "Recent developments"],
  ["notes", "Notes"],
];

function outgoingBrainFieldProposalsForReplacement(
  state: Adventure,
  brain: BrainEntry,
  patch: BrainPatch,
  mode: "replace" | "append" | undefined,
  sourceTurnId = String(state.activeState.turn),
): MemoryProposal[] {
  if (mode === "append") return [];
  const now = nowIso();
  const results: MemoryProposal[] = [];
  for (const [field, label] of BRAIN_ARCHIVE_FIELDS) {
    const nextValue = patch[field];
    if (typeof nextValue !== "string") continue;
    const previous = (brain[field] as string | undefined)?.trim();
    if (!previous) continue;
    const previousNormalized = normalizedReplacementContent(previous);
    const nextNormalized = normalizedReplacementContent(nextValue);
    if (!previousNormalized || previousNormalized === nextNormalized || nextNormalized.includes(previousNormalized)) continue;
    if (state.storyCards.some((card) => contentLooksDuplicate(card.content, previous) || normalizedReplacementContent(card.content).includes(previousNormalized))) continue;
    const content = `• ${label}: ${previous}`;
    const routed = resolveMemoryTarget(state, {
      proposedType: "storyCard",
      title: `${brain.characterName}: Brain History`,
      content,
      sourceText: previous,
      suggestedTriggers: [brain.characterName, ...brain.triggers],
      memoryMode: "historical",
      rationale: `${label} left ${brain.characterName}'s Brain during a replacement. Approve if it remains useful as durable historical context; reject if it was obsolete or purely private clutter.`,
    });
    results.push({
      id: createId("proposal"),
      sourceTurnId,
      sourceText: previous,
      proposedType: "storyCard",
      title: routed.title,
      content: routed.content,
      suggestedTriggers: routed.suggestedTriggers,
      confidence: 0.68,
      rationale: routed.rationale ?? `${label} left ${brain.characterName}'s Brain during a replacement. Approve if it remains useful as durable historical context; reject if it was obsolete or purely private clutter.`,
      status: "pending",
      targetId: routed.targetId,
      appendContent: routed.appendContent,
      memoryMode: routed.memoryMode ?? "historical",
      createdAt: now,
      updatedAt: now,
    });
    if (results.length >= 3) break;
  }
  return results;
}

function applyApprovedMemoryProposal(state: Adventure, proposal: MemoryProposal): Partial<Adventure> {
  if (proposal.proposedType === "relationshipUpdate") return { brains: applyRelationship(state, proposal) };
  const proposalMemoryMeta = (operation: MemoryUpdateOperation): MemoryUpdateMeta => ({
    source: "memoryProposal",
    operation,
    proposalId: proposal.id,
    sourceTurnId: proposal.sourceTurnId,
  });

  if (proposal.proposedType === "storyCard") {
    if (!proposal.content.trim()) return {};
    const cardTitle = proposal.title || "Memory Proposal";
    const safeContent = stripLeadingCardTitle(cardTitle, proposal.content);
    if (!safeContent.trim()) return {};
    const existing = state.storyCards.find(
      (card) => proposal.targetId ? card.id === proposal.targetId : normalizeProposalTitle(card.title) === normalizeProposalTitle(proposal.title),
    );
    if (proposal.storyCardType === "event" && existing) return {};
    if (existing?.type === "event") return {};
    const automationPatch = (current?: StoryCard): Partial<StoryCard> => ({
      ...(proposal.autoUpdate !== undefined ? { autoUpdate: proposal.autoUpdate } : {}),
      ...(proposal.autoUpdateCooldownTurns !== undefined
        ? { autoUpdateCooldownTurns: proposal.autoUpdateCooldownTurns }
        : proposal.autoUpdate !== undefined
          ? { autoUpdateCooldownTurns: current?.autoUpdateCooldownTurns ?? 3 }
          : {}),
    });
    let storyCard: StoryCard;
    if (existing && proposal.appendContent) {
      const shouldManageAsLiving = isLivingStoryCard(existing);
      if (shouldManageAsLiving) {
        // Living-card update: append the new fact to existing content, archive the oldest facts beyond
        // budget so context stays bounded and superseded facts don't read as current.
        const preparedExisting = guardStoryCard(existing);
        const budget = preparedExisting.tokenBudget && preparedExisting.tokenBudget > 0
          ? preparedExisting.tokenBudget * 4
          : DEFAULT_CARD_CONTENT_BUDGET;
        const merged = mergeCardContentToBudget(preparedExisting.content, safeContent, preparedExisting.archivedFacts ?? "", budget, preparedExisting);
        storyCard = recordStoryCardMemoryUpdate(
          existing,
          guardStoryCard({
            ...preparedExisting,
            content: merged.content,
            archivedFacts: merged.archivedFacts,
            keys: Array.from(new Set([
              ...preparedExisting.keys,
              ...sanitizeStoryCardTriggers(state, preparedExisting.title, proposal.suggestedTriggers, preparedExisting.id, "living"),
            ])),
            memoryMode: "living",
            sourceTurnIds: appendSourceTurnIds(preparedExisting.sourceTurnIds, proposal.sourceTurnId),
            // Tag as a living card so the UI can flag it; "living" marks an auto-managed, self-archiving card.
            state: Array.from(new Set([...(preparedExisting.state ? preparedExisting.state.split(/\s+/) : []), "memoryProposal", "living"])).join(" "),
            ...automationPatch(preparedExisting),
            ...proposal.storyCardPatch,
          }),
          proposalMemoryMeta("append"),
        );
      } else {
        storyCard = recordStoryCardMemoryUpdate(
          existing,
          guardStoryCard({
            ...existing,
            content: appendCardContent(existing.content, safeContent),
            keys: Array.from(new Set([
              ...existing.keys,
              ...sanitizeStoryCardTriggers(state, existing.title, proposal.suggestedTriggers, existing.id, existing.memoryMode ?? proposal.memoryMode),
            ])),
            memoryMode: existing.memoryMode ?? proposal.memoryMode,
            sourceTurnIds: appendSourceTurnIds(existing.sourceTurnIds, proposal.sourceTurnId),
            state: Array.from(new Set([...(existing.state ? existing.state.split(/\s+/) : []), "memoryProposal"])).join(" "),
            ...automationPatch(existing),
            ...proposal.storyCardPatch,
          }),
          proposalMemoryMeta("append"),
        );
      }
    } else if (existing) {
      storyCard = recordStoryCardMemoryUpdate(
        existing,
        guardStoryCard({
          ...existing,
          content: replacementContentWithGuardedFacts(existing, safeContent),
          // Merge, never overwrite, keys — a sparse update must not strip a card's aliases (which would
          // break alias-matching and let the card be duplicated again later).
          keys: Array.from(new Set([
            ...existing.keys,
            ...sanitizeStoryCardTriggers(state, existing.title, proposal.suggestedTriggers, existing.id, proposal.memoryMode ?? existing.memoryMode),
          ])),
          memoryMode: proposal.memoryMode ?? existing.memoryMode,
          type: proposal.storyCardType ?? existing.type,
          sourceTurnIds: appendSourceTurnIds(existing.sourceTurnIds, proposal.sourceTurnId),
          state: [existing.state, "memoryProposal"].filter(Boolean).join(" "),
          ...automationPatch(existing),
          ...proposal.storyCardPatch,
        }),
        proposalMemoryMeta("replace"),
      );
    } else {
      storyCard = recordStoryCardMemoryUpdate(
        undefined,
        guardStoryCard(makeStoryCard({
          title: cardTitle,
          content: safeContent,
          keys: sanitizeStoryCardTriggers(state, cardTitle, proposal.suggestedTriggers, undefined, proposal.memoryMode ?? "static"),
          memoryMode: proposal.memoryMode ?? "static",
          type: proposal.storyCardType ?? "custom",
          eventMemory: proposal.eventMemory,
          active: true,
          pinned: false,
          autoUpdate: proposal.autoUpdate ?? false,
          autoUpdateCooldownTurns: proposal.autoUpdateCooldownTurns ?? 3,
          sourceTurnIds: appendSourceTurnIds(undefined, proposal.sourceTurnId),
          state: "memoryProposal",
          ...proposal.storyCardPatch,
        })),
        proposalMemoryMeta("create"),
      );
    }
    return { storyCards: upsertById(state.storyCards, storyCard) };
  }

  if (proposal.proposedType === "brainUpdate") {
    const existing = state.brains.find((brain) => brain.id === proposal.targetId || brain.characterName === proposal.title);
    if (!existing) {
      const storyCard = recordStoryCardMemoryUpdate(
        undefined,
        guardStoryCard(makeStoryCard({
          title: proposal.title || "Memory Proposal",
          content: proposal.content,
          keys: sanitizeStoryCardTriggers(state, proposal.title || "Memory Proposal", proposal.suggestedTriggers, undefined, proposal.memoryMode ?? "static"),
          memoryMode: proposal.memoryMode ?? "static",
          type: "character",
          active: true,
          sourceTurnIds: appendSourceTurnIds(undefined, proposal.sourceTurnId),
          state: "memoryProposal routedFromMissingBrain",
        })),
        proposalMemoryMeta("create"),
      );
      return { storyCards: upsertById(state.storyCards, storyCard) };
    }
    // Content may be a JSON patch (from auto-update flow) or a plain string (from Remember This)
    let parsedPatch: BrainPatch | null = null;
    try {
      const parsed: unknown = JSON.parse(proposal.content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const raw = parsed as Record<string, unknown>;
        const patch: BrainPatch = {};
        const stringFields: (keyof Omit<BrainPatch, "thoughts">)[] = ["currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"];
        for (const f of stringFields) { if (typeof raw[f] === "string") patch[f] = raw[f] as string; }
        if (raw.thoughts && typeof raw.thoughts === "object" && !Array.isArray(raw.thoughts)) {
          patch.thoughts = raw.thoughts as Record<string, string | null>;
        }
        if (Object.keys(patch).length > 0) parsedPatch = patch;
      }
    } catch {
      // Not JSON — fall through to plain-string append
    }
    const brain = parsedPatch
      ? applyBrainUpdate(existing, parsedPatch, "append", state.activeState.turn, proposal.content.slice(0, 500))
      : touch({
          ...existing,
          recentDevelopments: [existing.recentDevelopments, proposal.content].filter(Boolean).join("\n"),
          lastUpdatedTurn: state.activeState.turn,
          lastUpdatedAt: nowIso(),
          lastGeneratedUpdatePreview: proposal.content.slice(0, 500),
        });
    return { brains: upsertById(state.brains, brain) };
  }

  if (proposal.proposedType === "plotEssentialsUpdate") {
    if (!proposal.content.trim()) return {};
    const target =
      state.components.find((component) => component.id === proposal.targetId && component.type === "plotEssentials") ??
      state.components.find((component) => component.type === "plotEssentials");
    const turn = state.activeState.turn;
    const component = target
      ? recordComponentMemoryUpdate(
          target,
          {
            ...target,
            content: (proposal.appendContent && target.content.trim()) ? `${target.content.trim()}\n${proposal.content}` : proposal.content,
            lastAutoUpdateTurn: turn,
            ...proposal.componentPatch,
          },
          proposalMemoryMeta(proposal.appendContent && target.content.trim() ? "append" : "replace"),
        )
      : recordComponentMemoryUpdate(
          undefined,
          makeComponent({
            title: proposal.title || "Plot Essentials",
            type: "plotEssentials",
            content: proposal.content,
            active: true,
            alwaysOn: false,
            pinned: false,
            priority: 250,
            ...proposal.componentPatch,
          }),
          proposalMemoryMeta("create"),
        );
    return { components: upsertById(state.components, component) };
  }

  if (proposal.proposedType === "plotMomentumUpdate") {
    return {};
  }

  if (proposal.proposedType === "plotPressureUpdate") {
    if (!proposal.content.trim()) return {};
    const componentType = "activePressure";
    const existing =
      state.components.find((c) => c.type === componentType && (!proposal.targetId || c.id === proposal.targetId));
    const turn = state.activeState.turn;
    if (existing) {
      return {
        components: upsertById(
          state.components,
          recordComponentMemoryUpdate(existing, { ...existing, content: proposal.content, lastAutoUpdateTurn: turn, ...proposal.componentPatch }, proposalMemoryMeta("replace")),
        ),
      };
    }
    return {};
  }

  if (proposal.proposedType === "currentArcUpdate") {
    if (!proposal.content.trim()) return {};
    const arcComp =
      (proposal.targetId ? state.components.find((c) => c.id === proposal.targetId && c.type === "currentArc") : undefined) ??
      state.components.find((c) => c.type === "currentArc");
    if (!arcComp) return {};
    const existing = arcComp.content.trim();
    const newContent = existing ? `${existing}\n\n${proposal.content}` : proposal.content;
    return {
      components: upsertById(
        state.components,
        recordComponentMemoryUpdate(
          arcComp,
          { ...arcComp, content: newContent, lastAutoUpdateTurn: state.activeState.turn, ...proposal.componentPatch },
          proposalMemoryMeta(existing ? "append" : "replace"),
        ),
      ),
    };
  }

  if (proposal.proposedType === "arcProposal") {
    // Approving an AI-drafted arc seeds the Current Arc and starts it simmering. Any stale/finished
    // arc that was sitting in the component is banked as a Story Card first, so previous arcs are
    // preserved — same as the aftermath continuation flow.
    let seed: Record<string, unknown>;
    try {
      seed = JSON.parse(proposal.content) as Record<string, unknown>;
    } catch {
      return {};
    }
    const premise = typeof seed.arcPremise === "string" ? seed.arcPremise.trim() : "";
    if (!premise) return {};
    const arcComp =
      (proposal.targetId ? state.components.find((c) => c.id === proposal.targetId && c.type === "currentArc") : undefined) ??
      state.components.find((c) => c.type === "currentArc");
    if (!arcComp) return {};

    const pace = (["short", "medium", "long", "epic"] as const).includes(seed.arcPace as ArcPace)
      ? (seed.arcPace as ArcPace)
      : "long";
    const triggerMode: ArcTriggerMode = seed.arcTriggerMode === "auto" ? "auto" : "ask";
    const threadKeys = Array.isArray(seed.arcThreadKeys)
      ? (seed.arcThreadKeys as unknown[]).filter((k): k is string => typeof k === "string")
      : [];

    // Bank the old arc if it built up any content worth keeping.
    const oldBody = [arcComp.arcPremise?.trim() ? `Arc: ${arcComp.arcPremise.trim()}` : "", arcComp.content.trim()]
      .filter(Boolean)
      .join("\n");
    const storyCards = oldBody.trim()
      ? upsertById(
          state.storyCards,
          makeStoryCard({
            title: arcComp.arcPremise?.trim() || arcComp.title,
            content: oldBody,
            type: "custom",
            memoryMode: "historical",
            active: true,
            state: "archivedArc",
          }),
        )
      : state.storyCards;

    const seededArc = recordComponentMemoryUpdate(
      arcComp,
      {
        ...arcComp,
        arcPremise: premise,
        content: "",
        arcThreadKeys: threadKeys,
        arcSimmerInstruction: typeof seed.arcSimmerInstruction === "string" ? seed.arcSimmerInstruction : "",
        arcBreakInstruction: typeof seed.arcBreakInstruction === "string" ? seed.arcBreakInstruction : "",
        arcPace: pace,
        arcTriggerMode: triggerMode,
        arcState: defaultArcState(),
        arcContinuationOptions: undefined,
        lastAutoUpdateTurn: state.activeState.turn,
      },
      proposalMemoryMeta("replace"),
    );
    return { components: upsertById(state.components, seededArc), storyCards };
  }

  if (proposal.proposedType === "summaryUpdate") {
    if (!proposal.content.trim()) return {};
    const existing = state.rollingSummary.content.trim();
    const content = (proposal.appendContent && existing) ? `${existing}\n\n${proposal.content}` : proposal.content;
    return { rollingSummary: { content, updatedAt: nowIso() } };
  }

  return {};
}

function applyCompanionMemoryProposals(
  state: Adventure,
  basePatch: Partial<Adventure>,
  proposals: MemoryProposal[],
): { patch: Partial<Adventure>; proposals: MemoryProposal[] } {
  let patch = basePatch;
  let workingState: Adventure = { ...state, ...patch };
  const recorded: MemoryProposal[] = [];

  for (const proposal of proposals) {
    const clean = sanitizeProposal(routedProposal(workingState, proposal));
    if (!clean) continue;
    const autoApprove = workingState.memoryAutoApprove?.[clean.proposedType as keyof typeof workingState.memoryAutoApprove] ?? false;
    if (!autoApprove || clean.requiresReview) {
      recorded.push(clean);
      continue;
    }

    const approved = updateMemoryProposal(clean, { status: "approved" });
    const applied = applyApprovedMemoryProposal(workingState, approved);
    patch = { ...patch, ...applied };
    workingState = { ...workingState, ...applied };
    if (clean.proposedType !== "plotPressureUpdate") recorded.push(approved);
  }

  return { patch, proposals: recorded };
}

export function adventureReducer(state: Adventure, action: AdventureAction): Adventure {
  switch (action.type) {
    case "SET_TITLE":
      return touchAdventure(state, { title: action.title });
    case "SET_OPENING_SCENE":
      return touchAdventure(state, { openingScene: action.content });
    case "UPDATE_METADATA":
      return touchAdventure(state, { metadata: { ...state.metadata, ...action.metadata } });
    case "ADD_MESSAGE": {
      const message = addMessage(state, action);
      const index = state.messages.length;
      return withStoryHistory(
        state,
        { messages: [...state.messages, message] },
        storyHistoryEntry(
          action.role === "assistant" ? "Add generated section" : "Add entered section",
          { type: "deleteMessage", messageId: message.id },
          { type: "insertMessage", message, index },
        ),
      );
    }
    case "UPDATE_MESSAGE": {
      const existing = state.messages.find((message) => message.id === action.messageId);
      if (!existing || existing.content === action.content) return state;
      return withStoryHistory(
        state,
        {
          messages: state.messages.map((message) =>
            message.id === action.messageId ? { ...message, content: action.content } : message,
          ),
        },
        storyHistoryEntry(
          "Edit story section",
          { type: "updateMessage", messageId: action.messageId, content: existing.content },
          { type: "updateMessage", messageId: action.messageId, content: action.content },
        ),
      );
    }
    case "DELETE_MESSAGE": {
      const index = state.messages.findIndex((message) => message.id === action.messageId);
      const message = state.messages[index];
      if (!message) return state;
      return withStoryHistory(
        state,
        { messages: state.messages.filter((entry) => entry.id !== action.messageId) },
        storyHistoryEntry(
          "Erase story section",
          { type: "insertMessage", message, index },
          { type: "deleteMessage", messageId: message.id },
        ),
      );
    }
    case "DELETE_LAST_MESSAGE": {
      const index = state.messages.length - 1;
      const message = state.messages[index];
      if (!message) return state;
      return withStoryHistory(
        state,
        { messages: state.messages.slice(0, -1) },
        storyHistoryEntry(
          message.role === "assistant" ? "Erase last generated section" : "Erase last entered section",
          { type: "insertMessage", message, index },
          { type: "deleteMessage", messageId: message.id },
        ),
      );
    }
    case "REMOVE_LAST_ASSISTANT_MESSAGE": {
      const index = [...state.messages].reverse().findIndex((message) => message.role === "assistant");
      if (index === -1) return state;
      const removeIndex = state.messages.length - 1 - index;
      const message = state.messages[removeIndex];
      return withStoryHistory(
        state,
        { messages: state.messages.filter((_, itemIndex) => itemIndex !== removeIndex) },
        storyHistoryEntry(
          "Erase last generated section",
          { type: "insertMessage", message, index: removeIndex },
          { type: "deleteMessage", messageId: message.id },
        ),
      );
    }
    case "UNDO_STORY_EDIT":
      return undoStoryEdit(state);
    case "REDO_STORY_EDIT":
      return redoStoryEdit(state);
    case "INCREMENT_TURN":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          turn: state.activeState.turn + 1,
          forceIncludeNextTurn: state.activeState.forceIncludeNextTurn.filter(
            (entry) => entry.expiresTurn > state.activeState.turn + 1,
          ),
          challengeMode: false,
        },
      });
    case "SET_CHALLENGE_MODE":
      return touchAdventure(state, {
        activeState: { ...state.activeState, challengeMode: true },
      });
    case "SET_LAST_MEMORY_CYCLE_TURN":
      return touchAdventure(state, {
        activeState: { ...state.activeState, lastMemoryCycleTurn: action.turn },
      });
    case "SET_LAST_SEMANTIC_EVAL_TURN":
      return touchAdventure(state, {
        activeState: { ...state.activeState, lastSemanticEvalTurn: action.turn },
      });
    case "SET_LAST_SCENE_STATE_TURN":
      return touchAdventure(state, {
        activeState: { ...state.activeState, lastSceneStateTurn: action.turn },
      });
    case "UPSERT_COMPONENT":
      return touchAdventure(state, { components: upsertById(state.components, touch(action.component)) });
    case "DELETE_COMPONENT":
      return touchAdventure(state, { components: deleteById(state.components, action.componentId) });
    case "ACTIVATE_COMPONENT":
      return touchAdventure(state, { components: updateById(state.components, action.componentId, (item) => touch({ ...item, active: true })) });
    case "DEACTIVATE_COMPONENT":
      return touchAdventure(state, { components: updateById(state.components, action.componentId, (item) => touch({ ...item, active: false })) });
    case "PIN_COMPONENT":
      return touchAdventure(state, { components: updateById(state.components, action.componentId, (item) => touch({ ...item, pinned: true })) });
    case "UNPIN_COMPONENT":
      return touchAdventure(state, { components: updateById(state.components, action.componentId, (item) => touch({ ...item, pinned: false })) });
    case "UPDATE_COMPONENT":
      return touchAdventure(state, {
        components: updateById(state.components, action.componentId, (item) => mergePatch<ComponentEntry>(item, action.patch)),
      });
    case "APPLY_COMPONENT_UPDATE": {
      const target = state.components.find((component) => component.id === action.componentId);
      if (!target) return state;
      const basePatch: Partial<Adventure> = {
        components: updateById(state.components, action.componentId, (item) =>
          recordComponentMemoryUpdate(item, { ...item, content: action.content }, { source: "aiMemoryUpdate", operation: "replace" }),
        ),
      };
      // Replaced text stays in component update history. Removal is not evidence of an event.
      return touchAdventure(state, basePatch);
    }
    case "REORDER_COMPONENT":
      return touchAdventure(state, { components: moveByPriority(state.components, action.componentId, action.direction) });
    case "UPSERT_STORY_CARD":
      return touchAdventure(state, { storyCards: upsertById(state.storyCards, touch(action.storyCard)) });
    case "DELETE_STORY_CARD":
      return touchAdventure(state, { storyCards: deleteById(state.storyCards, action.storyCardId) });
    case "ACTIVATE_STORY_CARD":
      return touchAdventure(state, { storyCards: updateById(state.storyCards, action.storyCardId, (item) => touch({ ...item, active: true })) });
    case "DEACTIVATE_STORY_CARD":
      return touchAdventure(state, { storyCards: updateById(state.storyCards, action.storyCardId, (item) => touch({ ...item, active: false })) });
    case "PIN_STORY_CARD":
      return touchAdventure(state, { storyCards: updateById(state.storyCards, action.storyCardId, (item) => touch({ ...item, pinned: true })) });
    case "UNPIN_STORY_CARD":
      return touchAdventure(state, { storyCards: updateById(state.storyCards, action.storyCardId, (item) => touch({ ...item, pinned: false })) });
    case "UPDATE_STORY_CARD":
      return touchAdventure(state, {
        storyCards: updateById(state.storyCards, action.storyCardId, (item) => {
          const next = mergePatch<StoryCard>(item, action.patch);
          return next.type === "event" ? { ...next, memoryMode: "historical", autoUpdate: false } : next;
        }),
      });
    case "APPLY_STORY_CARD_UPDATE":
      if (state.storyCards.some(card => card.id === action.storyCardId && card.type === "event")) return state;
      if (action.content === undefined && (!action.patch || Object.keys(action.patch).length === 0)) return state;
      return touchAdventure(state, {
        storyCards: updateById(state.storyCards, action.storyCardId, (item) => {
          const stripped = action.content !== undefined ? stripLeadingCardTitle(item.title, action.content) : item.content;
          const content = action.content !== undefined
            ? replacementContentWithGuardedFacts(item, stripped)
            : stripped;
          return recordStoryCardMemoryUpdate(
            item,
            guardStoryCard({ ...item, ...action.patch, content }),
            { source: "aiMemoryUpdate", operation: action.content !== undefined ? "replace" : "patch" },
          );
        }),
      });
    case "MARK_STORY_CARD_UPDATED":
      // Approval-gated auto-updates carry the proposal id that justified starting the
      // cooldown. If proposal dedupe rejected that candidate, do not pretend the card
      // was updated and postpone the next useful review.
      if (action.proposalId && !state.activeState.memoryProposals.some((proposal) => proposal.id === action.proposalId)) {
        return state;
      }
      return touchAdventure(state, {
        storyCards: updateById(state.storyCards, action.storyCardId, (item) => touch({ ...item, lastAutoUpdateTurn: action.turn })),
      });
    case "MARK_COMPONENT_UPDATED":
      return touchAdventure(state, {
        components: updateById(state.components, action.componentId, (item) => touch({ ...item, lastAutoUpdateTurn: action.turn })),
      });
    case "ADVANCE_ARC_PACING":
      return touchAdventure(state, {
        components: state.components.map((component) =>
          component.type === "currentArc" ? advanceArcComponent(component, action.triggeredIds, action.turn) : component,
        ),
      });
    case "SET_ARC_PHASE":
      return touchAdventure(state, {
        components: updateById(state.components, action.componentId, (item) => setArcPhase(item, action.phase, action.turn)),
      });
    case "SET_ARC_CONTINUATIONS":
      return touchAdventure(state, {
        components: updateById(state.components, action.componentId, (item) => touch({ ...item, arcContinuationOptions: action.options })),
      });
    case "COMPLETE_ARC_TO_STORY_CARD": {
      const comp = state.components.find((c) => c.id === action.componentId);
      if (!comp) return state;
      const archived = arcArchiveCard(comp);
      if (!archived) return state;
      return touchAdventure(state, {
        storyCards: [...state.storyCards, archived],
        components: updateById(state.components, action.componentId, clearCompletedArc),
      });
    }
    case "APPLY_ARC_CONTINUATION": {
      const comp = state.components.find((c) => c.id === action.componentId);
      if (!comp) return state;
      const opt = action.option;
      // Bank the resolved arc as a Story Card so previous arcs are preserved, then reseed
      // this component as the next arc and start its climb fresh.
      const archived = arcArchiveCard(comp);
      return touchAdventure(state, {
        storyCards: archived ? [...state.storyCards, archived] : state.storyCards,
        components: updateById(state.components, action.componentId, (item) =>
          touch({
            ...item,
            arcPremise: opt.premise,
            content: "",
            arcThreadKeys: opt.threadKeys,
            arcSimmerInstruction: opt.simmerInstruction,
            arcBreakInstruction: opt.breakInstruction,
            arcPace: opt.pace,
            arcContinuationOptions: undefined,
            arcState: { phase: "simmer", tier: 0, threadEngagement: {}, pendingBreak: false },
          }),
        ),
      });
    }
    case "REORDER_STORY_CARD":
      return touchAdventure(state, { storyCards: moveByPriority(state.storyCards, action.storyCardId, action.direction) });
    case "UPSERT_BRAIN":
      return touchAdventure(state, { brains: upsertById(state.brains, touch(action.brain)) });
    case "DELETE_BRAIN":
      return touchAdventure(state, { brains: deleteById(state.brains, action.brainId) });
    case "ACTIVATE_BRAIN":
      return touchAdventure(state, { brains: updateById(state.brains, action.brainId, (item) => touch({ ...item, active: true })) });
    case "DEACTIVATE_BRAIN":
      return touchAdventure(state, { brains: updateById(state.brains, action.brainId, (item) => touch({ ...item, active: false })) });
    case "PIN_BRAIN":
      return touchAdventure(state, { brains: updateById(state.brains, action.brainId, (item) => touch({ ...item, pinned: true })) });
    case "UNPIN_BRAIN":
      return touchAdventure(state, { brains: updateById(state.brains, action.brainId, (item) => touch({ ...item, pinned: false })) });
    case "UPDATE_BRAIN":
      return touchAdventure(state, {
        brains: updateById(state.brains, action.brainId, (item) => mergePatch<BrainEntry>(item, action.patch)),
      });
    case "APPEND_BRAIN_STATE":
      return touchAdventure(state, {
        brains: updateById(state.brains, action.brainId, (item) => updateBrainField(item, action.field, action.text, "append")),
      });
    case "REPLACE_BRAIN_STATE":
      return touchAdventure(state, {
        brains: updateById(state.brains, action.brainId, (item) => updateBrainField(item, action.field, action.text, "replace")),
      });
    case "APPLY_BRAIN_UPDATE": {
      const target = state.brains.find((brain) => brain.id === action.brainId);
      if (!target) return state;
      const basePatch: Partial<Adventure> = {
        brains: updateById(state.brains, action.brainId, (item) =>
          applyBrainUpdate(item, action.patch, action.mode, action.turn, action.preview),
        ),
      };
      const outgoing = outgoingBrainFieldProposalsForReplacement(state, target, action.patch, action.mode, String(action.turn ?? state.activeState.turn));
      const companionResult = applyCompanionMemoryProposals(state, basePatch, outgoing);
      return touchAdventure(state, {
        ...companionResult.patch,
        ...(companionResult.proposals.length > 0
          ? {
              activeState: {
                ...state.activeState,
                memoryProposals: [...companionResult.proposals, ...state.activeState.memoryProposals],
              },
            }
          : {}),
      });
    }
    case "UPSERT_TRIGGER_RULE":
      return touchAdventure(state, { triggerRules: upsertById(state.triggerRules, touch(action.triggerRule)) });
    case "DELETE_TRIGGER_RULE":
      return touchAdventure(state, { triggerRules: deleteById(state.triggerRules, action.triggerRuleId) });
    case "UPDATE_TRIGGER_RULE":
      return touchAdventure(state, {
        triggerRules: updateById(state.triggerRules, action.triggerRuleId, (item) => mergePatch<TriggerRule>(item, action.patch)),
      });
    case "MARK_TRIGGER_FIRED":
      return touchAdventure(state, {
        triggerRules: updateById(state.triggerRules, action.triggerRuleId, (item) => touch({ ...item, lastFiredTurn: action.turn })),
      });
    case "LOG_TRIGGER_FIRE":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          triggerLog: [action.entry, ...state.activeState.triggerLog].slice(0, 200),
        },
      });
    case "LOG_EVALUATION_RESULT":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          evaluationLog: [action.entry, ...state.activeState.evaluationLog].slice(0, 100),
        },
      });
    case "FORCE_INCLUDE_NEXT_TURN":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          forceIncludeNextTurn: [
            ...state.activeState.forceIncludeNextTurn.filter(
              (entry) => !(entry.targetType === action.targetType && entry.targetId === action.targetId),
            ),
            {
              id: createId("force"),
              targetType: action.targetType,
              targetId: action.targetId,
              expiresTurn: state.activeState.turn + 1,
              createdAt: nowIso(),
            },
          ],
        },
      });
    case "ADD_RAW_IMPORT":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          rawImports: [action.rawImport, ...state.activeState.rawImports],
        },
      });
    case "UPDATE_RAW_IMPORT":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          rawImports: updateById(state.activeState.rawImports, action.rawImportId, (entry) =>
            touch({ ...entry, ...action.patch } as RawImportEntry),
          ),
        },
      });
    case "DELETE_RAW_IMPORT":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          rawImports: deleteById(state.activeState.rawImports, action.rawImportId),
        },
      });
    case "ENROLL_RELATIONSHIP": {
      const brain = state.brains.find(b => b.id === action.brainId);
      const card = state.storyCards.find(c => c.id === action.focusStoryCardId && c.type === "character");
      if (!card || card.id === brain?.linkedStoryCardId) return state;
      const focus = card.title.trim();
      if (!brain || !focus || focus.length > 100 || focus.toLowerCase() === brain.characterName.toLowerCase() || !validRelationshipState(action.state)
        || (brain.relationships ?? []).length >= 12 || brain.relationships?.some(r => r.focusStoryCardId === card.id)) return state;
      const relationship = { id: createId("relationship"), focus, focusStoryCardId: card.id, current: action.state, revision: 0,
        recalledHistoryIds: [], history: [{ id: createId("relationship-history"), state: action.state, sourceTurnId: "player-setup", evidence: "Player-authored starting relationship", createdAt: nowIso() }] };
      return touchAdventure(state, { brains: state.brains.map(b => b.id === brain.id ? { ...b, relationships: [...(b.relationships ?? []), relationship] } : b) });
    }
    case "LINK_RELATIONSHIP_FOCUS": {
      const brain = state.brains.find(b => b.id === action.brainId);
      const r = brain?.relationships.find(r => r.id === action.relationshipId);
      const card = state.storyCards.find(c => c.id === action.focusStoryCardId && c.type === "character");
      if (!brain || !r || relationshipFocusCard(state, r) || !card || !card.title.trim() || card.id === brain.linkedStoryCardId
        || card.title.trim().toLowerCase() === brain.characterName.trim().toLowerCase()
        || brain.relationships.some(other => other.id !== r.id && other.focusStoryCardId === card.id)) return state;
      return touchAdventure(state, { brains: state.brains.map(b => b.id !== brain.id ? b : { ...b,
        relationships: b.relationships.map(entry => entry.id !== r.id ? entry : { ...entry, focusStoryCardId: card.id, focus: card.title, revision: entry.revision + 1 }) }) });
    }
    case "EDIT_RELATIONSHIP":
    case "RECALL_RELATIONSHIP_HISTORY": {
      return touchAdventure(state, { brains: state.brains.map(b => b.id !== action.brainId ? b : { ...b, relationships: b.relationships.map(r => {
        if (r.id !== action.relationshipId) return r;
        if (action.type === "RECALL_RELATIONSHIP_HISTORY") return { ...r, recalledHistoryIds: [...new Set(action.historyIds)].filter(id => r.history.some(h => h.id === id)).slice(0, 3) };
        if (!validRelationshipState(action.state) || stateKey(r.current) === stateKey(action.state)) return r;
        return { ...r, current: action.state, revision: r.revision + 1, history: [...r.history, { id: createId("relationship-history"), sourceTurnId: "player-edit", state: action.state, evidence: "Player edit", createdAt: nowIso() }] };
      }) }) });
    }
    case "ADD_MEMORY_PROPOSAL": {
      const clean = sanitizeProposal(routedProposal(state, action.proposal));
      if (!clean) return state;
      if (clean.proposedType === "plotPressureUpdate" && !state.components.some(c => c.type === "activePressure" && (!clean.targetId || c.id === clean.targetId))) return state;
      if (clean.proposedType === "relationshipUpdate") {
        if (!relationshipIsCurrent(state, clean) || duplicateRelationship(state, clean)) return state;
        const t = clean.relationship!;
        const major = t.previous.bond !== t.proposed.bond || t.previous.status !== t.proposed.status;
        const approved = state.memoryAutoApprove.relationshipUpdate && !clean.requiresReview && !major;
        const proposal = { ...clean, status: approved ? "approved" as const : "pending" as const };
        return touchAdventure(state, { ...(approved ? { brains: applyRelationship(state, proposal) } : {}),
          activeState: { ...state.activeState, memoryProposals: [proposal, ...state.activeState.memoryProposals] } });
      }
      if (clean.storyCardType === "event" && [...state.storyCards.filter(c => c.type === "event"), ...state.activeState.memoryProposals.filter(p => p.storyCardType === "event")].some(c => sameEventMemory(c, clean))) return state;
      // Dedup: drop a proposal that duplicates one already pending, one the user already
      // dismissed (rejected/ignored), or a NEW story card whose title already exists as a card.
      // Without this, the model re-suggesting the same entity each turn spawns a fresh duplicate —
      // including resurrecting suggestions the user has already said no to.
      const normTitle = normalizeProposalTitle(clean.title);
      const isUpdate = clean.appendContent === true;
      const targetStoryCard = clean.proposedType === "storyCard" && clean.targetId
        ? state.storyCards.find((card) => card.id === clean.targetId)
        : undefined;
      const hasMemoryPatch =
        Boolean(clean.storyCardPatch && Object.keys(clean.storyCardPatch).length > 0) ||
        Boolean(clean.componentPatch && Object.keys(clean.componentPatch).length > 0);
      const matchesTarget = (p: MemoryProposal) =>
        p.proposedType === clean.proposedType &&
        normalizeProposalTitle(p.title) === normTitle &&
        (p.targetId ?? "") === (clean.targetId ?? "");
      const duplicatesPending = state.activeState.memoryProposals.some((p) => p.status === "pending" && matchesTarget(p));
      // A dismissed new-card suggestion should not come back every turn. Targeted updates are
      // different: a Brain or Story Card keeps evolving, so rejecting one revision must not mute
      // every later revision for that target. Only suppress a targeted update when its content is
      // the same or substantially duplicates the dismissed revision.
      const duplicatesDismissed =
        state.activeState.memoryProposals.some((p) =>
          (p.status === "rejected" || p.status === "ignored") &&
          matchesTarget(p) &&
          (
            !clean.targetId ||
            contentLooksDuplicate(p.content, clean.content) ||
            normalizedReplacementContent(p.content) === normalizedReplacementContent(clean.content)
          )
        );
      const duplicatesCard =
        clean.proposedType === "storyCard" &&
        !clean.targetId &&
        state.storyCards.some((c) => normalizeProposalTitle(c.title) === normTitle);
      // Similarity can deduplicate event retellings, but must not merge distinct character identities.
      const duplicatesStoryCardContent = clean.proposedType === "storyCard" && clean.storyCardType !== "character"
        && !isUpdate && !clean.targetId && state.activeState.memoryProposals.some(p =>
          p.proposedType === "storyCard" && p.storyCardType !== "character" && !p.targetId && contentLooksDuplicate(p.content, clean.content));
      const duplicatesExistingCardContent = clean.proposedType === "storyCard" && clean.storyCardType !== "character"
        && !isUpdate && !clean.targetId && state.storyCards.some(c => c.type !== "character" && contentLooksDuplicate(c.content, clean.content));
      const duplicatesExistingTargetContent =
        clean.proposedType === "storyCard" &&
        isUpdate &&
        !hasMemoryPatch &&
        Boolean(targetStoryCard) &&
        (
          contentLooksDuplicate(targetStoryCard?.content ?? "", clean.content) ||
          normalizedReplacementContent(targetStoryCard?.content ?? "").includes(normalizedReplacementContent(clean.content))
        );
      const duplicatesCurrentPressure =
        clean.proposedType === "plotPressureUpdate" &&
        !hasMemoryPatch &&
        state.components.some(
          (component) =>
            component.type === "activePressure" &&
            (component.id === clean.targetId || !clean.targetId) &&
            normalizedReplacementContent(component.content) === normalizedReplacementContent(clean.content),
        );
      if (duplicatesPending || duplicatesDismissed || duplicatesCard || duplicatesStoryCardContent || duplicatesExistingCardContent || duplicatesExistingTargetContent || duplicatesCurrentPressure) return state;
      const autoApprove = state.memoryAutoApprove?.[clean.proposedType as keyof typeof state.memoryAutoApprove] ?? false;
      if (autoApprove && !clean.requiresReview) {
        const approved = updateMemoryProposal(clean, { status: "approved" });
        const applied = applyApprovedMemoryProposal(state, approved);
        if (clean.proposedType === "plotPressureUpdate") {
          return touchAdventure(state, applied);
        }
        return touchAdventure(state, {
          ...applied,
          activeState: {
            ...state.activeState,
            memoryProposals: [approved, ...state.activeState.memoryProposals],
          },
        });
      }
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          memoryProposals: [clean, ...state.activeState.memoryProposals],
        },
      });
    }
    case "UPDATE_MEMORY_PROPOSAL":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          memoryProposals: updateById(state.activeState.memoryProposals, action.proposalId, (proposal) =>
            updateMemoryProposal(proposal, action.patch),
          ),
        },
      });
    case "APPROVE_MEMORY_PROPOSAL": {
      const existing = state.activeState.memoryProposals.find((proposal) => proposal.id === action.proposalId);
      if (!existing || (existing.proposedType === "relationshipUpdate" && (existing.status !== "pending" || !relationshipIsCurrent(state, existing)))) return state;
      const proposal = sanitizeProposal(routedProposal(state, proposalWithEdits(existing, action.editedProposal)));
      if (!proposal || (proposal.proposedType === "relationshipUpdate" && !relationshipIsCurrent(state, proposal))) return state;
      const approved = updateMemoryProposal(proposal, { status: "approved" });
      const applied = applyApprovedMemoryProposal(state, approved);
      return touchAdventure(state, {
        ...applied,
        activeState: {
          ...state.activeState,
          memoryProposals: [
            ...state.activeState.memoryProposals.map((entry) => (entry.id === action.proposalId ? approved : entry)),
          ],
        },
      });
    }
    case "REJECT_MEMORY_PROPOSAL":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          memoryProposals: updateById(state.activeState.memoryProposals, action.proposalId, (proposal) =>
            updateMemoryProposal(proposal, { status: "rejected" }),
          ),
        },
      });
    case "IGNORE_MEMORY_PROPOSAL":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          memoryProposals: updateById(state.activeState.memoryProposals, action.proposalId, (proposal) =>
            updateMemoryProposal(proposal, { status: "ignored" }),
          ),
        },
      });
    case "UPDATE_ROLLING_SUMMARY":
      return touchAdventure(state, {
        rollingSummary: {
          content: action.content,
          updatedAt: nowIso(),
          lastSummarizedMessageIndex: action.lastSummarizedMessageIndex ?? state.rollingSummary.lastSummarizedMessageIndex,
        },
      });
    case "UPDATE_SCENE_STATE":
      return touchAdventure(state, {
        sceneState: { content: action.content, updatedAt: nowIso() },
      });
    case "SET_TOKEN_BUDGET_SETTINGS":
      return touchAdventure(state, { tokenBudgetSettings: action.settings });
    case "SET_SYSTEM_TRIGGER_SETTINGS":
      return touchAdventure(state, { systemTriggers: action.settings });
    case "SET_MODEL_CONFIG":
      return touchAdventure(state, { modelConfig: stripProviderKey(action.config) });
    case "SET_SEMANTIC_EVALUATION_SETTINGS":
      return touchAdventure(state, { semanticEvaluationSettings: action.settings });
    case "SET_MEMORY_AUTO_APPROVE":
      return touchAdventure(state, { memoryAutoApprove: action.settings });
    case "SET_MEMORY_DETECTION_SETTINGS":
      return touchAdventure(state, { memoryDetectionSettings: action.settings });
    case "SET_STATE_FLAG":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          stateFlags: { ...state.activeState.stateFlags, [action.key]: action.value },
        },
      });
    case "SET_RESPONSE_LENGTH_HINT":
      return touchAdventure(state, {
        activeState: { ...state.activeState, responseLengthHint: action.hint },
      });
    case "ACCUMULATE_BACKGROUND_TOKENS":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          backgroundTokenUsage: {
            promptTokens: (state.activeState.backgroundTokenUsage?.promptTokens ?? 0) + action.promptTokens,
            completionTokens: (state.activeState.backgroundTokenUsage?.completionTokens ?? 0) + action.completionTokens,
          },
        },
      });
    case "SET_NEXT_TURN_NOTE": {
      const timestamp = nowIso();
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          nextTurnNote: {
            ...defaultNextTurnNote(),
            ...(state.activeState.nextTurnNote ?? {}),
            ...action.note,
            createdAt: state.activeState.nextTurnNote?.createdAt ?? timestamp,
            updatedAt: timestamp,
          },
        },
      });
    }
    case "CLEAR_NEXT_TURN_NOTE":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          nextTurnNote: defaultNextTurnNote(),
        },
      });
    case "CONSUME_NEXT_TURN_NOTE":
      if (!state.activeState.nextTurnNote?.expiresAfterUse) return state;
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          nextTurnNote: {
            ...state.activeState.nextTurnNote,
            content: "",
            active: true,
            updatedAt: nowIso(),
          },
        },
      });
    case "QUEUE_PENDING_UPDATE":
      return touchAdventure(state, {
        activeState: {
          ...state.activeState,
          pendingUpdates: [...state.activeState.pendingUpdates, action.update],
        },
      });
    case "FLUSH_PENDING_UPDATES": {
      const pendingUpdates = state.activeState.pendingUpdates;
      if (pendingUpdates.length === 0) return state;
      let next = touchAdventure(state, {
        activeState: {
          ...state.activeState,
          pendingUpdates: [],
        },
      });
      for (const pending of pendingUpdates) {
        for (const pendingAction of pending.actions) {
          if (pendingAction.type === "QUEUE_PENDING_UPDATE" || pendingAction.type === "FLUSH_PENDING_UPDATES") continue;
          next = adventureReducer(next, pendingAction);
        }
      }
      return next;
    }
    case "RESET_RUNTIME_STATE":
      return touchAdventure(state, {
        messages: [],
        rollingSummary: { content: "", updatedAt: nowIso() },
        activeState: {
          ...state.activeState,
          turn: 0,
          forceIncludeNextTurn: [],
          triggerLog: [],
          evaluationLog: [],
          memoryProposals: [],
          pendingUpdates: [],
          storyUndoStack: [],
          storyRedoStack: [],
          nextTurnNote: defaultNextTurnNote(),
          stateFlags: {},
          challengeMode: false,
        },
        triggerRules: state.triggerRules.map((rule) => touch({ ...rule, lastFiredTurn: undefined })),
      });
    case "SET_AUTO_SAVE_SETTINGS":
      return touchAdventure(state, { autoSaveEnabled: action.autoSaveEnabled, autoSaveEveryNTurns: action.autoSaveEveryNTurns, autoSaveEveryNMinutes: action.autoSaveEveryNMinutes });
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
