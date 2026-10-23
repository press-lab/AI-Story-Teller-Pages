import type { Adventure, MemoryProposal, Message, StoryCard, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { isExceptionalIdentityChange, isHistoricalLore } from "./storyCardArchitecture";
import { readStoryTime, transitionKey } from "./storyTime";

export const STORY_CARD_MEMORY_CHECK = `STORY CARD MEMORY CHECK
Did anything NEW and MEANINGFUL happen in this exchange? Remember first meetings/kisses, proposals, relationships, commitments, betrayals, discoveries, major decisions, deaths, permanent changes, or significant new people/places. Ignore routine activity, conversation, movement, temporary reactions and repeats.
For each: TYPE (Lore, Character, Location, Custom; prefer Lore); CREATE or UPDATE a relevant existing card; FACT (specific new development); WHEN (current story date unless historical); EVIDENCE (exact supporting quote).
Character/Location hold durable identity or exceptional permanent changes. Plans, threats, dreams and almost-events are not completed actions. Preserve private knowledge and past history. Never invent facts, rewrite whole cards, duplicate memories or suggest Plot Component updates. Return suggestions or an empty updates array.
END STORY CARD MEMORY CHECK`;

export const STORY_CARD_OUTPUT_SCHEMA = `Story Card fields: kind=lore (events/changes), newCard (missing identity/reference), card (permanent identity); cardType=lore|character|location|custom; operation=CREATE|UPDATE; target=title; targetId=existing ID for UPDATE; content=new fact, max70 words; evidence=exact quote; reason; triggers=1-3 narrow phrases; optional participants. Shared maximum: four updates.`;

export const normalizeMemoryText = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const stop = new Set("the a an and but then now later today tomorrow yesterday i you he she they we it his her their our my your yes no january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ministry current story date flashback candidate first possible political ordinary dinner breakfast lunch evening morning night meanwhile suddenly after before nearby fuck silver".split(" "));
const titleWords = (text: string) => new Set((normalizeMemoryText(text).split(" ")).filter(word => word.length > 3 && !stop.has(word)));
const mentions = (text: string, phrase: string) => Boolean(phrase.trim()) && (` ${normalizeMemoryText(text)} `).includes(` ${normalizeMemoryText(phrase)} `);

export function namedSubjects(text: string): string[] {
  return [...new Set([...text.matchAll(/\b\p{Lu}[\p{L}'’]*(?:[ -](?:(?:of the|of|the) )?\p{Lu}[\p{L}'’]*){0,3}/gu)]
    .map(match => match[0].replace(/^(?:The|A|An)\s+/, "").trim())
    .filter(name => name.length >= 3 && name.length < 80 && !stop.has(normalizeMemoryText(name)) && !/^(i|you|we|they|he|she|it)\b/i.test(name)))];
}

export function relevantStoryCardInventory(adventure: Adventure, text: string) {
  const words = titleWords(text);
  return adventure.storyCards.filter(card => card.active).map(card => ({ card,
    score: [card.title, ...card.keys].filter(name => mentions(text, name)).length * 10
      + [...titleWords(card.title + " " + card.keys.join(" "))].filter(word => words.has(word)).length,
  })).filter(entry => entry.score >= 2).sort((a, b) => b.score - a.score || b.card.priority - a.card.priority).slice(0, 8)
    .map(({ card }) => ({ id: card.id, title: card.title.slice(0, 100), type: card.type, keys: card.keys.slice(0, 3) }));
}

const patterns = [
  { kind: "firstMeeting", label: "First meeting", topic: "relationship", pattern: /\b(first (?:meeting|met)|(?:meet|met) .{0,60}for the first time|meets?\s+\p{Lu}[\p{L}]+|introduc(?:es|ed) (?:herself|himself|themselves))\b/u },
  { kind: "firstDate", label: "First date", topic: "relationship", pattern: /\bfirst date\b/i },
  { kind: "kiss", label: "Kiss", topic: "relationship", pattern: /\b(kiss(?:es|ed|ing)?|first kiss)\b/i },
  { kind: "proposal", label: "Proposal", topic: "relationship", pattern: /\b(propos(?:es|ed|al)|asks? .{0,45}to marry|will you marry)\b/i },
  { kind: "engagement", label: "Engagement", topic: "relationship", pattern: /\b(engaged|accepts? .{0,30}proposal|accepted .{0,30}proposal|says? yes to .{0,30}proposal)\b/i },
  { kind: "marriage", label: "Marriage", topic: "relationship", pattern: /\b(marr(?:ies|ied)|wedding|wed)\b/i },
  { kind: "breakup", label: "Breakup", topic: "relationship", pattern: /\b(broke up|breaks? up|ended their relationship|divorc(?:ed|es))\b/i },
  { kind: "reconciliation", label: "Reconciliation", topic: "relationship", pattern: /\b(reconcil(?:ed|es|iation)|got back together)\b/i },
  { kind: "agreement", label: "Agreement", topic: "commitment", pattern: /\b(?:agrees? to|agreed to|(?:form(?:s|ed)?|establish(?:es|ed)?) .{0,35}alliance|alliance is established)\b/i },
  { kind: "decision", label: "Major decision", topic: "commitment", pattern: /\b(?:decid(?:es|ed) to|(?:considers?|considered|intends? to|plans? to) .{0,35}(?:overthrow\w*|coup|rebel\w*))\b/i },
  { kind: "promise", label: "Commitment", topic: "commitment", pattern: /\b(promis(?:e|es|ed)|sw(?:ears?|ore) .{0,40}(?:oath|loyalty)|vow(?:ed|s)?|oath|commits? to)\b/i },
  { kind: "betrayal", label: "Betrayal", topic: "conflict", pattern: /\b(betray(?:s|ed|al))\b/i },
  { kind: "death", label: "Death", topic: "identity", pattern: /\b(dies|died|is dead|was killed|kills?|killed)\b/i },
  { kind: "discovery", label: "Discovery", topic: "discovery", pattern: /\b(discover(?:s|ed|y)|reveal(?:s|ed))\b/i },
  { kind: "transformation", label: "Permanent change", topic: "identity", pattern: /\b(permanent(?:ly)? (?:transform|los|gain)|destroyed|relocated)\w*\b/i },
  { kind: "victory", label: "Major outcome", topic: "conflict", pattern: /\b(major victory|major defeat|defeat(?:s|ed) .{0,30}(?:army|lord|government)|overthrow(?:s|n)? .{0,30}government)\b/i },
];
const uncertainty = /\b(almost|nearly|might|may|could|would|if|not|never|no|pretend(?:s|ed)?|imagin(?:es|ed|ing)|dream(?:s|ed)?|threaten(?:s|ed)? to|considers?|hopes? to|intends? to|plans? to|wants? to|will|tomorrow|rumou?rs?|claims?|reportedly|going to)\b/i;
export function findingKind(text: string): string | undefined {
  if (/\baccept(?:s|ed)? .{0,30}proposal\b/i.test(text)) return "engagement";
  if (/\b(?:propos(?:es|ed)|plans?|considers?|intends? to) .{0,45}(?:overthrow|government|coup)\b/i.test(text)) return "politicalPlan";
  return patterns.find(rule => rule.pattern.test(text))?.kind;
}

function sourcePlayer(adventure: Adventure, sourceId: string): Message | undefined {
  const index = adventure.messages.findIndex(message => message.id === sourceId);
  const prior = index < 0 ? adventure.messages.at(-1) : adventure.messages[index - 1];
  return prior?.role === "user" && prior.inputMode !== "comms" ? prior : undefined;
}

function participantsIn(adventure: Adventure, text: string): string[] {
  const known = adventure.storyCards.filter(card => card.type === "character" && [card.title, ...card.keys].some(name => mentions(text, name))).map(card => card.title);
  return [...new Set([...known, ...namedSubjects(text).filter(name => !/\b(Tower|Castle|Citadel|Academy|Forest|Harbor|Ministry)\b/.test(name))])].slice(0, 8);
}

export function suggestionSourceValid(adventure: Adventure, proposal: MemoryProposal): boolean {
  const review = proposal.storyCardReview;
  if (!review) return true; // explicit user-authored/manual proposals retain their existing path
  const source = adventure.messages.find(message => message.id === review.sourceMessageId);
  if (!source || source.content !== review.sourceContent) return false;
  if (review.additionalSources?.some(source => !adventure.messages.some(message => message.id === source.id && message.content === source.content))) return false;
  return !review.playerMessageId || adventure.messages.some(message => message.id === review.playerMessageId && message.content === review.playerContent);
}

/** A bounded local search. Participants alone never establish a shared continuing subject. */
export function storyCardTargets(adventure: Adventure, finding: { title: string; content: string; participants?: string[]; targetId?: string; type?: StoryCardType }): string[] {
  const text = finding.title + " " + finding.content;
  const rule = patterns.find(rule => rule.pattern.test(text));
  const topic = findingKind(text) === "politicalPlan" ? "conflict" : rule?.topic;
  const participants = finding.participants ?? participantsIn(adventure, text);
  const identityTerms = new Set(participants.flatMap(name => normalizeMemoryText(name).split(" ")));
  const terms = new Set([...titleWords(text)].filter(word => !identityTerms.has(word)));
  const ranked = adventure.storyCards.filter(card => card.active).map(card => {
    if (card.type === "character" || card.type === "location") {
      return { card, score: finding.type === card.type && isExceptionalIdentityChange(card.type, finding.content) && (finding.targetId === card.id || normalizeMemoryText(finding.title) === normalizeMemoryText(card.title)) ? 200 : 0 };
    }
    if (finding.type && finding.type !== card.type) return { card, score: 0 };
    if (isHistoricalLore(card)) return { card, score: 0 };
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
  triggers?: string[]; participants?: string[]; candidateOnly?: boolean; eventKind?: string; origin?: "model" | "deterministic";
}): MemoryProposal {
  const player = sourcePlayer(adventure, sourceId);
  const source = adventure.messages.find(message => message.id === sourceId);
  // Old imports without per-entry chronology must not reuse today's clock for a past relative skip.
  const observed = readStoryTime(story, source && !source.storyTime ? undefined : adventure.storyClock);
  const echoedTransition = !source && player?.id === adventure.storyClock?.sourceMessageId && Boolean(transitionKey(story)) && transitionKey(story) === transitionKey(player?.content ?? "");
  const time = source?.storyTime ?? (echoedTransition ? adventure.storyClock?.current : observed.time) ?? (!source && !observed.flashback ? adventure.storyClock?.current : undefined);
  const type = finding.type ?? "lore";
  const participants = finding.participants ?? participantsIn(adventure, finding.evidence);
  const choices = storyCardTargets(adventure, { ...finding, participants, type });
  const target = choices.length === 1 ? adventure.storyCards.find(card => card.id === choices[0]) : undefined;
  const now = nowIso();
  const uncertain = uncertainty.test(finding.evidence);
  const candidateOnly = Boolean(finding.candidateOnly || uncertain || finding.origin === "deterministic");
  const eventKind = finding.eventKind ?? findingKind(finding.content + " " + finding.evidence);
  const continuing = ["politicalPlan", "promise", "agreement", "decision", "engagement"].includes(eventKind ?? "") || /\b(history|relationship|conflict|alliance|agreement|pact)\b/i.test(finding.title);
  const review = candidateOnly || choices.length > 1 || Boolean(target?.protected) || Boolean(target && (target.type === "character" || target.type === "location"));
  const content = uncertain && !/^Candidate|^Plan \(/.test(finding.content) ? `Candidate interpretation (unconfirmed): ${finding.content}` : finding.content;
  const closedTitle = !choices.length && adventure.storyCards.some(card => isHistoricalLore(card) && normalizeMemoryText(card.title) === normalizeMemoryText(finding.title));
  const suggestedTitle = closedTitle ? `${finding.title}: ${finding.content.slice(0, 60)}` : finding.title;
  return {
    id: createId("proposal"), proposedType: "storyCard", storyCardType: type, title: target?.title ?? suggestedTitle,
    content, sourceTurnId: sourceId, sourceText: finding.evidence, rationale: finding.reason,
    suggestedTriggers: finding.triggers ?? [], requiresReview: review || closedTitle, status: "pending", confidence: candidateOnly ? 0.45 : 0.8,
    targetId: target?.id, appendContent: target ? true : undefined, memoryMode: target?.memoryMode ?? (uncertain || continuing ? "living" : type === "lore" ? "historical" : "static"),
    lore: type === "lore" ? { status: uncertain ? "unresolved" : target?.lore?.status ?? (continuing ? "ongoing" : "completed"), sourceMessageIds: [sourceId, ...(player ? [player.id] : [])], ...(time ? { occurredAt: time, lastChangedAt: time } : {}) } : undefined,
    storyCardReview: { origin: finding.origin ?? "model", candidateOnly, eventKind, participants, operation: target ? "update" : "create",
      targetCandidates: choices, suggestedTitle, sourceMessageId: sourceId, sourceContent: story,
      ...(player ? { playerMessageId: player.id, playerContent: player.content } : {}) },
    createdAt: now, updatedAt: now,
  };
}

export function companionLoreSuggestion(adventure: Adventure, identity: MemoryProposal): MemoryProposal | undefined {
  if (!identity.storyCardReview || (identity.storyCardType !== "character" && identity.storyCardType !== "location")) return undefined;
  if (!isExceptionalIdentityChange(identity.storyCardType, identity.content)) return undefined;
  return makeStoryCardSuggestion(adventure, identity.sourceTurnId, identity.storyCardReview.sourceContent, {
    title: `${identity.title}: ${identity.storyCardReview.eventKind ?? "Permanent change"}`, content: identity.content,
    evidence: identity.sourceText, reason: "Historical support for the proposed identity change; review separately.",
    type: "lore", participants: identity.storyCardReview.participants, eventKind: identity.storyCardReview.eventKind,
    origin: identity.storyCardReview.origin === "deterministic" ? "deterministic" : "model",
  });
}

function sentenceEvidence(text: string): string[] {
  // Preserve exact text, including punctuation, for source validation.
  return text.match(/[^\n.!?]+(?:[.!?]+|$)/gu)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
}

/** Local nomination, never automatic canon. Significant single events do not need recurrence. */
export function scanStoryCardExchange(adventure: Adventure, source: Message): MemoryProposal[] {
  const player = sourcePlayer(adventure, source.id);
  const text = source.content.replace(/^\*\[[^\]]+\]:[^\n]*\*$/gm, "");
  const proposals: MemoryProposal[] = [];
  for (const sentence of sentenceEvidence(text)) {
    for (const rule of patterns) {
      if (!rule.pattern.test(sentence)) continue;
      if (rule.kind === "proposal" && /\baccept(?:s|ed)? .{0,30}proposal\b/i.test(sentence)) continue;

      const participants = participantsIn(adventure, sentence + " " + (player?.content ?? ""));
      const uncertain = uncertainty.test(sentence);
      const label = uncertain ? "Possible " + rule.label.toLowerCase() : rule.label;
      const title = `${participants.slice(0, 2).join(" and ") || "Story"}: ${label}`;
      proposals.push(makeStoryCardSuggestion(adventure, source.id, source.content, {
        title, content: uncertain ? `Candidate interpretation (unconfirmed): ${sentence}` : sentence, evidence: sentence,
        reason: "Local milestone pattern; review the exact source before accepting.", type: "lore", participants,
        triggers: [rule.label + " " + participants.slice(0, 2).join(" ")], candidateOnly: uncertain, eventKind: rule.kind === "proposal" && findingKind(sentence) === "politicalPlan" ? "politicalPlan" : rule.kind, origin: "deterministic",
      }));
      if (!uncertain && (rule.kind === "death" || rule.kind === "transformation")) {
        for (const identity of adventure.storyCards.filter(card => (card.type === "character" || card.type === "location") && [card.title, ...card.keys].some(name => mentions(sentence, name)))) {
          // A killer is not necessarily the victim; nominate status only with subject-specific evidence.
          const names = [identity.title, ...identity.keys].filter(name => mentions(sentence, name));
          const name = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
          const identityStatus = new RegExp(`\\b(?:(?:${name})\\s+(?:is dead|dies|died|is killed|was killed|was destroyed|is destroyed|permanently)|(?:kills?|killed)\\s+(?:${name}))\\b`, "i");
          if (!identityStatus.test(sentence)) continue;
          proposals.push(makeStoryCardSuggestion(adventure, source.id, source.content, { title: identity.title, content: sentence, evidence: sentence,
            reason: "Possible permanent identity change; review alongside the historical Lore.", type: identity.type, targetId: identity.id, eventKind: rule.kind, origin: "deterministic" }));
        }
      }
    }
    if (proposals.length >= 6) break;
  }
  // Bounded frequency/recency ranking, unique exchanges, known-title/alias filtering, no stored duplicate index.
  const recent = adventure.messages.filter(message => message.role === "assistant").slice(-80);
  const candidates = namedSubjects(text).filter(name => !adventure.storyCards.some(card => [card.title, ...card.keys].some(alias => normalizeMemoryText(alias) === normalizeMemoryText(name))))
    .map(name => ({ name, evidence: sentenceEvidence(text).find(sentence => mentions(sentence, name)), occurrences: recent.filter(message => mentions(message.content, name)), rank: recent.reduce((score, message, index) => score + (mentions(message.content, name) ? 1 + (index + 1) / Math.max(1, recent.length) : 0), 0) }))
    .filter(candidate => candidate.occurrences.length >= 2 || /\b(meets?|introduc(?:es|ed)|captain|professor|minister|commander|wizard|witch|citadel|castle|tower|academy|order|guild|council|alliance|syndicate)\b/i.test(candidate.evidence ?? ""))
    // Suppress pending identities and recently dismissed nominations for four exchanges.
    // Milestones above are independent: a unique important event never waits for recurrence.
    .filter(candidate => !adventure.activeState.memoryProposals.some(proposal => proposal.proposedType === "storyCard" && proposal.storyCardType !== "lore"
      && normalizeMemoryText(proposal.title) === normalizeMemoryText(candidate.name)
      && (proposal.status === "pending" || recent.slice(-4).some(message => message.id === proposal.sourceTurnId))))
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)).slice(0, 2);
  for (const candidate of candidates) {
    const evidence = sentenceEvidence(text).find(sentence => mentions(sentence, candidate.name));
    if (!evidence) continue;
    const organization = /\b(Order|Guild|Council|Alliance|Syndicate|Company|Ministry)\b/.test(candidate.name);
    const location = !organization && /\b(Tower|Castle|Citadel|Academy|Forest|Harbor|Manor)\b/.test(candidate.name);
    proposals.push(makeStoryCardSuggestion(adventure, source.id, source.content, { title: candidate.name, content: `Candidate identity from observed evidence: ${evidence}`,
      evidence, reason: `${candidate.occurrences.length} recent exchanges mention this uncovered subject. No identity traits have been inferred.`,
      type: organization ? "custom" : location ? "location" : "character", triggers: [candidate.name], candidateOnly: true, origin: "deterministic" }));
  }
  return proposals.slice(0, 8);
}

/** Merge the two detectors by source + event meaning, not just shared participants. */
export function equivalentStoryCardSuggestions(a: MemoryProposal, b: MemoryProposal): boolean {
  if (a.proposedType !== "storyCard" || b.proposedType !== "storyCard" || (a.storyCardType ?? "lore") !== (b.storyCardType ?? "lore")) return false;
  const ar = a.storyCardReview, br = b.storyCardReview;
  if (["character", "location", "custom"].includes(a.storyCardType ?? "lore") && !a.targetId && !b.targetId && normalizeMemoryText(a.title) === normalizeMemoryText(b.title)) return true;
  const exact = normalizeMemoryText(a.content) === normalizeMemoryText(b.content);
  if (exact && (normalizeMemoryText(a.title) === normalizeMemoryText(b.title) || Boolean(a.targetId && a.targetId === b.targetId) || Boolean(ar?.eventKind && ar.eventKind === br?.eventKind && ar.participants.length && ar.participants.every(name => br.participants.includes(name))))) return true;
  if (!ar || !br || ar.sourceMessageId !== br.sourceMessageId) return false;
  const people = ar.participants.length > 0 && ar.participants.length === br.participants.length && ar.participants.every(name => br.participants.includes(name));
  const leftEvidence = normalizeMemoryText(a.sourceText), rightEvidence = normalizeMemoryText(b.sourceText);
  const sameEvidence = Math.min(leftEvidence.length, rightEvidence.length) >= 12 && (leftEvidence.includes(rightEvidence) || rightEvidence.includes(leftEvidence));
  if (ar.eventKind && br.eventKind && ar.eventKind !== br.eventKind) return false;
  const left = titleWords(a.content), right = titleWords(b.content);
  const overlap = [...left].filter(word => right.has(word)).length / Math.max(1, Math.min(left.size, right.size));
  return Boolean(sameEvidence && ((ar.eventKind && ar.eventKind === br.eventKind) || overlap >= 0.4)) || Boolean(people && ar.eventKind && ar.eventKind === br.eventKind && overlap >= 0.4);
}

export function mergeStoryCardSuggestions(existing: MemoryProposal, incoming: MemoryProposal): MemoryProposal {
  const preferModel = incoming.storyCardReview?.origin === "model" && !incoming.storyCardReview.candidateOnly;
  const chosen = preferModel ? incoming : existing;
  return { ...chosen, id: existing.id, status: existing.status, createdAt: existing.createdAt,
    sourceText: [...new Set([existing.sourceText, incoming.sourceText])].join("\n"),
    storyCardReview: chosen.storyCardReview ? { ...chosen.storyCardReview,
      additionalSources: [existing.storyCardReview, incoming.storyCardReview].flatMap(review => review ? [
        ...(review.sourceMessageId !== chosen.storyCardReview!.sourceMessageId ? [{ id: review.sourceMessageId, content: review.sourceContent }] : []),
        ...(review.additionalSources ?? []),
      ] : []).filter((source, index, all) => all.findIndex(other => other.id === source.id && other.content === source.content) === index),
      origin: existing.storyCardReview?.origin === incoming.storyCardReview?.origin ? chosen.storyCardReview.origin : "both" } : undefined,
    requiresReview: chosen.requiresReview };
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
    || target?.protected || (target && (target.type === "character" || target.type === "location")));
}
