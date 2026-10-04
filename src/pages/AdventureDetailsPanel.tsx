import { useState } from "react";
import type { Adventure, AdventureAction } from "../types/adventure";
import { ADVENTURE_THUMBNAIL_METADATA_KEY } from "../utils/adventureImages";
import { CheckboxField, Field, formatCompactTimestamp } from "./shared";

/** "scenarioAuthorContentRating" → "Scenario author content rating". */
export function metadataFieldLabel(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

function textRows(value: string): number {
  const lines = value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 90)), 0);
  return Math.min(8, Math.max(1, lines));
}

/**
 * Top-level adventure details: the title and the free-form `metadata` object saved with the
 * adventure and its JSON export (scenario description, content rating, revision notes, ...).
 * These are bookkeeping for the author and are not assembled into model context.
 */
export function AdventureDetailsPanel({ adventure, dispatch }: { adventure: Adventure; dispatch: (action: AdventureAction) => void }) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(adventure.metadata ?? {});
  const editable = entries.filter((entry): entry is [string, string | number | boolean] =>
    entry[0] !== ADVENTURE_THUMBNAIL_METADATA_KEY && ["string", "number", "boolean"].includes(typeof entry[1]));
  const structured = entries.filter(([key]) => !editable.some(([editableKey]) => editableKey === key));
  const trimmedKey = newKey.trim();
  const keyTaken = trimmedKey.length > 0 && trimmedKey in (adventure.metadata ?? {});

  function setField(key: string, value: string | number | boolean) {
    dispatch({ type: "UPDATE_METADATA", metadata: { [key]: value } });
  }

  function addField() {
    if (!trimmedKey || keyTaken) return;
    setField(trimmedKey, "");
    setNewKey("");
  }

  return (
    <details className="panel adventure-details-panel">
      <summary>
        Adventure details <span className="muted">— {editable.length} {editable.length === 1 ? "field" : "fields"}</span>
      </summary>
      <p className="muted">
        Saved with the adventure and included in its JSON export. Not sent to the model; story context comes from the sections below.
      </p>
      <div className="adventure-details-grid">
        <Field label="Title">
          <input value={adventure.title} onChange={(event) => dispatch({ type: "SET_TITLE", title: event.target.value })} placeholder="Adventure title" />
        </Field>
        <p className="muted adventure-details-readonly">
          <span>ID <code>{adventure.id}</code></span>
          <span>Created {formatCompactTimestamp(adventure.createdAt) || "—"}</span>
          <span>Updated {formatCompactTimestamp(adventure.updatedAt) || "—"}</span>
        </p>
        {editable.map(([key, value]) => (
          <div key={key} className="adventure-details-field">
            {typeof value === "boolean" ? (
              <CheckboxField label={metadataFieldLabel(key)} checked={value} onChange={(checked) => setField(key, checked)} />
            ) : typeof value === "number" ? (
              <Field label={metadataFieldLabel(key)}>
                <input type="number" value={value} onChange={(event) => setField(key, Number(event.target.value))} />
              </Field>
            ) : (
              <Field label={metadataFieldLabel(key)}>
                {/* Always a textarea (only its height changes) so focus survives a value growing long. */}
                <textarea rows={textRows(value)} value={value} onChange={(event) => setField(key, event.target.value)} />
              </Field>
            )}
            <button type="button" className="danger adventure-details-remove" aria-label={`Remove ${metadataFieldLabel(key)}`}
              onClick={() => dispatch({ type: "REMOVE_METADATA_FIELD", key })}>
              Remove
            </button>
          </div>
        ))}
        {structured.length > 0 && (
          <p className="muted">
            Not editable here: {structured.map(([key]) => key === ADVENTURE_THUMBNAIL_METADATA_KEY ? "cover image (use the cover picker in the editor header)" : metadataFieldLabel(key)).join(", ")}.
          </p>
        )}
        <div className="adventure-details-add">
          <Field label="New field name">
            <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="e.g. scenarioDescription"
              onKeyDown={(event) => { if (event.key === "Enter") addField(); }} />
          </Field>
          <button type="button" onClick={addField} disabled={!trimmedKey || keyTaken}>Add field</button>
          {keyTaken && <span className="muted">That field already exists.</span>}
        </div>
      </div>
    </details>
  );
}
