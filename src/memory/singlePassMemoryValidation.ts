import type { Adventure, MemoryProposal, SinglePassMemoryCheckpoint, SinglePassMemoryFinding, SinglePassMemorySourceResult } from "../types/adventure";
import { bindPlacement, characterProfileChangeError, placementValidationError } from "./storyCardPlacement";
import { makeStoryCardSuggestion, storyCardTargets } from "./storyCardSuggestions";
import { proposalCoverage, factsCovered } from "./factCoverage";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { memoryTargetSnapshot } from "./memoryCycleState";
import { singlePassFindingSchemaError } from "./singlePassMemory";
import { memoryUpdateShapeError } from "./validateMemoryUpdate";
import { buildMemoryAssessmentConditions } from "../triggers/semanticEngine";
import { createId, nowIso } from "../utils/id";

export function singlePassSourceError(a: Adventure, sourceId: string, checkpoint: SinglePassMemoryCheckpoint): string | undefined {
  const source = a.messages.find(m => m.id === sourceId);
  if (!source || source.role !== "assistant" || source.inputMode === "comms" || source.content !== checkpoint.sourceContent || source.memoryEvaluation?.revision !== checkpoint.sourceRevision) return "Source content or revision changed.";
  const evidence = memoryEvidenceWindow(a, sourceId);
  if (JSON.stringify(evidence.map(({ id, content }) => ({ id, content }))) !== JSON.stringify(checkpoint.evidence)) return "Historical evidence changed.";
  return undefined;
}
export function validateSinglePassFinding(a: Adventure, sourceId: string, checkpoint: SinglePassMemoryCheckpoint, f: SinglePassMemoryFinding): string | undefined {
  const sourceError = singlePassSourceError(a, sourceId, checkpoint);
  if (sourceError) return sourceError;
  const schemaError = singlePassFindingSchemaError(f);
  if (schemaError) return schemaError;
  const evidence = memoryEvidenceWindow(a, sourceId);
  if (f.evidenceQuotes.some(q => !evidence.some(m => m.id === q.messageId && m.content.includes(q.quote)))) return "Quote is not verbatim in the permitted historical evidence.";
  if (!f.evidenceQuotes.some(q => q.messageId === sourceId)) return "Missing establishing narrator evidence.";
  const shapeError = memoryUpdateShapeError(f.kind, f.content ?? "");
  if (shapeError) return shapeError;
  if (f.kind === "storyCard") {
    const words = f.content!.trim().split(/\s+/).length;
    if (words > 120) return "Story Card delta exceeds 120 words.";
    if (words > 70 && f.candidateOnly !== true) return "Story Card delta exceeds 70 words; manual review required.";
    const target = a.storyCards.find(c => c.id === f.targetId);
    if (f.targetId && (!target || target.type !== f.storyCardType || f.operation !== "append")) return "Invalid destination type or append operation.";
    if (!f.targetId && f.operation !== "create") return "New Story Cards require create.";
    if (target?.type === "character") return characterProfileChangeError(a, target.id, f.identityChange, evidence.map(m => m.id));
  } else {
    const conditions = buildMemoryAssessmentConditions({ ...a, messages: a.messages.slice(0, a.messages.findIndex(m => m.id === sourceId) + 1), activeState: { ...a.activeState, turn: a.messages.find(m => m.id === sourceId)!.memoryEvaluation!.turn } });
    if (f.kind === "brain") {
      const target = a.brains.find(b => b.id === f.targetId && b.active);
      if (!target || !conditions.brains.some(c => c.id === `brain:${target.id}`)) return "No eligible existing private Brain perspective.";
      for (const [key, value] of Object.entries(f.brainPatch?.thoughts ?? {})) {
        if (!/^[a-z][a-z0-9_]*$/.test(key)) return "Thought keys must use snake_case.";
        if (value !== null && key in target.thoughts && value !== target.thoughts[key]) return "Existing thoughts must not be overwritten.";
        if (value === null && (!(key in target.thoughts) || Object.values({ ...target.thoughts, ...Object.fromEntries(Object.entries(f.brainPatch?.thoughts ?? {}).filter(([, v]) => v !== null)) }).join("\n").length <= (target.condenseThreshold ?? 1600))) return "Only stale existing thoughts above the configured threshold may be archived.";
      }
    } else {
      const target = a.components.find(c => c.id === f.targetId && c.type === f.kind && c.active);
      if (!target || !conditions.plot.some(c => c.id.endsWith(`:${target.id}`))) return "No eligible active Plot destination.";
      if (target.type === "plotEssentials" ? target.autoUpdate !== true : target.autoUpdate === false) return "Plot destination opted out.";
    }
  }
  return undefined;
}
/** Convert only locally validated deltas, through the existing proposal schema. */
export function toSinglePassProposal(a: Adventure, sourceId: string, checkpoint: SinglePassMemoryCheckpoint, f: SinglePassMemoryFinding): MemoryProposal {
  const ids = f.evidenceQuotes.map(q => q.messageId);
  const targetKind = f.kind === "brain" ? "brain" : f.kind === "storyCard" ? "storyCard" : "component";
  const target = f.targetId ? memoryTargetSnapshot(a, targetKind, f.targetId) : undefined;
  const protectedTarget = f.kind === "storyCard" ? a.storyCards.find(c => c.id === f.targetId)?.protected
    : f.kind === "brain" ? a.brains.find(b => b.id === f.targetId)?.protected : a.components.find(c => c.id === f.targetId)?.protected;
  // These cues can require review, never prove a claim. Semantic certainty still requires author judgment.
  const interpretive = /\b(attempt(?:s|ed|ing)?|kiss(?:es|ed|ing)?|romantic|romance|date|yesterday|last week|previously|completed event|invitation|invited|withdrawn|withdrew|unconfirmed|relationship|privately|secretly|felt|feels?|thought|knew|learned|realized|understood|interprets?|believes?|assumes?|might|perhaps|uncertain|unconfirmed)\b/i.test(`${f.content ?? ""} ${JSON.stringify(f.brainPatch ?? {})} ${f.reason} ${f.evidenceQuotes.map(q => q.quote).join(" ")}`);
  const review = f.candidateOnly || Boolean(protectedTarget) || f.storyCardType === "character" || f.eventStatus === "unresolved" || interpretive
    || a.semanticEvaluationSettings.requireApprovalForAutoUpdates;
  let p: MemoryProposal;
  if (f.kind === "storyCard") {
    p = makeStoryCardSuggestion(a, sourceId, checkpoint.sourceContent, { title: f.title, content: f.content!, evidence: f.evidenceQuotes.map(q => q.quote).join("\n"),
      reason: f.reason, type: f.storyCardType, targetId: f.targetId ?? undefined, triggers: f.suggestedTriggers, participants: f.participants,
      candidateOnly: review, evidenceReviewed: true, origin: "model" });
    // The extractor chooses placement. The helper still supplies chronology and established trigger generation.
    const choices = storyCardTargets(a, { title: f.title, content: f.content!, participants: f.participants, type: f.storyCardType });
    p = { ...p, content: f.content!, title: f.title, targetId: f.targetId ?? undefined, storyCardType: f.storyCardType, memoryMode: f.memoryMode,
      cardOperation: f.operation, appendContent: f.operation === "append" ? true : undefined, requiresReview: review || choices.length > 1 || (!f.targetId && choices.length > 0),
      lore: f.storyCardType === "lore" ? { ...p.lore, status: f.eventStatus!, sourceMessageIds: ids } : undefined };
    if (p.storyCardReview) p.storyCardReview = { ...p.storyCardReview, candidateOnly: Boolean(p.requiresReview), operation: f.operation === "append" ? "update" : "create",
      additionalSources: checkpoint.evidence.filter(m => ids.includes(m.id) && m.id !== sourceId) };
    p = bindPlacement(a, p, { kind: f.operation!, reason: f.reason, newFact: f.content!, identityChange: f.identityChange }, ids);
  } else {
    const types = { brain: "brainUpdate", plotEssentials: "plotEssentialsUpdate", activePressure: "plotPressureUpdate", currentArc: "currentArcUpdate" } as const;
    p = { id: createId("proposal"), sourceTurnId: sourceId, sourceText: f.evidenceQuotes.map(q => q.quote).join("\n"), proposedType: types[f.kind],
      title: f.title, content: f.kind === "brain" ? JSON.stringify(f.brainPatch) : f.content!, targetId: f.targetId!,
      suggestedTriggers: [], confidence: review ? 0.45 : 0.8, rationale: f.reason, status: "pending", requiresReview: review, createdAt: nowIso(), updatedAt: nowIso() };
  }
  p.evaluationSource = { messages: checkpoint.evidence, target };
  return p;
}
export function validateSinglePassSource(a: Adventure, result: SinglePassMemorySourceResult, checkpoint: SinglePassMemoryCheckpoint) {
  const sourceError = singlePassSourceError(a, result.sourceId, checkpoint);
  const rejected = [...result.rejected];
  const proposals: Array<{ index: number; findingIndex: number; proposal: MemoryProposal }> = [];
  const suppressed: number[] = [];
  result.findings.forEach((finding, findingIndex) => {
    const index = result.findingIndexes?.[findingIndex] ?? findingIndex;
    const error = sourceError ?? validateSinglePassFinding(a, result.sourceId, checkpoint, finding);
    if (error) { rejected.push({ index, reason: error }); return; }
    const proposal = toSinglePassProposal(a, result.sourceId, checkpoint, finding);
    const placementError = placementValidationError(a, proposal);
    if (placementError) { rejected.push({ index, reason: placementError }); return; }
    const brain = finding.kind === "brain" ? a.brains.find(b => b.id === finding.targetId) : undefined;
    const component = a.components.find(c => c.id === finding.targetId);
    const brainValues = finding.kind === "brain" ? Object.values(finding.brainPatch ?? {}).flatMap(v => typeof v === "string" ? [v] : Object.values(v).filter((t): t is string => typeof t === "string")) : [];
    const priorBrain = brain ? [brain.currentState, brain.relationshipPressure, brain.emotionalInterpretation, brain.recentDevelopments, brain.notes, ...Object.values(brain.thoughts)] : [];
    const covered = proposalCoverage(a, proposal) || (finding.kind === "brain" && brainValues.length > 0
      && brainValues.every(value => factsCovered(value, priorBrain)))
      || (!["brain", "storyCard"].includes(finding.kind) && Boolean(component) && factsCovered(finding.content!, [component!.content]));
    if (covered) suppressed.push(index);
    else proposals.push({ index, findingIndex, proposal });
  });
  return { proposals, rejected, suppressed, failureReason: sourceError ?? result.failureReason ?? (rejected.length ? "Invalid findings rejected; valid sibling proposals retained. Explicit Retry required." : undefined) };
}
