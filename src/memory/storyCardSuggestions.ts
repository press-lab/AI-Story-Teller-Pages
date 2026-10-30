import { factsCovered, loreFactsCovered, loreTitleKey, loreOccurrenceDate } from "./factCoverage";
import type { Adventure, MemoryProposal, Message, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { isHistoricalLore } from "./storyCardArchitecture";
import { resolveLoreEventDate } from "./validateLoreChronology";
import { memoryTargetMatches } from "./memoryCycleState";
import { storyCardEntityCandidates, characterParticipants } from "./storyCardEntities";
import { storyMemoryMessages } from "./memoryEvidenceWindow";
import { generatedStoryCardTriggers } from "./resolveMemoryTarget";

export const SHARED_STORY_MEMORY_POLICY = `STORY CARD MEMORY CHECK
Find NEW MEANINGFUL durable developments, judging context, not keywords. Include significant first romantic advances, explicit attempted kisses, mutual first kisses, accepted/declined invitations, confessions, boundaries, commitments, betrayals, discoveries, deaths and permanent changes.
Separate completed interactions from intended outcomes: an accepted invitation happened before dinner; a declined kiss attempt happened without a kiss. Research dinner need not be romantic. Significant flirtation with a lean-in/lean-back may warrant review describing observations and uncertainty, NEVER a confirmed kiss attempt. Ordinary smiles, leaning to read, jokes, movement and meals alone do not qualify. Attempts require review; uncertain interpretations remain unresolved. Never infer consent or relationship status.
Default to Lore for events and shared developments; append existing topical Lore or create focused Lore. Character updates require an evidenced enduring profile change beyond scene participation. Brains hold supported private changes. Preserve private knowledge and source quotes. Never invent outcomes or duplicate memories.
END STORY CARD MEMORY CHECK`;

/** Eligibility policy only. Each caller supplies its own array, object or envelope contract. */
export const STORY_CARD_MEMORY_CHECK = `${SHARED_STORY_MEMORY_POLICY}\nUncertain Story Card candidates require candidateOnly=true,eventStatus=unresolved. Never suggest Plot Component updates.`;

export const STORY_CARD_OUTPUT_SCHEMA = `Story Card fields: kind=lore (events/changes), newCard (missing subject), card (existing subject); cardType=lore|character|location|custom; operation=CREATE|APPEND; target=title; targetId=existing ID for UPDATE; content=new fact, max70 words; evidence=exact quote; reason; triggers=3-6 short reusable topic phrases covering the card's subjects, activities and concepts (for example "runic research", "ward design", "government reform"). Use ordinary future wording, not exact scene sentences or only the full title; never leave triggers empty. Avoid unrelated catch-all words and bare participant names on Lore. Optional participants. Return only new factual deltas; never a replacement body. Shared maximum: four updates.`;

export const normalizeMemoryText = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const stop = new Set("the a an and but then now later today tomorrow yesterday i you he she they we it his her their our my your yes no january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ministry current story date flashback candidate first possible political ordinary dinner breakfast lunch evening morning night meanwhile suddenly after before nearby fuck silver".split(" "));
const titleWords = (text: string) => new Set((normalizeMemoryText(text).split(" ")).filter(word => word.length > 3 && !stop.has(word)));
const mentions = (text: string, phrase: string) => Boolean(phrase.trim()) && (` ${normalizeMemoryText(text)} `).includes(` ${normalizeMemoryText(phrase)} `);

type Inventory = Array<{ id: string; title: string; type: StoryCardType; keys: string[] }>;
// Only the current card collection is retained, with at most sixteen excerpts.
// The exact signature also handles callers that edit fixture/import objects in place.
let inventoryCards: WeakRef<Adventure["storyCards"]> | undefined;
let inventoryAdventureId: string | undefined;
let inventorySignature = "";
const inventories = new Map<string, Inventory>();
export function relevantStoryCardInventory(adventure: Adventure, text: string): Inventory {
  const signature = JSON.stringify(adventure.storyCards.map(c => [c.id, c.title, c.keys, c.priority, c.type]));
  if (inventoryCards?.deref() !== adventure.storyCards || inventoryAdventureId !== adventure.id || inventorySignature !== signature) {
    inventories.clear();
    inventoryCards = new WeakRef(adventure.storyCards);
    inventoryAdventureId = adventure.id;
    inventorySignature = signature;
  }
  const cached = inventories.get(text);
  if (cached) return cached.map(c => ({ ...c, keys: [...c.keys] }));
  const normalized = normalizeMemoryText(text);
  const padded = ` ${normalized} `;
  const words = new Set(normalized.split(" ").filter(word => word.length > 3 && !stop.has(word)));
  const result = adventure.storyCards.map(card => ({ card,
    score: [card.title, ...card.keys].filter(name => Boolean(name.trim()) && padded.includes(` ${normalizeMemoryText(name)} `)).length * 10
      + [...titleWords(card.title + " " + card.keys.join(" "))].filter(word => words.has(word)).length,
  })).filter(entry => entry.score >= 2).sort((a, b) => b.score - a.score || b.card.priority - a.card.priority).slice(0, 8)
    .map(({ card }) => ({ id: card.id, title: card.title.slice(0, 100), type: card.type, keys: card.keys.slice(0, 3) }));
  if (text.length <= 1_000_000) {
    while (inventories.size >= 16 || [...inventories.keys()].reduce((n, key) => n + key.length, 0) + text.length > 1_000_000) {
      inventories.delete(inventories.keys().next().value!);
    }
    inventories.set(text, result);
  }
  return result.map(c => ({ ...c, keys: [...c.keys] }));
}
const uncertainty = /\b(almost|nearly|might|may|could|would|if|not|never|no|pretend(?:s|ed)?|imagin(?:es|ed|ing)|dream(?:s|ed)?|threaten(?:s|ed)? to|considers?|hopes? to|intends? to|plans? to|wants? to|will|tomorrow|rumou?rs?|claims?|reportedly|going to)\b/i;

// Broad subject cues remain useful for routing/merging findings supplied by the model.
// They classify an existing finding; the deterministic scanner never nominates from them.
const subjectPatterns = [
  { kind: "firstMeeting", topic: "relationship", pattern: /\b(first (?:meeting|met)|(?:meet|met) .{0,60}for the first time|meets?\s+\p{Lu}[\p{L}]+|introduc(?:es|ed) (?:herself|himself|themselves))\b/u },
  { kind: "firstDate", topic: "relationship", pattern: /\bfirst date\b/i },
  { kind: "kiss", topic: "relationship", pattern: /\b(kiss(?:es|ed|ing)?|first kiss)\b/i },
  { kind: "proposal", topic: "relationship", pattern: /\b(propos(?:es|ed|al)|asks? .{0,45}to marry|will you marry)\b/i },
  { kind: "engagement", topic: "relationship", pattern: /\bengaged\b/i },
  { kind: "marriage", topic: "relationship", pattern: /\b(marr(?:ies|ied)|wedding|wed)\b/i },
  { kind: "breakup", topic: "relationship", pattern: /\b(broke up|breaks? up|ended their relationship|divorc(?:ed|es))\b/i },
  { kind: "reconciliation", topic: "relationship", pattern: /\b(reconcil(?:ed|es|iation)|got back together)\b/i },
  { kind: "agreement", topic: "commitment", pattern: /\b(?:agrees? to|agreed to|(?:form(?:s|ed)?|establish(?:es|ed)?) .{0,35}alliance|alliance is established)\b/i },
  { kind: "decision", topic: "commitment", pattern: /\b(?:decid(?:es|ed) to|(?:considers?|considered|intends? to|plans? to) .{0,35}(?:overthrow\w*|coup|rebel\w*))\b/i },
  { kind: "promise", topic: "commitment", pattern: /\b(promis(?:e|es|ed)|sw(?:ears?|ore) .{0,40}(?:oath|loyalty)|vow(?:ed|s)?|oath|commits? to)\b/i },
  { kind: "betrayal", topic: "conflict", pattern: /\b(betray(?:s|ed|al))\b/i },
  { kind: "death", topic: "identity", pattern: /\b(dies|died|is dead|was killed|kills?|killed)\b/i },
  { kind: "discovery", topic: "discovery", pattern: /\b(discover(?:s|ed|y)|reveal(?:s|ed))\b/i },
  { kind: "transformation", topic: "identity", pattern: /\b(permanent(?:ly)? (?:transform|los|gain)|destroyed|relocated)\w*\b/i },
  { kind: "victory", topic: "conflict", pattern: /\b(major victory|major defeat|defeat(?:s|ed) .{0,30}(?:army|lord|government)|overthrow(?:s|n)? .{0,30}government)\b/i },
];

export function findingKind(text: string): string | undefined {
  if (/\baccept(?:s|ed)? .{0,30}proposal\b/i.test(text)) return "engagement";
  if (/\b(?:propos(?:es|ed)|plans?|considers?|intends? to) .{0,45}(?:overthrow|government|coup)\b/i.test(text)) return "politicalPlan";
  return subjectPatterns.find(rule => rule.pattern.test(text))?.kind;
}

function sourcePlayer(adventure: Adventure, sourceId: string): Message | undefined {
  const index = adventure.messages.findIndex(message => message.id === sourceId);
  const prior = index < 0 ? adventure.messages.at(-1) : adventure.messages[index - 1];
  return prior?.role === "user" && prior.inputMode !== "comms" ? prior : undefined;
}

export function suggestionSourceValid(adventure: Adventure, proposal: MemoryProposal): boolean {
  if (proposal.evaluationSource) {
    if (proposal.evaluationSource.messages.some(source => !adventure.messages.some(message => message.id === source.id && message.content === source.content))) return false;
    if (proposal.status !== "approved" && proposal.evaluationSource.target && !memoryTargetMatches(adventure, proposal.evaluationSource.target)) return false;
  }
  const review = proposal.storyCardReview;
  if (!review) return true; // explicit user-authored/manual proposals retain their existing path
  const source = adventure.messages.find(message => message.id === review.sourceMessageId);
  if (!source || source.content !== review.sourceContent) return false;
  if (review.additionalSources?.some(source => !adventure.messages.some(message => message.id === source.id && message.content === source.content))) return false;
  return !review.playerMessageId || adventure.messages.some(message => message.id === review.playerMessageId && message.content === review.playerContent);
}

/** Automatic Lore placement requires identity of subject, not a ranked similarity winner.
 * Aliases must exactly name the proposed topic and contain a non-person topical term. */
export function safeLoreAppendTarget(adventure: Adventure, finding: { title: string }): string | undefined {
  const subject = normalizeMemoryText(finding.title);
  const lore = adventure.storyCards.filter(c => c.type === "lore");
  const exact = lore.filter(c => normalizeMemoryText(c.title) === subject);
  if (exact.length) return exact.length === 1 ? exact[0].id : undefined;
  const people = new Set(adventure.storyCards.filter(c => c.type === "character")
    .flatMap(c => [c.title, ...c.keys]).flatMap(name => normalizeMemoryText(name).split(" ")));
  const broad = new Set("relationship relationships romance bond public private exposure business event development history news update together".split(" "));
  const terms = [...titleWords(subject)].filter(word => !people.has(word) && !broad.has(word));
  if (subject.split(" ").length < 2 || !terms.length) return undefined;
  const aliases = lore.filter(c => c.keys.some(alias => normalizeMemoryText(alias) === subject));
  return aliases.length === 1 ? aliases[0].id : undefined;
}

/** A bounded local search. Participants alone never establish a shared continuing subject. */
export function storyCardTargets(adventure: Adventure, finding: { title: string; content: string; participants?: string[]; targetId?: string; type?: StoryCardType }): string[] {
  const explicit = finding.targetId ? adventure.storyCards.find(card => card.id === finding.targetId) : undefined;
  if (explicit && (!finding.type || explicit.type === finding.type)) return [explicit.id];
  const exact = adventure.storyCards.filter(card => normalizeMemoryText(card.title) === normalizeMemoryText(finding.title) && (!finding.type || card.type === finding.type));
  if (exact.length) return exact.map(card => card.id);
  const text = finding.title + " " + finding.content;
  const rule = subjectPatterns.find(rule => rule.pattern.test(text));
  const topic = findingKind(text) === "politicalPlan" ? "conflict" : rule?.topic;
  const participants = characterParticipants(adventure.storyCards, text, finding.participants);
  const identityTerms = new Set(participants.flatMap(name => normalizeMemoryText(name).split(" ")));
  const terms = new Set([...titleWords(text)].filter(word => !identityTerms.has(word)));
  const ranked = adventure.storyCards.map(card => {
    if (card.type === "character" || card.type === "location") {
      return { card, score: finding.type === card.type && (finding.targetId === card.id || normalizeMemoryText(finding.title) === normalizeMemoryText(card.title)) ? 200 : 0 };
    }
    if (finding.targetId === card.id || normalizeMemoryText(finding.title) === normalizeMemoryText(card.title)) return { card, score: 200 };
    const specificCue = card.keys.some(key => !participants.some(name => normalizeMemoryText(name) === normalizeMemoryText(key)) && mentions(text, key));
    const overlap = [...titleWords(card.title + " " + card.keys.join(" "))].filter(word => terms.has(word)).length;
    const sharedPeople = participants.filter(name => [card.title, card.content, ...card.keys].some(value => mentions(value, name))).length;
    const relationship = topic === "relationship" && /\b(relationship|bond|romance|courtship|engagement|marriage)\b/i.test(card.title);
    const conflict = (topic === "conflict" || topic === "commitment") && /\b(coalition|government|conflict|alliance|agreement|pact|promise|commitment)\b/i.test(card.title) && overlap >= 1;
    return { card, score: specificCue ? 120 : overlap >= 2 ? 80 + overlap : ((sharedPeople >= 2 && relationship) || (sharedPeople >= 1 && conflict)) ? 70 : 0 };
  }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || b.card.priority - a.card.priority || a.card.id.localeCompare(b.card.id));
  if (!ranked.length) return [];
  return ranked.filter(entry => entry.score >= ranked[0].score - 5).slice(0, 4).map(entry => entry.card.id);
}

export function makeStoryCardSuggestion(adventure: Adventure, sourceId: string, story: string, finding: {
  title: string; content: string; evidence: string; reason: string; type?: StoryCardType; targetId?: string;
  triggers?: string[]; participants?: string[]; candidateOnly?: boolean; evidenceReviewed?: boolean; eventKind?: string; origin?: "model" | "deterministic";
}): MemoryProposal {
  const player = sourcePlayer(adventure, sourceId);
  const source = adventure.messages.find(message => message.id === sourceId);
  const time = resolveLoreEventDate(adventure, { sourceTurnId: sourceId, storyCardReview: { sourceContent: story } }, source);
  const type = finding.type ?? "lore";
  const participants = characterParticipants(adventure.storyCards, finding.evidence, finding.participants);
  const choices = storyCardTargets(adventure, { ...finding, participants, type });
  const target = choices.length === 1 ? adventure.storyCards.find(card => card.id === choices[0]) : undefined;
  const now = nowIso();
  // Entity nominations always await review; model interpretations retain their uncertainty policy.
  const uncertain = finding.origin === "deterministic" || finding.evidenceReviewed ? false : uncertainty.test(finding.evidence);
  const candidateOnly = Boolean(finding.candidateOnly || uncertain || finding.origin === "deterministic");
  const eventKind = finding.eventKind ?? findingKind(finding.content + " " + finding.evidence);
  const continuing = ["politicalPlan", "promise", "agreement", "decision", "engagement"].includes(eventKind ?? "") || /\b(history|relationship|conflict|alliance|agreement|pact)\b/i.test(finding.title);
  const review = candidateOnly || choices.length > 1 || Boolean(target?.protected);
  const content = uncertain && !/^Candidate|^Plan \(/.test(finding.content) ? `Candidate interpretation (unconfirmed): ${finding.content}` : finding.content;
  const closedTitle = !choices.length && adventure.storyCards.some(card => isHistoricalLore(card) && normalizeMemoryText(card.title) === normalizeMemoryText(finding.title));
  const identityTitle = type === "lore" && !target && adventure.storyCards.some(c => (c.type === "character" || c.type === "location") && normalizeMemoryText(c.title) === normalizeMemoryText(finding.title));
  const suggestedTitle = closedTitle || identityTitle ? `${finding.title}: ${finding.content.slice(0, 60)}` : finding.title;
  const memoryMode = target?.memoryMode ?? (type === "lore" && !uncertain && !continuing ? "historical" : "static");
  return {
    id: createId("proposal"), proposedType: "storyCard", cardOperation: target ? "append" : "create", storyCardType: target?.type ?? type, title: target?.title ?? suggestedTitle,
    content, sourceTurnId: sourceId, sourceText: finding.evidence, rationale: finding.reason,
    suggestedTriggers: generatedStoryCardTriggers(adventure, finding.title, finding.content, finding.triggers, target?.id, memoryMode, type), requiresReview: review || closedTitle, status: "pending", confidence: candidateOnly ? 0.45 : 0.8,
    targetId: target?.id, appendContent: target ? true : undefined, memoryMode,
    lore: type === "lore" ? { status: uncertain ? "unresolved" : target?.lore?.status ?? (continuing ? "ongoing" : "completed"), sourceMessageIds: [sourceId, ...(player ? [player.id] : [])], ...(time ? { occurredAt: target?.lore?.occurredAt ?? time, lastChangedAt: time } : {}) } : undefined,
    storyCardReview: { origin: finding.origin ?? "model", candidateOnly, eventKind, participants, operation: target ? "update" : "create",
      targetCandidates: choices, suggestedTitle, sourceMessageId: sourceId, sourceContent: story,
      ...(player ? { playerMessageId: player.id, playerContent: player.content } : {}) },
    createdAt: now, updatedAt: now,
  };
}

/** Local entity nominations only. Narrative developments come from model findings. */
export function scanStoryCardExchange(adventure: Adventure, source: Message): MemoryProposal[] {
  const text = source.content.replace(/^\*\[[^\]]+\]:[^\n]*\*$/gm, "");
  const proposals: MemoryProposal[] = [];
  // Identity evidence qualifies candidates first; frequency/recency only ranks them.
  const recent = storyMemoryMessages(adventure).filter(message => message.role === "assistant").slice(-80);
  const candidates = storyCardEntityCandidates(text, recent, adventure.storyCards)
    // Suppress pending identities and recently dismissed nominations for four exchanges.
    // Model findings arrive separately and are unaffected by entity cooldowns.
    .filter(candidate => !adventure.activeState.memoryProposals.some(proposal => proposal.proposedType === "storyCard" && proposal.storyCardType !== "lore"
      && normalizeMemoryText(proposal.title) === normalizeMemoryText(candidate.name)
      && (proposal.status === "pending" || recent.slice(-4).some(message => message.id === proposal.sourceTurnId))))
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)).slice(0, 2);
  for (const candidate of candidates) {
    const proposal = makeStoryCardSuggestion(adventure, source.id, source.content, { title: candidate.name, content: `Candidate identity from observed evidence: ${candidate.evidence}`,
      evidence: candidate.evidence, reason: `${candidate.reason} ${candidate.occurrences} recent exchanges mention it; recurrence ranks qualified names only. No identity traits have been inferred.`,
      type: candidate.type, triggers: [candidate.name], candidateOnly: true, origin: "deterministic" });
    proposal.storyCardReview!.additionalSources = candidate.support.filter(message => message.id !== source.id).map(message => ({ id: message.id, content: message.content }));
    proposals.push(proposal);
  }
  return proposals.slice(0, 8);
}

/** Merge the two detectors by source + event meaning, not just shared participants. */
export function equivalentStoryCardSuggestions(a: MemoryProposal, b: MemoryProposal): boolean {
  if (a.proposedType !== "storyCard" || b.proposedType !== "storyCard" || (a.storyCardType ?? "lore") !== (b.storyCardType ?? "lore")) return false;
  if ((a.storyCardType ?? "lore") === "lore") {
    const sameSubject = a.targetId && b.targetId ? a.targetId === b.targetId : loreTitleKey(a.title) === loreTitleKey(b.title);
    const leftDate = loreOccurrenceDate(a), rightDate = loreOccurrenceDate(b);
    if (!sameSubject || (leftDate && rightDate && leftDate !== rightDate)) return false;
    return loreFactsCovered(a.content, [b.content]) && loreFactsCovered(b.content, [a.content]);
  }
  const ar = a.storyCardReview, br = b.storyCardReview;
  if (["character", "location", "custom"].includes(a.storyCardType ?? "lore") && !a.targetId && !b.targetId && normalizeMemoryText(a.title) === normalizeMemoryText(b.title)) return true;
  const exact = factsCovered(a.content, [b.content]) && factsCovered(b.content, [a.content]);
  if (exact && (normalizeMemoryText(a.title) === normalizeMemoryText(b.title) || Boolean(a.targetId && a.targetId === b.targetId) || Boolean(ar?.eventKind && ar.eventKind === br?.eventKind && ar.participants.length && ar.participants.every(name => br.participants.includes(name))))) return true;
  if (!ar || !br || ar.sourceMessageId !== br.sourceMessageId) return false;
  const people = ar.participants.length > 0 && ar.participants.length === br.participants.length && ar.participants.every(name => br.participants.includes(name));
  const leftEvidence = normalizeMemoryText(a.sourceText), rightEvidence = normalizeMemoryText(b.sourceText);
  const sameEvidence = Math.min(leftEvidence.length, rightEvidence.length) >= 12 && (leftEvidence.includes(rightEvidence) || rightEvidence.includes(leftEvidence));
  if (ar.eventKind && br.eventKind && ar.eventKind !== br.eventKind) return false;
  // Shared participants/evidence never suffice to merge different developments.
  // Use the same conservative fact comparison as generation and application.
  return Boolean((sameEvidence || people) && factsCovered(a.content, [b.content]) && factsCovered(b.content, [a.content]));
}

export function mergeStoryCardSuggestions(existing: MemoryProposal, incoming: MemoryProposal): MemoryProposal {
  const preferModel = incoming.storyCardReview?.origin === "model" && !incoming.storyCardReview.candidateOnly;
  const chosen = preferModel ? incoming : existing;
  // A merge is not a fresh review of the older evidence. Keep unresolved restrictions.
  // Once both drafts have been independently cleared, no restriction is carried forward.
  const candidateOnly = Boolean(existing.storyCardReview?.candidateOnly || incoming.storyCardReview?.candidateOnly);
  return { ...chosen, id: existing.id, status: existing.status, createdAt: existing.createdAt,
    sourceText: chosen.placementValidation ? chosen.sourceText : [...new Set([existing.sourceText, incoming.sourceText])].join("\n"),
    storyCardReview: chosen.storyCardReview ? { ...chosen.storyCardReview, candidateOnly,
      evidenceQuotes: [existing.storyCardReview, incoming.storyCardReview].flatMap(review => review?.evidenceQuotes ?? [])
        .filter((quote, index, all) => all.findIndex(other => other.messageId === quote.messageId && other.quote === quote.quote) === index),
      additionalSources: [existing.storyCardReview, incoming.storyCardReview].flatMap(review => review ? [
        ...(review.sourceMessageId !== chosen.storyCardReview!.sourceMessageId ? [{ id: review.sourceMessageId, content: review.sourceContent }] : []),
        ...(review.additionalSources ?? []),
      ] : []).filter((source, index, all) => all.findIndex(other => other.id === source.id && other.content === source.content) === index),
      origin: existing.storyCardReview?.origin === incoming.storyCardReview?.origin ? chosen.storyCardReview.origin : "both" } : undefined,
    requiresReview: Boolean(existing.requiresReview || incoming.requiresReview || candidateOnly),
    rationale: [...new Set([existing.rationale, incoming.rationale])].join(" ") };
}

/** A processed-source marker, invalidated by either side of the exchange changing. */
export function storyCardScanFingerprint(adventure: Adventure, source: Message): string {
  const text = "v2\0" + source.content + "\0" + (sourcePlayer(adventure, source.id)?.content ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16) + ":" + text.length;
}

export function storyCardMustBeReviewed(adventure: Adventure, proposal: MemoryProposal): boolean {
  const target = adventure.storyCards.find(card => card.id === proposal.targetId);
  return Boolean(proposal.requiresReview || proposal.storyCardReview?.candidateOnly || (!proposal.targetId && (proposal.storyCardReview?.targetCandidates.length ?? 0) > 1)
    || target?.protected);
}
