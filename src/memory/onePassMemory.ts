import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { matchingStoryCardEntities } from "./storyCardEntities";
import { STORY_CARD_MEMORY_CHECK, STORY_CARD_OUTPUT_SCHEMA, makeStoryCardSuggestion, companionLoreSuggestion } from "./storyCardSuggestions";
import { isExceptionalIdentityChange } from "./storyCardArchitecture";
import type { Adventure, AdventureAction, BrainEntry, ContextBuildResult, MemoryProposal, Message, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";

export const ONE_PASS_MEMORY_ID = "one-pass-memory";
export const MEMORY_OUTPUT_RESERVE = 1400;

export function onePassMemoryInstruction(brains: BrainEntry[], categories: string[], includeStoryCards = true): string {
  return `[ONE-PASS MEMORY]
Write the requested narrative first, preserving its quality and visible word limit. Then append exactly one hidden JSON envelope:
<memory_updates>{"updates":[]}</memory_updates>
An empty updates array is normal. Never invent changes to fill it. Maximum 4 small updates per turn. No other thought/memory tags.
Each update has: kind, target, content, evidence, reason. evidence is an EXACT quote from this turn's player input or your visible story, establishing the change. reason explains why it will matter beyond this scene. Do not treat a suggestion, possibility, or plan as an accomplished fact. Do not give absent characters knowledge they did not receive.
Allowed kinds:
- "thought": target is an eligible character name below; content is ONE new first-person internal reaction, belief, or private plan (max 45 words). Capture only if the character participated or learned something this turn. Never repeat existing thoughts or put generic world facts here.
${includeStoryCards ? STORY_CARD_MEMORY_CHECK + "\n" + STORY_CARD_OUTPUT_SCHEMA : "Story Cards are evaluated separately. Only eligible thought updates belong in this envelope; return an empty array when none changed."}
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
export function onePassMemoryActions(adventure: Adventure, context: ContextBuildResult, updates: unknown[], story: string, sourceTurnId: string, error?: string, sourceLabel = "One-pass memory: no additional API call", playerInputOverride?: string, recentEvidence: string[] = [], recoverySources: Message[] = [], origin: "inline" | "recovery" = "inline"): AdventureAction[] {
  const actions: AdventureAction[] = [];
  if (origin === "recovery" && !error && !updates.length) actions.push({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: {
    id: createId("decision"), sourceId: sourceTurnId, createdAt: nowIso(), stage: "recovery", origin, outcome: "zero_candidates",
  } });
  const errors = error ? [error] : [];
  const executed: string[] = !error && !updates.length ? ["memory_evaluation_empty: valid evaluation; zero updates"] : [];
  const visibleIds = new Set(context.sections.flatMap(s => s.items.map(i => i.id)));
  const instruction = context.sections.flatMap(s => s.items).find(i => i.id === ONE_PASS_MEMORY_ID)?.content ?? "";
  const lastMessage = adventure.messages.at(-1);
  const playerInput = playerInputOverride ?? (lastMessage?.role === "user" ? lastMessage.content : "");
  const evidenceSources = [norm(story), norm(playerInput), ...recentEvidence.map(norm)];
  const sourceIndex = adventure.messages.findIndex(message => message.id === sourceTurnId);
  // Recovery may explicitly cite adjacent original messages. Normal narration has no
  // such allowance. Snapshot binding is checked again before the batch commits.
  const windowIds = new Set(memoryEvidenceWindow(adventure, sourceTurnId).map(message => message.id));
  const sourceReferences = recoverySources.filter(reference => sourceIndex >= 0
    && adventure.messages.some((message, index) => message.id === reference.id && message.content === reference.content
      && windowIds.has(message.id) && index <= sourceIndex && message.role !== "system" && message.inputMode !== "comms"));
  const seen = new Set<string>();
  for (const raw of updates) {
    const beforeErrors = errors.length, beforeActions = actions.length;
    let suppressionReason = "No new memory write after eligibility or duplicate checks.";
    const suppress = (reason: string) => { suppressionReason = reason; };
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const field = (key: string, limit = 4000) => typeof value[key] === "string" ? String(value[key]).slice(0, limit) : "";
    try {
    const reject = (reason: string) => errors.push(`One-pass memory skipped: ${reason}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reject("invalid update"); continue; }
    const u = raw as Record<string, unknown>;
    if (![u.kind, u.target, u.content, u.evidence, u.reason].every(v => typeof v === "string" && v.trim())) { reject("missing fields"); continue; }
    const kind = u.kind as string, target = (u.target as string).trim(), content = (u.content as string).trim(), evidence = (u.evidence as string).trim();
    if (u.sourceMessageIds !== undefined && (!Array.isArray(u.sourceMessageIds) || !u.sourceMessageIds.length
      || !u.sourceMessageIds.includes(sourceTurnId) || new Set(u.sourceMessageIds).size !== u.sourceMessageIds.length
      || u.sourceMessageIds.some(id => !sourceReferences.some(reference => reference.id === id)))) { reject(`${target}: invalid source references`); continue; }
    const references = Array.isArray(u.sourceMessageIds) ? sourceReferences.filter(reference => (u.sourceMessageIds as unknown[]).includes(reference.id)) : [];
    const evidenceQuotes: Array<{ messageId: string; quote: string }> = [];
    if (u.evidenceQuotes !== undefined && (!Array.isArray(u.evidenceQuotes) || u.evidenceQuotes.length > 8
      || u.evidenceQuotes.some(item => !item || typeof item !== "object" || typeof item.messageId !== "string"
        || typeof item.quote !== "string" || !item.quote.trim()
        || !references.some(reference => reference.id === item.messageId && reference.content.includes(item.quote))))) {
      reject(`${target}: exact evidence quote or source reference invalid`); continue;
    }
    if (Array.isArray(u.evidenceQuotes)) evidenceQuotes.push(...u.evidenceQuotes);
    const quote = norm(evidence);
    if (!quote || (quote.length < 12 && !["card", "lore", "newCard"].includes(kind)) || ![...evidenceSources, ...(["card", "lore", "newCard"].includes(kind) ? references.map(reference => norm(reference.content)) : [])].some(s => s.includes(quote))) { reject(`${target}: evidence is not in this turn`); continue; }
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
      if (brain && (Object.keys({ ...brain.archivedThoughts, ...brain.thoughts }).some(key => key.endsWith(`_${sourceTurnId}`))
        || adventure.activeState.memoryProposals.some(proposal => proposal.proposedType === "brainUpdate" && proposal.targetId === brain.id && proposal.sourceTurnId === sourceTurnId))) { suppress("Duplicate Brain update for this source."); continue; }
      if (brain && brain.lastUpdatedTurn !== undefined && adventure.activeState.turn - brain.lastUpdatedTurn < (brain.autoUpdateCooldownTurns ?? 0)) {
        executed.push(`Brain cooldown retained: ${target}`); suppress("Brain cooldown retained."); continue;
      }
      if (!brain || !eligibleNames.includes(JSON.stringify(target))) { reject(`${target}: brain not eligible`); continue; }
      if (Object.keys(brain.thoughts ?? {}).length && !visibleIds.has(brain.id)) { reject(`${target}: brain context was omitted`); continue; }
      if (!evidenceSources.some(s => s.includes(norm(target)))) { reject(`${target}: character absent from this turn`); continue; }
      if (Object.values({ ...brain.archivedThoughts, ...brain.thoughts }).some(t => norm(t).includes(norm(content)))) { suppress("Duplicate existing Brain thought."); continue; }
      const patch = { thoughts: { [`${adventure.activeState.turn}_${sourceTurnId}`]: `${adventure.activeState.turn} → ${content}` } };
      const boundary = applyAIMemoryUpdate(adventure, [{ type: "brainPatch", brainId: brain.id, patch, mode: "append", turn: adventure.activeState.turn, preview: content }]);
      if (adventure.memoryAutoApprove.brainUpdate) actions.push(...boundary.actions.map(action => action.type === "APPLY_BRAIN_UPDATE" ? { ...action, diagnosticSourceId: sourceTurnId } : action));
      else actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, proposedType: "brainUpdate", targetId: brain.id, content: JSON.stringify(patch) } });
      executed.push(`Thought: ${target}`);
      continue;
    }
    if (kind === "card" || kind === "newCard" || kind === "lore") {
      if (!story.includes(evidence) && !playerInput.includes(evidence) && !references.some(reference => reference.content.includes(evidence))) { reject(`${target}: Story Card quote must come from this completed exchange`); continue; }
      if (typeof u.targetId === "string" && !adventure.storyCards.some(card => card.id === u.targetId)) { reject(`${target}: unknown target ID`); continue; }
      const identityHistory = recoverySources.length ? sourceReferences : adventure.messages.slice(-6).filter(message => message.role !== "system" && message.inputMode !== "comms");
      const identityContext = [...identityHistory.map(reference => reference.content), story, playerInput].join("\n");
      const knownIdentity = kind === "newCard" && u.cardType === "character"
        ? matchingStoryCardEntities(adventure.storyCards.filter(card => card.type === "character"), target, identityContext) : [];
      if (knownIdentity.length && !adventure.storyCards.some(card => card.title === target)) { executed.push(`Identity already covered or ambiguous: ${target}`); suppress("Identity already covered or ambiguous."); continue; }
      const exact = adventure.storyCards.filter(card => u.targetId ? card.id === u.targetId : card.title === target);
      const existing = exact.length === 1 ? exact[0] : undefined;
      if (existing && norm(existing.content).includes(norm(content))) { suppress("Duplicate content already present in target Story Card."); continue; }
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
      if (!existing && type !== "lore" && !adventure.systemTriggers?.enabled) { reject(`${target}: new card suggestions disabled`); continue; }
      const suggestion = makeStoryCardSuggestion(adventure, sourceTurnId, story, { title: target, content, evidence, reason: `One-pass memory: ${u.reason}`,
        type, targetId: typeof u.targetId === "string" ? u.targetId : existing?.id, candidateOnly: Boolean(inferredHabit || quote.length < 12),
        triggers: Array.isArray(u.triggers) ? u.triggers.filter((value): value is string => typeof value === "string").slice(0, 3) : [],
        participants: Array.isArray(u.participants) ? u.participants.filter((value): value is string => typeof value === "string").slice(0, 8) : undefined,
      });
      if (references.length && suggestion.storyCardReview) {
        suggestion.storyCardReview.evidenceQuotes = evidenceQuotes;
        suggestion.storyCardReview.additionalSources = references.map(({ id, content }) => ({ id, content }));
        if (suggestion.lore) suggestion.lore.sourceMessageIds = [...new Set([...suggestion.lore.sourceMessageIds, ...references.map(reference => reference.id)])];
      }
      if (typeof u.eventDate === "string" && suggestion.lore) {
        const source = adventure.messages[sourceIndex];
        if (source?.storyTime?.date !== u.eventDate) { reject(`${target}: event date is not grounded in source time`); continue; }
        suggestion.lore.occurredAt = { text: u.eventDate, date: u.eventDate, precision: "day" };
      }
      if (u.memoryMode !== undefined && u.memoryMode !== null) {
        if (!["historical", "living", "static"].includes(String(u.memoryMode))) { reject(`${target}: invalid memory mode`); continue; }
        if (type === "lore") suggestion.memoryMode = u.memoryMode as "historical" | "living" | "static";
      }
      if (u.eventStatus !== undefined && u.eventStatus !== null) {
        if (!["completed", "ongoing", "unresolved"].includes(String(u.eventStatus))) { reject(`${target}: invalid event status`); continue; }
        if (suggestion.lore) suggestion.lore.status = u.eventStatus as "completed" | "ongoing" | "unresolved";
      }
      actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: suggestion });
      const companion = companionLoreSuggestion(adventure, suggestion);
      if (companion) {
        if (companion.storyCardReview && suggestion.storyCardReview) {
          companion.storyCardReview.additionalSources = suggestion.storyCardReview.additionalSources;
          companion.storyCardReview.evidenceQuotes = suggestion.storyCardReview.evidenceQuotes;
        }
        if (companion.lore && suggestion.lore) companion.lore.sourceMessageIds = suggestion.lore.sourceMessageIds;
        actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: companion });
      }
      executed.push(`Proposed ${kind}: ${target}`);
      continue;
    } else { reject(`${target}: only Story Cards and Brains are automatic memory destinations`); continue; }
    } finally {
      const proposals = actions.slice(beforeActions).filter(a => a.type === "ADD_MEMORY_PROPOSAL");
      actions.push({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: {
        id: createId("decision"), sourceId: sourceTurnId, createdAt: nowIso(), stage: "candidate", origin,
        outcome: errors.length > beforeErrors ? "validation_rejected" : actions.length > beforeActions ? "validation_accepted" : "candidate_suppressed",
        reason: errors.length > beforeErrors ? errors.slice(beforeErrors).join("; ") : actions.length > beforeActions ? undefined : suppressionReason,
        proposalId: proposals[0]?.type === "ADD_MEMORY_PROPOSAL" ? proposals[0].proposal.id : undefined,
        candidate: { kind: field("cardType", 40) || field("kind", 40), title: field("target", 150), content: field("content"), evidence: field("evidence", 16000), rationale: field("reason", 600), targetId: field("targetId", 150) || undefined },
      } });
    }
  }
  if (!errors.length && executed.every(action => action.startsWith("Brain cooldown retained:"))) executed.push("memory_evaluation_empty: valid evaluation; no new meaningful updates after deduplication");
  actions.push({ type: "LOG_EVALUATION_RESULT", entry: {
    id: createId("eval"), turn: adventure.activeState.turn, createdAt: nowIso(), conditionsEvaluated: [],
    conditionsFired: [], actionsExecuted: [sourceLabel, `Memory source: ${sourceTurnId}`, ...executed], generatedContent: [], errors,
  } });
  return actions;
}
