import type { Adventure, GitHubSaveSlot } from "../types/adventure";

function formatUtc(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").replace(/Z$/, " UTC");
}

interface GitHubSaveConflictDialogProps {
  loaded: Adventure;
  local: Adventure;
  slot: GitHubSaveSlot;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GitHubSaveConflictDialog({ loaded, local, slot, onConfirm, onCancel }: GitHubSaveConflictDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="tool-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Overwrite local adventure?"
        style={{ maxWidth: "480px" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="tool-modal-header">
          <div>
            <p className="eyebrow">Load GitHub Save</p>
            <h2>Overwrite local adventure?</h2>
          </div>
          <button type="button" onClick={onCancel}>Cancel</button>
        </header>
        <div className="tool-modal-body" style={{ padding: "1rem 1.25rem" }}>
          <p>
            <strong>{loaded.title}</strong> already exists locally. Loading this save will replace it.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "0.75rem 0", fontSize: "0.875rem" }}>
            <tbody>
              <tr>
                <td style={{ padding: "0.3rem 0.5rem 0.3rem 0", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Local last updated</td>
                <td style={{ padding: "0.3rem 0", fontFamily: "monospace" }}>{formatUtc(local.updatedAt)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.5rem 0.3rem 0", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Save created</td>
                <td style={{ padding: "0.3rem 0", fontFamily: "monospace" }}>{formatUtc(slot.savedAt)}</td>
              </tr>
              <tr>
                <td style={{ padding: "0.3rem 0.5rem 0.3rem 0", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Save content date</td>
                <td style={{ padding: "0.3rem 0", fontFamily: "monospace" }}>{formatUtc(loaded.updatedAt)}</td>
              </tr>
            </tbody>
          </table>
          <div className="toolbar">
            <button type="button" onClick={onCancel}>Keep local</button>
            <button type="button" className="primary-action" onClick={onConfirm}>
              Overwrite with GitHub save
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
