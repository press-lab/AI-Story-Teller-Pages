import { useEffect, useState } from "react";
import type { StoryTime } from "../types/adventure";
import { readStoryTime, STORY_TIME_PRECISIONS } from "../memory/storyTime";
import { Field } from "./shared";

function parseDate(text: string) {
  const time = readStoryTime("Date: " + text).time;
  const gregorian = /^\d{4}-\d{2}-\d{2}\b/.test(text.trim())
    || /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i.test(text.trim());
  return { time, invalid: gregorian && !time?.date };
}

/** Proposal chronology only: this control never dispatches a story-clock action. */
export function ProposalEventDate({ value, onChange, onValidityChange }: {
  value?: StoryTime;
  onChange: (time: StoryTime) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [text, setText] = useState(value?.text ?? "");
  const [precision, setPrecision] = useState<StoryTime["precision"]>(value?.precision ?? "unknown");
  useEffect(() => { setText(value?.text ?? ""); setPrecision(value?.precision ?? "unknown"); }, [value?.text, value?.precision]);

  const { invalid } = parseDate(text);
  useEffect(() => onValidityChange(!invalid), [invalid, onValidityChange]);

  function update(nextText: string, nextPrecision: StoryTime["precision"]) {
    setText(nextText);
    setPrecision(nextPrecision);
    const { time: next, invalid } = parseDate(nextText);
    if (invalid) return;
    onChange({ text: nextText, precision: nextPrecision,
      ...(next?.date && (nextPrecision === "day" || nextPrecision === "time") ? { date: next.date } : {}) });
  }

  return <fieldset><legend>Event Date</legend>
    <div className="grid two">
      <Field label="Event Date"><input value={text} aria-invalid={invalid} placeholder="Unknown; Gregorian, fictional, approximate or relative date"
        onChange={event => {
          const next = event.target.value;
          const inferred = readStoryTime("Date: " + next).time?.precision ?? "unknown";
          update(next, precision === "approximate" || precision === "relative" ? precision : inferred);
        }} /></Field>
      <Field label="Event Date precision"><select value={precision} onChange={event => update(text, event.target.value as StoryTime["precision"])}>
        {STORY_TIME_PRECISIONS.map(p => <option key={p} value={p}>{p}</option>)}
      </select></Field>
    </div>
    {invalid && <p role="alert">Enter a valid Gregorian date. This date cannot be approved.</p>}
    <p className="muted">Dates this development only; the current story clock stays unchanged. For UPDATE, earlier occurrence dates and history are preserved.</p>
  </fieldset>;
}
