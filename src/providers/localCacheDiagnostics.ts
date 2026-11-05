import type { ContextBuildResult } from "../types/adventure";

/** Input comparison only; the server separately reports actual token-cache reuse. */
export function compareLocalContexts(previous: ContextBuildResult | undefined, current: ContextBuildResult): NonNullable<ContextBuildResult["localCacheComparison"]> {
  if (!previous) return { previousRequest: false, commonPrefixCharacters: 0 };
  const before = JSON.stringify(previous.messages), after = JSON.stringify(current.messages);
  let commonPrefixCharacters = 0;
  while (commonPrefixCharacters < Math.min(before.length, after.length) && before[commonPrefixCharacters] === after[commonPrefixCharacters]) commonPrefixCharacters++;
  const sections = [...current.sections].sort((a, b) => a.order - b.order);
  const firstChangedSection = sections.find(section => previous.sections.find(old => old.id === section.id)?.content !== section.content)?.id;
  return { previousRequest: true, commonPrefixCharacters, firstChangedSection };
}
