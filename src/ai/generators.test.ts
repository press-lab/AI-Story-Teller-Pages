import { describe, expect, it } from "vitest";
import type { ArcContinuationOption } from "../types/adventure";
import { pickConvergentContinuation } from "./generators";

const opt = (label: string, threadKeys: string[]): ArcContinuationOption => ({
  label,
  premise: label,
  threadKeys,
  simmerInstruction: "",
  breakInstruction: "",
  pace: "epic",
});

describe("pickConvergentContinuation", () => {
  it("returns undefined when there are no options", () => {
    expect(pickConvergentContinuation([], {})).toBeUndefined();
  });

  it("picks the option whose carried threads had the most prior engagement", () => {
    const options = [opt("A", ["x"]), opt("B", ["azula"]), opt("C", ["y"])];
    expect(pickConvergentContinuation(options, { azula: 7, x: 1 })?.label).toBe("B");
  });

  it("falls back to the lead option when nothing overlaps prior engagement", () => {
    const options = [opt("first", ["p"]), opt("second", ["q"])];
    expect(pickConvergentContinuation(options, { z: 5 })?.label).toBe("first");
  });
});
