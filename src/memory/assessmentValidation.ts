import type { MemoryAssessmentCheckpoint, MemoryAssessmentDecision, MemoryEvaluationGroup } from "../types/adventure";
import { MemoryEvaluationError } from "../providers/backgroundProvider";
import type { AssessmentConditions } from "./memoryAssessment";

type Code = "invalid_json" | "wrong_type" | "missing_field" | "invalid_value" | "unknown_target_id"
  | "invalid_evidence_id" | "missing_source_citation" | "duplicate_target_id" | "unrequested_group";

/** Codes and paths are constructed locally, never from provider keys, values or exceptions. */
function fail(code: Code, path: string): never {
  throw new MemoryEvaluationError("invalid_model_output", `memory_assessment_${code}`,
    `Assessment validation failed at ${path}. No assessment decision was accepted.`, undefined, undefined, path);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("wrong_type", path);
  return value as Record<string, unknown>;
}
function field(value: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.hasOwn(value, key)) fail("missing_field", `${path}.${key}`);
  return value[key];
}
function string(value: unknown, path: string, max?: number): string {
  if (typeof value !== "string") fail("wrong_type", path);
  if (!value.trim() || (max !== undefined && value.length > max)) fail("invalid_value", path);
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("wrong_type", path);
  return value;
}

function normalizeAssessmentShape(raw: unknown, conditions: AssessmentConditions): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const discovery = value.discovery;
  if (discovery && typeof discovery === "object" && !Array.isArray(discovery)) {
    const d = discovery as Record<string, unknown>;
    if (d.needed === false && !Object.hasOwn(d, "evidenceMessageIds")) d.evidenceMessageIds = [];
  }
  for (const [group, prefix] of [["storyCards", "storyCard:"], ["brains", "brain:"]] as const) {
    const decision = value[group];
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) continue;
    const targets = (decision as Record<string, unknown>).targets;
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      if (!target || typeof target !== "object" || Array.isArray(target) || typeof target.id !== "string") continue;
      if (conditions[group].some(c => c.id === target.id)) continue;
      const matches = conditions[group].filter(c => c.id === `${prefix}${target.id}`);
      if (matches.length === 1) target.id = matches[0].id;
    }
  }
  return raw;
}

export function parseMemoryAssessment(content: string, conditions: AssessmentConditions, requested: readonly MemoryEvaluationGroup[],
  evidenceIds: readonly string[], sourceId: string): Pick<MemoryAssessmentCheckpoint, "plot" | "storyCards" | "brains" | "discovery"> {
  let raw: unknown;
  try { raw = JSON.parse(content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { fail("invalid_json", "$"); }
  const value = object(normalizeAssessmentShape(raw, conditions), "$");
  const evidence = (ids: unknown, path: string, changed: boolean): string[] => {
    const result = array(ids, path).map((id, index) => {
      if (typeof id !== "string") fail("wrong_type", `${path}[${index}]`);
      if (!evidenceIds.includes(id)) fail("invalid_evidence_id", `${path}[${index}]`);
      return id;
    });
    if (changed && !result.includes(sourceId)) fail("missing_source_citation", path);
    return result;
  };
  const decision = (group: "plot" | "storyCards" | "brains"): MemoryAssessmentDecision => {
    const path = `$.${group}`, d = object(field(value, group, "$"), path);
    const reason = string(field(d, "reason", path), `${path}.reason`, 1200);
    const seen = new Set<string>();
    const targets = array(field(d, "targets", path), `${path}.targets`).map((target, index) => {
      const p = `${path}.targets[${index}]`, t = object(target, p);
      const id = string(field(t, "id", p), `${p}.id`);
      if (!conditions[group].some(c => c.id === id)) fail("unknown_target_id", `${p}.id`);
      if (!requested.includes(group)) fail("unrequested_group", `${path}.targets`);
      if (seen.has(id)) fail("duplicate_target_id", `${p}.id`);
      seen.add(id);
      return { id, delta: string(field(t, "delta", p), `${p}.delta`, 2400),
        evidenceMessageIds: evidence(field(t, "evidenceMessageIds", p), `${p}.evidenceMessageIds`, true) };
    });
    return { reason, targets };
  };
  const plot = decision("plot"), storyCards = decision("storyCards"), brains = decision("brains");
  const d = object(field(value, "discovery", "$"), "$.discovery");
  const needed = field(d, "needed", "$.discovery");
  if (typeof needed !== "boolean") fail("wrong_type", "$.discovery.needed");
  return { plot, storyCards, brains, discovery: { needed,
    reason: string(field(d, "reason", "$.discovery"), "$.discovery.reason", 1200),
    evidenceMessageIds: evidence(field(d, "evidenceMessageIds", "$.discovery"), "$.discovery.evidenceMessageIds", needed) } };
}
