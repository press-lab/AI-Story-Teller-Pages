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

// This same offline harness runs against 9557e39 and the repaired implementation.
it("measures recovery and assessment retry request counts with mocked HTTP", async () => {
  const { createDefaultAdventure, makeBrain, normalizeAdventure } = await import("../state/defaults");
  const { mockAssessment, isAssessment } = await import("../test/memoryAssessment");
  const baseline = process.env.BRAIN_RECOVERY_BASELINE === "1";
  const metrics = [];
  for (const scenario of ["edited-source", "downstream-approval", "stale-frozen-cleanup", "valid-three-source-batch"]) {
    let a = createDefaultAdventure(); a.components = []; a.storyCards = []; a.messages = [];
    a.brains = [makeBrain({ id: "mira", characterName: "Mira", active: true })];
    a.memoryDetectionSettings.enabled = true; a.memoryDetectionSettings.everyNTurns = 1;
    a.semanticEvaluationSettings.requireApprovalForAutoUpdates = true;
    const stages: string[] = []; let failDiscovery = false, failValidation = false;
    const http = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const system = typeof body.system === "string" ? body.system : body.system.map((b: { text: string }) => b.text).join("\n");
      const messages = [{ role: "system" as const, content: system }, ...body.messages];
      let content: string;
      if (isAssessment(messages)) {
        stages.push("assessment"); content = mockAssessment(messages, ["brain:mira"], scenario === "downstream-approval");
      } else if (system.includes("MEMORY UPDATE VALIDATION")) {
        stages.push("validation"); if (failValidation) throw Error("Offline validation failure");
        const payload = JSON.parse(messages.at(-1)!.content);
        content = JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
          evidenceMessageIds: payload.latestTurnMessageIds, reason: "Mock supported private change" });
      } else if (system.includes("STORY CARD MEMORY CHECK")) {
        stages.push("discovery"); if (failDiscovery) throw Error("Offline discovery failure"); content = "[]";
      } else {
        stages.push("generation"); content = JSON.stringify({ thoughts: { reaction: "I will verify the key myself." } });
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: content }], stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
    });
    async function evaluate(id: string, manual = false) {
      a = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: id, manual, turn: a.activeState.turn });
      const result = await runMemoryCycle(a, assessmentConfig, { sourceId: id, manual });
      a = result.actions.reduce(reduce, a);
    }
    async function turn(id: string) {
      a.messages.push({ id, role: "assistant", content: `Mira learns the ward key ${id}.`, createdAt: "2026-10-26" });
      a.activeState.turn++; await evaluate(id);
    }
    if (scenario === "downstream-approval") a.activeState.memoryProposals.push({ id: "covered", proposedType: "storyCard", storyCardType: "lore",
      title: "Ward key", content: "Mira remembers an earlier ward key.", sourceTurnId: "one", sourceText: "Earlier key",
      suggestedTriggers: [], confidence: 1, rationale: "Earlier supported change", status: "pending", createdAt: "2026-10-26", updatedAt: "2026-10-26" });
    if (scenario === "valid-three-source-batch" || scenario === "stale-frozen-cleanup") {
      await turn("one"); await turn("two"); failValidation = scenario === "stale-frozen-cleanup"; await turn("three");
      if (scenario === "stale-frozen-cleanup") {
        a.messages[1].content = "Mira did not learn the second key."; stages.length = 0;
        a = normalizeAdventure(JSON.parse(JSON.stringify(a)));
        expect(a.activeState.pendingBrainDeltas?.map(d => d.sourceId)).toEqual(baseline ? ["one", "two"] : ["one", "three"]);
        if (!baseline) expect(a.messages[2].memoryEvaluation?.completedGroups).toContain("brains");
      }
    } else if (scenario === "edited-source") {
      await turn("one"); stages.length = 0;
      a = reduce(a, { type: "UPDATE_MESSAGE", messageId: "one", content: "Mira learns a different ward key." });
      await evaluate("one");
    } else {
      failDiscovery = true; await turn("one");
      expect(a.messages[0].memoryEvaluation?.status).toBe("failed");
      a.activeState.memoryProposals[0].status = "approved";
      failDiscovery = false; stages.length = 0; await evaluate("one", true);
    }
    const counts = { scenario, assessment: stages.filter(s => s === "assessment").length,
      brainGeneration: stages.filter(s => s === "generation").length, validation: stages.filter(s => s === "validation").length,
      discovery: stages.filter(s => s === "discovery").length };
    expect([counts.assessment, counts.brainGeneration]).toEqual(scenario === "valid-three-source-batch" ? [3, 1]
      : scenario === "edited-source" ? [1, 0] : scenario === "downstream-approval" && baseline ? [1, 0] : [0, 0]);
    metrics.push(counts); http.mockRestore();
  }
  console.log("BRAIN_RECOVERY_REQUEST_COUNTS", JSON.stringify({ baseline, metrics }));
});

it("compares identical three-source standalone and batched assessment HTTP usage", async () => {
  const { createDefaultAdventure, makeStoryCard, makeComponent, normalizeAdventure } = await import("../state/defaults");
  const { assessMemoryBatch } = await import("./memoryAssessment");
  const { mockAssessment } = await import("../test/memoryAssessment");
  const { mockPlacementVerdict } = await import("../test/memoryPlacement");
  const { approximateTokenCount } = await import("../tokenizer/approximateTokenCount");
  const metrics = [];
  for (const scenario of ["three-durable-events", "three-no-change", "two-idle", "one-manual", "one-invalid-record"]) {
    const base = createDefaultAdventure(); base.components = [makeComponent({ type: "custom", title: "Research canon", alwaysOn: true,
      content: "Research records are public agreements; private interpretations remain with each character. ".repeat(20) })];
    base.brains = []; base.storyCards = [makeStoryCard({ id: "research", type: "lore", title: "Research agreements", keys: ["research"],
      content: "The research room contains an agreed notebook archive. ".repeat(20) })];
    base.messages = ["Hermione accepted the research dinner invitation.", "Draconia signed a separate research notebook sharing agreement.",
      "Hermione attempted a kiss during research, but stepped back before contact."].map((content, i) => ({ id: `cost-${i}`, role: "assistant" as const,
        content, createdAt: "2026-10-26", memoryEvaluation: { turn: i + 1, attempts: 0, completedGroups: [], status: "pending" as const } }));
    base.memoryDetectionSettings.enabled = true; base.memoryDetectionSettings.everyNTurns = 1;
    base.semanticEvaluationSettings.requireApprovalForAutoUpdates = true;
    base.memoryAutoApprove.storyCard = false;
    const count = scenario === "two-idle" ? 2 : scenario === "one-manual" ? 1 : 3;
    base.messages = base.messages.slice(0, count);
    const measurements = [];
    for (const batched of [false, true]) {
      let a = normalizeAdventure(structuredClone(base));
      const requests: Array<{ stage: string; input: number; output: number }> = [];
      let malformed = "";
      const http = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const system = typeof body.system === "string" ? body.system : body.system.map((b: { text: string }) => b.text).join("\n");
        const messages = [{ role: "system" as const, content: system }, ...body.messages];
        let content: string, stage: string;
        if (system.includes("SHARED MEMORY ASSESSMENT")) {
          stage = "assessment";
          const decision = JSON.parse(mockAssessment(messages, scenario === "three-no-change" ? [] : ["storyCard:research"]));
          for (const record of decision.sources ?? [{ ...decision, sourceId: JSON.parse(messages.at(-1)!.content).sourceId }]) {
            for (const t of record.storyCards.targets) t.delta = base.messages.find(m => m.id === record.sourceId)!.content;
            if (!decision.sources) decision.storyCards = record.storyCards;
          }
          if (decision.sources && scenario === "one-invalid-record") delete decision.sources[1].brains;
          content = JSON.stringify(decision); if (decision.sources) malformed = content;
        } else if (system.includes("ASSESSMENT BATCH FORMAT REPAIR")) { stage = "repair"; content = malformed; }
        else if (system.includes("MEMORY UPDATE VALIDATION")) {
          stage = "validation"; const p = JSON.parse(messages.at(-1)!.content);
          content = JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
            reason: "Offline supported event", evidenceMessageIds: p.latestTurnMessageIds, placement: mockPlacementVerdict(p) });
        } else throw Error("Unexpected downstream generation; existing Lore delta should be reused");
        const input = approximateTokenCount(JSON.stringify({ system: body.system, messages: body.messages }));
        const output = approximateTokenCount(content); requests.push({ stage, input, output });
        return new Response(JSON.stringify({ content: [{ type: "text", text: content }], stop_reason: "end_turn",
          usage: { input_tokens: input, output_tokens: output } }), { status: 200 });
      });
      const ids = a.messages.map(m => m.id);
      let batchUsage = { promptTokens: 0, completionTokens: 0 };
      if (batched && scenario !== "one-manual") {
        const batch = await assessMemoryBatch(a, assessmentConfig, ids); batchUsage = batch;
        a = reduce(a, { type: "STORE_MEMORY_ASSESSMENT_BATCH", sources: batch.sources });
      }
      let totalInput = batchUsage.promptTokens, totalOutput = batchUsage.completionTokens;
      for (const id of ids) {
        a = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId: id, turn: 3, manual: scenario === "one-manual" });
        const result = await runMemoryCycle(a, assessmentConfig, { sourceId: id, manual: scenario === "one-manual" });
        totalInput += result.tokenUsage!.promptTokens; totalOutput += result.tokenUsage!.completionTokens;
        a = result.actions.reduce(reduce, a);
      }
      expect(a.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true);
      expect(totalInput).toBe(requests.reduce((sum, r) => sum + r.input, 0));
      expect(totalOutput).toBe(requests.reduce((sum, r) => sum + r.output, 0));
      const assessments = requests.filter(r => r.stage === "assessment");
      measurements.push({ mode: batched ? "batch" : "standalone", assessmentHttp: assessments.length,
        repairHttp: requests.filter(r => r.stage === "repair").length, downstreamHttp: requests.filter(r => r.stage === "validation").length,
        assessmentInput: assessments.reduce((sum, r) => sum + r.input, 0), assessmentOutput: assessments.reduce((sum, r) => sum + r.output, 0),
        totalInput, totalOutput, suggestions: a.activeState.memoryProposals.map(p => ({ source: p.sourceTurnId, type: p.proposedType, content: p.content })) });
      http.mockRestore();
    }
    const [before, after] = measurements;
    expect(after.assessmentHttp).toBe(scenario === "one-invalid-record" ? 2 : 1);
    expect(after.repairHttp).toBe(scenario === "one-invalid-record" ? 1 : 0);
    expect(after.downstreamHttp).toBe(before.downstreamHttp);
    expect(after.suggestions).toEqual(before.suggestions);
    if (count === 3 && scenario !== "one-invalid-record") expect(after.assessmentInput).toBeLessThan(before.assessmentInput);
    // Explicit synthetic rates used identically on both sides; these are not provider pricing or billed savings.
    const syntheticRates = { inputPerMillion: 1, outputPerMillion: 2 };
    metrics.push({ scenario, before, after, inputDifference: after.assessmentInput - before.assessmentInput,
      outputDifference: after.assessmentOutput - before.assessmentOutput,
      totalTokenDifference: after.totalInput + after.totalOutput - before.totalInput - before.totalOutput,
      syntheticRates, mockedCostDifference: ((after.totalInput - before.totalInput) + 2 * (after.totalOutput - before.totalOutput)) / 1_000_000 });
  }
  console.log("ASSESSMENT_BATCH_COMPARISON", JSON.stringify(metrics));
});
