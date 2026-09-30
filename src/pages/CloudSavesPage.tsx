import type { AdventureAction, Adventure, GitHubSaveSettings, GitHubSaveSlot } from "../types/adventure";
import { CheckboxField, Field, NumberInput } from "./shared";

interface CloudSavesPageProps {
  adventure: Adventure;
  dispatch: (action: AdventureAction) => void;
  gitHubSaveSettings: GitHubSaveSettings;
  onGitHubSaveSettingsChange: (settings: GitHubSaveSettings) => void;
  saveSlots: GitHubSaveSlot[];
  savesStatus: string;
  loadingSlotId?: string;
  loadError?: string;
  onDismissError?: () => void;
  onListSaves: () => void;
  onSaveNow: () => void;
  onLoadSave: (slot: GitHubSaveSlot) => void;
  onDeleteSave: (slot: GitHubSaveSlot) => void;
}

function formatUtc(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").replace(/Z$/, " UTC");
}

export function CloudSavesPage({
  adventure,
  dispatch,
  gitHubSaveSettings,
  onGitHubSaveSettingsChange,
  saveSlots,
  savesStatus,
  loadingSlotId,
  loadError,
  onDismissError,
  onListSaves,
  onSaveNow,
  onLoadSave,
  onDeleteSave,
}: CloudSavesPageProps) {
  function update(patch: Partial<GitHubSaveSettings>) {
    onGitHubSaveSettingsChange({ ...gitHubSaveSettings, ...patch });
  }

  function updateAutoSave(autoSaveEnabled: boolean, autoSaveEveryNTurns: number, autoSaveEveryNMinutes?: number) {
    dispatch({ type: "SET_AUTO_SAVE_SETTINGS", autoSaveEnabled, autoSaveEveryNTurns, autoSaveEveryNMinutes });
  }

  return (
    <section className="page editor-surface cloud-saves-page">
      <div className="editor-page-summary">
        <p className="muted">
          Save and load full adventure snapshots from your private GitHub save slots. API keys are never included.
        </p>
        <div className="editor-stat-row" aria-label="Cloud save counts">
          <span>{saveSlots.length} slots</span>
          <span>{adventure.autoSaveEnabled ? "auto-save on" : "auto-save off"}</span>
          {savesStatus && <span>{savesStatus}</span>}
        </div>
      </div>

      <div className="editor-command-bar saves-command-bar">
        <span className="muted">GitHub save slots</span>
        <button type="button" onClick={onSaveNow}>Save Now</button>
        <button type="button" onClick={onListSaves}>List Saves</button>
      </div>

      <div className="settings-section-grid">
        <article className="panel settings-card settings-section-full cloud-save-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">GitHub Save Slots</p>
              <h3>{adventure.title}</h3>
              <p className="muted">
                Full adventure snapshots stored in your private GitHub repo. Secrets (API keys) are never saved.
                Credentials are configured in Settings → Personal Cloud Sync.
              </p>
            </div>
          </div>

          <div className="grid three">
            <CheckboxField
              label="Auto-save after turns"
              checked={adventure.autoSaveEnabled}
              onChange={(autoSaveEnabled) => updateAutoSave(autoSaveEnabled, adventure.autoSaveEveryNTurns, adventure.autoSaveEveryNMinutes)}
            />
            <Field label="Auto-save every N turns">
              <NumberInput
                min={1}
                value={adventure.autoSaveEveryNTurns}
                onChange={(autoSaveEveryNTurns) => updateAutoSave(adventure.autoSaveEnabled, autoSaveEveryNTurns, adventure.autoSaveEveryNMinutes)}
              />
            </Field>
            <Field label="Auto-save every N minutes">
              <NumberInput
                min={0}
                value={adventure.autoSaveEveryNMinutes ?? 5}
                onChange={(autoSaveEveryNMinutes) => updateAutoSave(adventure.autoSaveEnabled, adventure.autoSaveEveryNTurns, autoSaveEveryNMinutes)}
              />
            </Field>
            <Field label="Saves folder path">
              <input
                value={gitHubSaveSettings.savesBasePath}
                onChange={(event) => update({ savesBasePath: event.target.value })}
              />
            </Field>
          </div>

          {loadError && (
            <div className="error-box error-dismissible" style={{ marginTop: "0.5rem" }}>
              <span>{loadError}</span>
              <button type="button" className="error-dismiss" aria-label="Dismiss error" onClick={onDismissError}>×</button>
            </div>
          )}

          {saveSlots.length > 0 && (
            <table className="cloud-save-table">
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Adventure</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Type</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Turn</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Saved (UTC)</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}></th>
                </tr>
              </thead>
              <tbody>
                {saveSlots.map((slot) => {
                  const isLoading = loadingSlotId === slot.saveId;
                  return (
                    <tr key={slot.saveId} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{slot.title}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{slot.saveType}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{slot.turnCount}</td>
                      <td style={{ padding: "0.35rem 0.5rem", fontFamily: "monospace" }}>{formatUtc(slot.savedAt)}</td>
                      <td style={{ padding: "0.35rem 0.5rem", display: "flex", gap: "0.35rem" }}>
                        <button
                          type="button"
                          disabled={isLoading || !!loadingSlotId}
                          onClick={() => onLoadSave(slot)}
                        >
                          {isLoading ? "Loading…" : "Load"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!!loadingSlotId}
                          onClick={() => { if (window.confirm(`Delete save "${slot.title}" (${slot.saveType}, turn ${slot.turnCount})?`)) onDeleteSave(slot); }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="notice">
            Loading a save will overwrite the local copy for that adventure and switch to it.
          </p>
        </article>
      </div>
    </section>
  );
}
