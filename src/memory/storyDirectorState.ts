import { validRelationshipState } from './relationships';
import type { Adventure, ComponentEntry, RelationshipState, StoryCardCompactStatus } from '../types/adventure';

export type StoryMode = 'NORMAL_PLAY' | 'ACTIVE_PROGRESSION' | 'CLOSURE' | 'RESOLVED';
export type StoryDirectorMode = 'AUTO' | StoryMode;
export const STORY_DIRECTOR_MODES: StoryDirectorMode[] = ['AUTO', 'NORMAL_PLAY', 'ACTIVE_PROGRESSION', 'CLOSURE', 'RESOLVED'];
export const STORY_MODE_LABELS: Record<StoryDirectorMode, string> = { AUTO: 'Auto', NORMAL_PLAY: 'Normal play', ACTIVE_PROGRESSION: 'Active progression', CLOSURE: 'Closure', RESOLVED: 'Resolved / aftermath' };
export function normalizeDirectorMode(value: unknown): StoryDirectorMode {
  return STORY_DIRECTOR_MODES.includes(value as StoryDirectorMode) ? value as StoryDirectorMode : 'AUTO';
}
export interface StoryThread {
  id: string;
  mode: StoryMode;
  reason: string;
  evidence: string;
  sourceMessageId: string;
  confidence: number;
  loopObstructs: boolean;
}
export interface StoryDirectorState {
  sourceMessageId: string;
  sourceContent: string;
  threads: StoryThread[];
  reason: string;
}
export interface StoryDirectorDetectedChange {
  change: 'STATE_UPDATE' | 'CANON_COMMIT';
  evidence: string;
  reason: string;
}
/** One compact, persisted verdict per accepted assistant response. Story text stays in messages. */
export interface StoryDirectorEvaluation {
  sourceMessageId: string;
  sourceContentFingerprint: string;
  turn: number;
  createdAt: string;
  modeOverride?: StoryDirectorMode;
  evidenceSources?: { id: string; sourceMessageId: string; quote: string }[];
  rejectedResponses?: { stage: 'evaluation' | 'reconciliation'; attempt: number; response: string; error: string }[];
  verdict?: Pick<StoryDirectorState, 'reason' | 'threads'>;
  changes: StoryDirectorDetectedChange[];
  playLoopSuspended: boolean;
  reconciliation: { status: 'notRequested' | 'empty' | 'batch' | 'failed'; batchId?: string; editCount?: number };
  errors: string[];
  usage: { promptTokens: number; completionTokens: number };
}
/** Detect later edits to evaluated prose without copying the transcript into every record. */
export function storyDirectorSourceFingerprint(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
}
export interface CanonEdit {
  kind: 'component' | 'storyCard' | 'brain' | 'relationship';
  id: string;
  relationshipId?: string;
  before: string;
  content?: string;
  thoughts?: Record<string, string>;
  relationship?: RelationshipState;
  resolved?: boolean;
  state?: string;
  compactStatus?: StoryCardCompactStatus;
  change: 'STATE_UPDATE' | 'CANON_COMMIT';
  evidence: string;
  reason: string;
  removedFacts: string[];
}
export interface CanonBatch {
  id: string;
  sourceMessageId: string;
  sourceContent: string;
  edits: CanonEdit[];
  after?: string[];
  status: 'pending' | 'applied' | 'rejected' | 'stale';
}
export const DEFAULT_PLAY_LOOP = `Continue the active scene in response to the player, keeping the fiction live and unresolved.

Normal sandbox play: allow unrelated events, life between plots, dormant possibilities, incidental scenes, and autonomous NPCs. Let threats simmer. Keep forced payoff velocity low; not every scene becomes the main plot. Nothing urgent happening is valid play when the cast is socially alive.`;
export function isPlayLoop(c: ComponentEntry): boolean {
  return c.type === 'custom' && (c.contextRole === 'playLoop' || (c.contextRole === undefined && /^(?:core gameplay loop|play loop)$/i.test(c.title.trim())));
}
export function directorEnabled(a: Adventure): boolean {
  return normalizeDirectorMode(a.activeState.storyDirectorMode) !== 'AUTO' || a.components.some(c => c.active && isPlayLoop(c));
}
export function currentDirector(a: Adventure): StoryDirectorState | undefined {
  const d = a.activeState.storyDirector;
  const latest = [...a.messages].reverse().find(m => m.role === 'assistant');
  return d && latest?.id === d.sourceMessageId && latest.content === d.sourceContent ? d : undefined;
}
export function effectiveDirectorMode(a: Adventure): StoryMode {
  const override = normalizeDirectorMode(a.activeState.storyDirectorMode);
  if (override !== 'AUTO') return override;
  if (!directorEnabled(a)) return 'NORMAL_PLAY';
  const threads = currentDirector(a)?.threads.filter(t => t.confidence >= 0.9) ?? [];
  if (threads.some(t => t.mode === 'CLOSURE')) return 'CLOSURE';
  if (threads.some(t => t.mode === 'ACTIVE_PROGRESSION' && t.loopObstructs)) return 'ACTIVE_PROGRESSION';
  return 'NORMAL_PLAY';
}
export function playLoopSuspended(a: Adventure): boolean {
  return ['ACTIVE_PROGRESSION', 'CLOSURE', 'RESOLVED'].includes(effectiveDirectorMode(a));
}

function stableSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export function ownerSnapshot(a: Adventure, e: Pick<CanonEdit, 'kind' | 'id' | 'relationshipId'>, includeHistorical = false): string | undefined {
  if (e.kind === 'component') {
    const c = a.components.find(c => c.id === e.id && ['plotEssentials', 'currentArc', 'activePressure'].includes(c.type));
    return c ? stableSnapshot({ ...c, memoryUpdateHistory: undefined, lockFromStoryDirector: undefined }) : undefined;
  }
  if (e.kind === 'storyCard') {
    const c = a.storyCards.find(c => c.id === e.id && c.type !== 'event' && (includeHistorical || c.memoryMode !== 'historical'));
    return c ? stableSnapshot({ ...c, coreFacts: c.coreFacts ?? [], currentFacts: c.currentFacts ?? [], recentDevelopments: c.recentDevelopments ?? [], sourceTurnIds: c.sourceTurnIds ?? [], memoryUpdateHistory: undefined, lockFromStoryDirector: undefined }) : undefined;
  }
  const b = a.brains.find(b => b.id === e.id);
  if (!b) return undefined;
  if (e.kind === 'brain') return stableSnapshot({ ...b, archivedThoughts: undefined,
    relationships: b.relationships.map(r => ({ ...r, history: undefined })) });
  const r = b.relationships.find(r => r.id === e.relationshipId && a.storyCards.some(c => c.id === r.focusStoryCardId && c.type === 'character'));
  return r ? stableSnapshot({ ...r, history: undefined }) : undefined;
}
/** Lock from Story Director: blocks new reconciliation edits only. Not consulted by rollback or any other update path. */
export function lockedFromStoryDirector(a: Adventure, e: Pick<CanonEdit, 'kind' | 'id'>): boolean {
  if (e.kind === 'component') return a.components.some(c => c.id === e.id && (c.type === 'plotEssentials' || c.type === 'currentArc') && c.lockFromStoryDirector === true);
  if (e.kind === 'storyCard') return a.storyCards.some(c => c.id === e.id && c.lockFromStoryDirector === true);
  return false;
}
export function batchIsCurrent(a: Adventure, b: CanonBatch): boolean {
  return a.messages.some(m => m.role === 'assistant' && m.id === b.sourceMessageId && m.content === b.sourceContent)
    && b.edits.length > 0 && b.edits.length <= 80
    && new Set(b.edits.map(e => e.kind + ':' + e.id + ':' + (e.relationshipId ?? ''))).size === b.edits.length
    && b.edits.every(e => !lockedFromStoryDirector(a, e))
    && b.edits.every(e => typeof e.before === 'string' && ownerSnapshot(a, e) === e.before
      && typeof e.evidence === 'string' && e.evidence.trim().length > 0 && b.sourceContent.includes(e.evidence)
      && ['STATE_UPDATE', 'CANON_COMMIT'].includes(e.change)
      && Array.isArray(e.removedFacts) && e.removedFacts.every(f => typeof f === 'string')
      && (e.kind === 'component' || e.kind === 'storyCard' ? typeof e.content === 'string' && (e.content.trim().length > 0 || e.resolved === true)
        : e.kind === 'relationship' ? validRelationshipState(e.relationship)
        : e.kind === 'brain' && !!e.thoughts && typeof e.thoughts === 'object' && !Array.isArray(e.thoughts) && Object.values(e.thoughts).every(t => typeof t === 'string')));
}
export const PROGRESSION_DIRECTION = `The recent story has earned active progression. Allow actions already underway to change the thread and establish new facts. Do not force escalation, a next scene, an ending, or a player decision. An open player decision does not require an unresolved plot.`;
export const CLOSURE_DIRECTION = `The recent story has naturally converged. Allow definitive answers, decisive NPC action, and consequences supported by established events. Do not preserve uncertainty by adding another clue, intermediary, hidden layer, or deeper mastermind merely to keep the thread alive. Do not predetermine an ending or decide the player's actions, dialogue, consent, or choices. Keep their next action open even when the problem resolves.`;

export const RESOLVED_DIRECTION = `The player requests aftermath and ordinary life. Let completed consequences stand and allow unrelated activity. Do not reopen a resolved problem or invent a successor to keep a plot going. This direction does not establish new canon or decide the player's actions.`;
