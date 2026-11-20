import type { Adventure, MemoryProposal, StoryCard } from "../types/adventure";

export function canonicalRelationshipIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

export function relationshipKey(ids: readonly string[]): string {
  return JSON.stringify(canonicalRelationshipIds(ids));
}

export function relationshipIdError(ids: unknown): string | undefined {
  if (!Array.isArray(ids) || ids.length < 2) return "Select at least two distinct Character Cards.";
  if (ids.some(id => typeof id !== "string" || !id.trim())) return "Relationship participant IDs must be nonempty strings.";
  if (new Set(ids).size !== ids.length) return "Relationship participant IDs must be distinct.";
}

export function validateRelationshipIds(cards: readonly StoryCard[], ids: unknown): string | undefined {
  const shapeError = relationshipIdError(ids);
  if (shapeError) return shapeError;
  for (const id of ids as string[]) {
    const card = cards.find(candidate => candidate.id === id);
    if (!card) return `Missing Character Card ID: ${id}.`;
    if (card.type !== "character") return `Card ${card.title} (${id}) is not a Character Card.`;
  }
}

export function relationshipMatches(cards: readonly StoryCard[], ids: readonly string[]): StoryCard[] {
  if (validateRelationshipIds(cards, ids)) return [];
  const key = relationshipKey(ids);
  return cards.filter(card => {
    const links = card.relationship?.characterIds;
    return card.type === "relationship" && links && !validateRelationshipIds(cards, links) && relationshipKey(links) === key;
  });
}

export const relationshipNameKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type CharacterIdentity = Pick<StoryCard, "id" | "title" | "keys">;

export function relationshipCharacterMatches(characters: readonly CharacterIdentity[], name: string): CharacterIdentity[] {
  const normalized = relationshipNameKey(name);
  if (!normalized) return [];
  const titles = characters.filter(card => relationshipNameKey(card.title) === normalized);
  const matches = titles.length ? titles : characters.filter(card => card.keys.some(alias => relationshipNameKey(alias) === normalized));
  return [...new Map(matches.map(card => [card.id, card])).values()];
}

export function relationshipTitle(cards: readonly StoryCard[], ids: readonly string[]): string {
  return cards.filter(card => ids.includes(card.id))
    .map(card => ({ ...card, normalizedTitle: relationshipNameKey(card.title) }))
    .sort((a, b) => a.normalizedTitle < b.normalizedTitle ? -1 : a.normalizedTitle > b.normalizedTitle ? 1 : a.id < b.id ? -1 : 1)
    .map(card => card.title).join(" + ");
}

export function relationshipCardError(cards: readonly StoryCard[], card: StoryCard): string | undefined {
  if (card.type !== "relationship") return;
  const links = card.relationship?.characterIds;
  const error = validateRelationshipIds(cards, links);
  if (error || !links) return error;
  const matches = relationshipMatches(cards, links);
  if (matches.length > 1 || matches.some(match => match.id !== card.id)) return "A Relationship Card already links this exact set of characters.";
}

export function relationshipProposalError(adventure: Adventure, proposal: MemoryProposal): string | undefined {
  if (proposal.proposedType !== "storyCard" || proposal.storyCardType !== "relationship") {
    if (proposal.targetId && proposal.proposedType === "storyCard" && adventure.storyCards.some(card => card.id === proposal.targetId && card.type === "relationship")) return "Relationship destinations require explicit linked participants.";
    return proposal.relationship ? "Only Relationship Card proposals may link participants." : undefined;
  }
  if (proposal.cardOperation === "append" && !proposal.targetId) return "The relationship append destination is missing.";
  if (proposal.storyCardPatch || proposal.componentPatch) return "Relationship history updates must use a factual delta.";
  const links = proposal.relationship?.characterIds;
  const error = validateRelationshipIds(adventure.storyCards, links);
  if (error || !links) return error;
  const matches = relationshipMatches(adventure.storyCards, links);
  if (matches.length > 1) return "Multiple Relationship Cards link this exact set of characters.";
  if (proposal.targetId && matches[0]?.id !== proposal.targetId) return "The relationship destination no longer matches the linked characters.";
}

export function linkedRelationships(cards: readonly StoryCard[], characterId: string): StoryCard[] {
  return cards.filter(card => card.type === "relationship" && Array.isArray(card.relationship?.characterIds)
    && card.relationship.characterIds.includes(characterId));
}

export function relationshipWriteError(cards: readonly StoryCard[], previous: StoryCard | undefined, next: StoryCard): string | undefined {
  if (previous?.type === "relationship" && previous.id !== next.id) return "Relationship Card IDs cannot be changed.";
  if (previous && (previous.type === "relationship") !== (next.type === "relationship")) {
    return "Create a new card to change the Relationship Card type.";
  }
  if (previous?.type === "character" && (next.type !== "character" || previous.id !== next.id) && linkedRelationships(cards, previous.id).length) {
    return "Remove this character from its linked Relationship Cards first.";
  }
  return relationshipCardError(cards, next);
}
