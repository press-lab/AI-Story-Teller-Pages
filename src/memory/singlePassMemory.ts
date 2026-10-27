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
  outputAliases: Record<string, { sourceId: string; sourceTurn: number;
    evidence: Record<string, { id: string; reference: number }>;
    cards: Record<string, { id: string; reference: number; type: string; memoryMode?: SinglePassMemoryFinding["memoryMode"] }>;
    brains: Record<string, { id: string; reference: number; type: "brain" }>;
    plot: Record<string, { id: string; reference: number; type: string }> }>;
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
  const outputAliases: PreparedSinglePassMemoryBatch["outputAliases"] = {};
  for (const source of ordered) {
    const snapshot = { ...a, messages: a.messages.slice(0, a.messages.indexOf(source) + 1),
      activeState: { ...a.activeState, turn: source.memoryEvaluation!.turn },
      semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, source.id).length } };
    const conditions = buildMemoryAssessmentConditions(snapshot);
    const inputs = await assessmentInputs(snapshot, source.id, conditions);
    checkpoints.push({ sourceId: source.id, checkpoint: { batchId, sourceContent: source.content, sourceRevision: source.memoryEvaluation?.revision,
      evidence: inputs.evidence.map(({ id, content }) => ({ id, content })), referenceState: singlePassReferenceState(a, source.id),
      status: "running", findings: [], dispositions: [], acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 } });
    outputAliases[`S${sources.length + 1}`] = {
      sourceId: source.id, sourceTurn: source.memoryEvaluation!.turn,
      evidence: Object.fromEntries(inputs.evidence.map((e, i) => [`E${i + 1}`, { id: e.id, reference: pool(e) }])),
      cards: Object.fromEntries(inputs.currentCards.map((c, i) => [`C${i + 1}`, { id: c.id, reference: pool(c), type: c.type, memoryMode: c.memoryMode }])),
      brains: Object.fromEntries(inputs.currentBrains.map((b, i) => [`B${i + 1}`, { id: b.id, reference: pool(b), type: "brain" as const }])),
      plot: Object.fromEntries(inputs.currentPlot.map((p, i) => [`P${i + 1}`, { id: p.id, reference: pool(p), type: p.type }])),
    };
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
  return { batchId, checkpoints, outputAliases, payload: { references, sources } };
}
const POLICY = `SINGLE PASS MEMORY EXTRACTION.
Read all supplied sources and canon.
Find meaningful factual changes.
Produce zero or more simple memory commands for each source.
A command contains one memory change.
Use the supplied source, evidence, and target aliases.
Do not write JSON.
Do not copy database IDs.
Do not write analysis or introductory text.
Use MEM to start one command.
Use E to cite exact evidence.
Use TEXT for the factual memory.
Use END to finish the command.
Use DONE to finish each source.
Write DONE for every supplied source, including sources with no changes.
Keep important distinct developments separate.
Do not invent changes to fill an empty source.
A planned meeting is not a completed meeting.
An attempted kiss is not a completed kiss.
Private interpretations belong in eligible Brains.
Shared developments and events belong in Lore.
Enduring Character profile changes require explicit PROFILE justification.
Plot Components are instructions and current operating facts, not event archives.
Use only eligible destinations.
Do not infer unknown events, consent, private knowledge, or permanent character traits.

Command grammar (one control per line):
MEM S1 storyCard NEW (create Lore by default) or MEM S1 storyCard C1 (append).
MEM S1 brain B1, MEM S1 plotEssentials P1, MEM S1 activePressure P1, MEM S1 currentArc P1.
E E2 | exact quote from that source's evidence. Repeat E for additional quotes. Cite the establishing narrator and necessary player exchange. Do not add quotation delimiters unless they occur in the evidence.
Optional lines before TEXT:
TITLE short title
TYPE lore|character|location|custom (new cards only)
MODE static|living|historical
STATUS completed|ongoing|unresolved
REVIEW yes|no
REASON short explanation
FIELD thought|currentState|relationshipPressure|emotionalInterpretation|recentDevelopments|notes (required for Brain)
PROFILE correction|transformation|profile | specific enduring-change explanation (required for existing Character)
TEXT
One factual delta, with multiple lines if needed.
END
DONE S1
Complete output examples (illustrative only: use each alias only when present in the supplied outputAliases, with exact evidence from that source):
New Lore:
MEM S1 storyCard NEW
E E2 | The bridge collapsed.
TEXT
The bridge collapsed.
END
DONE S1

Existing Brain thought:
MEM S1 brain B1
FIELD thought
E E2 | Mira thought the signal was a trap.
TEXT
I suspect the signal is a trap.
END
DONE S1

Three sources with zero findings:
DONE S1
DONE S2
DONE S3

Use actual aliases in outputAliases. Evidence and targets are scoped to each source. Reference indexes locate pooled content. Canon prefix/reference entries mean prefix plus referenced content. Never borrow later evidence or another private perspective.
Keep Story Card deltas at most 70 words. Do not supply triggers; the application generates them.
Brains require an eligible existing perspective. Return one first-person thought or one string-field delta. Do not supply thought keys, delete thoughts, record scene presence or stable traits, or create a missing Brain. Never give an absent NPC knowledge without evidence of acquisition.
Plot Essentials requires explicit autoUpdate=true and changes only for premise/constraints (180 words). Active Pressure is an immediate unresolved external threat or obligation (one sentence, 45 words), never an old resolved event. Both use replacement text. Current Arc is an append-only delta within the established arc (500 words); never change Director phases. Respect active targets, opt-outs, authored conditions and approval controls.
Use REVIEW yes for uncertain relationship outcomes, attempted intimacy, enduring traits, ambiguous destinations, private interpretations, protected targets or conflicting certainty. Preserve attributed claims and uncertainty. Research collaboration is not romance. Never turn one action into a permanent trait.
${STORY_CARD_PLACEMENT_POLICY.split("\n").filter(line => !line.startsWith("For APPEND") && !line.startsWith("placement.kind:")).join("\n")}
For Character appends use PROFILE kind | reason and exact E quotes supporting the enduring fact. New Character cards require a missing durable identity. TYPE defaults to lore for new cards. Use target aliases for appends and preserve target type.
${SHARED_STORY_MEMORY_POLICY}`;
export function buildSinglePassMemoryMessages(batch: PreparedSinglePassMemoryBatch): ChatMessage[] {
  return [{ role: "system", content: POLICY }, { role: "user", content: JSON.stringify({ ...batch.payload, outputAliases: batch.outputAliases }) }];
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
    const fence = /^```(?:json|text|plaintext)?\s*\n?([\s\S]*?)\n?```$/i.exec(value);
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
export function parseSinglePassMemoryResponse(text: string, sourceIds: readonly string[], adventure?: Adventure, aliases?: PreparedSinglePassMemoryBatch["outputAliases"]): SinglePassMemoryBatchResult {
  const clean = unwrapResponse(text);
  if (aliases && !clean.startsWith("{")) return parseSinglePassMemoryCommands(text, aliases, adventure);
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
/** Translate commands locally. Existing validation remains the authority. */
export function parseSinglePassMemoryCommands(text: string, aliases: PreparedSinglePassMemoryBatch["outputAliases"], adventure?: Adventure): SinglePassMemoryBatchResult {
  const states = Object.entries(aliases).map(([alias, manifest]) => ({ alias, manifest, done: false, nextIndex: 0,
    result: { sourceId: manifest.sourceId, findings: [], findingIndexes: [], rejected: [], diagnostics: [] } as SinglePassMemorySourceResult }));
  const stateFor = (alias: string) => states.find(s => s.alias === alias || s.alias === alias.toUpperCase());
  type Command = { state?: typeof states[number]; index: number; header: string; sourceAlias: string; kind: string; target: string; metadata: Record<string, string>;
    evidence: Array<{ messageId: string; quote: string }>; lines: string[]; inText: boolean; errors: string[] };
  let current: Command | undefined;
  const diagnostic = (reason: string) => states.forEach(s => s.result.diagnostics!.push({ index: -1, reason }));
  const reject = (c: Command, reason: string) => {
    const detail = `Rejected MEM header: source=${JSON.stringify(c.sourceAlias.slice(0, 160))}; header=${JSON.stringify(c.header)}; kind=${JSON.stringify(c.kind.slice(0, 160))}; target=${JSON.stringify(c.target.slice(0, 160))}; ${reason}`;
    if (c.state) {
      c.state.result.diagnostics!.push({ index: c.index, reason: detail });
      c.state.result.rejected.push({ index: c.index, reason });
    }
    else diagnostic(detail);
  };
  const finish = (c: Command) => {
    if (!c.state) { reject(c, "Unknown source alias; no attribution inferred."); return; }
    const { manifest, result } = c.state;
    const content = c.lines.join("\n").trim(), meta = c.metadata;
    const kinds = ["storyCard", "brain", "plotEssentials", "activePressure", "currentArc"] as const;
    const label = c.kind.toLowerCase().replace(/\s+/g, " ");
    const cardAlias = Object.hasOwn(manifest.cards, c.target) ? c.target : c.target.toUpperCase();
    const kind = label === "story card" || (label === "lore" && (c.target === "NEW" || Object.hasOwn(manifest.cards, cardAlias)))
      ? "storyCard" : kinds.find(k => k.toLowerCase() === label);
    const lookup = <T,>(table: Record<string, T>, alias: string): T | undefined => Object.hasOwn(table, alias) ? table[alias] : Object.hasOwn(table, alias.toUpperCase()) ? table[alias.toUpperCase()] : undefined;
    const card = kind === "storyCard" ? lookup(manifest.cards, c.target) : undefined;
    const brain = kind === "brain" ? lookup(manifest.brains, c.target) : undefined;
    const plot = kind && !["storyCard", "brain"].includes(kind) ? lookup(manifest.plot, c.target) : undefined;
    const isNew = kind === "storyCard" && c.target === "NEW";
    if (!kind) c.errors.push("Unknown memory kind.");
    if (!isNew && !card && !brain && !(plot && plot.type === kind)) c.errors.push("Invalid target alias for memory kind.");
    if (!c.inText || !content) c.errors.push("Missing usable factual content after TEXT.");
    if (!c.evidence.length) c.errors.push("Missing evidence.");
    if (card?.type === "character" && !meta.PROFILE) c.errors.push("Character profile update requires PROFILE kind | enduring-change reason.");
    if (meta.PROFILE && !/^(correction|transformation|profile)\s*\|\s*\S[\s\S]*$/i.test(meta.PROFILE)) c.errors.push("Invalid PROFILE kind or missing enduring-change reason.");
    const field = ["thought", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"].find(f => f.toLowerCase() === meta.FIELD?.toLowerCase());
    if (kind === "brain" && !field) c.errors.push("Invalid or missing Brain FIELD.");
    if (c.errors.length) { reject(c, c.errors.join(" ")); return; }
    const targetId = card?.id ?? brain?.id ?? plot?.id ?? null;
    const base: Record<string, unknown> = { kind, targetId, content, evidenceQuotes: c.evidence };
    if (meta.TITLE) base.title = meta.TITLE;
    if (meta.REASON) base.reason = meta.REASON;
    if (meta.REVIEW) base.candidateOnly = meta.REVIEW.toLowerCase() === "yes";
    if (kind === "storyCard") {
      base.operation = isNew ? "create" : "append";
      base.storyCardType = card?.type ?? meta.TYPE?.toLowerCase() ?? "lore";
      if (meta.MODE || card?.memoryMode) base.memoryMode = meta.MODE?.toLowerCase() ?? card?.memoryMode;
      if (meta.STATUS) base.eventStatus = meta.STATUS.toLowerCase();
      if (card?.type === "character") {
        const separator = meta.PROFILE.indexOf("|");
        base.identityChange = { targetId, kind: meta.PROFILE.slice(0, separator).trim().toLowerCase(),
          reason: meta.PROFILE.slice(separator + 1).trim(), fact: content, evidenceQuotes: c.evidence };
        base.candidateOnly = true;
      }
    }
    if (kind === "brain") {
      if (field === "thought") {
        const slug = manifest.sourceId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        const key = `memory_${slug}_${c.index + 1}`;
        const existing = adventure?.brains.find(b => b.id === targetId);
        if (existing && (key in existing.thoughts || key in existing.archivedThoughts)) {
          reject(c, "Generated Brain thought key already exists; existing thoughts must not be overwritten."); return;
        }
        base.brainPatch = { thoughts: { [key]: `${manifest.sourceTurn} \u2192 ${content}` } };
      } else base.brainPatch = { [field!]: content };

    }
    const diagnostics: string[] = [];
    const finding = normalizeSinglePassFinding(base, manifest.sourceId, adventure, diagnostics);
    result.diagnostics!.push(...diagnostics.map(reason => ({ index: c.index, reason })));
    if (!finding) reject(c, singlePassFindingSchemaError(base) ?? "Invalid finding metadata.");
    else {
      if (kind === "brain") delete finding.content;
      result.findings.push(finding); result.findingIndexes!.push(c.index);
    }
  };
  const clean = unwrapResponse(text);
  const blocked = clean.startsWith("<think>") || clean.startsWith("```");
  if (blocked) diagnostic("Incomplete response wrapper; no commands parsed.");
  for (const raw of blocked ? [] : clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (current?.inText) {
      if (/^END$/i.test(line)) { finish(current); current = undefined; continue; }
      current.lines.push(raw); continue;
    }
    const mem = /^MEM\s+(\S+)\s+(story\s+card|\S+)\s+(\S+)$/i.exec(line);
    if (mem) {
      if (current) reject(current, "Incomplete memory command: missing TEXT or END.");
      const state = stateFor(mem[1]);
      current = { state, index: state ? state.nextIndex++ : -1, header: raw.slice(0, 160), sourceAlias: mem[1], kind: mem[2], target: mem[3], metadata: {}, evidence: [], lines: [], inText: false,
        errors: state?.done ? ["Command after DONE."] : [] };
      continue;
    }
    const malformedMem = /^MEM(?:\s+(\S+))?(?:\s.*)?$/i.exec(line);
    if (malformedMem) {
      if (current) reject(current, "Incomplete memory command: missing END.");
      const state = malformedMem[1] ? stateFor(malformedMem[1]) : undefined;
      const partial = /^MEM\s+\S+(?:\s+(story\s+card|\S+))?(?:\s+(\S+))?/i.exec(line);
      current = { state, index: state ? state.nextIndex++ : -1, header: raw.slice(0, 160), sourceAlias: malformedMem[1] ?? "",
        kind: partial?.[1] ?? "", target: partial?.[2] ?? "", metadata: {}, evidence: [], lines: [], inText: false, errors: ["Invalid MEM syntax."] };
      continue;
    }
    const done = /^DONE\s+(\S+)$/i.exec(line);
    if (done) {
      if (current) { reject(current, "Incomplete memory command: missing END."); current = undefined; }
      const state = stateFor(done[1]);
      if (!state) diagnostic("Unknown source alias in DONE; no attribution inferred.");
      else if (state.done) { state.result.failureReason = "Duplicate DONE marker. Explicit Retry required."; state.result.diagnostics!.push({ index: -1, reason: "Duplicate DONE marker." }); }
      else state.done = true;
      continue;
    }
    if (!current) { if (line) diagnostic("Rejected text outside a memory command."); continue; }
    if (/^TEXT$/i.test(line)) { current.inText = true; continue; }
    if (/^END$/i.test(line)) { finish(current); current = undefined; continue; }
    const evidence = /^E\s+(\S+)\s*\|([\s\S]*)$/i.exec(line);
    if (evidence) {
      const table = current.state?.manifest.evidence;
      const entry = table && Object.hasOwn(table, evidence[1]) ? table[evidence[1]] : undefined, quote = evidence[2].trim();
      if (!entry || !quote) current.errors.push("Invalid evidence alias or empty quote.");
      else current.evidence.push({ messageId: entry.id, quote });
      continue;
    }
    const optional = /^(TITLE|TYPE|MODE|STATUS|REVIEW|REASON|FIELD|PROFILE)\s+(.+)$/i.exec(line);
    if (optional) {
      const key = optional[1].toUpperCase();
      if (key in current.metadata) current.errors.push(`Duplicate ${key} field.`);
      current.metadata[key] = optional[2].trim();
      const choices: Record<string, string[]> = { TYPE: ["lore", "character", "location", "custom"], MODE: ["static", "living", "historical"], STATUS: ["completed", "ongoing", "unresolved"], REVIEW: ["yes", "no"] };
      if (choices[key] && !choices[key].includes(optional[2].trim().toLowerCase())) current.errors.push(`Invalid ${key} value.`);
      continue;
    }
    if (line) current.errors.push("Invalid command syntax before TEXT.");
  }
  if (current) reject(current, "Incomplete memory command: missing END.");
  for (const state of states) {
    if (!state.done) state.result.failureReason = "Missing DONE; source evaluation unfinished. Explicit Retry required.";
    else if (state.result.rejected.length) state.result.failureReason = "Invalid commands rejected; valid sibling findings retained. Explicit Retry required.";
  }
  return { sources: states.map(s => s.result) };
}

export async function runSinglePassMemoryBatch(a: Adventure, provider: ProviderConfig, batch: PreparedSinglePassMemoryBatch): Promise<SinglePassMemoryBatchResult> {
  const config = memoryBatchProvider(provider, batch.checkpoints.map(s => s.sourceId));
  // Bounded extraction output, independent of narration settings. Cancellation guard stays on this exact config.
  config.memoryRequest = { ...config.memoryRequest!, batchId: batch.batchId, attempt: Math.max(1, ...batch.checkpoints.map(c => a.messages.find(m => m.id === c.sourceId)?.memoryEvaluation?.attempts ?? 1)) };
  config.maxOutputTokens = Math.min(8192, Math.max(provider.maxOutputTokens || 0, 1024 + batch.checkpoints.length * 2048));
  const response = await sendMemoryCompletion(a, config, buildSinglePassMemoryMessages(batch), "singlePass");
  const result = parseSinglePassMemoryResponse(response.content, batch.checkpoints.map(s => s.sourceId), a, batch.outputAliases);
  return { ...result, usage: response.usage };
}

