import { shouldAutoApprove } from "./approvalPolicy";
import type { Adventure, MemoryProposal } from "../types/adventure";
import { storyCardMustBeReviewed, suggestionSourceValid } from "./storyCardSuggestions";
import { placementValidationError } from "./storyCardPlacement";
import { validateLoreChronology, loreDateConfirmed } from "./validateLoreChronology";

/** Current, local eligibility only. Existing review flags require explicit author action. */
export function storyCardAutoApprovalBlockers(adventure: Adventure, proposal: MemoryProposal): string[] {
  const blockers: string[] = [];
  if (!shouldAutoApprove(adventure, proposal)) blockers.push("Story Card auto-approval is disabled.");
  if (storyCardMustBeReviewed(adventure, proposal)) {
    if (proposal.requiresReview) blockers.push("This proposal was previously marked for manual review." + (proposal.rationale ? " " + proposal.rationale : ""));
    if (proposal.storyCardReview?.candidateOnly) blockers.push("This suggestion is uncertain and requires review.");
    if (adventure.storyCards.some(card => card.id === proposal.targetId && card.protected)) blockers.push("The existing Story Card is protected.");
    if (!proposal.targetId && (proposal.storyCardReview?.targetCandidates.length ?? 0) > 1) blockers.push("This proposal requires an explicit destination.");
  }
  if (!suggestionSourceValid(adventure, proposal)) blockers.push("Source evidence is stale or invalid, or the destination changed.");
  const placementError = placementValidationError(adventure, proposal);
  if (placementError) blockers.push(placementError);
  if (validateLoreChronology(adventure, proposal).status === "conflict" && !loreDateConfirmed(adventure, proposal)) blockers.push("The proposed event date conflicts with its source.");
  return blockers;
}
