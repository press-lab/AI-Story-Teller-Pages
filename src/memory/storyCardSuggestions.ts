import type { Adventure, MemoryProposal, Message, StoryCard, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { isExceptionalIdentityChange, isHistoricalLore } from "./storyCardArchitecture";
import { readStoryTime } from "./storyTime";

export const STORY_CARD_MEMORY_CHECK = `STORY CARD MEMORY CHECK
Review the completed entry and player input. Did anything NEW and MEANINGFUL happen worth remembering? Ignore routine activity, movement, temporary feelings and repeated facts.
Use kind=lore for events/changes (first meetings, dates, kisses, proposals, commitments, betrayals, discoveries, decisions, deaths, permanent changes). Prefer an existing relevant Lore title; otherwise use a specific new title. Use kind=newCard and cardType=character|location for an important missing identity, or kind=card for an exceptional permanent identity change. Custom is explicit reference material.
Each needs target (existing exact title or specific new subject), content (the NEW fact only, max 70 words), evidence (exact source quote), reason, and 1-3 specific triggers for new cards. Optional targetId, participants and subject help matching. Multiple meaningful suggestions are allowed within the shared four-update limit. All Story Card changes await review. Do not regenerate cards or erase earlier events.
Plans are not completed actions; almost/conditional events are unconfirmed. Preserve private knowledge. Use established story time; never invent a precise historical date. Code attaches source IDs and dates.
Never suggest Plot Essentials, Current Arc, Active Pressure or any Plot Component update. Return suggestions or an empty updates array.
END STORY CARD MEMORY CHECK`;

export const normalizeMemoryText = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const stop = new Set("the a an and but then now later today tomorrow yesterday i you he she they we it his her their our my your yes no january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ministry current story date flashback candidate first possible political ordinary dinner breakfast lunch evening morning night meanwhile suddenly after before nearby fuck silver".split(" "));
const titleWords = (text: string) => new Set((normalizeMemoryText(text).split(" ")).filter(word => word.length > 3 && !stop.has(word)));
const mentions = (text: string, phrase: string) => Boolean(phrase.trim()) && (` ${normalizeMemoryText(text)} `).includes(` ${normalizeMemoryText(phrase)} `);

export function namedSubjects(text: string): string[] {
  return [...new Set([...text.matchAll(/\b\p{Lu}[\p{L}'’]*(?:[ -](?:(?:of|the) )?\p{Lu}[\p{L}'’]*){0,3}/gu)]
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
  { kind: "firstMeeting", label: "First meeting", topic: "relationship", pattern: /\b(first (?:meeting|met)|met .{0,60}for the first time|meets?\s+\p{Lu}[\p{L}]+|introduc(?:es|ed) (?:herself|himself|themselves))\b/u },
  { kind: "firstDate", label: "First date", topic: "relationship", pattern: /\bfirst date\b/i },
  { kind: "kiss", label: "Kiss", topic: "relationship", pattern: /\b(kiss(?:es|ed|ing)?|first kiss)\b/i },
  { kind: "proposal", label: "Proposal", topic: "relationship", pattern: /\b(propos(?:es|ed|al)|asks? .{0,45}to marry|will you marry)\b/i },
  { kind: "engagement", label: "Engagement", topic: "relationship", pattern: /\b(engaged|accepts? .{0,30}proposal|accepted .{0,30}proposal|says? yes to .{0,30}proposal)\b/i },
  { kind: "marriage", label: "Marriage", topic: "relationship", pattern: /\b(marr(?:ies|ied)|wedding|wed)\b/i },
  { kind: "breakup", label: "Breakup", topic: "relationship", pattern: /\b(broke up|breaks? up|ended their relationship|divorc(?:ed|es))\b/i },
  { kind: "reconciliation", label: "Reconciliation", topic: "relationship", pattern: /\b(reconcil(?:ed|es|iation)|got back together)\b/i },
  { kind: "promise", label: "Commitment", topic: "commitment", pattern: /\b(promis(?:e|es|ed)|sw(?:ears?|ore) .{0,40}(?:oath|loyalty)|vow(?:ed|s)?|oath|commits? to)\b/i },
  { kind: "betrayal", label: "Betrayal", topic: "conflict", pattern: /\b(betray(?:s|ed|al))\b/i },
  { kind: "death", label: "Death", topic: "identity", pattern: /\b(dies|died|is dead|was killed|kills?|killed)\b/i },
  { kind: "discovery", label: "Discovery", topic: "discovery", pattern: /\b(discover(?:s|ed|y)|reveal(?:s|ed))\b/i },
  { kind: "transformation", label: "Permanent change", topic: "identity", pattern: /\b(permanent(?:ly)? (?:transform|los|gain)|destroyed|relocated)\w*\b/i },
  { kind: "victory", label: "Major outcome", topic: "conflict", pattern: /\b(major victory|major defeat|defeat(?:s|ed) .{0,30}(?:army|lord|government)|overthrow(?:s|n)? .{0,30}government)\b/i },
];
const uncertainty = /\b(almost|nearly|might|may|could|would|if|pretend|dream(?:s|ed)?|hopes? to|intends? to|plans? to|wants? to|will|tomorrow|rumou?rs?|claims?|reportedly|going to)\b/i;
export function findingKind(text: string): string | undefined {
  if (/\baccept(?:s|ed)? .{0,30}proposal\b/i.test(text)) return "engagement";
  if (/\b(?:propos(?:es|ed)|plans?) .{0,45}(?:overthrow|government|coup)\b/i.test(text)) return "politicalPlan";
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
  const observed = readStoryTime(story, adventure.storyClock);
  const time = source?.storyTime ?? observed.time ?? (!source && !observed.flashback ? adventure.storyClock?.current : undefined);
  const type = finding.type ?? "lore";
  const participants = finding.participants ?? participantsIn(adventure, finding.evidence);
  const choices = storyCardTargets(adventure, { ...finding, participants, type });
  const target = choices.length === 1 ? adventure.storyCards.find(card => card.id === choices[0]) : undefined;
  const now = nowIso();
  const uncertain = finding.candidateOnly || uncertainty.test(finding.evidence);
  const content = uncertain && !/^Candidate|^Plan \(/.test(finding.content) ? `Candidate interpretation (unconfirmed): ${finding.content}` : finding.content;
  return {
    id: createId("proposal"), proposedType: "storyCard", storyCardType: type, title: target?.title ?? finding.title,
    content, sourceTurnId: sourceId, sourceText: finding.evidence, rationale: finding.reason,
    suggestedTriggers: finding.triggers ?? [], requiresReview: true, status: "pending", confidence: uncertain ? 0.45 : 0.8,
    targetId: target?.id, appendContent: target ? true : undefined, memoryMode: target?.memoryMode ?? (uncertain ? "living" : type === "lore" ? "historical" : "static"),
    lore: type === "lore" ? { status: uncertain ? "unresolved" : target?.lore?.status ?? "completed", sourceMessageIds: [sourceId, ...(player ? [player.id] : [])], ...(time ? { occurredAt: time, lastChangedAt: time } : {}) } : undefined,
    storyCardReview: { origin: finding.origin ?? "model", candidateOnly: Boolean(uncertain), eventKind: finding.eventKind ?? findingKind(finding.content + " " + finding.evidence), participants,
      targetCandidates: choices, suggestedTitle: finding.title, sourceMessageId: sourceId, sourceContent: story,
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
      if (rule.kind === "kiss" && !/\b(first|finally|almost|nearly|significant)\b/i.test(sentence)) continue;
      const participants = participantsIn(adventure, sentence + " " + (player?.content ?? ""));
      const uncertain = uncertainty.test(sentence);
      const label = uncertain ? "Possible " + rule.label.toLowerCase() : rule.label;
      const title = `${participants.slice(0, 2).join(" and ") || "Story"}: ${label}`;
      proposals.push(makeStoryCardSuggestion(adventure, source.id, source.content, {
        title, content: uncertain ? `Candidate interpretation (unconfirmed): ${sentence}` : sentence, evidence: sentence,
        reason: "Local milestone pattern; review the exact source before accepting.", type: "lore", participants,
        triggers: [rule.label + " " + participants.slice(0, 2).join(" ")], candidateOnly: uncertain, eventKind: findingKind(sentence) ?? rule.kind, origin: "deterministic",
      }));
      if (!uncertain && (rule.kind === "death" || rule.kind === "transformation")) {
        for (const identity of adventure.storyCards.filter(card => (card.type === "character" || card.type === "location") && [card.title, ...card.keys].some(name => mentions(sentence, name)))) {
          // A killer is not necessarily the victim; nominate status only with subject-specific evidence.
          const name = identity.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const identityStatus = new RegExp(`\\b(?:${name}\\s+(?:is dead|dies|died|is killed|was killed|was destroyed|is destroyed|permanently)|(?:kills?|killed)\\s+${name})\\b`, "i");
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
    .map(name => ({ name, occurrences: recent.filter(message => mentions(message.content, name)), rank: recent.reduce((score, message, index) => score + (mentions(message.content, name) ? 1 + (index + 1) / Math.max(1, recent.length) : 0), 0) }))
    .filter(candidate => candidate.occurrences.length >= 2 || /\b(meets?|introduc(?:es|ed)|captain|professor|minister|commander|wizard|witch|citadel|castle|tower|academy)\b/i.test(text))
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)).slice(0, 2);
  for (const candidate of candidates) {
    const evidence = sentenceEvidence(text).find(sentence => mentions(sentence, candidate.name));
    if (!evidence) continue;
    const location = /\b(Tower|Castle|Citadel|Academy|Forest|Harbor|Manor|Ministry)\b/.test(candidate.name);
    proposals.push(makeStoryCardSuggestion(adventure, source.id, source.content, { title: candidate.name, content: `Candidate identity from observed evidence: ${evidence}`,
      evidence, reason: `${candidate.occurrences.length} recent exchanges mention this uncovered subject. No identity traits have been inferred.`,
      type: location ? "location" : "character", triggers: [candidate.name], candidateOnly: true, origin: "deterministic" }));
  }
  return proposals.slice(0, 8);
}

/** Merge the two detectors by source + event meaning, not just shared participants. */
export function equivalentStoryCardSuggestions(a: MemoryProposal, b: MemoryProposal): boolean {
  if (a.proposedType !== "storyCard" || b.proposedType !== "storyCard" || (a.storyCardType ?? "lore") !== (b.storyCardType ?? "lore")) return false;
  const ar = a.storyCardReview, br = b.storyCardReview;
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
    storyCardReview: chosen.storyCardReview ? { ...chosen.storyCardReview, origin: "both" } : undefined,
    requiresReview: true };
}
