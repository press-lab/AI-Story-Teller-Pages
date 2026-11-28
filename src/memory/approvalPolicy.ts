import { eligibleArc } from "./currentArc";
import type { Adventure, MemoryAutoApproveSettings, MemoryProposal } from "../types/adventure";
import { cardMatchesName } from "../state/defaults";

export type ApprovalCategory = keyof MemoryAutoApproveSettings;

export function storyCardApprovalCategory(type: string | undefined): ApprovalCategory | undefined {
  switch (type) {
    case "character": return "otherStoryCard";
    case "lore": return "loreStoryCard";
    case "relationship": return "relationshipStoryCard";
    case "location": case "object": case "plot": case "custom": return "otherStoryCard";
    default: return undefined;
  }
}

/** Resolve the same destination used by application, including the missing-Brain fallback. */
export function getApprovalCategory(adventure: Adventure, proposal: MemoryProposal): ApprovalCategory | undefined {
  if (proposal.proposedType === "storyCard") {
    if (proposal.storyCardType === "lore" && proposal.lore?.autonomous?.origin === "autonomous") return "autonomousLoreStoryCard";
    if (proposal.storyCardType === "relationship") return "relationshipStoryCard";
    const target = adventure.storyCards.find(card => card.id === proposal.targetId)
      ?? adventure.storyCards.find(card => card.type !== "relationship" && cardMatchesName(card, proposal.title));
    return storyCardApprovalCategory(target ? target.type : proposal.storyCardType);
  }
  if (proposal.proposedType === "brainUpdate") {
    const brain = adventure.brains.find(b => b.id === proposal.targetId)
      ?? adventure.brains.find(b => b.characterName === proposal.title);
    if (brain) return "brainUpdate";
    const card = adventure.storyCards.find(c => c.type !== "relationship" && cardMatchesName(c, proposal.title));
    return storyCardApprovalCategory(card ? card.type : "character");
  }
  switch (proposal.proposedType) {
    case "currentArcStateUpdate": return proposal.targetId && eligibleArc(adventure)?.state.id === proposal.targetId ? "currentArcStateUpdate" : undefined;
    case "plotEssentialsUpdate": return "plotEssentialsUpdate";
    default: return undefined;
  }
}

export function shouldAutoApprove(adventure: Adventure, proposal: MemoryProposal): boolean {
  if (proposal.manualDraft || (proposal.userInitiated && proposal.storyCardType === "relationship") || proposal.proposedType === "componentDraft") return false;
  const category = getApprovalCategory(adventure, proposal);
  return category !== undefined && adventure.memoryAutoApprove?.[category] === true;
}
