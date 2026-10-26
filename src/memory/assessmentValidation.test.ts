import { expect, it } from "vitest";
import { parseMemoryAssessment } from "./assessmentValidation";
import { safeMemoryFailure } from "../providers/backgroundProvider";

const conditions = { plot: [{ id: "plot:p", condition: "Changed premise" }], storyCards: [{ id: "storyCard:c", condition: "New fact" }], brains: [{ id: "brain:b", condition: "Private change" }] };
const negative = () => ({ plot: { targets: [], reason: "No changed premise." }, storyCards: { targets: [], reason: "No new fact." },
  brains: { targets: [], reason: "No eligible private change." }, discovery: { needed: false, reason: "Routine action.", evidenceMessageIds: [] } });
const parse = (v: unknown) => parseMemoryAssessment(JSON.stringify(v), conditions, ["plot", "storyCards", "brains", "discovery"], ["prior", "source"], "source");
it("accepts an explicit, complete negative assessment", () => expect(parse(negative())).toEqual(negative()));
it.each<[string, string, () => unknown]>([
  ["invalid_json", "$", () => "{private-body-not-for-storage"],
  ["wrong_type", "$", () => []],
  ["missing_field", "$.brains", (): unknown => { const { brains: _brains, ...value } = negative(); return value; }],
  ["missing_field", "$.discovery.evidenceMessageIds", () => ({ ...negative(), discovery: { needed: true, reason: "New event" } })],
  ["wrong_type", "$.plot.targets", () => ({ ...negative(), plot: { reason: "Quiet", targets: {} } })],
  ["wrong_type", "$.discovery.needed", () => ({ ...negative(), discovery: { ...negative().discovery, needed: "false" } })],
  ["invalid_value", "$.brains.reason", () => ({ ...negative(), brains: { targets: [], reason: " " } })],
])("reports %s at %s", (code, fieldPath, make) => {
  try {
    const value = make();
    if (code === "invalid_json") parseMemoryAssessment(value as string, conditions, [], [], "source"); else parse(value);
    throw new Error("Expected rejection");
  } catch (e) {
    const failure = safeMemoryFailure(e, true);
    expect(failure).toMatchObject({ code: `memory_assessment_${code}`, fieldPath, category: "invalid_model_output" });
    expect(JSON.stringify(failure)).not.toContain("private-body-not-for-storage");
  }
});
it.each([
  ["unknown_target_id", "$.storyCards.targets[0].id", { id: "secret-unknown-target", delta: "A change", evidenceMessageIds: ["source"] }],
  ["missing_field", "$.storyCards.targets[0].delta", { id: "storyCard:c", evidenceMessageIds: ["source"] }],
  ["invalid_evidence_id", "$.storyCards.targets[0].evidenceMessageIds[0]", { id: "storyCard:c", delta: "A change", evidenceMessageIds: ["secret-invented-id"] }],
  ["wrong_type", "$.storyCards.targets[0].evidenceMessageIds[0]", { id: "storyCard:c", delta: "A change", evidenceMessageIds: [123] }],
  ["missing_source_citation", "$.storyCards.targets[0].evidenceMessageIds", { id: "storyCard:c", delta: "A change", evidenceMessageIds: ["prior"] }],
] as const)("does not sanitize targets/evidence to pass: %s", (code, fieldPath, target) => {
  expect(() => parse({ ...negative(), storyCards: { reason: "Change", targets: [target] } })).toThrow(`memory_assessment_${code}`);
  try { parse({ ...negative(), storyCards: { reason: "Change", targets: [target] } }); }
  catch (e) { expect(safeMemoryFailure(e, true).fieldPath).toBe(fieldPath); expect(JSON.stringify(e)).not.toContain("secret-"); }
});
it("requires the establishing source for positive discovery too", () => {
  expect(() => parse({ ...negative(), discovery: { needed: true, reason: "New event", evidenceMessageIds: ["prior"] } })).toThrow("memory_assessment_missing_source_citation");
});
it("rejects duplicate requested targets and ignores unrequested targets", () => {
  const target = { id: "plot:p", delta: "Changed premise", evidenceMessageIds: ["source"] };
  const value = { ...negative(), plot: { reason: "New premise", targets: [target, target] } };
  expect(() => parse(value)).toThrow("memory_assessment_duplicate_target_id");
  value.plot.targets.pop();
  expect(parseMemoryAssessment(JSON.stringify(value), conditions, ["discovery"], ["source"], "source").plot).toEqual({ reason: "New premise", targets: [] });
});

it("fills only absent negative discovery evidence", () => {
  expect(parse({ ...negative(), discovery: { needed: false, reason: "Quiet" } }).discovery.evidenceMessageIds).toEqual([]);
  expect(() => parse({ ...negative(), discovery: { needed: false, reason: "Quiet", evidenceMessageIds: null } })).toThrow("memory_assessment_wrong_type");
});
it.each([["storyCards", "c", "storyCard:c"], ["brains", "b", "brain:b"]] as const)("normalizes an exact missing %s prefix without changing delta or evidence", (group, id, expected) => {
  const target = { id, delta: "Supported change", evidenceMessageIds: ["prior", "source"] };
  expect(parse({ ...negative(), [group]: { reason: "Changed", targets: [target] } })[group].targets).toEqual([{ ...target, id: expected }]);
});
it("does not normalize Plot IDs or match names, titles, or ambiguous condition IDs", () => {
  expect(() => parse({ ...negative(), plot: { reason: "Changed", targets: [{ id: "p", delta: "Change", evidenceMessageIds: ["source"] }] } })).toThrow("memory_assessment_unknown_target_id");
  const raw = JSON.stringify({ ...negative(), storyCards: { reason: "Changed", targets: [{ id: "c", delta: "Change", evidenceMessageIds: ["source"] }] } });
  expect(() => parseMemoryAssessment(raw, { ...conditions, storyCards: [...conditions.storyCards, ...conditions.storyCards] }, ["storyCards"], ["source"], "source")).toThrow("memory_assessment_unknown_target_id");
});

it.each(["plot", "storyCards", "brains"] as const)("clears positive unrequested %s targets before strict ID/evidence validation", group => {
  const value = { ...negative(), [group]: { reason: "Retained model reason", targets: [{ id: "unknown", delta: "Unsupported", evidenceMessageIds: ["invented"] }] } };
  expect(parseMemoryAssessment(JSON.stringify(value), conditions, ["discovery"], ["source"], "source")[group]).toEqual({ reason: "Retained model reason", targets: [] });
});
it("preserves requested positive targets and rejects unknown requested IDs", () => {
  const target = { id: "brain:b", delta: "Supported private change", evidenceMessageIds: ["source"] };
  const value = { ...negative(), brains: { reason: "Changed", targets: [target] } };
  expect(parse(value).brains.targets).toEqual([target]);
  expect(() => parse({ ...value, brains: { ...value.brains, targets: [{ ...target, id: "brain:unknown" }] } })).toThrow("memory_assessment_unknown_target_id");
});
