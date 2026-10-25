import { mockPlacementVerdict } from "../test/memoryPlacement";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runSemanticPostTurnEvaluation,
  runManualBrainUpdate,
  runMemoryReconcile,
  runPlotAIBuilder,
  runRememberThis,
  runStoryCardAIBuilder,
} from "./semanticEngine";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { storyCardContextContent } from "../memory/storyCardPolicy";
import type { Adventure } from "../types/adventure";

// These dispatch tests isolate provider generation; validation has real-provider-mock integration coverage.
vi.mock("../memory/validateMemoryUpdate", () => ({
  validateMemoryUpdate: vi.fn(async (a, _p, surface, title, previous, content, _accum, _append, _review, targetInfo) => ({
    changed: Boolean(content.trim()) && content !== previous && content !== "NONE", evidenceMessageIds: [a.messages.at(-1)?.id],
    placement: surface === "storyCard" ? mockPlacementVerdict({ title, proposed: content, targetInfo, latestTurnMessageIds: [a.messages.at(-1)?.id], recentEvidence: `[${a.messages.at(-1)?.id}] assistant: ${a.messages.at(-1)?.content}` }) : undefined })),
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
  it("defaults an event involving an existing Character to separate Lore when the model omits its type", async () => {
    const a = baseAdventure();
    a.storyCards = [makeStoryCard({ id: "margo", title: "Margo", type: "character", content: "Margo is a ward engineer." })];
    mockProvider.mockResolvedValueOnce({ content: JSON.stringify({ proposals: [{ action: "update", cardId: "margo", title: "Margo's promise",
      memoryMode: "historical", content: "Margo promised to return the ward plans.", keys: ["ward plans"] }], rationale: "A completed promise." }), raw: {} });
    const result = await runRememberThis(a, providerConfig, "Margo promised to return the ward plans.");
    const added = result.actions.find(action => action.type === "ADD_MEMORY_PROPOSAL");
    expect(added).toMatchObject({ proposal: { storyCardType: "character", targetId: "margo", appendContent: true } });
    expect(result.actions.reduce(adventureReducer, a).storyCards).toEqual(a.storyCards);
  });
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
        suggestedTriggers: ["Margo", "hedge prince"],
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
            storyCardType: "lore",
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
    expect(ambessaProposal?.storyCardPatch).toBeUndefined();

    let reduced = result.actions.reduce((next, action) => adventureReducer(next, action), adventure);
    expect(reduced.storyCards).toEqual(adventure.storyCards);
    reduced = adventureReducer(reduced, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: ambessaProposal!.id });
    const updatedCard = reduced.storyCards.find((card) => card.id === "card-ambessa");
    expect(updatedCard).toMatchObject({ pinned: adventure.storyCards[0].pinned,
      protected: adventure.storyCards[0].protected, inclusionPolicy: adventure.storyCards[0].inclusionPolicy });
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
          storyCardType: "lore",
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
        storyCardType: "lore",
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
