import { useState } from "react";
import type { BrainEntry, DynamicRelationship, RelationshipState } from "../types/adventure";
import type { AdventurePageProps } from "./pageTypes";
import { relationshipConflicts, relationshipFocusCard, relationshipText, validRelationshipState } from "../memory/relationships";

function StateEditor({ initial, onSave }: { initial: RelationshipState; onSave: (s: RelationshipState) => void }) {
  const [bond, setBond] = useState(initial.bond);
  const [status, setStatus] = useState(initial.status);
  const [dimensions, setDimensions] = useState(Object.entries(initial.dimensions).map(([k,v]) => `${k}: ${v}`).join("\n"));
  const entries = dimensions.split("\n").filter(v => v.trim()).map(line => { const i = line.indexOf(":"); return i < 1 ? ["", ""] : [line.slice(0,i).trim(), line.slice(i+1).trim()]; });
  const state = { bond, status, dimensions: Object.fromEntries(entries) };
  return <div className="grid">
    <label>Bond <input maxLength={120} value={bond} onChange={e => setBond(e.target.value)} /></label>
    <label>Status <input maxLength={80} value={status} onChange={e => setStatus(e.target.value)} /></label>
    <label>Named dimensions (up to five, one name: description per line; no numeric meters)
      <textarea rows={4} value={dimensions} onChange={e => setDimensions(e.target.value)} /></label>
    <button type="button" disabled={!validRelationshipState(state) || entries.length !== Object.keys(state.dimensions).length} onClick={() => onSave(state)}>Save relationship</button>
  </div>;
}
function RelationshipEditor({ adventure, dispatch, brain, relationship: r }: AdventurePageProps & { brain: BrainEntry; relationship: DynamicRelationship }) {
  const focusCard = relationshipFocusCard(adventure, r);
  const focus = focusCard?.title ?? r.focus;
  const conflicts = relationshipConflicts(adventure, brain, focus);
  return <details className="card"><summary>{brain.characterName} → {focus}</summary>
    {focusCard ? <p>Linked character Story Card: {focusCard.title}</p> : <div>
      <p role="alert">Select an existing character Story Card to restore this relationship's focus link. History is preserved; context and proposals are paused.</p>
      <label>Link focus character <select value="" onChange={e => dispatch({ type: "LINK_RELATIONSHIP_FOCUS", brainId: brain.id, relationshipId: r.id, focusStoryCardId: e.target.value })}>
        <option value="">Select a character Story Card</option>
        {adventure.storyCards.filter(c => c.type === "character" && c.id !== brain.linkedStoryCardId && c.title.trim().toLowerCase() !== brain.characterName.trim().toLowerCase() && !brain.relationships.some(other => other.id !== r.id && other.focusStoryCardId === c.id)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select></label>
    </div>}
    <pre>{relationshipText(r, focus)}</pre>
    <StateEditor key={r.revision} initial={r.current} onSave={state => dispatch({ type: "EDIT_RELATIONSHIP", brainId: brain.id, relationshipId: r.id, state })} />
    {conflicts.length > 0 && <details open><summary>Review possible overlapping authored status</summary>
      <p>These sources mention this pair and may assert its status. Review them manually; enrollment does not rewrite them.</p>
      {conflicts.map(c => <div key={c.id}><strong>{c.title}</strong><p>{c.content}</p></div>)}
    </details>}
    <h5>Starting state and approved history</h5>
    <p>Select up to three entries for context recall while this pair is relevant. Source turn IDs appear in Context Preview. Clear selections to stop recall.</p>
    {r.history.map(h => <div key={h.id}><label><input type="checkbox" checked={r.recalledHistoryIds.includes(h.id)}
      disabled={!r.recalledHistoryIds.includes(h.id) && r.recalledHistoryIds.length >= 3}
      onChange={e => dispatch({ type: "RECALL_RELATIONSHIP_HISTORY", brainId: brain.id, relationshipId: r.id,
        historyIds: e.target.checked ? [...r.recalledHistoryIds, h.id] : r.recalledHistoryIds.filter(id => id !== h.id) })} /> Recall {h.sourceTurnId}</label>
      <pre>{JSON.stringify(h.state, null, 2)}</pre><p>{h.evidence}</p></div>)}
  </details>;
}
export function RelationshipsEditor({ adventure, dispatch, brain }: AdventurePageProps & { brain: BrainEntry }) {
  const [focusStoryCardId, setFocusStoryCardId] = useState("");
  const cards = adventure.storyCards.filter(c => c.type === "character" && c.title.trim() && c.id !== brain.linkedStoryCardId
    && c.title.trim().toLowerCase() !== brain.characterName.trim().toLowerCase()
    && !(brain.relationships ?? []).some(r => r.focusStoryCardId === c.id));
  const focusCard = cards.find(c => c.id === focusStoryCardId);
  return <section className="brain-focus-section"><h4>Dynamic relationships (optional)</h4>
    <p>Each entry records this NPC's view of one focus character. Story Cards retain character facts and untracked relationships. Up to twelve focuses per Brain.</p>
    {(brain.relationships ?? []).map(r => <RelationshipEditor key={r.id} adventure={adventure} dispatch={dispatch} brain={brain} relationship={r} />)}
    <details><summary>Enroll a relationship</summary>
      <label>Focus character <select value={focusCard?.id ?? ""} onChange={e => setFocusStoryCardId(e.target.value)}>
        <option value="">Select a character Story Card</option>
        {cards.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select></label>
      <p>{cards.length ? "Choose an existing character Story Card." : "No eligible character Story Cards. Create a character Story Card first."}</p>
      {focusCard && (brain.relationships ?? []).length < 12 &&
        <StateEditor key={focusCard.id} initial={{ bond: "", status: "", dimensions: { trust: "", respect: "", affection: "" } }} onSave={state => {
          dispatch({ type: "ENROLL_RELATIONSHIP", brainId: brain.id, focusStoryCardId: focusCard.id, state }); setFocusStoryCardId("");
        }} />}
    </details>
  </section>;
}
