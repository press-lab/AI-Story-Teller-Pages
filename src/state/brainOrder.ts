import type { Adventure } from "../types/adventure";

/** Saved editor order is independent of the priority used to select model context. */
export function orderedBrains(adventure: Adventure) {
  const byPriority = [...adventure.brains].sort((a, b) => b.priority - a.priority);
  const byId = new Map(byPriority.map(brain => [brain.id, brain]));
  const seen = new Set<string>();
  const saved = (adventure.activeState.brainOrder ?? []).flatMap(id => {
    const brain = byId.get(id);
    if (!brain || seen.has(id)) return [];
    seen.add(id);
    return [brain];
  });
  return [...saved, ...byPriority.filter(brain => !seen.has(brain.id))];
}
