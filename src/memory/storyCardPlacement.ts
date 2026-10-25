import type { Adventure, MemoryProposal, MemoryPlacementValidation } from "../types/adventure";
import { memoryTargetMatches, memoryTargetSnapshot } from "./memoryCycleState";

export const PLACEMENT_VERSION = 3;
export const STORY_CARD_PLACEMENT_POLICY = `Lore is the default destination for meaningful events, shared developments, agreements, research, discoveries and relationship interactions. Append to an existing Lore card about that event/topic, or create focused Lore when none fits. A participant's existing Character card is not the event's subject. Do not append a scene recap to a biography just because that person acted, spoke, learned something or made an offer.
Character updates are exceptional: require a specific supported new or corrected enduring profile fact (identity, lasting capability, role/status, or an explicitly established enduring relationship), and explain why it changes the profile beyond this scene. A new habit or personality trait cannot be inferred from one action. Ordinary conversations, tests, invitations, promises of disclosure and unsettled outcomes belong in Lore if significant enough, otherwise none. Private reactions belong in an existing Brain.
For APPEND to Character, return identityChange:{targetId,kind:"correction|transformation|profile",fact,reason,evidenceQuotes:[{messageId,quote}]}. The reason must explain the enduring profile change rather than participation in an event. Quotes must be exact from the supplied evidence and support that profile fact. Without this exception, choose Lore or none. New Character cards are only for a genuinely missing durable identity, never a scene titled with a participant's name.
Location and Custom updates must concern the enduring place/subject itself. Legacy modes, inactive cards and autoUpdate=false do not restrict eligible destinations. Return only the new factual delta; never replace existing content, biography or voice. Preserve dates, chronology, source IDs, claims, uncertainty and knowledge boundaries. Plans are plans; completed outcomes require evidence. Routine, redundant or unsupported details yield none.
placement.kind: append for an existing card; create for a new card; brain for existing private Brain state; none for no meaningful supported fact. For create, cardType defaults to lore; specify character|location|custom only for a new enduring subject of that type. For append use the exact destination ID and preserve its type. Never invent names, actions, outcomes or off-screen knowledge.`;

/** Validate the explicit semantic exception, never guess profile changes from scene keywords. */
export function characterProfileChangeError(a: Adventure, targetId: string, change: MemoryPlacementValidation["identityChange"], ids: string[]): string | undefined {
  if (!change || change.targetId !== targetId || !["correction", "transformation", "profile"].includes(change.kind)
    || typeof change.fact !== "string" || !change.fact.trim() || typeof change.reason !== "string" || !change.reason.trim()
    || !Array.isArray(change.evidenceQuotes) || !change.evidenceQuotes.length
    || change.evidenceQuotes.some(q => !q || typeof q.messageId !== "string" || typeof q.quote !== "string" || !q.quote.trim()
      || !ids.includes(q.messageId) || !a.messages.some(m => m.id === q.messageId && m.content.includes(q.quote)))) {
    return "Character updates require an enduring profile change, a specific reason and exact supporting source quotes; route events to Lore.";
  }
  return undefined;
}

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
  if (target?.type === "character") {
    const error = characterProfileChangeError(a, target.id, v.identityChange, v.sources.map(s => s.id));
    if (error) return error;
  }
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
