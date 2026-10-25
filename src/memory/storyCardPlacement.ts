import type { Adventure, MemoryPlacementKind, MemoryProposal, StoryCardType } from "../types/adventure";
import { memoryTargetMatches, memoryTargetSnapshot } from "./memoryCycleState";

export const PLACEMENT_VERSION = 1;
export const STORY_CARD_PLACEMENT_POLICY = `Classify the NEW fact separately from the surrounding biography.
Character and Location cards hold enduring identity. Significant actions, lessons, relationships, agreements and events belong in Lore even when a participant has an identity card. Living mode does not permit scene logs in identity cards.
Moody demonstrating Unforgivable Curses belongs in historicalLore, not his Character profile. Moody saying the curse killed Harry's parents does not mean Moody died. An unchanged description such as permanently scarred is not a new identity change. A classroom hosting a lesson does not change its identity; destruction elsewhere does not destroy this location.
identity: a missing identity/reference, or an evidenced correction/transformation of the exact target. historicalLore: completed significant events. ongoingLore: evolving relationships/arrangements. referenceLore: established world rules/techniques. brain: supported private state of an existing Brain only. none: routine, redundant or unsupported.
Do not infer Moody considers Seth a weapon from his eye lingering. Attribute claims to speakers. Keep Lore focused on new facts; omit biography and voice contracts.`;

export function placementFingerprint(p: MemoryProposal): string {
  return JSON.stringify([p.proposedType, p.storyCardType, p.title, p.content, p.targetId, p.memoryMode,
    p.appendContent, p.sourceTurnId, p.sourceText, p.lore?.knownTo, p.eventMemory]);
}

export function placementCardType(kind: MemoryPlacementKind, identityType?: string): StoryCardType {
  return kind === "identity" && (identityType === "character" || identityType === "location" || identityType === "custom") ? identityType : "lore";
}

export function placementMode(kind: MemoryPlacementKind) {
  return kind === "historicalLore" ? "historical" as const : kind === "ongoingLore" ? "living" as const : "static" as const;
}

export function placementValidationError(a: Adventure, p: MemoryProposal): string | undefined {
  if (p.proposedType !== "storyCard" || p.userInitiated) return undefined;
  const v = p.placementValidation;
  if (!v || v.version !== PLACEMENT_VERSION || typeof v.fingerprint !== "string" || typeof v.reason !== "string" || typeof v.newFact !== "string"
    || !["identity", "historicalLore", "ongoingLore", "referenceLore", "brain", "none"].includes(v.kind)
    || !Array.isArray(v.sources) || v.sources.some(s => !s || typeof s.id !== "string" || typeof s.content !== "string")) return "Placement needs validation against the current draft.";
  if (v.fingerprint !== placementFingerprint(p)) return "The draft or destination changed since placement was validated.";
  if (!v.sources.length || v.sources.some(s => !a.messages.some(m => m.id === s.id && m.content === s.content))) return "The source evidence changed since placement was validated.";
  if (v.target && !memoryTargetMatches(a, v.target)) return "The reviewed destination changed since placement was validated.";
  const target = p.targetId ? a.storyCards.find(c => c.id === p.targetId) : undefined;
  if (p.targetId && (!target || target.type !== p.storyCardType)) return "The destination type does not match this suggestion.";
  if (v.kind === "none" || v.kind === "brain") return "This finding is not a Story Card update.";
  if (v.kind !== "identity" && (p.storyCardType !== "lore" || p.memoryMode !== placementMode(v.kind))) return "Lore placement does not match its destination or mode.";
  if (v.kind === "identity") {
    if (p.storyCardType === "lore") return "Identity placement cannot authorize Lore content.";
    if (target && (target.type === "character" || target.type === "location")) {
      const change = v.identityChange;
      if (!change || change.targetId !== target.id || typeof change.fact !== "string" || !change.fact.trim()
        || !["correction", "transformation"].includes(change.kind) || !Array.isArray(change.evidenceQuotes) || !change.evidenceQuotes.length
        || !change.evidenceQuotes.every(q => q && typeof q.messageId === "string" && typeof q.quote === "string" && q.quote.trim() && v.sources.some(s => s.id === q.messageId && s.content.includes(q.quote)))) return "The identity change lacks target-specific reviewed evidence.";
    }
  }
  return undefined;
}

export function bindPlacement(a: Adventure, p: MemoryProposal, review: Omit<NonNullable<MemoryProposal["placementValidation"]>, "version" | "fingerprint" | "sources" | "target">, ids: string[]): MemoryProposal {
  const sources = a.messages.filter(m => ids.includes(m.id)).map(({ id, content }) => ({ id, content }));
  const next: MemoryProposal = { ...p, placementValidation: { ...review, version: PLACEMENT_VERSION,
    fingerprint: placementFingerprint(p), sources,
    target: p.targetId ? memoryTargetSnapshot(a, "storyCard", p.targetId) : undefined } };
  return next;
}

export function proposalDestinationLabel(a: Adventure, p: MemoryProposal): string {
  if (p.proposedType !== "storyCard") return p.proposedType;
  const target = a.storyCards.find(c => c.id === p.targetId);
  const type = target?.type ?? p.storyCardType ?? "lore";
  const mode = p.memoryMode ?? target?.memoryMode ?? "static";
  return `${target ? "Update" : "Create"} ${type.charAt(0).toUpperCase() + type.slice(1)} · ${target?.title ?? (mode === "historical" ? "Historical" : mode === "living" ? "Ongoing" : "Reference")}`;
}
