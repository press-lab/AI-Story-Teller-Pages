import { useState } from "react";
import { MAX_OPEN_THREADS, openStoryThreads } from "../memory/storyThreads";
import type { Adventure, AdventureAction } from "../types/adventure";

/** Open threads as an editable list: add, reword, resolve, reopen, or delete. All changes go through the reducer. */
export function StoryThreadsPanel({ adventure, dispatch }: { adventure: Adventure; dispatch: (action: AdventureAction) => void }) {
  const [draft, setDraft] = useState("");
  const threads = adventure.storyThreads ?? [];
  const open = openStoryThreads(threads);
  const resolved = threads.filter((thread) => thread.status === "resolved").slice(-20).reverse();

  const add = () => {
    if (!draft.trim()) return;
    dispatch({ type: "ADD_STORY_THREAD", text: draft });
    setDraft("");
  };

  return (
    <section className="story-threads-panel" aria-label="Open threads">
      <strong>Open threads ({open.length}{open.length > MAX_OPEN_THREADS ? `, over the limit of ${MAX_OPEN_THREADS}` : ""})</strong>
      <p className="muted" style={{ margin: "0.25rem 0" }}>
        Live, unresolved situations. The narrator reads them as part of Story State. The memory pass resolves finished ones and adds new ones (at most {MAX_OPEN_THREADS}); you can edit them here.
      </p>
      {open.length === 0 && <p className="muted">No open threads.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {open.map((thread) => (
          <li key={thread.id} className="row" style={{ gap: "0.4rem", alignItems: "center", marginBottom: "0.3rem" }}>
            <span className="badge" title={`Opened on turn ${thread.createdTurn}`}>{thread.id}</span>
            <input
              style={{ flex: 1 }}
              aria-label={`Thread ${thread.id}`}
              value={thread.text}
              onChange={(event) => dispatch({ type: "UPDATE_STORY_THREAD", threadId: thread.id, text: event.target.value })}
            />
            <button type="button" onClick={() => dispatch({ type: "RESOLVE_STORY_THREAD", threadId: thread.id })}>Resolve</button>
            <button type="button" className="danger" onClick={() => dispatch({ type: "DELETE_STORY_THREAD", threadId: thread.id })} title="Delete without keeping it in history">Delete</button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: "0.4rem", marginTop: "0.4rem" }}>
        <input
          style={{ flex: 1 }}
          placeholder="Add an open thread, e.g. Carine's blood results are still pending"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") add(); }}
        />
        <button type="button" disabled={!draft.trim()} onClick={add}>Add thread</button>
      </div>
      {resolved.length > 0 && (
        <details style={{ marginTop: "0.5rem" }}>
          <summary>Recently resolved ({resolved.length})</summary>
          <ul>
            {resolved.map((thread) => (
              <li key={thread.id}>
                <span className="muted">{thread.id} · turn {thread.resolvedTurn ?? "?"}: </span>{thread.text}{" "}
                <button type="button" onClick={() => dispatch({ type: "REOPEN_STORY_THREAD", threadId: thread.id })}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
