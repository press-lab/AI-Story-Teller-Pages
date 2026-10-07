import type { Adventure, AdventureAction } from '../types/adventure';
import { currentDirector, directorEnabled, playLoopSuspended, storyDirectorSourceFingerprint } from '../memory/storyDirectorState';

/** Administrative inspection only; never rendered in the player story stream. */
export function StoryDirectorPanel({ adventure, dispatch }: { adventure: Adventure; dispatch: (a: AdventureAction) => void }) {
  const state = currentDirector(adventure);
  const batches = adventure.activeState.canonBatches ?? [];
  const evaluations = adventure.activeState.storyDirectorEvaluations ?? [];
  return <details className="editor-card">
    <summary>Story Director · {batches.filter(b => b.status === 'pending').length} pending · Play Loop {playLoopSuspended(adventure) ? 'suspended' : 'active'}</summary>
    <p>{directorEnabled(adventure) ? 'Evaluates accepted story events after generation. No planned beats or ending.' : 'Designate a custom component as the Play Loop to enable story-state evaluation.'}</p>
    <p>{state?.reason ?? 'Normal sandbox play.'}</p>
    {state?.threads.map(t => <p key={t.id}><strong>{t.mode} · {t.id}</strong><br />{t.reason}<br /><q>{t.evidence}</q></p>)}
    <p>Replacements wait for approval unless Story Director auto-approval and every affected memory type allow automatic changes. Require approval for auto-updates overrides these toggles. Relationship changes always require review. Detailed decisions and failures are in Triggers → evaluation logs.</p>
    <details>
      <summary>Evaluation history · {evaluations.length} responses</summary>
      <p>The complete history is saved in adventure JSON under activeState.storyDirectorEvaluations. Each entry links to a message in the play transcript.</p>
      {[...evaluations].reverse().slice(0, 20).map(e => {
        const batch = batches.find(b => b.id === e.reconciliation.batchId);
        const source = adventure.messages.find(m => m.id === e.sourceMessageId);
        return <details key={e.sourceMessageId}>
          <summary>Turn {e.turn} · {e.verdict?.threads.map(t => t.mode).join(', ') || 'NORMAL_PLAY'} · {e.errors.length ? 'error' : e.reconciliation.status}</summary>
          <p>Story message: {e.sourceMessageId}{!source ? ' (removed from play)' : storyDirectorSourceFingerprint(source.content) !== e.sourceContentFingerprint ? ' (edited since evaluation)' : ''}</p>
          <p>{e.verdict?.reason ?? 'No valid verdict.'} Play Loop {e.playLoopSuspended ? 'suspended' : 'active'}.</p>
          {e.verdict?.threads.map(t => <p key={t.id}>{t.mode} · {t.id} · confidence {t.confidence}: {t.reason}<br /><q>{t.evidence}</q></p>)}
          {e.changes.map((change, i) => <p key={i}>{change.change}: {change.reason}<br /><q>{change.evidence}</q></p>)}
          <p>Reconciliation: {e.reconciliation.status}{e.reconciliation.editCount !== undefined ? ` · ${e.reconciliation.editCount} edits` : ''}{batch ? ` · ${batch.status}` : ''}</p>
          {e.errors.map((error, i) => <p key={i}>Error: {error}</p>)}
        </details>;
      })}
    </details>
    {batches.map(b => <details key={b.id}>
      <summary>Canon reconciliation · {b.status} · {b.edits.length} owners</summary>
      {b.edits.map(e => <div key={`${e.kind}:${e.id}:${e.relationshipId ?? ''}`}>
        <strong>{e.change} · {e.kind} · {e.id}</strong><p>{e.reason}</p><blockquote>{e.evidence}</blockquote>
        <p>Obsolete assertions: {e.removedFacts.join('; ') || 'None'}</p>
        <details><summary>Previous owner</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{e.before}</pre></details>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{e.content ?? JSON.stringify(e.thoughts ?? e.relationship, null, 2)}</pre>
      </div>)}
      {b.status === 'pending' && <div className="row">
        <button onClick={() => dispatch({ type: 'REVIEW_CANON_BATCH', batchId: b.id, approve: true })}>Apply all replacements</button>
        <button onClick={() => dispatch({ type: 'REVIEW_CANON_BATCH', batchId: b.id, approve: false })}>Reject batch</button>
      </div>}
    </details>)}
  </details>;
}
