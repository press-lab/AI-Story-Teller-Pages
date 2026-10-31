import type { Adventure, AdventureAction, LoreMetadata, StoryCard, StoryTime } from "../types/adventure";
import { useEffect, useState } from "react";
import { validLoreDate } from "../memory/validateLoreChronology";
import { STORY_TIME_PRECISIONS, readStoryTime } from "../memory/storyTime";
import { formatStoryTimeForDisplay } from "./storyTimeDisplay";
import { Field, commaList, fromCommaList } from "./shared";

function TimeFields({ label, value, onChange }: { label: string; value?: StoryTime; onChange: (time: StoryTime | undefined) => void }) {
  return <div className="grid two">
    <Field label={label}><input value={value?.text ?? ""} placeholder="Unknown; e.g. February 1, 2019 or around midwinter"
      onChange={event => onChange(event.target.value ? { ...readStoryTime("Date: " + event.target.value).time!, text: event.target.value } : undefined)} /></Field>
    <Field label={`${label} precision`}><select value={value?.precision ?? "unknown"}
      onChange={event => onChange({ ...((event.target.value === "day" || event.target.value === "time") ? readStoryTime("Date: " + (value?.text ?? "")).time : {}), text: value?.text ?? "", precision: event.target.value as StoryTime["precision"] })}>
      {STORY_TIME_PRECISIONS.map(p => <option key={p} value={p}>{p}</option>)}
    </select></Field>
  </div>;
}

function ListField({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder?: string }) {
  const saved = commaList(values);
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  return <Field label={label}><input value={text} placeholder={placeholder} onChange={event => setText(event.target.value)}
    onBlur={() => onChange(fromCommaList(text))} /></Field>;
}

export function StoryClockEditor({ adventure, dispatch, compact = false, inline = false }: { adventure: Adventure; dispatch: (action: AdventureAction) => void; compact?: boolean; inline?: boolean }) {
  const current = adventure.storyClock?.current;
  const [draft, setDraft] = useState<StoryTime | undefined>(current);
  useEffect(() => setDraft(current), [adventure.id, current]);
  // Force exact-looking Gregorian text through the existing calendar validation,
  // even when readStoryTime correctly retains an impossible day as unknown text.
  const valid = Boolean(draft && draft.text.trim() && validLoreDate({ ...draft, precision: draft.precision === "unknown" ? "day" : draft.precision }));
  const unchanged = JSON.stringify(draft) === JSON.stringify(current);
  const contents = <>
    {inline && <h3>Current Story Date: {formatStoryTimeForDisplay(current)}{adventure.storyClock?.origin === "assumed" ? " (assumed)" : ""}</h3>}
    <p className="muted">In-world time, independent of your computer clock. Explicit story-date headings and day skips can advance it; flashbacks do not. Ambiguous dates remain textual.</p>
    {adventure.storyClock?.pendingReference && <p role="alert">Unresolved time passage: {adventure.storyClock.pendingReference}. Correct the story clock when the duration is known.</p>}
    <TimeFields label="Current story time" value={draft} onChange={setDraft} />
    {!valid && draft?.text && <p role="alert">Enter a valid story date. Gregorian dates must be valid calendar dates.</p>}
    <button type="button" disabled={unchanged || !valid} onClick={() => {
      if (valid && !unchanged) dispatch({ type: "SET_STORY_CLOCK", clock: { current: draft } });
    }}>Apply Story Date</button>
    <p className="muted">Changing the current date affects future story entries. Existing Chronicle messages and memory suggestions are not automatically rewritten.</p>
  </>;
  return inline ? <section className="panel" aria-label="Current Story Date">{contents}</section>
    : <details className="panel"><summary>{compact ? "Correct story date" : <>Current story clock: {formatStoryTimeForDisplay(current)}{adventure.storyClock?.origin === "assumed" ? " (assumed)" : ""}</>}</summary>{contents}</details>;
}

export function LoreChronologyEditor({ card, dispatch, messages }: { card: StoryCard; dispatch: (action: AdventureAction) => void; messages: Adventure["messages"] }) {
  if (card.type !== "lore") return null;
  const lore: LoreMetadata = card.lore ?? { status: "unresolved", sourceMessageIds: [] };
  function update(patch: Partial<LoreMetadata>) {
    dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { lore: { ...lore, ...patch } } });
  }
  return <fieldset><legend>Lore chronology and knowledge</legend>
    <p>Occurred: {formatStoryTimeForDisplay(lore.occurredAt)} · Last meaningful change: {formatStoryTimeForDisplay(lore.lastChangedAt)}</p>
    <Field label="Lore status"><select value={lore.status} onChange={event => update({ status: event.target.value as LoreMetadata["status"] })}>
      {["completed", "ongoing", "unresolved", "superseded"].map(status => <option key={status} value={status}>{status}</option>)}
    </select></Field>
    <ListField label="Known to (private knowledge)" values={lore.knownTo ?? []}
      placeholder="Leave unspecified unless evidence establishes who knows"
      onChange={knownTo => update({ knownTo })} />
    <ListField label="Chronicle source message IDs" values={lore.sourceMessageIds}
      onChange={sourceMessageIds => update({ sourceMessageIds })} />
    {lore.sourceMessageIds.map(id => {
      const message = messages.find(m => m.id === id);
      return <details key={id}><summary>{id}{message ? ` · action position ${messages.indexOf(message) + 1}` : " · source unavailable"}</summary>
        <p>{message?.content ?? "Source message is not present in this adventure."}</p></details>;
    })}
  </fieldset>;
}
