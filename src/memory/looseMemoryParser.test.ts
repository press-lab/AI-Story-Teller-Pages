import { describe, expect, it } from "vitest";
import { parseLooseMemoryOperations as parse } from "./looseMemoryParser";
const thought = "I think this could become a real business.";
const expected = (extra = {}) => ({ sourceAlias: "S1", category: "brain", subtype: "thoughts", subject: "George Weasley", content: thought,
  ordinal: 0, explicitCreation: false, explicitUpdate: false, ...extra });
describe("loose operation grammar (no Adventure or provider)", () => {
  it.each([
    "(brain: George Weasley = " + thought + ")", "[Brain: George Weasley = " + thought + "]",
    "{brain: George Weasley = " + thought + "}", "brain: George Weasley = " + thought,
    "brain George Weasley: " + thought, "brain: George Weasley = " + thought + ")",
    "(brain: George Weasley = " + thought, "(brain: George Weasley = " + thought + "]",
    "  - (BRAIN::: George Weasley === " + thought + ")", "1. (brain: George Weasley = " + thought + ")",
    '"(brain: George Weasley = ' + thought + ')"', "\uFEFF\u200B(brain: George Weasley = " + thought + ")",
    "\x60\x60\x60text\n(brain: George Weasley = " + thought + ")\n\x60\x60\x60",
    "<think>(brain: Wrong = reasoning)</think>\n(brain: George Weasley = " + thought + ")",
    "<reasoning>Private reasoning</reasoning>\n(brain: George Weasley = " + thought + ")",
    "\x60\x60\x60text\n<think>reasoning</think>\n(brain: George Weasley = " + thought + ")\n\x60\x60\x60",
  ])("recovers exact information: %s", text => {
    const r = parse(text, ["S1"]);
    expect(r.operations).toEqual([expected()]);
    expect(r.evaluatedSources).toEqual(["S1"]); expect(r.incompleteSources).toEqual([]);
  });
  it.each(["S1", "S1:", "[S1]", "Source 1", "Source 1:"])("accepts source header %s", header => {
    expect(parse(header + "\n(brain: George Weasley = " + thought + ")", ["S1", "S2"]).operations).toEqual([expected()]);
  });
  it("accepts prefixed operations and multiline content without splitting factual assignments", () => {
    const content = "I should check x = y: the result\nstill depends on z = 3.";
    expect(parse("S1: (brain: George Weasley = " + content + ")", ["S1", "S2"]).operations).toEqual([expected({ content })]);
  });
  it.each([
    ["thought", "brain", "thoughts"], ["private thought", "brain", "thoughts"],
    ["brain state", "brain", "currentState"], ["brain.relationship", "brain", "relationshipPressure"],
    ["brain.emotion", "brain", "emotionalInterpretation"], ["brain.developments", "brain", "recentDevelopments"],
    ["brain.notes", "brain", "notes"], ["brain.current_state", "brain", "currentState"],
    ["lore", "storyCard", "lore"], ["event", "storyCard", "lore"], ["story", "storyCard", "lore"],
    ["memory", "storyCard", "lore"], ["storycard", "storyCard", "lore"], ["story card", "storyCard", "lore"],
    ["story card lore", "storyCard", "lore"], ["character", "storyCard", "character"],
    ["new character", "storyCard", "character"], ["storyCard.character", "storyCard", "character"],
    ["location", "storyCard", "location"], ["place", "storyCard", "location"],
    ["custom story card", "storyCard", "custom"], ["storyCard.custom", "storyCard", "custom"],
    ["plot essentials", "component", "plotEssentials"], ["plotEssentials", "component", "plotEssentials"],
    ["current arc", "component", "currentArc"], ["currentArc", "component", "currentArc"],
    ["active pressure", "component", "activePressure"], ["activePressure", "component", "activePressure"],
    ["immediate momentum", "component", "immediateMomentum"], ["immediateMomentum", "component", "immediateMomentum"],
    ...["plotEssentials", "currentArc", "activePressure", "immediateMomentum", "narrationRules", "aiInstructions", "authorNote", "memory", "custom"]
      .map(type => ["component." + type, "component", type]),
  ])("canonicalizes %s", (label, category, subtype) => {
    expect(parse(label + ": George Weasley = " + thought, ["S1"]).operations).toEqual([
      expected({ category, subtype, explicitCreation: label === "new character" }),
    ]);
  });
  it("preserves correction and reason separately", () => {
    expect(parse("(storyCard.character.update: Eleanor Vale = Eleanor lost fire magic. || The experiment established the lasting loss.)", ["S1"]).operations).toEqual([
      expected({ category: "storyCard", subtype: "character", subject: "Eleanor Vale", content: "Eleanor lost fire magic.",
        explicitUpdate: true, enduringReason: "The experiment established the lasting loss." }),
    ]);
  });
  it.each(["(Tattoo Business = The first batch ships tomorrow.)", "unknown: Tattoo Business = The first batch ships tomorrow."])("retains unclassified assignment %s", text => {
    expect(parse(text, ["S1"]).operations).toEqual([{
      sourceAlias: "S1", category: "unclassified", subject: "Tattoo Business", content: "The first batch ships tomorrow.",
      ordinal: 0, explicitCreation: false, explicitUpdate: false,
    }]);
  });
  it("preserves unknown explicit subtypes for rejection", () => {
    expect(parse("brain.telepathy: George = I know.\ncomponent.quantum: X = Fact.", ["S1"]).operations).toEqual([
      expected({ subject: "George", subtype: "telepathy", content: "I know." }),
      expected({ category: "component", subtype: "quantum", subject: "X", content: "Fact.", ordinal: 1 }),
    ]);
  });
  it("does not guess source labels for three-source requests", () => {
    const r = parse("(brain: George Weasley = " + thought + ")", ["S1", "S2", "S3"]);
    expect(r.operations).toEqual([]); expect(r.evaluatedSources).toEqual([]);
    expect(r.incompleteSources).toEqual(["S1", "S2", "S3"]); expect(r.diagnostics[0].reason).toMatch(/source label/);
  });
  it.each(["NONE", "none", "no updates"])("accepts evaluated empty %s", none => {
    const r = parse("S1\n" + none + "\nS2\n", ["S1", "S2", "S3"]);
    expect(r.operations).toEqual([]); expect(r.evaluatedSources).toEqual(["S1", "S2"]); expect(r.incompleteSources).toEqual(["S3"]);
  });
  it("isolates malformed siblings and keeps ordinals", () => {
    const r = parse("S1\n(brain: George Weasley = " + thought + "\nbrain: Broken\n[brain: George Weasley = Another thought.]\nS2\nbrain: Broken", ["S1", "S2", "S3"]);
    expect(r.operations).toEqual([expected(), expected({ content: "Another thought.", ordinal: 2 })]);
    expect(r.diagnostics).toEqual([
      { sourceAlias: "S1", ordinal: 1, reason: "Malformed operation: no recognizable subject/content assignment." },
      { sourceAlias: "S2", ordinal: 3, reason: "Malformed operation: no recognizable subject/content assignment." },
    ]);
    expect(r.evaluatedSources).toEqual(["S1", "S2"]); expect(r.incompleteSources).toEqual(["S2", "S3"]);
  });
  it("repairs adjacent blocks", () => {
    expect(parse("(brain: George Weasley = " + thought + ")(lore: Business = The shop opens.)", ["S1"]).operations).toEqual([
      expected(), expected({ category: "storyCard", subtype: "lore", subject: "Business", content: "The shop opens.", ordinal: 1 }),
    ]);
  });
  it.each(["<think>(brain: George = Hidden reasoning.)", "\x60\x60\x60text\nbrain: George = Not a finished response."])("does not parse incomplete wrappers", text => {
    expect(parse(text, ["S1"]).operations).toEqual([]); expect(parse(text, ["S1"]).incompleteSources).toEqual(["S1"]);
  });
  it("does not borrow the prior source for an unknown header", () => {
    const r = parse("S1\nNONE\nSource 9:\n(brain: George Weasley = " + thought + ")", ["S1", "S2"]);
    expect(r.operations).toEqual([]); expect(r.evaluatedSources).toEqual(["S1"]); expect(r.incompleteSources).toEqual(["S2"]);
  });
  it.each(['{"sources":[{"sourceId":"id","findings":[]}]}', "MEM S1 storyCard NEW\nTEXT\nFact.\nEND\nDONE S1", "An arbitrary paragraph."])("leaves legacy formats and arbitrary prose outside the loose grammar", text => {
    expect(parse(text, ["S1"]).operations).toEqual([]);
  });
});

it("uses the first valid assignment boundary when colon-form content contains equals", () => {
  expect(parse("brain George Weasley: I should test x = y: the result matters.", ["S1"]).operations).toEqual([
    expected({ content: "I should test x = y: the result matters." }),
  ]);
});
it("does not classify category lookalikes as private Brains", () => {
  expect(parse("(brainstorm: Tattoo Business = The shop opens tomorrow.)", ["S1"]).operations).toEqual([{
    sourceAlias: "S1", category: "unclassified", subject: "Tattoo Business", content: "The shop opens tomorrow.",
    ordinal: 0, explicitCreation: false, explicitUpdate: false,
  }]);
});
it("extracts complete Markdown fences in separate source groups", () => {
  const r = parse("S1\n\x60\x60\x60text\nbrain: George Weasley = " + thought + "\n\x60\x60\x60\nS2\n\x60\x60\x60text\nNONE\n\x60\x60\x60", ["S1", "S2"]);
  expect(r.operations).toEqual([expected()]);
  expect(r.incompleteSources).toEqual([]);
});
it("retains valid siblings before an unfinished fenced section without marking that section empty", () => {
  const r = parse("S1\nbrain: George Weasley = " + thought + "\nS2\n\x60\x60\x60text\nbrain: Fred = Unfinished", ["S1", "S2"]);
  expect(r.operations).toEqual([expected()]); expect(r.incompleteSources).toEqual(["S2"]);
});

it.each([
  ["brain: George Weasley = I should check f(x)", "I should check f(x)"],
  ["(brain: George Weasley = I should check f(x))", "I should check f(x)"],
  ["(brain: George Weasley = I should check f(x)", "I should check f(x)"],
  ["brain: George Weasley = I should check [the notes]", "I should check [the notes]"],
  ["brain: George Weasley = I should check x || y.", "I should check x || y."],
])("preserves factual brackets and operators: %s", (input, content) => {
  expect(parse(input, ["S1"]).operations).toEqual([expected({ content })]);
});
it.each(["constructor", "toString", "brainstorm"])("does not recognize inherited or lookalike labels: %s", label => {
  expect(parse("(" + label + ": Business = Production begins tomorrow.)", ["S1"]).operations).toEqual([{
    sourceAlias: "S1", category: "unclassified", subject: "Business", content: "Production begins tomorrow.",
    ordinal: 0, explicitCreation: false, explicitUpdate: false,
  }]);
});
it("normalizes a spaced enduring-update label without mistaking update for a name", () => {
  expect(parse("story card character update: Eleanor Vale = Eleanor lost her fire magic. || This lasting loss was established.", ["S1"]).operations).toEqual([
    expected({ category: "storyCard", subtype: "character", subject: "Eleanor Vale", content: "Eleanor lost her fire magic.",
      explicitUpdate: true, enduringReason: "This lasting loss was established." }),
  ]);
});

it("keeps category words in multiline factual continuation sentences", () => {
  const content = "I should inspect the experiment.\nBrain cells respond to x = y.\nCurrent arc measurements require z = 3.";
  expect(parse("brain: George Weasley = " + content, ["S1"]).operations).toEqual([expected({ content })]);
});
