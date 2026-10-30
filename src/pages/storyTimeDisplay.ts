import type { StoryTime } from "../types/adventure";
import { formatStoryTime, readStoryTime } from "../memory/storyTime";

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/** UI decoration only: saved dates and model context keep their existing representation. */
export function formatStoryTimeForDisplay(time?: StoryTime): string {
  const label = formatStoryTime(time);
  if (!time?.date || !["day", "time"].includes(time.precision)
    || readStoryTime("Date: " + time.date).time?.date !== time.date) return label;
  const weekday = weekdayFormatter.format(new Date(time.date + "T00:00:00Z"));
  return new RegExp(`\\b${weekday}\\b`, "i").test(label) ? label : `${label} (${weekday})`;
}
