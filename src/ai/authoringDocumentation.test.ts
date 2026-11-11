import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLOT_ESSENTIALS_BEST_PRACTICES } from "./authoringBestPractices";
import {
  AUTHORING_SECTIONS,
  AUTHORING_STANDARDS,
  AUTHORING_WORKFLOW_SECTIONS,
  CHATGPT_AUTHORING_INSTRUCTIONS,
  PLOT_ESSENTIALS_FOUNDATIONS_RULE,
} from "./authoringPolicy";

describe("written authoring guidance", () => {
  it("shares the natural recall rules between authoring surfaces", () => {
    const triggers = AUTHORING_SECTIONS.find(section => section.id === "authoring-triggers")!;
    for (const text of [AUTHORING_STANDARDS, CHATGPT_AUTHORING_INSTRUCTIONS]) {
      expect(text).toContain(triggers.text);
      for (const rule of [
        "Write Lore as a factual record of what happened.",
        "our first date",
        "same existing keys array",
        "maximum of eight",
        "Trigger Quality Test",
        "Record literal matches separately",
        PLOT_ESSENTIALS_FOUNDATIONS_RULE,
        "VOICE CONTRACT",
      ]) expect(text).toContain(rule);
    }
  });

  it("includes trigger-only audit guidance in the copied EDIT workflow", () => {
    const cleanup = AUTHORING_WORKFLOW_SECTIONS.find(section => section.id === "lore-cleanup")!;
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain(cleanup.text);
    expect(cleanup.text).toContain("Fix only the problem that exists.");
    expect(cleanup.text).toContain("Keep the Lore body intact for a trigger-only correction.");
    expect(cleanup.text).toContain("Apply the Trigger Quality Test.");
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("Auditing is part of EDIT");
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("Keep card ids, sourceTurnIds, createdAt");
  });

  it("documents both recall styles in the existing Story Card field", () => {
    const scenario = readFileSync(new URL("../../docs/building-a-scenario.md", import.meta.url), "utf8");
    const architecture = readFileSync(new URL("../../docs/story-card-architecture.md", import.meta.url), "utf8");
    expect(scenario).toContain("single comma-delimited trigger field");
    expect(scenario).toContain("Use the same field for");
    expect(scenario).toContain("Thanksgiving bonfire");
    expect(architecture).toContain("Both use the same existing `keys` array.");
    expect(architecture).toMatch(/introduce no new trigger types,\s+schema, or retrieval mechanism/);
  });
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
