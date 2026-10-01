import type { Adventure, AdventureAction, MemoryProposal, StoryCard, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { cardMatchesName } from "../state/defaults";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import { isFirstPersonRecallTrigger } from "./storyCardPolicy";
import { canonicalStateLabel, hasLabeledStoryState, MAX_OPEN_THREADS, normalizeStoryState, openThreads, STORY_STATE_LIST_LABELS, STORY_STATE_MAX_WORDS, storyStateLineValue, storyStateWordCount, tryStoryStateLine } from "./storyStateLines";

/**
 * Shared memory-update contract for the background memory pass.
 *
 * History: this file used to hold the "one-pass" design, where the narrator appended a hidden
 * <memory_updates> JSON envelope to every story reply. In play that instruction sat at the top of
 * the narrator prompt, broke prompt caching every turn, and flash-tier models skipped the envelope
 * most of the time. The narrator now only narrates. The same update kinds and validation are used by
 * one background call every N turns (see compactMemoryFallback.ts). `parseOnePassMemory` remains so a
 * stray envelope can never leak into the visible story.
 */

/** Output-token ceiling for the background memory pass. */
export const MEMORY_OUTPUT_RESERVE = 2000;
/** Fewer, complete updates beat a long list cut off by the output ceiling. */
export const MEMORY_PASS_MAX_UPDATES = 8;

export const STORY_STATE_WORD_LIMIT = STORY_STATE_MAX_WORDS;
const STATE_LINE_WORD_LIMIT = 60;
const EVENT_WORD_LIMIT = 90;
const KNOWLEDGE_WORD_LIMIT = 140;
const THOUGHT_WORD_LIMIT = 60;
/** Thoughts are optional colour; they must not crowd out state, knowledge, and corrections. */
const MAX_THOUGHTS_PER_PASS = 2;

/** Fixed rules for the background memory pass. Kept free of per-turn data so providers can cache it. */
export function memoryPassRules(categories: string[], options: { events?: boolean } = {}): string {
  return `[BACKGROUND MEMORY PASS]
The story turns below are already written. Your job is bookkeeping: keep the story's memory current and SHORT so the narrator never forgets or contradicts what happened. Return ONLY a JSON object {"updates":[...]}. An empty array is valid when nothing changed. Maximum ${MEMORY_PASS_MAX_UPDATES} updates; return fewer complete updates rather than many long ones. Every update must stay within its word limit; longer updates are discarded.
Each update has: kind, target, content, evidence, reason, claim. evidence is an EXACT quote copied from the RECENT TURNS or from an AUTHOR CORRECTION that establishes the change. reason says why it matters later. claim is one of "fact" (the story established it), "belief" (a character thinks or suspects it), "intention" (someone plans, offers, or proposes it), or "correction" (an author correction requires it).
Never record a suggestion, offer, possibility, or plan as an accomplished fact: keep conditional wording ("offered the spare room if he wants it" is not "moved in"). A belief must read as a belief ("the captain suspects the duke"), never as proof. Dialogue can lie and attempts can fail: record what the text establishes, not what a character claims. Never give a character knowledge they did not receive.
Keep the meaning, not just the label: when a relationship, promise, debt, or trust changes, include the cause in one clause. Routine movement and small talk are not memory.
AUTHOR CORRECTIONS, when shown, are the author's out-of-character instructions and override the canon and the story text. If a correction rejects something (a character, event, revelation, or mechanic), remove it from every place it appears: "retract" it from cards, "remove" it from Open threads, and rewrite affected knowledge. A correction that is only a question or discussion changes nothing.
PENDING drafts, when shown, are unapproved suggestions from earlier passes: they are not evidence and not canon. Do not repeat them.

Work in this order and stop when the remaining changes are minor:
1. Corrections: "retract" or rewrite whatever an AUTHOR CORRECTION rejects.
2. Story State, using these kinds:
- "stateLine": a targeted change to ONE labeled line. target is the label: "Day/Time", "Location", "Relationships", "Arrangements", "Has met", or "Open threads". op is "set" (content is the new value of a non-list line, max ${STATE_LINE_WORD_LIMIT} words), or, for "Has met" and "Open threads", "add" (content is ONE new item, max ${STATE_LINE_WORD_LIMIT} words) or "remove" (content is the thread id such as "t3", or the item copied from the line). FIRST remove every open thread the recent turns finished, made impossible, or that a correction rejected; only then add new ones. Open threads holds at most ${MAX_OPEN_THREADS} live, unresolved situations: never completed actions, past dialogue, or plans already carried out.
- "state": target is the EXACT title of the Story State component. Use when Story State is EMPTY, mostly stale, or flagged as OVER THE LIMIT. content is its COMPLETE replacement (max ${STORY_STATE_WORD_LIMIT} words, at most ${MAX_OPEN_THREADS} open threads), in present tense, using these labeled lines:
    Day/Time: current day of week, date if known, and time of day.
    Location: where the player character is now and with whom.
    Relationships: the current status of each important relationship, stated plainly, with its cause in one clause.
    Arrangements: living and sleeping arrangements and other standing routines.
    Has met: one bullet per character the player character has met in person, a few words each.
    Open threads: one bullet per live, unresolved situation.
  Keep what is still true, update what changed, drop what is over. Completed events belong in the Chronicle, not in Story State.
3. "knows": target is an eligible character name. content is the COMPLETE replacement of that character's knowledge boundary (max ${KNOWLEDGE_WORD_LIMIT} words) as two lines: "Knows: …" and "Does not know: …". When the recent turns show the character WITNESSED or was TOLD something listed under "Does not know", move it to "Knows". Only characters who were present or were told; never assume a whole household shares knowledge. Keep "Does not know" to consequential secrets.
4. "pressure": target is the EXACT title of the Active Pressure component; content is its full replacement, ONE sentence (max 45 words) naming the external threat or obligation pressing on the player, or stating that it is resolved. Only when it materially changed or resolved.
5. "arc": target is the EXACT title of the Current Arc; content is one concise completed development (max 45 words) relevant to its premise, appended to its log. Never change the premise or pacing. Only while the arc is in its BREAK phase, add "resolved": true when the recent turns show its central conflict actually concluded (the confrontation ended and its outcome is settled), not merely that the climax began; the player reviews it before the arc moves on.
6. Story Cards:
- "card": target is the EXACT title of an existing Story Card shown in the canon. content is ONE new durable fact (max 70 words). If the new fact makes an existing fact on a LIVING card untrue, also set "replaces" to that old fact copied exactly from the card. On a static card, "replaces" is allowed only when an AUTHOR CORRECTION requires it. Never touch a VOICE CONTRACT. Omit already-known facts and rephrasings.
- "retract": target is the EXACT title of an existing Story Card; content is the false fact copied EXACTLY from that card (one sentence or line). Use it when an AUTHOR CORRECTION or the story rejects that fact. evidence must quote the correction or story text that rejects it.
- "newCard": target is a genuinely new recurring subject's name, content max 90 words. Also provide cardType (character, location, lore, custom, plot), memoryMode (static or living), triggers (1-3 narrow phrases that will literally appear in future story text, such as a name or a distinctive noun; never first-person recall phrases like "the night I…" or "when she…"), and category from: ${categories.join(", ") || "NONE (no new cards allowed)"}. At most ONE per pass. Never create cards for a conversation, invitation, room movement, routine choice, temporary mood, or an event recap. A plot card requires a lasting obligation, alliance, betrayal, secret, or irreversible change; it will require review.
- "essentials": target is the EXACT title of Plot Essentials; content is its full replacement (max 180 words). Only when the overarching premise or long-term conflict fundamentally changed. Always reviewed.
${options.events ? `- "event": a COMPLETED turning point worth remembering for the rest of the story: a revelation, a costly choice, a promise made or broken, a first meeting that matters, or the origin of a recurring personal symbol. Ordinary pleasant conversations, routine scenes, and anything still in progress do NOT qualify; most passes have none. target is a short distinctive title (max 8 words). content (max ${EVENT_WORD_LIMIT} words) states what happened, what caused it, and what it changed. Also provide eventKind ("first", "commitment", "revelation", "choice", or "sharedExperience"), participants (1-4 character names who were there), and recallCues (2-3 concrete phrases likely to appear when this memory matters later, such as an object or place; not "remember when"). At most ONE per pass; it always waits for review.
` : ""}7. Optional, only if room remains: "thought": target is an eligible character name. content is ONE new first-person private reaction, belief, or plan (max ${THOUGHT_WORD_LIMIT} words) after a significant moment for that character. At most ${MAX_THOUGHTS_PER_PASS} per pass. Never repeat an existing thought.

Story State holds what is true NOW. Story Cards hold durable facts about recurring subjects. Brains hold private thoughts and knowledge boundaries. Only output changes supported by the recent turns or an author correction and consistent with the canon.`;
}
/** A broken/truncated tail must never leak JSON into the story or discard good prose. */
export function parseOnePassMemory(text: string): { story: string; updates: unknown[]; error?: string } {
  const start = text.search(/<memory_(?:updates\b|[a-z]*$)/i);
  if (start < 0) return { story: text, updates: [], error: "Memory envelope missing; story preserved." };
  const story = text.slice(0, start).trimEnd();
  const tail = text.slice(start);
  const match = /^<memory_updates\s*>([\s\S]*?)<\/memory_updates>\s*$/i.exec(tail);
  if (!match || match[1].length > 16000) return { story, updates: [], error: "Incomplete or oversized memory envelope; story preserved." };
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || !("updates" in parsed) || !Array.isArray(parsed.updates) || parsed.updates.length > 4) throw new Error();
    return { story, updates: parsed.updates };
  } catch {
    return { story, updates: [], error: "Invalid memory JSON; story preserved." };
  }
}

const norm = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const WORD_LIMITS: Record<string, number> = {
  essentials: 180,
  newCard: 90,
  card: 70,
  retract: 70,
  thought: THOUGHT_WORD_LIMIT,
  knows: KNOWLEDGE_WORD_LIMIT,
  state: STORY_STATE_WORD_LIMIT,
  stateLine: STATE_LINE_WORD_LIMIT,
  event: EVENT_WORD_LIMIT,
};

export interface MemoryPassScope {
  /** Ids of Story Cards / components / brains the pass was shown; only these may be targeted. */
  visibleIds: Set<string>;
  /** Brain character names eligible for thought / knowledge updates this pass. */
  eligibleThoughtTargets: string[];
  /** The pass may suggest one Event Memory (Settings → Automatic memory). */
  allowEvents?: boolean;
}

const EVENT_KINDS = ["first", "commitment", "revelation", "choice", "sharedExperience"] as const;
const GENERIC_EVENT_CUES = new Set(["remember when", "how we met", "first meeting", "first time", "our promise", "shared experience", "that night", "that day"]);

/**
 * Supersede one fact on a card: the line (or, inside a paragraph, the sentence) matching `replaces`
 * is swapped for `content`. An empty `content` retracts the fact. Returns undefined when the old fact
 * cannot be found or sits inside a VOICE CONTRACT block.
 */
export function supersedeCardFact(card: Pick<StoryCard, "content">, replaces: string, content: string): string | undefined {
  const target = norm(replaces);
  if (target.length < 8) return undefined;
  const lines = card.content.split("\n");
  const voiceStart = lines.findIndex(line => /voice contract/i.test(line));
  const index = lines.findIndex(line => {
    const candidate = norm(line);
    return candidate.length > 0 && (candidate === target || candidate.includes(target));
  });
  if (index < 0 || (voiceStart >= 0 && index >= voiceStart)) return undefined;
  const replacement = content.trim().replace(/^\s*(?:[-*•]|\d+\.)\s+/, "");
  const bullet = /^(\s*(?:[-*•]|\d+\.)\s+)/.exec(lines[index])?.[1] ?? "";
  const body = lines[index].slice(bullet.length);
  const next = [...lines];
  if (norm(body) === target) {
    next[index] = replacement ? bullet + replacement : "";
  } else {
    // The fact is part of a longer paragraph: change only the sentences that carry it.
    const sentences = body.split(/(?<=[.!?])\s+/);
    const hits = sentences.map(sentence => norm(sentence)).map(sentence => sentence.length > 0 && (sentence.includes(target) || (sentence.length >= 8 && target.includes(sentence))));
    if (!hits.some(Boolean)) {
      next[index] = replacement ? bullet + replacement : "";
    } else {
      const first = hits.indexOf(true);
      const kept = sentences.flatMap((sentence, i) => !hits[i] ? [sentence] : i === first && replacement ? [replacement] : []);
      next[index] = kept.length ? bullet + kept.join(" ") : "";
    }
  }
  return next.filter((line, i) => line !== "" || lines[i] === "").join("\n");
}

/**
 * Validates background-pass updates and turns them into reducer actions / Memory Inbox proposals.
 * Local structural and evidence checks, not a claim that a quote proves every inference.
 */
export function memoryUpdateActions(
  adventure: Adventure,
  scope: MemoryPassScope,
  updates: unknown[],
  evidenceTexts: Array<string | { id: string; content: string }>,
  sourceTurnId: string,
  sourceLabel: string,
  error?: string,
): AdventureAction[] {
  const actions: AdventureAction[] = [];
  const errors = error ? [error] : [];
  const executed: string[] = [];
  const evidence = evidenceTexts
    .map(entry => typeof entry === "string" ? { id: undefined, text: norm(entry) } : { id: entry.id, text: norm(entry.content) })
    .filter(entry => entry.text);
  const evidenceSources = evidence.map(entry => entry.text);
  const evidenceText = evidenceSources.join(" ");
  if (updates.length > MEMORY_PASS_MAX_UPDATES) errors.push(`Memory pass returned ${updates.length} updates; only the first ${MEMORY_PASS_MAX_UPDATES} were considered.`);
  const seen = new Set<string>();
  let newCards = 0;
  let events = 0;
  let thoughts = 0;
  for (const raw of updates.slice(0, MEMORY_PASS_MAX_UPDATES)) {
    const reject = (reason: string) => errors.push(`Memory pass skipped: ${reason}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reject("invalid update"); continue; }
    const u = raw as Record<string, unknown>;
    if (![u.kind, u.target, u.content, u.evidence].every(v => typeof v === "string" && v.trim())) { reject("missing fields"); continue; }
    const kind = u.kind as string, target = (u.target as string).trim(), content = (u.content as string).trim(), quoted = (u.evidence as string).trim();
    const reason = typeof u.reason === "string" ? u.reason.trim() : "";
    const claim = u.claim === "fact" || u.claim === "belief" || u.claim === "intention" || u.claim === "correction" ? u.claim : undefined;
    const quote = norm(quoted);
    // Link the update to the latest message that actually contains the quote, so edits and regeneration can find it.
    const source = quote.length >= 12 ? [...evidence].reverse().find(entry => entry.text.includes(quote)) : undefined;
    if (!source) { reject(`${target}: evidence is not in the recent turns`); continue; }
    const limit = WORD_LIMITS[kind] ?? 45;
    if (words(content) > limit) { reject(`${target}: ${kind} content is ${words(content)} words, over its ${limit}-word limit`); continue; }
    // Evidence quoted from an author correction (not story text) authorizes corrective edits.
    const fromCorrection = Boolean(source.id?.startsWith("correction:"));
    if (content.includes("<") || content.length > 4000 || target.length > 150 || reason.length > 600) { reject(`${target}: invalid content`); continue; }
    // List edits to one Story State line are distinct updates; everything else allows one update per target.
    const listOp = kind === "stateLine" && (u.op === "add" || u.op === "remove") ? `:${u.op}:${norm(content)}` : "";
    const key = `${kind}:${norm(target)}${listOp}`;
    if (seen.has(key)) { reject(`${target}: repeated target`); continue; }
    seen.add(key);
    const timestamp = nowIso();
    const proposal: MemoryProposal = {
      id: createId("proposal"), sourceTurnId: source.id ?? sourceTurnId, sourceText: quoted, proposedType: "storyCard", title: target,
      content, suggestedTriggers: [], confidence: 0.75, rationale: `Memory pass${claim ? ` (${claim})` : ""}: ${reason || kind}`,
      status: "pending", createdAt: timestamp, updatedAt: timestamp,
      ...(claim ? { claim } : {}),
    };

    if (kind === "thought" || kind === "knows") {
      const brains = adventure.brains.filter(b => b.active && b.characterName === target);
      const brain = brains.length === 1 ? brains[0] : undefined;
      if (!brain || !scope.eligibleThoughtTargets.includes(target)) { reject(`${target}: brain not eligible`); continue; }
      const names = [brain.characterName, ...brain.triggers].map(norm).filter(name => name.length >= 2);
      if (!names.some(name => evidenceText.includes(name))) { reject(`${target}: character absent from the recent turns`); continue; }
      if (kind === "knows") {
        if (!/\bknows\s*:/i.test(content)) { reject(`${target}: knowledge must use Knows / Does not know lines`); continue; }
        if (norm(brain.knowledge ?? "") === norm(content)) continue;
        // A replacement: carried as a proposal with its base so a newer edit is never silently overwritten.
        // The reducer auto-approves it under the Brain auto-approve setting when the base is still current.
        actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: {
          ...proposal, proposedType: "brainUpdate", title: brain.characterName, targetId: brain.id,
          content: JSON.stringify({ knowledge: content }), baseContent: brain.knowledge ?? "",
        } });
        executed.push(`Knowledge: ${target}`);
        continue;
      }
      if (++thoughts > MAX_THOUGHTS_PER_PASS) { reject(`${target}: more than ${MAX_THOUGHTS_PER_PASS} thoughts in one pass`); continue; }
      if (brain.lastUpdatedTurn !== undefined && adventure.activeState.turn - brain.lastUpdatedTurn < (brain.autoUpdateCooldownTurns ?? 0)) { reject(`${target}: brain on cooldown`); continue; }
      if (Object.values({ ...brain.archivedThoughts, ...brain.thoughts }).some(t => norm(t).includes(norm(content)))) continue;
      const patch = { thoughts: { [`${adventure.activeState.turn}_${sourceTurnId}`]: `${adventure.activeState.turn} → ${content}` } };
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "append", turn: adventure.activeState.turn, preview: content }]);
      if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions);
      else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
      executed.push(`Thought: ${target}`);
      continue;
    }

    if (kind === "stateLine") {
      const label = canonicalStateLabel(target);
      const component = adventure.components.find(c => c.type === "storyState" && c.active && c.autoUpdate !== false);
      if (!label) { reject(`${target}: unknown Story State line`); continue; }
      if (!component) { reject(`${target}: Story State not available`); continue; }
      if (!hasLabeledStoryState(component.content)) { reject(`${target}: Story State has no labeled lines; a full state update is needed`); continue; }
      const op = u.op === "add" || u.op === "remove" ? u.op : "set";
      if (op !== "set" && !STORY_STATE_LIST_LABELS.has(label)) { reject(`${target}: only Has met and Open threads take add/remove`); continue; }
      if (op === "set" && STORY_STATE_LIST_LABELS.has(label)) { reject(`${target}: list lines change one item at a time with add/remove, or through a full state update`); continue; }
      const current = storyStateLineValue(component.content, label);
      const result = tryStoryStateLine(component.content, { label, op }, content);
      if ("error" in result) { reject(`${target}: ${result.error}`); continue; }
      const applied = result.content;
      if (applied === component.content || (op === "set" && current !== undefined && norm(current) === norm(content))) continue;
      // A line edit may never grow an over-long block; shrinking edits (removals) are always welcome.
      const resultWords = storyStateWordCount(applied);
      if (resultWords > STORY_STATE_MAX_WORDS && resultWords > storyStateWordCount(component.content)) {
        reject(`${target}: Story State would be ${resultWords} words (limit ${STORY_STATE_MAX_WORDS}); consolidate with a full state update`); continue;
      }
      proposal.proposedType = "storyStateUpdate";
      proposal.targetId = component.id;
      proposal.title = `${component.title} · ${label}`;
      proposal.stateLine = { label, op };
      if (op === "set") proposal.baseContent = current ?? "";
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      executed.push(`Story State · ${label} (${op})`);
      continue;
    }

    if (kind === "event") {
      if (!scope.allowEvents || ++events > 1) { reject(`${target}: event not allowed in this pass`); continue; }
      const eventKind = EVENT_KINDS.find(k => k === u.eventKind);
      const participants = Array.isArray(u.participants) ? u.participants.filter((p): p is string => typeof p === "string" && p.trim().length >= 2 && p.length <= 80).map(p => p.trim()) : [];
      const cues = Array.isArray(u.recallCues) ? u.recallCues.filter((c): c is string => typeof c === "string" && c.trim().length >= 3 && c.length <= 80).map(c => c.trim()) : [];
      const recallCues = cues.filter(c => !GENERIC_EVENT_CUES.has(norm(c)) && !isFirstPersonRecallTrigger(c)).slice(0, 3);
      if (!eventKind) { reject(`${target}: event needs an eventKind`); continue; }
      if (!participants.length || participants.length > 4 || participants.some(p => !evidenceText.includes(norm(p)))) { reject(`${target}: event participants must appear in the recent turns`); continue; }
      if (!recallCues.length) { reject(`${target}: event needs concrete recall cues`); continue; }
      proposal.storyCardType = "event";
      proposal.memoryMode = "historical";
      proposal.suggestedTriggers = recallCues;
      proposal.requiresReview = true;
      proposal.eventMemory = { kind: eventKind, participants, recallCues, sourceMessageIds: source.id ? [source.id] : [] };
      proposal.rationale += " Event Memory: always reviewed.";
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      executed.push(`Proposed event: ${target}`);
      continue;
    }

    if (kind === "state") {
      const component = adventure.components.find(c => c.type === "storyState" && c.active && c.autoUpdate !== false && c.title === target);
      if (!component) { reject(`${target}: Story State not available`); continue; }
      if (norm(component.content) === norm(content)) continue;
      const threadCount = openThreads(content).length;
      if (threadCount > MAX_OPEN_THREADS) { reject(`${target}: ${threadCount} open threads (limit ${MAX_OPEN_THREADS}); keep only live, unresolved ones`); continue; }
      proposal.proposedType = "storyStateUpdate";
      proposal.targetId = component.id;
      proposal.title = component.title;
      proposal.content = normalizeStoryState(content);
      proposal.baseContent = component.content;
      // Consolidating an over-long block drops a lot of text at once: the player reviews that rewrite.
      if (storyStateWordCount(component.content) > STORY_STATE_MAX_WORDS) {
        proposal.requiresReview = true;
        proposal.rationale += ` Consolidates an over-long Story State (${storyStateWordCount(component.content)} words): review what was dropped.`;
      }
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      executed.push("Story State");
      continue;
    }

    if (kind === "retract") {
      const exact = adventure.storyCards.filter(c => c.title === target);
      const matches = exact.length ? exact : adventure.storyCards.filter(c => cardMatchesName(c, target));
      const existing = matches.length === 1 ? matches[0] : undefined;
      if (!existing || !existing.active || existing.type === "event") { reject(`${target}: no single editable card to retract from`); continue; }
      const retracted = supersedeCardFact(existing, content, "");
      if (retracted === undefined) { reject(`${target}: fact to retract is not on the card`); continue; }
      proposal.title = existing.title;
      proposal.targetId = existing.id;
      proposal.memoryMode = existing.memoryMode;
      proposal.content = retracted || "(empty)";
      proposal.appendContent = false;
      proposal.baseContent = existing.content;
      proposal.supersedes = { oldFact: content, newFact: "" };
      proposal.rationale += ` Retracts: "${content.slice(0, 200)}"`;
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      executed.push(`Retract: ${existing.title}`);
      continue;
    }

    if (kind === "card" || kind === "newCard") {
      const exact = adventure.storyCards.filter(c => c.title === target);
      const matches = exact.length ? exact : adventure.storyCards.filter(c => cardMatchesName(c, target));
      if (matches.length > 1) { reject(`${target}: ambiguous card target`); continue; }
      const existing = matches[0];
      if (existing) {
        if (!existing.active || !scope.visibleIds.has(existing.id) || existing.type === "event" || existing.memoryMode === "historical") { reject(`${target}: target not editable in this pass`); continue; }
        if (norm(existing.content).includes(norm(content))) continue;
        proposal.title = existing.title;
        proposal.targetId = existing.id;
        proposal.memoryMode = existing.memoryMode;
        const replaces = typeof u.replaces === "string" ? u.replaces.trim() : "";
        if (replaces) {
          if (existing.memoryMode !== "living" && !fromCorrection) { reject(`${target}: only living cards can supersede facts (static cards: only when an author correction requires it)`); continue; }
          const superseded = supersedeCardFact(existing, replaces, content);
          if (!superseded) { reject(`${target}: replaced fact not found on the card`); continue; }
          proposal.content = superseded;
          proposal.appendContent = false;
          proposal.baseContent = existing.content;
          proposal.supersedes = { oldFact: replaces, newFact: content };
          proposal.rationale += ` Supersedes: "${replaces.slice(0, 200)}"`;
        } else {
          proposal.appendContent = true;
        }
      } else {
        const allowedTypes: StoryCardType[] = ["character", "location", "lore", "custom", "plot"];
        const category = typeof u.category === "string" ? u.category : "";
        if (kind !== "newCard" || ++newCards > 1 || !allowedTypes.includes(u.cardType as StoryCardType) || !adventure.systemTriggers?.enabled || !adventure.systemTriggers.categories[category as keyof typeof adventure.systemTriggers.categories]) { reject(`${target}: new card not allowed`); continue; }
        if (!Array.isArray(u.triggers) || !u.triggers.length || u.triggers.length > 3 || u.triggers.some(t => typeof t !== "string" || t.trim().length < 3 || t.length > 80)) { reject(`${target}: invalid triggers`); continue; }
        const triggers = (u.triggers as string[]).map(t => t.trim()).filter(t => !isFirstPersonRecallTrigger(t));
        if (!triggers.length) { reject(`${target}: triggers must be names or nouns that appear in story text`); continue; }
        proposal.storyCardType = u.cardType as StoryCardType;
        proposal.memoryMode = u.memoryMode === "living" ? "living" : "static";
        proposal.suggestedTriggers = triggers;
      }
    } else if (kind === "essentials" || kind === "pressure" || kind === "arc") {
      const type = kind === "essentials" ? "plotEssentials" : kind === "arc" ? "currentArc" : "activePressure";
      const named = adventure.components.filter(c => c.active && c.type === type && c.title === target);
      if (named.length === 1 && named[0].autoUpdate === false) { reject(`${target}: AI updates are switched off for this block (disabled by you)`); continue; }
      const components = named.filter(c => c.autoUpdate !== false && scope.visibleIds.has(c.id));
      const component = components.length === 1 ? components[0] : undefined;
      if (!component) { reject(`${target}: component not in this pass`); continue; }
      if (norm(component.content) === norm(content)) continue;
      const resolvesArc = kind === "arc" && u.resolved === true && component.arcState?.phase === "break";
      if (kind === "arc" && (!component.arcPremise?.trim() || (!resolvesArc && norm(component.content).includes(norm(content))))) continue;
      if (kind === "pressure" && /\n|[.!?]\s+\p{Lu}/u.test(content)) { reject(`${target}: pressure must be one sentence`); continue; }
      proposal.proposedType = kind === "essentials" ? "plotEssentialsUpdate" : kind === "arc" ? "currentArcUpdate" : "plotPressureUpdate";
      proposal.targetId = component.id;
      proposal.appendContent = kind === "arc";
      if (kind !== "arc") proposal.baseContent = component.content;
      proposal.requiresReview = kind === "essentials" || resolvesArc;
      if (kind === "essentials") proposal.rationale += " Foundational story change: review required.";
      if (resolvesArc) {
        // Elapsed turns never resolve an arc; this evidence-backed suggestion does, once the player approves it.
        proposal.resolvesArc = true;
        proposal.rationale += " Suggests the arc's climax has resolved: approving moves the arc to aftermath.";
      }
    } else { reject(`${target}: unsupported memory kind`); continue; }
    if (proposal.requiresReview && kind !== "essentials" && !proposal.resolvesArc) proposal.rationale += " Consequential memory change: review required.";
    actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
    executed.push(`Proposed ${kind}: ${target}`);
  }
  actions.push({ type: "LOG_EVALUATION_RESULT", entry: {
    id: createId("eval"), turn: adventure.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
    conditionsFired: [], actionsExecuted: [sourceLabel, ...executed], generatedContent: [], errors,
  } });
  return actions;
}
