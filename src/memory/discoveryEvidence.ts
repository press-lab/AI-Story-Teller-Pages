import { primaryStoryCardType } from "./storyCardArchitecture";
import type { MemoryDiscoveryCandidate, Message } from "../types/adventure";

interface CandidateError { code: string; reason: string }
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 12) : [];

/** Persist only known fields, not raw provider responses or arbitrary extra keys. */
export function parseDiscoveryCandidate(raw: unknown): { candidate: MemoryDiscoveryCandidate; error?: CandidateError } {
  const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const candidate: MemoryDiscoveryCandidate = {
    title: typeof item.title === "string" ? item.title.trim().slice(0, 160) : "",
    content: typeof item.content === "string" ? item.content.trim().slice(0, 4000) : "",
    storyCardType: item.storyCardType === "event" ? "event" : primaryStoryCardType(typeof item.storyCardType === "string" ? item.storyCardType : "lore"),
    targetId: typeof item.targetId === "string" ? item.targetId : undefined,
    rationale: typeof item.rationale === "string" ? item.rationale.slice(0, 1000) : undefined,
    evidenceMessageIds: Array.isArray(item.evidenceMessageIds) ? item.evidenceMessageIds.slice(0, 13).map(id => typeof id === "string" ? id : "") : [],
    evidenceQuotes: Array.isArray(item.evidenceQuotes) ? item.evidenceQuotes.slice(0, 13).map(raw => {
      const quote = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { messageId: typeof quote.messageId === "string" ? quote.messageId : "",
        quote: typeof quote.quote === "string" ? quote.quote.slice(0, 4001) : "" };
    }) : undefined,
    suggestedTriggers: strings(item.suggestedTriggers ?? item.triggers ?? item.keys),
    memoryMode: item.memoryMode as MemoryDiscoveryCandidate["memoryMode"],
    eventStatus: item.eventStatus as MemoryDiscoveryCandidate["eventStatus"],
    candidateOnly: item.candidateOnly as boolean | undefined,
  };
  if (item.eventMemory && typeof item.eventMemory === "object") {
    const event = item.eventMemory as Record<string, unknown>;
    candidate.eventMemory = { participants: strings(event.participants), recallCues: strings(event.recallCues),
      kind: typeof event.kind === "string" ? event.kind : undefined };
  }
  if (!candidate.title || !candidate.content || typeof item.content !== "string" || item.content.length > 4000 || String(item.title).trim().length > 160
    || !["lore", "character", "location", "custom", "event", "plot", "faction"].includes(String(item.storyCardType ?? "lore"))) {
    return { candidate, error: { code: "discovery_candidate_schema_invalid", reason: "Discovery candidate has invalid title, content or card type." } };
  }
  return { candidate };
}

/** Checks exact original IDs/quotes; never fabricates or repairs evidence. */
export function discoveryEvidenceError(item: MemoryDiscoveryCandidate, messages: Message[], sourceId?: string): CandidateError | undefined {
  const failure = (code: string, reason: string) => ({ code: `discovery_${code}`, reason });
  if (!Array.isArray(item.evidenceMessageIds) || !item.evidenceMessageIds.length
    || item.evidenceMessageIds.length > 12 || item.evidenceMessageIds.some(id => typeof id !== "string" || !id.trim())) {
    return failure("missing_evidence_ids", "Discovery lacks a valid list of evidence message IDs.");
  }
  if (item.evidenceMessageIds.some(id => !messages.some(message => message.id === id))) {
    return failure("foreign_evidence_ids", "Discovery evidence references a message outside the permitted evidence window.");
  }
  if (!sourceId) return undefined; // Explicit legacy catch-up retains its existing contract.
  if (!item.evidenceMessageIds.includes(sourceId)) {
    return failure("missing_establishing_source", "Discovery evidence omits the establishing narrator source.");
  }
  if ((item.memoryMode !== undefined && !["historical", "living", "static"].includes(item.memoryMode))
    || !["completed", "ongoing", "unresolved"].includes(item.eventStatus ?? "")
    || (item.candidateOnly !== undefined && typeof item.candidateOnly !== "boolean")) {
    return failure("candidate_schema_invalid", "Discovery has invalid or missing memory mode, event status or candidate-only flag.");
  }
  if (!Array.isArray(item.evidenceQuotes) || !item.evidenceQuotes.length || item.evidenceQuotes.length > 12
    || item.evidenceQuotes.some(quote => !quote || typeof quote.messageId !== "string" || typeof quote.quote !== "string" || !quote.quote.trim() || quote.quote.length > 4000
      || !item.evidenceMessageIds.includes(quote.messageId)
      || !messages.some(message => message.id === quote.messageId && message.content.includes(quote.quote)))) {
    return failure("invalid_evidence_quote", "Discovery lacks exact supporting quotes from its referenced sources.");
  }
  if (!item.evidenceQuotes.some(quote => quote.messageId === sourceId)) {
    return failure("missing_establishing_quote", "Discovery lacks an exact quote from the establishing narrator source.");
  }
  return undefined;
}
