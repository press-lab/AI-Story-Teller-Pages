import type { MemoryProposal, StoryCard } from "../types/adventure";
import type { GoldenMemoryCase } from "./semanticGoldenCases";
import type { CompactMemoryFallbackResult } from "./compactMemoryFallback";

/** Post-inference rubric only. Phrase matching is deliberately visible and is not
 * a semantic judge; review the emitted proposals before signing off model quality. */
export function scoreMemoryCase(test: GoldenMemoryCase, result: CompactMemoryFallbackResult, proposals: MemoryProposal[], canon: StoryCard[] = []) {
  const modelProposals = proposals.filter(proposal => proposal.storyCardReview?.origin !== "deterministic");
  const raw = (result.evaluatedTurns ?? []).flatMap(turn => turn.updates).filter((update): update is Record<string, unknown> => Boolean(update && typeof update === "object"));
  const summaries = modelProposals.map(proposal => `${proposal.title} ${proposal.content}`.toLowerCase());
  const matched = !test.concepts || summaries.some(text => test.concepts!.every(alternatives => alternatives.some(term => text.includes(term.toLowerCase()))));
  const rawSummaries = raw.filter(update => ["card", "newCard", "lore"].includes(String(update.kind)))
    .map(update => `${update.target} ${update.content}`.toLowerCase());
  const discovered = !test.concepts || rawSummaries.some(text => test.concepts!.every(alternatives => alternatives.some(term => text.includes(term.toLowerCase()))));
  const forbiddenClaims = (test.forbidden ?? []).filter(claim => rawSummaries.some(text => text.includes(claim.toLowerCase())));
  const errors = result.actions.flatMap(action => action.type === "LOG_EVALUATION_RESULT" ? action.entry.errors : []);
  const rawCards = raw.filter(update => ["card", "newCard", "lore"].includes(String(update.kind)));
  const fingerprints = rawCards.map(update => `${update.target} ${update.content}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "));
  const canonical = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const canonRepeats = rawCards.filter(update => canon.some(card => card.type === "lore"
    && canonical(card.content).includes(canonical(String(update.content ?? ""))) && canonical(String(update.content ?? "")).length >= 20)).length;
  const duplicateProposals = fingerprints.length - new Set(fingerprints).size + canonRepeats;
  const partial = (result.processedSources?.length ?? 0) !== test.sourceIds.length;
  const acceptance = test.acceptance ? {
    singleLore: !test.acceptance.singleLore || (modelProposals.length === 1 && modelProposals[0].storyCardType === "lore"),
    inbox: modelProposals.length > 0 && modelProposals.every(proposal => proposal.status === "pending"),
    exactTitle: !test.acceptance.title || modelProposals.some(proposal => proposal.title === test.acceptance!.title),
    separateEvidence: (test.acceptance.requiredEvidenceMessageIds ?? []).every(id =>
      modelProposals.some(proposal => proposal.storyCardReview?.evidenceQuotes?.some(item => item.messageId === id))),
    historical: !test.acceptance.historical || modelProposals.every(proposal => proposal.memoryMode === "historical"),
  } : undefined;
  const requiredEventFound = test.expectation === "must" && discovered && !forbiddenClaims.length;
  const requiredHit = test.expectation === "must" && result.valid && !partial && matched && !forbiddenClaims.length
    && (!acceptance || Object.values(acceptance).every(Boolean));
  return { id: test.id, expectation: test.expectation, review: test.review, valid: result.valid, partial,
    requiredEventFound, requiredHit, falsePositiveSuggestions: test.expectation === "empty" ? rawCards.length : 0,
    rawSuggestions: rawCards.length, acceptedSuggestions: modelProposals.length, canonRepeats,
    duplicateProposals, invalidEvidence: errors.filter(error => /evidence|quote|source reference/i.test(error)).length,
    rejectedProposals: errors.length, suppressedOrDeduplicated: Math.max(0, rawCards.length - modelProposals.length - errors.length),
    successfulEmpty: result.valid && !partial && !raw.length,
    missedByValidEmpty: test.expectation === "must" && result.valid && !partial && !raw.length,
    failure: result.error ?? (!result.valid || partial ? errors.join("; ") || "incomplete evaluation" : undefined),
    forbiddenClaims, acceptance, proposals: modelProposals, rawTurns: result.evaluatedTurns,
    errors, tokenUsage: result.tokenUsage };
}
