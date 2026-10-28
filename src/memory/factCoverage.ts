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
  if ((p.storyCardType ?? "lore") === "lore") return loreNovelty(a, p, includeProposals).status === "covered";
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

export const loreTitleKey = (title: string) => factKey(title).replace(/^(?:the|an?) /, "");
/** Boundaries are individual statements, including dated bullets, not whole cards.
 * Keep semicolon clauses together: their qualifier may change the preceding claim. */
export function loreStatements(text: string): string[] {
  return text.split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\d])/u).map(s => s.trim()).filter(Boolean);
}
function loreFactKey(text: string): string {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const datedText = text.replace(/^\s*[•*-]?\s*\[([^\]]+)\]/, (whole, label: string) => /^(?:turn|source|narrator)\b/i.test(label) ? whole : label);
  const dates = datedText.toLowerCase().replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$1 $2 $3")
    .replace(new RegExp(`\\b(${months.join("|")}) (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "g"), (_, month: string, day: string, year: string) => `${year} ${String(months.indexOf(month) + 1).padStart(2, "0")} ${day.padStart(2, "0")}`);
  return factKey(dates)
    .replace(/\blearned\b/g, "learns").replace(/\blearns that\b/g, "learns")
    .replace(/\btemporary tattoos (?=last|fade)/g, "tattoos ")
    .replace(/\b(?:lasts? (?:for )?(?:only )?|fades? (?:away )?after )(?:a )?few days\b/g, "last few days")
    .replace(/\brefus(?:es|ed) to (?:take off|remove)\b/g, "refuses to remove")
    .replace(/\bpublicly wore (.+?)(?= and |$)/g, "wore $1 in public")
    .replace(/\bwore (.+?) publicly(?= and |$)/g, "wore $1 in public");
}
export function loreFactsCovered(content: string, existing: string[]): boolean {
  const incoming = loreStatements(content).map(loreFactKey);
  const known = new Set(existing.flatMap(loreStatements).map(loreFactKey));
  return incoming.length > 0 && incoming.every(f => known.has(f));
}
/** A different explicit occurrence date always survives; dates are never inferred from creation timestamps. */
export function loreOccurrenceDate(p: { lore?: MemoryProposal["lore"] }): string | undefined {
  return p.lore?.lastChangedAt?.date ?? p.lore?.occurredAt?.date;
}
export type LoreNovelty = { status: "new" | "covered" | "overlap" | "uncertain"; coveredFacts: string[]; newFacts: string[]; reason: string };
/** Subject-aware deterministic coverage. Lexical overlap can request review, NEVER delete.
 * Compressed history retains proposal content/identity, so no archive IO is needed. */
export function loreNovelty(a: Adventure, p: MemoryProposal, includeProposals = true): LoreNovelty {
  const incoming = loreStatements(p.content);
  const target = a.storyCards.find(c => c.id === p.targetId && c.type === "lore");
  const titles = new Set([p.title, ...(target ? [target.title] : [])].map(loreTitleKey));
  const date = loreOccurrenceDate(p);
  const sameOccurrence = (other: { lore?: MemoryProposal["lore"] }) => !date || !loreOccurrenceDate(other) || date === loreOccurrenceDate(other);
  const cards = a.storyCards.filter(c => c.type === "lore" && sameOccurrence(c) && (p.targetId ? c.id === p.targetId : titles.has(loreTitleKey(c.title))));
  const proposals = includeProposals ? a.activeState.memoryProposals.filter(q => q.id !== p.id && q.proposedType === "storyCard" && (q.storyCardType ?? "lore") === "lore"
    && sameOccurrence(q) && (p.targetId && q.targetId ? p.targetId === q.targetId : titles.has(loreTitleKey(q.title)))) : [];
  const known = [...cards.map(c => c.content), ...proposals.map(q => q.content)].flatMap(loreStatements).map(loreFactKey);
  const coveredFacts = incoming.filter(f => known.includes(loreFactKey(f)));
  const newFacts = incoming.filter(f => !known.includes(loreFactKey(f)));
  const uncertain = newFacts.some(f => {
    const words = loreFactKey(f).split(" ");
    return words.length >= 5 && known.some(k => {
      const other = k.split(" ");
      const common = words.filter(w => other.includes(w)).length;
      return common >= 5 && common / Math.max(words.length, other.length) >= 0.65;
    });
  });
  // A known complete claim followed by a new qualifier/consequence is partial overlap, never fully covered.
  const extendedClaim = newFacts.some(f => known.some(k => k.split(" ").length >= 6 && loreFactKey(f).startsWith(k + " ")));
  const status = incoming.length && !newFacts.length ? "covered" : coveredFacts.length || extendedClaim ? "overlap" : uncertain ? "uncertain" : "new";
  return { status, coveredFacts, newFacts, reason: status === "covered" ? "Lore facts already recorded or considered for this subject."
    : status === "overlap" ? "Part of this Lore draft is already recorded; preserve and review the remaining information."
    : status === "uncertain" ? "Possible Lore overlap within this subject; retained for review." : "New Lore information." };
}
