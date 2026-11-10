import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLOT_ESSENTIALS_BEST_PRACTICES } from "./authoringBestPractices";
import { PLOT_ESSENTIALS_FOUNDATIONS_RULE } from "./authoringPolicy";

describe("written authoring guidance", () => {
  it("keeps component advice aligned with the shared Plot Essentials rule", () => {
    expect(PLOT_ESSENTIALS_BEST_PRACTICES).toContain(PLOT_ESSENTIALS_FOUNDATIONS_RULE);
  });
  it("keeps the README Plot Essentials definition aligned", () => {
    const text = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(text).not.toMatch(/what is happening now|current operating truth/i);
    expect(text).toContain("NEVER include NOW, CURRENTLY, CURRENT SITUATION");
  });
  it.each(["building-a-scenario.md", "adventure-design.md"])("keeps %s free of current-state Plot Essentials advice", (file) => {
    const text = readFileSync(new URL(`../../docs/${file}`, import.meta.url), "utf8");
    expect(text).not.toMatch(/what is happening now|current operating truth/i);
    expect(text).toContain("CURRENTLY");
    expect(text).toContain("CURRENT SITUATION");
    expect(text).toContain("Historical dates");
    expect(text).toContain("HIDDEN RULE — NARRATOR ONLY");
  });
});
