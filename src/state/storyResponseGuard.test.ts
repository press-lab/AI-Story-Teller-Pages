import { describe, expect, it } from "vitest";
import {
  buildStoryResponseCorrectionMessages,
  evaluateStoryResponseGuard,
  hasPlayerAgencyViolation,
  visibleWordCount,
} from "./storyResponseGuard";

describe("storyResponseGuard", () => {
  it("counts visible words without hidden tags", () => {
    expect(visibleWordCount("One two <thought name=\"Mira\" key=\"x\">hidden words here</thought> three")).toBe(3);
  });

  it("flags long responses against the selected word limit", () => {
    const draft = Array.from({ length: 151 }, (_, i) => `word${i}`).join(" ");
    const result = evaluateStoryResponseGuard(draft, 150);

    expect(result.visibleWordCount).toBe(151);
    expect(result.visibleWordLimit).toBe(150);
    expect(result.overWordLimit).toBe(true);
    expect(result.needsCorrection).toBe(true);
  });

  it("flags unspoken player action scaffolding outside quoted dialogue", () => {
    const draft = `Viktor studies the map. "You don't know anything more?" you press. You nod once, accepting the grim equation.`;

    expect(hasPlayerAgencyViolation(draft)).toBe(true);
    expect(evaluateStoryResponseGuard(draft, 150).needsCorrection).toBe(true);
  });

  it("does not flag the player's quoted words as player action scaffolding", () => {
    expect(hasPlayerAgencyViolation(`"You look tired," Viktor says.`)).toBe(false);
  });

  it("does not flag an action the player already authored", () => {
    expect(hasPlayerAgencyViolation("You look at Viktor as the core pulses.", "You look at Viktor.")).toBe(false);
    expect(hasPlayerAgencyViolation("You look at Viktor. You nod once.", "You look at Viktor.")).toBe(true);
  });

  it("builds a correction prompt that prioritizes word limit and player agency", () => {
    const messages = buildStoryResponseCorrectionMessages({
      playerInput: "We can help Zaun now.",
      draft: "You nod once and pivot.",
      wordLimit: 150,
      reasons: ["response appears to narrate unspoken player action"],
    });

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Hard limit: 150 words maximum.");
    expect(messages[0].content).toContain("Do not narrate the player's unspoken actions");
    expect(messages[1].content).toContain("We can help Zaun now.");
  });
});
