import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runSemanticPostTurnEvaluation,
  runManualBrainUpdate,
  runMemoryCycle,
  runMemoryReconcile,
  runPlotAIBuilder,
  runRememberThis,
  runStoryCardAIBuilder,
} from "./semanticEngine";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { storyCardContextContent } from "../memory/storyCardPolicy";
import type { Adventure } from "../types/adventure";

// These dispatch tests isolate provider generation; validation has real-provider-mock integration coverage.
vi.mock("../memory/validateMemoryUpdate", () => ({
  validateMemoryUpdate: vi.fn(async (_a, _p, _s, _t, previous, content) => ({ changed: Boolean(content.trim()) && content !== previous && content !== "NONE" })),
}));

vi.mock("../providers/openAICompatible", () => ({
  isNativeDeepSeekProvider: vi.fn((config: { baseUrl: string }) => config.baseUrl.includes("deepseek.com")),
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));

import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
const mockProvider = vi.mocked(sendOpenAICompatibleChatCompletion);

const providerConfig = {
  name: "test",
  baseUrl: "https://api.example.com",
  apiKey: "sk-test",
  model: "test-model",
  temperature: 0.8,
  maxOutputTokens: 256,
};

function baseAdventure(): Adventure {
  return {
    ...createDefaultAdventure("Semantic Test"),
    memoryDetectionSettings: { enabled: false, everyNTurns: 1, generateContent: true },
    activeState: {
      ...createDefaultAdventure("Semantic Test").activeState,
      turn: 5,
    },
    semanticEvaluationSettings: {
      evaluationModel: "",
      messagesIncluded: 4,
      enabled: true,
      showLog: true,
      maxParallelUpdateCalls: 2,
      requireApprovalForAutoUpdates: false,
      semanticEvalEveryNTurns: 1,
    },
    messages: [
      { id: "m1", role: "user", content: "I enter the tavern.", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "m2", role: "assistant", content: "The barkeep nods.", createdAt: "2026-01-01T00:01:00.000Z" },
    ],
  };
}

beforeEach(() => {
  mockProvider.mockReset();
});

describe("runSemanticPostTurnEvaluation", () => {
  it("returns empty actions and a log entry when semantic evaluation is disabled", async () => {
    const adventure = { ...baseAdventure(), semanticEvaluationSettings: { ...baseAdventure().semanticEvaluationSettings, enabled: false } };
    const result = await runSemanticPostTurnEvaluation(adventure, providerConfig);
    expect(mockProvider).not.toHaveBeenCalled();
    expect(result.actions.some((a) => a.type === "LOG_EVALUATION_RESULT")).toBe(true);
    expect(result.logEntry.conditionsEvaluated).toHaveLength(0);
  });

  it("sends one condition-evaluation call and returns a log entry when no conditions fire", async () => {
    const adventure = {
      ...baseAdventure(),
      triggerRules: [
        makeTriggerRule({
          id: "rule-door",
          name: "Door trigger",
          enabled: true,
          evaluationMode: "semantic",
          condition: "when the player opens a door",
          actions: [{ type: "activateComponent" as const, componentId: "comp-1" }],
        }),
      ],
    };
    mockProvider.mockResolvedValueOnce({ content: "[]", raw: {} });
    const result = await runSemanticPostTurnEvaluation(adventure, providerConfig);

    expect(mockProvider).toHaveBeenCalledOnce();
    expect(result.actions.some((a) => a.type === "LOG_EVALUATION_RESULT")).toBe(true);
    expect(result.logEntry.conditionsFired).toHaveLength(0);
    expect(result.logEntry.errors).toHaveLength(0);
  });

  it("fires a matching semantic trigger rule and maps it to a reducer action", async () => {
    const adventure = {
      ...baseAdventure(),
      triggerRules: [
        makeTriggerRule({
          id: "rule-door",
          name: "Door trigger",
          enabled: true,
          evaluationMode: "semantic",
          condition: "when the player opens a door",
          actions: [{ type: "activateComponent" as const, componentId: "comp-1" }],
        }),
      ],
    };
    mockProvider.mockResolvedValueOnce({ content: '["trigger:rule-door"]', raw: {} });
    const result = await runSemanticPostTurnEvaluation(adventure, providerConfig);

    expect(result.logEntry.conditionsFired).toContain("trigger:rule-door");
    expect(result.actions.some((a) => a.type === "ACTIVATE_COMPONENT")).toBe(true);
    expect(result.actions.some((a) => a.type === "MARK_TRIGGER_FIRED")).toBe(true);
  });

  // Brain updates are handled inline during story generation (zero extra API calls), not via semantic evaluation.
  // See contextBuilder.ts: eligibleBrainsForCapture + buildThoughtCaptureInstruction.

  it("records a parse error in the log when the LLM returns invalid JSON for conditions", async () => {
    const adventure = {
      ...baseAdventure(),
      triggerRules: [makeTriggerRule({ name: "Rule", enabled: true, evaluationMode: "semantic", condition: "test" })],
    };
    mockProvider.mockResolvedValueOnce({ content: "not json at all", raw: {} });

    const result = await runSemanticPostTurnEvaluation(adventure, providerConfig);

    expect(result.logEntry.errors.length).toBeGreaterThan(0);
    expect(result.logEntry.conditionsFired).toHaveLength(0);
  });

  it("skips disabled and cooling-down semantic trigger rules", async () => {
    const disabledRule = makeTriggerRule({ id: "rule-disabled", name: "Disabled", enabled: false, evaluationMode: "semantic", condition: "test" });
    const coolingRule = makeTriggerRule({ id: "rule-cooling", name: "Cooling", enabled: true, evaluationMode: "semantic", condition: "test", cooldownTurns: 5, lastFiredTurn: 3 });
    const adventure = { ...baseAdventure(), triggerRules: [disabledRule, coolingRule] };

    mockProvider.mockResolvedValueOnce({ content: "[]", raw: {} });
    const result = await runSemanticPostTurnEvaluation(adventure, providerConfig);

    const evaluatedIds = result.logEntry.conditionsEvaluated.map((c) => c.id);
    expect(evaluatedIds).not.toContain("trigger:rule-disabled");
    expect(evaluatedIds).not.toContain("trigger:rule-cooling");
  });

  it("skips keyword and regex mode trigger rules — only semantic mode rules go to the LLM", async () => {
    const keywordRule = makeTriggerRule({ id: "rule-kw", name: "Keyword", enabled: true, evaluationMode: "keyword", condition: "door" });
    const regexRule = makeTriggerRule({ id: "rule-rx", name: "Regex", enabled: true, evaluationMode: "regex", condition: "door.*open" });
    const adventure = { ...baseAdventure(), triggerRules: [keywordRule, regexRule] };

    mockProvider.mockResolvedValueOnce({ content: "[]", raw: {} });
    const result = await runSemanticPostTurnEvaluation(adventure, providerConfig);

    const evaluatedIds = result.logEntry.conditionsEvaluated.map((c) => c.id);
    expect(evaluatedIds).not.toContain("trigger:rule-kw");
    expect(evaluatedIds).not.toContain("trigger:rule-rx");
  });

  it("applies story-card auto-updates and records a per-card cooldown turn", async () => {
    const card = makeStoryCard({
      id: "card-margo",
      title: "Margo",
      content: "Margo is protective.",
      keys: ["Margo"],
      active: true,
      autoUpdate: true,
      autoUpdateCooldownTurns: 0,
    });
    const adventure = {
      ...baseAdventure(),
      storyCards: [card],
      messages: [...baseAdventure().messages, { id: "m3", role: "user" as const, content: "Margo steps forward.", createdAt: "2026-01-01T00:02:00.000Z" }],

      tokenBudgetSettings: { ...baseAdventure().tokenBudgetSettings, autoSummarize: false },
    };

    mockProvider
      .mockResolvedValueOnce({ content: "[]", raw: {} })
      .mockResolvedValueOnce({ content: '["storyCard:card-margo"]', raw: {} })
      .mockResolvedValueOnce({ content: "Margo is protective and now worried about Seth.", raw: {} });

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(result.actions.some((action) => action.type === "ADD_MEMORY_PROPOSAL")).toBe(true);
    expect(result.actions).toContainEqual(expect.objectContaining({
      type: "MARK_STORY_CARD_UPDATED",
      storyCardId: "card-margo",
      turn: 5,
      proposalId: expect.any(String),
    }));
  });

  it("skips story-card auto-update conditions while the card is on cooldown", async () => {
    const card = makeStoryCard({
      id: "card-cooling",
      title: "Cooling Card",
      content: "Old.",
      keys: ["cooling"],
      autoUpdate: true,
      autoUpdateCooldownTurns: 5,
      lastAutoUpdateTurn: 3,
    });
    const adventure = {
      ...baseAdventure(),
      storyCards: [card],

      // deactivate PE components and disable summary so only story card conditions are relevant
      components: baseAdventure().components.map((c) =>
        c.type === "activePressure" ? { ...c, active: false } : c
      ),
      tokenBudgetSettings: { ...baseAdventure().tokenBudgetSettings, autoSummarize: false },
    };

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(mockProvider).not.toHaveBeenCalled();
    expect(result.logEntry.conditionsEvaluated.map((condition) => condition.id)).not.toContain("storyCard:card-cooling");
  });

  it("does not evaluate disabled Immediate Momentum components", async () => {
    const momentum = makeComponent({
      id: "component-momentum",
      title: "Immediate Momentum",
      type: "immediateMomentum",
      content: "The old next beat should not update.",
      active: true,
    });
    const adventure = {
      ...baseAdventure(),
      components: [momentum],
      storyCards: [],
      tokenBudgetSettings: { ...baseAdventure().tokenBudgetSettings, autoSummarize: false },
    };

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(mockProvider).not.toHaveBeenCalled();
    expect(result.logEntry.conditionsEvaluated.map((condition) => condition.id)).not.toContain("plotEssentialsMomentum:component-momentum");
  });

  it("routes story-card updates to Memory Inbox when auto-update approval is required", async () => {
    const card = makeStoryCard({
      id: "card-joke",
      title: "Hedge Prince Joke",
      content: "Old joke.",
      keys: ["hedge prince"],
      autoUpdate: true,
      autoUpdateCooldownTurns: 0,
    });
    const adventure = {
      ...baseAdventure(),
      storyCards: [card],
      messages: [...baseAdventure().messages, { id: "m3", role: "user" as const, content: "Margo repeats the hedge prince joke.", createdAt: "2026-01-01T00:02:00.000Z" }],

      semanticEvaluationSettings: { ...baseAdventure().semanticEvaluationSettings, requireApprovalForAutoUpdates: true },
    };

    mockProvider
      .mockResolvedValueOnce({ content: "[]", raw: {} })
      .mockResolvedValueOnce({ content: '["storyCard:card-joke"]', raw: {} })
      .mockResolvedValueOnce({ content: "Margo calls Seth hedge prince only when scared.", raw: {} });

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(result.actions.some((action) => action.type === "ADD_MEMORY_PROPOSAL")).toBe(true);
    expect(result.actions.some((action) => action.type === "APPLY_STORY_CARD_UPDATE")).toBe(false);
    expect(result.actions).toContainEqual(expect.objectContaining({
      type: "MARK_STORY_CARD_UPDATED",
      storyCardId: "card-joke",
      turn: 5,
      proposalId: expect.any(String),
    }));

    let reduced = result.actions.reduce((next, action) => adventureReducer(next, action), adventure);
    expect(reduced.storyCards[0].content).toBe("Old joke.");
    expect(reduced.storyCards[0].lastAutoUpdateTurn).toBe(5);
    const proposal = reduced.activeState.memoryProposals[0];
    expect(proposal).toMatchObject({ proposedType: "storyCard", status: "pending", targetId: "card-joke" });

    const withPendingProposal = reduced;
    const rejected = adventureReducer(reduced, { type: "REJECT_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(rejected.storyCards[0].content).toBe("Old joke.");
    expect(rejected.activeState.memoryProposals[0].status).toBe("rejected");
    reduced = adventureReducer(withPendingProposal, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(reduced.storyCards[0].content).toBe("Margo calls Seth hedge prince only when scared.");
  });

  it("routes Plot Essentials pressure updates to Memory Inbox", async () => {
    const component = makeComponent({
      id: "component-plot",
      title: "Active Pressure",
      type: "activePressure",
      content: "Old premise.",
      active: true,
    });
    const adventure = {
      ...baseAdventure(),
      components: [component],

    };

    mockProvider
      .mockResolvedValueOnce({ content: '["plotEssentialsPressure:component-plot"]', raw: {} })
      .mockResolvedValueOnce({ content: "The Fire Nation court now expects a public duel.", raw: {} });

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(result.actions.some((action) => action.type === "ADD_MEMORY_PROPOSAL")).toBe(true);
    expect(mockProvider.mock.calls[1][0].messages.map(m => m.content).join("\n")).toContain("Write exactly one short sentence");
    expect(result.actions.some((action) => action.type === "APPLY_COMPONENT_UPDATE")).toBe(false);

    // pressure auto-approves by default, so content is applied immediately
    const reduced = result.actions.reduce((next, action) => adventureReducer(next, action), adventure);
    const pressureComp = reduced.components.find((c) => c.type === "activePressure");
    expect(pressureComp?.content).toContain("The Fire Nation court now expects a public duel.");
  });

  it("updates Plot Essentials on drift instead of waiting for the component cooldown", async () => {
    const component = makeComponent({
      id: "component-pe",
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "The old PE says Seth is trapped in the Pumpworks.",
      active: true,
      autoUpdate: true,
      autoUpdateCooldownTurns: 60,
      lastAutoUpdateTurn: 4,
    });
    const adventure = {
      ...baseAdventure(),
      components: [component],
      storyCards: [],
    };

    mockProvider
      .mockResolvedValueOnce({ content: '["plotEssentialsDrift:component-pe"]', raw: {} })
      .mockResolvedValueOnce({ content: "- Seth has escaped the Pumpworks and is being hunted along the canal exits.", raw: {} });

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(result.logEntry.conditionsEvaluated.map((condition) => condition.id)).toContain("plotEssentialsDrift:component-pe");
    expect(result.actions).toContainEqual({ type: "MARK_COMPONENT_UPDATED", componentId: "component-pe", turn: 5 });
    const proposalAction = result.actions.find((action) => action.type === "ADD_MEMORY_PROPOSAL");
    expect(proposalAction).toMatchObject({
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        proposedType: "plotEssentialsUpdate",
        targetId: "component-pe",
        appendContent: false,
      },
    });
  });

  it("allows one plot, one Story Card, and one character update in the same memory cycle", async () => {
    const pressure = makeComponent({
      id: "component-pressure",
      title: "Active Pressure",
      type: "activePressure",
      content: "Old pressure.",
      active: true,
    });
    const card = makeStoryCard({
      id: "card-margo",
      title: "Margo",
      content: "Margo watches the gate.",
      keys: ["Margo"],
      active: true,
      autoUpdate: true,
      autoUpdateCooldownTurns: 0,
    });
    const brain = makeBrain({
      id: "brain-margo",
      characterName: "Margo",
      triggers: ["Margo"],
      active: true,
      updateMode: "append",
    });
    const adventure = {
      ...baseAdventure(),
      components: [pressure],
      storyCards: [card],
      brains: [brain],
      semanticEvaluationSettings: { ...baseAdventure().semanticEvaluationSettings, requireApprovalForAutoUpdates: true },
      messages: [
        ...baseAdventure().messages,
        { id: "m3", role: "assistant" as const, content: "Margo seals the breach and realizes the gate is still failing.", createdAt: "2026-01-01T00:02:00.000Z" },
      ],
    };

    mockProvider.mockImplementation(async (request) => {
      const system = request.messages.map(m => m.content).join("\n");
      const user = request.messages[1]?.content ?? "";
      if (system.includes("evaluation engine") && user.includes("plotEssentialsPressure:component-pressure")) {
        return { content: '["plotEssentialsPressure:component-pressure"]', raw: {} };
      }
      if (system.includes("SINGLE most story-relevant condition") && user.includes("storyCard:card-margo")) {
        return { content: '["storyCard:card-margo"]', raw: {} };
      }
      if (system.includes("SINGLE most story-relevant condition") && user.includes("brain:brain-margo")) {
        return { content: '["brain:brain-margo"]', raw: {} };
      }
      if (system.includes("updating the Active Pressure")) {
        return { content: "The breach is sealed, but the gate is still failing.", raw: {} };
      }
      if (system.includes("persistent world fact card titled 'Margo'")) {
        return { content: "• Margo now knows the gate can fail again without warning.", raw: {} };
      }
      if (system.includes("recording one new thought, reaction, or private plan for Margo")) {
        return { content: '{"thoughts":{"gate_failure":"5 → The seal held once. I need a second plan before it breaks in front of everyone."}}', raw: {} };
      }
      return { content: "[]", raw: {} };
    });

    const result = await runMemoryCycle(adventure, providerConfig);

    expect(result.logEntry.conditionsFired).toEqual([
      "plotEssentialsPressure:component-pressure",
      "storyCard:card-margo",
      "brain:brain-margo",
    ]);
    expect(result.actions.filter((action) => action.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(3);
    expect(result.actions).toContainEqual(expect.objectContaining({
      type: "MARK_STORY_CARD_UPDATED",
      storyCardId: "card-margo",
      turn: 5,
      proposalId: expect.any(String),
    }));

    const reduced = result.actions.reduce((next, action) => adventureReducer(next, action), adventure);
    expect(reduced.components.find((component) => component.id === "component-pressure")?.content).toBe("The breach is sealed, but the gate is still failing.");
    expect(reduced.activeState.memoryProposals.some((proposal) => proposal.proposedType === "storyCard" && proposal.targetId === "card-margo")).toBe(true);
    expect(reduced.activeState.memoryProposals.some((proposal) => proposal.proposedType === "brainUpdate" && proposal.targetId === "brain-margo")).toBe(true);
  });
});

describe("runManualBrainUpdate", () => {
  it("calls the brain update prompt and applies the patch", async () => {
    const brain = makeBrain({ id: "brain-seth", characterName: "Seth", active: true });
    const adventure = { ...baseAdventure(), brains: [brain] };
    mockProvider.mockResolvedValueOnce({ content: '{"currentState": "Seth is on edge."}', raw: {} });

    const result = await runManualBrainUpdate(adventure, providerConfig, "brain-seth");

    expect(mockProvider).toHaveBeenCalledOnce();
    expect(result.actions.some((a) => a.type === "APPLY_BRAIN_UPDATE")).toBe(true);
    expect(result.logEntry.conditionsFired).toContain("manualBrain:brain-seth");
  });

  it("does not let condensation rewrite a validated thought or introduce a different identity", async () => {
    const brain = makeBrain({ id: "edythe", characterName: "Edythe", active: true, condenseThreshold: 1, thoughts: {} });
    const adventure = { ...baseAdventure(), brains: [brain] };
    mockProvider.mockResolvedValueOnce({ content: '{"thoughts":{"farrow":"5 → Seth told me Farrow threatened him."}}', raw: {} })
      .mockResolvedValueOnce({ content: '{"thoughts":{"farrow":"I am Seth and I texted Farrow.","date":"I am dating Priya."},"currentState":"I am Seth."}', raw: {} });
    const result = await runManualBrainUpdate(adventure, providerConfig, "edythe");
    const state = result.actions.reduce(adventureReducer, adventure);
    expect(JSON.stringify(result.actions)).not.toContain("I am Seth");
    expect(JSON.stringify(result.actions)).not.toContain("I am dating Priya");
    expect(state.brains[0].characterName).toBe("Edythe");
  });

  it("logs an error when the brain ID does not exist", async () => {
    const result = await runManualBrainUpdate(baseAdventure(), providerConfig, "missing-brain");
    expect(mockProvider).not.toHaveBeenCalled();
    expect(result.logEntry.errors[0]).toMatch(/not found/i);
  });

  it("logs an error when the LLM returns no recognized brain fields", async () => {
    const brain = makeBrain({ id: "brain-seth", characterName: "Seth", active: true });
    const adventure = { ...baseAdventure(), brains: [brain] };
    mockProvider.mockResolvedValueOnce({ content: '{"unknownField": "something"}', raw: {} });

    const result = await runManualBrainUpdate(adventure, providerConfig, "brain-seth");
    expect(result.actions.some((a) => a.type === "APPLY_BRAIN_UPDATE")).toBe(false);
    expect(result.logEntry.errors[0]).toMatch(/no recognized keys/i);
  });

  it("accepts thoughts as a Record and ignores non-string values for other fields", async () => {
    const brain = makeBrain({ id: "brain-seth", characterName: "Seth", active: true });
    const adventure = { ...baseAdventure(), brains: [brain] };
    mockProvider.mockResolvedValueOnce({
      content:
        '{"relationshipPressure":"bound by command","thoughts":{"seth_watches_court":"5 → Watch the court. Do not flinch."}}',
      raw: {},
    });

    const result = await runManualBrainUpdate(adventure, providerConfig, "brain-seth");
    const action = result.actions.find((entry) => entry.type === "APPLY_BRAIN_UPDATE") as Extract<
      typeof result.actions[number],
      { type: "APPLY_BRAIN_UPDATE" }
    >;

    expect(action.patch.relationshipPressure).toBe("bound by command");
    expect(action.patch.thoughts).toEqual({ seth_watches_court: "5 → Watch the court. Do not flinch." });
    expect(result.logEntry.errors).toEqual([]);
  });
});

describe("runRememberThis", () => {
  it("turns a description into a pending Story Card proposal", async () => {
    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify({
        proposals: [{
          action: "create",
          title: "Margo",
          content: "• Margo hides fear behind dry teasing.",
          keys: ["Margo", "hedge prince"],
        }],
        rationale: "This is durable character memory.",
      }),
      raw: {},
    });

    const result = await runRememberThis(
      baseAdventure(),
      { ...providerConfig, baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
      "Margo is a ward engineer who uses dry teasing when afraid.",
    );

    expect(mockProvider).toHaveBeenCalledWith(expect.objectContaining({
      responseFormat: "json_object",
      thinking: "disabled",
    }));
    const proposalAction = result.actions.find((action) => action.type === "ADD_MEMORY_PROPOSAL");
    expect(proposalAction).toMatchObject({
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        proposedType: "storyCard",
        title: "Margo",
        status: "pending",
        suggestedTriggers: ["hedge prince"],
      },
    });
  });
});

describe("AI memory builders", () => {
  it("reconciles recent entries into deterministic target proposals with cleanup patches", async () => {
    const plot = makeComponent({
      id: "component-plot",
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "- Ambessa's coup is still the main political pressure.\n- Caitlyn's anger over Jinx is unresolved.",
      active: true,
    });
    const pressure = makeComponent({
      id: "component-pressure",
      title: "Active Pressure",
      type: "activePressure",
      content: "Ambessa's coup is pressing from outside the workshop.",
      active: true,
    });
    const ambessa = makeStoryCard({
      id: "card-ambessa",
      title: "Ambessa's Political Defeat",
      type: "plot",
      memoryMode: "living",
      content: "Ambessa remains an active coup threat and uses Jinx as leverage.",
      keys: ["Ambessa"],
      active: true,
      pinned: true,
      protected: true,
      compactKind: "coverStory",
      compactStatus: "active",
    });
    const adventure = {
      ...baseAdventure(),
      components: [plot, pressure],
      storyCards: [ambessa],
      memoryAutoApprove: {
        ...baseAdventure().memoryAutoApprove,
        plotEssentialsUpdate: true,
        plotPressureUpdate: true,
        storyCard: true,
      },
      messages: [
        ...baseAdventure().messages,
        {
          id: "m3",
          role: "user" as const,
          content: "[Out of Character: Ambessa is defeated and no longer an active pressure.]",
          createdAt: "2026-01-01T00:02:00.000Z",
        },
      ],
    };

    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify({
        updates: [
          {
            targetId: "component-plot",
            title: "Plot Essentials",
            content: "- Ambessa is defeated and being sent home.\n- Caitlyn's anger over Jinx remains a personal conflict.",
            rationale: "Plot Essentials should keep only the current operating truth.",
          },
          {
            targetId: "component-pressure",
            title: "Active Pressure",
            content: "Caitlyn's fury over Jinx collides with Viktor's death in the workshop.",
            rationale: "The active pressure has shifted away from Ambessa.",
          },
          {
            targetId: "card-ambessa",
            title: "Ambessa's Political Defeat",
            memoryMode: "historical",
            storyCardType: "plot",
            content: "Ambessa was politically and militarily defeated and is being sent home.",
            storyCardPatch: { pinned: true, protected: true, compactStatus: "active" },
            rationale: "Ambessa should remain history, not active pressure.",
          },
        ],
      }),
      raw: {},
    });

    const result = await runMemoryReconcile(adventure, providerConfig, {
      directive: "Ambessa is defeated and no longer an active pressure.",
      entryCount: 20,
      includeBrains: false,
    });

    expect(mockProvider).toHaveBeenCalledOnce();
    const proposals = result.actions.filter(
      (action): action is Extract<typeof result.actions[number], { type: "ADD_MEMORY_PROPOSAL" }> =>
        action.type === "ADD_MEMORY_PROPOSAL",
    );
    expect(proposals).toHaveLength(3);
    expect(proposals.map((action) => action.proposal.targetId)).toEqual([
      "component-plot",
      "component-pressure",
      "card-ambessa",
    ]);
    const ambessaProposal = proposals.find((action) => action.proposal.targetId === "card-ambessa")?.proposal;
    expect(ambessaProposal?.storyCardPatch).toMatchObject({
      pinned: false,
      protected: false,
      inclusionPolicy: "triggered",
      compactStatus: "resolved",
    });

    const reduced = result.actions.reduce((next, action) => adventureReducer(next, action), adventure);
    const updatedCard = reduced.storyCards.find((card) => card.id === "card-ambessa");
    expect(updatedCard).toMatchObject({
      pinned: false,
      protected: false,
      inclusionPolicy: "triggered",
      compactStatus: "resolved",
    });
    expect(updatedCard ? storyCardContextContent(updatedCard) : "").toContain("defeated");
    expect(reduced.components.find((component) => component.id === "component-pressure")?.content)
      .toContain("Caitlyn's fury");
  });

  it("reconciles from recent entries when no directive is provided", async () => {
    const plot = makeComponent({
      id: "component-plot",
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "- Ambessa is still maneuvering against the Council.",
      active: true,
    });
    const ambessa = makeStoryCard({
      id: "card-ambessa",
      title: "Ambessa",
      type: "plot",
      memoryMode: "living",
      content: "Ambessa is pressuring Piltover.",
      keys: ["Ambessa"],
      active: true,
    });
    const adventure = {
      ...baseAdventure(),
      components: [plot],
      storyCards: [ambessa],
      messages: [
        ...baseAdventure().messages,
        {
          id: "m3",
          role: "assistant" as const,
          content: "Ambessa is escorted to the docks under guard while the Council turns to Caitlyn's report.",
          createdAt: "2026-01-01T00:02:00.000Z",
        },
      ],
    };

    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify({
        updates: [
          {
            targetId: "component-plot",
            title: "Plot Essentials",
            content: "- Ambessa has been escorted to the docks under guard.\n- Caitlyn's report is now the current pressure.",
            rationale: "Recent entries changed the current plot state.",
          },
          {
            targetId: "card-ambessa",
            title: "Ambessa",
            content: "Ambessa was escorted to the docks under guard.",
            rationale: "The recent entry changes Ambessa's status.",
          },
        ],
      }),
      raw: {},
    });

    const result = await runMemoryReconcile(adventure, providerConfig, {
      entryCount: 20,
      includeBrains: false,
    });

    expect(mockProvider).toHaveBeenCalledOnce();
    expect(mockProvider.mock.calls[0][0].messages[1].content).toContain("(none supplied; infer updates from recent entries)");
    const proposals = result.actions.filter((action) => action.type === "ADD_MEMORY_PROPOSAL");
    expect(proposals).toHaveLength(2);
    expect(result.logEntry.errors).toEqual([]);
  });

  it("drafts a living auto-updating Story Card proposal from a guided request", async () => {
    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify({
        proposals: [{
          action: "create",
          title: "Seth and Margo Trust",
          storyCardType: "plot",
          memoryMode: "living",
          content: "• Seth and Margo use ward-room jokes as a private trust signal.",
          keys: ["ward-room jokes", "private trust signal"],
        }],
        rationale: "The brief describes an evolving relationship subject.",
      }),
      raw: {},
    });

    const result = await runStoryCardAIBuilder(
      baseAdventure(),
      providerConfig,
      {
        description: "Seth and Margo keep pretending their alliance is only practical.",
        intent: "relationship",
        memoryMode: "living",
        autoUpdate: true,
        autoUpdateCooldownTurns: 2,
      },
    );

    const proposalAction = result.actions.find((action) => action.type === "ADD_MEMORY_PROPOSAL");
    expect(proposalAction).toMatchObject({
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        proposedType: "storyCard",
        title: "Seth and Margo Trust",
        storyCardType: "plot",
        memoryMode: "living",
        autoUpdate: true,
        autoUpdateCooldownTurns: 2,
        suggestedTriggers: ["ward-room jokes", "private trust signal"],
      },
    });
  });

  it("grounds Story Card builder prompts on the requested recent message window", async () => {
    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify({
        proposals: [{
          action: "create",
          title: "Jinx's Hideout",
          storyCardType: "location",
          memoryMode: "static",
          content: "Jinx's hideout is a fan-choked workshop that smells of ozone and oil.",
          keys: ["Jinx's hideout", "fan-choked workshop"],
        }],
        rationale: "The recent messages describe a durable recurring location.",
      }),
      raw: {},
    });
    const adventure = {
      ...baseAdventure(),
      messages: [
        { id: "m1", role: "user" as const, content: "I enter the old market.", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "m2", role: "assistant" as const, content: "A merchant waves from a dry stall.", createdAt: "2026-01-01T00:01:00.000Z" },
        { id: "m3", role: "user" as const, content: "I follow Jinx through the fan-choked passage.", createdAt: "2026-01-01T00:02:00.000Z" },
        { id: "m4", role: "assistant" as const, content: "Jinx's hideout smells of ozone, paint, and hot oil.", createdAt: "2026-01-01T00:03:00.000Z" },
      ],
    };

    const result = await runStoryCardAIBuilder(
      adventure,
      providerConfig,
      {
        description: "Generate a location card for Jinx's hideout.",
        intent: "location",
        memoryMode: "static",
        recentMessageCount: 2,
        autoUpdate: false,
      },
    );

    const prompt = mockProvider.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain("Recent story messages (last 2):");
    expect(prompt).toContain("user: I follow Jinx through the fan-choked passage.");
    expect(prompt).toContain("assistant: Jinx's hideout smells of ozone, paint, and hot oil.");
    expect(prompt).not.toContain("I enter the old market.");
    expect(prompt).not.toContain("A merchant waves from a dry stall.");

    const proposalAction = result.actions.find((action) => action.type === "ADD_MEMORY_PROPOSAL");
    expect(proposalAction).toMatchObject({
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        title: "Jinx's Hideout",
        storyCardType: "location",
        memoryMode: "static",
        autoUpdate: false,
      },
    });
    if (proposalAction?.type !== "ADD_MEMORY_PROPOSAL") throw new Error("Expected story card proposal.");
    expect(proposalAction.proposal.sourceText).toContain("Recent messages included: 2");
    expect(proposalAction.proposal.sourceText).toContain("assistant: Jinx's hideout smells of ozone, paint, and hot oil.");
  });

  it("drafts a Plot Essentials proposal from a guided plot request", async () => {
    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify({
        proposal: {
          title: "Plot Essentials",
          content: "• The gala has become a hostage crisis.\n• The player's next move remains open.",
          appendContent: false,
          confidence: 0.86,
          rationale: "This is current operating truth.",
        },
      }),
      raw: {},
    });
    const plot = makeComponent({
      id: "component-plot",
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "• The gala is social cover.",
      active: true,
    });
    const adventure = { ...baseAdventure(), components: [plot] };

    const result = await runPlotAIBuilder(
      adventure,
      providerConfig,
      {
        description: "The gala has shifted into a hostage crisis.",
        target: "plotEssentials",
        targetComponentId: "component-plot",
        useRecentStory: true,
      },
    );

    const proposalAction = result.actions.find((action) => action.type === "ADD_MEMORY_PROPOSAL");
    expect(proposalAction).toMatchObject({
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        proposedType: "plotEssentialsUpdate",
        targetId: "component-plot",
        title: "Plot Essentials",
        appendContent: false,
      },
    });
  });
});


describe("grounded arc updates", () => {
  function scenario() {
    const a = baseAdventure();
    a.components = [
      makeComponent({ id: "cross-arc", title: "Cross Bid", type: "currentArc", arcPremise: "Julian investigates Cullen Holdings", content: "The bid is open.", arcBreakInstruction: "HIDDEN CLIMAX" }),
      makeComponent({ title: "Identity", type: "plotEssentials", content: "You are Seth Press. Julian Cross is a separate rival bidder." }),
      makeComponent({ title: "Psychic rules", type: "custom", alwaysOn: true, content: "Seth is immune; Edythe cannot read him." }),
    ];
    a.messages = [{ id: "deal", role: "assistant", content: "Edythe offers you revised terms, subject to board approval.", createdAt: "2026-01-01T00:00:00Z" }];
    return a;
  }
  it("grounds the request and keeps an arc claim pending with evidence", async () => {
    const a = scenario();
    mockProvider.mockResolvedValueOnce({ content: '["currentArc:cross-arc"]', raw: {} });
    mockProvider.mockResolvedValueOnce({ content: "Seth received revised terms; board approval remained outstanding.", raw: {} });
    const result = await runMemoryCycle(a, providerConfig);
    const text = mockProvider.mock.calls[1][0].messages.map(m => m.content).join("\n");
    expect(text).toContain("You are Seth Press");
    expect(text).toContain("Edythe cannot read him");
    expect(text).not.toContain("HIDDEN CLIMAX");
    const state = result.actions.reduce(adventureReducer, a);
    expect(state.components.find(c => c.id === "cross-arc")?.content).toBe("The bid is open.");
    const proposal = state.activeState.memoryProposals.find(p => p.proposedType === "currentArcUpdate");
    expect(proposal?.status).toBe("pending");
    expect(proposal?.sourceText).toContain("subject to board approval");
    const approved = adventureReducer(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal!.id });
    expect(approved.components.find(c => c.id === "cross-arc")?.content).toContain("board approval remained outstanding");
  });
  it("does not turn a no-development response into an arc entry", async () => {
    mockProvider.mockResolvedValueOnce({ content: '["currentArc:cross-arc"]', raw: {} });
    mockProvider.mockResolvedValueOnce({ content: "NONE", raw: {} });
    const result = await runMemoryCycle(scenario(), providerConfig);
    expect(result.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
  });
});


describe("memory discovery and component suggestions", () => {
  function discoveryAdventure() {
    const a = baseAdventure();
    a.memoryDetectionSettings.enabled = true;
    a.components = [];
    a.storyCards = [];
    a.brains = [];
    a.messages = [
      { id: "priya-intro", role: "assistant" as const, content: "Priya is a product manager in Capitol Hill. You match on a dating app.", createdAt: "2026-01-01T00:00:00Z" },
      { id: "priya-plan", role: "assistant" as const, content: "Priya sends her address for your agreed meeting at 9:30.", createdAt: "2026-01-01T00:01:00Z" },
      { id: "bar", role: "assistant" as const, content: "Rosa serves you a drink while you wait.", createdAt: "2026-01-01T00:02:00Z" },
    ];
    return a;
  }
  const priya = { title: "Priya", content: "Priya is a product manager in Capitol Hill.", storyCardType: "character", memoryMode: "static", suggestedTriggers: ["Priya"], rationale: "Named character with an ongoing interaction and an agreed meeting.", evidenceMessageIds: ["priya-intro", "priya-plan"] };

  it("discovers Priya without existing cards, Brains, conditions, or inline tags", async () => {
    const a = discoveryAdventure();
    a.memoryAutoApprove.storyCard = false;
    mockProvider.mockResolvedValueOnce({ content: JSON.stringify([priya]), usage: { promptTokens: 31, completionTokens: 12, totalTokens: 43 }, raw: {} });
    const result = await runMemoryCycle(a, providerConfig);
    const state = result.actions.reduce(adventureReducer, a);
    expect(state.activeState.memoryProposals).toContainEqual(expect.objectContaining({ title: "Priya", proposedType: "storyCard", storyCardType: "character", status: "pending", sourceText: expect.stringContaining("priya-plan") }));
    expect(state.brains).toHaveLength(0);
    expect(state.storyCards).toHaveLength(0);
    expect(state.activeState.lastMemoryCycleTurn).toBe(5);
    expect(result.tokenUsage).toEqual({ promptTokens: 31, completionTokens: 12 });
    expect(result.logEntry.conditionsEvaluated.some(c => c.id === "storyCardDiscovery")).toBe(true);
    const approved = adventureReducer(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: state.activeState.memoryProposals[0].id });
    expect(approved.storyCards).toContainEqual(expect.objectContaining({ title: "Priya", type: "character" }));
  });

  it("suppresses known, pending, duplicate, and unsupported candidates", async () => {
    const a = discoveryAdventure();
    a.storyCards = [makeStoryCard({ title: "Rosa", content: "Rosa is a bartender.", autoUpdate: false })];
    mockProvider.mockResolvedValue({ content: JSON.stringify([priya, priya, { ...priya, title: "Rosa" }, { ...priya, title: "Invented", evidenceMessageIds: ["missing"] }]), raw: {} });
    const first = await runMemoryCycle(a, providerConfig);
    expect(first.actions.filter(a => a.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(1);
    a.memoryAutoApprove.storyCard = false;
    const state = first.actions.reduce(adventureReducer, a);
    const second = await runMemoryCycle(state, providerConfig);
    expect(second.actions.filter(a => a.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(0);
  });

  it("honors disabled detection and optional blank proposal bodies", async () => {
    const a = discoveryAdventure();
    a.memoryDetectionSettings.enabled = false;
    await runMemoryCycle(a, providerConfig);
    expect(mockProvider).not.toHaveBeenCalled();
    a.memoryDetectionSettings.enabled = true;
    a.memoryDetectionSettings.generateContent = false;
    mockProvider.mockResolvedValueOnce({ content: JSON.stringify([priya]), raw: {} });
    const result = await runMemoryCycle(a, providerConfig);
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "ADD_MEMORY_PROPOSAL", proposal: expect.objectContaining({ title: "Priya", content: "" }) }));
  });

  it("logs discovery failures and still stamps the cycle and counts usage", async () => {
    mockProvider.mockResolvedValueOnce({ content: "not JSON", usage: { promptTokens: 9, completionTokens: 2, totalTokens: 11 }, raw: {} });
    const result = await runMemoryCycle(discoveryAdventure(), providerConfig);
    expect(result.logEntry.errors[0]).toContain("Story Card discovery failed");
    expect(result.actions).toContainEqual({ type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 5 });
    expect(result.tokenUsage).toEqual({ promptTokens: 9, completionTokens: 2 });
  });

  it("reviews legacy Plot Essentials with current content, but respects explicit opt-out", async () => {
    const a = discoveryAdventure();
    a.components = [makeComponent({ id: "pe", title: "Plot Essentials", type: "plotEssentials", content: "You have not met Priya." })];
    mockProvider.mockResolvedValueOnce({ content: '["plotEssentialsDrift:pe"]', raw: {} })
      .mockResolvedValueOnce({ content: "You are due to meet Priya at 9:30.", raw: {} })
      .mockResolvedValueOnce({ content: "[]", raw: {} });
    const result = await runMemoryCycle(a, providerConfig);
    expect(mockProvider.mock.calls[0][0].messages.at(-1)?.content).toContain("You have not met Priya.");
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "ADD_MEMORY_PROPOSAL", proposal: expect.objectContaining({ proposedType: "plotEssentialsUpdate", targetId: "pe" }) }));
    a.components[0].autoUpdate = false;
    mockProvider.mockResolvedValueOnce({ content: "[]", raw: {} });
    const optedOut = await runMemoryCycle(a, providerConfig);
    expect(optedOut.logEntry.conditionsEvaluated.some(c => c.id === "plotEssentialsDrift:pe")).toBe(false);
  });

  it("lets a later eligible card win instead of starving behind the first card", async () => {
    const a = baseAdventure();
    a.components = [];
    a.storyCards = ["first", "second"].map(id => makeStoryCard({ id, title: id, content: "Original fact.", keys: [], autoUpdate: true }));
    mockProvider.mockResolvedValueOnce({ content: '["storyCard:second"]', raw: {} })
      .mockResolvedValueOnce({ content: "A new durable fact.", raw: {} });
    const result = await runMemoryCycle(a, providerConfig);
    expect(result.logEntry.conditionsEvaluated.map(c => c.id)).toEqual(["storyCard:first", "storyCard:second"]);
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "ADD_MEMORY_PROPOSAL", proposal: expect.objectContaining({ targetId: "second" }) }));
  });
});
