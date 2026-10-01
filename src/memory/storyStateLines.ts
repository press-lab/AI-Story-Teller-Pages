import { STORY_STATE_LABELS, type StoryStateLabel } from "../types/adventure";

/**
 * Targeted Story State edits. Story State stays plain text; these helpers read and change one labeled
 * line ("Location: …") without touching the rest, so a one-fact change never risks dropping others.
 *
 * List lines ("Has met", "Open threads") are written one item per bullet line. Open threads items carry
 * a stable id ("- [t3] the missing seal") so a thread can be resolved by id, whatever punctuation it
 * contains. The narrator never sees the ids (see stripStoryStateIds).
 */

/** Lines whose value is a list of items. */
export const STORY_STATE_LIST_LABELS: ReadonlySet<StoryStateLabel> = new Set<StoryStateLabel>(["Has met", "Open threads"]);

/** Live threads kept at once. Past this, a thread must be resolved before another is added. */
export const MAX_OPEN_THREADS = 8;
/** Whole-block ceiling. Line edits that would push past it are refused; consolidation is a full rewrite. */
export const STORY_STATE_MAX_WORDS = 400;

const LABEL_RE = new RegExp(`^\\s*(?:[-*•]\\s*)?(${STORY_STATE_LABELS.map((label) => label.replace("/", "\\/")).join("|")})\\s*:\\s*(.*)$`, "i");
const THREAD_ID_RE = /^\[t(\d+)\]\s*/i;
const EMPTY_LIST = /^(none|nothing|n\/a|-)\.?$/i;

interface StateSection {
  label: StoryStateLabel;
  /** Index of the label line and of the last continuation line. */
  start: number;
  end: number;
  value: string;
}

export interface ListItem {
  id?: number;
  text: string;
}

const norm = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const storyStateWordCount = (content: string) => stripStoryStateIds(content).split(/\s+/).filter(Boolean).length;

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

/**
 * Items of a list line. Bulleted lines split only on line breaks, so an item may contain semicolons.
 * A legacy single-line list ("a; b; c") splits on "; " and is rewritten as bullets on its next edit.
 */
export function listItems(value: string): ListItem[] {
  const bulleted = value.includes("\n") || /^\s*[-*•]\s/.test(value);
  const raw = bulleted ? value.split("\n") : value.split(/;\s+|;$/);
  return raw
    .map((entry) => entry.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim().replace(/[;.]\s*$/, (end) => end.trim() === "." ? "." : ""))
    .filter((entry) => entry && !EMPTY_LIST.test(entry))
    .map((entry) => {
      const id = THREAD_ID_RE.exec(entry);
      return id ? { id: Number(id[1]), text: entry.slice(id[0].length).trim() } : { text: entry };
    })
    .filter((item) => item.text);
}

/** Open threads in the block, with ids where assigned. */
export function openThreads(content: string): ListItem[] {
  const value = storyStateLineValue(content, "Open threads");
  return value ? listItems(value) : [];
}

function maxThreadId(content: string): number {
  return [...content.matchAll(/\[t(\d+)\]/gi)].reduce((max, match) => Math.max(max, Number(match[1])), 0);
}

function renderList(label: StoryStateLabel, items: ListItem[]): string {
  if (items.length === 0) return `${label}: none`;
  return [`${label}:`, ...items.map((item) => `- ${item.id !== undefined ? `[t${item.id}] ` : ""}${item.text}`)].join("\n");
}

function replaceSection(content: string, section: StateSection | undefined, rendered: string, label: StoryStateLabel): string {
  const lines = content.split("\n");
  const sections = parseSections(content);
  if (section) return [...lines.slice(0, section.start), rendered, ...lines.slice(section.end + 1)].join("\n");
  // Insert a missing label after the last labeled line that precedes it in canonical order.
  const order = STORY_STATE_LABELS.indexOf(label);
  const before = sections.filter((entry) => STORY_STATE_LABELS.indexOf(entry.label) < order).at(-1);
  const insertAt = before ? before.end + 1 : sections[0]?.start ?? lines.length;
  return [...lines.slice(0, insertAt), rendered, ...lines.slice(insertAt)].join("\n");
}

/** Give every open thread a stable id and write list lines as bullets. Idempotent. */
export function normalizeStoryState(content: string): string {
  const sections = parseSections(content);
  const threads = sections.find((section) => section.label === "Open threads");
  if (!threads) return content;
  let next = maxThreadId(content);
  const items = listItems(threads.value).map((item) => item.id !== undefined ? item : { ...item, id: ++next });
  return replaceSection(content, threads, renderList("Open threads", items), "Open threads");
}

/** Remove the "[tN] " thread ids, for the narrator's view of Story State. */
export function stripStoryStateIds(content: string): string {
  return content.replace(/^(\s*[-*•]\s*)\[t\d+\]\s*/gim, "$1");
}

function findItem(items: ListItem[], value: string): number {
  const idMatch = /^\[?t(\d+)\]?$/i.exec(value.trim()) ?? THREAD_ID_RE.exec(value.trim());
  if (idMatch) {
    const byId = items.findIndex((item) => item.id === Number(idMatch[1]));
    if (byId >= 0) return byId;
  }
  const wanted = norm(value.replace(THREAD_ID_RE, ""));
  if (!wanted) return -1;
  const exact = items.findIndex((item) => norm(item.text) === wanted);
  if (exact >= 0) return exact;
  return items.findIndex((item) => {
    const text = norm(item.text);
    return (wanted.length >= 8 && text.includes(wanted)) || (text.length >= 8 && wanted.includes(text));
  });
}

export type StoryStateLineResult = { content: string } | { error: string };

/**
 * Apply one targeted edit. "set" replaces the line; "add" / "remove" change one item of a list line.
 * Removal matches a thread id ("t3"), the exact item, or an unambiguous part of it.
 */
export function tryStoryStateLine(
  content: string,
  edit: { label: StoryStateLabel; op: "set" | "add" | "remove" },
  value: string,
): StoryStateLineResult {
  const sections = parseSections(content);
  if (sections.length === 0) return { error: "Story State has no labeled lines" };
  const target = sections.find((section) => section.label === edit.label);
  const isList = STORY_STATE_LIST_LABELS.has(edit.label);
  const item = value.trim();

  if (edit.op === "set") {
    if (isList) {
      const items = listItems(item);
      const ids = edit.label === "Open threads";
      let next = maxThreadId(content);
      return { content: replaceSection(content, target, renderList(edit.label, ids ? items.map((entry) => entry.id !== undefined ? entry : { ...entry, id: ++next }) : items), edit.label) };
    }
    return { content: replaceSection(content, target, `${edit.label}: ${item}`, edit.label) };
  }
  if (!isList) return { error: `only Has met and Open threads take add/remove` };

  const items = target ? listItems(target.value) : [];
  if (edit.op === "add") {
    const text = item.replace(THREAD_ID_RE, "");
    if (items.some((existing) => norm(existing.text) === norm(text))) return { content };
    if (edit.label === "Open threads" && items.length >= MAX_OPEN_THREADS) {
      return { error: `Open threads already has ${items.length} items (limit ${MAX_OPEN_THREADS}); resolve one first` };
    }
    const added = edit.label === "Open threads" ? { id: maxThreadId(content) + 1, text } : { text };
    return { content: replaceSection(content, target, renderList(edit.label, [...items, added]), edit.label) };
  }
  const index = findItem(items, item);
  if (index < 0) return { error: "item to remove is not on the line" };
  return { content: replaceSection(content, target, renderList(edit.label, items.filter((_, i) => i !== index)), edit.label) };
}

/** Apply one targeted edit, or undefined when it cannot apply. */
export function applyStoryStateLine(
  content: string,
  edit: { label: StoryStateLabel; op: "set" | "add" | "remove" },
  value: string,
): string | undefined {
  const result = tryStoryStateLine(content, edit, value);
  return "content" in result ? result.content : undefined;
}
