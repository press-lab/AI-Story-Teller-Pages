import type { Adventure, BrainEntry, ContextBuildResult, DynamicRelationship, MemoryProposal, RelationshipProposal, RelationshipState } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import { mutationPermissionError, worldEnabled } from "./worldEvolution";
export interface RelationshipTarget {
  target: string;
  npc: string;
  relationshipId: string;
  focus: string;
  focusStoryCardId: string;
  revision: number;
}
export function relationshipFocusCard(a: Adventure, r: DynamicRelationship) {
  return a.storyCards.find(c => c.id === r.focusStoryCardId && c.type === "character");
}
export function relationshipTargets(a: Adventure, includedIds: Set<string>): RelationshipTarget[] {
  return a.brains.flatMap(b => (b.relationships ?? [])
    .filter(r => relationshipFocusCard(a, r) && includedIds.has(relationshipItemId(b.id, r.id)))
    .map(r => ({ target: b.id, npc: b.characterName, relationshipId: r.id, focus: relationshipFocusCard(a, r)!.title, focusStoryCardId: r.focusStoryCardId!, revision: r.revision })));
}
export const relationshipItemId = (brainId: string, id: string) => `relationship:${brainId}:${id}`;
export const stateKey = (s: RelationshipState) => JSON.stringify([s.bond, s.status, Object.entries(s.dimensions).sort(([a], [b]) => a.localeCompare(b))]);
export function validRelationshipState(value: unknown): value is RelationshipState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as RelationshipState;
  if (Object.keys(s).some(k => !["bond", "status", "dimensions"].includes(k))) return false;
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[<>]/.test(v);
  return text(s.bond, 120) && text(s.status, 80) && !!s.dimensions && typeof s.dimensions === "object" && !Array.isArray(s.dimensions)
    && Object.keys(s.dimensions).length <= 5 && Object.entries(s.dimensions).every(([k, v]) => text(k, 30) && text(v, 120) && !/^[-+]?\d/.test(v.trim()));
}
export function relationshipText(r: DynamicRelationship, focus = r.focus): string {
  return `Focus: ${focus}\nRevision: ${r.revision}\nBond: ${r.current.bond}\nStatus: ${r.current.status}\n${Object.entries(r.current.dimensions).map(([k,v]) => `${k}: ${v}`).join("\n")}`;
}
export function relationshipIsCurrent(a: Adventure, p: MemoryProposal): boolean {
  if (worldEnabled(a) && !a.worldEvolutionSettings!.relationshipEvolution) return false;
  if (mutationPermissionError(a, p.targetId, p.content + " " + p.sourceText)) return false;
  const t = p.relationship;
  const r = a.brains.find(b => b.id === p.targetId)?.relationships?.find(r => r.id === t?.relationshipId);
  return !!t && !!r && !!relationshipFocusCard(a, r) && t.focusStoryCardId === r.focusStoryCardId && validRelationshipState(t.previous) && validRelationshipState(t.proposed)
    && r.revision === t.revision && stateKey(r.current) === stateKey(t.previous) && stateKey(t.previous) !== stateKey(t.proposed);
}
export function duplicateRelationship(a: Adventure, p: MemoryProposal): boolean {
  const t = p.relationship;
  return !!t && a.activeState.memoryProposals.some(q => q.proposedType === "relationshipUpdate" && q.targetId === p.targetId
    && q.sourceTurnId === p.sourceTurnId && q.relationship?.relationshipId === t.relationshipId
    && stateKey(q.relationship.previous) === stateKey(t.previous) && stateKey(q.relationship.proposed) === stateKey(t.proposed));
}
export function applyRelationship(a: Adventure, p: MemoryProposal): BrainEntry[] {
  if (!relationshipIsCurrent(a, p)) return a.brains;
  const t = p.relationship!;
  return a.brains.map(b => b.id !== p.targetId ? b : { ...b, relationships: b.relationships.map(r => r.id !== t.relationshipId ? r : {
    ...r, current: t.proposed, revision: r.revision + 1,
    history: [...r.history, { id: createId("relationship-history"), sourceTurnId: p.sourceTurnId, state: t.proposed, evidence: p.sourceText, createdAt: nowIso() }],
  }) });
}
/** Review hints only; authored canon is never rewritten. */
export function relationshipConflicts(a: Adventure, brain: BrainEntry, focus: string) {
  return [...a.storyCards.map(c => ({ id: c.id, title: `Story Card: ${c.title}`, content: c.content })),
    ...a.components.filter(c => c.type === "plotEssentials" || c.type === "aiInstructions").map(c => ({ id: c.id, title: c.title, content: c.content }))]
    .filter(c => `${c.title} ${c.content}`.toLowerCase().includes(brain.characterName.toLowerCase()) && `${c.title} ${c.content}`.toLowerCase().includes(focus.toLowerCase()));
}
export function relationshipCandidate(a: Adventure, context: ContextBuildResult, u: Record<string, unknown>, story: string, player: string, sourceTurnId: string): RelationshipProposal | string {
  if (worldEnabled(a) && !a.worldEvolutionSettings!.relationshipEvolution) return "Relationship evolution is disabled.";
  const permission = mutationPermissionError(a, typeof u.target === "string" ? u.target : undefined, JSON.stringify(u.proposed) + " " + u.evidence);
  if (permission) return permission;
  const brain = a.brains.find(b => b.id === u.target && b.active);
  const r = brain?.relationships?.find(r => r.id === u.relationshipId && r.focusStoryCardId === u.focusStoryCardId && relationshipFocusCard(a, r)?.title === u.focus);
  if (!brain || !r || !relationshipFocusCard(a, r)) return "unenrolled Brain-focus target";
  const focus = relationshipFocusCard(a, r)!.title;
  if (!context.sections.some(s => s.items.some(i => i.id === relationshipItemId(brain.id, r.id)))) return "relationship omitted from pre-provider context";
  if (u.revision !== r.revision) return "stale relationship revision";
  if (!validRelationshipState(u.proposed) || stateKey(u.proposed) === stateKey(r.current)) return "invalid or unchanged proposed state";
  if (Object.keys(u.proposed.dimensions).sort().join("|") !== Object.keys(r.current.dimensions).sort().join("|")) return "dimension names must match enrollment";
  const exact = (v: unknown): v is string => typeof v === "string" && v.trim().length >= 12 && v.length <= 800 && [story, player].some(s => s.includes(v));
  if (!exact(u.evidence)) return "evidence must be an exact quote from this turn";
  if (!exact(u.knowledgeEvidence) || !u.knowledgeEvidence.includes(brain.characterName)) return "missing quoted evidence of NPC witnessing or learning the event";
  if (!/\b(?:watch(?:es|ed)?|witness(?:es|ed)?|saw|sees?|hear[ds]?|heard|learn(?:s|ed)?|read[ s]?|tells?|told|says?|said|thanks?|thank(?:ed|s)|realiz(?:es|ed))\b/i.test(u.knowledgeEvidence)
    || /\b(?:did not|didn't|never|could not|couldn't)\s+(?:see|hear|learn|witness|know)\b/i.test(u.knowledgeEvidence)) return "quote does not establish a plausible knowledge path; review the event before proposing";
  if (typeof u.reason !== "string" || !u.reason.trim() || u.reason.length > 600) return "missing or oversized reason";
  const major = r.current.bond !== u.proposed.bond || r.current.status !== u.proposed.status;
  if (major && (!u.evidence.includes(focus) || !u.evidence.includes(brain.characterName)
    || !/\b(?:break up|breaking up|broke up|end our relationship|ended their relationship|no longer|divorce|marry|married|engaged|romance|romantic|partner|relationship|alliance|enemies|reconcile)\b/i.test(u.evidence)
    || (r.current.status !== u.proposed.status && !u.evidence.toLowerCase().includes(u.proposed.status.toLowerCase()))
    || (r.current.bond !== u.proposed.bond && !u.evidence.toLowerCase().includes(u.proposed.bond.toLowerCase())))) return "major transition lacks explicit in-story bond/status evidence; a rude exchange is insufficient";
  const timestamp = nowIso();
  const p: RelationshipProposal = { id: createId("proposal"), proposedType: "relationshipUpdate", targetId: brain.id,
    title: `${brain.characterName} → ${focus}`, sourceTurnId, sourceText: u.evidence,
    content: JSON.stringify(u.proposed), suggestedTriggers: [], confidence: 0.75, status: "pending",
    requiresReview: true, rationale: `${u.reason} Review NPC knowledge and interpretation${major ? "; major bond/status transition" : ""}. Exact quote matching does not establish knowledge.`,
    relationship: { relationshipId: r.id, focus, focusStoryCardId: r.focusStoryCardId, revision: r.revision, previous: r.current, proposed: u.proposed, knowledgeEvidence: u.knowledgeEvidence },
    createdAt: timestamp, updatedAt: timestamp };
  return duplicateRelationship(a, p) ? "duplicate pair/source/transition" : p;
}
