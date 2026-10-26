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
    expect(http.requests.length).toBe(name === "breakfast" ? 2 : options.potionsLore ? 3 : 1);
    const input = http.requests.reduce((sum, r) => sum + r.promptTokens, 0), output = http.requests.reduce((sum, r) => sum + r.completionTokens, 0);
    expect(result.tokenUsage).toEqual({ promptTokens: input, completionTokens: output });
    metrics.push({ fixture: options.invalid ? "invalid-array" : name === "potions" ? options.potionsLore ? "potions-lore" : "potions-negative" : name,
      requests: http.requests.length, estimatedInputTokens: input, estimatedOutputTokens: output });
    http.spy.mockRestore();
  }
  console.log("ASSESSMENT_OFFLINE_COST", JSON.stringify(metrics));
});

// Run this identical harness at the task baseline and the updated revision.
it("compares automatic Brain, manual Brain, existing Lore and unrequested-group HTTP counts", async () => {
  const { createDefaultAdventure, makeBrain, makeStoryCard } = await import("../state/defaults");
  const { mockAssessment, isAssessment } = await import("../test/memoryAssessment");
  const { mockPlacementVerdict } = await import("../test/memoryPlacement");
  const metrics = [];
  for (const scenario of ["automatic-three-turn-brain", "manual-brain", "existing-lore", "unrequested-brains"]) {
    let a = createDefaultAdventure(); a.components = []; a.storyCards = []; a.brains = [];
    a.messages = []; a.semanticEvaluationSettings.requireApprovalForAutoUpdates = true;
    a.memoryDetectionSettings.enabled = true; a.memoryDetectionSettings.everyNTurns = 1;
    if (scenario === "existing-lore") a.storyCards = [makeStoryCard({ id: "lore", title: "Ward research", type: "lore", keys: ["ward"], content: "The ward was sealed." })];
    else a.brains = [makeBrain({ id: "mira", characterName: "Mira", active: true })];
    let sourceId = "", repaired = "";
    const stages: string[] = [];
    const http = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const system = typeof body.system === "string" ? body.system : body.system.map((b: { text: string }) => b.text).join("\n");
      const messages = [{ role: "system" as const, content: system }, ...body.messages];
      let content: string;
      if (isAssessment(messages)) {
        stages.push("assessment");
        const decision = JSON.parse(mockAssessment(messages, [scenario === "existing-lore" ? "storyCard:lore" : "brain:mira"]));
        if (scenario === "existing-lore") decision.storyCards.targets[0].delta = "Mira opened the ward with the research key.";
        repaired = JSON.stringify(decision);
        if (scenario === "unrequested-brains") {
          decision.brains.targets = [{ id: "brain:mira", delta: "I trust the offered research access.", evidenceMessageIds: [sourceId] }];
          const clean = { ...decision, brains: { ...decision.brains, targets: [] } }; repaired = JSON.stringify(clean);
        }
        content = JSON.stringify(decision);
      } else if (system.includes("ASSESSMENT FORMAT REPAIR")) { stages.push("repair"); content = repaired; }
      else if (system.includes("MEMORY UPDATE VALIDATION")) {
        stages.push("validation"); const payload = JSON.parse(messages.at(-1)!.content);
        content = JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
          reason: "Mock evidence confirms the change", evidenceMessageIds: payload.latestTurnMessageIds, placement: mockPlacementVerdict(payload) });
      } else {
        stages.push("generation");
        content = scenario === "existing-lore" ? "Mira opened the ward with the research key."
          : JSON.stringify({ thoughts: { ["reaction_" + sourceId]: `I will inspect the research key after agreement ${sourceId}.` } });
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: content }], stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
    });
    for (let index = 1; index <= (scenario === "automatic-three-turn-brain" ? 3 : 1); index++) {
      sourceId = `source_${index}`;
      a.messages.push({ id: sourceId, role: "assistant", content: `Mira opens the ward and learns the research key ${index}.`, createdAt: "2026-10-25" });
      a.activeState.turn = index;
      const manual = scenario !== "automatic-three-turn-brain";
      a = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId, turn: index, manual });
      if (scenario === "unrequested-brains") a.messages.at(-1)!.memoryEvaluation!.completedGroups = ["brains"];
      const result = await runMemoryCycle(a, assessmentConfig, { sourceId, manual });
      a = result.actions.reduce(reduce, a);
      if (process.env.MEMORY_COUNT_BASELINE === "1" && scenario === "unrequested-brains") {
        expect(result.logEntry.errors[0]).toContain("memory_assessment_unrequested_group");
        expect(a.messages.at(-1)!.memoryEvaluation!.status).toBe("quarantined");
      } else {
        expect(result.logEntry.errors).toEqual([]);
        expect(a.messages.at(-1)!.memoryEvaluation!.status).toBe("complete");
      }
    }
    const counts = { scenario, assessment: stages.filter(s => s === "assessment").length,
      generation: stages.filter(s => s === "generation").length, validation: stages.filter(s => s === "validation").length,
      repair: stages.filter(s => s === "repair").length, total: stages.length };
    const baseline = process.env.MEMORY_COUNT_BASELINE === "1";
    const expected: Record<string, number[]> = baseline
      ? { "automatic-three-turn-brain": [3, 3, 3, 0, 9], "manual-brain": [1, 1, 1, 0, 3], "existing-lore": [1, 1, 1, 0, 3], "unrequested-brains": [1, 0, 0, 0, 1] }
      : { "automatic-three-turn-brain": [3, 1, 1, 0, 5], "manual-brain": [1, 1, 1, 0, 3], "existing-lore": [1, 0, 1, 0, 2], "unrequested-brains": [1, 0, 0, 0, 1] };
    expect([counts.assessment, counts.generation, counts.validation, counts.repair, counts.total]).toEqual(expected[scenario]);
    metrics.push(counts); http.mockRestore();
  }
  console.log("MEMORY_REQUEST_COMPARISON", JSON.stringify(metrics));
});
