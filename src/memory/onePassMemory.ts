import { STORY_CARD_MEMORY_CHECK, STORY_CARD_OUTPUT_SCHEMA, makeStoryCardSuggestion, companionLoreSuggestion } from "./storyCardSuggestions";
import { isExceptionalIdentityChange } from "./storyCardArchitecture";
import type { Adventure, AdventureAction, BrainEntry, ContextBuildResult, MemoryProposal, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";

export const ONE_PASS_MEMORY_ID = "one-pass-memory";
export const MEMORY_OUTPUT_RESERVE = 1400;

export function onePassMemoryInstruction(brains: BrainEntry[], categories: string[]): string {
  return `[ONE-PASS MEMORY]
Write the requested narrative first, preserving its quality and visible word limit. Then append exactly one hidden JSON envelope:
<memory_updates>{"updates":[]}</memory_updates>
An empty updates array is normal. Never invent changes to fill it. Maximum 4 small updates per turn. No other thought/memory tags.
Each update has: kind, target, content, evidence, reason. evidence is an EXACT quote from this turn's player input or your visible story, establishing the change. reason explains why it will matter beyond this scene. Do not treat a suggestion, possibility, or plan as an accomplished fact. Do not give absent characters knowledge they did not receive.
Allowed kinds:
- "thought": target is an eligible character name below; content is ONE new first-person internal reaction, belief, or private plan (max 45 words). Capture only if the character participated or learned something this turn. Never repeat existing thoughts or put generic world facts here.
${STORY_CARD_MEMORY_CHECK}
${STORY_CARD_OUTPUT_SCHEMA}
Eligible thought targets: ${brains.map(b => JSON.stringify(b.characterName)).join(", ") || "none"}.
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
  for (const raw of updates) {
    const reject = (reason: string) => errors.push(`One-pass memory skipped: ${reason}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reject("invalid update"); continue; }
    const u = raw as Record<string, unknown>;
    if (![u.kind, u.target, u.content, u.evidence, u.reason].every(v => typeof v === "string" && v.trim())) { reject("missing fields"); continue; }
    const kind = u.kind as string, target = (u.target as string).trim(), content = (u.content as string).trim(), evidence = (u.evidence as string).trim();
    const quote = norm(evidence);
    if (!quote || (quote.length < 12 && !["card", "lore", "newCard"].includes(kind)) || !evidenceSources.some(s => s.includes(quote))) { reject(`${target}: evidence is not in this turn`); continue; }
    if (words(content) > (kind === "essentials" ? 180 : kind === "newCard" || kind === "lore" ? 90 : kind === "card" ? 70 : 45)) { reject(`${target}: content exceeds limit`); continue; }
    if (content.includes("<") || content.length > 4000 || target.length > 150 || (u.reason as string).length > 600) { reject(`${target}: invalid content`); continue; }
    const key = `${kind}:${norm(target)}${["card", "lore", "newCard"].includes(kind) ? ":" + norm(content) : ""}`;
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
      const eligibleNames = instruction.split("Eligible thought targets: ")[1]?.split(".\n")[0] ?? "";
      if (!brain || !eligibleNames.includes(JSON.stringify(target)) || (brain.lastUpdatedTurn !== undefined && adventure.activeState.turn - brain.lastUpdatedTurn < (brain.autoUpdateCooldownTurns ?? 0))) { reject(`${target}: brain not eligible`); continue; }
      if (Object.keys(brain.thoughts ?? {}).length && !visibleIds.has(brain.id)) { reject(`${target}: brain context was omitted`); continue; }
      if (!evidenceSources.some(s => s.includes(norm(target)))) { reject(`${target}: character absent from this turn`); continue; }
      if (Object.values({ ...brain.archivedThoughts, ...brain.thoughts }).some(t => norm(t).includes(norm(content)))) continue;
      const patch = { thoughts: { [`${adventure.activeState.turn}_${sourceTurnId}`]: `${adventure.activeState.turn} → ${content}` } };
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "append", turn: adventure.activeState.turn, preview: content }]);
      if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions);
      else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
      executed.push(`Thought: ${target}`);
      continue;
    }
    if (kind === "card" || kind === "newCard" || kind === "lore") {
      if (!story.includes(evidence) && !playerInput.includes(evidence)) { reject(`${target}: Story Card quote must come from this completed exchange`); continue; }
      if (typeof u.targetId === "string" && !adventure.storyCards.some(card => card.id === u.targetId)) { reject(`${target}: unknown target ID`); continue; }
      const exact = adventure.storyCards.filter(card => u.targetId ? card.id === u.targetId : card.title === target);
      const existing = exact.length === 1 ? exact[0] : undefined;
      if (existing && norm(existing.content).includes(norm(content))) continue;
      // Evidence can be dialogue; a biography update must be a factual summary.
      // Do not append a copied first/second-person scene quote as an identity change.
      if (existing?.type === "character" && (story.includes(content) || playerInput.includes(content))
        && /["“”]/.test(content) && /\b(?:I|you|we|my|your|our)\b/i.test(content)) {
        reject(`${target}: Character content copies scene dialogue instead of an identity fact`); continue;
      }
      if (kind === "card" && exact.length === 0) { reject(`${target}: unknown target ID`); continue; }
      if (existing && !existing.active) { reject(`${target}: target is inactive`); continue; }
      const inferredHabit = existing?.type === "character" && /\b(always|never|usually|regularly|habitually|tends? to|habit|coping|stable trait|usual|treats|uses? .{0,20}as a|uses? .{0,20}to manage)\b/i.test(content) && !hasDurableCharacterEvidence(evidence);
      if (u.cardType !== undefined && !["lore", "character", "location", "custom"].includes(String(u.cardType))) { reject(`${target}: invalid Story Card type`); continue; }
      if (u.operation !== undefined && !["create", "update"].includes(String(u.operation).toLowerCase())) { reject(`${target}: invalid operation`); continue; }
      const requested = ["character", "location", "custom"].includes(String(u.cardType)) ? u.cardType as StoryCardType : "lore";
      const type: StoryCardType = existing && (existing.type === "lore" || existing.type === "custom") ? existing.type
        : existing && (existing.type === "character" || existing.type === "location") && isExceptionalIdentityChange(existing.type, content)
        ? existing.type : kind === "newCard" && !existing ? requested : "lore";
      if (!existing && !adventure.systemTriggers?.enabled) { reject(`${target}: new card suggestions disabled`); continue; }
      const suggestion = makeStoryCardSuggestion(adventure, sourceTurnId, story, { title: target, content, evidence, reason: `One-pass memory: ${u.reason}`,
        type, targetId: typeof u.targetId === "string" ? u.targetId : existing?.id, candidateOnly: Boolean(inferredHabit || quote.length < 12),
        triggers: Array.isArray(u.triggers) ? u.triggers.filter((value): value is string => typeof value === "string").slice(0, 3) : [],
        participants: Array.isArray(u.participants) ? u.participants.filter((value): value is string => typeof value === "string").slice(0, 8) : undefined,
      });
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: suggestion });
      const companion = companionLoreSuggestion(adventure, suggestion);
      if (companion) actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: companion });
      executed.push(`Proposed ${kind}: ${target}`);
      continue;
    } else { reject(`${target}: only Story Cards and Brains are automatic memory destinations`); continue; }
  }
  actions.push({ type: "LOG_EVALUATION_RESULT", entry: {
    id: createId("eval"), turn: adventure.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
    conditionsFired: [], actionsExecuted: [sourceLabel, ...executed], generatedContent: [], errors,
  } });
  return actions;
}
