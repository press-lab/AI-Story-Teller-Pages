import type { Adventure, AdventureAction } from '../types/adventure';
import { currentDirector, directorEnabled, playLoopSuspended } from '../memory/storyDirectorState';

/** Administrative inspection only; never rendered in the player story stream. */
export function StoryDirectorPanel({ adventure, dispatch }: { adventure: Adventure; dispatch: (a: AdventureAction) => void }) {
  const state = currentDirector(adventure);
  const batches = adventure.activeState.canonBatches ?? [];
  return <details className="editor-card">
    <summary>Story state · Play Loop {playLoopSuspended(adventure) ? 'suspended' : 'active'}</summary>
    <p>{directorEnabled(adventure) ? 'Evaluates accepted story events after generation. No planned beats or ending.' : 'Designate a custom component as the Play Loop to enable story-state evaluation.'}</p>
    <p>{state?.reason ?? 'Normal sandbox play.'}</p>
    {state?.threads.map(t => <p key={t.id}><strong>{t.mode} · {t.id}</strong><br />{t.reason}<br /><q>{t.evidence}</q></p>)}
    <p>Canon replacements respect memory approval settings. Relationship changes always require review. Detailed decisions and failures are in Triggers → evaluation logs.</p>
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
