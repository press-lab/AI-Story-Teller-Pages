import type { Adventure, ChatMessage, ProviderConfig, SinglePassMemoryBatchResult, SinglePassMemoryCheckpoint, SinglePassMemoryFinding, SinglePassMemorySourceResult } from "../types/adventure";
import { assessmentInputs, assessmentSourceState, memoryDecisionState } from "./memoryAssessment";
import { buildMemoryAssessmentConditions } from "../triggers/semanticEngine";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { memoryBatchProvider, sendMemoryCompletion } from "../providers/memoryCompletion";
import { STORY_CARD_PLACEMENT_POLICY } from "./storyCardPlacement";
import { SHARED_STORY_MEMORY_POLICY } from "./storyCardSuggestions";
import { generatedStoryCardTriggers } from "./resolveMemoryTarget";
import { createId } from "../utils/id";

/** Exact reference/control guard. Worker bookkeeping and request records are not evidence. */
export function singlePassReferenceState(a: Adventure, sourceId: string): string {
  const snapshot = { ...a, messages: a.messages.slice(0, a.messages.findIndex(m => m.id === sourceId) + 1),
    activeState: { ...a.activeState, turn: a.messages.find(m => m.id === sourceId)?.memoryEvaluation?.turn ?? a.activeState.turn },
    semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, sourceId).length } };
  return JSON.stringify([assessmentSourceState(snapshot, sourceId, buildMemoryAssessmentConditions(snapshot)), memoryDecisionState(snapshot, sourceId)]);
}
export interface PreparedSinglePassMemoryBatch {
  batchId: string;
  checkpoints: Array<{ sourceId: string; checkpoint: SinglePassMemoryCheckpoint }>;
  payload: { references: unknown[]; sources: unknown[] };
}
export async function prepareSinglePassMemoryBatch(a: Adventure, ids: readonly string[]): Promise<PreparedSinglePassMemoryBatch> {
  if (ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length) throw new Error("Select one to three unique narrator sources.");
  const selected = ids.map(id => a.messages.find(m => m.id === id));
  if (selected.some(m => !m || m.role !== "assistant" || m.inputMode === "comms" || m.memoryEvaluation?.pipeline !== "singlePass"
    || ["complete", "quarantined"].includes(m.memoryEvaluation.status) || !memoryEvidenceWindow(a, m.id).some(e => e.id === m.id))) {
    throw new Error("Single-pass extraction requires saved, unfinished, in-story single-pass sources.");
  }
  const ordered = a.messages.filter(m => ids.includes(m.id));
  const batchId = createId("memoryBatch");
  const references: unknown[] = [];
  const pool = (value: unknown) => {
    const serialized = JSON.stringify(value);
    let index = references.findIndex(v => JSON.stringify(v) === serialized);
    if (index < 0) { index = references.length; references.push(value); }
    return index;
  };
  const checkpoints: PreparedSinglePassMemoryBatch["checkpoints"] = [];
  const sources: unknown[] = [];
  for (const source of ordered) {
    const snapshot = { ...a, messages: a.messages.slice(0, a.messages.indexOf(source) + 1),
      activeState: { ...a.activeState, turn: source.memoryEvaluation!.turn },
      semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, source.id).length } };
    const conditions = buildMemoryAssessmentConditions(snapshot);
    const inputs = await assessmentInputs(snapshot, source.id, conditions);
    checkpoints.push({ sourceId: source.id, checkpoint: { batchId, sourceContent: source.content, sourceRevision: source.memoryEvaluation?.revision,
      evidence: inputs.evidence.map(({ id, content }) => ({ id, content })), referenceState: singlePassReferenceState(a, source.id),
      status: "running", findings: [], dispositions: [], acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 } });
    sources.push({ sourceId: source.id, conditions,
      evidence: inputs.evidence.map(pool), canon: inputs.canon.map(entry => {
        const card = inputs.currentCards.find(c => entry.content === "Canon story card: " + c.title + "\n" + c.content);
        if (card) return pool({ role: entry.role, prefix: "Canon story card: " + card.title + "\n", reference: pool(card) });
        const plot = inputs.currentPlot.find(p => entry.content === "Canon component: " + snapshot.components.find(c => c.id === p.id)?.title + "\n" + p.content);
        if (plot) return pool({ role: entry.role, prefix: entry.content.slice(0, -plot.content.length), reference: pool(plot) });
        return pool(entry);
      }), cards: inputs.currentCards.map(pool),
      brains: inputs.currentBrains.map(pool), plot: inputs.currentPlot.map(pool), consideredSuggestionsNotCanon: inputs.coverage.map(pool) });
  }
  return { batchId, checkpoints, payload: { references, sources } };
}
const POLICY = `SINGLE PASS MEMORY EXTRACTION. Identify, classify, generate and select destinations for ALL eligible factual deltas. Return exactly one JSON object: {"sources":[{"sourceId":"supplied ID","findings":[]}]}.
Return one source record for each supplied sourceId, including sources with no findings. Do not return duplicate or unknown source IDs. Each source is independent. Use ONLY its named reference indexes. Canon entries with prefix and reference are reconstructed as prefix plus the referenced entry content. Evidence ends at that narrator; never borrow later evidence or private perspectives. Earlier exchanges resolve attribution; each finding must cite the establishing source and necessary player exchange.
Every finding requires kind (storyCard|brain|plotEssentials|activePressure|currentArc), targetId (existing exact ID or null ONLY for new Story Cards), evidenceQuotes:[{messageId,quote}] with verbatim nonempty quotes, and complete usable content (or brainPatch for brain). Do not return classification without content. No per-source finding quota. Distinct developments stay distinct even with the same participants. Empty findings is a valid evaluation.
Optional Story Card metadata: storyCardType (lore|character|location|custom), operation (append|create), memoryMode (static|living|historical), eventStatus (completed|ongoing|unresolved), suggestedTriggers (reusable specific topic phrases), participants (array). title, reason and candidateOnly are optional. Character appends require identityChange as defined below. Maximum 70 words per Story Card delta.
Brains require an existing eligible Brain ID and structured brainPatch with only currentState, relationshipPressure, emotionalInterpretation, recentDevelopments, notes (strings), thoughts (object of string or null values). Preserve first-person private state and the existing perspective. Thoughts use unique snake_case keys with a turn-prefixed first-person observation, reaction or plan. Do not overwrite existing thoughts. Archive stale old thoughts with null only when the existing condenseThreshold is exceeded, retaining all other old text verbatim. Do not record scene location, presence or stable traits in Brains. No missing-Brain fallback. Never give an absent NPC knowledge without direct evidence of acquisition.
Plot Essentials changes only when premise/constraints change and explicit autoUpdate=true. Active Pressure is immediate unresolved EXTERNAL threat/obligation, never old events. Current Arc is progress within the established arc; never change Director phases. Respect active targets, opt-outs, authored conditions, limits and approval controls. Plot components are operating facts, not event archives. Limits: Plot Essentials 180 words, Active Pressure one sentence at most 45 words, Current Arc at most 500 words. Plot Essentials and Active Pressure use complete replacement text; Current Arc uses only the new eligible arc delta. Respect each surface word limit.
Uncertain relationship outcomes, attempted intimate actions without confirmed outcomes, new enduring traits, ambiguous destinations, private NPC interpretations, protected targets and conflicting certainty require candidateOnly=true. Preserve attributed claims and uncertainty; never invent consent or completed outcomes. An accepted invitation is an agreement, not a completed meeting. Research collaboration is not romance. Never turn one action into a permanent trait.
${STORY_CARD_PLACEMENT_POLICY}
${SHARED_STORY_MEMORY_POLICY}`;
export function buildSinglePassMemoryMessages(batch: PreparedSinglePassMemoryBatch): ChatMessage[] {
  return [{ role: "system", content: POLICY }, { role: "user", content: JSON.stringify(batch.payload) }];
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());
const findingKeys = ["kind", "targetId", "title", "content", "brainPatch", "reason", "evidenceQuotes", "candidateOnly", "storyCardType", "operation", "memoryMode", "eventStatus", "suggestedTriggers", "participants", "identityChange"];
/** Recover metadata only. Never create facts, evidence, patches, or target IDs. */
export function normalizeSinglePassFinding(v: unknown, sourceId: string, adventure?: Adventure, diagnostics: string[] = []): SinglePassMemoryFinding | undefined {
  if (!object(v)) return undefined;
  const f: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v)) {
    if (findingKeys.includes(key)) f[key] = value;
    else diagnostics.push(`Ignored unknown finding field: ${key}.`);
  }
  const target = adventure && (f.kind === "storyCard" ? adventure.storyCards.find(c => c.id === f.targetId)
    : f.kind === "brain" ? adventure.brains.find(b => b.id === f.targetId) : adventure.components.find(c => c.id === f.targetId));
  let recovered = false;
  const missing = (key: string, value: unknown) => {
    if (f[key] === undefined) { f[key] = value; recovered = true; diagnostics.push(`Recovered ${key} locally.`); }
  };
  const words = nonempty(f.content) ? f.content.trim().split(/\s+/) : [];
  const excerpt = words.slice(0, Math.min(8, Math.max(1, words.length - 1))).join(" ").slice(0, 60);
  missing("title", target && ("title" in target ? target.title : target.characterName) || (excerpt || undefined));
  missing("reason", `Extracted from narrator source ${sourceId}.`);
  missing("candidateOnly", true);
  if (f.kind === "storyCard") {
    const card = adventure?.storyCards.find(c => c.id === f.targetId);
    missing("operation", f.targetId === null ? "create" : "append");
    missing("storyCardType", card?.type ?? (f.targetId === null ? "lore" : undefined));
    missing("memoryMode", card?.memoryMode ?? (f.targetId === null ? "static" : undefined));
    missing("eventStatus", "unresolved");
    missing("participants", []);
    if (f.suggestedTriggers === undefined) missing("suggestedTriggers", adventure && nonempty(f.title) && nonempty(f.content)
      ? generatedStoryCardTriggers(adventure, f.title, f.content, undefined, typeof f.targetId === "string" ? f.targetId : undefined, f.memoryMode as SinglePassMemoryFinding["memoryMode"], f.storyCardType as SinglePassMemoryFinding["storyCardType"]) : []);
  }
  if (recovered) f.candidateOnly = true;
  return singlePassFindingSchemaError(f) ? undefined : f as unknown as SinglePassMemoryFinding;
}
/** Structural checks only. Exact quotation is not proof of the model's interpretation. */
export function singlePassFindingSchemaError(v: unknown): string | undefined {
  if (!object(v) || Object.keys(v).some(key => !["kind", "targetId", "title", "content", "brainPatch", "reason", "evidenceQuotes", "candidateOnly", "storyCardType", "operation", "memoryMode", "eventStatus", "suggestedTriggers", "participants", "identityChange"].includes(key)) || !["storyCard", "brain", "plotEssentials", "activePressure", "currentArc"].includes(String(v.kind))
    || !(v.targetId === null || nonempty(v.targetId)) || !nonempty(v.title) || !nonempty(v.reason) || typeof v.candidateOnly !== "boolean"
    || !Array.isArray(v.evidenceQuotes) || !v.evidenceQuotes.length || v.evidenceQuotes.some(q => !object(q) || !nonempty(q.messageId) || !nonempty(q.quote))) return "Missing or invalid required finding fields.";
  if (v.kind === "brain") {
    if (!object(v.brainPatch) || !Object.keys(v.brainPatch).length || Object.entries(v.brainPatch).some(([key, value]) =>
      key === "thoughts" ? !object(value) || !Object.keys(value).length || Object.values(value).some(t => t !== null && !nonempty(t))
        : !["currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"].includes(key) || !nonempty(value))) return "Invalid BrainPatch.";
  } else if (!nonempty(v.content)) return "Missing usable factual content.";
  if (v.kind === "storyCard" && (!["lore", "character", "location", "custom"].includes(String(v.storyCardType))
    || !["append", "create"].includes(String(v.operation)) || !["static", "living", "historical"].includes(String(v.memoryMode))
    || !["completed", "ongoing", "unresolved"].includes(String(v.eventStatus))
    || !Array.isArray(v.suggestedTriggers) || v.suggestedTriggers.some(t => !nonempty(t))
    || !Array.isArray(v.participants) || v.participants.some(t => !nonempty(t)))) return "Missing Story Card contract fields.";
  return undefined;
}
/** Remove complete wrappers only. Unmatched tags remain and fail JSON parsing. */
function unwrapResponse(text: string): string {
  let value = text.replace(/^\uFEFF/, "").trim();
  let previous: string;
  let fenceRemoved = false;
  do {
    previous = value;
    const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(value);
    if (fence && !fenceRemoved) { value = fence[1].trim(); fenceRemoved = true; }
    if (value.startsWith("<think>")) {
      const end = value.indexOf("</think>");
      if (end >= 0) value = value.slice(end + 8).trim();
    }
  } while (value !== previous);
  return value;
}
/** Scan JSON tokens. Only complete objects directly in the root sources array survive. */
function recoverSourceRecords(text: string): unknown[] {
  const records: unknown[] = [];
  if (!text.startsWith("{")) return records;
  const stack: string[] = [];
  let quoted = false, escape = false, start = -1, tokenStart = -1, sourcesDepth = -1;
  let sourcesArrayAt = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') {
        quoted = false;
        if (stack.length === 1 && stack[0] === "{" && text.slice(tokenStart, i + 1) === '"sources"') {
          let next = i + 1;
          while (/\s/.test(text[next] ?? "") && next < text.length) next++;
          if (text[next] === ":") {
            next++;
            while (next < text.length && /\s/.test(text[next])) next++;
            if (text[next] === "[") sourcesArrayAt = next;
          }
        }
      }
      continue;
    }
    if (c === '"') { quoted = true; tokenStart = i; continue; }
    if (c === "{" || c === "[") {
      if (c === "[" && i === sourcesArrayAt && stack.length === 1) { sourcesDepth = stack.length + 1; sourcesArrayAt = -1; }
      if (c === "{" && sourcesDepth === stack.length && stack.at(-1) === "[") start = i;
      stack.push(c);
    } else if (c === "}" || c === "]") {
      if (stack.at(-1) !== (c === "}" ? "{" : "[")) break;
      if (c === "}" && start >= 0 && stack.length === sourcesDepth + 1) {
        try { records.push(JSON.parse(text.slice(start, i + 1))); } catch { /* No reconstruction. */ }
        start = -1;
      }
      if (stack.length === sourcesDepth) sourcesDepth = -1;
      stack.pop();
      if (!stack.length) break;
    }
  }
  return records;
}
export function parseSinglePassMemoryResponse(text: string, sourceIds: readonly string[], adventure?: Adventure): SinglePassMemoryBatchResult {
  const clean = unwrapResponse(text);
  let records: unknown[];
  try {
    const parsed: unknown = JSON.parse(clean);
    records = object(parsed) && Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch { records = recoverSourceRecords(clean); }
  return { sources: sourceIds.map(sourceId => {
    const matches = records.filter(v => object(v) && v.sourceId === sourceId);
    if (matches.length !== 1 || !object(matches[0]) || !Array.isArray(matches[0].findings)) return { sourceId, findings: [], rejected: [], failureReason: "Missing, duplicate or malformed source record. Explicit Retry required." };
    const result: SinglePassMemorySourceResult = { sourceId, findings: [], findingIndexes: [], rejected: [], diagnostics: [] };
    matches[0].findings.forEach((finding: unknown, index: number) => {
      const diagnostics: string[] = [];
      const normalized = normalizeSinglePassFinding(finding, sourceId, adventure, diagnostics);
      result.diagnostics!.push(...diagnostics.map(reason => ({ index, reason })));
      const error = normalized ? undefined : singlePassFindingSchemaError(finding) ?? "Invalid finding metadata.";
      if (error) result.rejected.push({ index, reason: error });
      else { result.findings.push(normalized!); result.findingIndexes!.push(index); }
    });
    if (records.some(v => !object(v) || !sourceIds.includes(String(v.sourceId)))) result.diagnostics!.push({ index: -1, reason: "Rejected unknown source record; no attribution inferred." });
    if (result.rejected.length) result.failureReason = "Invalid findings rejected; valid sibling findings retained. Explicit Retry required.";
    return result;
  }) };
}
export async function runSinglePassMemoryBatch(a: Adventure, provider: ProviderConfig, batch: PreparedSinglePassMemoryBatch): Promise<SinglePassMemoryBatchResult> {
  const config = memoryBatchProvider(provider, batch.checkpoints.map(s => s.sourceId));
  // Bounded extraction output, independent of narration settings. Cancellation guard stays on this exact config.
  config.memoryRequest = { ...config.memoryRequest!, batchId: batch.batchId, attempt: Math.max(1, ...batch.checkpoints.map(c => a.messages.find(m => m.id === c.sourceId)?.memoryEvaluation?.attempts ?? 1)) };
  config.maxOutputTokens = Math.min(8192, Math.max(provider.maxOutputTokens || 0, 1024 + batch.checkpoints.length * 2048));
  const response = await sendMemoryCompletion(a, config, buildSinglePassMemoryMessages(batch), "singlePass");
  const result = parseSinglePassMemoryResponse(response.content, batch.checkpoints.map(s => s.sourceId), a);
  return { ...result, usage: response.usage };
}

