import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, normalizeAdventure } from '../state/defaults';
import { adventureReducer } from '../state/adventureReducer';
import { buildContext } from '../contextBuilder/contextBuilder';
import { applyAIMemoryUpdate } from './applyAIMemoryUpdate';
import { currentDirector, isPlayLoop, playLoopSuspended, ownerSnapshot } from './storyDirectorState';
import { evaluateStoryDirector, parseCanonBatch, parseStoryState, recentDirectorMessages, RECONCILE_PROMPT, STORY_STATE_PROMPT } from './storyDirector';
import { sendOpenAICompatibleChatCompletion } from '../providers/openAICompatible';
import { runTurnPipeline } from '../state/turnPipeline';
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
describe('post-generation integration', () => {
  it('evaluates accepted output, reconciles only meaningful developments, and accounts usage', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: JSON.stringify({ ...verdict('CLOSURE'), changes: [{ change: 'CANON_COMMIT', evidence: event, reason: 'Established betrayal' }] }), raw: {}, usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } }).mockResolvedValueOnce({ content: JSON.stringify({ edits: [edit()] }), raw: {} });
    const actions = await evaluateStoryDirector(a, a.modelConfig);
    const n = actions.reduce(adventureReducer, a);
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    expect(n.activeState.backgroundTokenUsage.promptTokens).toBe(10);
    expect(n.activeState.canonBatches?.[0].status).toBe('pending');
  });
  it('does not reconcile routine scenes and fails open without losing accepted prose', async () => {
    const a = base();
    vi.mocked(sendOpenAICompatibleChatCompletion).mockRejectedValue(new Error('offline'));
    const n = (await evaluateStoryDirector(a, a.modelConfig)).reduce(adventureReducer, a);
    expect(n.messages).toEqual(a.messages);
    expect(playLoopSuspended(n)).toBe(false);
    expect(n.activeState.evaluationLog[0].errors).toContain('offline');
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
