import { useState } from "react";
import type { AdventurePageProps } from "./pageTypes";

const PAGE_SIZE = 100;

interface ChroniclePageProps extends AdventurePageProps {
  loading?: boolean;
  onEvaluateStoryCards?: (sourceIds: string[]) => Promise<void>;
}

export function ChroniclePage({ adventure, dispatch, loading = false, onEvaluateStoryCards }: ChroniclePageProps) {
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(adventure.messages.length || 1);
  const [evaluationStatus, setEvaluationStatus] = useState("");
  async function evaluate(ids: string[]) {
    if (!onEvaluateStoryCards) return;
    setEvaluationStatus("Evaluating completed entries…");
    try { await onEvaluateStoryCards(ids); setEvaluationStatus("Evaluation complete. Review suggestions in Memory Inbox."); }
    catch (error) { setEvaluationStatus(error instanceof Error ? error.message : "Evaluation failed."); }
  }
  const [editingId, setEditingId] = useState<string | undefined>();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");

  const messages = adventure.messages;
  const searchLower = search.trim().toLowerCase();
  const filtered = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => !searchLower || message.role.toLowerCase().includes(searchLower) || message.content.toLowerCase().includes(searchLower));
  const visible = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;

  return (
    <section className="page editor-surface chronicle-page">
      <div className="editor-page-summary">
        <h3>Adventure Chronicle — {messages.length} entries</h3>
        <p className="muted">
          Complete story transcript stored locally. Not sent to the AI — only the Recent Messages window
          and active memory surfaces reach the model. Click any entry to edit.
        </p>
        <div className="editor-stat-row" aria-label="Chronicle counts">
          <span>{messages.length} entries</span>
          {searchLower && <span>{filtered.length} shown</span>}
        </div>
      </div>

      {onEvaluateStoryCards && <details className="panel"><summary>Evaluate Story Card Updates</summary>
        <p className="muted">One requested background-model evaluation of up to ten narrator entries. This does not continue or rewrite the story. Candidates appear in Memory Inbox for review.</p>
        <label>From entry <input type="number" min={1} max={messages.length || 1} value={rangeStart} onChange={event => setRangeStart(Number(event.target.value))} /></label>
        <label>Through entry <input type="number" min={rangeStart} max={messages.length || 1} value={rangeEnd} onChange={event => setRangeEnd(Number(event.target.value))} /></label>
        <button type="button" disabled={loading} onClick={() => void evaluate(messages.slice(Math.max(0, rangeStart - 1), rangeEnd).filter(message => message.role === "assistant").map(message => message.id))}>Evaluate range</button>
        {evaluationStatus && <p role="status">{evaluationStatus}</p>}
      </details>}
      <div className="editor-command-bar">
        <input
          type="search"
          placeholder="Search chronicle..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(PAGE_SIZE);
          }}
        />
      </div>

      <div className="list chronicle-list">
        {messages.length === 0 && <p className="muted">No chronicle entries yet.</p>}
        {messages.length > 0 && visible.length === 0 && <p className="muted">No chronicle entries match that search.</p>}
        {visible.map(({ message, index }) =>
          editingId === message.id ? (
            <article key={message.id} className="card chronicle-editing">
              <div className="toolbar">
                <span className="eyebrow">
                  #{index + 1} · {message.role}
                </span>
                <button type="button" onClick={() => setEditingId(undefined)}>Done</button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    dispatch({ type: "DELETE_MESSAGE", messageId: message.id });
                    setEditingId(undefined);
                  }}
                >
                  Delete
                </button>
              </div>
              <textarea
                autoFocus
                rows={Math.max(3, Math.min(20, message.content.split("\n").length + 2))}
                value={message.content}
                onChange={(e) =>
                  dispatch({ type: "UPDATE_MESSAGE", messageId: message.id, content: e.target.value })
                }
              />
            </article>
          ) : (
            <article
              key={message.id}
              className={`chronicle-entry ${message.role}`}
              onClick={() => setEditingId(message.id)}
            >
              <span className="chronicle-role">{message.role}</span>
              <p className="chronicle-text">{message.content}</p>
              {message.memoryRecovery && message.memoryRecovery.status !== "complete" && <p className="muted" role="status">
                Memory: {message.memoryRecovery.status} · {message.memoryRecovery.failures ?? 0} failed evaluations.
                {message.memoryRecovery.status === "quarantined" && " Automatic retries paused. Evaluate this entry manually to retry."}
              </p>}
              {message.role === "assistant" && onEvaluateStoryCards && <button type="button" disabled={loading}
                onClick={event => { event.stopPropagation(); void evaluate([message.id]); }}>Evaluate Story Card Updates</button>}
            </article>
          ),
        )}
        {hasMore && (
          <button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Show more ({filtered.length - limit} remaining)
          </button>
        )}
      </div>
    </section>
  );
}
