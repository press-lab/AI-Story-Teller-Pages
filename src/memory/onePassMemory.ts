import type { Adventure, AdventureAction, BrainEntry, ContextBuildResult, EventMemory, MemoryProposal, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { cardMatchesName } from "../state/defaults";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import { sanitizeStoryCardTriggers } from "./resolveMemoryTarget";
import { stripRepeatedThoughtLines } from "./thoughtDedupe";

export const ONE_PASS_MEMORY_ID = "one-pass-memory";
export const MEMORY_OUTPUT_RESERVE = 1400;

export const ONE_PASS_REMINDER_ID = "one-pass-memory-reminder";
// Attempts logged before the end-of-turn reminder existed used "One-pass memory: no additional API
// call". A new label keeps those older misses from pausing inline memory before the reminder is tried.
export const ONE_PASS_LOG_LABEL = "One-pass memory: inline with the story call";
export const ONE_PASS_PAUSED_LABEL = "One-pass memory paused: memory-only call instead";
/** Consecutive missing envelopes before inline memory pauses, and turns before it is retried. */
export const INLINE_MEMORY_PAUSE_AFTER = 3;
export const INLINE_MEMORY_RETRY_TURNS = 20;
const ENVELOPE_FAILURE = /Memory envelope missing|Incomplete or oversized memory envelope|Invalid memory JSON/;

export function isEnvelopeFailure(message: string): boolean {
  return ENVELOPE_FAILURE.test(message);
}

/**
 * Some story models never append the hidden envelope. Paying for the instruction and output
 * reserve on every story call is then pure waste, because the memory-only fallback call runs
 * anyway. Derived from the evaluation log (no stored flag), and retried every
 * INLINE_MEMORY_RETRY_TURNS turns so a better model or prompt recovers on its own.
 */
export function inlineMemoryPaused(adventure: Adventure): boolean {
  const attempts = adventure.activeState.evaluationLog.filter(entry => entry.actionsExecuted[0] === ONE_PASS_LOG_LABEL);
  if (attempts.length < INLINE_MEMORY_PAUSE_AFTER) return false;
  if (!attempts.slice(0, INLINE_MEMORY_PAUSE_AFTER).every(entry => entry.errors.some(isEnvelopeFailure))) return false;
  return adventure.activeState.turn - attempts[0].turn < INLINE_MEMORY_RETRY_TURNS;
}

/**
 * Per-turn memory details, sent after the latest message: the story model follows a short
 * format reminder there far more reliably than a rule block near the top of the prompt, and
 * keeping these changing lists out of the system prompt lets its stable prefix be cached.
 */
export function onePassMemoryReminder(brains: BrainEntry[], targets: { cards: string[]; components: Array<{ title: string; type?: string }> }): string {
  return `[ONE-PASS MEMORY — hidden system note, not the player's words] After the visible story, append exactly one <memory_updates>{"updates":[...]}</memory_updates> envelope following the One-pass Memory rules; use {"updates":[]} when nothing qualifies.
Eligible thought targets: ${brains.map(b => JSON.stringify(b.characterName)).join(", ") || "none"}
Eligible existing targets (use the exact title; omit updates if their content is absent): ${JSON.stringify(targets)}`;
}

export function onePassMemoryInstruction(categories: string[]): string {
  return `[ONE-PASS MEMORY]
Write the requested narrative first, preserving its quality and visible word limit. Then append exactly one hidden JSON envelope:
<memory_updates>{"updates":[]}</memory_updates>
An empty updates array is normal. Never invent changes to fill it. Maximum 4 small updates and at most ONE new card per turn. No other thought/memory tags.
Each update has: kind, target, content, evidence, reason. evidence is an EXACT quote from this turn's player input or your visible story, establishing the change. reason explains why it will matter beyond this scene. Do not treat a suggestion, possibility, or plan as an accomplished fact. Do not give absent characters knowledge they did not receive.
Allowed kinds:
- "thought": target is an eligible character name below; content is ONE new first-person internal reaction, belief, or private plan (max 45 words). Capture only if the character participated or learned something this turn. Never repeat existing thoughts or put generic world facts here.
- "card": target is the EXACT title of an existing Story Card visible in context (never a Historical reference); content is only a NEW fact (max 70 words) still true outside this scene: trait, ability, rule, possession, standing relationship or status. A one-time happening is an event or nothing. Wrong: "Mira burned her hand at the gate tonight." Right: "Silver burns Mira's skin." Preserve identity and existing facts. Never overwrite or contradict canon; corrections need explicit review outside this automatic path. Omit already-known facts and rephrasings.
- "newCard": target is a genuinely new recurring subject's name, content max 90 words. Also provide cardType (character, location, lore, custom, plot, event), memoryMode (static or living), triggers (1-3 narrow phrases), and category from: ${categories.join(", ") || "NONE (no new cards allowed)"}. Reuse existing subjects; never create sibling cards for a conversation, invitation, repeated affection, room movement, routine choice, or temporary mood. A plot card requires a consequential lasting obligation, alliance, betrayal, secret, or irreversible change; it will require review.
- cardType "event": one completed occurrence worth recalling later (first, commitment, revelation, consequential choice, distinctive shared experience); specific title, past-tense observable facts. Add participants (1-4 names) and eventKind (first|commitment|revelation|choice|sharedExperience). Triggers are 1-4 word concrete anchors (place, object, named activity), never a name or sentence. Never routine scenes, affection, movement, recaps, or what a Historical reference covers.
- "pressure": target is the EXACT title of an active Active Pressure component; content is its full replacement, ONE sentence (max 45 words) identifying the external threat or obligation pressing on the player. Only when it materially changes or resolves; no cosmetic rewrites.
- "arc": target is the EXACT title of the active Current Arc; content is one concise, completed development (max 45 words) directly relevant to its premise, to append to its log. Skip scene filler, repeated beats, possibilities, and future events. Never change the premise, phase, or pacing.
- "essentials": target is the EXACT title of a Plot Essentials component; content is its full replacement (max 180 words), preserving still-valid foundations. Only when the overarching premise, central long-term conflict, or persistent story-wide constraint fundamentally changes. This always requires review. NOT scene summaries, temporary whereabouts, immediate threats, or current-arc progress.
Current Arc holds the ongoing storyline and its authored pacing. Do not alter arc phases, break instructions, or create a new arc here. Record an arc development there instead of creating a plot/event recap card for the same beat. Plot Essentials is the overarching story; Active Pressure is what presses NOW. Story Cards hold durable subject facts; event cards hold what happened; Brains hold private internal state.
For example: {"kind":"card","target":"Mira","content":"Mira is allergic to silver.","evidence":"Silver gives me a rash, Mira says.","reason":"Persistent vulnerability"} or {"kind":"newCard","target":"Mira's Gate Oath","cardType":"event","category":"relationship","participants":["Mira"],"eventKind":"commitment","triggers":["silver gate"],"content":"Mira swore at the silver gate to guard the road.","evidence":"I swear it on this gate, Mira says.","reason":"A binding promise"}.
Eligible thought targets and existing targets are listed in the memory note after the latest message.
Only output changes supported by this turn and consistent with ALL supplied canon. These hidden updates are not narrative and must never steer the scene merely to create memory.`;
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
const words = (text: string) => text.trim().split(/\s+/).length;
const EVENT_KINDS: EventMemory["kind"][] = ["first", "commitment", "revelation", "choice", "sharedExperience"];

/** Event cards recall on a named participant plus a short concrete anchor, so both must be usable. */
function onePassEventMemory(adventure: Adventure, title: string, u: Record<string, unknown>, sourceTurnId: string, evidenceSources: string[]): EventMemory | string {
  const participants = (Array.isArray(u.participants) ? u.participants : [])
    .filter((name): name is string => typeof name === "string" && Boolean(norm(name)))
    .map(name => name.trim()).slice(0, 4);
  if (!participants.some(name => evidenceSources.some(source => source.includes(norm(name))))) return "event participants absent from this turn";
  const recallCues = sanitizeStoryCardTriggers(adventure, title, u.triggers as string[], undefined, "historical")
    .filter(cue => words(cue) <= 4 && !participants.some(name => norm(name) === norm(cue)));
  if (!recallCues.length) return "event needs a short anchor trigger that is not a name or another card's key";
  const kind = EVENT_KINDS.includes(u.eventKind as EventMemory["kind"]) ? u.eventKind as EventMemory["kind"] : "sharedExperience";
  return { sourceMessageIds: [sourceTurnId], participants, recallCues, kind };
}

/** Local structural/evidence checks, not a claim that a quote proves every inference. */
export function onePassMemoryActions(adventure: Adventure, context: ContextBuildResult, updates: unknown[], story: string, sourceTurnId: string, error?: string, sourceLabel = ONE_PASS_LOG_LABEL, playerInputOverride?: string): AdventureAction[] {
  const actions: AdventureAction[] = [];
  const errors = error ? [error] : [];
  const executed: string[] = [];
  const visibleIds = new Set(context.sections.flatMap(s => s.items.map(i => i.id)));
  const reminder = context.sections.flatMap(s => s.items).find(i => i.id === ONE_PASS_REMINDER_ID)?.content ?? "";
  const lastMessage = adventure.messages.at(-1);
  const playerInput = playerInputOverride ?? (lastMessage?.role === "user" ? lastMessage.content : "");
  const evidenceSources = [norm(story), norm(playerInput)];
  const seen = new Set<string>();
  let newCards = 0;
  for (const raw of updates) {
    const reject = (reason: string) => errors.push(`One-pass memory skipped: ${reason}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reject("invalid update"); continue; }
    const u = raw as Record<string, unknown>;
    if (![u.kind, u.target, u.content, u.evidence, u.reason].every(v => typeof v === "string" && v.trim())) { reject("missing fields"); continue; }
    const kind = u.kind as string, target = (u.target as string).trim(), content = (u.content as string).trim(), evidence = (u.evidence as string).trim();
    const quote = norm(evidence);
    if (quote.length < 12 || !evidenceSources.some(s => s.includes(quote))) { reject(`${target}: evidence is not in this turn`); continue; }
    if (words(content) > (kind === "essentials" ? 180 : kind === "newCard" ? 90 : kind === "card" ? 70 : 45)) { reject(`${target}: content exceeds limit`); continue; }
    if (content.includes("<") || content.length > 4000 || target.length > 150 || (u.reason as string).length > 600) { reject(`${target}: invalid content`); continue; }
    const key = `${kind}:${norm(target)}`;
    if (seen.has(key)) { reject(`${target}: repeated target`); continue; }
    seen.add(key);
    const timestamp = nowIso();
    const proposal: MemoryProposal = {
      id: createId("proposal"), sourceTurnId, sourceText: evidence, proposedType: "storyCard", title: target,
      content, suggestedTriggers: [], confidence: 0.75, rationale: `One-pass memory: ${u.reason}`,
      status: "pending", createdAt: timestamp, updatedAt: timestamp,
    };
    if (kind === "thought") {
      const brains = adventure.brains.filter(b => b.active && b.characterName === target);
      const brain = brains.length === 1 ? brains[0] : undefined;
      // The prompt's eligible names includes empty brains, which have no context item yet.
      const eligibleNames = reminder.split("Eligible thought targets: ")[1]?.split("\n")[0] ?? "";
      if (!brain || !eligibleNames.includes(JSON.stringify(target)) || (brain.lastUpdatedTurn !== undefined && adventure.activeState.turn - brain.lastUpdatedTurn < (brain.autoUpdateCooldownTurns ?? 0))) { reject(`${target}: brain not eligible`); continue; }
      if (Object.keys(brain.thoughts ?? {}).length && !visibleIds.has(brain.id)) { reject(`${target}: brain context was omitted`); continue; }
      if (!evidenceSources.some(s => s.includes(norm(target)))) { reject(`${target}: character absent from this turn`); continue; }
      if (Object.values({ ...brain.archivedThoughts, ...brain.thoughts }).some(t => norm(t).includes(norm(content)))) continue;
      const thought = stripRepeatedThoughtLines(content, Object.values(brain.thoughts ?? {}));
      if (!thought) { reject(`${target}: thought only repeats lines already in this character's thoughts`); continue; }
      const patch = { thoughts: { [`${adventure.activeState.turn}_${sourceTurnId}`]: `${adventure.activeState.turn} → ${thought}` } };
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "append", turn: adventure.activeState.turn, preview: thought }]);
      if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions);
      else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
      executed.push(`Thought: ${target}`);
      continue;
    }
    if (kind === "card" || kind === "newCard") {
      const exact = adventure.storyCards.filter(c => c.title === target);
      const matches = exact.length ? exact : adventure.storyCards.filter(c => cardMatchesName(c, target));
      if (matches.length > 1) { reject(`${target}: ambiguous card target`); continue; }
      const existing = matches[0];
      // An event titled like an existing subject must not fall through to appending onto that profile.
      if (existing && kind === "newCard" && u.cardType === "event") { reject(`${target}: event title must name the occurrence, not an existing card`); continue; }
      if (existing) {
        if (!existing.active || !visibleIds.has(existing.id) || existing.type === "event" || existing.memoryMode === "historical") { reject(`${target}: target not editable in this context`); continue; }
        if (norm(existing.content).includes(norm(content))) continue;
        proposal.title = existing.title;
        proposal.targetId = existing.id;
        proposal.appendContent = true;
        proposal.memoryMode = existing.memoryMode;
        // Sensitive identity records and evolving plot state need review, even with generic auto-approval.
        proposal.requiresReview = existing.type === "plot" || existing.protected;
      } else {
        const allowedTypes: StoryCardType[] = ["character", "location", "lore", "custom", "plot", "event"];
        const category = typeof u.category === "string" ? u.category : "";
        if (kind !== "newCard" || ++newCards > 1 || !allowedTypes.includes(u.cardType as StoryCardType) || !adventure.systemTriggers?.enabled || !adventure.systemTriggers.categories[category as keyof typeof adventure.systemTriggers.categories]) { reject(`${target}: new card not allowed`); continue; }
        if (!Array.isArray(u.triggers) || !u.triggers.length || u.triggers.length > 3 || u.triggers.some(t => typeof t !== "string" || t.trim().length < 3 || t.length > 80)) { reject(`${target}: invalid triggers`); continue; }
        proposal.storyCardType = u.cardType as StoryCardType;
        proposal.memoryMode = u.memoryMode === "living" ? "living" : "static";
        proposal.suggestedTriggers = u.triggers as string[];
        proposal.requiresReview = u.cardType === "plot";
        if (u.cardType === "event") {
          const eventMemory = onePassEventMemory(adventure, target, u, sourceTurnId, evidenceSources);
          if (typeof eventMemory === "string") { reject(`${target}: ${eventMemory}`); continue; }
          proposal.memoryMode = "historical";
          proposal.suggestedTriggers = eventMemory.recallCues;
          proposal.eventMemory = eventMemory;
        }
      }
    } else if (kind === "essentials" || kind === "pressure" || kind === "arc") {
      const type = kind === "essentials" ? "plotEssentials" : kind === "arc" ? "currentArc" : "activePressure";
      const components = adventure.components.filter(c => c.active && c.autoUpdate !== false && c.type === type && c.title === target && visibleIds.has(c.id));
      const component = components.length === 1 ? components[0] : undefined;
      if (!component) { reject(`${target}: component not in context`); continue; }
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
