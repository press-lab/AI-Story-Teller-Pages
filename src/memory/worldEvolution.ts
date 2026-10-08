import type { Adventure, AdventureAction, BrainEntry, ComponentEntry, ContextBuildResult, MemoryProposal, PlotEvent, PlotThread, StoryCard, WorldChange, WorldEffect, WorldEvolutionState } from "../types/adventure";
import { makeStoryCard } from "../state/defaults";
import { createId, nowIso } from "../utils/id";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";

export const MAX_WORLD_RECORDS = 4;
export const MAX_ACTIVE_PLOTS = 12;
export const MAX_WORLD_RECORD_CHARS = 2400;
export const MAX_WORLD_OUTPUT_CHARS = 4800;
export const MAX_WORLD_OUTPUT_TOKENS_ESTIMATE = 1200;
export const worldEnabled = (a: Adventure) => a.worldEvolutionSettings?.enabled === true;
export const worldRuntimeActive = (a: Adventure) => worldEnabled(a);
export const worldState = (a: Adventure): WorldEvolutionState => a.worldEvolutionState ?? { threads: [], history: [], issues: [] };
const text = (v: unknown, max = 1200): v is string => typeof v === "string" && v.length <= max && !/[<>]/.test(v);
const quote = (source: string, evidence: unknown): evidence is string => text(evidence, 800) && evidence.trim().length >= 12 && source.includes(evidence);
const uncertain = /\b(?:rumou?r|perhaps|might|may have|plans? to|intends? to|would|supposedly|allegedly|suspects? that|claims? that)\b/i;

export function inferredEffects(content: string): WorldEffect[] {
  const effects: WorldEffect[] = [];
  if (/\b(?:betray\w*|defect\w*|turn(?:s|ed)? against|secret alliance|secret allegiance)\b/i.test(content)) effects.push("betrayal");
  if (/\b(?:redeem\w*|redemption|renounc\w* (?:evil|cruelty)|abandon\w* (?:evil|cruelty))\b/i.test(content)) effects.push("redemption");
  if (/\b(?:hidden agenda|secret motive|secretly wants|concealed motivation)\b/i.test(content)) effects.push("hiddenMotivation");
  if (/\b(?:all along|never truly|always secretly|history was false|retroactiv\w*)\b/i.test(content)) effects.push("reinterpretation");
  if (/\b(?:true identity|real identity|was never|core identity)\b/i.test(content)) effects.push("identity");
  return effects;
}

export function characterForTarget(a: Adventure, id?: string, content = ""): StoryCard[] {
  const brain = a.brains.find(b => b.id === id);
  return a.storyCards.filter(c => c.type === "character" && (c.id === id || c.id === brain?.linkedStoryCardId
    || c.title === brain?.characterName || content.toLowerCase().includes(c.title.toLowerCase())));
}

export function needsSemanticReview(a: Adventure, p: MemoryProposal): boolean {
  return worldEnabled(a) && (p.proposedType === "plotEssentialsUpdate" || p.proposedType === "relationshipUpdate" || p.proposedType === "brainUpdate"
    || p.storyCardType === "character" || characterForTarget(a, p.targetId).length > 0 || inferredEffects(p.content + " " + p.sourceText).length > 0);
}

/** Shared by every automatic write path; declaring a different proposal kind cannot bypass a permission. */
export function mutationPermissionError(a: Adventure, targetId: string | undefined, content: string, effects?: WorldEffect[], development = false, motivationEvidence?: string, autonomous = true): string | undefined {
  if (effects && (!Array.isArray(effects) || effects.some(e => !["development", "betrayal", "redemption", "hiddenMotivation", "reinterpretation", "identity"].includes(e)))) return "Invalid semantic effects classification.";
  // Lexical signals justify review, not a claim that a character actually betrayed anyone.
  const hints = inferredEffects(content);
  const all = new Set(effects ?? hints);
  if (a.brains.some(b => b.id === targetId) && all.has("identity")) return "Durable identity belongs on a character Story Card, not a Brain.";
  const characters = characterForTarget(a, targetId, content);
  if (all.has("betrayal") && characters.some(c => c.evolutionProtection?.betrayal)) return "Character is protected from betrayal.";
  if ((all.has("identity") || all.has("reinterpretation")) && characters.some(c => c.evolutionProtection?.identity)) return "Character identity is protected.";
  if (!worldEnabled(a)) return;
  const s = a.worldEvolutionSettings!;
  if (effects === undefined && hints.length) return "Ambiguous consequential change needs an explicit reviewed semantic classification.";
  if (all.has("betrayal") && s.betrayal === "off") return "Betrayal is disabled.";
  if (all.has("redemption") && s.redemption === "off") return "Redemption is disabled.";
  if (all.has("hiddenMotivation") && !s.hiddenMotivations) return "Hidden motivations are disabled.";
  if (all.has("reinterpretation") && s.canonReinterpretation === "off") return "Canon reinterpretation is disabled.";
  if (autonomous && (development || all.has("development") || all.has("identity")) && !s.characterDevelopment) return "Character development is disabled.";
  if ((all.has("betrayal") && s.betrayal === "earned") || (all.has("redemption") && s.redemption === "earned")) {
    const sources = [...a.messages.slice(-16).map(m => m.content), ...a.storyCards.map(c => c.content), ...a.brains.map(b => b.currentState + "\n" + b.notes)];
    if (!motivationEvidence || motivationEvidence.length < 16 || !sources.some(t => t.includes(motivationEvidence))) return "Earned semantic effect needs established motivation evidence.";
  }
  if (worldState(a).history.some(h => !h.rolledBack && h.change.targetId === targetId && h.change.previous.length >= 12 && content.includes(h.change.previous))) return "Superseded canon cannot be revived by an ordinary memory write; use a reviewed world change.";
}

export function worldTarget(a: Adventure, c: WorldChange): StoryCard | BrainEntry | ComponentEntry | undefined {
  return c.owner === "storyCard" ? a.storyCards.find(t => t.id === c.targetId)
    : c.owner === "brain" ? a.brains.find(t => t.id === c.targetId)
      : a.components.find(t => t.id === c.targetId && t.type === "plotEssentials");
}
export function targetValue(a: Adventure, c: WorldChange): string {
  const target = worldTarget(a, c);
  if (!target) return "";
  if (c.owner === "brain") return (target as BrainEntry)[c.field ?? "currentState"];
  if (c.owner === "storyCard" && c.previous && !(target as StoryCard).content.includes(c.previous)) {
    const card = target as StoryCard;
    return [...(card.currentFacts ?? []), ...(card.recentDevelopments ?? [])].find(f => f.includes(c.previous)) ?? card.content;
  }
  return (target as StoryCard | ComponentEntry).content;
}
export function changeNeedsReview(a: Adventure, c: WorldChange): boolean {
  const target = worldTarget(a, c);
  return c.requiresReview || !!target?.protected || c.owner === "plotEssentials"
    || ["remove", "replace", "supersede", "resolve"].includes(c.operation) || c.effects.length > 0
    || inferredEffects(c.content + " " + c.evidence).length > 0 || c.owner === "storyCard" && (target as StoryCard | undefined)?.type === "character";
}

export function validateWorldChange(a: Adventure, c: WorldChange, acceptedStory: string): string | undefined {
  if (!worldEnabled(a)) return "World evolution is not enabled.";
  if (!c || !["storyCard", "brain", "plotEssentials"].includes(c.owner) || !["create", "append", "replace", "remove", "supersede", "resolve"].includes(c.operation)
    || !text(c.targetId, 160) || !c.targetId.trim() || !text(c.previous, 800) || !text(c.content, 800)
    || !text(c.reason, 200) || !c.reason.trim() || typeof c.requiresReview !== "boolean"
    || typeof c.autonomous !== "boolean" || typeof c.offscreen !== "boolean" || !Array.isArray(c.effects)
    || c.effects.some(e => !["development", "betrayal", "redemption", "hiddenMotivation", "reinterpretation", "identity"].includes(e))) return "Malformed world change.";
  if (c.certainty !== "confirmed" || !quote(acceptedStory, c.evidence) || uncertain.test(c.evidence)) return "Change is not a confirmed event in accepted narration.";
  const s = a.worldEvolutionSettings!;
  const offscreen = c.offscreen || /\b(?:meanwhile|elsewhere|unbeknownst|offscreen)\b/i.test(c.evidence);
  if ((offscreen && !s.offscreenEvents) || ((c.autonomous || offscreen) && s.npcAutonomy !== "independent")) return "Independent/offscreen actions are disabled.";
  const target = worldTarget(a, c);
  if (c.operation === "create") {
    if (c.owner !== "storyCard" || target || a.storyCards.some(t => t.id === c.targetId || t.title === c.title)
      || c.expectedRevision !== null || c.previous !== "" || !text(c.title, 120) || !c.title.trim()
      || !["character", "location", "lore", "event", "custom"].includes(c.cardType ?? "")
      || !Array.isArray(c.triggers) || c.triggers.length > 3 || !c.triggers.length || c.triggers.some(t => !text(t, 80) || t.length < 3)) return "Invalid new fact owner; plots use newPlots and Brains must be enrolled.";
  } else {
    if (!target || !target.active || c.expectedRevision !== target.updatedAt) return "Stale or missing target/precondition.";
    if (["supersede", "remove", "resolve"].includes(c.operation) && (!c.previous.trim() || !targetValue(a, c).includes(c.previous))) return "Previous fact is not in the target.";
    if (c.operation === "replace" && c.previous && c.previous !== targetValue(a, c)) return "Replacement precondition does not match current text.";
    if (c.owner === "storyCard" && ((target as StoryCard).memoryMode === "historical" || (target as StoryCard).type === "event")) return "Historical records are immutable to automatic changes.";
    if (c.owner === "storyCard" && (target as StoryCard).evolutionProtection?.identity && c.operation !== "append") return "Protected identity cannot be replaced or removed through an automatic change.";
    if (c.owner === "storyCard" && ["replace", "supersede", "remove", "resolve"].includes(c.operation)
      && ((target as StoryCard).coreFacts ?? []).some(f => c.operation === "replace" ? !c.content.includes(f) : c.previous.includes(f))) return "Protected core facts must be retained.";
  }
  if (c.operation !== "remove" && !c.content.trim()) return "New state is empty.";
  if (c.operation === "append" && inferredEffects(c.content + " " + c.evidence).some(e => e === "betrayal" || e === "reinterpretation" || e === "redemption")) return "Use supersede/replace for changed current facts.";
  const effects = c.effects;
  if (c.characterId && !characterForTarget(a, c.targetId, c.content + " " + c.evidence).some(t => t.id === c.characterId)) return "Character identity does not match the mutation owner.";
  const error = mutationPermissionError(a, c.targetId, c.content + " " + c.evidence, effects,
    c.owner === "storyCard" && (target as StoryCard | undefined)?.type === "character", c.motivationEvidence, c.autonomous);
  if (error) return error;
  if ((effects.includes("betrayal") && s.betrayal === "earned") || (effects.includes("redemption") && s.redemption === "earned")) {
    const motivationSources = [acceptedStory, ...a.messages.slice(-16).map(m => m.content), ...a.storyCards.map(t => t.content), ...a.brains.map(t => t.currentState + "\n" + t.notes)];
    if (!text(c.motivationEvidence, 800) || c.motivationEvidence.trim().length < 16 || !motivationSources.some(t => t.includes(c.motivationEvidence!))
      || !/\b(?:because|after|since|resent\w*|revenge|protect\w*|promise\w*|mercy|forgiv\w*|regret\w*|realiz\w*|conviction|belief|refus\w*)\b/i.test(c.motivationEvidence)) return "Earned change needs established motivation or development.";
  }
  if (c.owner === "brain") {
    if (!["currentState", "emotionalInterpretation", "recentDevelopments", "notes"].includes(c.field ?? "")) return "Invalid Brain field; enrolled relationships have their own owner.";
    const brain = target as BrainEntry;
    if (!quote(acceptedStory, c.knowledgeEvidence) || !c.knowledgeEvidence.includes(brain.characterName)
      || !/\b(?:saw|sees?|heard|hears?|learn\w*|told|read|witness\w*|realiz\w*|says?|said|because)\b/i.test(c.knowledgeEvidence)) return "Brain change lacks a confirmed knowledge path.";
    if (effects.includes("identity") || effects.includes("development") && /\b(?:personality|allegiance|loyal to|identity)\b/i.test(c.content)) return "Durable identity/allegiance belongs on a character Story Card.";
  }
  if (c.owner === "storyCard" && (target as StoryCard | undefined)?.type === "character") {
    const name = (target as StoryCard).title;
    if (a.brains.some(b => b.characterName === name && b.relationships.length > 0) && /\b(?:bond:|status:|trust dimension|relationship dimension)\b/i.test(c.content)) return "Enrolled relationship state belongs to the existing relationship owner.";
  }
}

export function applyWorldChange(a: Adventure, p: MemoryProposal): Partial<Adventure> {
  const c = p.worldChange!;
  const story = a.messages.find(m => m.id === p.sourceTurnId && m.role === "assistant")?.content ?? "";
  if (validateWorldChange(a, c, story)) return {};
  const before = worldTarget(a, c);
  const current = targetValue(a, c);
  const content = c.operation === "append" ? [current, c.content].filter(Boolean).join("\n")
    : ["supersede", "remove", "resolve"].includes(c.operation) ? current.replace(c.previous, c.content).trim() : c.content;
  let after: StoryCard | BrainEntry | ComponentEntry;
  let patch: Partial<Adventure>;
  const timestamp = nowIso();
  if (c.owner === "storyCard") {
    const card = before as StoryCard | undefined;
    const updateFact = (f: string) => c.previous ? f.replace(c.previous, c.content) : f;
    after = card ? { ...card, content: c.operation === "append" ? content : c.previous && !card.content.includes(c.previous) ? card.content : content, updatedAt: timestamp, active: c.operation === "remove" && !content ? false : card.active,
      currentFacts: card.currentFacts ? (c.operation === "append" ? card.currentFacts : card.currentFacts.map(updateFact).filter(Boolean)) : undefined,
      recentDevelopments: c.operation === "append" ? card.recentDevelopments : card.recentDevelopments?.map(updateFact).filter(Boolean),
      archivedFacts: c.operation === "append" ? card.archivedFacts : [card.archivedFacts, `Previously (${p.sourceTurnId}): ${c.previous || card.content}`].filter(Boolean).join("\n") }
      : makeStoryCard({ id: c.targetId, title: c.title!, type: c.cardType, content, keys: c.triggers, memoryMode: c.cardType === "event" ? "historical" : "living" });
    patch = { storyCards: card ? a.storyCards.map(t => t.id === c.targetId ? after as StoryCard : t) : [...a.storyCards, after as StoryCard] };
  } else if (c.owner === "brain") {
    const brain = before as BrainEntry;
    after = { ...brain, [c.field!]: content, evolvedFields: [...new Set([...(brain.evolvedFields ?? []), c.field!])], updatedAt: timestamp };
    patch = { brains: a.brains.map(t => t.id === c.targetId ? after as BrainEntry : t) };
  } else {
    after = { ...before as ComponentEntry, content, updatedAt: timestamp };
    patch = { components: a.components.map(t => t.id === c.targetId ? after as ComponentEntry : t) };
  }
  const state = worldState(a);
  return { ...patch, worldEvolutionState: { ...state, history: [...state.history, { id: createId("world-history"), proposalId: p.id, change: c, sourceTurnId: p.sourceTurnId, previous: before ?? null, next: after, createdAt: timestamp }] } };
}

/** Undo only the fields changed by this entry. Unrelated later edits survive. */
export function rollbackWorldChange(a: Adventure, id: string): Partial<Adventure> {
  const state = worldState(a), h = state.history.find(e => e.id === id);
  if (!h || h.rolledBack) return {};
  const current = worldTarget(a, h.change);
  if (!current) return {};
  if (!h.previous) {
    if (JSON.stringify(current) !== JSON.stringify(h.next)) return {};
    return { storyCards: a.storyCards.filter(t => t.id !== h.change.targetId), worldEvolutionState: { ...state, history: state.history.map(e => e.id === id ? { ...e, rolledBack: true } : e) } };
  }
  const previous = h.previous as unknown as Record<string, unknown>;
  const applied = h.next as unknown as Record<string, unknown>;
  const live = current as unknown as Record<string, unknown>;
  const restored: Record<string, unknown> = { ...live };
  const fields = h.change.owner === "brain" ? [h.change.field!, "evolvedFields"] : h.change.owner === "storyCard" ? ["content", "currentFacts", "recentDevelopments", "archivedFacts", "active"] : ["content"];
  for (const field of fields) {
    const before = previous[field], after = applied[field], value = live[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (JSON.stringify(value) === JSON.stringify(after)) { restored[field] = before; continue; }
    if (typeof before === "string" && typeof after === "string" && typeof value === "string") {
      let prefix = 0, suffix = 0;
      while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
      while (suffix < Math.min(before.length, after.length) - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
      const inserted = after.slice(prefix, after.length - suffix), removed = before.slice(prefix, before.length - suffix);
      if (!inserted || value.split(inserted).length !== 2) return {};
      restored[field] = value.replace(inserted, removed);
    } else if (Array.isArray(before) && Array.isArray(after) && Array.isArray(value)) {
      const added = after.filter(v => !before.includes(v)), removed = before.filter(v => !after.includes(v));
      if (added.some(v => !value.includes(v))) return {};
      restored[field] = [...value.filter(v => !added.includes(v)), ...removed];
    } else return {};
  }
  restored.updatedAt = nowIso();
  const patch: Partial<Adventure> = h.change.owner === "storyCard" ? { storyCards: a.storyCards.map(t => t.id === h.change.targetId ? restored as unknown as StoryCard : t) }
    : h.change.owner === "brain" ? { brains: a.brains.map(t => t.id === h.change.targetId ? restored as unknown as BrainEntry : t) }
      : { components: a.components.map(t => t.id === h.change.targetId ? restored as unknown as ComponentEntry : t) };
  return { ...patch, worldEvolutionState: { ...state, history: state.history.map(e => e.id === id ? { ...e, rolledBack: true } : e) } };
}

export function plotTarget(a: Adventure, id: string) {
  const arc = a.components.find(c => c.id === id && c.type === "currentArc" && c.active);
  const thread = worldState(a).threads.find(t => t.id === id);
  return arc ? { objective: arc.arcPremise ?? arc.content, revision: arc.arcState?.revision ?? 0, outcome: arc.arcState?.outcome, phase: arc.arcState?.phase ?? "simmer" } : thread;
}
export function validatePlotEvent(a: Adventure, e: PlotEvent, story: string): string | undefined {
  const target = plotTarget(a, e.targetId);
  if (!worldEnabled(a) || !target || target.outcome || e.objective !== target.objective || e.expectedRevision !== target.revision) return "Missing, concluded, or stale plot objective.";
  if (!["progress", "setback", "revelation", "confrontation", "resolved", "failed", "abandoned"].includes(e.kind)
    || e.certainty !== "confirmed" || !quote(story, e.evidence) || uncertain.test(e.evidence) || !text(e.outcome, 400) || !e.outcome.trim() || !story.includes(e.outcome)) return "Plot event is unsupported or unconfirmed.";
  if (a.worldEvolutionSettings!.plotProgression === "off") return "Plot progression is disabled.";
  if (typeof e.offscreen !== "boolean" || typeof e.autonomous !== "boolean") return "Plot event requires explicit autonomy/offscreen classification.";
  const offscreen = e.offscreen || /\b(?:meanwhile|elsewhere|unbeknownst|offscreen)\b/i.test(e.evidence);
  if ((offscreen && !a.worldEvolutionSettings!.offscreenEvents) || ((e.autonomous || offscreen) && a.worldEvolutionSettings!.npcAutonomy !== "independent")) return "Independent/offscreen plot events are disabled.";
  if (["resolved", "failed", "abandoned"].includes(e.kind)) {
    const r = e.resolution;
    const anchors = target.objective.toLowerCase().match(/[a-z]{5,}/g)?.filter(w => !["their", "about", "there", "which", "every", "discover", "defeat", "investigate", "resolve", "complete"].includes(w)) ?? [];
    if (!r || r.centralObjective !== true || !Array.isArray(r.remainingObstacles) || r.remainingObstacles.length !== 0
      || r.verdict !== (e.kind === "resolved" ? "victory" : e.kind === "failed" ? "failure" : "abandonment")
      || !quote(story, r.closureEvidence) || uncertain.test(r.closureEvidence)
      || !anchors.length || !anchors.some(w => r.closureEvidence.toLowerCase().includes(w))
      || /\b(?:subordinate|one suspect|only a|still unresolved|remains? unknown|temporary|partial)\b/i.test(r.closureEvidence)
      || !/\b(?:solved|concluded|ended|complete[ds]?|permanently|definitively|no longer|abandon\w*|renounc\w*|destroyed|exposed|confessed|confesses|disband\w*|surrender\w*)\b/i.test(r.closureEvidence)) return "Central objective has no definitive closure; record progress or request review.";
  }
}
export function eventPhase(e: PlotEvent): PlotThread["phase"] {
  if (["resolved", "failed", "abandoned"].includes(e.kind)) return "aftermath";
  if (e.resolution?.verdict === "partial" || e.kind === "setback" || e.kind === "progress") return "escalate";
  return "break";
}

export interface WorldEnvelope { updates?: unknown[]; plotEvents?: unknown[]; worldChanges?: unknown[]; newPlots?: unknown[] }
export function worldEvolutionActions(a: Adventure, context: ContextBuildResult, envelope: WorldEnvelope, story: string, sourceTurnId: string): AdventureAction[] {
  if (!worldEnabled(a)) return [];
  const actions: AdventureAction[] = [], errors: string[] = [];
  const changedTargets = new Set<string>(), eventTargets = new Set<string>();
  const newThreads: { id: string; objective: string }[] = [];
  let slots = Math.max(0, MAX_WORLD_RECORDS - ((envelope as WorldEnvelope & { updates?: unknown[] }).updates?.length ?? 0));
  let outputChars = 0;
  const takeRecord = (raw: unknown) => {
    if (slots <= 0) { errors.push("Structured record count exceeds four shared records."); return false; }
    slots--;
    const size = JSON.stringify(raw)?.length ?? 0;
    outputChars += size;
    if (size > MAX_WORLD_RECORD_CHARS || approximateTokenCount(JSON.stringify(raw)) > 600 || outputChars > MAX_WORLD_OUTPUT_CHARS) { errors.push("World output exceeds compact serialized limits."); return false; }
    return true;
  };
  const visible = new Set(context.sections.flatMap(s => s.items.map(i => i.id)));
  for (const raw of (envelope.worldChanges ?? []).slice(0, MAX_WORLD_RECORDS)) {
    if (!takeRecord(raw)) continue;
    const c = raw as WorldChange;
    const error = validateWorldChange(a, c, story);
    if (error || c.operation !== "create" && !visible.has(c.targetId)) { errors.push(error ?? "World target omitted from context."); continue; }
    if (changedTargets.has(c.targetId)) { errors.push("Duplicate world target in one response; review changes together."); continue; }
    changedTargets.add(c.targetId);
    const timestamp = nowIso();
    const proposal: MemoryProposal = { id: createId("proposal"), proposedType: c.owner === "storyCard" ? "storyCard" : c.owner === "brain" ? "brainUpdate" : "plotEssentialsUpdate",
      targetId: c.targetId, title: c.title ?? (worldTarget(a, c) as StoryCard | undefined)?.title ?? c.targetId, content: c.content, sourceText: c.evidence,
      sourceTurnId, worldChange: c, rationale: c.reason, requiresReview: changeNeedsReview(a, c), suggestedTriggers: c.triggers ?? [], confidence: 0.8, status: "pending", createdAt: timestamp, updatedAt: timestamp };
    actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
  }
  for (const raw of (envelope.newPlots ?? []).slice(0, MAX_WORLD_RECORDS)) {
    if (!takeRecord(raw)) continue;
    const p = raw as Record<string, unknown>;
    if (!p || !text(p.id, 120) || !p.id.trim() || !text(p.title, 120) || !p.title.trim() || !text(p.objective, 300) || !p.objective.trim()
      || !quote(story, p.evidence) || uncertain.test(p.evidence) || !Array.isArray(p.participants) || !p.participants.length || p.participants.length > 4
      || p.participants.some(id => typeof id !== "string" || !visible.has(id) || ![...a.storyCards, ...a.brains].some(t => t.id === id))
      || a.worldEvolutionSettings!.newPlotGeneration === "off"
      || worldState(a).threads.length + newThreads.length >= MAX_ACTIVE_PLOTS
      || [...worldState(a).threads, ...(worldState(a).archivedThreads ?? []), ...newThreads].some(t => t.id === p.id || t.objective === p.objective)) { errors.push("New plot is ungrounded, duplicate, at capacity, or prohibited."); continue; }
    if (typeof p.offscreen !== "boolean" || typeof p.autonomous !== "boolean"
      || (p.offscreen && !a.worldEvolutionSettings!.offscreenEvents) || ((p.autonomous || p.offscreen) && a.worldEvolutionSettings!.npcAutonomy !== "independent")) { errors.push("New plot violates autonomy/offscreen permissions."); continue; }
    newThreads.push({ id: p.id, objective: p.objective });
    actions.push({ type: "REGISTER_PLOT_THREAD", thread: { id: p.id, title: p.title, objective: p.objective, participants: p.participants as string[], originEvidence: p.evidence, sourceTurnId, phase: "simmer", revision: 0, events: [], autonomous: p.autonomous, offscreen: p.offscreen, importance: typeof p.importance === "number" ? Math.max(0, Math.min(3, Math.floor(p.importance))) : 0 } });
  }
  for (const raw of (envelope.plotEvents ?? []).slice(0, MAX_WORLD_RECORDS)) {
    if (!takeRecord(raw)) continue;
    if (!raw || typeof raw !== "object") { errors.push("Malformed plot event."); continue; }
    const rawEvent = raw as PlotEvent;
    const e: PlotEvent = { ...rawEvent, sourceTurnId, turn: a.activeState.turn };
    const error = validatePlotEvent(a, e, story);
    if (error) { errors.push(error); continue; }
    if (eventTargets.has(e.targetId)) { errors.push("Duplicate plot revision in one response."); continue; }
    eventTargets.add(e.targetId);
    actions.push({ type: "APPLY_PLOT_EVENT", event: e });
  }
  if (errors.length) {
    actions.push({ type: "SET_WORLD_ISSUE", issue: { id: `world-issue:${sourceTurnId}`, sourceTurnId, status: "unrecorded", reason: errors.join(" ") } });
  } else if (actions.length && worldState(a).issues.some(i => i.sourceTurnId === sourceTurnId && i.status === "unrecorded")) {
    actions.push({ type: "SET_WORLD_ISSUE", issue: { id: `world-issue:${sourceTurnId}`, sourceTurnId, status: "recovered", reason: "Accepted narration recovered through the existing memory path." } });
  }
  return actions;
}

/** Select active and historical plots by scene involvement, recency and explicit importance. */
export function selectedWorldPlots(a: Adventure, scene: string): PlotThread[] {
  const state = worldState(a);
  const words = new Set((scene.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []));
  const score = (t: PlotThread) => {
    const terms = (t.title + " " + t.objective + " " + t.participants.map(id => a.storyCards.find(c => c.id === id)?.title ?? a.brains.find(b => b.id === id)?.characterName ?? "").join(" ")).toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [];
    return terms.filter(w => words.has(w)).length * 100 + (t.importance ?? 0) * 10 + Math.min(9, t.events.at(-1)?.turn ?? 0);
  };
  const active = state.threads.filter(t => !t.outcome).sort((a, b) => score(b) - score(a)).slice(0, 4);
  const historical = [...(state.archivedThreads ?? []), ...state.threads.filter(t => t.outcome)]
    .filter(t => score(t) >= 100).sort((a, b) => score(b) - score(a)).slice(0, 2);
  return [...active, ...historical];
}

export function selectedWorldTargets(a: Adventure, ids: Set<string>, scene: string) {
  const words = new Set(scene.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const participants = new Set(selectedWorldPlots(a, scene).flatMap(t => t.participants));
  const score = (id: string, name: string, content: string, triggers: string[] = [], updatedTurn?: number) => {
    const names = name.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const terms = new Set(content.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    return names.filter(w => words.has(w)).length * 100 + [...terms].filter(w => words.has(w)).length * 3 + (participants.has(id) ? 50 : 0)
      + (triggers.some(key => key.trim() && scene.toLowerCase().includes(key.toLowerCase())) ? 80 : 0)
      + (updatedTurn !== undefined ? Math.max(0, 10 - (a.activeState.turn - updatedTurn)) : 0);
  };
  const groups = [
    a.storyCards.filter(c => c.active && ids.has(c.id) && c.memoryMode !== "historical" && c.type !== "event").map(c => ({ id: c.id, owner: "storyCard", revision: c.updatedAt, protection: c.evolutionProtection ? { betrayal: !!c.evolutionProtection.betrayal, identity: !!c.evolutionProtection.identity } : undefined, score: score(c.id, c.title, c.content + " " + (c.recentDevelopments ?? []).join(" "), c.keys, c.lastAutoUpdateTurn) })),
    a.brains.filter(b => b.active && ids.has(b.id)).map(b => ({ id: b.id, owner: "brain", revision: b.updatedAt, protection: undefined, score: score(b.id, b.characterName, b.currentState + " " + b.recentDevelopments, b.triggers, b.lastUpdatedTurn) })),
    a.components.filter(c => c.active && ids.has(c.id) && c.type === "plotEssentials").map(c => ({ id: c.id, owner: "plotEssentials", revision: c.updatedAt, protection: undefined, score: score(c.id, c.title, c.content) })),
  ].map(group => group.filter(t => t.id.length <= 160 && t.revision.length <= 80).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)));
  // Reserve representation for eligible owners, then fill by scene relevance.
  const selected = groups.flatMap(group => group.slice(0, 1));
  const remaining = groups.flatMap(group => group.slice(1)).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  return [...selected, ...remaining].slice(0, 4);
}

export function worldEvolutionInstruction(a: Adventure, ids: Set<string>, scene = a.messages.slice(-4).map(m => m.content).join(" ")): string {
  if (!worldRuntimeActive(a)) return "";
  const s = a.worldEvolutionSettings!;
  const targets = selectedWorldTargets(a, ids, scene).map(t => [t.id, t.owner, t.revision, t.protection]);
  const plots = s.plotProgression === "off" ? [] : [...a.components.filter(c => c.active && ids.has(c.id) && c.type === "currentArc" && !c.arcState?.outcome).map(c => [c.id, c.arcState?.revision ?? 0]),
    ...worldState(a).threads.filter(t => ids.has(t.id) && !t.outcome).map(t => [t.id, t.revision])].filter(t => String(t[0]).length <= 160 && typeof t[1] === "number" && Number.isFinite(t[1])).slice(0, 4);
  const policy = `progress=${s.plotProgression}, closure=${s.plotResolution}, newPlots=${s.newPlotGeneration}, autonomy=${s.npcAutonomy}, offscreen=${s.offscreenEvents}, development=${s.characterDevelopment}, relationships=${s.relationshipEvolution}, hidden=${s.hiddenMotivations}, betrayal=${s.betrayal}, redemption=${s.redemption}, reinterpret=${s.canonReinterpretation}`;
  return `\n[WORLD EVOLUTION] ${policy}. Quiet scenes need no updates or successor conflicts. Narration obeys permissions. No autonomous betrayal when Off. Negative trust is not betrayal; temporary reactions and relationships are separate from durable development.
Prioritize confirmed plot closure and canon changes; keep relevant thoughts/relationships. All updates/plotEvents/worldChanges/newPlots SHARE 4 records, 4800 serialized characters /1200 estimated tokens total; each record <=2400 characters/600 estimated tokens, text fields <=800, reason<=200. Evidence/outcome quote accepted story; certainty:"confirmed", autonomous/offscreen booleans required. No rumors/plans.
${plots.length ? 'plotEvents:{targetId,expectedRevision,objective(exact context objective),kind:progress|setback|revelation|confrontation|resolved|failed|abandoned,evidence,outcome,certainty,autonomous,offscreen}. Plot IDs/revisions:' + JSON.stringify(plots) + '. Terminal requires resolution:{verdict:victory|failure|abandonment,centralObjective:true,remainingObstacles:[],closureEvidence}. Quote must conclude the CENTRAL objective; subordinate wins are progress.' : ''}
${targets.length && (s.characterDevelopment || s.canonReinterpretation !== "off") ? 'worldChanges:{owner,targetId,operation:create|append|replace|remove|supersede|resolve,expectedRevision,previous,content,evidence,reason,requiresReview,certainty,effects:[],autonomous,offscreen}. Eligible [id,owner,revision,protection]:' + JSON.stringify(targets) + '. Previous quotes current field; supersede obsolete truth, never append contradictions. Brain adds field and knowledgeEvidence; durable allegiance belongs on cards. Create adds title,cardType,triggers,null revision,empty previous.' : ''}
Every AI update classifies effects:development|betrayal|redemption|hiddenMotivation|reinterpretation|identity; ambiguous changes need review. Earned adds motivationEvidence. Protections override settings; reinterpretation Review needs approval.
${s.newPlotGeneration !== "off" ? 'newPlots:{id,title,objective,participants:[existing IDs],evidence,autonomous,offscreen}. Established major conflicts only; <=12 active.' : ''} [/WORLD EVOLUTION]`;
}
