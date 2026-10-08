import type { Adventure, MemoryProposal } from "../types/adventure";

/** Missing structured output is review evidence, never an invented memory mutation. */
export function suggestionList(adventure: Adventure): MemoryProposal[] {
  const issues: MemoryProposal[] = (adventure.worldEvolutionState?.issues ?? [])
    .filter(issue => issue.status !== "recovered")
    .map(issue => ({
      id: `world-review:${issue.id}`, worldIssueId: issue.id,
      proposedType: "ignore", title: "Review unrecorded developments",
      content: issue.droppedRecords?.length
        ? issue.droppedRecords.map(candidate => JSON.stringify(candidate.record, null, 2)).join("\n\n")
        : "No validated memory update was extracted. Review the source narration before drafting any changes.",
      sourceTurnId: issue.sourceTurnId,
      sourceText: adventure.messages.find(message => message.id === issue.sourceTurnId)?.content ?? "Source narration is no longer available.",
      rationale: `${issue.reason} Approval marks this evidence reviewed; it does not apply an unvalidated memory change.`,
      confidence: 0, suggestedTriggers: [], requiresReview: true,
      status: issue.status === "unrecorded" ? "pending" : issue.reviewStatus ?? "approved",
      createdAt: adventure.messages.find(message => message.id === issue.sourceTurnId)?.createdAt ?? adventure.createdAt,
      updatedAt: adventure.updatedAt,
    }));
  return [...adventure.activeState.memoryProposals, ...issues];
}

export function pendingSuggestionCount(adventure: Adventure | undefined): number {
  return adventure ? suggestionList(adventure).filter(proposal => proposal.status === "pending").length : 0;
}
