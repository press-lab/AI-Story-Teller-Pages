import { useState } from "react";
import type { AdventurePageProps } from "./pageTypes";

const PAGE_SIZE = 100;

export function ChroniclePage({ adventure, dispatch }: AdventurePageProps) {
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
