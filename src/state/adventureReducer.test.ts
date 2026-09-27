import { describe, expect, it } from "vitest";
import type { Adventure, AdventureAction, RawImportEntry, TriggerLogEntry } from "../types/adventure";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule } from "./defaults";
import { adventureReducer } from "./adventureReducer";
import { makeMemoryProposal } from "../test/goldenAdventure";

const testedActionTypes = [
  "SET_TITLE",
  "SET_OPENING_SCENE",
  "UPDATE_METADATA",
  "ADD_MESSAGE",
  "UPDATE_MESSAGE",
  "DELETE_MESSAGE",
  "DELETE_LAST_MESSAGE",
  "REMOVE_LAST_ASSISTANT_MESSAGE",
  "UNDO_STORY_EDIT",
  "REDO_STORY_EDIT",
  "INCREMENT_TURN",
  "UPSERT_COMPONENT",
  "DELETE_COMPONENT",
  "ACTIVATE_COMPONENT",
  "DEACTIVATE_COMPONENT",
  "PIN_COMPONENT",
  "UNPIN_COMPONENT",
  "UPDATE_COMPONENT",
  "APPLY_COMPONENT_UPDATE",
  "REORDER_COMPONENT",
  "UPSERT_STORY_CARD",
  "DELETE_STORY_CARD",
  "ACTIVATE_STORY_CARD",
  "DEACTIVATE_STORY_CARD",
  "PIN_STORY_CARD",
  "UNPIN_STORY_CARD",
  "UPDATE_STORY_CARD",
  "APPLY_STORY_CARD_UPDATE",
  "MARK_STORY_CARD_UPDATED",
  "REORDER_STORY_CARD",
  "UPSERT_BRAIN",
  "DELETE_BRAIN",
  "ACTIVATE_BRAIN",
  "DEACTIVATE_BRAIN",
  "PIN_BRAIN",
  "UNPIN_BRAIN",
  "UPDATE_BRAIN",
  "APPEND_BRAIN_STATE",
  "REPLACE_BRAIN_STATE",
  "APPLY_BRAIN_UPDATE",
  "UPSERT_TRIGGER_RULE",
  "DELETE_TRIGGER_RULE",
  "UPDATE_TRIGGER_RULE",
  "MARK_TRIGGER_FIRED",
  "LOG_TRIGGER_FIRE",
  "LOG_EVALUATION_RESULT",
  "FORCE_INCLUDE_NEXT_TURN",
  "ADD_RAW_IMPORT",
  "UPDATE_RAW_IMPORT",
  "DELETE_RAW_IMPORT",
  "ADD_MEMORY_PROPOSAL",
  "UPDATE_MEMORY_PROPOSAL",
  "APPROVE_MEMORY_PROPOSAL",
  "REJECT_MEMORY_PROPOSAL",
  "IGNORE_MEMORY_PROPOSAL",
  "UPDATE_ROLLING_SUMMARY",
  "UPDATE_SCENE_STATE",
  "SET_TOKEN_BUDGET_SETTINGS",
  "SET_SYSTEM_TRIGGER_SETTINGS",
  "SET_MODEL_CONFIG",
  "SET_SEMANTIC_EVALUATION_SETTINGS",
  "SET_MEMORY_AUTO_APPROVE",
  "SET_MEMORY_DETECTION_SETTINGS",
  "SET_STATE_FLAG",
  "SET_RESPONSE_LENGTH_HINT",
  "SET_NEXT_TURN_NOTE",
  "CLEAR_NEXT_TURN_NOTE",
  "CONSUME_NEXT_TURN_NOTE",
  "QUEUE_PENDING_UPDATE",
  "FLUSH_PENDING_UPDATES",
  "SET_CHALLENGE_MODE",
  "SET_LAST_MEMORY_CYCLE_TURN",
  "SET_LAST_SEMANTIC_EVAL_TURN",
  "SET_LAST_SCENE_STATE_TURN",
  "RESET_RUNTIME_STATE",
  "ACCUMULATE_BACKGROUND_TOKENS",
  "SET_AUTO_SAVE_SETTINGS",
  "MARK_COMPONENT_UPDATED",
  "ADVANCE_ARC_PACING",
  "SET_ARC_PHASE",
  "SET_ARC_CONTINUATIONS",
  "COMPLETE_ARC_TO_STORY_CARD",
  "APPLY_ARC_CONTINUATION",
] as const satisfies AdventureAction["type"][];

type MissingActionCoverage = Exclude<AdventureAction["type"], (typeof testedActionTypes)[number]>;
type ExtraActionCoverage = Exclude<(typeof testedActionTypes)[number], AdventureAction["type"]>;
const assertAllActionsCovered: MissingActionCoverage extends never ? true : never = true;
const assertNoExtraActions: ExtraActionCoverage extends never ? true : never = true;

function baseAdventure(): Adventure {
  const componentA = makeComponent({ title: "Component A", content: "A", priority: 10, active: false });
  const componentB = makeComponent({ title: "Component B", content: "B", priority: 20 });
  const storyA = makeStoryCard({ title: "Story A", content: "A", priority: 10, active: false });
  const storyB = makeStoryCard({ title: "Story B", content: "B", priority: 20 });
  const brain = makeBrain({ characterName: "Mira", active: false, currentState: "old" });
  const triggerRule = makeTriggerRule({ name: "Rule A" });
  return {
    ...createDefaultAdventure("Reducer Test"),
    components: [componentA, componentB],
    storyCards: [storyA, storyB],
    brains: [brain],
    triggerRules: [triggerRule],
    messages: [
      { id: "msg-user", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "msg-assistant", role: "assistant", content: "hi", createdAt: "2026-01-01T00:01:00.000Z" },
    ],
    activeState: {
      turn: 3,
      forceIncludeNextTurn: [],
      triggerLog: [],
      evaluationLog: [],
      memoryProposals: [],
      pendingUpdates: [],
      storyUndoStack: [],
      storyRedoStack: [],
      nextTurnNote: {
        content: "",
        active: true,
        pinned: true,
        protected: false,
        priority: 85,
        expiresAfterUse: true,
      },
      rawImports: [],
      stateFlags: {},
      responseLengthHint: 150,
      backgroundTokenUsage: { promptTokens: 0, completionTokens: 0 },
      challengeMode: false,
    },
    rollingSummary: { content: "summary", updatedAt: "2026-01-01T00:00:00.000Z" },
  };
}

function reduce(state: Adventure, action: AdventureAction): Adventure {
  return adventureReducer(state, action);
}

describe("adventureReducer", () => {
  it("keeps the action coverage list exhaustive at compile time", () => {
    expect(assertAllActionsCovered).toBe(true);
    expect(assertNoExtraActions).toBe(true);
    expect(new Set(testedActionTypes).size).toBe(testedActionTypes.length);
  });

  it("handles title, metadata, messages, turn, settings, provider, flags, summary, and runtime reset actions", () => {
    let state = baseAdventure();
    state = reduce(state, { type: "SET_TITLE", title: "New Title" });
    expect(state.title).toBe("New Title");

    state = reduce(state, { type: "SET_OPENING_SCENE", content: "The storm broke at midnight." });
    expect(state.openingScene).toBe("The storm broke at midnight.");

    state = reduce(state, { type: "UPDATE_METADATA", metadata: { rating: "teen" } });
    expect(state.metadata.rating).toBe("teen");

    state = reduce(state, { type: "ADD_MESSAGE", id: "msg-new", role: "user", content: "new", createdAt: "2026-01-01T00:02:00.000Z" });
    expect(state.messages.at(-1)).toMatchObject({ id: "msg-new", role: "user", content: "new" });

    state = reduce(state, { type: "UPDATE_MESSAGE", messageId: "msg-new", content: "edited" });
    expect(state.messages.find((message) => message.id === "msg-new")?.content).toBe("edited");
    expect(state.activeState.storyUndoStack[0].label).toBe("Edit story section");

    state = reduce(state, { type: "DELETE_MESSAGE", messageId: "msg-new" });
    expect(state.messages.some((message) => message.id === "msg-new")).toBe(false);

    state = reduce(state, { type: "DELETE_LAST_MESSAGE" });
    expect(state.messages.at(-1)?.id).toBe("msg-user");

    state = reduce(state, { type: "REMOVE_LAST_ASSISTANT_MESSAGE" });
    expect(state.messages.some((message) => message.id === "msg-assistant")).toBe(false);

    state = reduce(state, { type: "FORCE_INCLUDE_NEXT_TURN", targetType: "storyCard", targetId: state.storyCards[0].id });
    expect(state.activeState.forceIncludeNextTurn).toHaveLength(1);

    state = reduce(state, { type: "SET_CHALLENGE_MODE" });
    expect(state.activeState.challengeMode).toBe(true);

    state = reduce(state, { type: "INCREMENT_TURN" });
    expect(state.activeState.turn).toBe(4);
    expect(state.activeState.forceIncludeNextTurn).toHaveLength(0);
    expect(state.activeState.challengeMode).toBe(false);

    state = reduce(state, { type: "UPDATE_ROLLING_SUMMARY", content: "new summary" });
    expect(state.rollingSummary.content).toBe("new summary");

    state = reduce(state, {
      type: "SET_TOKEN_BUDGET_SETTINGS",
      settings: {
        ...state.tokenBudgetSettings,
        maxContextTokens: 1234,
        maxRecentMessages: 2,
        recentMessageWindow: 1,
        sectionBudgets: { recentMessages: 99 },
      },
    });
    expect(state.tokenBudgetSettings.maxContextTokens).toBe(1234);

    state = reduce(state, {
      type: "SET_MODEL_CONFIG",
      config: { name: "openai-compatible", baseUrl: "https://example.test", apiKey: "secret", model: "model-a", temperature: 0.4, maxOutputTokens: 333 },
    });
    expect(state.modelConfig).toEqual({
      name: "openai-compatible",
      baseUrl: "https://example.test",
      model: "model-a",
      temperature: 0.4,
      maxOutputTokens: 333,
    });

    state = reduce(state, { type: "SET_STATE_FLAG", key: "doorOpen", value: true });
    expect(state.activeState.stateFlags.doorOpen).toBe(true);

    state = reduce(state, {
      type: "SET_SEMANTIC_EVALUATION_SETTINGS",
      settings: { evaluationModel: "eval-model", messagesIncluded: 6, enabled: false, showLog: false, maxParallelUpdateCalls: 2, requireApprovalForAutoUpdates: false, semanticEvalEveryNTurns: 1 },
    });
    expect(state.semanticEvaluationSettings.evaluationModel).toBe("eval-model");

    state = reduce(state, {
      type: "SET_NEXT_TURN_NOTE",
      note: {
        content: "Keep the next output focused on the oath.",
        pinned: false,
        protected: true,
        priority: 99,
        expiresAfterUse: true,
      },
    });
    expect(state.activeState.nextTurnNote).toMatchObject({
      content: "Keep the next output focused on the oath.",
      pinned: false,
      protected: true,
      priority: 99,
      expiresAfterUse: true,
    });

    state = reduce(state, { type: "CONSUME_NEXT_TURN_NOTE" });
    expect(state.activeState.nextTurnNote.content).toBe("");
    expect(state.activeState.nextTurnNote.protected).toBe(true);

    state = reduce(state, { type: "SET_NEXT_TURN_NOTE", note: { content: "Persistent note", expiresAfterUse: false } });
    state = reduce(state, { type: "CONSUME_NEXT_TURN_NOTE" });
    expect(state.activeState.nextTurnNote.content).toBe("Persistent note");

    state = reduce(state, { type: "CLEAR_NEXT_TURN_NOTE" });
    expect(state.activeState.nextTurnNote).toMatchObject({
      content: "",
      active: true,
      pinned: true,
      protected: false,
      priority: 85,
      expiresAfterUse: true,
    });

    state = reduce(state, {
      type: "QUEUE_PENDING_UPDATE",
      update: {
        id: "pending-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "semanticEvaluation",
        actions: [{ type: "SET_TITLE", title: "Queued Title" }],
      },
    });
    expect(state.activeState.pendingUpdates).toHaveLength(1);
    state = reduce(state, { type: "FLUSH_PENDING_UPDATES" });
    expect(state.title).toBe("Queued Title");
    expect(state.activeState.pendingUpdates).toHaveLength(0);

    state = reduce(state, { type: "RESET_RUNTIME_STATE" });
    expect(state.messages).toEqual([]);
    expect(state.rollingSummary.content).toBe("");
    expect(state.activeState.turn).toBe(0);
    expect(state.activeState.nextTurnNote.content).toBe("");
    expect(state.triggerRules[0].lastFiredTurn).toBeUndefined();
  });

  it("handles every component action", () => {
    let state = baseAdventure();
    const component = makeComponent({ title: "Component C", content: "C", priority: 30 });
    state = reduce(state, { type: "UPSERT_COMPONENT", component });
    expect(state.components.find((entry) => entry.id === component.id)?.title).toBe("Component C");

    state = reduce(state, { type: "DEACTIVATE_COMPONENT", componentId: component.id });
    expect(state.components.find((entry) => entry.id === component.id)?.active).toBe(false);
    state = reduce(state, { type: "ACTIVATE_COMPONENT", componentId: component.id });
    expect(state.components.find((entry) => entry.id === component.id)?.active).toBe(true);
    state = reduce(state, { type: "PIN_COMPONENT", componentId: component.id });
    expect(state.components.find((entry) => entry.id === component.id)?.pinned).toBe(true);
    state = reduce(state, { type: "UNPIN_COMPONENT", componentId: component.id });
    expect(state.components.find((entry) => entry.id === component.id)?.pinned).toBe(false);
    state = reduce(state, { type: "UPDATE_COMPONENT", componentId: component.id, patch: { title: "Renamed", priority: 5 } });
    expect(state.components.find((entry) => entry.id === component.id)).toMatchObject({ title: "Renamed", priority: 5 });
    expect(state.components.find((entry) => entry.id === component.id)?.lastMemoryUpdatedAt).toBeUndefined();
    expect(state.components.find((entry) => entry.id === component.id)?.memoryUpdateHistory).toBeUndefined();
    state = reduce(state, { type: "APPLY_COMPONENT_UPDATE", componentId: component.id, content: "Generated component" });
    const generatedComponent = state.components.find((entry) => entry.id === component.id);
    expect(generatedComponent?.content).toBe("Generated component");
    expect(generatedComponent?.lastMemoryUpdatedAt).toEqual(expect.any(String));
    expect(generatedComponent?.memoryUpdateHistory?.[0]).toMatchObject({
      source: "aiMemoryUpdate",
      operation: "replace",
      previous: { title: "Renamed", content: "C" },
      next: { title: "Renamed", content: "Generated component" },
    });

    const before = state.components.find((entry) => entry.id === component.id)?.priority;
    state = reduce(state, { type: "REORDER_COMPONENT", componentId: component.id, direction: "up" });
    expect(state.components.find((entry) => entry.id === component.id)?.priority).not.toBe(before);

    state = reduce(state, { type: "DELETE_COMPONENT", componentId: component.id });
    expect(state.components.some((entry) => entry.id === component.id)).toBe(false);
  });

  it("handles every story card action", () => {
    let state = baseAdventure();
    const storyCard = makeStoryCard({ title: "Story C", content: "C", priority: 30 });
    state = reduce(state, { type: "UPSERT_STORY_CARD", storyCard });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.title).toBe("Story C");

    state = reduce(state, { type: "DEACTIVATE_STORY_CARD", storyCardId: storyCard.id });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.active).toBe(false);
    state = reduce(state, { type: "ACTIVATE_STORY_CARD", storyCardId: storyCard.id });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.active).toBe(true);
    state = reduce(state, { type: "PIN_STORY_CARD", storyCardId: storyCard.id });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.pinned).toBe(true);
    state = reduce(state, { type: "UNPIN_STORY_CARD", storyCardId: storyCard.id });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.pinned).toBe(false);
    state = reduce(state, { type: "UPDATE_STORY_CARD", storyCardId: storyCard.id, patch: { title: "Story Renamed", priority: 5 } });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)).toMatchObject({ title: "Story Renamed", priority: 5 });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.lastMemoryUpdatedAt).toBeUndefined();
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.memoryUpdateHistory).toBeUndefined();
    state = reduce(state, { type: "APPLY_STORY_CARD_UPDATE", storyCardId: storyCard.id, content: "Generated story" });
    const generatedStory = state.storyCards.find((entry) => entry.id === storyCard.id);
    expect(generatedStory?.content).toBe("Generated story");
    expect(generatedStory?.lastMemoryUpdatedAt).toEqual(expect.any(String));
    expect(generatedStory?.memoryUpdateHistory?.[0]).toMatchObject({
      source: "aiMemoryUpdate",
      operation: "replace",
      previous: { title: "Story Renamed", content: "C" },
      next: { title: "Story Renamed", content: "Generated story" },
    });
    state = reduce(state, { type: "MARK_STORY_CARD_UPDATED", storyCardId: storyCard.id, turn: 12 });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.lastAutoUpdateTurn).toBe(12);

    const before = state.storyCards.find((entry) => entry.id === storyCard.id)?.priority;
    state = reduce(state, { type: "REORDER_STORY_CARD", storyCardId: storyCard.id, direction: "up" });
    expect(state.storyCards.find((entry) => entry.id === storyCard.id)?.priority).not.toBe(before);

    state = reduce(state, { type: "DELETE_STORY_CARD", storyCardId: storyCard.id });
    expect(state.storyCards.some((entry) => entry.id === storyCard.id)).toBe(false);
  });

  it("handles every brain action", () => {
    let state = baseAdventure();
    const brain = makeBrain({ characterName: "Noor" });
    state = reduce(state, { type: "UPSERT_BRAIN", brain });
    expect(state.brains.find((entry) => entry.id === brain.id)?.characterName).toBe("Noor");

    state = reduce(state, { type: "DEACTIVATE_BRAIN", brainId: brain.id });
    expect(state.brains.find((entry) => entry.id === brain.id)?.active).toBe(false);
    state = reduce(state, { type: "ACTIVATE_BRAIN", brainId: brain.id });
    expect(state.brains.find((entry) => entry.id === brain.id)?.active).toBe(true);
    state = reduce(state, { type: "PIN_BRAIN", brainId: brain.id });
    expect(state.brains.find((entry) => entry.id === brain.id)?.pinned).toBe(true);
    state = reduce(state, { type: "UNPIN_BRAIN", brainId: brain.id });
    expect(state.brains.find((entry) => entry.id === brain.id)?.pinned).toBe(false);
    state = reduce(state, { type: "UPDATE_BRAIN", brainId: brain.id, patch: { thoughts: { seed: "1 → thinking" } } });
    expect(state.brains.find((entry) => entry.id === brain.id)?.thoughts).toEqual({ seed: "1 → thinking" });
    // APPEND_BRAIN_STATE with field "thoughts" is a no-op (thoughts is a Record, not appendable by string)
    state = reduce(state, { type: "APPEND_BRAIN_STATE", brainId: brain.id, field: "thoughts", text: "more" });
    expect(state.brains.find((entry) => entry.id === brain.id)?.thoughts).toEqual({ seed: "1 → thinking" });
    state = reduce(state, { type: "REPLACE_BRAIN_STATE", brainId: brain.id, field: "currentState", text: "steady" });
    expect(state.brains.find((entry) => entry.id === brain.id)?.currentState).toBe("steady");
    state = reduce(state, {
      type: "APPLY_BRAIN_UPDATE",
      brainId: brain.id,
      patch: { thoughts: { generated: "12 → generated thought" } },
      mode: "replace",
      turn: 12,
      preview: "preview",
    });
    expect(state.brains.find((entry) => entry.id === brain.id)).toMatchObject({
      thoughts: { generated: "12 → generated thought" },
      archivedThoughts: { seed: "1 → thinking" },
      lastUpdatedTurn: 12,
      lastGeneratedUpdatePreview: "preview",
    });

    state = reduce(state, { type: "DELETE_BRAIN", brainId: brain.id });
    expect(state.brains.some((entry) => entry.id === brain.id)).toBe(false);
  });

  it("accumulates thoughts in append mode and archives the oldest when over budget", () => {
    let state = baseAdventure();
    // Tiny budget so two short thoughts already exceed it and the oldest gets archived.
    const brain = makeBrain({ characterName: "Nyx", condenseThreshold: 30 });
    state = reduce(state, { type: "UPSERT_BRAIN", brain });

    state = reduce(state, {
      type: "APPLY_BRAIN_UPDATE", brainId: brain.id, mode: "append", turn: 1,
      patch: { thoughts: { first: "1 → oldest thought here" } },
    });
    state = reduce(state, {
      type: "APPLY_BRAIN_UPDATE", brainId: brain.id, mode: "append", turn: 2,
      patch: { thoughts: { second: "2 → newest thought here" } },
    });

    const updated = state.brains.find((entry) => entry.id === brain.id)!;
    // Append kept the newest, pruned the oldest into the archive (non-destructive).
    expect(Object.keys(updated.thoughts)).toEqual(["second"]);
    expect(updated.archivedThoughts.first).toBe("1 → oldest thought here");
  });

  it("turns overwritten AI Brain fields into pending historical Story Card proposals", () => {
    const brain = makeBrain({
      id: "brain-margo-history",
      characterName: "Margo",
      triggers: ["Margo"],
      currentState: "Margo privately believes Seth is using jokes to dodge a real promise.",
      thoughts: { old_read: "7 → He jokes when the room gets too sincere. I should not let that work twice." },
    });
    let state = { ...baseAdventure(), brains: [brain] };

    state = reduce(state, {
      type: "APPLY_BRAIN_UPDATE",
      brainId: "brain-margo-history",
      mode: "replace",
      turn: 8,
      patch: {
        currentState: "Margo now believes Seth meant the promise but is afraid to name it.",
        thoughts: { new_read: "8 → He meant it. That is worse, somehow." },
      },
    });

    const updated = state.brains.find((entry) => entry.id === "brain-margo-history");
    expect(updated?.currentState).toBe("Margo now believes Seth meant the promise but is afraid to name it.");
    expect(updated?.archivedThoughts.old_read).toContain("jokes");
    const outgoing = state.activeState.memoryProposals.filter(
      (proposal) => proposal.proposedType === "storyCard" && proposal.status === "pending",
    );
    expect(outgoing.some((proposal) => proposal.content.includes("using jokes to dodge a real promise"))).toBe(true);
    expect(outgoing.every((proposal) => proposal.memoryMode === "historical")).toBe(true);
  });

  it("auto-approves overwritten Brain field history when Story Cards are auto-approved", () => {
    const brain = makeBrain({
      id: "brain-margo-auto-history",
      characterName: "Margo",
      triggers: ["Margo"],
      relationshipPressure: "Margo treats the ward-room jokes as proof Seth still keeps her at arm's length.",
    });
    let state = {
      ...baseAdventure(),
      brains: [brain],
      memoryAutoApprove: { ...baseAdventure().memoryAutoApprove, storyCard: true },
    };

    state = reduce(state, {
      type: "APPLY_BRAIN_UPDATE",
      brainId: "brain-margo-auto-history",
      mode: "replace",
      turn: 9,
      patch: {
        relationshipPressure: "Margo now reads the jokes as cover for mutual trust neither of them will name.",
      },
    });

    expect(state.storyCards.some((card) => card.content.includes("arm's length") && card.memoryMode === "historical")).toBe(true);
    expect(state.activeState.memoryProposals.some((proposal) => proposal.status === "approved" && proposal.content.includes("arm's length"))).toBe(true);
  });

  it("does not append duplicate brain thoughts under new keys", () => {
    let state = baseAdventure();
    const brain = makeBrain({
      characterName: "Nyx",
      thoughts: { first_read: "4 \u2192 He is trying to bridge the gap too late." },
      archivedThoughts: { archived_read: "3 \u2192 The team missed how badly she flinched." },
    });
    state = reduce(state, { type: "UPSERT_BRAIN", brain });

    state = reduce(state, {
      type: "APPLY_BRAIN_UPDATE",
      brainId: brain.id,
      mode: "append",
      turn: 5,
      patch: { thoughts: { second_read: "5 \u2192 He is trying to bridge the gap too late." } },
    });

    const deduped = state.brains.find((entry) => entry.id === brain.id)!;
    expect(deduped.thoughts).toEqual({ first_read: "4 \u2192 He is trying to bridge the gap too late." });
    expect(deduped.archivedThoughts).toEqual({ archived_read: "3 \u2192 The team missed how badly she flinched." });
  });

  it("handles every trigger rule action", () => {
    let state = baseAdventure();
    const triggerRule = makeTriggerRule({ name: "Rule C", priority: 7 });
    state = reduce(state, { type: "UPSERT_TRIGGER_RULE", triggerRule });
    expect(state.triggerRules.find((entry) => entry.id === triggerRule.id)?.name).toBe("Rule C");

    state = reduce(state, { type: "UPDATE_TRIGGER_RULE", triggerRuleId: triggerRule.id, patch: { enabled: false } });
    expect(state.triggerRules.find((entry) => entry.id === triggerRule.id)?.enabled).toBe(false);
    state = reduce(state, { type: "MARK_TRIGGER_FIRED", triggerRuleId: triggerRule.id, turn: 11 });
    expect(state.triggerRules.find((entry) => entry.id === triggerRule.id)?.lastFiredTurn).toBe(11);

    const logEntry: TriggerLogEntry = {
      id: "log-1",
      triggerRuleId: triggerRule.id,
      triggerName: "Rule C",
      source: "input",
      turn: 11,
      matchedPattern: "door",
      textSnippet: "open door",
      actionCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    state = reduce(state, { type: "LOG_TRIGGER_FIRE", entry: logEntry });
    expect(state.activeState.triggerLog[0]).toBe(logEntry);
    state = reduce(state, {
      type: "LOG_EVALUATION_RESULT",
      entry: {
        id: "eval-1",
        turn: 11,
        createdAt: "2026-01-01T00:00:00.000Z",
        conditionsEvaluated: [],
        conditionsFired: [],
        actionsExecuted: [],
        generatedContent: [],
        errors: [],
      },
    });
    expect(state.activeState.evaluationLog[0].id).toBe("eval-1");

    state = reduce(state, { type: "DELETE_TRIGGER_RULE", triggerRuleId: triggerRule.id });
    expect(state.triggerRules.some((entry) => entry.id === triggerRule.id)).toBe(false);
  });

  it("handles force include and raw import actions", () => {
    let state = baseAdventure();

    state = reduce(state, { type: "FORCE_INCLUDE_NEXT_TURN", targetType: "brain", targetId: state.brains[0].id });
    expect(state.activeState.forceIncludeNextTurn[0]).toMatchObject({ targetType: "brain", targetId: state.brains[0].id });

    const rawImport: RawImportEntry = {
      id: "raw-1",
      source: "json",
      type: "raw",
      title: "Raw",
      content: "raw text",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    state = reduce(state, { type: "ADD_RAW_IMPORT", rawImport });
    expect(state.activeState.rawImports[0]).toBe(rawImport);
    state = reduce(state, { type: "UPDATE_RAW_IMPORT", rawImportId: rawImport.id, patch: { title: "Raw Edited" } });
    expect(state.activeState.rawImports[0].title).toBe("Raw Edited");
    state = reduce(state, { type: "DELETE_RAW_IMPORT", rawImportId: rawImport.id });
    expect(state.activeState.rawImports).toHaveLength(0);
  });

  it("handles memory proposal approval, rejection, and ignore actions", () => {
    let state = baseAdventure();
    const storyProposal = makeMemoryProposal({
      id: "proposal-story",
      proposedType: "storyCard",
      title: "Promise",
      content: "Seth promised Margo he would return.",
      suggestedTriggers: ["Seth", "Margo", "promise"],
    });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: storyProposal });
    expect(state.activeState.memoryProposals[0].status).toBe("pending");

    state = reduce(state, {
      type: "UPDATE_MEMORY_PROPOSAL",
      proposalId: "proposal-story",
      patch: { confidence: 0.75 },
    });
    expect(state.activeState.memoryProposals[0].confidence).toBe(0.75);

    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-story" });
    expect(state.activeState.memoryProposals[0].status).toBe("approved");
    expect(state.storyCards.some((card) => card.title === "Promise" && card.keys.includes("Seth") && card.keys.includes("Margo"))).toBe(true);
    const approvedStoryCard = state.storyCards.find((card) => card.title === "Promise");
    expect(approvedStoryCard?.lastMemoryUpdatedAt).toEqual(expect.any(String));
    expect(approvedStoryCard?.memoryUpdateHistory?.[0]).toMatchObject({
      source: "memoryProposal",
      operation: "create",
      proposalId: "proposal-story",
      previous: null,
      next: {
        title: "Promise",
        content: "",
        compactKind: "promise",
        coreFacts: expect.arrayContaining(["Seth promised Margo he would return."]),
      },
    });

    const brain = makeBrain({ id: "brain-proposal", characterName: "Margo", recentDevelopments: "old" });
    const brainProposal = makeMemoryProposal({
      id: "proposal-brain",
      proposedType: "brainUpdate",
      targetId: "brain-proposal",
      title: "Margo",
      content: "Margo feels jealous but hides it.",
    });
    state = reduce({ ...state, brains: [...state.brains, brain] }, { type: "ADD_MEMORY_PROPOSAL", proposal: brainProposal });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-brain" });
    expect(state.brains.find((entry) => entry.id === "brain-proposal")?.recentDevelopments).toContain("Margo feels jealous");

    const plotProposal = makeMemoryProposal({
      id: "proposal-plot",
      proposedType: "plotEssentialsUpdate",
      title: "Tonight",
      content: "The Beast is actively hunting Seth tonight.",
    });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: plotProposal });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-plot" });
    expect(state.components.some((component) => component.type === "plotEssentials" && component.content.includes("Beast"))).toBe(true);
    const approvedPlot = state.components.find((component) => component.type === "plotEssentials");
    expect(approvedPlot?.lastMemoryUpdatedAt).toEqual(expect.any(String));
    expect(approvedPlot?.memoryUpdateHistory?.[0]).toMatchObject({
      source: "memoryProposal",
      operation: "create",
      proposalId: "proposal-plot",
      previous: null,
      next: { content: "The Beast is actively hunting Seth tonight." },
    });

    const summaryProposal = makeMemoryProposal({
      id: "proposal-summary",
      proposedType: "summaryUpdate",
      title: "Summary",
      content: "Seth and Margo reached the old city.",
    });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: summaryProposal });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-summary" });
    expect(state.rollingSummary.content).toBe("Seth and Margo reached the old city.");

    const momentum = makeComponent({ id: "component-momentum", title: "Immediate Momentum", type: "immediateMomentum", content: "Old next beat." });
    const momentumProposal = makeMemoryProposal({
      id: "proposal-momentum",
      proposedType: "plotMomentumUpdate",
      targetId: "component-momentum",
      title: "Immediate Momentum",
      content: "New next beat that should not apply.",
    });
    state = { ...state, components: [...state.components, momentum] };
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: momentumProposal });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-momentum" });
    expect(state.components.find((component) => component.id === "component-momentum")?.content).toBe("Old next beat.");

    let statusState = baseAdventure();
    const rejected = makeMemoryProposal({
      id: "proposal-reject",
      title: "Rejected Entity",
      content: "The brass key belongs to a dismissed corridor rumor.",
      suggestedTriggers: ["brass key"],
      status: "pending",
    });
    statusState = reduce(statusState, { type: "ADD_MEMORY_PROPOSAL", proposal: rejected });
    statusState = reduce(statusState, { type: "REJECT_MEMORY_PROPOSAL", proposalId: "proposal-reject" });
    expect(statusState.activeState.memoryProposals.find((proposal) => proposal.id === "proposal-reject")?.status).toBe("rejected");

    const ignored = makeMemoryProposal({
      id: "proposal-ignore",
      title: "Ignored Entity",
      content: "The glass orchard blooms only during the winter eclipse.",
      suggestedTriggers: ["glass orchard"],
      status: "pending",
    });
    statusState = reduce(statusState, { type: "ADD_MEMORY_PROPOSAL", proposal: ignored });
    statusState = reduce(statusState, { type: "IGNORE_MEMORY_PROPOSAL", proposalId: "proposal-ignore" });
    expect(statusState.activeState.memoryProposals.find((proposal) => proposal.id === "proposal-ignore")?.status).toBe("ignored");
  });

  it("preserves static story card mode when approving an appended static proposal", () => {
    let state = baseAdventure();
    const redRing = makeStoryCard({
      id: "card-red-ring",
      title: "Red Ring",
      content: "• Shroud's criminal organization and the main enemy faction.",
      keys: ["Red Ring", "Shroud"],
      type: "lore",
      memoryMode: "static",
    });
    state = reduce(state, { type: "UPSERT_STORY_CARD", storyCard: redRing });

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "proposal-red-ring",
        proposedType: "storyCard",
        targetId: "card-red-ring",
        title: "Red Ring",
        content: "• Red Ring pressure now centers on stolen dampener cores.",
        suggestedTriggers: ["Red Ring", "dampener cores"],
        appendContent: true,
        memoryMode: "static",
      }),
    });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-red-ring" });

    const updated = state.storyCards.find((card) => card.id === "card-red-ring");
    expect(updated?.content).toContain("main enemy faction");
    expect(updated?.content).toContain("stolen dampener cores");
    expect(updated?.memoryMode).toBe("static");
    expect((updated?.state ?? "").split(/\s+/)).not.toContain("living");
  });

  it("creates a living child card instead of appending current state to a static character profile", () => {
    let state = baseAdventure();
    state = reduce(state, {
      type: "UPSERT_STORY_CARD",
      storyCard: makeStoryCard({
        id: "card-seth",
        title: "Seth Valis",
        content: "- Player character and Council mage.",
        keys: ["Seth"],
        type: "character",
        memoryMode: "static",
      }),
    });

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "proposal-seth-current",
        proposedType: "storyCard",
        targetId: "card-seth",
        title: "Seth Valis",
        content: "• Seth is currently managing Viktor's notification protocol while Mel handles the Council.",
        suggestedTriggers: ["Seth", "The", "Viktor protocol", "current status"],
        appendContent: true,
        memoryMode: "living",
      }),
    });

    const routed = state.activeState.memoryProposals.find((entry) => entry.id === "proposal-seth-current");
    expect(routed).toMatchObject({
      title: "Seth Valis: Current Status",
      targetId: undefined,
      appendContent: undefined,
      memoryMode: "living",
      suggestedTriggers: ["Viktor protocol"],
    });

    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-seth-current" });

    const profile = state.storyCards.find((card) => card.id === "card-seth");
    const child = state.storyCards.find((card) => card.title === "Seth Valis: Current Status");
    expect(profile?.content).toBe("- Player character and Council mage.");
    expect(child).toMatchObject({
      memoryMode: "living",
      keys: ["Viktor protocol"],
    });
    expect(child?.content).toContain("notification protocol");
  });

  it("blocks repeated dismissed target updates but allows a materially new revision", () => {
    let state = baseAdventure();
    state = reduce(state, {
      type: "UPSERT_STORY_CARD",
      storyCard: makeStoryCard({
        id: "card-red-ring",
        title: "Red Ring",
        content: "• Shroud's criminal organization and the main enemy faction.",
        keys: ["Red Ring", "Shroud"],
        type: "lore",
        memoryMode: "static",
      }),
    });

    const proposal = makeMemoryProposal({
      id: "proposal-red-ring-1",
      proposedType: "storyCard",
      targetId: "card-red-ring",
      title: "Red Ring",
      content: "• Red Ring probes keep bending toward Nix's stolen tech.",
      suggestedTriggers: ["Red Ring", "Nix"],
      appendContent: true,
      memoryMode: "static",
    });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal });
    state = reduce(state, { type: "IGNORE_MEMORY_PROPOSAL", proposalId: "proposal-red-ring-1" });
    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        ...proposal,
        id: "proposal-red-ring-2",
      },
    });

    expect(state.activeState.memoryProposals.filter((entry) => entry.title === "Red Ring")).toHaveLength(1);
    expect(state.activeState.memoryProposals.find((entry) => entry.id === "proposal-red-ring-2")).toBeUndefined();

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        ...proposal,
        id: "proposal-red-ring-3",
        content: "• Shroud has abandoned the technology hunt and ordered the Red Ring to seize the harbor before dawn.",
      },
    });

    expect(state.activeState.memoryProposals.find((entry) => entry.id === "proposal-red-ring-3")?.status).toBe("pending");
  });

  it("does not let one rejected Brain revision mute later Brain suggestions", () => {
    let state = baseAdventure();
    const brain = makeBrain({ id: "brain-edythe", characterName: "Edythe" });
    state = { ...state, brains: [brain] };

    const rejected = makeMemoryProposal({
      id: "brain-update-1",
      proposedType: "brainUpdate",
      targetId: brain.id,
      title: "Edythe",
      content: JSON.stringify({ thoughts: { watched_door: "She decides the watcher knows Seth's apartment." } }),
    });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: rejected });
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: rejected.id });

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        ...rejected,
        id: "brain-update-2",
        content: JSON.stringify({ thoughts: { morning_promise: "She realizes staying until morning became a promise rather than surveillance." } }),
      },
    });

    expect(state.activeState.memoryProposals.find((entry) => entry.id === "brain-update-2")?.status).toBe("pending");
  });

  it("does not start a Story Card cooldown when proposal dedupe discarded the candidate", () => {
    let state = baseAdventure();
    const card = makeStoryCard({ id: "card-edythe", title: "Edythe", content: "Existing facts." });
    state = { ...state, storyCards: [card] };
    const rejected = makeMemoryProposal({
      id: "card-update-1",
      proposedType: "storyCard",
      targetId: card.id,
      title: card.title,
      content: "Edythe promises to remain until morning.",
      appendContent: false,
    });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: rejected });
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: rejected.id });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...rejected, id: "card-update-2" } });
    state = reduce(state, {
      type: "MARK_STORY_CARD_UPDATED",
      storyCardId: card.id,
      turn: 42,
      proposalId: "card-update-2",
    });

    expect(state.activeState.memoryProposals.find((entry) => entry.id === "card-update-2")).toBeUndefined();
    expect(state.storyCards.find((entry) => entry.id === card.id)?.lastAutoUpdateTurn).toBeUndefined();
  });

  it("still allows new living-card updates after a different living update was dismissed", () => {
    let state = baseAdventure();
    state = reduce(state, {
      type: "UPSERT_STORY_CARD",
      storyCard: makeStoryCard({
        id: "card-bond",
        title: "Nix and Seth",
        content: "• Their bond is private and unresolved.",
        keys: ["Nix", "Seth"],
        memoryMode: "living",
      }),
    });

    const first = makeMemoryProposal({
      id: "proposal-bond-1",
      proposedType: "storyCard",
      targetId: "card-bond",
      title: "Nix and Seth",
      content: "• Nix is testing whether Seth will keep choosing her chaos.",
      appendContent: true,
      memoryMode: "living",
    });
    const second = makeMemoryProposal({
      ...first,
      id: "proposal-bond-2",
      content: "• Seth and Nix now trust each other with dangerous field experiments.",
    });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: first });
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: "proposal-bond-1" });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: second });

    expect(state.activeState.memoryProposals.find((entry) => entry.id === "proposal-bond-2")?.status).toBe("pending");
  });

  it("drops a near-duplicate suggestion that differs only by a leading article or punctuation", () => {
    let state = baseAdventure();
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "e1", title: "The Escape from Gutterglass", proposedType: "storyCard", status: "pending" }) });
    // same event, title differs only by the leading "The" and a trailing "!" → should be dropped
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "e2", title: "Escape from Gutterglass!", proposedType: "storyCard", status: "pending" }) });
    expect(state.activeState.memoryProposals.some((p) => p.id === "e2")).toBe(false);
    expect(state.activeState.memoryProposals.filter((p) => /escape from gutterglass/i.test(p.title))).toHaveLength(1);
  });

  it("drops a repeated story-card memory even when the model changes the title", () => {
    let state = baseAdventure();
    const first = makeMemoryProposal({
      id: "same-event-1",
      title: "Gutterglass Escape",
      proposedType: "storyCard",
      content:
        "• Seth, Quintin, and Jinx escaped the Gutterglass Pumpworks together, evading Caitlyn and Vi's trap.\n" +
        "• They used coordinated bending, blue fire, and a maintenance tunnel to leave with the hextech regulator.",
      status: "pending",
    });
    const second = makeMemoryProposal({
      id: "same-event-2",
      title: "Seth, Quintin, and Jinx's Flight",
      proposedType: "storyCard",
      content:
        "• Seth, Quintin, and Jinx escaped Caitlyn and Vi inside the Gutterglass Pumpworks.\n" +
        "• Their coordinated bending, blue fire, and the maintenance tunnel let them leave with the hextech regulator.",
      status: "pending",
    });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: first });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: second });

    expect(state.activeState.memoryProposals.some((p) => p.id === "same-event-2")).toBe(false);
    expect(state.activeState.memoryProposals).toHaveLength(1);
  });

  it("drops a story-card suggestion whose content already exists on an approved card", () => {
    const card = makeStoryCard({
      title: "Gutterglass Escape",
      content:
        "• Seth, Quintin, and Jinx escaped the Gutterglass Pumpworks together, evading Caitlyn and Vi's trap.\n" +
        "• They used coordinated bending, blue fire, and a maintenance tunnel to leave with the hextech regulator.",
      active: true,
    });
    let state = { ...baseAdventure(), storyCards: [card] };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "already-carded",
        title: "The Escape from Gutterglass",
        proposedType: "storyCard",
        content:
          "• Seth, Quintin, and Jinx escaped Caitlyn and Vi inside the Gutterglass Pumpworks.\n" +
          "• Their coordinated bending, blue fire, and the maintenance tunnel let them leave with the hextech regulator.",
        status: "pending",
      }),
    });

    expect(state.activeState.memoryProposals.some((p) => p.id === "already-carded")).toBe(false);
  });

  it("quietly applies auto-approved Active Pressure without filling Memory Suggestions history", () => {
    const base = baseAdventure();
    const pressure = makeComponent({
      id: "comp-pressure",
      title: "Active Pressure",
      type: "activePressure",
      content: "Old pressure.",
      active: true,
    });
    let state = {
      ...base,
      components: [pressure],
      memoryAutoApprove: { ...base.memoryAutoApprove, plotPressureUpdate: true },
    };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "pressure-1",
        proposedType: "plotPressureUpdate",
        title: "Active Pressure",
        targetId: "comp-pressure",
        content: "Caitlyn's task force is sealing the Pumpworks around Seth and Jinx.",
        status: "pending",
      }),
    });

    expect(state.components.find((component) => component.id === "comp-pressure")?.content).toBe(
      "Caitlyn's task force is sealing the Pumpworks around Seth and Jinx.",
    );
    expect(state.activeState.memoryProposals.some((p) => p.id === "pressure-1")).toBe(false);

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "pressure-duplicate",
        proposedType: "plotPressureUpdate",
        title: "Active Pressure",
        targetId: "comp-pressure",
        content: "Caitlyn's task force is sealing the Pumpworks around Seth and Jinx.",
        status: "pending",
      }),
    });

    expect(state.activeState.memoryProposals.some((p) => p.id === "pressure-duplicate")).toBe(false);
  });

  it("auto-approves Story Card history created by an auto-approved Plot Essentials replacement", () => {
    const plot = makeComponent({
      id: "component-plot",
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "Azula revealed the silver warrant to Seth in the council chamber, proving the conspiracy had court access.",
      active: true,
    });
    let state = {
      ...baseAdventure(),
      components: [plot],
      memoryAutoApprove: {
        ...baseAdventure().memoryAutoApprove,
        plotEssentialsUpdate: true,
        storyCard: true,
      },
    };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "plot-replacement",
        proposedType: "plotEssentialsUpdate",
        title: "Plot Essentials",
        targetId: "component-plot",
        content: "Seth has left the council chamber to warn Margo before midnight.",
      }),
    });

    expect(state.components.find((component) => component.id === "component-plot")?.content).toContain("warn Margo");
    expect(state.storyCards.some((card) => card.content.includes("silver warrant"))).toBe(true);
    expect(state.activeState.memoryProposals.find((proposal) => proposal.id === "plot-replacement")?.status).toBe("approved");
    expect(
      state.activeState.memoryProposals.some(
        (proposal) => proposal.proposedType === "storyCard" && proposal.status === "pending" && proposal.content.includes("silver warrant"),
      ),
    ).toBe(false);
    expect(
      state.activeState.memoryProposals.some(
        (proposal) => proposal.proposedType === "storyCard" && proposal.status === "approved" && proposal.content.includes("silver warrant"),
      ),
    ).toBe(true);
  });

  it("approving a proposal that names a card by an alias updates that card instead of duplicating it", () => {
    const toph = makeStoryCard({ id: "card-toph", title: "Toph Beifong", keys: ["Toph", "Beifong"], content: "• Greatest earthbender alive.", active: true });
    let state = { ...baseAdventure(), storyCards: [toph] };
    const before = state.storyCards.length;
    // Model refers to her as "Toph" (a key, not the exact card title "Toph Beifong").
    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({ id: "toph-alias", proposedType: "storyCard", title: "Toph", content: "• Now travels with the group as its fifth member.", suggestedTriggers: ["Toph"], status: "pending" }),
    });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "toph-alias" });
    const tophCards = state.storyCards.filter((c) => /toph/i.test(c.title));
    expect(state.storyCards.length).toBe(before); // no duplicate created
    expect(tophCards).toHaveLength(1);
    expect(tophCards[0].title).toBe("Toph Beifong"); // landed on the existing card
    expect(tophCards[0].content).toContain("fifth member");
    expect(tophCards[0].keys).toContain("Beifong"); // a sparse update must not strip existing aliases
  });

  it("approving an arcProposal seeds the Current Arc simmering and banks the old arc", () => {
    const arcComp = makeComponent({
      id: "component-arc",
      title: "Current Arc",
      type: "currentArc",
      content: "The Renzan conspiracy was broken and its heads arrested.",
      arcPremise: "Break the Renzan conspiracy",
      arcState: { phase: "aftermath", tier: 5, threadEngagement: { x: 10 }, pendingBreak: false },
    });
    let state = { ...baseAdventure(), components: [arcComp] };

    const arcProposal = makeMemoryProposal({
      id: "proposal-arc",
      proposedType: "arcProposal",
      title: "A Pact of Flame",
      targetId: "component-arc",
      content: JSON.stringify({
        arcPremise: "Azula moves against the throne from the shadows",
        arcSimmerInstruction: "She stays off-screen, working through proxies.",
        arcBreakInstruction: "The confrontation lands and costs an ally.",
        arcPace: "epic",
        arcTriggerMode: "ask",
        arcThreadKeys: ["card-azula"],
      }),
    });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: arcProposal });
    expect(state.activeState.memoryProposals.find((p) => p.id === "proposal-arc")?.status).toBe("pending");

    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-arc" });

    const seeded = state.components.find((c) => c.id === "component-arc");
    expect(seeded?.arcPremise).toBe("Azula moves against the throne from the shadows");
    expect(seeded?.arcPace).toBe("epic");
    expect(seeded?.arcThreadKeys).toEqual(["card-azula"]);
    expect(seeded?.arcState?.phase).toBe("simmer");
    expect(seeded?.arcState?.tier).toBe(0);
    expect(seeded?.content).toBe("");
    // Old arc banked as a Story Card so prior arcs are preserved.
    expect(state.storyCards.some((card) => card.content.includes("Renzan conspiracy was broken"))).toBe(true);
  });

  it("auto-approves arcProposal when enabled", () => {
    const arcComp = makeComponent({
      id: "component-arc",
      title: "Current Arc",
      type: "currentArc",
      content: "",
    });
    let state = {
      ...baseAdventure(),
      components: [arcComp],
      memoryAutoApprove: { ...baseAdventure().memoryAutoApprove, arcProposal: true },
    };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "proposal-arc-auto",
        proposedType: "arcProposal",
        title: "A Pact of Flame",
        targetId: "component-arc",
        content: JSON.stringify({
          arcPremise: "Azula moves against the throne from the shadows",
          arcSimmerInstruction: "She stays off-screen, working through proxies.",
          arcBreakInstruction: "The confrontation lands and costs an ally.",
          arcPace: "epic",
          arcTriggerMode: "ask",
          arcThreadKeys: ["card-azula"],
        }),
      }),
    });

    expect(state.components.find((component) => component.id === "component-arc")?.arcPremise).toBe(
      "Azula moves against the throne from the shadows",
    );
    expect(state.activeState.memoryProposals.find((proposal) => proposal.id === "proposal-arc-auto")?.status).toBe("approved");
    expect(state.activeState.memoryProposals.some((proposal) => proposal.id === "proposal-arc-auto" && proposal.status === "pending")).toBe(false);
  });

  it("drops an arcProposal whose content is not valid arc JSON", () => {
    let state = { ...baseAdventure(), components: [makeComponent({ id: "component-arc", type: "currentArc", title: "Current Arc", content: "" })] };
    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({ id: "bad-arc", proposedType: "arcProposal", title: "Bad", content: "not json" }),
    });
    expect(state.activeState.memoryProposals.some((p) => p.id === "bad-arc")).toBe(false);
  });

  it("living-card update: compact facts move into structured fields without auto-protecting the card", () => {
    const card = makeStoryCard({
      id: "card-living",
      title: "Setu and Nyxa",
      memoryMode: "living",
      content: "• Their bond was a court secret.\n• They spar as equals.",
      keys: ["Setu", "Nyxa"],
      tokenBudget: 10, // ~40 char live budget — forces the oldest fact to archive
      active: true,
    });
    let state = { ...baseAdventure(), storyCards: [card] };

    const update = makeMemoryProposal({
      id: "proposal-card-update",
      proposedType: "storyCard",
      title: "Setu and Nyxa",
      targetId: "card-living",
      appendContent: true,
      content: "• Setu has now brought her into his private chambers.",
      suggestedTriggers: ["chambers"],
    });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: update });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-card-update" });

    const merged = state.storyCards.find((c) => c.id === "card-living");
    expect(merged?.compactKind).toBe("secret");
    expect(merged?.compactStatus).toBe("active");
    expect(merged?.coreFacts?.join("\n")).toContain("Their bond was a court secret");
    expect([...(merged?.currentFacts ?? []), ...(merged?.recentDevelopments ?? [])].join("\n")).toContain("private chambers");
    expect(merged?.content).not.toContain("court secret");
    expect(merged?.pinned).toBe(true);
    expect(merged?.protected).toBe(false);
    expect(state.storyCards.filter((c) => c.title === "Setu and Nyxa")).toHaveLength(1);
    expect(merged?.keys).toContain("chambers");
    expect(merged?.memoryUpdateHistory?.[0]).toMatchObject({
      source: "memoryProposal",
      operation: "append",
      proposalId: "proposal-card-update",
      previous: { content: expect.stringContaining("They spar as equals") },
      next: { coreFacts: expect.arrayContaining([expect.stringContaining("court secret")]) },
    });
  });

  it("living-card update: ordinary cards still archive the oldest fact over budget", () => {
    const card = makeStoryCard({
      id: "card-ordinary-living",
      title: "Setu and Nyxa Training",
      memoryMode: "living",
      content: "- Their lessons began during the market festival.\n- They spar as equals.",
      keys: ["training"],
      tokenBudget: 10,
      active: true,
    });
    let state = { ...baseAdventure(), storyCards: [card] };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "proposal-ordinary-living",
        proposedType: "storyCard",
        title: "Setu and Nyxa Training",
        targetId: "card-ordinary-living",
        appendContent: true,
        content: "- Setu has now brought her into his private chambers.",
        suggestedTriggers: ["chambers"],
      }),
    });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-ordinary-living" });

    const merged = state.storyCards.find((c) => c.id === "card-ordinary-living");
    expect(merged?.content).toContain("private chambers");
    expect(merged?.archivedFacts).toContain("lessons began during the market festival");
    expect(merged?.content).not.toContain("lessons began during the market festival");
    expect(merged?.pinned).toBe(false);
    expect(merged?.protected).toBe(false);
  });

  it("story-card replacements preserve guarded compact facts from live content and archives", () => {
    const card = makeStoryCard({
      id: "card-jinx-pact",
      title: "Seth's Pact with Jinx",
      memoryMode: "living",
      content: "- Seth and Jinx have a secret pact: Jinx stops killing except in self-protection.",
      archivedFacts: "- Mel's official cover story keeps Seth on the Council as a political shield.",
      keys: ["Jinx pact"],
      active: true,
    });
    let state = { ...baseAdventure(), storyCards: [card] };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "proposal-jinx-pact-replace",
        proposedType: "storyCard",
        title: "Seth's Pact with Jinx",
        targetId: "card-jinx-pact",
        appendContent: false,
        content: "- Jinx is repairing the Sump air filter with Seth's arcane help.",
        suggestedTriggers: ["Sump air filter"],
        memoryMode: "living",
      }),
    });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-jinx-pact-replace" });

    const updated = state.storyCards.find((c) => c.id === "card-jinx-pact");
    expect(updated?.compactKind).toBe("coverStory");
    expect(updated?.coreFacts?.join("\n")).toContain("secret pact");
    expect(updated?.coreFacts?.join("\n")).toContain("official cover story");
    expect([...(updated?.currentFacts ?? []), ...(updated?.recentDevelopments ?? [])].join("\n")).toContain("Sump air filter");
    expect(updated?.pinned).toBe(true);
    expect(updated?.protected).toBe(false);
    expect(updated?.priority).toBeGreaterThanOrEqual(80);
    expect(updated?.tokenBudget).toBeGreaterThanOrEqual(450);
  });

  it("applies Story Card proposal type and auto-update settings when approving AI builder drafts", () => {
    let state = baseAdventure();
    const proposal = makeMemoryProposal({
      id: "proposal-relationship-card",
      proposedType: "storyCard",
      title: "Seth and Margo Trust",
      content: "• Seth and Margo use ward-room jokes as a private trust signal.",
      suggestedTriggers: ["ward-room jokes", "private trust signal"],
      memoryMode: "living",
      storyCardType: "plot",
      autoUpdate: true,
      autoUpdateCooldownTurns: 2,
    });

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-relationship-card" });

    const card = state.storyCards.find((entry) => entry.title === "Seth and Margo Trust");
    expect(card).toMatchObject({
      type: "plot",
      memoryMode: "living",
      autoUpdate: true,
      autoUpdateCooldownTurns: 2,
    });
  });

  it("routes related generated facts into an existing living story card instead of creating a sibling", () => {
    const viktor = makeStoryCard({
      id: "card-viktor",
      title: "Viktor's Lattice Heart",
      content: "- Viktor maintains the fused commune through his lattice heart.",
      keys: ["Viktor", "lattice heart"],
      memoryMode: "living",
      active: true,
    });
    let state = { ...baseAdventure(), storyCards: [viktor] };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "viktor-update",
        proposedType: "storyCard",
        title: "Fused Commune Maintenance",
        content: "- Viktor's lattice heart now requires periodic commune maintenance.",
        suggestedTriggers: ["Viktor", "fused commune", "lattice heart"],
        status: "pending",
      }),
    });

    const proposal = state.activeState.memoryProposals.find((entry) => entry.id === "viktor-update");
    expect(proposal).toMatchObject({
      title: "Viktor's Lattice Heart",
      targetId: "card-viktor",
      appendContent: true,
      memoryMode: "living",
    });

    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "viktor-update" });
    const cards = state.storyCards.filter((card) => /viktor/i.test(card.title));
    expect(cards).toHaveLength(1);
    expect(cards[0].content).toContain("periodic commune maintenance");
  });

  it("removes broad character triggers from generated subplot cards when those triggers belong to other cards", () => {
    const jinx = makeStoryCard({
      id: "card-jinx",
      title: "Jinx",
      content: "- Jinx carries cloud tattoos and uses blue fire.",
      keys: ["Jinx", "blue fire"],
      type: "character",
      active: true,
    });
    const vi = makeStoryCard({
      id: "card-vi",
      title: "Vi",
      content: "- Vi works the case through Piltover channels.",
      keys: ["Vi"],
      type: "character",
      active: true,
    });
    let state = { ...baseAdventure(), storyCards: [jinx, vi] };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "vi-search",
        proposedType: "storyCard",
        title: "Vi's Search for Jinx",
        content: "- Vi's search for Jinx now runs through Piltover specialists and a sealed warrant.",
        suggestedTriggers: ["Jinx", "Vi", "blue fire", "Piltover specialists", "sealed warrant"],
        memoryMode: "living",
        status: "pending",
      }),
    });

    const proposal = state.activeState.memoryProposals.find((entry) => entry.id === "vi-search");
    expect(proposal?.suggestedTriggers).toEqual(["Piltover specialists", "sealed warrant"]);

    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "vi-search" });
    const searchCard = state.storyCards.find((card) => card.title === "Vi's Search for Jinx");
    expect(searchCard?.keys).toEqual(["Piltover specialists", "sealed warrant"]);
  });

  it("replaces Plot Essentials and turns outgoing PE facts into pending historical card proposals", () => {
    const plot = makeComponent({
      id: "component-pe",
      title: "Plot Essentials",
      type: "plotEssentials",
      content:
        "- The Drowned Choir had already sold Seth a false map to the undercity gate.\n" +
        "- Caitlyn is currently sealing the Pumpworks with a task force.",
      active: true,
    });
    let state = { ...baseAdventure(), components: [plot] };

    state = reduce(state, {
      type: "ADD_MEMORY_PROPOSAL",
      proposal: makeMemoryProposal({
        id: "pe-replacement",
        proposedType: "plotEssentialsUpdate",
        title: "Plot Essentials",
        targetId: "component-pe",
        appendContent: false,
        content: "- Caitlyn's task force has moved from sealing the Pumpworks to guarding the canal exits.",
        status: "pending",
      }),
    });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "pe-replacement" });

    expect(state.components.find((component) => component.id === "component-pe")?.content).toBe(
      "- Caitlyn's task force has moved from sealing the Pumpworks to guarding the canal exits.",
    );
    const outgoing = state.activeState.memoryProposals.filter(
      (proposal) => proposal.proposedType === "storyCard" && proposal.status === "pending",
    );
    expect(outgoing.some((proposal) => proposal.content.includes("Drowned Choir"))).toBe(true);
    expect(outgoing.every((proposal) => proposal.memoryMode === "historical")).toBe(true);
    expect(state.activeState.memoryProposals.find((proposal) => proposal.id === "pe-replacement")?.status).toBe("approved");
  });

  it("archives direct AI Plot Essentials replacements through historical Story Card proposals", () => {
    const plot = makeComponent({
      id: "component-pe-direct",
      title: "Plot Essentials",
      type: "plotEssentials",
      content:
        "- The Drowned Choir had already sold Seth a false map to the undercity gate.\n" +
        "- Caitlyn is currently sealing the Pumpworks with a task force.",
      active: true,
    });
    let state = { ...baseAdventure(), components: [plot] };

    state = reduce(state, {
      type: "APPLY_COMPONENT_UPDATE",
      componentId: "component-pe-direct",
      content: "- Caitlyn's task force has moved from sealing the Pumpworks to guarding the canal exits.",
    });

    expect(state.components.find((component) => component.id === "component-pe-direct")?.content).toBe(
      "- Caitlyn's task force has moved from sealing the Pumpworks to guarding the canal exits.",
    );
    const outgoing = state.activeState.memoryProposals.filter(
      (proposal) => proposal.proposedType === "storyCard" && proposal.status === "pending",
    );
    expect(outgoing.some((proposal) => proposal.content.includes("Drowned Choir"))).toBe(true);
    expect(outgoing.every((proposal) => proposal.memoryMode === "historical")).toBe(true);
  });

  it("auto-approves outgoing Plot Essentials history when Story Cards are auto-approved", () => {
    const plot = makeComponent({
      id: "component-pe-auto-history",
      title: "Plot Essentials",
      type: "plotEssentials",
      content:
        "- The Drowned Choir had already sold Seth a false map to the undercity gate.\n" +
        "- Caitlyn is currently sealing the Pumpworks with a task force.",
      active: true,
    });
    let state = {
      ...baseAdventure(),
      components: [plot],
      memoryAutoApprove: { ...baseAdventure().memoryAutoApprove, storyCard: true },
    };

    state = reduce(state, {
      type: "APPLY_COMPONENT_UPDATE",
      componentId: "component-pe-auto-history",
      content: "- Caitlyn's task force has moved from sealing the Pumpworks to guarding the canal exits.",
    });

    expect(state.storyCards.some((card) => card.content.includes("Drowned Choir") && card.memoryMode === "historical")).toBe(true);
    expect(state.activeState.memoryProposals.some((proposal) => proposal.status === "approved" && proposal.content.includes("Drowned Choir"))).toBe(true);
  });

  it("does not resurrect a dismissed suggestion, but still allows new living-card updates", () => {
    let state = baseAdventure();

    // Reject a new-card suggestion → re-suggesting the same title next turn is dropped.
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "d1", title: "The Drowned Choir", proposedType: "storyCard", status: "pending" }) });
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: "d1" });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "d2", title: "The Drowned Choir", proposedType: "storyCard", status: "pending" }) });
    expect(state.activeState.memoryProposals.some((p) => p.id === "d2")).toBe(false);

    // Ignored suggestions are likewise not resurrected.
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "d3", title: "The Ash Market", proposedType: "storyCard", status: "pending" }) });
    state = reduce(state, { type: "IGNORE_MEMORY_PROPOSAL", proposalId: "d3" });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "d4", title: "The Ash Market", proposedType: "storyCard", status: "pending" }) });
    expect(state.activeState.memoryProposals.some((p) => p.id === "d4")).toBe(false);

    // But a living-card UPDATE (appendContent) sharing a card title is NOT blocked by a past dismissal.
    const card = makeStoryCard({ id: "card-x", title: "Setu and Nyxa", content: "• base fact", memoryMode: "living", active: true });
    state = { ...state, storyCards: [card] };
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "u1", title: "Setu and Nyxa", proposedType: "storyCard", targetId: "card-x", appendContent: true, content: "• first development", status: "pending" }) });
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: "u1" });
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "u2", title: "Setu and Nyxa", proposedType: "storyCard", targetId: "card-x", appendContent: true, content: "• second development", status: "pending" }) });
    expect(state.activeState.memoryProposals.some((p) => p.id === "u2")).toBe(true);
  });

  it("dedups memory proposals — skips a duplicate pending suggestion or an existing card title", () => {
    let state = baseAdventure();

    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "p1", title: "The Harbormaster", proposedType: "storyCard", status: "pending" }) });
    // Same entity re-suggested next turn → dropped (case-insensitive); no duplicate proposal.
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "p2", title: "the harbormaster", proposedType: "storyCard", status: "pending" }) });
    expect(state.activeState.memoryProposals.filter((p) => p.title.toLowerCase() === "the harbormaster")).toHaveLength(1);
    expect(state.activeState.memoryProposals.some((p) => p.id === "p2")).toBe(false);

    // New story card proposal whose title already exists as a card → dropped.
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "p3", title: "Story A", proposedType: "storyCard", status: "pending" }) });
    expect(state.activeState.memoryProposals.some((p) => p.id === "p3")).toBe(false);

    // A genuinely new entity still gets through.
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "p4", title: "The Masked Agent", proposedType: "storyCard", status: "pending" }) });
    expect(state.activeState.memoryProposals.some((p) => p.id === "p4")).toBe(true);
  });

  it("stores arc continuations, then applies one — banking the old arc and reseeding the next", () => {
    let state = baseAdventure();
    const arc = makeComponent({
      title: "Current Story Arc",
      type: "currentArc",
      content: "Renzan fell; the Society survived.",
      arcPremise: "Take down Lord Renzan.",
      arcThreadKeys: ["thread-renzan"],
      arcPace: "short",
      arcTriggerMode: "ask",
    });
    state = reduce(state, { type: "UPSERT_COMPONENT", component: arc });
    const get = () => state.components.find((component) => component.id === arc.id)!;

    const option = {
      label: "Azula takes the Society",
      premise: "With Renzan gone, Azula seizes the New Ozai Society.",
      threadKeys: ["thread-azula"],
      simmerInstruction: "Azula moves through proxies.",
      breakInstruction: "Azula forces a reckoning; it costs the cast.",
      pace: "epic" as const,
    };

    state = reduce(state, { type: "SET_ARC_CONTINUATIONS", componentId: arc.id, options: [option] });
    expect(get().arcContinuationOptions).toHaveLength(1);

    const cardsBefore = state.storyCards.length;
    state = reduce(state, { type: "APPLY_ARC_CONTINUATION", componentId: arc.id, option });

    // The finished arc is banked as a Story Card.
    expect(state.storyCards.length).toBe(cardsBefore + 1);
    expect(state.storyCards.some((card) => card.content.includes("Renzan fell"))).toBe(true);

    // The component is reseeded as the next arc, simmering and fresh.
    expect(get().arcPremise).toBe(option.premise);
    expect(get().arcThreadKeys).toEqual(["thread-azula"]);
    expect(get().arcPace).toBe("epic");
    expect(get().content).toBe("");
    expect(get().arcState?.phase).toBe("simmer");
    expect(get().arcContinuationOptions).toBeUndefined();
  });

  it("completes the current arc directly into a historical Story Card", () => {
    let state = baseAdventure();
    const arc = makeComponent({
      title: "Current Story Arc",
      type: "currentArc",
      content: "Renzan fell; the Society survived.",
      arcPremise: "Take down Lord Renzan.",
      arcThreadKeys: ["thread-renzan"],
      arcSimmerInstruction: "Renzan moves through proxies.",
      arcBreakInstruction: "Renzan forces the confrontation.",
      arcState: { phase: "aftermath", tier: 5, threadEngagement: { "thread-renzan": 8 }, pendingBreak: false },
    });
    state = reduce(state, { type: "UPSERT_COMPONENT", component: arc });

    const cardsBefore = state.storyCards.length;
    state = reduce(state, { type: "COMPLETE_ARC_TO_STORY_CARD", componentId: arc.id });

    expect(state.storyCards.length).toBe(cardsBefore + 1);
    const archived = state.storyCards.at(-1);
    expect(archived).toMatchObject({
      title: "Take down Lord Renzan.",
      type: "plot",
      memoryMode: "historical",
      active: true,
      state: "archivedArc",
    });
    expect(archived?.content).toContain("Arc: Take down Lord Renzan.");
    expect(archived?.content).toContain("Renzan fell; the Society survived.");

    const resetArc = state.components.find((component) => component.id === arc.id);
    expect(resetArc?.arcPremise).toBe("");
    expect(resetArc?.content).toBe("");
    expect(resetArc?.arcThreadKeys).toEqual([]);
    expect(resetArc?.arcState?.phase).toBe("simmer");
    expect(resetArc?.arcContinuationOptions).toBeUndefined();
  });

  it("tracks story text undo and redo for adds, edits, erases, and opening scene edits", () => {
    let state = baseAdventure();

    state = reduce(state, { type: "ADD_MESSAGE", id: "msg-3", role: "user", content: "I open the door.", createdAt: "2026-01-01T00:02:00.000Z" });
    expect(state.messages.at(-1)?.id).toBe("msg-3");
    expect(state.activeState.storyUndoStack[0].label).toBe("Add entered section");

    state = reduce(state, { type: "UNDO_STORY_EDIT" });
    expect(state.messages.some((message) => message.id === "msg-3")).toBe(false);
    expect(state.activeState.storyRedoStack).toHaveLength(1);

    state = reduce(state, { type: "REDO_STORY_EDIT" });
    expect(state.messages.at(-1)?.id).toBe("msg-3");
    expect(state.activeState.storyRedoStack).toHaveLength(0);

    state = reduce(state, { type: "UPDATE_MESSAGE", messageId: "msg-3", content: "I open the iron door." });
    expect(state.messages.find((message) => message.id === "msg-3")?.content).toBe("I open the iron door.");
    state = reduce(state, { type: "UNDO_STORY_EDIT" });
    expect(state.messages.find((message) => message.id === "msg-3")?.content).toBe("I open the door.");
    state = reduce(state, { type: "REDO_STORY_EDIT" });
    expect(state.messages.find((message) => message.id === "msg-3")?.content).toBe("I open the iron door.");

    state = reduce(state, { type: "DELETE_LAST_MESSAGE" });
    expect(state.messages.some((message) => message.id === "msg-3")).toBe(false);
    state = reduce(state, { type: "UNDO_STORY_EDIT" });
    expect(state.messages.at(-1)?.id).toBe("msg-3");

    expect(state.activeState.storyUndoStack.length).toBeGreaterThan(0);
  });

  it("clamps rolling summary indexes when story sections are erased or reset", () => {
    let state: Adventure = {
      ...baseAdventure(),
      rollingSummary: {
        content: "The current transcript has already been summarized.",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSummarizedMessageIndex: 2,
      },
    };

    state = reduce(state, { type: "DELETE_LAST_MESSAGE" });
    expect(state.messages).toHaveLength(1);
    expect(state.rollingSummary.lastSummarizedMessageIndex).toBe(1);

    state = reduce(state, { type: "RESET_RUNTIME_STATE" });
    expect(state.messages).toHaveLength(0);
    expect(state.rollingSummary.lastSummarizedMessageIndex).toBeUndefined();
  });

  it("advances arc pacing from engagement, auto-fires the break, then settles into aftermath", () => {
    let state = baseAdventure();
    const arc = makeComponent({
      title: "Current Story Arc",
      type: "currentArc",
      content: "",
      arcThreadKeys: ["baddie"],
      arcPace: "short", // escalate at 4, break at 8
      arcTriggerMode: "auto",
      arcBreakInstruction: "force the confrontation",
    });
    state = reduce(state, { type: "UPSERT_COMPONENT", component: arc });
    const get = () => state.components.find((component) => component.id === arc.id)!;

    for (let turn = 1; turn <= 3; turn++) state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: ["baddie"], turn });
    expect(get().arcState?.phase).toBe("simmer");

    state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: ["baddie"], turn: 4 });
    expect(get().arcState?.phase).toBe("escalate");

    for (let turn = 5; turn <= 8; turn++) state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: ["baddie"], turn });
    expect(get().arcState?.phase).toBe("break");
    expect(get().arcState?.brokeAtTurn).toBe(8);

    // break settles into aftermath after ARC_BREAK_DURATION (6) turns
    state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: [], turn: 14 });
    expect(get().arcState?.phase).toBe("aftermath");
  });

  it("holds the break in ask mode until the player confirms it", () => {
    let state = baseAdventure();
    const arc = makeComponent({
      title: "Current Story Arc",
      type: "currentArc",
      content: "",
      arcThreadKeys: ["baddie"],
      arcPace: "short",
      arcTriggerMode: "ask",
    });
    state = reduce(state, { type: "UPSERT_COMPONENT", component: arc });
    const get = () => state.components.find((component) => component.id === arc.id)!;

    for (let turn = 1; turn <= 8; turn++) state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: ["baddie"], turn });
    // gate is open but the break has NOT fired — it waits on the player (the leash)
    expect(get().arcState?.phase).toBe("escalate");
    expect(get().arcState?.pendingBreak).toBe(true);

    state = reduce(state, { type: "SET_ARC_PHASE", componentId: arc.id, phase: "break", turn: 9 });
    expect(get().arcState?.phase).toBe("break");
    expect(get().arcState?.pendingBreak).toBe(false);
  });

  it("counts only configured threads and resets engagement when returned to simmer", () => {
    let state = baseAdventure();
    const arc = makeComponent({
      title: "Current Story Arc",
      type: "currentArc",
      content: "",
      arcThreadKeys: ["baddie"],
      arcPace: "short",
      arcTriggerMode: "auto",
    });
    state = reduce(state, { type: "UPSERT_COMPONENT", component: arc });
    const get = () => state.components.find((component) => component.id === arc.id)!;

    // unrelated triggers never move the arc
    for (let turn = 1; turn <= 10; turn++) state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: ["someone-else"], turn });
    expect(get().arcState?.phase).toBe("simmer");
    expect(get().arcState?.threadEngagement.baddie ?? 0).toBe(0);

    for (let turn = 11; turn <= 14; turn++) state = reduce(state, { type: "ADVANCE_ARC_PACING", triggeredIds: ["baddie"], turn });
    expect(get().arcState?.threadEngagement.baddie).toBe(4);

    state = reduce(state, { type: "SET_ARC_PHASE", componentId: arc.id, phase: "simmer", turn: 15 });
    expect(get().arcState?.threadEngagement).toEqual({});
    expect(get().arcState?.tier).toBe(0);
  });
});
