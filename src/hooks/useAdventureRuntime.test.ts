import { describe, expect, it } from "vitest";
import { applyResponseLengthHint, combineProviderUsage } from "./useAdventureRuntime";
import type { RuntimeProviderSettings } from "../pages/pageTypes";

const baseConfig: RuntimeProviderSettings = {
  name: "openai-compatible",
  baseUrl: "https://example.test",
  apiKey: "secret",
  model: "deepseek-chat",
  temperature: 0.7,
  maxOutputTokens: 2048,
};

describe("applyResponseLengthHint", () => {
  it("preserves the configured GLM reasoning budget independently of visible length", () => {
    for (const model of ["z-ai/glm-5.3-flash", "glm-5.3", "z-ai/glm-5.3-flash:free"]) {
      expect(applyResponseLengthHint({ ...baseConfig, model, maxOutputTokens: 24000 }, 250).maxOutputTokens).toBe(24000);
      expect(applyResponseLengthHint({ ...baseConfig, model, maxOutputTokens: 300 }, 250).maxOutputTokens).toBe(300);
    }
  });
  it("applies a tight length-derived cap below the provider maximum", () => {
    expect(applyResponseLengthHint(baseConfig, 150).maxOutputTokens).toBe(305);
  });

  it("adds an explicit reserve on top of the visible cap, still bounded by the provider maximum", () => {
    expect(applyResponseLengthHint(baseConfig, 150, 240).maxOutputTokens).toBe(545);
    expect(applyResponseLengthHint(baseConfig, 150, 999).maxOutputTokens).toBe(1304);
    expect(applyResponseLengthHint(baseConfig, 150, 9999).maxOutputTokens).toBe(2048);
    expect(applyResponseLengthHint({ ...baseConfig, maxOutputTokens: 500 }, 150, 1400).maxOutputTokens).toBe(500);
  });

  it("uses the same length cap when the provider has no usable cap", () => {
    const uncapped = { ...baseConfig, maxOutputTokens: 0 };
    expect(applyResponseLengthHint(uncapped, 150).maxOutputTokens).toBe(305);
  });

  it("keeps an intentionally lower provider cap", () => {
    expect(applyResponseLengthHint({ ...baseConfig, maxOutputTokens: 220 }, 150).maxOutputTokens).toBe(220);
  });

  it("clamps unsafe word targets before deriving the cap", () => {
    expect(applyResponseLengthHint(baseConfig, 999).maxOutputTokens).toBe(830);
    expect(applyResponseLengthHint(baseConfig, 10).maxOutputTokens).toBe(155);
  });
});

describe("combineProviderUsage", () => {
  it("adds first-draft and correction-pass usage for guarded story turns", () => {
    expect(combineProviderUsage(
      { promptTokens: 17_000, completionTokens: 650, totalTokens: 17_650, cacheReadTokens: 12_000 },
      { promptTokens: 900, completionTokens: 90, totalTokens: 990, cacheReadTokens: 0 },
    )).toEqual({
      promptTokens: 17_900,
      completionTokens: 740,
      totalTokens: 18_640,
      cacheReadTokens: 12_000,
    });
  });

  it("returns undefined when neither provider call reports usage", () => {
    expect(combineProviderUsage(undefined, undefined)).toBeUndefined();
  });
});
