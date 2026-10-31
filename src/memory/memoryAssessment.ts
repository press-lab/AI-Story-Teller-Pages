import { buildMemoryAssessmentConditions } from "../triggers/semanticEngine";
import { parseMemoryAssessmentBatch, parseMemoryAssessment } from "./assessmentValidation";
import { PLACEMENT_VERSION, STORY_CARD_PLACEMENT_POLICY } from "./storyCardPlacement";
import { matchPatterns } from "../triggers/matching";
import type { Adventure, MemoryAssessmentBatchSource, MemoryAssessmentCheckpoint, MemoryAssessmentDecision, MemoryEvaluationGroup, ProviderConfig } from "../types/adventure";
import { memoryBatchProvider, sendMemoryCompletion } from "../providers/memoryCompletion";
import { safeMemoryFailure } from "../providers/backgroundProvider";
import { memoryCanonMessages } from "./memoryCanon";
import { relevantProposalCoverage } from "./factCoverage";
import { relevantStoryCardInventory, SHARED_STORY_MEMORY_POLICY } from "./storyCardSuggestions";
import { storyCardContextContent } from "./storyCardPolicy";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { latestMemoryTurn } from "./memoryUpdateEvidence";

export const SHARED_MEMORY_ASSESSMENT_POLICY = `SHARED MEMORY ASSESSMENT. One assessment of the latest player/narrator exchange. Return ALL qualifying targets, not a single winner.
Return ONLY a JSON object with this shape: {"plot":{"targets":[],"reason":"explanation"},"storyCards":{"targets":[],"reason":"explanation"},"brains":{"targets":[],"reason":"explanation"},"discovery":{"needed":false,"reason":"explanation","evidenceMessageIds":[]}}. A qualifying target is {"id":"supplied condition ID","delta":"supported new fact","evidenceMessageIds":["supplied source ID"]}. Every field is required, including explicit negative reasons. IDs must be supplied eligible condition IDs. Every delta must cite the establishing narrator source and any necessary contextual evidence. Return empty targets for groups not requested.
Return all four groups: plot, storyCards, brains, discovery.
Every group must contain every required field.
For a negative discovery decision, return:
"needed": false
"reason": "specific reason"
"evidenceMessageIds": []
For a positive discovery decision, include the establishing
source message ID in evidenceMessageIds.
Each target ID must match an eligible condition ID exactly.
Do not construct IDs from character names or titles.
Reference cards without an eligible condition are context,
not valid update targets.
For groups not requested, return empty targets and a reason.
Do not omit fields.
Latest exchange establishes changes; earlier exchanges resolve participants, pronouns, short answers (Yes, tomorrow), messages, off-screen disclosures and continuity. A prior name alone is not a new Brain change. Mentioning an absent character never grants knowledge. Respect authored conditions and private attribution. Consecutive meaningful private changes are eligible without a default cooldown or quota.
Plot Essentials: premise/constraints. Active Pressure: external threat/obligation. Current Arc: established arc progress, never Director phases. Brains: supported private interpretations, distinct for each character. Do not expose private Brain content as public facts or give it to another character.
Story Cards: enduring profiles; Lore: observable events/shared developments. Coverage marked pending/rejected/ignored prevents duplicate suggestions but is NOT canon or proof of knowledge. Account for established and considered facts. Discovery means ADDITIONAL durable developments beyond qualifying existing-card deltas. Do not skip a whole subject because one fact is covered. Invitation acceptance and a separate research agreement can both qualify. Set needed=false only with a supported reason.
${SHARED_STORY_MEMORY_POLICY}`;
const ASSESSMENT_POLICY_VERSION = 1;

type Condition = { id: string; condition: string };
export type AssessmentConditions = Record<Exclude<MemoryEvaluationGroup, "discovery">, Condition[]>;
export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("");
}
/** Actual prompt dependencies, excluding timestamps, UI metadata and unrelated archives. */
function assessmentData(a: Adventure, sourceId: string, conditions: AssessmentConditions) {
  const evidence = memoryEvidenceWindow(a, sourceId).map(({ id, role, content }) => ({ id, role, content }));
  const excerpt = evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n");
  const inventory = relevantStoryCardInventory(a, excerpt);
  const currentCards = a.storyCards.filter(c => inventory.some(i => i.id === c.id) || conditions.storyCards.some(i => i.id === `storyCard:${c.id}`))
    .map(c => ({ id: c.id, title: c.title, type: c.type, content: storyCardContextContent(c), protected: c.protected, keys: c.keys, lore: c.lore, memoryMode: c.memoryMode }));
  const currentPlot = a.components.filter(c => c.active && ["plotEssentials", "activePressure", "currentArc"].includes(c.type))
    .map(c => ({ id: c.id, type: c.type, content: c.content, premise: c.arcPremise, autoUpdate: c.autoUpdate, protected: c.protected }));
  const currentBrains = a.brains.filter(b => conditions.brains.some(i => i.id === `brain:${b.id}`)).map(b => ({ id: b.id, name: b.characterName,
    thoughts: b.thoughts, currentState: b.currentState, relationshipPressure: b.relationshipPressure, emotionalInterpretation: b.emotionalInterpretation,
    recentDevelopments: b.recentDevelopments, notes: b.notes, updatePrompt: b.updatePrompt, updateMode: b.updateMode, condenseThreshold: b.condenseThreshold, protected: b.protected }));
  const coverage = relevantProposalCoverage(a, excerpt, currentCards.map(c => c.id), evidence.map(m => m.id));
  const canon = memoryCanonMessages(a, excerpt, "Assess memory", true);
  return { evidence, excerpt, currentCards, currentPlot, currentBrains, coverage, canon };
}
export async function assessmentInputs(a: Adventure, sourceId: string, conditions: AssessmentConditions) {
  const { evidence, excerpt, currentCards, currentPlot, currentBrains, coverage, canon } = assessmentData(a, sourceId, conditions);
  const common = { version: 1, placementVersion: PLACEMENT_VERSION, policy: STORY_CARD_PLACEMENT_POLICY + SHARED_STORY_MEMORY_POLICY, evidence, canon, currentCards, currentPlot, coverage };
  const fingerprints = {} as Record<MemoryEvaluationGroup, string>;
  for (const group of ["plot", "storyCards", "brains", "discovery"] as const) fingerprints[group] = await fingerprint({ ...common,
    conditions: group === "discovery" ? [] : conditions[group], ...(group === "brains" ? { currentBrains } : {}) });
  const source = a.messages.find(m => m.id === sourceId);
  const sourceFingerprint = await fingerprint({ version: 1, sourceId, revision: source?.memoryEvaluation?.revision,
    evidence, conditions: Object.fromEntries((["plot", "storyCards", "brains"] as const)
      .map(group => [group, conditions[group].map(({ id, condition }) => ({ id, condition }))])) });
  return { evidence, excerpt, currentCards, currentPlot, currentBrains, coverage, canon, fingerprints, sourceFingerprint };
}
export async function assessMemory(a: Adventure, provider: ProviderConfig, sourceId: string, conditions: AssessmentConditions,
  accum: { promptTokens: number; completionTokens: number }) {
  const inputs = await assessmentInputs(a, sourceId, conditions);
  const currentSourceFingerprint = await assessmentSourceFingerprint(a, sourceId, conditions);
  const saved = a.messages.find(m => m.id === sourceId)?.memoryEvaluation?.assessment;
  const prior = saved?.version === 1 && saved.fingerprints && ["plot", "storyCards", "brains", "discovery"].every(g => typeof saved.fingerprints[g as MemoryEvaluationGroup] === "string")
    && (["plot", "storyCards", "brains"] as const).every(g => saved[g] && Array.isArray(saved[g].targets) && typeof saved[g].reason === "string"
      && saved[g].targets.every(t => t && typeof t.id === "string" && typeof t.delta === "string" && Array.isArray(t.evidenceMessageIds)))
    && saved.discovery && typeof saved.discovery.needed === "boolean" && typeof saved.discovery.reason === "string" && Array.isArray(saved.discovery.evidenceMessageIds)
    ? saved : undefined;
  if (prior && (prior.assessmentSourceFingerprint === currentSourceFingerprint
    || prior.reusableState === assessmentSourceState(a, sourceId, conditions))) return { assessment: prior, reused: true, inputs };
  const completed = a.messages.find(m => m.id === sourceId)?.memoryEvaluation?.completedGroups ?? [];
  const needed = (["plot", "storyCards", "brains", "discovery"] as const).filter(g => !completed.includes(g)
    && (!prior || (prior.assessmentSourceFingerprint !== undefined ? prior.assessmentSourceFingerprint !== currentSourceFingerprint
      : prior.sourceFingerprint !== undefined ? prior.sourceFingerprint !== inputs.sourceFingerprint : prior.fingerprints[g] !== inputs.fingerprints[g])));
  if (!needed.length && prior) return { assessment: prior, reused: true, inputs };
  let received = false;
  try {
    const response = await sendMemoryCompletion(a, provider, [
      ...inputs.canon,
      { role: "system", content: SHARED_MEMORY_ASSESSMENT_POLICY },
      { role: "user", content: JSON.stringify({ sourceId, requestedGroups: needed, latestTurn: latestMemoryTurn(a).map(({ id, role, content }) => ({ id, role, content })), storyExcerpt: inputs.evidence,
        conditions: Object.fromEntries(Object.entries(conditions).map(([g, cs]) => [g, needed.includes(g as MemoryEvaluationGroup) ? cs : []])),
        currentPlot: inputs.currentPlot, currentCards: inputs.currentCards, currentBrains: inputs.currentBrains,
        consideredSuggestionsNotCanon: inputs.coverage }) },
    ], "assessment");
    received = true;
    accum.promptTokens += response.usage?.promptTokens ?? 0; accum.completionTokens += response.usage?.completionTokens ?? 0;
    const value = parseMemoryAssessment(response.content, conditions, needed, inputs.evidence.map(e => e.id), sourceId);
    const d = value.discovery;
    const decision = (g: "plot" | "storyCards" | "brains"): MemoryAssessmentDecision => {
      const d = value[g] as MemoryAssessmentDecision;
      return { reason: d.reason, targets: d.targets.map(t => ({ id: t.id, delta: t.delta, evidenceMessageIds: [...t.evidenceMessageIds] })) };
    };
    const assessment: MemoryAssessmentCheckpoint = { version: 1, reusableState: assessmentSourceState(a, sourceId, conditions), assessmentSourceFingerprint: currentSourceFingerprint, sourceFingerprint: inputs.sourceFingerprint, fingerprints: { ...prior?.fingerprints, ...Object.fromEntries(needed.map(g => [g, inputs.fingerprints[g]])) } as MemoryAssessmentCheckpoint["fingerprints"],
      plot: needed.includes("plot") ? decision("plot") : prior?.plot ?? { targets: [], reason: "Previously completed transaction." },
      storyCards: needed.includes("storyCards") ? decision("storyCards") : prior?.storyCards ?? { targets: [], reason: "Previously completed transaction." },
      brains: needed.includes("brains") ? decision("brains") : prior?.brains ?? { targets: [], reason: "Previously completed transaction." },
      discovery: needed.includes("discovery") ? { needed: d.needed, reason: d.reason, evidenceMessageIds: [...d.evidenceMessageIds] } : prior?.discovery ?? { needed: true, reason: "Legacy unfinished discovery.", evidenceMessageIds: [sourceId] } };
    return { assessment, reused: false, inputs };
  } catch (error) { return { error: safeMemoryFailure(error, received), reused: false, inputs }; }
}

/** Synchronous transaction guard, including negative decisions with no generated
 * destinations. Compare actual inputs again when a result reaches the reducer. */
export function memoryDecisionState(adventure: Adventure, sourceId: string): string {
  const index = adventure.messages.findIndex(m => m.id === sourceId);
  const a = { ...adventure, messages: adventure.messages.slice(0, index + 1) };
  const evidence = memoryEvidenceWindow(a, sourceId).map(({ id, role, content }) => ({ id, role, content }));
  const excerpt = evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n");
  const relevant = new Set(relevantStoryCardInventory(a, excerpt).map(c => c.id));
  const cards = [...a.storyCards.filter(c => relevant.has(c.id)), ...a.storyCards.filter(c => !relevant.has(c.id) && !c.keys.length)].slice(0, 8);
  const meaningful = (entry: object) => Object.fromEntries(Object.entries(entry).filter(([key]) =>
    !["createdAt", "updatedAt", "lastMemoryUpdatedAt", "memoryUpdateHistory", "usageCount", "lastUsedTurn", "lastTriggeredTurn"].includes(key)));
  return JSON.stringify({ version: 1, evidence, pendingBrainDeltas: a.activeState.pendingBrainDeltas ?? [],
    canon: memoryCanonMessages(a, excerpt, "Assess memory", true), cards: cards.map(card => meaningful({ ...card, lastAutoUpdateTurn: undefined })),
    brains: a.brains.filter(b => b.active && (a.activeState.pendingBrainDeltas?.some(d => d.brainId === b.id) || matchPatterns(excerpt, [b.characterName, ...b.triggers].filter(Boolean), "phrase").matched)).map(meaningful),
    plot: a.components.filter(c => c.active && ["plotEssentials", "activePressure", "currentArc"].includes(c.type)).map(meaningful),
    coverage: relevantProposalCoverage(a, excerpt, cards.map(c => c.id), evidence.map(m => m.id)),
    controls: { autoApprove: a.memoryAutoApprove, detection: a.memoryDetectionSettings },
  });
}

/** Stable classification dependencies; coverage status and worker bookkeeping are not canon. */
export async function assessmentSourceFingerprint(adventure: Adventure, sourceId: string, conditions: AssessmentConditions): Promise<string> {
  const index = adventure.messages.findIndex(m => m.id === sourceId);
  const snapshot = { ...adventure, messages: adventure.messages.slice(0, index + 1) };
  return fingerprint(assessmentSourceState(snapshot, sourceId, conditions));
}

/** Exact classification dependencies. Retained only while work is unfinished. */
export function assessmentSourceState(adventure: Adventure, sourceId: string, conditions: AssessmentConditions): string {
  const index = adventure.messages.findIndex(m => m.id === sourceId);
  const snapshot = { ...adventure, messages: adventure.messages.slice(0, index + 1) };
  const source = snapshot.messages.at(-1);
  const inputs = assessmentData(snapshot, sourceId, conditions);
  return JSON.stringify({ policyVersion: ASSESSMENT_POLICY_VERSION, placementVersion: PLACEMENT_VERSION,
    policy: SHARED_MEMORY_ASSESSMENT_POLICY, sourceId, revision: source?.memoryEvaluation?.revision, content: source?.content,
    evidence: inputs.evidence, conditions: Object.fromEntries(Object.entries(conditions).map(([g, cs]) => [g, cs.map(({ id, condition }) => ({ id, condition }))])),
    canon: inputs.canon, cards: inputs.currentCards, brains: inputs.currentBrains, plot: inputs.currentPlot });
}

export async function assessMemoryBatch(adventure: Adventure, provider: ProviderConfig, sourceIds: readonly string[]): Promise<{
  sources: MemoryAssessmentBatchSource[]; invalidSourceIds: string[]; promptTokens: number; completionTokens: number; error?: string;
}> {
  if (sourceIds.length < 1 || sourceIds.length > 3 || new Set(sourceIds).size !== sourceIds.length) throw new Error("Assessment batch requires one to three unique source IDs.");
  const selected = sourceIds.map(id => adventure.messages.find(m => m.id === id));
  if (selected.some(m => !m || m.role !== "assistant" || m.inputMode === "comms" || !m.memoryEvaluation
    || ["complete", "quarantined"].includes(m.memoryEvaluation.status) || m.memoryEvaluation.completedGroups.length === 4
    || !memoryEvidenceWindow(adventure, m.id).some(e => e.id === m.id))) throw new Error("Assessment batch requires queued unfinished narrator sources.");
  const ordered = selected.filter((m): m is NonNullable<typeof m> => Boolean(m)).sort((a, b) => adventure.messages.indexOf(a) - adventure.messages.indexOf(b));
  const groups = ["plot", "storyCards", "brains", "discovery"] as const;
  const prepared = await Promise.all(ordered.map(async source => {
    const snapshot = { ...adventure, messages: adventure.messages.slice(0, adventure.messages.indexOf(source) + 1),
      activeState: { ...adventure.activeState, turn: source.memoryEvaluation!.turn },
      semanticEvaluationSettings: { ...adventure.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(adventure, source.id).length } };
    const conditions = buildMemoryAssessmentConditions(snapshot);
    return { source, snapshot, conditions, inputs: await assessmentInputs(snapshot, source.id, conditions),
      assessmentSourceFingerprint: await assessmentSourceFingerprint(snapshot, source.id, conditions),
      requestedGroups: groups.filter(g => !source.memoryEvaluation!.completedGroups.includes(g)) };
  }));
  // Pool exact references by identity and content. Variant references retain separate IDs.
  const messagePool: Array<{ id: string; role: string; content: string }> = [];
  const canonPool: Array<Record<string, unknown>> = [];
  const cardPool: Array<Record<string, unknown>> = [], brainPool: Array<Record<string, unknown>> = [], plotPool: Array<Record<string, unknown>> = [];
  const add = (pool: Array<Record<string, unknown>>, entry: Record<string, unknown>) => {
    const existing = pool.find(p => JSON.stringify(p) === JSON.stringify(entry));
    if (!existing) pool.push(entry);
    return entry.id as string;
  };
  const sharedCards = prepared.flatMap(p => p.inputs.currentCards);
  const sources = prepared.map(({ source, snapshot, conditions, inputs, requestedGroups }) => {
    inputs.evidence.forEach(e => add(messagePool, e));
    const canonIds = inputs.canon.map(e => {
      const card = sharedCards.find(c => e.content === "Canon story card: " + c.title + "\n" + c.content);
      const plot = inputs.currentPlot.find(p => {
        const component = snapshot.components.find(c => c.id === p.id);
        return component && e.content === "Canon component: " + component.title + "\n" + p.content;
      });
      const reference = card ? { role: e.role, prefix: "Canon story card: " + card.title + "\n", cardId: card.id }
        : plot ? { role: e.role, prefix: e.content.slice(0, e.content.length - plot.content.length), plotId: plot.id }
        : { role: e.role, content: e.content };
      const existing = canonPool.find(p => JSON.stringify({ ...p, id: undefined }) === JSON.stringify({ ...reference, id: undefined }));
      if (existing) return existing.id;
      const id = `canon:${canonPool.length}`; canonPool.push({ ...reference, id }); return id;
    });
    return { sourceId: source.id, requestedGroups, canonIds, evidenceMessageIds: inputs.evidence.map(e => e.id),
      latestTurnMessageIds: latestMemoryTurn(snapshot).map(m => m.id), eligibleConditions: Object.fromEntries(Object.entries(conditions).map(([g, cs]) => [g, cs.map(({ id, condition }) => ({ id, condition }))])),
      cardIds: inputs.currentCards.map(c => add(cardPool, c)), brainIds: inputs.currentBrains.map(b => add(brainPool, b)),
      plotIds: inputs.currentPlot.map(p => add(plotPool, p)), consideredSuggestionsNotCanon: inputs.coverage };
  });
  const sourceInputs = prepared.map(p => ({ sourceId: p.source.id, conditions: p.conditions, requestedGroups: p.requestedGroups,
    evidenceMessageIds: p.inputs.evidence.map(e => e.id) }));
  const usage = { promptTokens: 0, completionTokens: 0 };
  const batchProvider = memoryBatchProvider(provider, ordered.map(s => s.id));
  // Preserve the caller's cancellation guard when adding request attribution.
  const response = await sendMemoryCompletion(adventure, batchProvider, [
    { role: "system", content: `SHARED MEMORY ASSESSMENT BATCH\n${SHARED_MEMORY_ASSESSMENT_POLICY}\nThe user payload shares reference pools. Classify each source independently using ONLY its eligibleConditions, requestedGroups, evidenceMessageIds and references named by its canonIds, cardIds, brainIds and plotIds. Reconstruct canon reference content from prefix plus the named pool entry content. Do not borrow another source's references or private knowledge. Return {"sources":[{"sourceId":"supplied source ID","plot":{"targets":[],"reason":"..."},"storyCards":{"targets":[],"reason":"..."},"brains":{"targets":[],"reason":"..."},"discovery":{"needed":false,"reason":"...","evidenceMessageIds":[]}}]}. Return exactly one complete record per source in input order. Each positive decision must cite its establishing source. Earlier evidence is continuity only; never cite a later narrator. Keep distinct events and outcomes separate, attempted acts are not completed acts, private interpretations are not public Lore and knowledge is never shared between characters without evidence.` },
    { role: "user", content: JSON.stringify({ version: 1, canonPool, cardPool, brainPool, plotPool, messagePool, sources }) },
  ], "assessment");
  usage.promptTokens += response.usage?.promptTokens ?? 0; usage.completionTokens += response.usage?.completionTokens ?? 0;
  const parsed = parseMemoryAssessmentBatch(response.content, sourceInputs);
  const repairError = parsed.invalidSourceIds.length ? "memory_assessment_batch_invalid: Incomplete sources require explicit retry; valid siblings were saved." : undefined;
  return { ...usage, ...(repairError ? { error: repairError } : {}), invalidSourceIds: parsed.invalidSourceIds, sources: prepared.flatMap(p => {
    const valid = parsed.valid.find(v => v.sourceId === p.source.id);
    return valid ? [{ sourceId: p.source.id, sourceContent: p.source.content, sourceRevision: p.source.memoryEvaluation!.revision,
      evidence: p.inputs.evidence.map(({ id, content }) => ({ id, content })), assessment: { version: 1 as const,
        reusableState: assessmentSourceState(p.snapshot, p.source.id, p.conditions),
        assessmentSourceFingerprint: p.assessmentSourceFingerprint, sourceFingerprint: p.inputs.sourceFingerprint,
        fingerprints: p.inputs.fingerprints, ...valid.decision } }] : [];
  }) };
}

/** Rebase only a known automatic reducer transition. An earlier author edit makes
 * the before-state mismatch, so it cannot be hidden by a later automatic write.
 * Classification remains source-bound; downstream coverage and review stay live. */
export function rebaseAutomaticAssessments(before: Adventure, after: Adventure): Adventure {
  if (before === after || (before.storyCards === after.storyCards && before.brains === after.brains && before.components === after.components)) return after;
  let changed = false;
  const messages = after.messages.map(message => {
    const evaluation = message.memoryEvaluation;
    const checkpoint = evaluation?.assessment;
    const previous = before.messages.find(m => m.id === message.id)?.memoryEvaluation?.assessment;
    if (!checkpoint?.reusableState || !previous?.reusableState || evaluation?.status === "complete") return message;
    const snapshot = (a: Adventure) => ({ ...a, messages: a.messages.slice(0, a.messages.findIndex(m => m.id === message.id) + 1),
      activeState: { ...a.activeState, turn: evaluation!.turn },
      semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, message.id).length } });
    const old = snapshot(before), next = snapshot(after);
    const oldConditions = buildMemoryAssessmentConditions(old), nextConditions = buildMemoryAssessmentConditions(next);
    const ids = (conditions: AssessmentConditions) => JSON.stringify(Object.fromEntries(Object.entries(conditions)
      .map(([group, entries]) => [group, entries.map(({ id, condition }) => ({ id, condition }))])));
    if (ids(oldConditions) !== ids(nextConditions) || previous.reusableState !== assessmentSourceState(old, message.id, oldConditions)) return message;
    const reusableState = assessmentSourceState(next, message.id, nextConditions);
    if (reusableState === checkpoint.reusableState) return message;
    changed = true;
    return { ...message, memoryEvaluation: { ...evaluation!, assessment: { ...checkpoint, reusableState } } };
  });
  return changed ? { ...after, messages } : after;
}
