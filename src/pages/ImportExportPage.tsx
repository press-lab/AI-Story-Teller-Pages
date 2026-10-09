import { useMemo, useState, type ChangeEvent } from "react";
import { exportAdventureJson } from "../utils/json";
import type { AdventurePageProps } from "./pageTypes";
import { Field } from "./shared";

interface ImportExportPageProps extends AdventurePageProps {
  onImportAdventure: (text: string) => Promise<void>;
}

type ImportExportMode = "backup" | "restore";

type BackupPreview =
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      id: string;
      title: string;
      turn: number;
      messages: number;
      storyCards: number;
      brains: number;
      components: number;
      rawImports: number;
      updatedAt?: string;
    };

const modeOptions: Array<{ id: ImportExportMode; label: string; description: string }> = [
  { id: "backup", label: "Back Up", description: "Save a complete copy or reusable parts." },
  { id: "restore", label: "Restore", description: "Open a saved adventure backup." },
];

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function parseBackupPreview(text: string): BackupPreview {
  const trimmed = text.trim();
  if (!trimmed) return { status: "empty" };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      return { status: "error", message: "This is JSON, but it is not an adventure backup." };
    }

    const id = typeof parsed.id === "string" ? parsed.id : "";
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    if (!id || !title) {
      return { status: "error", message: "This does not look like a full adventure backup. It needs an adventure title and id." };
    }

    const activeState = isRecord(parsed.activeState) ? parsed.activeState : {};
    return {
      status: "ready",
      id,
      title,
      turn: typeof activeState.turn === "number" ? activeState.turn : 0,
      messages: countArray(parsed.messages),
      storyCards: countArray(parsed.storyCards),
      brains: countArray(parsed.brains),
      components: countArray(parsed.components),
      rawImports: countArray(isRecord(activeState) ? activeState.rawImports : undefined),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return { status: "error", message: "The pasted text is not valid JSON yet." };
  }
}

export function ImportExportPage({
  adventure,
  dispatch,
  onImportAdventure,
}: ImportExportPageProps) {
  const [mode, setMode] = useState<ImportExportMode>("backup");
  const [importText, setImportText] = useState("");
  const [importFilename, setImportFilename] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  async function importAdventure() {
    if (importPreview.status !== "ready") {
      setStatusMessage("Choose a valid adventure backup before importing.");
      return;
    }

    const shouldImport = window.confirm(
      `Import and open "${importPreview.title}"? Your current adventure remains saved locally, but the app will switch to this imported save.`,
    );
    if (!shouldImport) return;

    try {
      await onImportAdventure(importText);
      setImportText("");
      setImportFilename("");
      setMode("backup");
      setStatusMessage(`Imported and opened "${importPreview.title}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Import failed.");
    }
  }

  async function loadAdventureFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFilename(file.name);
    setImportText(await file.text());
    setStatusMessage(`Loaded ${file.name}. Review the preview, then import.`);
    event.target.value = "";
  }

  function slug() {
    return adventure.title.replace(/\W+/g, "-") || "adventure";
  }

  function handleExport() {
    const filename = `${slug()}.json`;
    download(filename, exportAdventureJson(adventure));
    setStatusMessage(`Downloaded full backup: ${filename}`);
  }

  function handleExportStoryCards() {
    const filename = `${slug()}-story-cards.json`;
    const text = JSON.stringify({ storyCards: adventure.storyCards }, null, 2);
    download(filename, text);
    setStatusMessage(`Downloaded reusable Story Cards: ${filename}`);
  }

  function handleExportComponents() {
    const filename = `${slug()}-components.json`;
    const text = JSON.stringify({
      openingScene: adventure.openingScene,
      components: adventure.components,
    }, null, 2);
    download(filename, text);
    setStatusMessage(`Downloaded plot setup: ${filename}`);
  }

  function resetRuntimeState() {
    const shouldReset = window.confirm(
      "Reset runtime queues and logs for this adventure? Authored plot, cards, brains, and transcript stay unchanged.",
    );
    if (!shouldReset) return;
    dispatch({ type: "RESET_RUNTIME_STATE" });
    setStatusMessage("Runtime queues and logs reset.");
  }

  const rawImportCount = adventure.activeState.rawImports.length;
  const transcriptCount = adventure.messages.length;
  const backupJson = exportAdventureJson(adventure);
  const backupSizeKb = Math.max(1, Math.ceil(new Blob([backupJson]).size / 1024));
  const importPreview = useMemo(() => parseBackupPreview(importText), [importText]);

  return (
    <section className="page editor-surface import-export-page">
      <div className="editor-page-summary">
        <p className="muted">
          Back up the current adventure or restore a saved AIST JSON file.
          Full backups keep the playable save together; partial exports are for reuse and editing.
        </p>
        <div className="editor-stat-row" aria-label="Adventure export counts">
          <span>Turn {adventure.activeState.turn}</span>
          <span>{transcriptCount} messages</span>
          <span>{adventure.storyCards.length} cards</span>
          <span>{adventure.brains.length} brains</span>
          {rawImportCount > 0 && <span>{rawImportCount} raw</span>}
        </div>
      </div>

      <div className="import-export-mode-switch" role="tablist" aria-label="Import and export task">
        {modeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            aria-label={`${option.label}: ${option.description}`}
            className={mode === option.id ? "active" : ""}
            onClick={() => setMode(option.id)}
          >
            <span>{option.label}</span>
            <small>{option.description}</small>
          </button>
        ))}
      </div>

      {statusMessage && (
        <div className="import-export-status" role="status">
          {statusMessage}
        </div>
      )}

      <div className="import-export-workspace">
        {mode === "backup" && (
        <article className="panel import-export-card import-export-card-primary">
          <div className="import-export-card-copy">
            <p className="eyebrow">backup</p>
            <h3>Back up this adventure</h3>
            <p className="muted">
              Includes transcript, plot blocks, story cards, brains, triggers, and settings. Runtime API keys stay out.
            </p>
          </div>
          <div className="import-export-preview" aria-label="Current adventure backup preview">
            <div>
              <span className="muted">Current save</span>
              <strong>{adventure.title}</strong>
            </div>
            <dl>
              <div><dt>Turn</dt><dd>{adventure.activeState.turn}</dd></div>
              <div><dt>Messages</dt><dd>{transcriptCount}</dd></div>
              <div><dt>Story Cards</dt><dd>{adventure.storyCards.length}</dd></div>
              <div><dt>Brains</dt><dd>{adventure.brains.length}</dd></div>
            </dl>
          </div>
          <div className="import-export-primary-action">
            <button type="button" className="primary-action" onClick={handleExport}>
              Download full backup
            </button>
            <span className="muted">{backupSizeKb} KB JSON</span>
          </div>
          <div className="import-export-secondary-actions" aria-label="Partial exports">
            <button type="button" onClick={handleExportStoryCards}>
              <span>Story Cards</span>
              <small>{adventure.storyCards.length} reusable memory cards</small>
            </button>
            <button type="button" onClick={handleExportComponents}>
              <span>Plot Setup</span>
              <small>Opening scene and context blocks</small>
            </button>
          </div>
        </article>
        )}

        {mode === "restore" && (
        <article className="panel import-export-card">
          <div className="import-export-card-copy">
            <p className="eyebrow">restore</p>
            <h3>Open an adventure backup</h3>
            <p className="muted">
              Use a full JSON backup from this app. Import saves it locally and switches to that adventure.
            </p>
          </div>
          <div className="import-file-picker">
            <Field label="Backup file">
              <input type="file" accept=".json,application/json" onChange={loadAdventureFile} />
            </Field>
            {importFilename && <span className="status-pill">Loaded {importFilename}</span>}
          </div>
          <Field label="Adventure JSON">
            <textarea
              rows={6}
              value={importText}
              onChange={(event) => {
                setImportFilename("");
                setImportText(event.target.value);
              }}
              placeholder="Paste a full adventure backup JSON here."
            />
          </Field>
          <div className={`import-export-preview import-export-restore-preview import-export-preview-${importPreview.status}`}>
            {importPreview.status === "empty" && (
              <p className="muted">Choose a backup file or paste a full adventure JSON to preview what will open.</p>
            )}
            {importPreview.status === "error" && (
              <p>{importPreview.message}</p>
            )}
            {importPreview.status === "ready" && (
              <>
                <div>
                  <span className="muted">Ready to open</span>
                  <strong>{importPreview.title}</strong>
                  {importPreview.updatedAt && <small>Last saved {new Date(importPreview.updatedAt).toLocaleString()}</small>}
                </div>
                <dl>
                  <div><dt>Turn</dt><dd>{importPreview.turn}</dd></div>
                  <div><dt>Messages</dt><dd>{importPreview.messages}</dd></div>
                  <div><dt>Story Cards</dt><dd>{importPreview.storyCards}</dd></div>
                  <div><dt>Brains</dt><dd>{importPreview.brains}</dd></div>
                  <div><dt>Plot Blocks</dt><dd>{importPreview.components}</dd></div>
                  {importPreview.rawImports > 0 && <div><dt>Raw Imports</dt><dd>{importPreview.rawImports}</dd></div>}
                </dl>
              </>
            )}
          </div>
          <div className="toolbar">
            <button type="button" className="primary-action" onClick={importAdventure} disabled={importPreview.status !== "ready"}>
              Import and open
            </button>
          </div>
          <details className="import-maintenance">
            <summary>Maintenance</summary>
            <p className="muted">Clears runtime queues and logs on the current adventure without changing authored content.</p>
            <button type="button" className="danger" onClick={resetRuntimeState}>
              Reset Runtime State
            </button>
          </details>
        </article>
        )}
      </div>

      {rawImportCount > 0 && (
        <details className="panel import-export-details" open>
          <summary>
            <span>
              <strong>Imported source material</strong>
              <small>{rawImportCount} preserved source item{rawImportCount === 1 ? "" : "s"}.</small>
            </span>
          </summary>
          <div className="raw-import-list">
            {adventure.activeState.rawImports.map((raw) => (
              <details key={raw.id} className="card raw-import-item">
                <summary>
                  <span>{raw.title || "Untitled raw import"}</span>
                  <small>{raw.content.length.toLocaleString()} chars</small>
                </summary>
                <Field label="Title">
                  <input
                    value={raw.title}
                    onChange={(event) =>
                      dispatch({ type: "UPDATE_RAW_IMPORT", rawImportId: raw.id, patch: { title: event.target.value } })
                    }
                  />
                </Field>
                <textarea
                  rows={6}
                  value={raw.content}
                  onChange={(event) =>
                    dispatch({ type: "UPDATE_RAW_IMPORT", rawImportId: raw.id, patch: { content: event.target.value } })
                  }
                />
                <button
                  type="button"
                  className="danger"
                  onClick={() => dispatch({ type: "DELETE_RAW_IMPORT", rawImportId: raw.id })}
                >
                  Delete Raw Import
                </button>
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
