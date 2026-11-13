import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADVENTURE_GENERATION_BEST_PRACTICES, AI_INSTRUCTIONS_BEST_PRACTICES, NARRATION_RULES_BEST_PRACTICES, PLOT_ESSENTIALS_BEST_PRACTICES } from "./authoringBestPractices";
import {
  AUTHORING_SECTIONS,
  AUTHORING_STANDARDS,
  AUTHORING_WORKFLOW_SECTIONS,
  CHATGPT_AUTHORING_INSTRUCTIONS,
  PLOT_ESSENTIALS_FOUNDATIONS_RULE,
} from "./authoringPolicy";

describe("written authoring guidance", () => {
  it("keeps scene control and scenario pacing aligned across authoring consumers", () => {
    const scene = AUTHORING_SECTIONS.find(section => section.id === "scene-control")!.text;
    const pacing = AUTHORING_SECTIONS.find(section => section.id === "participation-pacing")!.text;
    for (const text of [AUTHORING_STANDARDS, CHATGPT_AUTHORING_INSTRUCTIONS, ADVENTURE_GENERATION_BEST_PRACTICES]) {
      expect(text).toContain(scene);
      expect(text).toContain(pacing);
    }
    expect(NARRATION_RULES_BEST_PRACTICES).toContain(scene);
    expect(NARRATION_RULES_BEST_PRACTICES).not.toContain(pacing);
    expect(AI_INSTRUCTIONS_BEST_PRACTICES).toContain(pacing);
    expect(AI_INSTRUCTIONS_BEST_PRACTICES).not.toContain(scene);
    expect(NARRATION_RULES_BEST_PRACTICES).toContain("Strict, Minor Actions, or Cinematic Flow");
  });

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

  it("keeps creator decisions in the copied prompt without changing generator policy", () => {
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("AI Story Teller (AIST) — Scenario Authoring Instructions");
    for (const rule of [
      "Do not proceed with a new scenario until the creator answers this question",
      "A mystery premise alone does not authorize inventing its underlying answer.",
      "An explicit request to proceed without further questions authorizes reasonable defaults",
      "A central villain, mystery, or anticipated future event is not, by itself, a gameplay loop.",
      "For a narrowly scoped EDIT, do not require unrelated scenario-design decisions.",
      "confirm the creator’s intentions before establishing a replacement structure.",
    ]) expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain(rule);
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).not.toContain("Do not offer unsolicited choice menus");
    expect(AUTHORING_STANDARDS).not.toContain("IMPORTANT — CREATOR DECISIONS BEFORE AUTHORING");
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
