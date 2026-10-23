import type { Adventure, AdventureAction, LoreMetadata, StoryCard, StoryTime } from "../types/adventure";
import { useEffect, useState } from "react";
import { STORY_TIME_PRECISIONS, readStoryTime } from "../memory/storyTime";
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

export function StoryClockEditor({ adventure, dispatch }: { adventure: Adventure; dispatch: (action: AdventureAction) => void }) {
  return <details className="panel"><summary>Current story clock: {adventure.storyClock?.current?.text || "unknown"}{adventure.storyClock?.origin === "assumed" ? " (assumed)" : ""}</summary>
    <p className="muted">In-world time, independent of your computer clock. Explicit story-date headings and day skips can advance it; flashbacks do not. Ambiguous dates remain textual.</p>
    <TimeFields label="Current story time" value={adventure.storyClock?.current}
      onChange={current => dispatch({ type: "SET_STORY_CLOCK", clock: { current } })} />
  </details>;
}

export function LoreChronologyEditor({ card, dispatch, messages }: { card: StoryCard; dispatch: (action: AdventureAction) => void; messages: Adventure["messages"] }) {
  if (card.type !== "lore") return null;
  const lore: LoreMetadata = card.lore ?? { status: "unresolved", sourceMessageIds: [] };
  function update(patch: Partial<LoreMetadata>) {
    dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { lore: { ...lore, ...patch } } });
  }
  return <fieldset><legend>Lore chronology and knowledge</legend>
    <TimeFields label="Occurred at" value={lore.occurredAt} onChange={occurredAt => update({ occurredAt })} />
    <TimeFields label="Last meaningful change" value={lore.lastChangedAt} onChange={lastChangedAt => update({ lastChangedAt })} />
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
