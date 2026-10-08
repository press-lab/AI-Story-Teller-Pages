import type { Adventure, AdventureAction, BrainEntry, ComponentEntry, ContextBuildResult, MemoryProposal, PlotEvent, PlotThread, StoryCard, WorldChange, WorldEffect, WorldEvolutionState } from "../types/adventure";
import { makeStoryCard } from "../state/defaults";
import { createId, nowIso } from "../utils/id";

export const MAX_WORLD_RECORDS = 4;
export const worldEnabled = (a: Adventure) => a.worldEvolutionSettings?.enabled === true;
export const worldRuntimeActive = (a: Adventure) => worldEnabled(a) && (a.components.some(c => c.type === "currentArc" && c.active) || worldState(a).threads.length > 0);
export const worldState = (a: Adventure): WorldEvolutionState => a.worldEvolutionState ?? { threads: [], history: [], issues: [] };
const text = (v: unknown, max = 1200): v is string => typeof v === "string" && v.length <= max && !/[<>]/.test(v);
const quote = (source: string, evidence: unknown): evidence is string => text(evidence, 800) && evidence.trim().length >= 12 && source.includes(evidence);
const uncertain = /\b(?:rumou?r|perhaps|might|may have|plans? to|intends? to|would|supposedly|allegedly|suspects?|claims? that)\b/i;

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

/** Shared by every automatic write path; declaring a different proposal kind cannot bypass a permission. */
export function mutationPermissionError(a: Adventure, targetId: string | undefined, content: string, effects: WorldEffect[] = [], development = false): string | undefined {
  const all = new Set([...effects, ...inferredEffects(content)]);
  const characters = characterForTarget(a, targetId, content);
  if (all.has("betrayal") && characters.some(c => c.evolutionProtection?.betrayal)) return "Character is protected from betrayal.";
  if ((all.has("identity") || all.has("reinterpretation")) && characters.some(c => c.evolutionProtection?.identity)) return "Character identity is protected.";
  if (!worldEnabled(a)) return;
  const s = a.worldEvolutionSettings!;
  if (all.has("betrayal") && s.betrayal === "off") return "Betrayal is disabled.";
  if (all.has("redemption") && s.redemption === "off") return "Redemption is disabled.";
  if (all.has("hiddenMotivation") && !s.hiddenMotivations) return "Hidden motivations are disabled.";
  if (all.has("reinterpretation") && s.canonReinterpretation === "off") return "Canon reinterpretation is disabled.";
  if ((development || all.has("identity") || all.has("redemption") || all.has("betrayal")) && !s.characterDevelopment) return "Character development is disabled.";
}

export function worldTarget(a: Adventure, c: WorldChange): StoryCard | BrainEntry | ComponentEntry | undefined {
  return c.owner === "storyCard" ? a.storyCards.find(t => t.id === c.targetId)
    : c.owner === "brain" ? a.brains.find(t => t.id === c.targetId)
      : a.components.find(t => t.id === c.targetId && t.type === "plotEssentials");
}
export function targetValue(a: Adventure, c: WorldChange): string {
  const target = worldTarget(a, c);
  return target ? c.owner === "brain" ? (target as BrainEntry)[c.field ?? "currentState"] : (target as StoryCard | ComponentEntry).content : "";
}
export function changeNeedsReview(a: Adventure, c: WorldChange): boolean {
  const target = worldTarget(a, c);
  return c.requiresReview || !!target?.protected || c.owner === "plotEssentials"
    || ["remove", "replace", "supersede", "resolve"].includes(c.operation) || c.effects.length > 0
    || inferredEffects(c.content + " " + c.evidence).length > 0;
}

export function validateWorldChange(a: Adventure, c: WorldChange, acceptedStory: string): string | undefined {
  if (!worldEnabled(a)) return "World evolution is not enabled.";
  if (!c || !["storyCard", "brain", "plotEssentials"].includes(c.owner) || !["create", "append", "replace", "remove", "supersede", "resolve"].includes(c.operation)
    || !text(c.targetId, 160) || !c.targetId.trim() || !text(c.previous, 6000) || !text(c.content, 2000)
    || !text(c.reason, 500) || !c.reason.trim() || typeof c.requiresReview !== "boolean"
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
  const effects = [...new Set([...c.effects, ...inferredEffects(c.content + " " + c.evidence)])];
  const error = mutationPermissionError(a, c.characterId ?? c.targetId, c.content + " " + c.evidence, effects,
    c.owner === "storyCard" && (target as StoryCard | undefined)?.type === "character");
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
    after = card ? { ...card, content, updatedAt: timestamp, active: c.operation === "remove" && !content ? false : card.active,
      currentFacts: card.currentFacts ? (c.operation === "append" ? card.currentFacts : c.operation === "replace" ? content.split("\n").filter(Boolean) : card.currentFacts.map(f => f.replace(c.previous, c.content)).filter(Boolean)) : undefined,
      recentDevelopments: c.operation === "append" ? card.recentDevelopments : [],
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

export function rollbackWorldChange(a: Adventure, id: string): Partial<Adventure> {
  const state = worldState(a), h = state.history.find(e => e.id === id);
  if (!h || h.rolledBack || worldTarget(a, h.change)?.updatedAt !== h.next.updatedAt || targetValue(a, h.change) !== (h.change.owner === "brain" ? (h.next as BrainEntry)[h.change.field!] : (h.next as StoryCard).content)) return {};
  const previous = h.previous ? { ...h.previous, updatedAt: nowIso() } : null;
  const patch: Partial<Adventure> = h.change.owner === "storyCard" ? { storyCards: previous ? a.storyCards.map(t => t.id === h.change.targetId ? previous as StoryCard : t) : a.storyCards.filter(t => t.id !== h.change.targetId) }
    : h.change.owner === "brain" ? { brains: a.brains.map(t => t.id === h.change.targetId ? previous as BrainEntry : t) }
      : { components: a.components.map(t => t.id === h.change.targetId ? previous as ComponentEntry : t) };
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
    || e.certainty !== "confirmed" || !quote(story, e.evidence) || uncertain.test(e.evidence) || !text(e.outcome, 400) || !e.outcome.trim()) return "Plot event is unsupported or unconfirmed.";
  if (a.worldEvolutionSettings!.plotProgression === "off") return "Plot progression is disabled.";
  if ((e.offscreen && !a.worldEvolutionSettings!.offscreenEvents) || ((e.autonomous || e.offscreen) && a.worldEvolutionSettings!.npcAutonomy !== "independent")) return "Independent/offscreen plot events are disabled.";
  if (["resolved", "failed", "abandoned"].includes(e.kind)) {
    const r = e.resolution;
    if (!r || !r.centralObjective || !Array.isArray(r.remainingObstacles) || r.remainingObstacles.length !== 0
      || r.verdict !== (e.kind === "resolved" ? "victory" : e.kind === "failed" ? "failure" : "abandonment")
      || !quote(story, r.closureEvidence) || uncertain.test(r.closureEvidence)
      || !/\b(?:solved|concluded|ended|complete[ds]?|permanently|definitively|no longer|abandon\w*|renounc\w*|destroyed|exposed|confessed|confesses|disband\w*|surrender\w*)\b/i.test(r.closureEvidence)) return "Central objective has no definitive closure; record progress or request review.";
  }
}
export function eventPhase(e: PlotEvent): PlotThread["phase"] {
  if (["resolved", "failed", "abandoned"].includes(e.kind)) return "aftermath";
  if (e.resolution?.verdict === "partial" || e.kind === "setback" || e.kind === "progress") return "escalate";
  return "break";
}

export interface WorldEnvelope { plotEvents?: unknown[]; worldChanges?: unknown[]; newPlots?: unknown[] }
export function worldEvolutionActions(a: Adventure, context: ContextBuildResult, envelope: WorldEnvelope, story: string, sourceTurnId: string): AdventureAction[] {
  if (!worldEnabled(a)) return [];
  const actions: AdventureAction[] = [], errors: string[] = [];
  let slots = MAX_WORLD_RECORDS;
  const visible = new Set(context.sections.flatMap(s => s.items.map(i => i.id)));
  for (const raw of (envelope.worldChanges ?? []).slice(0, MAX_WORLD_RECORDS)) {
    if (!slots--) break;
    const c = raw as WorldChange;
    const error = validateWorldChange(a, c, story);
    if (error || c.operation !== "create" && !visible.has(c.targetId)) { errors.push(error ?? "World target omitted from context."); continue; }
    const timestamp = nowIso();
    const proposal: MemoryProposal = { id: createId("proposal"), proposedType: c.owner === "storyCard" ? "storyCard" : c.owner === "brain" ? "brainUpdate" : "plotEssentialsUpdate",
      targetId: c.targetId, title: c.title ?? (worldTarget(a, c) as StoryCard | undefined)?.title ?? c.targetId, content: c.content, sourceText: c.evidence,
      sourceTurnId, worldChange: c, rationale: c.reason, requiresReview: changeNeedsReview(a, c), suggestedTriggers: c.triggers ?? [], confidence: 0.8, status: "pending", createdAt: timestamp, updatedAt: timestamp };
    actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
  }
  for (const raw of (envelope.newPlots ?? []).slice(0, MAX_WORLD_RECORDS)) {
    if (slots-- <= 0) break;
    const p = raw as Record<string, unknown>;
    if (!p || !text(p.id, 120) || !text(p.title, 120) || !p.title.trim() || !text(p.objective, 300) || !p.objective.trim()
      || !quote(story, p.evidence) || uncertain.test(p.evidence) || !Array.isArray(p.participants) || !p.participants.length || p.participants.length > 4
      || p.participants.some(id => typeof id !== "string" || ![...a.storyCards, ...a.brains].some(t => t.id === id))
      || a.worldEvolutionSettings!.newPlotGeneration === "off" || a.worldEvolutionSettings!.plotProgression === "off"
      || worldState(a).threads.some(t => t.id === p.id || t.objective === p.objective)) { errors.push("New plot is ungrounded, duplicate, or prohibited."); continue; }
    if ((p.offscreen && !a.worldEvolutionSettings!.offscreenEvents) || (p.autonomous && a.worldEvolutionSettings!.npcAutonomy !== "independent")) { errors.push("New plot violates autonomy/offscreen permissions."); continue; }
    actions.push({ type: "REGISTER_PLOT_THREAD", thread: { id: p.id, title: p.title, objective: p.objective, participants: p.participants as string[], originEvidence: p.evidence, sourceTurnId, phase: "simmer", revision: 0, events: [] } });
  }
  for (const raw of (envelope.plotEvents ?? []).slice(0, MAX_WORLD_RECORDS)) {
    if (slots-- <= 0) break;
    if (!raw || typeof raw !== "object") { errors.push("Malformed plot event."); continue; }
    const rawEvent = raw as PlotEvent;
    const target = plotTarget(a, rawEvent.targetId);
    const terminal = ["resolved", "failed", "abandoned"].includes(rawEvent.kind);
    const legacyTerminal = terminal && !rawEvent.resolution;
    const e: PlotEvent = { ...rawEvent, sourceTurnId, turn: a.activeState.turn,
      objective: rawEvent.objective ?? target?.objective,
      expectedRevision: rawEvent.expectedRevision ?? target?.revision,
      certainty: rawEvent.certainty ?? "confirmed",
      resolution: rawEvent.resolution ?? (terminal ? {
        verdict: rawEvent.kind === "resolved" ? "victory" : rawEvent.kind === "failed" ? "failure" : "abandonment",
        centralObjective: true, remainingObstacles: [], closureEvidence: rawEvent.evidence,
      } : undefined),
    };
    const error = validatePlotEvent(a, e, story);
    if (error) { errors.push(error); continue; }
    actions.push({ type: "APPLY_PLOT_EVENT", event: e });
  }
  if (errors.length) {
    actions.push({ type: "SET_WORLD_ISSUE", issue: { id: `world-issue:${sourceTurnId}`, sourceTurnId, status: "unrecorded", reason: errors.join(" ") } });
  } else if (worldState(a).issues.some(i => i.sourceTurnId === sourceTurnId && i.status === "unrecorded")) {
    actions.push({ type: "SET_WORLD_ISSUE", issue: { id: `world-issue:${sourceTurnId}`, sourceTurnId, status: "recovered", reason: "Accepted narration recovered through the existing memory path." } });
  }
  return actions;
}

export function worldEvolutionInstruction(a: Adventure, ids: Set<string>): string {
  if (!worldRuntimeActive(a)) return "";
  const s = a.worldEvolutionSettings!;
  const targets = [...a.storyCards.filter(c => ids.has(c.id) && c.memoryMode !== "historical").map(c => ({ id: c.id, owner: "storyCard", revision: c.updatedAt, protection: c.evolutionProtection })),
    ...a.brains.filter(b => ids.has(b.id)).map(b => ({ id: b.id, owner: "brain", revision: b.updatedAt })),
    ...a.components.filter(c => ids.has(c.id) && c.type === "plotEssentials").map(c => ({ id: c.id, owner: "plotEssentials", revision: c.updatedAt }))].slice(0, 8);
  const plots = [...a.components.filter(c => c.active && c.type === "currentArc" && !c.arcState?.outcome).map(c => ({ id: c.id, objective: c.arcPremise ?? c.content, revision: c.arcState?.revision ?? 0 })),
    ...worldState(a).threads.filter(t => !t.outcome).map(t => ({ id: t.id, objective: t.objective, revision: t.revision }))].slice(0, 4);
  return `\n[WORLD EVOLUTION]\nSettings: ${JSON.stringify(s)}. Respect these permissions in prose AND memory. Off means do not invent that development. Active progression pursues meaningful conclusions; Natural follows established choices; Off leaves sandbox scenes alone. Decisive favors closure, openEnded allows continuing conflicts. Occasional plots are selective; frequent allows concurrent developments; neither requires a timer. Reactive NPCs respond to the scene; independent NPCs may pursue goals. Quiet scenes are normal. Do not invent successor masterminds to prolong a solved mystery. Protect player agency and character knowledge.\nIn the SAME memory envelope, optional arrays plotEvents, worldChanges, newPlots share a maximum of 4 records. Use only confirmed accepted story, never rumor/plan. Every evidence is an exact visible quote. Targets: ${JSON.stringify(targets)}. Plots: ${JSON.stringify(plots)}.\nplotEvents: {targetId,expectedRevision,objective,kind:progress|setback|revelation|confrontation|resolved|failed|abandoned,evidence,outcome,certainty:"confirmed",autonomous,offscreen}. Terminal events ALSO require resolution:{verdict:victory|failure|abandonment,centralObjective:true,remainingObstacles:[],closureEvidence}. Closure must explicitly name the central subject and conclude the objective. Clues, suspects, subordinates and temporary victories are partial; never mark them resolved.\nworldChanges: {owner:storyCard|brain|plotEssentials,targetId,operation:create|append|replace|remove|supersede|resolve,expectedRevision,previous,content,evidence,reason,requiresReview,certainty:"confirmed",effects:[],autonomous,offscreen}. Previous is exact current field text; replacement is complete current truth. Archive obsolete truth through supersede/replace, never append a contradiction. Create uses a new ID, null revision, empty previous, title,cardType,triggers. Brain requires existing target, field:currentState|emotionalInterpretation|recentDevelopments|notes and knowledgeEvidence quote. Durable identity/loyalty belongs on character cards, private perspective on Brains, enrolled relationships ONLY via relationshipChange. Effects:development|betrayal|redemption|hiddenMotivation|reinterpretation|identity; list ALL applicable. Earned twists require motivationEvidence quoted from established canon/story. Character protections override permissions; retroactive reinterpretation requires review.\nnewPlots: {id,title,objective,participants:[existing IDs],evidence,autonomous,offscreen}. Only genuinely new established consequential conflicts tied to existing participants, never a routine scene or a mandatory successor.\n[/WORLD EVOLUTION]`;
}
