import type { Adventure, BrainEntry, ChatMessage, ProviderConfig, SinglePassMemoryBatchResult, SinglePassMemoryCheckpoint, SinglePassMemoryFinding, SinglePassMemorySourceResult } from "../types/adventure";
import { assessmentInputs, assessmentSourceState, memoryDecisionState } from "./memoryAssessment";
import { buildMemoryAssessmentConditions } from "../triggers/semanticEngine";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { memoryBatchProvider, sendMemoryCompletion } from "../providers/memoryCompletion";
import { generatedStoryCardTriggers } from "./resolveMemoryTarget";
import { storyCardContextContent } from "./storyCardPolicy";
import { createId } from "../utils/id";
import { parseLooseMemoryOperations } from "./looseMemoryParser";
import { routeLooseMemoryOperations } from "./looseMemoryRouter";

const profileName = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
/** Linked identity wins; fallback names/aliases must identify exactly one Character. */
export function singlePassCharacterCard(a: Adventure, brain: BrainEntry) {
  const linked = a.storyCards.find(c => c.id === brain.linkedStoryCardId && c.type === "character");
  if (linked) return linked;
  const matches = a.storyCards.filter(c => c.type === "character" && [c.title, ...c.keys].some(name => profileName(name) === profileName(brain.characterName)));
  return matches.length === 1 ? matches[0] : undefined;
}
export function singlePassPersonality(content: string): string {
  const parts = content.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const priority = /personality|voice|motivat|relationship|trust|loyal|proud|protect|humou?r|wit|sarcas|ambiti|values?|fear|want|believ|temper|reserved|guarded|speaks?|manner/i;
  return [...parts.filter(s => priority.test(s)), ...parts.filter(s => !priority.test(s))].join(" ").slice(0, 500);
}

/** Exact reference/control guard. Worker bookkeeping and request records are not evidence. */
export function singlePassReferenceState(a: Adventure, sourceId: string): string {
  const snapshot = { ...a, messages: a.messages.slice(0, a.messages.findIndex(m => m.id === sourceId) + 1),
    activeState: { ...a.activeState, turn: a.messages.find(m => m.id === sourceId)?.memoryEvaluation?.turn ?? a.activeState.turn },
    semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, sourceId).length } };
  const conditions = buildMemoryAssessmentConditions(snapshot);
  return JSON.stringify([assessmentSourceState(snapshot, sourceId, conditions), memoryDecisionState(snapshot, sourceId), snapshot.components.filter(c => c.type === "immediateMomentum"),
    snapshot.brains.filter(b => conditions.brains.some(c => c.id === `brain:${b.id}`)).map(b => {
      const card = singlePassCharacterCard(snapshot, b);
      return card ? { brainId: b.id, id: card.id, title: card.title, keys: card.keys, content: card.content } : { brainId: b.id };
    })]);
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
    const brains = inputs.currentBrains.map(b => {
      const brain = snapshot.brains.find(entry => entry.id === b.id)!;
      const card = singlePassCharacterCard(snapshot, brain);
      if (!card) return b;
      const supplied = inputs.currentCards.find(c => c.id === card.id)
        ?? inputs.canon.find(entry => entry.content === "Canon story card: " + card.title + "\n" + storyCardContextContent(card));
      return { ...b, personalityReference: supplied
        ? { cardId: card.id, reference: pool(supplied), use: "personality, motivations, relationships, voice" }
        : { cardId: card.id, personality: singlePassPersonality(card.content) } };
    });
    // Single-pass-only, review-required legacy Momentum support.
    const plot = [...inputs.currentPlot.filter(p => conditions.plot.some(c => c.id.endsWith(":" + p.id))), ...snapshot.components.filter(c => c.type === "immediateMomentum" && c.active && c.autoUpdate !== false)
      .map(c => ({ id: c.id, type: c.type, content: c.content, premise: c.arcPremise, autoUpdate: c.autoUpdate, protected: c.protected }))];

    checkpoints.push({ sourceId: source.id, checkpoint: { batchId, sourceContent: source.content, sourceRevision: source.memoryEvaluation?.revision,
      evidence: inputs.evidence.map(({ id, content }) => ({ id, content })), referenceState: singlePassReferenceState(a, source.id),
      status: "running", findings: [], dispositions: [], acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 } });
    outputAliases[`S${sources.length + 1}`] = {
      sourceId: source.id, sourceTurn: source.memoryEvaluation!.turn,
      evidence: Object.fromEntries(inputs.evidence.map((e, i) => [`E${i + 1}`, { id: e.id, reference: pool(e) }])),
      cards: Object.fromEntries(inputs.currentCards.map((c, i) => [`C${i + 1}`, { id: c.id, reference: pool(c), type: c.type, memoryMode: c.memoryMode }])),
      brains: Object.fromEntries(brains.map((b, i) => [`B${i + 1}`, { id: b.id, reference: pool(b), type: "brain" as const }])),
      plot: Object.fromEntries(plot.map((p, i) => [`P${i + 1}`, { id: p.id, reference: pool({ ...p, title: snapshot.components.find(c => c.id === p.id)?.title }), type: p.type }])),
    };
    sources.push({ sourceId: source.id, conditions,
      evidence: inputs.evidence.map(pool), canon: inputs.canon.map(entry => {
        const card = inputs.currentCards.find(c => entry.content === "Canon story card: " + c.title + "\n" + c.content);
        if (card) return pool({ role: entry.role, prefix: "Canon story card: " + card.title + "\n", reference: pool(card) });
        const plot = inputs.currentPlot.find(p => entry.content === "Canon component: " + snapshot.components.find(c => c.id === p.id)?.title + "\n" + p.content);
        if (plot) return pool({ role: entry.role, prefix: entry.content.slice(0, -plot.content.length), reference: pool(plot) });
        return pool(entry);
      }), cards: inputs.currentCards.map(pool),
      brains: brains.map(pool), plot: plot.map(p => pool({ ...p, title: snapshot.components.find(c => c.id === p.id)?.title })), consideredSuggestionsNotCanon: inputs.coverage.map(pool) });
  }
  return { batchId, checkpoints, outputAliases, payload: { references, sources } };
}
const POLICY = `SINGLE PASS MEMORY EXTRACTION.
Identify meaningful NEW information in each supplied narrator source. Read canon and considered suggestions to avoid repetition. Keep distinct consequential facts separate. Return one short operation per fact:
(category.subtype: Subject = New information)
Group operations under S1, S2 or S3 in outputAliases source order. Write NONE under an evaluated source with no updates. Evaluate every source. Do not write JSON. Do not write analysis.
Use names and topic titles. The application resolves destinations, evidence, triggers and internal operations locally.

Categories:
brain: consider EVERY eligible existing Brain whose character directly participated in, witnessed, or demonstrably learned about the latest development. Subject is the character's name. Use established personality/voice from personalityReference and existing Brain state. Write a meaningful NEW private observation, interpretation, intention, reaction, changed belief or revised judgment in that character's first-person voice: what does this privately mean to them? Incremental changes qualify; a major personality transformation is unnecessary. Prefer subtype thoughts. Alternatives currentState, relationshipPressure, emotionalInterpretation, recentDevelopments, notes remain available for a distinct state change; recentDevelopments is NOT a transcript-summary field. Never create Brains.
Never copy dialogue into thoughts, rewrite narration in first person without private meaning, record location or scene participation, repeat existing thoughts in different words, or invent feelings to force an update. Never grant knowledge of unwitnessed events without evidence of learning them. Return no Brain update when nothing meaningful changed.
storyCard: default subtype lore. Lore records consequential events, agreements, plans, discoveries and shared developments. Compare each candidate fact against provided Story Cards and considered suggestions; output ONLY information not already recorded or considered. One ongoing conversation is one development unless a new decision, consequence or fact changes it. Do not record conversational restatements or create a new event because an old event is discussed again. Preserve genuinely new consequences and commitments. Plans, invitations, attempts, offers, accepted agreements and completed outcomes are distinct. Return NONE when no new durable information exists. Use an existing topical Lore title only for the same subject; shared participants do not establish a destination. A participant's biography is not the event destination.
storyCard.character: a genuinely missing person's enduring identity. Existing profiles are protected. Only an explicit evidenced enduring correction uses storyCard.character.update, with a specific explanation after ||. Never infer permanence from a single scene.
storyCard.location: enduring properties of a place, not a one-time event there.
storyCard.custom: enduring properties of an established non-person subject, not a catch-all for events.
component.plotEssentials: replacement premise, central conflict and persistent constraints; preserve still-valid foundations (180 words).
component.currentArc: append a new development within an existing active arc; never change Director phases.
component.activePressure: replacement immediate unresolved external threat or obligation (one short sentence, 45 words).
component.immediateMomentum: replacement for an existing eligible immediate-momentum component; review required.
Components must use the existing title and correct subtype. Never create components or edit narrationRules, aiInstructions, authorNote, memory or custom components.

Examples:
S1
(storyCard.lore: Weasley Tattoo Business = Fred and George agreed to produce 96 rune tattoos tomorrow.)
(brain.thoughts: George Weasley = I think this could grow beyond individual customers.)
S2
(storyCard.character: Eleanor Vale = Eleanor is a sixth-year Ravenclaw specializing in experimental enchantments.)
(storyCard.location: Observatory Annex = A sealed chamber lies beneath the western tower.)
S3
(component.activePressure: Ministry Deadline = The Ministry expects the research report tomorrow.)

Brain and Story Card subtypes may be omitted when using their defaults. lore: Topic = Information is also valid.
Private interpretation examples (illustrative, not established canon):
Bad: (brain.recentDevelopments: Fred = Fair question, she's one of ours now by dating Press.)
Good, ONLY if supported: (brain.thoughts: Fred = George is treating this like an acquisition attempt. Press seems happy; I'll watch for trouble without making his girlfriend an enemy.)
Bad: (brain.thoughts: George = I said we should be careful.)
Good, ONLY if supported: (brain.thoughts: George = Her warning addresses the risk I missed. I can accept her help while keeping control of our designs.)

A justified existing Character correction:
(storyCard.character.update: Eleanor Vale = Eleanor permanently lost her fire magic. || The experiment established this lasting loss.)

Keep ordinary card deltas within 70 words (120 maximum for manual review). Record only supported new facts, preserving claims, chronology, uncertainty and private knowledge boundaries. Plans remain plans; proposed agreements are not accepted agreements; future meetings have not occurred; attempts are not completed outcomes. Collaboration is not romance. Do not invent private reactions, permanent traits or facts to fill an empty source. Source attachment proves provenance, not semantic correctness. All extracted candidates await the user's review.`;
export function buildSinglePassMemoryMessages(batch: PreparedSinglePassMemoryBatch): ChatMessage[] {
  return [{ role: "system", content: POLICY }, { role: "user", content: JSON.stringify({ ...batch.payload, outputAliases: batch.outputAliases }) }];
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());
const findingKeys = ["kind", "targetId", "title", "content", "brainPatch", "reason", "evidenceQuotes", "candidateOnly", "storyCardType", "operation", "memoryMode", "eventStatus", "suggestedTriggers", "participants", "identityChange", "destinationCandidates"];
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
    if (words.length > 70 && words.length <= 120) {
      f.candidateOnly = true;
      diagnostics.push("Story Card exceeds 70 words; manual review required.");
    }
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
  if (!object(v) || Object.keys(v).some(key => !["kind", "targetId", "title", "content", "brainPatch", "reason", "evidenceQuotes", "candidateOnly", "storyCardType", "operation", "memoryMode", "eventStatus", "suggestedTriggers", "participants", "identityChange", "destinationCandidates"].includes(key)) || !["storyCard", "brain", "plotEssentials", "activePressure", "currentArc", "immediateMomentum"].includes(String(v.kind))
    || !(v.targetId === null || nonempty(v.targetId)) || !nonempty(v.title) || !nonempty(v.reason) || typeof v.candidateOnly !== "boolean"
    || !Array.isArray(v.evidenceQuotes) || !v.evidenceQuotes.length || v.evidenceQuotes.some(q => !object(q) || !nonempty(q.messageId) || !nonempty(q.quote))) return "Missing or invalid required finding fields.";
  if (v.destinationCandidates !== undefined && (!Array.isArray(v.destinationCandidates) || v.destinationCandidates.some(id => !nonempty(id)))) return "Invalid destination candidates.";
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
export function parseSinglePassMemoryResponse(text: string, sourceIds: readonly string[], adventure?: Adventure, aliases?: PreparedSinglePassMemoryBatch["outputAliases"], batch?: PreparedSinglePassMemoryBatch): SinglePassMemoryBatchResult {
  const clean = unwrapResponse(text);
  if (aliases && /^(?:MEM|DONE)\b/im.test(clean)) return parseSinglePassMemoryCommands(text, aliases, adventure);
  const legacyJson = /^\{\s*"sources"\s*:/.test(clean);
  if (adventure && aliases && !legacyJson) {
    // Direct parsing also supports previews; running workers always supply their original batch.
    const localBatch = batch ?? { batchId: "parse-preview", payload: { references: [], sources: [] }, outputAliases: aliases,
      checkpoints: Object.values(aliases).map(manifest => {
        const source = adventure.messages.find(m => m.id === manifest.sourceId);
        const checkpoint: SinglePassMemoryCheckpoint = source?.memoryEvaluation?.singlePass ?? {
          batchId: "parse-preview", sourceContent: source?.content ?? "", sourceRevision: source?.memoryEvaluation?.revision,
          evidence: memoryEvidenceWindow(adventure, manifest.sourceId).map(({ id, content }) => ({ id, content })),
          referenceState: singlePassReferenceState(adventure, manifest.sourceId), status: "running", findings: [], dispositions: [],
          acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 };
        return { sourceId: manifest.sourceId, checkpoint };
      }) };
    return routeLooseMemoryOperations(adventure, localBatch, parseLooseMemoryOperations(text, Object.keys(aliases)));
  }
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
    if (result.rejected.length && !result.findings.length) result.failureReason = "Invalid findings rejected; valid sibling findings retained. Explicit Retry required.";
    return result;
  }) };
}
/** Translate commands locally. Existing validation remains the authority. */
export function parseSinglePassMemoryCommands(text: string, aliases: PreparedSinglePassMemoryBatch["outputAliases"], adventure?: Adventure): SinglePassMemoryBatchResult {
  const states = Object.entries(aliases).map(([alias, manifest]) => ({ alias, manifest, done: false, nextIndex: 0,
    result: { sourceId: manifest.sourceId, findings: [], findingIndexes: [], rejected: [], diagnostics: [] } as SinglePassMemorySourceResult }));
  const stateFor = (alias: string) => states.find(s => s.alias === alias || s.alias === alias.toUpperCase());
  type Command = { state?: typeof states[number]; index: number; header: string; sourceAlias: string; kind: string; target: string; metadata: Record<string, string>;
    evidence: Array<{ messageId: string; quote: string }>; lines: string[]; inText: boolean; errors: string[]; evidenceRecovered?: boolean };
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
    const recoverCharacterEvent = kind === "storyCard" && card?.type === "character" && !meta.PROFILE && Boolean(content) && c.evidence.length > 0;
    if (meta.PROFILE && !/^(correction|transformation|profile)\s*\|\s*\S[\s\S]*$/i.test(meta.PROFILE)) c.errors.push("Invalid PROFILE kind or missing enduring-change reason.");
    const field = ["thought", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"].find(f => f.toLowerCase() === meta.FIELD?.toLowerCase());
    if (kind === "brain" && !field) c.errors.push("Invalid or missing Brain FIELD.");
    if (c.errors.length) { reject(c, c.errors.join(" ")); return; }
    const targetId = recoverCharacterEvent ? null : card?.id ?? brain?.id ?? plot?.id ?? null;
    const base: Record<string, unknown> = { kind, targetId, content, evidenceQuotes: c.evidence };
    if (meta.TITLE) base.title = meta.TITLE;
    if (meta.REASON) base.reason = meta.REASON;
    if (meta.REVIEW) base.candidateOnly = meta.REVIEW.toLowerCase() === "yes";
    if (kind === "storyCard") {
      base.operation = isNew || recoverCharacterEvent ? "create" : "append";
      base.storyCardType = recoverCharacterEvent ? "lore" : card?.type ?? meta.TYPE?.toLowerCase() ?? "lore";
      if (meta.MODE || (!recoverCharacterEvent && card?.memoryMode)) base.memoryMode = meta.MODE?.toLowerCase() ?? card?.memoryMode;
      if (meta.STATUS) base.eventStatus = meta.STATUS.toLowerCase();
      if (card?.type === "character" && !recoverCharacterEvent) {
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
    if (c.evidenceRecovered || recoverCharacterEvent) base.candidateOnly = true;
    if (recoverCharacterEvent) diagnostics.push("Character event routed to review-required Lore proposal; no PROFILE justification.");
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
    const evidence = /^E\s+([^\s|]+)(?:\s*\|([\s\S]*))?$/i.exec(line);
    if (evidence) {
      const table = current.state?.manifest.evidence;
      const entry = table && Object.hasOwn(table, evidence[1]) ? table[evidence[1]] : undefined;
      const message = entry && adventure?.messages.find(m => m.id === entry.id);
      if (!entry) current.errors.push("Invalid evidence alias.");
      else if (!message || !message.content.trim()) current.errors.push("Missing or empty original evidence message.");
      else {
        const suppliedQuote = evidence[2]?.trim();
        const exact = Boolean(suppliedQuote && message.content.includes(suppliedQuote));
        current.evidence.push({ messageId: entry.id, quote: exact ? suppliedQuote! : message.content });
        if (!exact) {
          current.evidenceRecovered = true;
          current.state!.result.diagnostics!.push({ index: current.index, reason: suppliedQuote
            ? "Nonverbatim quote replaced by exact source evidence; review required."
            : "Alias-based evidence resolution attached exact source evidence; review required." });
        }
      }
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
    else if (state.result.rejected.length && !state.result.findings.length) state.result.failureReason = "Invalid commands rejected; valid sibling findings retained. Explicit Retry required.";
  }
  return { sources: states.map(s => s.result) };
}

export async function runSinglePassMemoryBatch(a: Adventure, provider: ProviderConfig, batch: PreparedSinglePassMemoryBatch): Promise<SinglePassMemoryBatchResult> {
  const config = memoryBatchProvider(provider, batch.checkpoints.map(s => s.sourceId));
  // Bounded extraction output, independent of narration settings. Cancellation guard stays on this exact config.
  config.memoryRequest = { ...config.memoryRequest!, batchId: batch.batchId, attempt: Math.max(1, ...batch.checkpoints.map(c => a.messages.find(m => m.id === c.sourceId)?.memoryEvaluation?.attempts ?? 1)) };
  config.maxOutputTokens = Math.min(8192, Math.max(provider.maxOutputTokens || 0, 1024 + batch.checkpoints.length * 2048));
  const response = await sendMemoryCompletion(a, config, buildSinglePassMemoryMessages(batch), "singlePass");
  const result = parseSinglePassMemoryResponse(response.content, batch.checkpoints.map(s => s.sourceId), a, batch.outputAliases, batch);
  return { ...result, usage: response.usage };
}

