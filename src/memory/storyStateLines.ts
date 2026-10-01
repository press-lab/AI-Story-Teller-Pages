import { STORY_STATE_LABELS, type StoryStateLabel } from "../types/adventure";

/**
 * Targeted Story State edits. Story State stays plain text; these helpers read and change one labeled
 * line ("Location: …") without touching the rest, so a one-fact change never risks dropping others.
 */

/** Lines whose value is a list of items separated by "; " (or continuation bullets). */
export const STORY_STATE_LIST_LABELS: ReadonlySet<StoryStateLabel> = new Set<StoryStateLabel>(["Has met", "Open threads"]);

const LABEL_RE = new RegExp(`^\\s*(?:[-*•]\\s*)?(${STORY_STATE_LABELS.map((label) => label.replace("/", "\\/")).join("|")})\\s*:\\s*(.*)$`, "i");

interface StateSection {
  label: StoryStateLabel;
  /** Index of the label line and of the last continuation line. */
  start: number;
  end: number;
  value: string;
}

const norm = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function canonicalStateLabel(label: string): StoryStateLabel | undefined {
  const wanted = norm(label);
  return STORY_STATE_LABELS.find((candidate) => norm(candidate) === wanted);
}

function parseSections(content: string): StateSection[] {
  const lines = content.split("\n");
  const sections: StateSection[] = [];
  lines.forEach((line, index) => {
    const match = LABEL_RE.exec(line);
    if (match) {
      sections.push({ label: canonicalStateLabel(match[1])!, start: index, end: index, value: match[2].trim() });
    } else if (sections.length > 0 && line.trim()) {
      const current = sections[sections.length - 1];
      current.end = index;
      current.value = [current.value, line.trim()].filter(Boolean).join("\n");
    }
  });
  return sections;
}

/** True when the block uses labeled lines, so targeted edits can apply. */
export function hasLabeledStoryState(content: string): boolean {
  return parseSections(content).length > 0;
}

/** The current value of one labeled line, or undefined when the label is absent. */
export function storyStateLineValue(content: string, label: StoryStateLabel): string | undefined {
  return parseSections(content).find((section) => section.label === label)?.value;
}

function listItems(value: string): string[] {
  return value.split(/;|\n/).map((item) => item.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim()).filter(Boolean);
}

/**
 * Apply one targeted edit. Returns the new Story State, or undefined when the edit cannot apply
 * (no labeled lines at all, or removing an item that is not there).
 */
export function applyStoryStateLine(
  content: string,
  edit: { label: StoryStateLabel; op: "set" | "add" | "remove" },
  value: string,
): string | undefined {
  const sections = parseSections(content);
  if (sections.length === 0) return undefined;
  const lines = content.split("\n");
  const target = sections.find((section) => section.label === edit.label);
  const item = value.trim();

  let nextValue: string;
  if (edit.op === "set") {
    nextValue = item;
  } else {
    const items = target ? listItems(target.value) : [];
    if (edit.op === "add") {
      if (items.some((existing) => norm(existing) === norm(item))) return content;
      nextValue = [...items, item].join("; ");
    } else {
      const wanted = norm(item);
      const kept = items.filter((existing) => !(norm(existing) === wanted || (wanted.length >= 8 && norm(existing).includes(wanted))));
      if (kept.length === items.length) return undefined;
      nextValue = kept.join("; ") || "none";
    }
  }

  const rendered = `${edit.label}: ${nextValue}`;
  if (target) {
    return [...lines.slice(0, target.start), rendered, ...lines.slice(target.end + 1)].join("\n");
  }
  if (edit.op === "remove") return undefined;
  // Insert a missing label after the last labeled line that precedes it in canonical order.
  const order = STORY_STATE_LABELS.indexOf(edit.label);
  const before = sections.filter((section) => STORY_STATE_LABELS.indexOf(section.label) < order).at(-1);
  const insertAt = before ? before.end + 1 : sections[0].start;
  return [...lines.slice(0, insertAt), rendered, ...lines.slice(insertAt)].join("\n");
}
