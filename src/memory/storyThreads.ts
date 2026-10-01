import type { Adventure, StoryThread } from "../types/adventure";
import { nowIso } from "../utils/id";
import { listItems, storyStateWordCount, withoutStoryStateLine } from "./storyStateLines";

/**
 * Open threads as data. Each thread has a stable id ("t3"), so the memory pass and the player resolve
 * it by id instead of matching punctuation-delimited prose, and resolved threads keep their history.
 * The narrator still reads them as the "Open threads" part of Story State.
 */

export { MAX_OPEN_THREADS } from "./storyStateLines";

const norm = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function openStoryThreads(threads: StoryThread[] | undefined): StoryThread[] {
  return (threads ?? []).filter((thread) => thread.status === "open");
}

export function nextThreadId(threads: StoryThread[]): string {
  const max = threads.reduce((highest, thread) => Math.max(highest, Number(/^t(\d+)$/.exec(thread.id)?.[1] ?? 0)), 0);
  return `t${max + 1}`;
}

export function makeStoryThread(threads: StoryThread[], text: string, turn: number, sourceTurnId?: string): StoryThread {
  const timestamp = nowIso();
  return { id: nextThreadId(threads), text: text.trim(), status: "open", createdTurn: turn, sourceTurnId, createdAt: timestamp, updatedAt: timestamp };
}

/** "Open threads:" block. With ids for the memory pass, without for the narrator. */
export function renderOpenThreads(threads: StoryThread[] | undefined, withIds: boolean): string {
  const open = openStoryThreads(threads);
  if (open.length === 0) return "";
  return ["Open threads:", ...open.map((thread) => `- ${withIds ? `[${thread.id}] ` : ""}${thread.text}`)].join("\n");
}

/** Story State as the narrator or the memory pass reads it: the text plus the open threads. */
export function storyStateWithThreads(content: string, threads: StoryThread[] | undefined, withIds: boolean): string {
  return [content.trim(), renderOpenThreads(threads, withIds)].filter(Boolean).join("\n");
}

export function storyStateTotalWords(content: string, threads: StoryThread[] | undefined): number {
  return storyStateWordCount(storyStateWithThreads(content, threads, false));
}

/** Find an open thread by id ("t3", "[t3]") or by its text. */
export function findOpenThread(threads: StoryThread[] | undefined, ref: string): StoryThread | undefined {
  const open = openStoryThreads(threads);
  const id = /^\[?(t\d+)\]?/i.exec(ref.trim())?.[1]?.toLowerCase();
  if (id) {
    const byId = open.find((thread) => thread.id === id);
    if (byId) return byId;
  }
  const wanted = norm(ref.replace(/^\[?t\d+\]?\s*/i, ""));
  if (!wanted) return undefined;
  return open.find((thread) => norm(thread.text) === wanted)
    ?? open.find((thread) => {
      const text = norm(thread.text);
      return (wanted.length >= 8 && text.includes(wanted)) || (text.length >= 8 && wanted.includes(text));
    });
}

export function isDuplicateThread(threads: StoryThread[] | undefined, text: string): boolean {
  const wanted = norm(text);
  return openStoryThreads(threads).some((thread) => norm(thread.text) === wanted);
}

/**
 * One-time move of an "Open threads" line out of Story State text into thread data. Bulleted items
 * (one per line) move intact; a legacy one-line list splits on "; ". Existing "[tN]" ids are kept.
 */
export function migrateOpenThreads(content: string, turn: number): { content: string; threads: StoryThread[] } {
  const { content: rest, value } = withoutStoryStateLine(content, "Open threads");
  if (value === undefined) return { content, threads: [] };
  const threads: StoryThread[] = [];
  const timestamp = nowIso();
  for (const item of listItems(value)) {
    if (threads.some((thread) => norm(thread.text) === norm(item.text))) continue;
    const id = item.id !== undefined && !threads.some((thread) => thread.id === `t${item.id}`) ? `t${item.id}` : undefined;
    threads.push({ id: id ?? nextThreadId(threads), text: item.text, status: "open", createdTurn: turn, createdAt: timestamp, updatedAt: timestamp });
  }
  // Ids assigned in order may collide with a later preserved id; renumber any duplicates.
  const seen = new Set<string>();
  for (const thread of threads) {
    if (seen.has(thread.id)) thread.id = nextThreadId(threads);
    seen.add(thread.id);
  }
  return { content: rest, threads };
}

/** Story State text of an adventure (the single storyState component). */
export function storyStateText(adventure: Pick<Adventure, "components">): string {
  return adventure.components.find((component) => component.type === "storyState")?.content ?? "";
}
