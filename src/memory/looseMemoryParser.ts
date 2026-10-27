/**
 * Transient extraction grammar. This module knows labels and source aliases only;
 * it never reads an Adventure or chooses a database destination.
 */
export interface LooseMemoryOperation {
  sourceAlias: string;
  category: "brain" | "storyCard" | "component" | "unclassified";
  subtype?: string;
  subject: string;
  content: string;
  ordinal: number;
  explicitCreation: boolean;
  explicitUpdate: boolean;
  enduringReason?: string;
}
export interface LooseMemoryParseResult {
  operations: LooseMemoryOperation[];
  evaluatedSources: string[];
  diagnostics: Array<{ sourceAlias?: string; ordinal?: number; reason: string }>;
  incompleteSources: string[];
}
type Label = Pick<LooseMemoryOperation, "category" | "subtype">;
const key = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");
const brains = ["thoughts", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"];
const cards = ["lore", "character", "location", "custom"];
const components = ["plotEssentials", "currentArc", "activePressure", "immediateMomentum", "narrationRules", "aiInstructions", "authorNote", "memory", "custom"];
const aliases: Record<string, Label> = Object.create(null);
function labels(names: string[], category: Label["category"], subtype: string) {
  for (const name of names) aliases[key(name)] = { category, subtype };
}
labels(["brain", "thought", "thoughts", "private thought"], "brain", "thoughts");
labels(["brain state"], "brain", "currentState");
labels(["brain relationship"], "brain", "relationshipPressure");
labels(["brain emotion"], "brain", "emotionalInterpretation");
labels(["brain developments"], "brain", "recentDevelopments");
labels(["lore", "event", "story", "memory", "storycard", "story card"], "storyCard", "lore");
labels(["character", "new character"], "storyCard", "character");
labels(["location", "place"], "storyCard", "location");
labels(["custom story card"], "storyCard", "custom");
for (const subtype of brains) labels(["brain." + subtype], "brain", subtype);
for (const subtype of cards) labels(["storyCard." + subtype, "story card " + subtype], "storyCard", subtype);
for (const subtype of components) {
  labels(["component." + subtype], "component", subtype);
  if (!["memory", "custom"].includes(subtype)) labels([subtype], "component", subtype);
}
function label(raw: string): Label {
  const normalized = key(raw);
  if (aliases[normalized]) return aliases[normalized];
  // Preserve explicit but unknown subtypes so routing can reject them.
  for (const [prefix, category] of [["storycard", "storyCard"], ["component", "component"], ["brain", "brain"]] as const) {
    if (new RegExp("^" + (prefix === "storycard" ? "story\\s*card" : prefix) + "(?:$|[.\\s_-])", "i").test(raw)) return { category, subtype: normalized.slice(prefix.length) || undefined };
  }
  return { category: "unclassified" };
}
const cleanEdge = (s: string) => s.trim().replace(/^["'“‘\x60]+|["'”’\x60]+$/g, "").trim();
const decoration = (s: string) => cleanEdge(s.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)+/, ""));
function head(raw: string): { label: Label; subject: string; rest: string; creation: boolean; update: boolean } | undefined {
  const value = decoration(raw).replace(/^[([{]\s*/, "");
  const firstColon = /:+/.exec(value);
  if (firstColon) {
    const left = value.slice(0, firstColon.index).trim();
    if (!aliases[key(left.replace(/[.\s_-]+(?:create|new|update)$/i, ""))]) {
      const words = left.split(/\s+/);
      for (let count = words.length - 1; count > 0; count--) {
        const category = aliases[key(words.slice(0, count).join(" "))];
        if (category) return { label: category, subject: cleanEdge(words.slice(count).join(" ")),
          rest: value.slice(firstColon.index + firstColon[0].length).replace(/^\s*[:=]+\s*/, ""), creation: false, update: false };
      }
    }
  }
  const equal = /=+/.exec(value);
  if (equal) {
    const left = value.slice(0, equal.index).trim();
    const colon = /:+/.exec(left);
    const category = colon ? label(left.slice(0, colon.index).replace(/[.\s_-]+(?:create|new|update)$/i, "")) : { category: "unclassified" as const };
    const subject = colon ? left.slice(colon.index + colon[0].length) : left;
    const rawLabel = colon ? left.slice(0, colon.index) : "";
    return { label: category, subject: cleanEdge(subject.replace(/^[:=]+\s*/, "")),
      rest: value.slice(equal.index + equal[0].length).replace(/^\s*[:=]+\s*/, ""),
      creation: /(?:^|[.\s_-])(?:new|create)(?:[.\s_-]|$)/i.test(rawLabel),
      update: /(?:^|[.\s_-])update$/i.test(rawLabel) };
  }
  return undefined;
}
function recognizableStart(raw: string): boolean {
  const s = decoration(raw);
  const h = head(s);
  if (h && (h.label.category !== "unclassified" || /^[([{]/.test(s))) return true;
  // A known label with missing assignment is a malformed operation boundary.
  // Ordinary continuation sentences beginning "Brain ..." are still factual content.
  const prefix = /^([^:=\n]+):+/.exec(s.replace(/^[([{]\s*/, ""));
  return Boolean(prefix && Object.hasOwn(aliases, key(prefix[1].replace(/[.\s_-]+(?:create|new|update)$/i, ""))));
}
export function parseLooseMemoryOperations(text: string, allowedSourceAliases: readonly string[]): LooseMemoryParseResult {
  const result: LooseMemoryParseResult = { operations: [], evaluatedSources: [], diagnostics: [], incompleteSources: [] };
  const allowed = new Map(allowedSourceAliases.map(s => [s.toUpperCase(), s]));
  const evaluated = new Set<string>();
  const malformed = new Set<string>();
  let current: string | undefined = allowedSourceAliases.length === 1 ? allowedSourceAliases[0] : undefined;
  let pending: string[] = [];
  let pendingSource: string | undefined;
  let ordinal = 0;
  let value = text.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D]/g, "").trim();
  // Discard only complete reasoning. A partial wrapper never becomes factual text.
  value = value.replace(/<(think|reasoning|analysis)>[\s\S]*?<\/\1>/gi, "");
  const incomplete = /<(?:think|reasoning|analysis)>/i.exec(value);
  if (incomplete) {
    result.diagnostics.push({ reason: "Incomplete reasoning wrapper; unfinished reasoning was not parsed." });
    value = value.slice(0, incomplete.index);
  }
  // Fences may enclose the whole response or individual source sections.
  value = value.replace(/(^|\n)\s*\x60\x60\x60[^\n]*\n([\s\S]*?)\n?\s*\x60\x60\x60(?=\s*(?:\n|$))/g, "$1$2");
  const unfinishedFence = /\x60\x60\x60/.exec(value);
  if (unfinishedFence) {
    result.diagnostics.push({ reason: "Incomplete Markdown fence; unfinished block was not parsed." });
    value = value.slice(0, unfinishedFence.index);
  }
  const reject = (reason: string, sourceAlias = pendingSource, index = ordinal++) => {
    result.diagnostics.push({ sourceAlias, ordinal: index, reason });
    if (sourceAlias) malformed.add(sourceAlias);
  };
  const flush = () => {
    if (!pending.length) return;
    const raw = pending.join("\n");
    pending = [];
    const index = ordinal++;
    const h = head(raw);
    if (!pendingSource) { reject("Missing or unknown source label; no source attribution inferred.", undefined, index); return; }
    if (!h) { reject("Malformed operation: no recognizable subject/content assignment.", pendingSource, index); return; }
    // Repair one outer container, including mismatched/orphaned closers. Never fill factual text.
    let content = cleanEdge(h.rest);
    const closer = /\s*([)\]}])(?:\s*["'”’\x60.,;]*)?$/.exec(content);
    if (closer) {
      const closing = closer[1], opening = closing === ")" ? "(" : closing === "]" ? "[" : "{";
      // Only an excess closer can belong to the outer operation. Keep factual f(x) or [notes].
      if (content.split(closing).length > content.split(opening).length) content = content.slice(0, closer.index).trim();
    }
    content = cleanEdge(content);
    const separator = h.update && h.label.category === "storyCard" && h.label.subtype === "character" ? content.indexOf("||") : -1;
    const enduringReason = separator >= 0 ? cleanEdge(content.slice(separator + 2)) : undefined;
    if (separator >= 0) content = content.slice(0, separator).trim();
    if (!h.subject || !content) { reject("Malformed operation: empty subject or factual content.", pendingSource, index); return; }
    result.operations.push({ sourceAlias: pendingSource, ...h.label, subject: h.subject, content, ordinal: index,
      explicitCreation: h.creation, explicitUpdate: h.update, ...(enduringReason ? { enduringReason } : {}) });
    evaluated.add(pendingSource);
  };
  // A bracket followed by an operation head is a boundary even if the preceding block never closed.
  // Assignment symbols in ordinary factual content do not establish a boundary.
  value = value.replace(/([^\n])([([{])(?=[^\n()[\]{}]{1,100}(?:=|:))/g, (all, before: string, open: string, offset: number) => {
    const prefix = value.slice(value.lastIndexOf("\n", offset) + 1, offset + before.length);
    if (/^\s*(?:[-*\u2022]|\d+[.)])?\s*["“‘\x60]*\s*$/.test(prefix)) return all;
    const rest = value.slice(offset + before.length);
    return recognizableStart(rest) ? before + "\n" + open : all;
  });
  for (const raw of value.split(/\r?\n/)) {
    let line = decoration(raw);
    if (!line) { if (pending.length) pending.push(""); continue; }
    const source = /^(?:\[\s*)?(?:S\s*(\d+)|Source\s+(\d+))(?=\s|:|\]|$)\s*\]?\s*(?::+\s*)?(.*)$/i.exec(line);
    if (source) {
      flush();
      current = allowed.get("S" + (source[1] ?? source[2]));
      if (current) evaluated.add(current);
      else result.diagnostics.push({ reason: "Unknown source label; no attribution inferred." });
      line = source[3].trim();
      if (!line) continue;
    }
    if (/^(?:none|no updates)[.!]?$/i.test(line)) {
      flush();
      if (current) evaluated.add(current);
      else result.diagnostics.push({ reason: "Empty evaluation has no recognizable source label." });
      continue;
    }
    const starts = recognizableStart(line);
    const unknownAssignment = Boolean(head(line)) && (!pending.length || /^[([{]/.test(line) || /^[^:=]+:+[^=]+=/.test(line));
    if (starts || unknownAssignment) {
      flush(); pendingSource = current; pending = [line];
    } else if (pending.length) pending.push(raw);
    else {
      pendingSource = current;
      reject("Text outside a recognizable memory operation.");
    }
  }
  flush();
  if ((incomplete || unfinishedFence) && current) malformed.add(current);
  for (const alias of allowedSourceAliases) {
    const valid = result.operations.some(op => op.sourceAlias === alias);
    if (!evaluated.has(alias) || (malformed.has(alias) && !valid)) result.incompleteSources.push(alias);
    if (evaluated.has(alias)) result.evaluatedSources.push(alias);
  }
  return result;
}
