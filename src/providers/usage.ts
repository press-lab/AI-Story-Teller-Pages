import type { ProviderConfig, ProviderUsage } from "../types/adventure";

/**
 * Token accounting shared by the provider, reducer, and runtime.
 *
 * Every provider call is reported once through `reportProviderUsage`, keyed by the adventure's
 * session id. That single choke point is what makes the adventure's lifetime spend total honest:
 * it counts calls whose output was later discarded (regenerate, failed rewrite, deleted entries)
 * and manual AI tools, none of which leave usage on a message.
 */

const SESSION_PREFIX = "ai-story-teller:";

export function sessionIdForAdventure(adventureId: string): string {
  return `${SESSION_PREFIX}${adventureId}`.slice(0, 256);
}

export function adventureIdFromSessionId(sessionId: string | undefined): string | undefined {
  if (!sessionId?.startsWith(SESSION_PREFIX)) return undefined;
  return sessionId.slice(SESSION_PREFIX.length) || undefined;
}

/** Sum usage objects. Cache fields stay undefined unless at least one input reported them. */
export function combineProviderUsage(...usages: Array<ProviderUsage | undefined>): ProviderUsage | undefined {
  const present = usages.filter((usage): usage is ProviderUsage => usage !== undefined);
  if (present.length === 0) return undefined;
  const promptTokens = present.reduce((sum, usage) => sum + usage.promptTokens, 0);
  const completionTokens = present.reduce((sum, usage) => sum + usage.completionTokens, 0);
  const totalTokens = present.reduce(
    (sum, usage) => sum + (usage.totalTokens || usage.promptTokens + usage.completionTokens),
    0,
  );
  const cacheRead = present.reduce((sum, usage) => sum + (usage.cacheReadTokens ?? 0), 0);
  const cacheWrite = present.reduce((sum, usage) => sum + (usage.cacheCreationTokens ?? 0), 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(present.some((usage) => usage.cacheReadTokens !== undefined) ? { cacheReadTokens: cacheRead } : {}),
    ...(present.some((usage) => usage.cacheCreationTokens !== undefined) ? { cacheCreationTokens: cacheWrite } : {}),
  };
}

export interface ProviderUsageEvent {
  sessionId?: string;
  usage: ProviderUsage;
}

type ProviderUsageListener = (event: ProviderUsageEvent) => void;

const listeners = new Set<ProviderUsageListener>();

export function subscribeProviderUsage(listener: ProviderUsageListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Called by the provider adapter for every billed response, including ones later rejected. */
export function reportProviderUsage(config: Pick<ProviderConfig, "sessionId">, usage: ProviderUsage | undefined): void {
  if (!usage) return;
  for (const listener of listeners) {
    try {
      listener({ sessionId: config.sessionId, usage });
    } catch {
      // Accounting must never break a generation.
    }
  }
}
