import type { ChangeEvent } from "react";
import type { MemoryUpdateHistoryEntry, MemoryUpdateSnapshot } from "../types/adventure";

export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check-field" style={disabled ? { opacity: 0.4 } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function JsonTextarea<T>({
  value,
  onValidChange,
  rows = 6,
}: {
  value: T;
  onValidChange: (value: T) => void;
  rows?: number;
}) {
  function handleBlur(event: ChangeEvent<HTMLTextAreaElement>) {
    try {
      onValidChange(JSON.parse(event.target.value) as T);
      event.target.setCustomValidity("");
    } catch (error) {
      event.target.setCustomValidity(error instanceof Error ? error.message : "Invalid JSON");
      event.target.reportValidity();
    }
  }

  return <textarea rows={rows} defaultValue={JSON.stringify(value, null, 2)} onBlur={handleBlur} spellCheck={false} />;
}

export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i} className="search-highlight">{part}</mark> : part,
      )}
    </>
  );
}

export function contentSnippet(content: string, query: string, context = 60): string {
  if (!query) return "";
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(0, idx - context);
  const end = Math.min(content.length, idx + query.length + context);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

export function commaList(value: string[]): string {
  return value.join(", ");
}

export function fromCommaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatCompactTimestamp(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function UpdatedAtBadge({ value, label = "Updated" }: { value: string | undefined; label?: string }) {
  const timestamp = formatCompactTimestamp(value);
  if (!timestamp) return null;
  return (
    <span className="badge badge-updated" title={`${label}: ${timestamp}`}>
      {label} {timestamp}
    </span>
  );
}

export function TokenCountBadge({ count, title = "Estimated context tokens" }: { count: number; title?: string }) {
  return (
    <span className="badge badge-priority" title={`${title}: ${count.toLocaleString()}`}>
      {count.toLocaleString()} tokens
    </span>
  );
}

function snapshotMeta(snapshot: MemoryUpdateSnapshot | null): string {
  if (!snapshot) return "New memory item";
  const values = [
    snapshot.type,
    snapshot.memoryMode,
    snapshot.keys && snapshot.keys.length > 0 ? `${snapshot.keys.length} trigger${snapshot.keys.length === 1 ? "" : "s"}` : "",
    snapshot.state ? `state: ${snapshot.state}` : "",
    snapshot.arcPremise ? `arc: ${snapshot.arcPremise}` : "",
    snapshot.arcPhase ? `phase: ${snapshot.arcPhase}` : "",
  ].filter(Boolean);
  return values.join(" | ");
}

function snapshotText(snapshot: MemoryUpdateSnapshot | null): string {
  if (!snapshot) return "";
  const parts = [snapshot.content, snapshot.archivedFacts ? `Archived:\n${snapshot.archivedFacts}` : ""].filter(Boolean);
  return parts.join("\n\n");
}

function MemorySnapshotPane({ label, snapshot }: { label: string; snapshot: MemoryUpdateSnapshot | null }) {
  const text = snapshotText(snapshot);
  return (
    <div className="memory-history-pane">
      <strong>{label}</strong>
      <span className="muted">{snapshotMeta(snapshot)}</span>
      <pre>{text || "(empty)"}</pre>
    </div>
  );
}

export function MemoryUpdateHistory({ history }: { history: MemoryUpdateHistoryEntry[] | undefined }) {
  if (!history?.length) return null;
  const entries = [...history].reverse();
  return (
    <details className="brain-secondary-details item-secondary-details memory-history-details">
      <summary>Memory update history ({history.length})</summary>
      <div className="memory-history-list">
        {entries.map((entry) => (
          <article key={entry.id} className="memory-history-entry">
            <div className="memory-history-entry-heading">
              <strong>{entry.operation}</strong>
              <span className="muted">
                {formatCompactTimestamp(entry.updatedAt)}
                {entry.proposalId ? ` | proposal ${entry.proposalId}` : ""}
                {entry.sourceTurnId ? ` | source ${entry.sourceTurnId}` : ""}
              </span>
            </div>
            <div className="grid two memory-history-snapshots">
              <MemorySnapshotPane label="Previous" snapshot={entry.previous} />
              <MemorySnapshotPane label="After" snapshot={entry.next} />
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
