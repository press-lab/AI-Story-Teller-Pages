import type { Adventure, ComponentType, SinglePassMemoryBatchResult, SinglePassMemoryFinding, StoryCardType } from "../types/adventure";
import type { PreparedSinglePassMemoryBatch } from "./singlePassMemory";
import type { LooseMemoryOperation, LooseMemoryParseResult } from "./looseMemoryParser";
import { normalizeSinglePassFinding } from "./singlePassMemory";
import { validateSinglePassSource } from "./singlePassMemoryValidation";
import { safeLoreAppendTarget, storyCardTargets } from "./storyCardSuggestions";
import { matchingStoryCardEntities, characterParticipants } from "./storyCardEntities";
import { generatedStoryCardTriggers } from "./resolveMemoryTarget";
import { factsCovered } from "./factCoverage";

const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const brainFields = ["thoughts", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"];
const cardTypes: StoryCardType[] = ["lore", "character", "location", "custom"];
const componentTypes: ComponentType[] = ["plotEssentials", "currentArc", "activePressure", "immediateMomentum", "narrationRules", "aiInstructions", "authorNote", "memory", "custom"];
type Source = PreparedSinglePassMemoryBatch["outputAliases"][string];
export type LooseCategory = { category: "brain" | "storyCard" | "component"; subtype: string };
export interface LooseDestination {
  category: LooseCategory;
  targetId: string | null;
  operation: "append" | "create" | "replace" | "patch";
  candidates?: string[];
  diagnostic?: string;
  suppressed?: boolean;
}
type Resolution<T> = { value: T; error?: never } | { value?: never; error: string };

/** Stage 1: aliases identify saved narrator entries, never a guessed source. */
export function resolveLooseSource(a: Adventure, batch: PreparedSinglePassMemoryBatch, alias: string): Resolution<Source> {
  const source = Object.hasOwn(batch.outputAliases, alias) ? batch.outputAliases[alias] : undefined;
  if (!source || !batch.checkpoints.some(c => c.sourceId === source.sourceId)) return { error: "Missing or unknown source alias." };
  const message = a.messages.find(m => m.id === source.sourceId);
  if (!message || message.role !== "assistant" || message.inputMode === "comms" || !message.content.trim()) return { error: "Missing saved in-story narrator source." };
  return { value: source };
}
/** Stage 2: validate the complete taxonomy; unsupported component intents stay components. */
export function resolveLooseCategory(op: LooseMemoryOperation): Resolution<LooseCategory> {
  if (op.category === "unclassified") return { value: { category: "storyCard", subtype: "lore" } };
  const subtype = op.subtype ?? (op.category === "brain" ? "thoughts" : op.category === "storyCard" ? "lore" : "");
  const allowed = op.category === "brain" ? brainFields : op.category === "storyCard" ? cardTypes : componentTypes;
  if (!allowed.some(t => t === subtype)) return { error: "Unknown " + op.category + " subtype: " + subtype + "." };
  if (op.category === "component" && !["plotEssentials", "currentArc", "activePressure", "immediateMomentum"].includes(subtype)) {
    return { error: "Recognized component subtype; automatic memory routing is not permitted." };
  }
  return { value: { category: op.category, subtype } };
}
/** Stage 3: exact structural identity first. Only Lore uses the existing topical resolver. */
export function resolveLooseDestination(a: Adventure, source: Source, op: LooseMemoryOperation, category: LooseCategory): Resolution<LooseDestination> {
  const subject = normalize(op.subject);
  if (category.category === "brain") {
    const eligible = a.brains.filter(b => b.active && Object.values(source.brains).some(entry => entry.id === b.id));
    let matches = eligible.filter(b => normalize(b.characterName) === subject);
    if (!matches.length) {
      const aliases = a.storyCards.filter(c => c.type === "character" && [c.title, ...c.keys].some(name => normalize(name) === subject));
      matches = eligible.filter(b => aliases.some(c => c.id === b.linkedStoryCardId));
      if (aliases.length > 1 && matches.length) return { error: "Ambiguous Brain destination: linked Character alias is not unique." };
    }
    if (matches.length > 1) return { error: "Ambiguous Brain destination: multiple eligible characters match." };
    if (!matches.length) return { error: "Ineligible Brain destination: no unique existing active perspective in this source manifest." };
    return { value: { category, targetId: matches[0].id, operation: "patch" } };
  }
  if (category.category === "component") {
    if (op.explicitCreation) return { error: "New Components cannot be created by memory extraction." };
    const typed = a.components.filter(c => c.type === category.subtype && normalize(c.title) === subject);
    const matches = typed.filter(c => c.active && (c.type === "plotEssentials" ? c.autoUpdate === true : c.autoUpdate !== false)
      && Object.values(source.plot).some(entry => entry.id === c.id && entry.type === category.subtype));
    if (matches.length > 1) return { error: "Ambiguous component destination: multiple eligible titles and subtypes match." };
    if (!matches.length) return { error: "Ineligible component destination: missing, inactive, opted out, wrong subtype or outside source eligibility." };
    return { value: { category, targetId: matches[0].id, operation: category.subtype === "currentArc" ? "append" : "replace" } };
  }
  const cards = a.storyCards.filter(c => c.type === category.subtype);
  let matches = cards.filter(c => normalize(c.title) === subject);
  if (!matches.length) matches = cards.filter(c => c.keys.some(alias => normalize(alias) === subject));
  if (category.subtype === "character" && !matches.length) matches = matchingStoryCardEntities(cards, op.subject, op.content);
  if (category.subtype === "character" && matches.length) {
    if (matches.length > 1) return { error: "Ambiguous Character identity; no duplicate profile created." };
    if (factsCovered(op.content, [matches[0].content])) return { value: { category, targetId: matches[0].id, operation: "append", suppressed: true } };
    if (op.explicitUpdate) {
      if (!op.enduringReason?.trim()) return { error: "Character correction requires an explicit enduring-change reason after ||." };
      return { value: { category, targetId: matches[0].id, operation: "append" } };
    }
    // No enduring justification is invented for an existing biography.
    const lore = resolveLooseDestination(a, source, op, { category: "storyCard", subtype: "lore" });
    if (lore.value) lore.value.diagnostic = "Existing Character protected: ordinary development recovered as review-required Lore without an enduring profile justification.";
    return lore;
  }
  if (category.subtype === "character" && op.explicitUpdate) return { error: "Character correction requires an existing unique Character identity." };
  if (category.subtype === "lore") {
    const targetId = safeLoreAppendTarget(a, { title: op.subject }) ?? null;
    const candidates = [...new Set([...matches.map(c => c.id), ...storyCardTargets(a, { title: op.subject, content: op.content, type: "lore" })])]
      .filter(id => cards.some(c => c.id === id));
    return { value: { category, targetId, operation: targetId ? "append" : "create", candidates,
      ...(!targetId && candidates.length ? { diagnostic: "No unique strong Lore topic match; candidate choices retained for manual review." } : {}) } };
  }
  const candidates = matches.map(c => c.id);
  if (candidates.length > 1) return { error: "Ambiguous " + category.subtype + " destination; no duplicate created." };
  return { value: { category, targetId: candidates.length === 1 ? candidates[0] : null,
    operation: candidates.length === 1 ? "append" : "create", candidates } };
}
function hash(text: string): string {
  let value = 2166136261;
  for (const ch of text) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return (value >>> 0).toString(16);
}
/** Stage 4: internal IDs, patch fields, provenance and defaults are application-owned. */
export function buildLooseFinding(a: Adventure, source: Source, op: LooseMemoryOperation, destination: LooseDestination): SinglePassMemoryFinding | undefined {
  const narrator = a.messages.find(m => m.id === source.sourceId);
  if (!narrator) return undefined;
  const evidenceQuotes = [{ messageId: narrator.id, quote: narrator.content }];
  const kind = destination.category.category === "component" ? destination.category.subtype as SinglePassMemoryFinding["kind"] : destination.category.category;
  const base: SinglePassMemoryFinding = { kind, targetId: destination.targetId, title: op.subject, candidateOnly: kind === "storyCard"
    ? op.category === "unclassified" || destination.category.subtype === "character" || Boolean(destination.diagnostic)
    : kind !== "brain",
    reason: destination.diagnostic ?? (op.category === "unclassified" ? "Unclassified assignment recovered as review-required Lore." : "Extracted factual candidate; narrator provenance attached locally."),
    evidenceQuotes, operation: destination.operation };
  if (kind === "storyCard" && destination.category.subtype === "lore" && !destination.targetId
    && a.storyCards.some(c => c.type !== "lore" && normalize(c.title) === normalize(op.subject))) {
    base.title = op.subject + ": " + op.content.split(/\s+/).slice(0, 8).join(" ");
  }
  if (kind === "brain") {
    const brain = a.brains.find(b => b.id === destination.targetId)!;
    if (destination.category.subtype === "thoughts") {
      const prefix = "memory_" + hash(narrator.id + "\0" + op.content) + "_" + op.ordinal;
      let key = prefix, suffix = 1;
      while (Object.hasOwn(brain.thoughts, key) || Object.hasOwn(brain.archivedThoughts, key)) key = prefix + "_" + suffix++;
      base.brainPatch = { thoughts: { [key]: source.sourceTurn + " \u2192 " + op.content } };
    } else base.brainPatch = { [destination.category.subtype]: op.content };
  } else {
    base.content = op.content;
    if (kind === "storyCard") {
      const card = a.storyCards.find(c => c.id === destination.targetId);
      base.storyCardType = destination.category.subtype as StoryCardType;
      base.participants = characterParticipants(a.storyCards, op.content);
      base.operation = card ? "append" : "create";
      base.memoryMode = card?.memoryMode ?? "static";
      base.suggestedTriggers = generatedStoryCardTriggers(a, base.title, op.content, undefined, card?.id, base.memoryMode, base.storyCardType);
      // An attached source proves provenance, not completion. Preserve all factual modality in content.
      base.eventStatus = "unresolved";
      base.destinationCandidates = destination.candidates;
      if (base.storyCardType === "character" && card && op.explicitUpdate && op.enduringReason) {
        base.identityChange = { targetId: card.id, kind: "profile", fact: op.content, reason: op.enduringReason, evidenceQuotes };
      }
    }
  }
  return normalizeSinglePassFinding(base, narrator.id, a);
}
/** Stage 5: existing source/finding validation and coverage, without persistence or paid work. */
export function routeLooseMemoryOperations(a: Adventure, batch: PreparedSinglePassMemoryBatch, parsed: LooseMemoryParseResult): SinglePassMemoryBatchResult {
  return { sources: Object.entries(batch.outputAliases).map(([alias, manifest]) => {
    const ops = parsed.operations.filter(op => op.sourceAlias === alias);
    const result: SinglePassMemoryBatchResult["sources"][number] = { sourceId: manifest.sourceId, findings: [], findingIndexes: [],
      rejected: [], diagnostics: [], parsedCount: ops.length, routedCount: 0, suppressedIndexes: [] };
    const source = resolveLooseSource(a, batch, alias);
    for (const diagnostic of parsed.diagnostics.filter(d => d.sourceAlias === alias || !d.sourceAlias)) {
      if (diagnostic.ordinal !== undefined && diagnostic.sourceAlias === alias) result.rejected.push({ index: diagnostic.ordinal, reason: diagnostic.reason });
      else result.diagnostics!.push({ index: -1, reason: diagnostic.reason });
    }
    for (const op of ops) {
      const category = resolveLooseCategory(op);
      const destination = source.value && category.value ? resolveLooseDestination(a, source.value, op, category.value) : undefined;
      const error = source.error ?? category.error ?? destination?.error;
      if (error || !source.value || !destination?.value) { result.rejected.push({ index: op.ordinal, reason: error ?? "Unresolved destination." }); continue; }
      result.routedCount!++;
      if (destination.value.diagnostic) result.diagnostics!.push({ index: op.ordinal, reason: destination.value.diagnostic });
      if (destination.value.suppressed) { result.suppressedIndexes!.push(op.ordinal); continue; }
      const finding = buildLooseFinding(a, source.value, op, destination.value);
      if (!finding) result.rejected.push({ index: op.ordinal, reason: "Locally constructed finding failed schema validation." });
      else { result.findings.push(finding); result.findingIndexes!.push(op.ordinal); }
    }
    if (!parsed.evaluatedSources.includes(alias) || parsed.incompleteSources.includes(alias)) {
      result.failureReason = "Source absent, unattributable or contains only malformed operations.";
    }
    const checkpoint = batch.checkpoints.find(c => c.sourceId === manifest.sourceId)?.checkpoint;
    if (!checkpoint) result.failureReason = "Missing source checkpoint.";
    else {
      const validated = validateSinglePassSource(a, result, checkpoint);
      const rejected = new Set(validated.rejected.map(r => r.index));
      const indexes = result.findingIndexes!;
      result.findings = result.findings.filter((_, i) => !rejected.has(indexes[i]));
      result.findingIndexes = indexes.filter(index => !rejected.has(index));
      result.rejected = validated.rejected;
      result.failureReason = validated.failureReason;
    }
    return result;
  }) };
}
