import type { Adventure } from "../types/adventure";
import { MAX_OPEN_THREADS, STORY_STATE_MAX_WORDS, storyStateWordCount } from "./storyStateLines";
import { openStoryThreads } from "./storyThreads";

/**
 * Plain-language explanations of why automatic memory is (or is not) keeping the story current.
 * Read-only: it reports settings and accumulated state, and never changes either.
 */
export interface MemoryHealthIssue {
  id: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
}

/** Recent evaluation entries scanned for repeated rejections. */
const RECENT_LOG_ENTRIES = 30;
const REPEATED_REJECTION_THRESHOLD = 5;

/** Group a rejection message by its reason, dropping the target name ("Edythe: …"). */
function rejectionReason(error: string): string | undefined {
  const match = /^Memory pass skipped: (?:[^:]+: )?(.+)$/.exec(error);
  if (!match) return undefined;
  return match[1].replace(/\d+/g, "N");
}

export function memoryHealthIssues(adventure: Adventure): MemoryHealthIssue[] {
  const issues: MemoryHealthIssue[] = [];
  const components = adventure.components.filter((component) => component.active);

  const storyState = components.find((component) => component.type === "storyState");
  if (storyState) {
    const words = storyStateWordCount(storyState.content);
    const threads = openStoryThreads(adventure.storyThreads).length;
    if (words > STORY_STATE_MAX_WORDS || threads > MAX_OPEN_THREADS) {
      issues.push({
        id: "story-state-size",
        severity: "warning",
        title: `Story State is ${words} words with ${threads} open threads`,
        detail: `It is sent with every turn, so finished events listed there keep steering the narrator. The limits are ${STORY_STATE_MAX_WORDS} words and ${MAX_OPEN_THREADS} live threads. ` +
          (storyState.autoUpdate === false
            ? "AI updates are off for this block, so trim it by hand."
            : "The next memory pass will suggest a consolidation (a shorter text, or resolving finished threads) for your review. You can also resolve threads yourself under Story State."),
      });
    }
  }

  const arc = components.find((component) => component.type === "currentArc");
  if (arc && arc.autoUpdate === false && (arc.arcState?.phase === "break" || arc.arcState?.phase === "aftermath")) {
    issues.push({
      id: "arc-updates-off",
      severity: "warning",
      title: `Current Arc is in ${arc.arcState.phase} with AI updates switched off`,
      detail: "The memory pass cannot log the climax or suggest that it resolved. Resolve the arc in the Arc Director panel, or switch AI updates on for the Current Arc block.",
    });
  }

  const pressure = components.find((component) => component.type === "activePressure");
  if (pressure && pressure.autoUpdate === false) {
    const arcOver = arc?.arcState?.phase === "break" || arc?.arcState?.phase === "aftermath";
    issues.push({
      id: "pressure-frozen",
      severity: arcOver ? "warning" : "info",
      title: "Active Pressure is frozen (AI updates off)",
      detail: `It stays exactly as written: "${pressure.content.trim().slice(0, 140)}". ${arcOver ? "If that threat is over, edit it by hand or switch AI updates on, or the narrator will keep pushing it." : "Edit it by hand when the stakes change."}`,
    });
  }

  const cards = adventure.storyCards.filter((card) => card.active && card.type !== "event");
  if (cards.length >= 10 && !cards.some((card) => card.memoryMode === "living")) {
    issues.push({
      id: "no-living-cards",
      severity: "info",
      title: `All ${cards.length} Story Cards are static`,
      detail: "Static cards only gain facts; an outdated fact can be replaced only when an author correction requires it. Set evolving characters and relationships to living memory on the Story Cards page.",
    });
  }

  if ((adventure.memoryDetectionSettings.everyNTurns ?? 3) <= 1 && adventure.memoryDetectionSettings.enabled) {
    issues.push({
      id: "memory-every-turn",
      severity: "info",
      title: "Automatic memory runs every story turn",
      detail: "Each pass is a separate API call, and with auto-approve each mistake lands immediately and builds on the last. Every 3 turns is the default.",
    });
  }

  const recentErrors = adventure.activeState.evaluationLog.slice(-RECENT_LOG_ENTRIES).flatMap((entry) => entry.errors);
  const counts = new Map<string, number>();
  for (const error of recentErrors) {
    const reason = /no usable JSON/.test(error) ? "the memory pass returned no usable JSON" : rejectionReason(error);
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  for (const [reason, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (count < REPEATED_REJECTION_THRESHOLD) continue;
    issues.push({
      id: `rejections:${reason}`,
      severity: "warning",
      title: `${count} recent memory updates failed: ${reason}`,
      detail: "Repeated failures mean memory is not being kept current. See Settings → Automatic memory and the evaluation log for details.",
    });
  }

  return issues;
}
