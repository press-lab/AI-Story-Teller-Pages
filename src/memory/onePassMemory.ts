import { relationshipCandidate, type RelationshipTarget } from "./relationships";
import type { Adventure, AdventureAction, BrainEntry, ContextBuildResult, MemoryProposal, StoryCardType, WorldEvolutionSettings } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { cardMatchesName } from "../state/defaults";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";

export const ONE_PASS_MEMORY_ID = "one-pass-memory";
export const MEMORY_OUTPUT_RESERVE = 1400;
export const MAX_MEMORY_UPDATES = 4;

/** Opt-in: do not alter the ordinary memory prompt when no pair is eligible. */
export function relationshipMemoryInstruction(relationships: RelationshipTarget[]): string {
  if (!relationships.length) return "";
  return `\n[DYNAMIC RELATIONSHIPS]
An eligible Brain may also propose a "relationshipChange" in the same memory_updates envelope. Ordinary thoughts still use "thought"; do not suppress thoughts to fill relationship slots. The shared limit remains four small updates; never invent updates.
Use exact target (Brain ID), relationshipId, focusStoryCardId and focus from the inventory, plus revision. Instead of content provide proposed: {bond,status,dimensions}, the complete new state with unchanged dimension names. Include evidence and knowledgeEvidence: exact quotes from this turn establishing the change and how the NPC witnessed or learned it; also include reason. No numeric meters. Bond/status transitions require explicit in-story evidence naming the resulting state and review; rudeness alone never means a breakup. Quote matching proves provenance, not knowledge. Uncertain knowledge and interpretation require review. Keep ordinary thoughts as private reactions, Story Cards as profiles and untracked relationships. Never write relationshipPressure.
Eligible relationship targets: ${JSON.stringify(relationships)}
[/DYNAMIC RELATIONSHIPS]`;
}

export function onePassMemoryInstruction(brains: BrainEntry[], categories: string[], relationships: RelationshipTarget[] = [], hasPressure = false, arcId?: string, world?: WorldEvolutionSettings): string {
  return `[ONE-PASS MEMORY]
Write the requested narrative first, preserving its quality and visible word limit. Then append exactly one hidden JSON envelope:
<memory_updates>{"updates":[]}</memory_updates>
${arcId ? `The same envelope may include "plotEvents": [{"kind":"progress|setback|revelation|confrontation|resolved|failed|abandoned","targetId":"${arcId}","evidence":"exact visible story quote","outcome":"brief established result","offscreen":false}]. Emit only events actually established in visible narration. Set offscreen true for actions away from the player. Resolve only with a conclusive outcome; do not invent a successor threat merely to extend the arc. Ordinary sandbox scenes need no event. ${world?.plotProgression === "active" ? "Pursue meaningful conclusions without a schedule." : "Let plot progress arise naturally."} ${world?.offscreenEvents && world?.npcAutonomy === "independent" ? "NPCs may act offscreen." : "Do not narrate autonomous offscreen plot events."}` + "\n" : ""}An empty updates array is normal. Never invent changes to fill it. Maximum 4 small updates and at most ONE new card per turn. No other thought/memory tags.
Each update has: kind, target, content, evidence, reason. evidence is an EXACT quote from this turn's player input or your visible story, establishing the change. reason explains why it will matter beyond this scene. Do not treat a suggestion, possibility, or plan as an accomplished fact. Do not give absent characters knowledge they did not receive.
Allowed kinds:
- "thought": target is an eligible character name below; content is ONE new first-person internal reaction, belief, or private plan (max 45 words). Capture only if the character participated or learned something this turn. Never repeat existing thoughts or put generic world facts here.
- "card": target is the EXACT title of an existing Story Card visible in context; content is only a NEW durable fact (max 70 words) to append. Character cards are profiles: add ONE lasting ability, trait, relationship, or obligation only when the quoted evidence EXPLICITLY establishes it as an enduring fact. A single action or reaction does not prove a habit or personality trait. Never generalize one fight, meal, joke, or exchange into what someone usually does. Put consequential shared history on lore/location cards; otherwise leave it in the transcript. Preserve identity and existing facts. Never overwrite or contradict canon; corrections need explicit review outside this automatic path. Omit already-known facts and rephrasings.
- "lore": target is the EXACT title of an existing lore/location/custom Story Card, or a narrow NEW subject title. An existing lore/location card may be named in the supplied target inventory even when it was not triggered into model context this turn; such an update requires review. Create an INDEPENDENT historical lore card for a distinctive completed shared event worth recalling later, such as a first fight, first meeting, major battle, revelation, or consequential choice. It need not establish a new rule or ongoing obligation. Give the new card a specific event title, concise past-tense facts naming participants, place, and outcome, 1-3 narrow recall triggers, and category "plot_beat". It becomes a reviewable lore card with historical memory mode. Use category "world_fact" for a reusable rule, place, or subject instead. Do not create lore for routine movement, a passing reaction, or generic scene filler. Never append the event to a participant's character card.
- "newCard": target is a genuinely new recurring subject's name, content max 90 words. Also provide cardType (character, location, lore, custom, plot), memoryMode (static or living), triggers (1-3 narrow phrases), and category from: ${categories.join(", ") || "NONE (no new cards allowed)"}. Reuse existing subjects; never create sibling cards for a conversation, invitation, repeated affection, room movement, routine choice, or temporary mood. A plot card requires a consequential lasting obligation, alliance, betrayal, secret, or irreversible change; it will require review. Use "lore" above, not "newCard", for a distinctive completed event.
${hasPressure ? '- "pressure": target is the EXACT title of an active Active Pressure component; content is its full replacement, ONE sentence (max 45 words) identifying the external threat or obligation pressing on the player. Only when it materially changes or resolves; no cosmetic rewrites.\n' : ""}- "arc": target is the EXACT title of the active Current Arc; content is one concise, completed development (max 45 words) directly relevant to its premise, to append to its log. Skip scene filler, repeated beats, possibilities, and future events. Never change the premise, phase, or pacing.
- "essentials": target is the EXACT title of a Plot Essentials component; content is its full replacement (max 180 words), preserving still-valid foundations. Only when the overarching premise, central long-term conflict, or persistent story-wide constraint fundamentally changes. This always requires review. NOT scene summaries, temporary whereabouts, immediate threats, or current-arc progress.
Current Arc holds the ongoing storyline and its authored pacing. Do not alter arc phases, break instructions, or create a new arc here. Record arc progress there; a distinct completed event may also earn its own historical lore card when users will want to recall the occurrence itself. Plot Essentials is the overarching story. Character Story Cards hold profiles, lore cards hold reusable setting and shared history, and Brains hold private internal state. Routine scene beats stay in the transcript.
For example: {"kind":"card","target":"Mira","content":"Mira is allergic to silver.","evidence":"Silver gives me a rash, Mira says.","reason":"Persistent vulnerability"}.
Historical lore example: {"kind":"lore","target":"Seth and Buu's First Fight","content":"Seth and Buu fought for the first time on Hercule's estate. Seth blasted Buu into orbit; Buu returned unharmed and asked to continue.","evidence":"Buu returned unharmed and asked to continue.","reason":"Distinct first fight worth recalling","category":"plot_beat","triggers":["Seth and Buu first fight","Buu sent into orbit"]}.
Eligible thought targets: ${brains.map(b => JSON.stringify(b.characterName)).join(", ") || "none"}.
Only output changes supported by this turn and consistent with ALL supplied canon. These hidden updates are not narrative and must never steer the scene merely to create memory.${relationshipMemoryInstruction(relationships)}`;
}

/** A broken/truncated tail must never leak JSON into the story or discard good prose. */
export function parseOnePassMemory(text: string): { story: string; updates: unknown[]; plotEvents?: unknown[]; worldChanges?: unknown[]; newPlots?: unknown[]; error?: string } {
  const start = text.search(/<memory_(?:updates\b|[a-z]*$)/i);
  if (start < 0) return { story: text, updates: [], error: "Memory envelope missing; story preserved." };
  const story = text.slice(0, start).trimEnd();
  const tail = text.slice(start);
  const match = /^<memory_updates\s*>([\s\S]*?)<\/memory_updates>\s*$/i.exec(tail);
  if (!match || match[1].length > 16000) return { story, updates: [], ...recoverWorldRecords(tail), error: "Incomplete or oversized memory envelope; story preserved." };
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || !("updates" in parsed) || !Array.isArray(parsed.updates)) throw new Error();
    return { story, updates: parsed.updates,
      ...("plotEvents" in parsed && Array.isArray(parsed.plotEvents) ? { plotEvents: parsed.plotEvents } : {}),
      ...("worldChanges" in parsed && Array.isArray(parsed.worldChanges) ? { worldChanges: parsed.worldChanges } : {}),
      ...("newPlots" in parsed && Array.isArray(parsed.newPlots) ? { newPlots: parsed.newPlots } : {}) };
  } catch {
    return { story, updates: [], ...recoverWorldRecords(tail), error: "Invalid memory JSON; story preserved." };
  }
}

/** Recover only complete JSON objects. Never complete a cut-off quote or use prose from a discarded draft. */
function recoverWorldRecords(tail: string): { plotEvents?: unknown[]; worldChanges?: unknown[]; newPlots?: unknown[] } {
  if (tail.length > 16000) return {};
  const result: Record<string, unknown[]> = {};
  for (const key of ["plotEvents", "worldChanges", "newPlots"]) {
    const start = tail.indexOf(`"${key}"`);
    if (start < 0) continue;
    const array = tail.indexOf("[", start);
    if (array < 0) continue;
    let depth = 0, inString = false, escape = false, objectStart = -1;
    const records: unknown[] = [];
    for (let i = array + 1; i < tail.length && records.length < 4; i++) {
      const c = tail[i];
      if (inString) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') inString = false; continue; }
      if (c === '"') { inString = true; continue; }
      if (!depth && c === "]") break;
      if (c === "{") { if (!depth) objectStart = i; depth++; }
      if (c === "}" && depth) { depth--; if (!depth) { try { records.push(JSON.parse(tail.slice(objectStart, i + 1))); } catch { /* malformed object remains unrecorded */ } } }
    }
    if (records.length) result[key] = records;
  }
  return result;
}

const norm = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (text: string) => text.trim().split(/\s+/).length;

// A conservative backstop for obvious episode recaps. Ambiguous facts stay in
// the model's chosen lane; this only prevents automatic character-card writes.
export function isSceneRecapForCharacter(content: string): boolean {
  const sceneAnchor = /\b(?:during|last night|last spring|that night|yesterday|previous night|this morning|today|on (?:the|his|her|\w+(?:'s|’s))|at (?:the|his|her)|after (?:the|their|his|her)|from (?:the|his|her)|to (?:the|his|her))\b/i;
  const completedAction = /\b(?:asked|agreed|brought|destroyed|drank|invited|kissed|knocked|opened|ordered|reacted|sparred|traveled|used|watched|went|won|cleaned|filmed|posted|edited|thanked|noticed|refused|insisted|surprised|hit)\b/i;
  const temporaryActivity = /\b(?:is|are|was|were)\s+(?:currently\s+)?(?:editing|filming|posting|cleaning|watching|planning|preparing|waiting|heading|working on)\b/i;
  const specificArtifact = /\b(?:video|montage|clip|post|quote|camera spot|views|likes|followers)\b/i;
  const interpersonalMoment = /\b(?:appreciates?|thanked|noticed|surprised|refused|insisted)\b/i.test(content)
    && /\b(?:cleaning|dishes|dinner|meal|coffee|gift|joke|comment|said|calling|helping)\b/i.test(content);
  return (sceneAnchor.test(content) && completedAction.test(content))
    || temporaryActivity.test(content)
    || (specificArtifact.test(content) && /\b(?:edited|posted|filmed|hit|said|quote|spot|views)\b/i.test(content))
    || interpersonalMoment;
}

/** Require explicit persistent evidence rather than a model's claim that one scene proves a habit. */
export function hasDurableCharacterEvidence(evidence: string): boolean {
  return /\b(?:can|cannot|can't|always|never|usually|regularly|habitually|tends? to|owns|knows|loves|hates|trusts|promised|agreed to|is allergic to|are allergic to|is able to|are able to|burns|weakens|heals)\b/i.test(evidence);
}

function isSingleCharacterFact(content: string): boolean {
  const withoutHonorifics = content.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof)\.\s+/g, "");
  return !/[;\n]/.test(withoutHonorifics) && !/[.!?]\s+\p{Lu}/u.test(withoutHonorifics);
}

/** Local structural/evidence checks, not a claim that a quote proves every inference. */
export function onePassMemoryActions(adventure: Adventure, context: ContextBuildResult, updates: unknown[], story: string, sourceTurnId: string, error?: string, sourceLabel = "One-pass memory: no additional API call", playerInputOverride?: string, recentEvidence: string[] = []): AdventureAction[] {
  const actions: AdventureAction[] = [];
  const errors = error ? [error] : [];
  const executed: string[] = [];
  const visibleIds = new Set(context.sections.flatMap(s => s.items.map(i => i.id)));
  const instruction = context.sections.flatMap(s => s.items).find(i => i.id === ONE_PASS_MEMORY_ID)?.content ?? "";
  const lastMessage = adventure.messages.at(-1);
  const playerInput = playerInputOverride ?? (lastMessage?.role === "user" ? lastMessage.content : "");
  const evidenceSources = [norm(story), norm(playerInput), ...recentEvidence.map(norm)];
  const seen = new Set<string>();
  let newCards = 0;
  let accepted = 0;
  // Overproduction is not broken JSON. Keep valid thoughts before other candidates
  // in an oversized batch; malformed and ineligible entries consume no write slots.
  const isThought = (u: unknown) => !!u && typeof u === "object" && "kind" in u && u.kind === "thought";
  const candidates = updates.length > MAX_MEMORY_UPDATES
    ? [...updates.filter(isThought), ...updates.filter(u => !isThought(u))] : updates;
  for (const raw of candidates) {
    const reject = (reason: string) => errors.push(`One-pass memory skipped: ${reason}`);
    if (accepted >= MAX_MEMORY_UPDATES) { reject(`[${sourceLabel}] update limit reached; retained ${accepted} accepted updates`); continue; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reject("invalid update"); continue; }
    const u = raw as Record<string, unknown>;
    if (u.kind === "relationshipChange") {
      const result = relationshipCandidate(adventure, context, u, story, playerInput, sourceTurnId);
      if (typeof result === "string") { reject(`relationshipChange [${sourceLabel}]: ${result}`); continue; }
      const key = `relationship:${result.targetId}:${result.relationship?.relationshipId}`;
      if (seen.has(key)) { reject(`relationshipChange [${sourceLabel}]: duplicate pair in envelope`); continue; }
      seen.add(key);
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "relationshipProposal", proposal: result }]);
      actions.push(...boundary.actions);
      accepted++;
      executed.push(`relationshipChange [${sourceLabel}]: accepted for review — ${result.title}; ${result.rationale}`);
      continue;
    }
    if (![u.kind, u.target, u.content, u.evidence, u.reason].every(v => typeof v === "string" && v.trim())) { reject("missing fields"); continue; }
    const kind = u.kind as string, target = (u.target as string).trim(), content = (u.content as string).trim(), evidence = (u.evidence as string).trim();
    const quote = norm(evidence);
    if (quote.length < 12 || !evidenceSources.some(s => s.includes(quote))) { reject(`${target}: evidence is not in this turn`); continue; }
    if (words(content) > (kind === "essentials" ? 180 : kind === "newCard" || kind === "lore" ? 90 : kind === "card" ? 70 : 45)) { reject(`${target}: content exceeds limit`); continue; }
    if (content.includes("<") || content.length > 4000 || target.length > 150 || (u.reason as string).length > 600) { reject(`${target}: invalid content`); continue; }
    const key = `${kind}:${norm(target)}`;
    if (seen.has(key)) { reject(`${target}: repeated target`); continue; }
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
      const eligibleNames = instruction.split("Eligible thought targets: ")[1]?.split(".\n")[0] ?? "";
      if (!brain || !eligibleNames.includes(JSON.stringify(target)) || (brain.lastUpdatedTurn !== undefined && adventure.activeState.turn - brain.lastUpdatedTurn < (brain.autoUpdateCooldownTurns ?? 0))) { reject(`${target}: brain not eligible`); continue; }
      if (Object.keys(brain.thoughts ?? {}).length && !visibleIds.has(brain.id)) { reject(`${target}: brain context was omitted`); continue; }
      if (!evidenceSources.some(s => s.includes(norm(target)))) { reject(`${target}: character absent from this turn`); continue; }
      if (Object.values({ ...brain.archivedThoughts, ...brain.thoughts }).some(t => norm(t).includes(norm(content)))) continue;
      const patch = { thoughts: { [`${adventure.activeState.turn}_${sourceTurnId}`]: `${adventure.activeState.turn} → ${content}` } };
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "append", turn: adventure.activeState.turn, preview: content }]);
      if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions);
      else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
      seen.add(key);
      accepted++;
      executed.push(`Thought: ${target}`);
      continue;
    }
    if (kind === "card" || kind === "newCard" || kind === "lore") {
      const exact = adventure.storyCards.filter(c => c.title === target);
      const matches = exact.length ? exact : adventure.storyCards.filter(c => cardMatchesName(c, target));
      if (matches.length > 1) { reject(`${target}: ambiguous card target`); continue; }
      const existing = matches[0];
      if (existing) {
        const outOfContextLore = kind === "lore" && ["lore", "location", "custom"].includes(existing.type)
          && existing.inclusionPolicy === "triggered" && !visibleIds.has(existing.id);
        if (!existing.active || (!visibleIds.has(existing.id) && !outOfContextLore) || existing.type === "event" || existing.memoryMode === "historical") { reject(`${target}: target not editable in this context`); continue; }
        if (kind === "lore" && !["lore", "location", "custom"].includes(existing.type)) { reject(`${target}: lore cannot update a character card`); continue; }
        if (existing.type === "character" && isSceneRecapForCharacter(content)) { reject(`${target}: scene recap belongs in lore or transcript`); continue; }
        if (existing.type === "character" && (!hasDurableCharacterEvidence(evidence) || !isSingleCharacterFact(content))) { reject(`${target}: character fact lacks explicit durable evidence`); continue; }
        if (norm(existing.content).includes(norm(content))) continue;
        proposal.title = existing.title;
        proposal.targetId = existing.id;
        proposal.appendContent = true;
        proposal.memoryMode = existing.memoryMode;
        // Sensitive identity records and evolving plot state need review, even with generic auto-approval.
        proposal.requiresReview = existing.type === "plot" || existing.protected || outOfContextLore;
      } else {
        const allowedTypes: StoryCardType[] = ["character", "location", "lore", "custom", "plot"];
        const category = typeof u.category === "string" ? u.category : "";
        const allowedCategory = kind === "lore"
          ? (category === "world_fact" || category === "plot_beat") && adventure.systemTriggers?.categories[category as "world_fact" | "plot_beat"]
          : allowedTypes.includes(u.cardType as StoryCardType) && adventure.systemTriggers?.categories[category as keyof typeof adventure.systemTriggers.categories];
        if ((kind !== "newCard" && kind !== "lore") || ++newCards > 1 || !adventure.systemTriggers?.enabled || !allowedCategory) { reject(`${target}: new card not allowed`); continue; }
        if (!Array.isArray(u.triggers) || !u.triggers.length || u.triggers.length > 3 || u.triggers.some(t => typeof t !== "string" || t.trim().length < 3 || t.length > 80)) { reject(`${target}: invalid triggers`); continue; }
        proposal.storyCardType = kind === "lore" ? "lore" : u.cardType as StoryCardType;
        proposal.memoryMode = category === "plot_beat" ? "historical" : u.memoryMode === "living" ? "living" : "static";
        proposal.suggestedTriggers = u.triggers as string[];
        proposal.requiresReview = kind === "lore" || u.cardType === "plot";
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
    seen.add(key);
    accepted++;
    executed.push(`Proposed ${kind}: ${target}`);
  }
  actions.push({ type: "LOG_EVALUATION_RESULT", entry: {
    id: createId("eval"), turn: adventure.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
    conditionsFired: [], actionsExecuted: [sourceLabel, ...executed], generatedContent: [], errors,
  } });
  return actions;
}
