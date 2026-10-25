import type { Adventure, MemoryProposal } from "../types/adventure";
import { memoryTargetMatches, memoryTargetSnapshot } from "./memoryCycleState";

export const PLACEMENT_VERSION = 2;
export const STORY_CARD_PLACEMENT_POLICY = `All Story Cards can grow. Record meaningful new durable facts by APPEND to an existing subject or CREATE a focused card when no existing subject fits. Character, Location, Lore and Custom are equally eligible, including old static, living, historical, inactive and autoUpdate=false cards. Modes and inclusion controls never authorize or forbid memory updates.
Return only the new factual delta. Never rewrite the existing body, biography or voice contract. Preserve dates and distinguish an agreed plan, a described technique, a demonstrated result and completed production. A confirmed agreement is a fact even while future work remains unfinished. Attribute claims to their speakers; preserve knowledge boundaries and uncertainty. Later corrections or changed circumstances are dated additions, never deletion of history.
Choose an exact existing destination only when the new facts concern its subject. Sharing participants alone is insufficient. Shared business ventures and technical methods may have their own Lore card. Do not force every character/location development into separate Lore or require an identity transformation. Private character reactions belong in an existing Brain. Routine, redundant or unsupported details yield none.
placement.kind: append for an existing card; create for a new card; brain for existing private Brain state; none for no meaningful supported fact. Preserve the existing destination's type. Never invent names, actions, outcomes or off-screen knowledge.`;

export function placementFingerprint(p: MemoryProposal): string {
  return JSON.stringify([p.proposedType, p.storyCardType, p.title, p.content, p.targetId, p.memoryMode,
    p.cardOperation, p.appendContent, p.sourceTurnId, p.sourceText, p.lore?.knownTo, p.eventMemory]);
}

export function placementValidationError(a: Adventure, p: MemoryProposal): string | undefined {
  if (p.proposedType !== "storyCard" || p.userInitiated) return undefined;
  const v = p.placementValidation;
  if (!v || v.version !== PLACEMENT_VERSION || typeof v.fingerprint !== "string" || typeof v.reason !== "string" || typeof v.newFact !== "string"
    || !["append", "create", "brain", "none"].includes(v.kind)
    || !Array.isArray(v.sources) || v.sources.some(s => !s || typeof s.id !== "string" || typeof s.content !== "string")) return "Placement needs validation against the current draft.";
  if (v.fingerprint !== placementFingerprint(p)) return "The draft or destination changed since placement was validated.";
  if (!v.sources.length || v.sources.some(s => !a.messages.some(m => m.id === s.id && m.content === s.content))) return "The source evidence changed since placement was validated.";
  if (v.target && !memoryTargetMatches(a, v.target)) return "The reviewed destination changed since placement was validated.";
  const target = p.targetId ? a.storyCards.find(c => c.id === p.targetId) : undefined;
  if (p.targetId && (!v.target || v.target.id !== p.targetId)) return "The reviewed destination snapshot is missing.";
  if (p.targetId && (!target || target.type !== p.storyCardType)) return "The destination type does not match this suggestion.";
  if (v.kind === "none" || v.kind === "brain") return "This finding is not a Story Card update.";
  if (p.targetId && (p.cardOperation !== "append" || p.appendContent !== true || v.kind !== "append")) return "Existing card memory must append a validated delta.";
  if (!p.targetId && (p.cardOperation !== "create" || v.kind !== "create")) return "New card memory must use create.";
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
  return `${target ? "Append to" : "Create"} ${type.charAt(0).toUpperCase() + type.slice(1)} · ${target?.title ?? p.title}`;
}
