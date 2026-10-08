import { worldState } from "../memory/worldEvolution";
import type { AdventurePageProps } from "./pageTypes";

export function WorldEvolutionPanel({ adventure, dispatch }: AdventurePageProps) {
  const world = worldState(adventure);
  if (!adventure.worldEvolutionSettings?.enabled && !world.threads.length && !world.issues.length) return null;
  return <article className="panel">
    <h3>World Evolution record</h3>
    <p className="muted">Tracked plots, accepted canon changes, and responses whose world changes need review.</p>
    <details open={world.issues.some(i => i.status === "unrecorded")}>
      <summary>Unrecorded or recovered events ({world.issues.filter(i => i.status === "unrecorded").length} need review)</summary>
      {world.issues.slice(-10).reverse().map(issue => <article key={issue.id}>
        <p><strong>{issue.status}</strong> · {issue.sourceTurnId}: {issue.reason}</p>
        <details><summary>Accepted narration</summary><p>{adventure.messages.find(m => m.id === issue.sourceTurnId)?.content ?? "Source response was removed from the Chronicle."}</p></details>
        {issue.status === "unrecorded" && <button type="button" onClick={() => dispatch({ type: "SET_WORLD_ISSUE", issue: { ...issue, status: "dismissed" } })}>Mark reviewed</button>}
      </article>)}
    </details>
    <details open={world.threads.length > 0}><summary>Emerging plots ({world.threads.length})</summary>
      {world.threads.map(t => <article key={t.id}><h4>{t.title}</h4><p>{t.id} · {t.phase} · revision {t.revision}</p>
        <p>Objective: {t.objective}</p><p>Participants: {t.participants.map(id => adventure.storyCards.find(c => c.id === id)?.title ?? adventure.brains.find(b => b.id === id)?.characterName ?? id).join(", ")}</p>
        {t.outcome && <p>Outcome: {t.outcome}</p>}
        <details><summary>Evidence and history</summary><p>{t.originEvidence}</p>{t.events.map((e, i) => <p key={i}>{e.kind}: {e.outcome} · {e.sourceTurnId}<br />{e.evidence}</p>)}</details>
      </article>)}
    </details>
    <details><summary>Canon change history ({world.history.length})</summary>
      {[...world.history].reverse().map(h => <article key={h.id}><p>{h.change.owner} {h.change.targetId} · {h.change.operation} · {h.sourceTurnId}</p>
        <p>Evidence: {h.change.evidence}</p><pre>{h.change.previous || "(new fact)"} → {h.change.content || "(removed)"}</pre>
        <button type="button" disabled={h.rolledBack} onClick={() => dispatch({ type: "ROLLBACK_WORLD_CHANGE", historyId: h.id })}>{h.rolledBack ? "Reversed" : "Reverse this change"}</button>
        <p className="muted">Reversal requires this revision to still be current. Later edits are preserved.</p>
      </article>)}
    </details>
  </article>;
}
