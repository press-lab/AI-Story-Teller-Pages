import { afterEach, expect, it, vi } from "vitest";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { assessmentConfig, assessmentFixture, mockAssessmentHttp, type AssessmentCase } from "../test/hogwartsAssessment";

afterEach(() => vi.restoreAllMocks());
// Also run unchanged against the pre-fix main implementation to compare payloads.
it("measures identical offline responses and fixtures without claiming model quality or billed tokens", async () => {
  const metrics = [];
  for (const [name, options] of [
    ["breakfast", {}], ["charms", { covered: true }], ["routine", {}],
    ["potions", {}], ["potions", { potionsLore: true }], ["routine", { invalid: "[]" }],
  ] as Array<[AssessmentCase, { covered?: boolean; potionsLore?: boolean; invalid?: string }]>) {
    const a = assessmentFixture(name), http = mockAssessmentHttp(a, name, options);
    const sourceId = a.messages.at(-1)!.id;
    const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId, manual: true, turn: a.activeState.turn });
    const result = await runMemoryCycle(claimed, assessmentConfig, { sourceId, manual: true });
    expect(http.requests.length).toBe(name === "breakfast" || options.potionsLore ? 3 : 1);
    const input = http.requests.reduce((sum, r) => sum + r.promptTokens, 0), output = http.requests.reduce((sum, r) => sum + r.completionTokens, 0);
    expect(result.tokenUsage).toEqual({ promptTokens: input, completionTokens: output });
    metrics.push({ fixture: options.invalid ? "invalid-array" : name === "potions" ? options.potionsLore ? "potions-lore" : "potions-negative" : name,
      requests: http.requests.length, estimatedInputTokens: input, estimatedOutputTokens: output });
    http.spy.mockRestore();
  }
  console.log("ASSESSMENT_OFFLINE_COST", JSON.stringify(metrics));
});
