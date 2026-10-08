import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, normalizeAdventure } from '../state/defaults';
import { adventureReducer } from '../state/adventureReducer';
import { buildContext } from '../contextBuilder/contextBuilder';
import { applyAIMemoryUpdate } from './applyAIMemoryUpdate';
import { currentDirector, isPlayLoop, playLoopSuspended, ownerSnapshot, storyDirectorSourceFingerprint } from './storyDirectorState';
import { directorEvidence, evaluateStoryDirector, parseCanonBatch, parseStoryState, reconciliationOwners, recentDirectorMessages, RECONCILE_PROMPT, STORY_STATE_PROMPT } from './storyDirector';
import { parseComponentsJson } from '../importers/componentParser';
import { sendOpenAICompatibleChatCompletion } from '../providers/openAICompatible';
import { runTurnPipeline } from '../state/turnPipeline';
import { exportAdventureJson, importAdventureJson } from '../utils/json';
import type { Adventure } from '../types/adventure';
vi.mock('../providers/openAICompatible', () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
const event = 'Track Star admits the betrayal and hands over the original orders. Mara hears Track Star confess.';
function base() {
  let a = createDefaultAdventure('Sandbox');
  a.storyCards = [makeStoryCard({ id: 'star', title: 'Track Star', type: 'character', content: 'Track Star is loyal. Track Star can fly.', coreFacts: ['Track Star is loyal.'], archivedFacts: 'Track Star promised never to betray the team.' })];
  a.components.push(makeComponent({ id: 'arc', type: 'currentArc', title: 'Current Arc', content: 'The traitor is unknown.', arcPremise: 'Identify the traitor.' }));
  a = adventureReducer(a, { type: 'ADD_MESSAGE', role: 'assistant', id: 'accepted', content: event });
  return a;
}
function verdict(mode = 'NORMAL_PLAY', loopObstructs = false, confidence = 0.95) {
  return { reason: 'Judge only what happened.', threads: mode === 'NORMAL_PLAY' ? [] : [{ id: 'traitor', mode, loopObstructs, confidence, evidence: event, sourceMessageId: 'accepted', reason: 'Evidence answers the question.' }], changes: [] };
}
function edit(kind = 'storyCard', id = 'star', content = 'Track Star betrayed the team. Track Star can fly.') {
  return { kind, id, content, evidence: event, change: 'CANON_COMMIT', reason: 'The confession and orders establish the betrayal.', removedFacts: ['Track Star is loyal.'] };
}
function apply(a: Adventure, raw: unknown, review = false) {
  const batch = parseCanonBatch(a, raw);
  return adventureReducer(a, { type: 'RECONCILE_CANON', batch, review });
}
beforeEach(() => vi.resetAllMocks());
describe('story-led progression', () => {
  it('defaults to normal play and preserves exact loop text during suspension and restoration', () => {
    let a = base();
    const loop = a.components.find(isPlayLoop)!;
    for (const [mode, obstructs, suspended] of [['NORMAL_PLAY', false, false], ['ACTIVE_PROGRESSION', false, false], ['ACTIVE_PROGRESSION', true, true], ['CLOSURE', false, true], ['RESOLVED', false, false]] as const) {
      a = adventureReducer(a, { type: 'SET_STORY_DIRECTOR', state: parseStoryState(a, verdict(mode, obstructs)).state });
      const c = buildContext(a);
      expect(playLoopSuspended(a)).toBe(suspended);
      expect(c.sections.flatMap(s => s.items).some(i => i.id === loop.id)).toBe(!suspended);
      expect(a.components.find(c => c.id === loop.id)).toEqual(loop);
      if (suspended) expect(c.excludedItems.find(i => i.id === loop.id)?.detail).toContain('temporarily suspended');
    }
  });
  it('rejects unsupported quotes and tolerates false negatives', () => {
    const a = base();
    expect(() => parseStoryState(a, { ...verdict('CLOSURE'), threads: [{ ...verdict('CLOSURE').threads[0], evidence: 'invented evidence' }] })).toThrow();
    const n = adventureReducer(a, { type: 'SET_STORY_DIRECTOR', state: parseStoryState(a, verdict('CLOSURE', true, 0.89)).state });
    expect(playLoopSuspended(n)).toBe(false);
  });
  it('keeps another independently active thread suspended after one resolves', () => {
    const a = base(); const v = verdict('RESOLVED');
    v.threads.push({ ...verdict('CLOSURE').threads[0], id: 'other conflict' });
    expect(playLoopSuspended(adventureReducer(a, { type: 'SET_STORY_DIRECTOR', state: parseStoryState(a, v).state }))).toBe(true);
  });
  it('does not reveal the authored break early or alter authored pacing', () => {
    let a = base(); a.components.find(c => c.id === 'arc')!.arcBreakInstruction = 'SECRET AUTHORED COST';
    a = adventureReducer(a, { type: 'SET_STORY_DIRECTOR', state: parseStoryState(a, verdict('CLOSURE')).state });
    expect(buildContext(a).messages[0].content).not.toContain('SECRET AUTHORED COST');
    expect(a.components.find(c => c.id === 'arc')!.arcState?.phase).toBe('simmer');
    expect(buildContext(a).messages[0].content).toContain('deeper mastermind');
  });
  it('moves only the exact legacy sandbox sentence and preserves authored instructions', () => {
    const a = base(); const old = 'Continue the active scene in response to the player, keeping the fiction live and unresolved.';
    delete a.activeState.stateFlags.playLoopSeparated;
    a.components = [makeComponent({ title: 'Rules', type: 'narrationRules', content: 'PLAYER AGENCY\n' + old + '\nCUSTOM PROSE' })];
    const n = normalizeAdventure(a);
    expect(n.components.find(isPlayLoop)?.content).toBe(old);
    expect(n.components.find(c => c.type === 'narrationRules')?.content).toContain('CUSTOM PROSE');
    expect(normalizeAdventure(n).components).toEqual(n.components);
  });
  it('does not recreate a Play Loop deliberately removed from a migrated adventure', () => {
    const a = base(); a.components = a.components.filter(c => !isPlayLoop(c));
    expect(normalizeAdventure(a).components.some(isPlayLoop)).toBe(false);
  });
  it('invalidates suspension when the accepted source is edited or erased', () => {
    const a = base(); const n = adventureReducer(a, { type: 'SET_STORY_DIRECTOR', state: parseStoryState(a, verdict('CLOSURE')).state });
    expect(currentDirector(adventureReducer(n, { type: 'DELETE_MESSAGE', messageId: 'accepted' }))).toBeUndefined();
  });
});
describe('atomic canon reconciliation', () => {
  it('replaces an unplanned betrayal across owners without restoring stale guarded facts', () => {
    const a = base();
    const n = apply(a, { edits: [edit(), { ...edit('component', 'arc', 'The betrayal was exposed and the traitor surrendered.'), resolved: true, removedFacts: ['The traitor is unknown.'] }] });
    expect(n.storyCards[0].content).toContain('can fly');
    expect(n.storyCards[0].coreFacts).toEqual([]);
    const later = adventureReducer(n, { type: 'APPLY_STORY_CARD_UPDATE', storyCardId: 'star', content: n.storyCards[0].content });
    expect(buildContext(normalizeAdventure(later)).messages[0].content).not.toContain('promised never');
    expect(buildContext(n).messages[0].content).not.toContain('traitor is unknown');
    expect(n.components.find(c => c.id === 'arc')?.arcPremise).toBe('');
    expect(n.storyCards[0].memoryUpdateHistory?.at(-1)?.previous?.content).toContain('is loyal');
    expect(n.activeState.canonBatches?.[0].status).toBe('applied');
  });
  it('rejects the entire batch on stale owner edits or removed evidence', () => {
    const a = base(); const batch = parseCanonBatch(a, { edits: [edit(), edit('component', 'arc', 'The traitor is exposed.')] });
    const changed = adventureReducer(a, { type: 'UPDATE_STORY_CARD', storyCardId: 'star', patch: { content: 'Player revision' } });
    const n = adventureReducer(changed, { type: 'RECONCILE_CANON', batch, review: false });
    expect(n.components).toEqual(changed.components);
    expect(n.activeState.canonBatches?.[0].status).toBe('stale');
    expect(applyAIMemoryUpdate(adventureReducer(a, { type: 'DELETE_MESSAGE', messageId: 'accepted' }), [{ type: 'canonReconciliation', batch }]).actions).toEqual([]);
  });
  it('cannot edit narrator rules, Play Loop or historical records', () => {
    const a = base();
    for (const c of a.components.filter(c => c.type === 'narrationRules' || isPlayLoop(c))) expect(() => parseCanonBatch(a, { edits: [edit('component', c.id, 'Bad')] })).toThrow();
    a.storyCards[0].memoryMode = 'historical';
    expect(() => parseCanonBatch(a, { edits: [edit()] })).toThrow();
  });
  it('respects approval, rejection, and source revision on later approval', () => {
    const a = base(); const batch = parseCanonBatch(a, { edits: [edit()] });
    const actions = applyAIMemoryUpdate(a, [{ type: 'canonReconciliation', batch }]).actions;
    const pending = actions.reduce(adventureReducer, a);
    expect(pending.storyCards).toEqual(a.storyCards);
    expect(pending.activeState.canonBatches?.[0].status).toBe('pending');
    expect(adventureReducer(pending, { type: 'REVIEW_CANON_BATCH', batchId: batch.id, approve: true }).storyCards[0].content).toContain('betrayed');
    expect(adventureReducer(pending, { type: 'REVIEW_CANON_BATCH', batchId: batch.id, approve: false }).storyCards).toEqual(a.storyCards);
  });
  it('keeps dynamic sentiment in its enrolled owner and archives superseded thoughts', () => {
    const a = base();
    a.memoryAutoApprove = { ...a.memoryAutoApprove, storyDirector: true, storyCard: true, brainUpdate: true, relationshipUpdate: true };
    a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
    const b = makeBrain({ id: 'mara', characterName: 'Mara', thoughts: { suspect: 'I suspect the captain.' }, relationships: [{ id: 'pair', focus: 'Track Star', focusStoryCardId: 'star', current: { bond: 'teammate', status: 'active', dimensions: { trust: 'trusts him' } }, revision: 0, history: [], recalledHistoryIds: [] }] });
    a.brains = [b];
    const batch = parseCanonBatch(a, { edits: [edit(), { ...edit('brain', 'mara'), thoughts: { response: 'His confession changes everything.' } }, { ...edit('relationship', 'mara'), relationshipId: 'pair', relationship: { bond: 'teammate', status: 'active', dimensions: { trust: 'distrusts him after hearing the confession' } }, knowledgeEvidence: 'Mara hears Track Star confess.' }] });
    const pending = applyAIMemoryUpdate(a, [{ type: 'canonReconciliation', batch }]).actions.reduce(adventureReducer, a);
    expect(pending.activeState.canonBatches?.[0].status).toBe('pending');
    const n = adventureReducer(pending, { type: 'REVIEW_CANON_BATCH', batchId: batch.id, approve: true });
    expect(n.brains[0].relationships[0].revision).toBe(1);
    expect(n.brains[0].relationships[0].history).toHaveLength(1);
    expect(n.storyCards[0].content).not.toContain('distrusts');
    expect(Object.values(n.brains[0].archivedThoughts)).toContain('I suspect the captain.');
  });
  it('preserves reconciled canon and rollback eligibility across save normalization', () => {
    const a = base(); const applied = apply(a, { edits: [edit()] });
    const loaded = normalizeAdventure(JSON.parse(JSON.stringify(applied)) as Adventure);
    expect(loaded.storyCards[0].content).toContain('betrayed');
    expect(JSON.parse(ownerSnapshot(loaded, loaded.activeState.canonBatches![0].edits[0], true)!)).toEqual(JSON.parse(loaded.activeState.canonBatches![0].after![0]));
    const reverted = adventureReducer(loaded, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' });
    expect(reverted.storyCards[0].content).toBe(a.storyCards[0].content);
  });
  it('does not copy accumulated archives into every reconciliation snapshot', () => {
    const a = base();
    const once = apply(a, { edits: [edit()] });
    const batch = parseCanonBatch(once, { edits: [edit()] });
    expect(batch.edits[0].before).not.toContain('memoryUpdateHistory');
  });
  it('rolls back a card converted to historical memory when its source is replaced', () => {
    const a = base();
    a.storyCards[0].type = 'plot';
    const n = apply(a, { edits: [{ ...edit(), resolved: true }] });
    expect(n.storyCards[0].memoryMode).toBe('historical');
    const restored = adventureReducer(n, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' }).storyCards[0];
    expect(restored.content).toBe(a.storyCards[0].content);
    expect(restored.memoryMode).toBe(a.storyCards[0].memoryMode);
    expect(restored.compactStatus).toBe(a.storyCards[0].compactStatus);
  });
  it('reverts automatic canon before regeneration and preserves later user edits', () => {
    const a = base(); const n = apply(a, { edits: [edit()] });
    const erased = adventureReducer(n, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' });
    expect(erased.storyCards[0].content).toBe(a.storyCards[0].content);
    const changed = adventureReducer(n, { type: 'UPDATE_STORY_CARD', storyCardId: 'star', patch: { content: 'Player edit' } });
    expect(adventureReducer(changed, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' }).storyCards[0].content).toBe('Player edit');
  });
});
describe('Lock from Story Director', () => {
  function locked() {
    const a = base();
    a.storyCards[0].lockFromStoryDirector = true;
    a.components.find(c => c.id === 'arc')!.lockFromStoryDirector = true;
    return a;
  }
  it('excludes locked owners from reconciliation targets', () => {
    const ids = reconciliationOwners(locked()).map(o => o.id);
    expect(ids).not.toContain('star');
    expect(ids).not.toContain('arc');
    expect(reconciliationOwners(base()).map(o => o.id)).toEqual(expect.arrayContaining(['star', 'arc']));
  });
  it('rejects a returned edit for a locked owner', () => {
    const a = locked();
    expect(() => parseCanonBatch(a, { edits: [edit()] })).toThrow();
    expect(() => parseCanonBatch(a, { edits: [edit('component', 'arc', 'The traitor is exposed.')] })).toThrow();
  });
  it('makes a pending batch stale on approval once its owner is locked', () => {
    const a = base();
    const batch = parseCanonBatch(a, { edits: [edit()] });
    const pending = adventureReducer(a, { type: 'RECONCILE_CANON', batch, review: true });
    const lockedState = adventureReducer(pending, { type: 'UPDATE_STORY_CARD', storyCardId: 'star', patch: { lockFromStoryDirector: true } });
    const n = adventureReducer(lockedState, { type: 'REVIEW_CANON_BATCH', batchId: batch.id, approve: true });
    expect(n.storyCards[0].content).toBe(a.storyCards[0].content);
    expect(n.activeState.canonBatches?.[0].status).toBe('stale');
  });
  it('still rolls back an already-applied batch and keeps the lock value', () => {
    const a = base();
    const applied = apply(a, { edits: [edit()] });
    const lockedState = adventureReducer(applied, { type: 'UPDATE_STORY_CARD', storyCardId: 'star', patch: { lockFromStoryDirector: true } });
    const restored = adventureReducer(lockedState, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' }).storyCards[0];
    expect(restored.content).toBe(a.storyCards[0].content);
    expect(restored.lockFromStoryDirector).toBe(true);
  });
  it('does not block inline memory or Memory Inbox updates', () => {
    const a = locked();
    const inline = applyAIMemoryUpdate(a, [{ type: 'storyCardUpdate', storyCardId: 'star', content: 'Inline memory update.' }]).actions.reduce(adventureReducer, a);
    expect(inline.storyCards[0].content).toContain('Inline memory update.');
    const proposal = { id: 'arc-proposal', sourceTurnId: 'accepted', sourceText: event, proposedType: 'currentArcUpdate' as const, title: 'Current Arc', content: 'Track Star confessed.', suggestedTriggers: [], confidence: 0.9, rationale: 'Arc development.', status: 'pending' as const, targetId: 'arc', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const queued = adventureReducer(a, { type: 'ADD_MEMORY_PROPOSAL', proposal });
    const approved = adventureReducer(queued, { type: 'APPROVE_MEMORY_PROPOSAL', proposalId: 'arc-proposal' });
    expect(approved.components.find(c => c.id === 'arc')?.content).not.toBe(a.components.find(c => c.id === 'arc')?.content);
  });
  it('rolls back when only updatedAt differs, but not when another owner field differs', () => {
    const a = base();
    const applied = apply(a, { edits: [edit()] });
    const bumped = { ...applied, storyCards: applied.storyCards.map(c => ({ ...c, lockFromStoryDirector: true, updatedAt: '2099-01-01T00:00:00.000Z' })) };
    const restored = adventureReducer(bumped, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' }).storyCards[0];
    expect(restored.content).toBe(a.storyCards[0].content);
    expect(restored.lockFromStoryDirector).toBe(true);
    const edited = { ...applied, storyCards: applied.storyCards.map(c => ({ ...c, priority: c.priority + 1, updatedAt: '2099-01-01T00:00:00.000Z' })) };
    expect(adventureReducer(edited, { type: 'REMOVE_LAST_ASSISTANT_MESSAGE' }).storyCards[0].content).toContain('betrayed');
  });
  it('keeps the lock through the component and Story Card factories', () => {
    expect(makeComponent({ title: 'Plot Essentials', type: 'plotEssentials', content: 'Truth.', lockFromStoryDirector: true }).lockFromStoryDirector).toBe(true);
    expect(makeStoryCard({ title: 'Mara', type: 'character', content: 'Mara.', lockFromStoryDirector: true }).lockFromStoryDirector).toBe(true);
  });
  it('preserves the lock through component JSON import', () => {
    const result = parseComponentsJson(JSON.stringify([{ type: 'plotEssentials', title: 'Plot Essentials', content: 'Truth.', lockFromStoryDirector: true }]));
    expect(result.components[0].component.lockFromStoryDirector).toBe(true);
  });
});
describe('Story Director auto-approval', () => {
  it.each([
    [false, false, false, 'pending'],
    [false, true, false, 'pending'],
    [true, false, false, 'pending'],
    [true, true, false, 'applied'],
    [true, true, true, 'pending'],
  ] as const)('director=%s cards=%s requireReview=%s produces %s', (storyDirector, storyCard, requireReview, status) => {
    const a = base();
    a.memoryAutoApprove = { ...a.memoryAutoApprove, storyDirector, storyCard };
    a.semanticEvaluationSettings.requireApprovalForAutoUpdates = requireReview;
    const batch = parseCanonBatch(a, { edits: [edit()] });
    const n = applyAIMemoryUpdate(a, [{ type: 'canonReconciliation', batch }]).actions.reduce(adventureReducer, a);
    expect(n.activeState.canonBatches?.[0].status).toBe(status);
    expect(n.storyCards[0].content).toBe(status === 'applied' ? edit().content : a.storyCards[0].content);
    if (status === 'pending') {
      const approved = adventureReducer(n, { type: 'REVIEW_CANON_BATCH', batchId: batch.id, approve: true });
      expect(approved.activeState.canonBatches?.[0].status).toBe('applied');
    }
  });
  it('requires every affected type to allow auto-approval and preserves item locks', () => {
    const a = base();
    a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
    a.memoryAutoApprove = { ...a.memoryAutoApprove, storyDirector: true, storyCard: true, currentArcUpdate: false };
    const batch = parseCanonBatch(a, { edits: [edit(), edit('component', 'arc', 'The traitor is exposed.')] });
    const run = (input: Adventure) => applyAIMemoryUpdate(input, [{ type: 'canonReconciliation', batch }]).actions.reduce(adventureReducer, input);
    expect(run(a).activeState.canonBatches?.[0].status).toBe('pending');
    a.memoryAutoApprove.currentArcUpdate = true;
    expect(run(a).activeState.canonBatches?.[0].status).toBe('applied');
    a.storyCards[0].lockFromStoryDirector = true;
    expect(run(a).storyCards[0].content).toBe(a.storyCards[0].content);
    expect(run(a).activeState.canonBatches ?? []).toHaveLength(0);
  });
  it('defaults old and new adventures to explicit Story Director approval', () => {
    expect(base().memoryAutoApprove.storyDirector).toBe(false);
    const old = base();
    delete (old.memoryAutoApprove as Partial<typeof old.memoryAutoApprove>).storyDirector;
    expect(normalizeAdventure(old).memoryAutoApprove.storyDirector).toBe(false);
  });
});
describe('post-generation integration', () => {
  it('retains evaluation history beyond the capped diagnostic log and replaces a repeated source verdict', () => {
    let a = base();
    const evaluation = { sourceMessageId: 'accepted', sourceContentFingerprint: storyDirectorSourceFingerprint(event), turn: 1, createdAt: '2026-01-01T00:00:00.000Z',
      changes: [], playLoopSuspended: false, reconciliation: { status: 'notRequested' as const }, errors: [], usage: { promptTokens: 0, completionTokens: 0 } };
    for (let turn = 0; turn < 120; turn++) {
      a = adventureReducer(a, { type: 'RECORD_STORY_DIRECTOR_EVALUATION', evaluation: { ...evaluation, sourceMessageId: `turn-${turn}`, turn } });
    }
    a = adventureReducer(a, { type: 'RECORD_STORY_DIRECTOR_EVALUATION', evaluation: { ...evaluation, sourceMessageId: 'turn-30', turn: 999 } });
    expect(a.activeState.storyDirectorEvaluations).toHaveLength(120);
    expect(a.activeState.storyDirectorEvaluations?.find(e => e.sourceMessageId === 'turn-30')?.turn).toBe(999);
    expect(a.activeState.storyDirectorEvaluations?.[0].sourceMessageId).toBe('turn-0');
  });
  it('evaluates accepted output, reconciles only meaningful developments, and accounts usage', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: JSON.stringify({ ...verdict('CLOSURE'), changes: [{ change: 'CANON_COMMIT', evidence: event, reason: 'Established betrayal' }] }), raw: {}, usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } }).mockResolvedValueOnce({ content: JSON.stringify({ edits: [edit()] }), raw: {} });
    const actions = await evaluateStoryDirector(a, a.modelConfig);
    const n = actions.reduce(adventureReducer, a);
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    expect(n.activeState.backgroundTokenUsage.promptTokens).toBe(10);
    expect(n.activeState.canonBatches?.[0].status).toBe('pending');
    const recorded = n.activeState.storyDirectorEvaluations?.[0];
    expect(recorded).toMatchObject({ sourceMessageId: 'accepted', turn: a.activeState.turn, playLoopSuspended: true,
      changes: [{ change: 'CANON_COMMIT', evidence: event }], reconciliation: { status: 'batch', batchId: n.activeState.canonBatches?.[0].id, editCount: 1 },
      usage: { promptTokens: 10, completionTokens: 20 } });
    expect(recorded?.verdict?.threads[0].mode).toBe('CLOSURE');
    expect(JSON.stringify(recorded)).not.toContain('Track Star is loyal.');
    const restored = importAdventureJson(exportAdventureJson(n));
    expect(restored.activeState.storyDirectorEvaluations).toEqual(n.activeState.storyDirectorEvaluations);
    const edited = adventureReducer(n, { type: 'UPDATE_MESSAGE', messageId: 'accepted', content: 'The betrayal did not happen.' });
    expect(storyDirectorSourceFingerprint(edited.messages.find(m => m.id === 'accepted')!.content)).not.toBe(recorded?.sourceContentFingerprint);
    expect(edited.activeState.storyDirectorEvaluations?.[0].sourceContentFingerprint).toBe(recorded?.sourceContentFingerprint);
  });
  it('does not reconcile routine scenes and fails open without losing accepted prose', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockRejectedValue(new Error('offline'));
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(n.messages).toEqual(a.messages);
    expect(playLoopSuspended(n)).toBe(false);
    expect(n.activeState.evaluationLog[0].errors).toContain('offline');
    expect(n.activeState.storyDirectorEvaluations?.[0]).toMatchObject({ sourceMessageId: 'accepted', reconciliation: { status: 'notRequested' }, errors: ['offline'] });
  });
  it('keeps a grounded progression verdict when reconciliation fails', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: JSON.stringify({ ...verdict('CLOSURE'), changes: [{ change: 'CANON_COMMIT', evidence: event, reason: 'Established betrayal' }] }), raw: {} })
      .mockRejectedValueOnce(new Error('reconciliation offline'));
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(playLoopSuspended(n)).toBe(true);
    expect(n.activeState.storyDirectorEvaluations?.[0]).toMatchObject({ verdict: { threads: [{ mode: 'CLOSURE' }] },
      reconciliation: { status: 'failed' }, playLoopSuspended: true, errors: ['reconciliation offline'] });
  });
  it('preserves rejected evidence and repairs once with exact source grounding', async () => {
    const a = base();
    const invalid = JSON.stringify({ ...verdict('CLOSURE'), threads: [{ ...verdict('CLOSURE').threads[0], sourceMessageId: 'wrong-id' }] });
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: invalid, raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify(verdict('CLOSURE')), raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ edits: [] }), raw: {} });
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(playLoopSuspended(n)).toBe(true);
    expect(n.activeState.storyDirectorEvaluations?.[0].rejectedResponses).toEqual([
      expect.objectContaining({ stage: 'evaluation', attempt: 1, response: invalid, error: expect.stringContaining('wrong-id') }),
    ]);
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[1][0].messages[1].content).toContain('validationError');
    expect(importAdventureJson(exportAdventureJson(n)).activeState.storyDirectorEvaluations).toEqual(n.activeState.storyDirectorEvaluations);
  });
  it('retains malformed JSON and unsupported quotes after bounded repair fails', async () => {
    const a = base();
    const invalid = JSON.stringify({ ...verdict('CLOSURE'), threads: [{ ...verdict('CLOSURE').threads[0], evidence: 'invented' }] });
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: 'not JSON', raw: {} })
      .mockResolvedValueOnce({ content: invalid, raw: {} });
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(playLoopSuspended(n)).toBe(false);
    expect(n.messages).toEqual(a.messages);
    expect(n.activeState.storyDirectorEvaluations?.[0].rejectedResponses?.map(r => r.response)).toEqual(['not JSON', invalid]);
    expect(n.activeState.storyDirectorEvaluations?.[0].verdict).toBeUndefined();
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
  });
  it('keeps validated closure and preserves rejected canon responses without partial writes', async () => {
    const a = base();
    const invalid = JSON.stringify({ edits: [edit(), { ...edit('component', 'arc'), evidence: 'invented' }] });
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: JSON.stringify(verdict('CLOSURE')), raw: {} })
      .mockResolvedValue({ content: invalid, raw: {} });
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(playLoopSuspended(n)).toBe(true);
    expect(n.storyCards).toEqual(a.storyCards);
    expect(n.activeState.canonBatches ?? []).toHaveLength(0);
    expect(n.activeState.storyDirectorEvaluations?.[0].reconciliation.status).toBe('failed');
    expect(n.activeState.storyDirectorEvaluations?.[0].rejectedResponses).toHaveLength(2);
    expect(n.activeState.storyDirectorEvaluations?.[0].rejectedResponses?.[0]).toMatchObject({ stage: 'reconciliation', response: invalid });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(3);
  });
  it('does not silently discard unsupported detected changes', () => {
    expect(() => parseStoryState(base(), { ...verdict(), changes: [{ change: 'CANON_COMMIT', evidence: 'invented', reason: 'Claim' }] })).toThrow('Story change 1');
  });
  it('records a reconciliation request that found no edits', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: JSON.stringify({ ...verdict(), changes: [{ change: 'STATE_UPDATE', evidence: event, reason: 'Check owners' }] }), raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ edits: [] }), raw: {} });
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(n.activeState.storyDirectorEvaluations?.[0].reconciliation).toEqual({ status: 'empty', editCount: 0 });
    expect(n.activeState.canonBatches ?? []).toHaveLength(0);
  });
  it('runs after the narrative response and never on comms', async () => {
    const a = base(); a.memoryDetectionSettings.enabled = false;
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: JSON.stringify(verdict()), raw: {} });
    const story = vi.fn(async () => { expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled(); return { content: 'Mara orders lunch.' }; });
    const accepted = vi.fn(() => { expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled(); });
    const n = await runTurnPipeline({ adventure: a, text: 'Lunch', providerConfig: a.modelConfig, sendChatCompletion: story, onStoryAccepted: accepted });
    expect(accepted).toHaveBeenCalledOnce();
    expect(n.adventure.messages.at(-1)?.content).toBe('Mara orders lunch.');
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(n.adventure.activeState.storyDirectorEvaluations?.[0]).toMatchObject({ sourceMessageId: n.adventure.messages.at(-1)?.id,
      verdict: { reason: 'Judge only what happened.', threads: [] }, changes: [], reconciliation: { status: 'notRequested' }, playLoopSuspended: false });
    vi.clearAllMocks();
    await runTurnPipeline({ adventure: a, text: 'OOC', mode: 'comms', providerConfig: a.modelConfig, sendChatCompletion: story });
    expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
  });
  it('explicitly prohibits forced escalation, nested mysteries and duplicate relationship ownership', () => {
    expect(STORY_STATE_PROMPT).toContain('thousands of entries');
    expect(STORY_STATE_PROMPT).toContain('dormant conspiracy');
    expect(RECONCILE_PROMPT).toContain('ONLY in that directional relationship');
    expect(RECONCILE_PROMPT).toContain('deeper masterminds');
  });
});
// Real local histories remain user data: read in place, never copy into public fixtures.
const saves = resolve(process.env.STORY_DIRECTOR_SAVE_DIR ?? '../AI-Stoyer-Teller-Saves/sync/saves');
describe.skipIf(!existsSync(saves))('real long-form saved histories (structural replay, no live model claims)', () => {
  it('keeps hundreds of ordinary/dormant verdicts in normal play without a turn-count heuristic', () => {
    let checked = 0; let messages = 0;
    for (const dir of readdirSync(saves, { withFileTypes: true }).filter(d => d.isDirectory())) {
      const files = readdirSync(resolve(saves, dir.name)).filter(f => f.endsWith('.json')).sort();
      const raw = JSON.parse(readFileSync(resolve(saves, dir.name, files.at(-1)!), 'utf8')).adventure as Adventure | undefined;
      if (!raw || raw.messages.length < 500) continue;
      const a = normalizeAdventure(raw);
      const loop = createDefaultAdventure().components.find(isPlayLoop)!;
      if (!a.components.some(isPlayLoop)) a.components.push(loop);
      for (let i = 0; i < raw.messages.length; i += 8) {
        if (raw.messages[i].role !== 'assistant') continue;
        a.messages = raw.messages.slice(0, i + 1); a.activeState.turn = i;
        const n = adventureReducer(a, { type: 'SET_STORY_DIRECTOR', state: parseStoryState(a, verdict()).state });
        expect(playLoopSuspended(n)).toBe(false);
        expect(recentDirectorMessages(n).length).toBeLessThanOrEqual(40);
        checked++;
      }
      messages += raw.messages.length;
    }
    expect(messages).toBeGreaterThan(5000);
    expect(checked).toBeGreaterThan(300);
  });
});

describe('evidence references and partial evaluator recovery', () => {
  it('resolves supplied evidence IDs to exact text and the correct source without model transcription', () => {
    const a = base();
    const ref = directorEvidence(a)[0];
    const parsed = parseStoryState(a, { reason: 'An investigation is underway.', threads: [{ id: 'case', mode: 'CLOSURE', confidence: 0.95, loopObstructs: true, reason: 'An answer exists.', evidenceId: ref.id }], changes: [{ change: 'STATE_UPDATE', reason: 'An admission.', evidenceId: ref.id }] });
    expect(parsed.state.threads[0]).toMatchObject({ evidence: event, sourceMessageId: 'accepted' });
    const batch = parseCanonBatch(a, { edits: [{ ...edit(), evidence: undefined, evidenceId: ref.id }] });
    expect(batch.edits[0].evidence).toBe(event);
    expect(adventureReducer(a, { type: 'RECONCILE_CANON', batch, review: true }).activeState.canonBatches?.[0].status).toBe('pending');
  });
  it('rejects invented IDs, user evidence, and older evidence for latest changes or canon writes', () => {
    let a = base();
    a = adventureReducer(a, { type: 'ADD_MESSAGE', role: 'user', id: 'user', content: 'An unsupported allegation.' });
    a = adventureReducer(a, { type: 'ADD_MESSAGE', role: 'assistant', id: 'new', content: 'Mara sits down.' });
    const refs = directorEvidence(a);
    expect(refs.some(e => e.sourceMessageId === 'user')).toBe(false);
    for (const evidenceId of ['E9999', refs.find(e => e.sourceMessageId === 'accepted')!.id]) {
      expect(() => parseCanonBatch(a, { edits: [{ ...edit(), evidenceId }] })).toThrow();
      expect(() => parseStoryState(a, { ...verdict(), changes: [{ change: 'STATE_UPDATE', reason: 'Old claim', evidenceId }] })).toThrow();
    }
  });
  it('preserves valid progression when another thread or change fails both repair attempts', async () => {
    const a = base();
    const invalid = { ...verdict('CLOSURE'), changes: [{ change: 'CANON_COMMIT', reason: 'Older claim', evidence: 'old text' }] };
    invalid.threads.push({ ...invalid.threads[0], id: 'bad', evidence: 'stitched ... quotation' });
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: JSON.stringify(invalid), raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify(invalid), raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ edits: [] }), raw: {} });
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(playLoopSuspended(n)).toBe(true);
    expect(n.activeState.storyDirector?.threads).toHaveLength(1);
    expect(n.activeState.storyDirectorEvaluations?.[0].changes).toEqual([]);
    expect(n.activeState.storyDirectorEvaluations?.[0].rejectedResponses).toHaveLength(2);
    expect(n.activeState.storyDirectorEvaluations?.[0].evidenceSources?.[0].quote).toBe(event);
    expect(n.activeState.storyDirectorEvaluations?.[0].errors.join(' ')).toContain('excluded');
    expect(n.storyCards).toEqual(a.storyCards);
  });
  it('keeps validated items if the repair request fails in transport', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion)
      .mockResolvedValueOnce({ content: JSON.stringify({ ...verdict('CLOSURE'), changes: [{ change: 'STATE_UPDATE', reason: 'Invalid', evidence: 'missing' }] }), raw: {} })
      .mockRejectedValueOnce(new Error('repair offline'))
      .mockResolvedValueOnce({ content: JSON.stringify({ edits: [] }), raw: {} });
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(playLoopSuspended(n)).toBe(true);
    expect(n.activeState.storyDirectorEvaluations?.[0].errors).toContain('repair offline');
  });
});
describe('manual Story Director modes', () => {
  it.each(['NORMAL_PLAY', 'ACTIVE_PROGRESSION', 'CLOSURE', 'RESOLVED'] as const)('persists %s through save import, turns, and evaluator failures without bypassing canon review', async mode => {
    const a = adventureReducer(base(), { type: 'SET_STORY_DIRECTOR_MODE', mode });
    const loaded = importAdventureJson(exportAdventureJson(a));
    expect(loaded.activeState.storyDirectorMode).toBe(mode);
    const next = adventureReducer(loaded, { type: 'ADD_MESSAGE', role: 'assistant', id: 'next', content: 'A new scene.' });
    vi.mocked(sendOpenAICompatibleChatCompletion).mockRejectedValue(new Error('offline'));
    const n = (await evaluateStoryDirector(next, next.modelConfig)).reduce(adventureReducer, next);
    expect(playLoopSuspended(n)).toBe(mode !== 'NORMAL_PLAY');
    expect(n.activeState.storyDirectorEvaluations?.at(-1)).toMatchObject({ modeOverride: mode, playLoopSuspended: mode !== 'NORMAL_PLAY' });
    const context = buildContext(n);
    const direction = context.sections.flatMap(s => s.items).find(i => i.id === 'story-progression');
    expect(Boolean(direction)).toBe(mode !== 'NORMAL_PLAY');
    if (direction) expect(direction.generatedBy).toBe('user');
    expect(n.storyCards).toEqual(loaded.storyCards);
    expect(n.memoryAutoApprove.storyDirector).toBe(false);
    expect(playLoopSuspended(adventureReducer(n, { type: 'SET_STORY_DIRECTOR_MODE', mode: 'AUTO' }))).toBe(false);
    expect(adventureReducer(n, { type: 'RESET_RUNTIME_STATE' }).activeState.storyDirectorMode).toBe('AUTO');
  });
  it('overrides a valid automatic verdict immediately and restores it on Auto', () => {
    let a = adventureReducer(base(), { type: 'SET_STORY_DIRECTOR', state: parseStoryState(base(), verdict('CLOSURE')).state });
    a = adventureReducer(a, { type: 'SET_STORY_DIRECTOR_MODE', mode: 'NORMAL_PLAY' });
    expect(playLoopSuspended(a)).toBe(false);
    a = adventureReducer(a, { type: 'SET_STORY_DIRECTOR_MODE', mode: 'AUTO' });
    expect(playLoopSuspended(a)).toBe(true);
  });
  it('normalizes old or invalid modes to Auto', () => {
    const a = base();
    delete a.activeState.storyDirectorMode;
    expect(normalizeAdventure(a).activeState.storyDirectorMode).toBe('AUTO');
    expect(normalizeAdventure({ ...a, activeState: { ...a.activeState, storyDirectorMode: 'invalid' } } as unknown as Adventure).activeState.storyDirectorMode).toBe('AUTO');
  });
});

// Opt-in regression replay: private exports are read in place and never copied to fixtures.
const rejectionSave = process.env.STORY_DIRECTOR_REJECTION_SAVE;
describe.skipIf(!rejectionSave || !existsSync(rejectionSave))('local rejected-response replay', () => {
  it('retains grounded items from captured failures and resolves new references against actual accepted text', async () => {
    const a = normalizeAdventure(JSON.parse(readFileSync(rejectionSave!, 'utf8')) as Adventure);
    let grounded = 0;
    for (const e of a.activeState.storyDirectorEvaluations ?? []) {
      if (!e.rejectedResponses?.length) continue;
      const index = a.messages.findIndex(m => m.id === e.sourceMessageId);
      if (index < 0) continue;
      const atTurn = { ...a, messages: a.messages.slice(0, index + 1) };
      const refs = directorEvidence(atTurn);
      expect(refs.every(ref => atTurn.messages.some(m => m.role === 'assistant' && m.id === ref.sourceMessageId && m.content.includes(ref.quote)))).toBe(true);
      const response = e.rejectedResponses.at(-1)!.response;
      vi.mocked(sendOpenAICompatibleChatCompletion).mockReset()
        .mockResolvedValueOnce({ content: response, raw: {} })
        .mockResolvedValueOnce({ content: response, raw: {} })
        .mockResolvedValue({ content: JSON.stringify({ edits: [] }), raw: {} });
      const n = (await evaluateStoryDirector(atTurn, atTurn.modelConfig)).reduce(adventureReducer, atTurn);
      if (n.activeState.storyDirectorEvaluations?.at(-1)?.verdict?.threads.length) grounded++;
      expect(n.messages).toEqual(atTurn.messages);
      expect(n.storyCards).toEqual(atTurn.storyCards);
      const latestRef = refs.find(ref => ref.latest)!;
      const parsed = parseStoryState(atTurn, { reason: 'Reference transport check', threads: [{ id: 'transport-only', mode: 'ACTIVE_PROGRESSION', confidence: 0.95, loopObstructs: true, evidenceId: latestRef.id, reason: 'Transport check only, not a live semantic judgment.' }], changes: [] });
      expect(parsed.state.threads[0].evidence).toBe(latestRef.quote);
    }
    expect(grounded).toBeGreaterThan(0);
  });
});

it('resolves relationship knowledge references without bypassing mandatory review', () => {
  const a = base();
  a.brains = [makeBrain({ id: 'mara', characterName: 'Mara', relationships: [{ id: 'pair', focus: 'Track Star', focusStoryCardId: 'star', current: { bond: 'teammate', status: 'active', dimensions: { trust: 'trusts him' } }, revision: 0, history: [], recalledHistoryIds: [] }] })];
  const ref = directorEvidence(a)[0];
  const batch = parseCanonBatch(a, { edits: [{ kind: 'relationship', id: 'mara', relationshipId: 'pair', relationship: { bond: 'teammate', status: 'active', dimensions: { trust: 'distrusts him after hearing his confession' } }, evidenceId: ref.id, knowledgeEvidenceId: ref.id, reason: 'She heard the confession.', change: 'STATE_UPDATE', removedFacts: [] }] });
  const n = applyAIMemoryUpdate(a, [{ type: 'canonReconciliation', batch }]).actions.reduce(adventureReducer, a);
  expect(n.activeState.canonBatches?.[0].status).toBe('pending');
  expect(n.brains).toEqual(a.brains);
  expect(batch.edits[0].reason).toContain(event);
});
