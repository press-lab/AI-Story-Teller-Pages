import type { Adventure, AutonomousLoreProvenance, MemoryProposal, StoryCard } from "../types/adventure";
import { snapshotFingerprint } from "../utils/snapshotFingerprint";

const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

export function isAutonomousLore(value: unknown): value is AutonomousLoreProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Object.keys(p).every(key => ["origin", "subjectCardIds", "generationSourceId", "generationSourceRevision", "generationBatchId"].includes(key))
    && p.origin === "autonomous" && Array.isArray(p.subjectCardIds) && p.subjectCardIds.length > 0
    && p.subjectCardIds.every(nonempty) && new Set(p.subjectCardIds).size === p.subjectCardIds.length
    && nonempty(p.generationSourceId) && nonempty(p.generationBatchId)
    && (p.generationSourceRevision === undefined || nonempty(p.generationSourceRevision));
}

export function autonomousProposalError(p: MemoryProposal): string | undefined {
  if (p.lore?.autonomous === undefined) return undefined;
  if (!isAutonomousLore(p.lore.autonomous) || p.proposedType !== "storyCard" || p.storyCardType !== "lore"
    || p.cardOperation !== "create" || p.targetId != null || p.appendContent || p.storyCardPatch || p.userInitiated || p.manualDraft || p.eventMemory
    || p.sourceTurnId !== p.lore.autonomous.generationSourceId || !Array.isArray(p.lore.sourceMessageIds) || p.lore.sourceMessageIds.length !== 0
    || !Array.isArray(p.lore.knownTo) || !p.lore.knownTo.every(nonempty))
    return "Invalid autonomous Lore creation or provenance.";
  return undefined;
}

export function eligibleAutonomousSubjects(adventure: Adventure): StoryCard[] {
  return adventure.storyCards.filter(card => card.active && card.autonomousDevelopment === true);
}

export function autonomousSubjectSnapshot(card: StoryCard): string {
  const { memoryUpdateHistory: _history, ...subject } = card;
  return snapshotFingerprint(JSON.stringify(subject));
}

export function sameAutonomousSubjects(a: AutonomousLoreProvenance, b: AutonomousLoreProvenance): boolean {
  return a.subjectCardIds.length === b.subjectCardIds.length && a.subjectCardIds.every(id => b.subjectCardIds.includes(id));
}

export function autonomousReferences(adventure: Adventure, sourceId: string) {
  const positions = new Map(adventure.messages.map((message, index) => [message.id, index]));
  const sourcePosition = positions.get(sourceId) ?? -1;
  const position = (p: AutonomousLoreProvenance) => positions.get(p.generationSourceId) ?? -1;
  const recent = <T extends { createdAt: string; provenance: AutonomousLoreProvenance }>(entries: T[]) =>
    entries.filter(entry => position(entry.provenance) <= sourcePosition)
      .sort((a, b) => position(b.provenance) - position(a.provenance) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
  return eligibleAutonomousSubjects(adventure).map((card, index) => {
    const authorization = { alias: "A" + (index + 1), cardId: card.id, snapshot: autonomousSubjectSnapshot(card) };
    const belongs = (value: unknown): value is AutonomousLoreProvenance =>
      isAutonomousLore(value) && value.subjectCardIds.includes(card.id);
    const approved = recent(adventure.storyCards.flatMap(event => event.type === "lore" && belongs(event.lore?.autonomous)
      ? [{ id: event.id, title: event.title, content: event.content, occurredAt: event.lore?.occurredAt, knownTo: event.lore?.knownTo,
        provenance: event.lore!.autonomous!, createdAt: event.createdAt }] : []));
    const considered = recent(adventure.activeState.memoryProposals.flatMap(proposal =>
      ["pending", "rejected", "ignored"].includes(proposal.status) && belongs(proposal.lore?.autonomous) && !autonomousProposalError(proposal)
        ? [{ title: proposal.title, content: proposal.content, status: proposal.status,
          provenance: proposal.lore!.autonomous!, createdAt: proposal.createdAt }] : []));
    return { authorization, reference: {
      id: card.id, title: card.title, type: card.type, content: card.content, lore: card.lore, relationship: card.relationship,
      approvedDevelopments: approved.map(({ createdAt: _createdAt, ...event }) => event),
      consideredDevelopmentsNotCanon: considered.map(({ createdAt: _createdAt, provenance, ...event }) =>
        ({ ...event, generationSource: provenance.generationSourceId })),
      consideredDevelopmentsGuidance: "Considered autonomous developments. These are not established world events. Do not continue them as if they occurred. Avoid proposing the same rejected or pending event again.",
    } };
  });
}

export function autonomousSubjectNames(adventure: Adventure, provenance: AutonomousLoreProvenance): string[] {
  return provenance.subjectCardIds.map(id => adventure.storyCards.find(card => card.id === id)?.title ?? id + " (subject card missing)");
}
