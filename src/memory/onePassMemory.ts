import type { Adventure, AdventureAction, MemoryProposal, StoryCard, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { cardMatchesName } from "../state/defaults";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import { isFirstPersonRecallTrigger } from "./storyCardPolicy";

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
export const MEMORY_PASS_MAX_UPDATES = 12;

export const STORY_STATE_WORD_LIMIT = 250;
const KNOWLEDGE_WORD_LIMIT = 90;
const THOUGHT_WORD_LIMIT = 60;

/** Fixed rules for the background memory pass. Kept free of per-turn data so providers can cache it. */
export function memoryPassRules(categories: string[]): string {
  return `[BACKGROUND MEMORY PASS]
The story turns below are already written. Your job is bookkeeping: keep the story's memory current so the narrator never forgets or contradicts what happened. Return ONLY a JSON object {"updates":[...]}. An empty array is valid when nothing changed. Maximum ${MEMORY_PASS_MAX_UPDATES} updates.
Each update has: kind, target, content, evidence, reason. evidence is an EXACT quote copied from the RECENT TURNS (player or story text) that establishes the change. reason says why it matters later. Never record a suggestion, possibility, or plan as an accomplished fact. Never give a character knowledge they did not receive.

Kinds, in priority order:
- "state": target is the EXACT title of the Story State component. content is its COMPLETE replacement (max ${STORY_STATE_WORD_LIMIT} words), in present tense, using these labeled lines:
    Day/Time: current day of week, date if known, and time of day.
    Location: where the player character is now and with whom.
    Relationships: the current status of each important relationship (e.g. dating, sleeping together, estranged), stated plainly.
    Arrangements: living and sleeping arrangements and other standing routines.
    Has met: characters the player character has already met in person, with one short clause each.
    Open threads: unresolved situations that are still live.
  Keep every line that is still true, update what changed, drop what is over. Return a state update whenever any line is missing, stale, or changed in the recent turns; this is the most important update.
- "thought": target is an eligible character name. content is ONE new first-person private reaction, belief, or plan from the recent turns (max ${THOUGHT_WORD_LIMIT} words). Give one to EVERY eligible character who took part in the recent turns and had something new to think. Never repeat an existing thought.
- "knows": target is an eligible character name. content is the COMPLETE replacement of that character's knowledge boundary (max ${KNOWLEDGE_WORD_LIMIT} words) as two lines: "Knows: …" and "Does not know: …". List only story-relevant facts, especially what they have NOT witnessed or been told (other people's conversations, private details, identities). Update it when the recent turns changed what the character knows.
- "card": target is the EXACT title of an existing Story Card shown in the canon. content is ONE new durable fact (max 70 words). If the new fact makes an existing fact on a LIVING card untrue, also set "replaces" to that old fact copied exactly from the card; it will be superseded instead of kept beside the new fact. Static cards only accept additions. Never touch a VOICE CONTRACT. Omit already-known facts and rephrasings.
- "newCard": target is a genuinely new recurring subject's name, content max 90 words. Also provide cardType (character, location, lore, custom, plot), memoryMode (static or living), triggers (1-3 narrow phrases that will literally appear in future story text, such as a name or a distinctive noun; never first-person recall phrases like "the night I…" or "when she…"), and category from: ${categories.join(", ") || "NONE (no new cards allowed)"}. At most ONE per pass. Never create cards for a conversation, invitation, room movement, routine choice, temporary mood, or an event recap. A plot card requires a lasting obligation, alliance, betrayal, secret, or irreversible change; it will require review.
- "pressure": target is the EXACT title of the Active Pressure component; content is its full replacement, ONE sentence (max 45 words) naming the external threat or obligation pressing on the player. Only when it materially changed or resolved.
- "arc": target is the EXACT title of the Current Arc; content is one concise completed development (max 45 words) relevant to its premise, appended to its log. Never change the premise, phase, or pacing.
- "essentials": target is the EXACT title of Plot Essentials; content is its full replacement (max 180 words). Only when the overarching premise or long-term conflict fundamentally changed. Always reviewed.

Story State holds what is true NOW. Story Cards hold durable facts about recurring subjects. Brains hold private thoughts and knowledge boundaries. Only output changes supported by the recent turns and consistent with the canon.`;
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
  thought: THOUGHT_WORD_LIMIT,
  knows: KNOWLEDGE_WORD_LIMIT,
  state: STORY_STATE_WORD_LIMIT,
};

export interface MemoryPassScope {
  /** Ids of Story Cards / components / brains the pass was shown; only these may be targeted. */
  visibleIds: Set<string>;
  /** Brain character names eligible for thought / knowledge updates this pass. */
  eligibleThoughtTargets: string[];
}

/**
 * Supersede one fact on a living card: the line matching `replaces` is swapped for `content`.
 * Returns undefined when the old fact cannot be found or sits inside a VOICE CONTRACT block.
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
  const bullet = /^(\s*(?:[-*•]|\d+\.)\s+)/.exec(lines[index])?.[1] ?? "";
  const next = [...lines];
  next[index] = bullet + content.replace(/^\s*(?:[-*•]|\d+\.)\s+/, "");
  return next.join("\n");
}

/**
 * Validates background-pass updates and turns them into reducer actions / Memory Inbox proposals.
 * Local structural and evidence checks, not a claim that a quote proves every inference.
 */
export function memoryUpdateActions(
  adventure: Adventure,
  scope: MemoryPassScope,
  updates: unknown[],
  evidenceTexts: string[],
  sourceTurnId: string,
  sourceLabel: string,
  error?: string,
): AdventureAction[] {
  const actions: AdventureAction[] = [];
  const errors = error ? [error] : [];
  const executed: string[] = [];
  const evidenceSources = evidenceTexts.map(norm).filter(Boolean);
  const evidenceText = evidenceSources.join(" ");
  const seen = new Set<string>();
  let newCards = 0;
  for (const raw of updates.slice(0, MEMORY_PASS_MAX_UPDATES)) {
    const reject = (reason: string) => errors.push(`Memory pass skipped: ${reason}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reject("invalid update"); continue; }
    const u = raw as Record<string, unknown>;
    if (![u.kind, u.target, u.content, u.evidence].every(v => typeof v === "string" && v.trim())) { reject("missing fields"); continue; }
    const kind = u.kind as string, target = (u.target as string).trim(), content = (u.content as string).trim(), evidence = (u.evidence as string).trim();
    const reason = typeof u.reason === "string" ? u.reason.trim() : "";
    const quote = norm(evidence);
    if (quote.length < 12 || !evidenceSources.some(s => s.includes(quote))) { reject(`${target}: evidence is not in the recent turns`); continue; }
    const limit = WORD_LIMITS[kind] ?? 45;
    if (words(content) > limit) { reject(`${target}: content exceeds limit`); continue; }
    if (content.includes("<") || content.length > 4000 || target.length > 150 || reason.length > 600) { reject(`${target}: invalid content`); continue; }
    const key = `${kind}:${norm(target)}`;
    if (seen.has(key)) { reject(`${target}: repeated target`); continue; }
    seen.add(key);
    const timestamp = nowIso();
    const proposal: MemoryProposal = {
      id: createId("proposal"), sourceTurnId, sourceText: evidence, proposedType: "storyCard", title: target,
      content, suggestedTriggers: [], confidence: 0.75, rationale: `Memory pass: ${reason || kind}`,
      status: "pending", createdAt: timestamp, updatedAt: timestamp,
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
        const patch = { knowledge: content };
        const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "replace", turn: adventure.activeState.turn, preview: content }]);
        if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions);
        else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
        executed.push(`Knowledge: ${target}`);
        continue;
      }
      if (brain.lastUpdatedTurn !== undefined && adventure.activeState.turn - brain.lastUpdatedTurn < (brain.autoUpdateCooldownTurns ?? 0)) { reject(`${target}: brain on cooldown`); continue; }
      if (Object.values({ ...brain.archivedThoughts, ...brain.thoughts }).some(t => norm(t).includes(norm(content)))) continue;
      const patch = { thoughts: { [`${adventure.activeState.turn}_${sourceTurnId}`]: `${adventure.activeState.turn} → ${content}` } };
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "append", turn: adventure.activeState.turn, preview: content }]);
      if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions);
      else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
      executed.push(`Thought: ${target}`);
      continue;
    }

    if (kind === "state") {
      const component = adventure.components.find(c => c.type === "storyState" && c.active && c.autoUpdate !== false && c.title === target);
      if (!component) { reject(`${target}: Story State not available`); continue; }
      if (norm(component.content) === norm(content)) continue;
      proposal.proposedType = "storyStateUpdate";
      proposal.targetId = component.id;
      proposal.title = component.title;
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      executed.push("Story State");
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
          if (existing.memoryMode !== "living") { reject(`${target}: only living cards can supersede facts`); continue; }
          const superseded = supersedeCardFact(existing, replaces, content);
          if (!superseded) { reject(`${target}: replaced fact not found on the card`); continue; }
          proposal.content = superseded;
          proposal.appendContent = false;
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
      const components = adventure.components.filter(c => c.active && c.autoUpdate !== false && c.type === type && c.title === target && scope.visibleIds.has(c.id));
      const component = components.length === 1 ? components[0] : undefined;
      if (!component) { reject(`${target}: component not in this pass`); continue; }
      if (norm(component.content) === norm(content)) continue;
      if (kind === "arc" && (!component.arcPremise?.trim() || norm(component.content).includes(norm(content)))) continue;
      if (kind === "pressure" && /\n|[.!?]\s+\p{Lu}/u.test(content)) { reject(`${target}: pressure must be one sentence`); continue; }
      proposal.proposedType = kind === "essentials" ? "plotEssentialsUpdate" : kind === "arc" ? "currentArcUpdate" : "plotPressureUpdate";
      proposal.targetId = component.id;
      proposal.appendContent = kind === "arc";
      proposal.requiresReview = kind === "essentials";
      if (proposal.requiresReview) proposal.rationale += " Foundational story change: review required.";
    } else { reject(`${target}: unsupported memory kind`); continue; }
    if (proposal.requiresReview && kind !== "essentials") proposal.rationale += " Consequential memory change: review required.";
    actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
    executed.push(`Proposed ${kind}: ${target}`);
  }
  actions.push({ type: "LOG_EVALUATION_RESULT", entry: {
    id: createId("eval"), turn: adventure.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
    conditionsFired: [], actionsExecuted: [sourceLabel, ...executed], generatedContent: [], errors,
  } });
  return actions;
}
