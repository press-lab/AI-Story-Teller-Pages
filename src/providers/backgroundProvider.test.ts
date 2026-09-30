import { describe, expect, it } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { backgroundProviderConfigIssue, resolveBackgroundProviderConfig } from "./backgroundProvider";

describe("background provider fallback", () => {
  it("uses the story provider and reports invalid background URLs", () => {
    const adventure = createDefaultAdventure("Fallback");
    adventure.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "not a URL", model: "other-model" };
    const story = { ...defaultModelConfig, apiKey: "story-key" };
    expect(backgroundProviderConfigIssue(adventure)).toContain("invalid");
    expect(resolveBackgroundProviderConfig(adventure, story)).toMatchObject({ baseUrl: story.baseUrl, model: story.model, apiKey: story.apiKey });
  });
});
