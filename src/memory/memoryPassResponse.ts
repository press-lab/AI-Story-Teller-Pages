/**
 * Defensive reader for the background memory pass reply.
 *
 * Providers differ: an Anthropic-format endpoint has no JSON mode, OpenRouter may route to an upstream
 * that ignores response_format, and reasoning models can wrap the object in <think> tags, code fences,
 * or a sentence of prose. This reader finds the JSON object wherever it sits.
 *
 * A reply cut off by the output ceiling is not discarded wholesale: every update object that closed
 * before the cut is recovered. A half-written update is never "repaired" into a plausible one.
 */

export type MemoryPassParseStatus = "ok" | "partial" | "invalid";

export interface MemoryPassParse {
  status: MemoryPassParseStatus;
  /** Update objects to validate. For "partial", only the ones that closed before the cut-off. */
  updates: unknown[];
  /** Why the reply was unusable or partial, in plain words. */
  error?: string;
  /** Text was found around the JSON object (prose, fences, reasoning tags). */
  hadWrapper: boolean;
}

/** Remove reasoning blocks, including one left unclosed by a cut-off. */
function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
}

/**
 * Index just past the value that starts at `start` ('{' or '['), or -1 if it never closes.
 * String-aware, so braces inside quoted text do not count.
 */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Complete objects inside the array that opens at `arrayStart`, stopping at the first unclosed one. */
function completeArrayObjects(text: string, arrayStart: number): unknown[] {
  const objects: unknown[] = [];
  let i = arrayStart + 1;
  while (i < text.length) {
    const next = text.slice(i).search(/[{\]]/);
    if (next < 0) break;
    const at = i + next;
    if (text[at] === "]") break;
    const end = balancedEnd(text, at);
    if (end < 0) break;
    try {
      objects.push(JSON.parse(text.slice(at, end)));
    } catch {
      break;
    }
    i = end;
  }
  return objects;
}

function updatesFrom(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { updates?: unknown }).updates)) {
    return (value as { updates: unknown[] }).updates;
  }
  return undefined;
}

export function parseMemoryPassResponse(content: string, finishReason?: string): MemoryPassParse {
  const cutOff = finishReason === "length";
  const text = stripReasoning(content);
  const start = text.search(/[{[]/);
  if (start < 0) {
    return { status: "invalid", updates: [], hadWrapper: text.length > 0, error: text ? "the reply contained no JSON object" : "the reply was empty (only reasoning, or nothing)" };
  }
  const end = balancedEnd(text, start);
  const hadWrapper = start > 0 || (end >= 0 && text.slice(end).trim().length > 0);

  if (end >= 0) {
    try {
      const updates = updatesFrom(JSON.parse(text.slice(start, end)));
      if (!updates) return { status: "invalid", updates: [], hadWrapper, error: 'the JSON has no "updates" array' };
      // A closed object can still be followed by a cut-off; the object itself is complete.
      return { status: "ok", updates, hadWrapper };
    } catch {
      // Fall through to salvage: the object closed but is malformed somewhere inside.
    }
  }

  // Unclosed (cut off) or malformed: recover the update objects that closed.
  const arrayKey = /"updates"\s*:\s*\[/.exec(text.slice(start));
  const arrayStart = arrayKey ? start + arrayKey.index + arrayKey[0].length - 1 : text[start] === "[" ? start : -1;
  const salvaged = arrayStart >= 0 ? completeArrayObjects(text, arrayStart) : [];
  const why = end < 0 ? (cutOff ? "the reply was cut off by the output ceiling" : "the JSON never closed") : "the JSON is malformed";
  if (salvaged.length) {
    return { status: "partial", updates: salvaged, hadWrapper, error: `${why}; recovered ${salvaged.length} complete update${salvaged.length === 1 ? "" : "s"} written before that point` };
  }
  return { status: "invalid", updates: [], hadWrapper, error: `${why}; no complete update was written before that point` };
}
