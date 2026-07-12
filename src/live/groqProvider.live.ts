import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { buildContext } from "../contextBuilder/contextBuilder";
import { createDevelopmentAdventure } from "../dev/developmentAdventure";
import { runManualBrainUpdate, runRememberThis, runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule } from "../state/defaults";
import type { Adventure, ProviderConfig } from "../types/adventure";

function liveGroqConfig(): ProviderConfig {
  const env = loadEnv("test", ".", "");
  const apiKey = env.VITE_TEST_GROQ_API_KEY?.trim();
  const baseUrl = env.VITE_TEST_GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1";
  const model = env.VITE_TEST_GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
  if (!apiKey) {
    throw new Error("Missing VITE_TEST_GROQ_API_KEY in .env.test.local.");
  }
  return {
    name: "groq-live-test",
    baseUrl,
    apiKey,
    model,
    temperature: 0,
    maxOutputTokens: 256,
  };
}

function reduceAll(adventure: Adventure, actions: Parameters<typeof adventureReducer>[1][]): Adventure {
  return actions.reduce((next, action) => adventureReducer(next, action), adventure);
}

function baseAdventure(): Adventure {
  return {
    ...createDefaultAdventure("Live Groq Test"),
    components: [
      makeComponent({
        id: "component-live-target",
        title: "Live Target",
        type: "custom",
        content: "This starts inactive.",
        active: false,
      }),
    ],
    semanticEvaluationSettings: {
      evaluationModel: "",
      messagesIncluded: 8,
      enabled: true,
      showLog: true,
      maxParallelUpdateCalls: 2,
      requireApprovalForAutoUpdates: false,
      semanticEvalEveryNTurns: 1,
    },
    activeState: {
      ...createDefaultAdventure("Live Groq Test").activeState,
      turn: 1,
    },
  };
}

describe("live Groq provider integration", () => {
  it("calls the OpenAI-compatible chat completion endpoint and returns content", async () => {
    const response = await sendOpenAICompatibleChatCompletion({
      config: liveGroqConfig(),
      messages: [
        { role: "system", content: "Return exactly: LIVE_PROVIDER_OK" },
        { role: "user", content: "Provider live test. Reply with exactly LIVE_PROVIDER_OK." },
      ],
    });

    expect(response.content.trim()).toBe("LIVE_PROVIDER_OK");
  });

  it("runs semantic evaluation and applies only reducer actions", async () => {
    let adventure: Adventure = {
      ...baseAdventure(),
      triggerRules: [
        makeTriggerRule({
          id: "trigger-live-semantic",
          name: "Live semantic activation",
          enabled: true,
          evaluationMode: "semantic",
          condition: "when the story excerpt contains the exact phrase LIVE_SEMANTIC_FIRE",
          actions: [{ type: "activateComponent", componentId: "component-live-target" }],
        }),
      ],
      messages: [
        {
          id: "live-msg-1",
          role: "assistant" as const,
          content: "The test transcript now says LIVE_SEMANTIC_FIRE.",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const result = await runSemanticPostTurnEvaluation(adventure, liveGroqConfig());
    expect(result.logEntry.conditionsEvaluated.map((condition) => condition.id)).toContain("trigger:trigger-live-semantic");
    expect(result.logEntry.conditionsFired).toContain("trigger:trigger-live-semantic");
    expect(result.actions.some((action) => action.type === "ACTIVATE_COMPONENT")).toBe(true);

    adventure = reduceAll(adventure, result.actions);
    expect(adventure.components.find((component) => component.id === "component-live-target")?.active).toBe(true);
    expect(adventure.activeState.evaluationLog[0].conditionsFired).toContain("trigger:trigger-live-semantic");
  });

  it("runs a targeted live brain update against an existing BrainEntry", async () => {
    let adventure: Adventure = {
      ...baseAdventure(),
      brains: [
        makeBrain({
          id: "brain-live-margo",
          characterName: "Margo",
          currentState: "Margo is guarded.",
          updatePrompt:
            'Return ONLY valid JSON exactly like this: {"currentState":"Margo is openly worried about Seth after the live test scene."}',
        }),
      ],
      messages: [
        {
          id: "live-msg-brain",
          role: "assistant" as const,
          content: "Margo sees Seth step into danger and becomes openly worried.",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const result = await runManualBrainUpdate(adventure, liveGroqConfig(), "brain-live-margo");
    expect(result.logEntry.errors).toEqual([]);
    expect(result.actions.some((action) => action.type === "APPLY_BRAIN_UPDATE")).toBe(true);

    adventure = reduceAll(adventure, result.actions);
    expect(adventure.brains.find((brain) => brain.id === "brain-live-margo")?.currentState).toContain(
      "openly worried about Seth",
    );
  });

  it("runs live Remember This and creates reviewable Memory Inbox proposals", async () => {
    let adventure: Adventure = {
      ...baseAdventure(),
      storyCards: [
        makeStoryCard({
          id: "card-live-margo",
          title: "Margo",
          keys: ["Margo"],
          content: "Margo is protective of Seth.",
        }),
      ],
      brains: [makeBrain({ id: "brain-live-margo", characterName: "Margo" })],
    };

    const result = await runRememberThis(
      adventure,
      liveGroqConfig(),
      "Margo calls Seth hedge prince as a private joke.",
    );
    expect(result.logEntry.errors).toEqual([]);
    expect(result.actions.some((action) => action.type === "ADD_MEMORY_PROPOSAL")).toBe(true);

    adventure = reduceAll(adventure, result.actions);
    expect(adventure.activeState.memoryProposals.length).toBeGreaterThan(0);
    expect(adventure.activeState.memoryProposals[0].status).toBe("pending");
    expect(adventure.storyCards.some((card) => card.content.includes("hedge prince"))).toBe(false);
  });

  it("plays one live turn against the Fire Nation development scenario context", async () => {
    let adventure = createDevelopmentAdventure();
    const userInput =
      "Setu answers Azula with controlled heat: I intend to be the blade that chooses its target.";
    adventure = adventureReducer(adventure, {
      type: "ADD_MESSAGE",
      id: "live-dev-user",
      role: "user",
      content: userInput,
      createdAt: "2026-01-01T00:02:00.000Z",
    });

    const context = buildContext(adventure, { currentInput: userInput });
    const payloadText = context.messages.map((message) => message.content).join("\n");
    expect(payloadText).toContain("Opening Arc Plot Essentials");
    expect(payloadText).toContain("Setu Renzan");
    expect(payloadText).toContain("Princess Azula");
    expect(context.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id)).toContain(
      "dev-card-setu-renzan",
    );

    const response = await sendOpenAICompatibleChatCompletion({
      config: { ...liveGroqConfig(), maxOutputTokens: 220 },
      messages: context.messages,
    });

    expect(response.content.trim().length).toBeGreaterThan(40);
    adventure = adventureReducer(adventure, {
      type: "ADD_MESSAGE",
      id: "live-dev-assistant",
      role: "assistant",
      content: response.content,
      createdAt: "2026-01-01T00:03:00.000Z",
    });
    expect(adventure.messages.at(-1)?.content).toBe(response.content);
    console.info(`\nDEV_SCENARIO_RESPONSE:\n${response.content.trim()}\n`);
    expect(response.content).not.toMatch(/as an ai|i can'?t|context sections|system shell/i);
  });

  it("plays the Fire Nation development scenario through live PE, card, and brain updates", async () => {
    let adventure = {
      ...createDevelopmentAdventure(),
      semanticEvaluationSettings: {
        ...createDevelopmentAdventure().semanticEvaluationSettings,
        maxParallelUpdateCalls: 1,
        requireApprovalForAutoUpdates: false,
      },
    };
    const plotId = "dev-component-plot-essentials";
    const cardId = "dev-card-betrothal-pressure";
    const brainId = "dev-brain-nyx";
    const originalPlot = adventure.components.find((component) => component.id === plotId)?.content;
    const originalCard = adventure.storyCards.find((card) => card.id === cardId)?.content;
    const originalBrainDevelopments = adventure.brains.find((brain) => brain.id === brainId)?.recentDevelopments;

    adventure = {
      ...adventure,
      triggerRules: [
        ...adventure.triggerRules,
        makeTriggerRule({
          id: "live-dev-pe-update",
          name: "Live dev PE update",
          evaluationMode: "semantic",
          condition: "when the story excerpt contains the exact phrase LIVE_DEV_PE_UPDATE",
          actions: [{ type: "updateComponent", componentId: plotId }],
          updatePrompt:
            "Return ONLY this exact string: The mission briefing now includes an explicit royal order: Setu must publicly bind his authority to Azula's command before the court.",
        }),
        makeTriggerRule({
          id: "live-dev-card-update",
          name: "Live dev card update",
          evaluationMode: "semantic",
          condition: "when the story excerpt contains the exact phrase LIVE_DEV_CARD_UPDATE",
          actions: [{ type: "updateStoryCard", storyCardId: cardId }],
          updatePrompt:
            "Return ONLY this exact string: Court factions now treat Setu's public loyalty to Azula as potential betrothal leverage, while Nyx's reaction makes the rumor more dangerous.",
        }),
        makeTriggerRule({
          id: "live-dev-brain-update",
          name: "Live dev brain update",
          evaluationMode: "semantic",
          condition: "when the story excerpt contains the exact phrase LIVE_DEV_BRAIN_UPDATE",
          actions: [{ type: "appendBrain", brainId }],
          updatePrompt:
            'Return ONLY valid JSON exactly like this: {"recentDevelopments":"Nyx resents that Setu publicly answered Azula first, and her jealousy now has political stakes."}',
        }),
      ],
      messages: [
        ...adventure.messages,
        {
          id: "live-dev-forced-user",
          role: "user" as const,
          content:
            "Azula orders Setu to bind his authority to her command in front of the war room. LIVE_DEV_PE_UPDATE LIVE_DEV_CARD_UPDATE LIVE_DEV_BRAIN_UPDATE",
          createdAt: "2026-01-01T00:04:00.000Z",
        },
        {
          id: "live-dev-forced-assistant",
          role: "assistant" as const,
          content:
            "Setu accepts the order publicly. The court turns it into betrothal leverage before the ink is dry, and Nyx's smile hardens because he answered Azula first.",
          createdAt: "2026-01-01T00:05:00.000Z",
        },
      ],
    };

    const result = await runSemanticPostTurnEvaluation(adventure, liveGroqConfig());
    console.info(`\nDEV_SEMANTIC_FIRED:\n${JSON.stringify(result.logEntry.conditionsFired, null, 2)}\n`);
    console.info(`\nDEV_SEMANTIC_ACTIONS:\n${JSON.stringify(result.logEntry.actionsExecuted, null, 2)}\n`);
    console.info(`\nDEV_SEMANTIC_GENERATED:\n${JSON.stringify(result.logEntry.generatedContent, null, 2)}\n`);

    adventure = reduceAll(adventure, result.actions);

    expect(adventure.components.find((component) => component.id === plotId)?.content).not.toBe(originalPlot);
    expect(adventure.storyCards.find((card) => card.id === cardId)?.content).not.toBe(originalCard);
    expect(adventure.brains.find((brain) => brain.id === brainId)?.recentDevelopments).not.toBe(originalBrainDevelopments);
    expect(result.logEntry.errors).toEqual([]);
  });
});
