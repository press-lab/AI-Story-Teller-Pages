import type { Adventure, MemoryProposal } from "../types/adventure";

/** Deliberately narrow paraphrase normalization. Never stem event verbs, remove
 * negation, sort actors, or use a general similarity threshold. */
export function factKey(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/^\s*[•*-]?\s*\[[^\]]+\]\s*/, "")
    .replace(/\b(?:agreed to|said yes to) (?:the |an? )?invitation\b/g, "accepted invitation")
    .replace(/\b(?:agreed to|said yes to) ((?:[\p{L}]+['’]s )?(?:research |dinner )?invitation)\b/gu, "accepted $1")
    .replace(/\baccepted (?:the |an? )invitation\b/g, "accepted invitation")
    .replace(/\b(?:agreed to collaborate|agreed to work together)\b/g, "agreed collaboration")
    .replace(/\b(?:attempted to kiss|tried to kiss)\b/g, "attempted kiss")
    .replace(/\b(?:notebook|research notebook)\b/g, "notebook")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}
export function facts(content: string): string[] {
  return content.split(/\n+/).map(factKey).filter(Boolean);
}
export function factsCovered(content: string, existing: string[]): boolean {
  const incoming = facts(content), known = new Set(existing.flatMap(facts));
  return incoming.length > 0 && incoming.every(fact => known.has(fact));
}
export function hasFactOverlap(content: string, previous: string): boolean {
  const known = new Set(facts(previous));
  return facts(content).some(f => known.has(f));
}
export function proposalFacts(p: MemoryProposal): string {
  return p.content; // newFact can summarize; the reviewed complete draft controls coverage.
}
function related(p: MemoryProposal, q: MemoryProposal): boolean {
  if (p.proposedType !== q.proposedType || p.storyCardType !== q.storyCardType) return false;
  if (p.targetId && q.targetId) return p.targetId === q.targetId;
  return factKey(p.title) === factKey(q.title)
    || Boolean(p.sourceTurnId === q.sourceTurnId && p.sourceText === q.sourceText
      && p.storyCardReview?.participants.length && q.storyCardReview?.participants.length
      && p.storyCardReview.participants.every(name => q.storyCardReview!.participants.includes(name)));
}
/** Pending/dismissed coverage suppresses suggestions only, never establishes canon. */
export function proposalCoverage(a: Adventure, p: MemoryProposal, includeProposals = true): boolean {
  if (p.proposedType !== "storyCard" || p.storyCardPatch || p.componentPatch) return false;
  const cards = a.storyCards.filter(c => c.id === p.targetId || (!p.targetId && c.type === p.storyCardType && factKey(c.title) === factKey(p.title)));
  const proposals = includeProposals ? a.activeState.memoryProposals.filter(q => q.id !== p.id && related(p, q)) : [];
  return factsCovered(p.content, [...cards.map(c => c.content), ...proposals.map(proposalFacts)]);
}
/** Newest-first input: apply the limit after relevance, never take the oldest tail. */
export function relevantProposalCoverage(a: Adventure, excerpt: string, targetIds: string[] = [], sourceIds: string[] = []) {
  const words = new Set(factKey(excerpt).split(" ").filter(w => w.length > 3));
  return a.activeState.memoryProposals.filter(p => p.proposedType === "storyCard" && (
    Boolean(p.targetId && targetIds.includes(p.targetId)) || sourceIds.includes(p.sourceTurnId)
    || p.storyCardReview?.participants.some(name => factKey(excerpt).includes(factKey(name)))
    || facts(p.title + " " + p.content + " " + p.suggestedTriggers.join(" ")).some(f => f.split(" ").filter(w => words.has(w)).length >= 2)
  )).slice(0, 12).map(p => ({ id: p.id, targetId: p.targetId, title: p.title, status: p.status,
    proposedFacts: p.content.slice(0, 1600), newFact: p.placementValidation?.newFact,
    participants: p.storyCardReview?.participants, sourceIds: p.placementValidation?.sources.map(s => s.id) ?? [p.sourceTurnId] }));
}
