import { validateLoreChronology } from "./validateLoreChronology";
import { loreAppendDayError } from "./datedLoreRouting";
import { shouldAutoApprove } from "./approvalPolicy";
import type { Adventure, MemoryProposal } from "../types/adventure";
import { storyCardMustBeReviewed, suggestionSourceValid } from "./storyCardSuggestions";
import { placementValidationError } from "./storyCardPlacement";

/** Current, local eligibility only. Existing review flags require explicit author action. */
export function storyCardAutoApprovalBlockers(adventure: Adventure, proposal: MemoryProposal): string[] {
  const blockers: string[] = [];
  if (!shouldAutoApprove(adventure, proposal)) blockers.push(proposal.lore?.autonomous ? "Autonomous Lore auto-approval is disabled." : "Story Card auto-approval is disabled.");
  if (storyCardMustBeReviewed(adventure, proposal)) {
    if (proposal.requiresReview) blockers.push("This proposal was previously marked for manual review." + (proposal.rationale ? " " + proposal.rationale : ""));
  }
  if (!suggestionSourceValid(adventure, proposal)) blockers.push("Source evidence is stale or invalid, or the destination changed.");
  const placementError = placementValidationError(adventure, proposal);
  if (placementError) blockers.push(placementError);
  if (proposal.lore?.autonomous) {
    const chronology = validateLoreChronology(adventure, proposal);
    if (chronology.status === "conflict") blockers.push(chronology.reason);
  }
  const dayError = loreAppendDayError(adventure, proposal);
  if (dayError) blockers.push(dayError);
  return blockers;
}
