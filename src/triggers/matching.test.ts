import { describe, expect, it } from "vitest";
import { matchPatterns, splitList } from "./matching";

describe("matchPatterns", () => {
  it("matches keywords case-insensitively on word boundaries", () => {
    expect(matchPatterns("Open the Silver Door.", ["door"], "keyword")).toEqual({ matched: true, pattern: "door" });
    expect(matchPatterns("The doorknob turns.", ["door"], "keyword")).toEqual({ matched: false });
    expect(matchPatterns("The C++ sigil glows.", ["C++"], "keyword")).toEqual({ matched: true, pattern: "C++" });
  });

  it("matches phrases as case-insensitive substrings", () => {
    expect(matchPatterns("She whispers the old pass phrase.", ["old pass"], "phrase")).toEqual({
      matched: true,
      pattern: "old pass",
    });
    expect(matchPatterns("She whispers the old pass phrase.", ["new pass"], "phrase")).toEqual({ matched: false });
  });

  it("matches valid regex patterns and skips invalid regex patterns", () => {
    expect(matchPatterns("Chapter 42 begins.", ["chapter\\s+\\d+"], "regex")).toEqual({
      matched: true,
      pattern: "chapter\\s+\\d+",
    });
    expect(matchPatterns("Chapter forty begins.", ["chapter\\s+\\d+"], "regex")).toEqual({ matched: false });
    expect(matchPatterns("anything", ["["], "regex")).toEqual({ matched: false });
  });
});

describe("splitList", () => {
  it("trims comma-separated lists and drops empty entries", () => {
    expect(splitList("alpha, beta, , gamma ")).toEqual(["alpha", "beta", "gamma"]);
  });
});
