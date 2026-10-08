import { useState } from 'react';
import type { Adventure, AdventureAction } from '../types/adventure';
import { currentDirector, directorEnabled, playLoopSuspended, storyDirectorSourceFingerprint, STORY_MODE_LABELS, type CanonEdit, type StoryDirectorEvaluation } from '../memory/storyDirectorState';
import { StoryDirectorModeControl } from './StoryDirectorModeControl';

type Props = { adventure: Adventure; dispatch: (a: AdventureAction) => void };
function ownerTitle(a: Adventure, e: CanonEdit) {
  if (e.kind === 'component') return a.components.find(c => c.id === e.id)?.title ?? e.id;
  if (e.kind === 'storyCard') return a.storyCards.find(c => c.id === e.id)?.title ?? e.id;
  const brain = a.brains.find(b => b.id === e.id);
  return e.kind === 'relationship' ? `${brain?.characterName ?? e.id} toward ${brain?.relationships.find(r => r.id === e.relationshipId)?.focus ?? e.relationshipId}` : brain?.characterName ?? e.id;
}
function previousContent(e: CanonEdit) {
  try {
    const previous = JSON.parse(e.before);
    return previous.content ?? JSON.stringify(previous.thoughts ?? previous.current ?? previous, null, 2);
  } catch { return e.before; }
}
function Evaluation({ evaluation: e, adventure }: { evaluation: StoryDirectorEvaluation; adventure: Adventure }) {
  const source = adventure.messages.find(m => m.id === e.sourceMessageId);
  const modes = [...new Set(e.verdict?.threads.map(t => STORY_MODE_LABELS[t.mode]))];
  return <details className="director-entry">
    <summary>Turn {e.turn} - {e.verdict ? modes.join(', ') || 'Normal play' : 'NO VALID VERDICT'} - {e.errors.length ? 'needs attention' : e.rejectedResponses?.length ? 'repaired' : e.reconciliation.status}</summary>
    <p>{e.verdict?.reason ?? 'No valid verdict.'} Play Loop {e.playLoopSuspended ? 'suspended' : 'active'}{e.modeOverride && e.modeOverride !== 'AUTO' ? ` (manual: ${STORY_MODE_LABELS[e.modeOverride]})` : ''}.</p>
    {e.verdict?.threads.map(t => <details key={t.id}><summary>{STORY_MODE_LABELS[t.mode]} - {t.id}</summary><p>{t.reason}</p><p>Confidence: {t.confidence}. Sandbox loop obstructs: {t.loopObstructs ? 'yes' : 'no'}.</p><blockquote>{t.evidence}</blockquote></details>)}
    {e.changes.map((c, i) => <p key={i}>{c.reason}</p>)}
    <p>Memory reconciliation: {e.reconciliation.status}{e.reconciliation.editCount !== undefined ? ` - ${e.reconciliation.editCount} changes` : ''}.</p>
    <details><summary>Diagnostics{e.errors.length ? ` - ${e.errors.length} issues` : ''}</summary>
      <p>Story message: {e.sourceMessageId}{!source ? ' (removed)' : storyDirectorSourceFingerprint(source.content) !== e.sourceContentFingerprint ? ' (edited since evaluation)' : ''}</p>
      {e.errors.map((error, i) => <p key={i}>{error}</p>)}
      {e.rejectedResponses?.map((r, i) => <details key={i}><summary>Rejected {r.stage} response - attempt {r.attempt}</summary><p>{r.error}</p><pre>{r.response}</pre></details>)}
      {!!e.evidenceSources?.length && <details><summary>Evidence references supplied</summary>{e.evidenceSources.map(ref => <div key={ref.id}><strong>{ref.id} - {ref.sourceMessageId}</strong><blockquote>{ref.quote}</blockquote></div>)}</details>}
    </details>
  </details>;
}
/** Administrative inspection only; never appended to story prose. */
export function StoryDirectorPanel({ adventure, dispatch }: Props) {
  const [view, setView] = useState<'pending' | 'evaluations' | 'completed'>('pending');
  const [limit, setLimit] = useState(5);
  const state = currentDirector(adventure);
  const batches = adventure.activeState.canonBatches ?? [];
  const pending = batches.filter(b => b.status === 'pending');
  const evaluations = [...(adventure.activeState.storyDirectorEvaluations ?? [])].reverse();
  const visibleBatches = (view === 'pending' ? pending : [...batches].reverse().filter(b => b.status !== 'pending'));
  const latest = evaluations[0];
  return <section className="panel director-panel" aria-label="Story Director">
    <div className="director-heading"><h3>Story Director</h3><span className="muted">Play Loop {playLoopSuspended(adventure) ? 'suspended' : 'active'} / {pending.length} pending</span></div>
    <StoryDirectorModeControl adventure={adventure} dispatch={dispatch} />
    {!directorEnabled(adventure) && <p className="muted">Designate an active Play Loop or choose a manual mode to enable evaluation.</p>}
    {!!latest?.errors.length && <p className="director-notice">Latest evaluation needs attention. <button type="button" onClick={() => { setView('evaluations'); setLimit(5); }}>Review evaluation</button></p>}
    <details><summary>Current assessment</summary><p>{state?.reason ?? 'No current automatic assessment.'}</p></details>
    <div className="editor-tabs" role="group" aria-label="Story Director views">
      {([['pending', `Pending changes (${pending.length})`], ['evaluations', 'Evaluation history'], ['completed', 'Completed changes']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => { setView(key); setLimit(5); }}>{label}</button>)}
    </div>
    {view === 'evaluations' ? <>
      <p className="muted">Showing {Math.min(limit, evaluations.length)} of {evaluations.length}. Full history and rejected responses are retained in the save.</p>
      {evaluations.slice(0, limit).map((e, i) => <Evaluation key={`${e.sourceMessageId}:${i}`} evaluation={e} adventure={adventure} />)}
      {limit < evaluations.length && <button type="button" onClick={() => setLimit(limit + 5)}>Show more evaluations</button>}
    </> : <>
      {view === 'pending' && <p className="muted">Review each batch before applying. All changes in a batch are applied together.</p>}
      {!visibleBatches.length && <p className="muted">{view === 'pending' ? 'No pending Story Director changes.' : 'No completed changes.'}</p>}
      {visibleBatches.slice(0, limit).map(b => <article className="director-entry" key={b.id}>
        <strong>{b.edits.length} memory {b.edits.length === 1 ? 'change' : 'changes'} - {b.status}</strong>
        <p className="muted">{b.edits.map(e => ownerTitle(adventure, e)).join(', ')}</p>
        <details><summary>Review replacements</summary>
          {b.edits.map(e => <div className="director-owner" key={`${e.kind}:${e.id}:${e.relationshipId ?? ''}`}>
            <h4>{ownerTitle(adventure, e)}</h4><p>{e.reason}</p>
            <div className="director-comparison"><div><strong>Before</strong><pre>{previousContent(e)}</pre></div><div><strong>After</strong><pre>{e.content ?? JSON.stringify(e.thoughts ?? e.relationship, null, 2)}</pre></div></div>
            <details><summary>Evidence and removed facts</summary><blockquote>{e.evidence}</blockquote><p>{e.removedFacts.join('; ') || 'No assertions removed.'}</p></details>
          </div>)}
        </details>
        {b.status === 'pending' && <div className="row"><button type="button" onClick={() => dispatch({ type: 'REVIEW_CANON_BATCH', batchId: b.id, approve: true })}>Apply all replacements</button><button type="button" onClick={() => dispatch({ type: 'REVIEW_CANON_BATCH', batchId: b.id, approve: false })}>Reject batch</button></div>}
      </article>)}
      {limit < visibleBatches.length && <button type="button" onClick={() => setLimit(limit + 5)}>Show more changes</button>}
    </>}
  </section>;
}
