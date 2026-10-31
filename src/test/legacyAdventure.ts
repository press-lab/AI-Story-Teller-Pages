import type { LegacyAdventureInput } from "../state/legacyAdventureInput";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule } from "../state/defaults";
import { makeMemoryProposal } from "./goldenAdventure";

/** Historical input fixture only. Retired fields must never survive a current save. */
export function legacyAdventure(): LegacyAdventureInput {
  const a = createDefaultAdventure("Legacy compatibility fixture");
  return {
    ...a,
    rollingSummary: { content: "RETIRED SUMMARY SENTINEL", updatedAt: a.createdAt, lastSummarizedMessageIndex: 2 },
    sceneState: { content: "RETIRED SCENE SENTINEL", updatedAt: a.createdAt },
    messages: [
      { id: "source", role: "assistant", content: "The observatory opened. Mira promised to guard it.", createdAt: a.createdAt },
      { id: "reply", role: "user", content: "I enter the observatory.", createdAt: a.createdAt },
    ],
    components: [makeComponent({ id: "arc", type: "currentArc", title: "Current Arc", content: "The observatory opened." })],
    storyCards: [makeStoryCard({ id: "lore", type: "lore", title: "The Observatory", content: "The observatory stands on a hill.", keys: ["observatory"] })],
    brains: [makeBrain({ id: "mira", characterName: "Mira", currentState: "I will guard the observatory.", updateMode: "append" })],
    memoryAutoApprove: { storyCard: true, characterStoryCard: false, otherStoryCard: true, loreStoryCard: true, brainUpdate: true, currentArcUpdate: false, summaryUpdate: true },
    tokenBudgetSettings: { ...a.tokenBudgetSettings, autoSummarize: true, autoSummarizeEveryNTurns: 3, autoSceneStateEveryNTurns: 1,
      sceneStateEnabled: true, summaryEnabled: true, allowSystemToTruncateSummary: true,
      sectionBudgets: { ...a.tokenBudgetSettings.sectionBudgets, rollingSummary: 999, sceneState: 99, storyCards: 500 } },
    triggerRules: [{ ...makeTriggerRule({ name: "Legacy trigger" }), actions: [{ type: "updateSummary" }, { type: "pinStoryCard", storyCardId: "lore" }] }],
    activeState: {
      ...a.activeState, lastSceneStateTurn: 2,
      memoryProposals: [{ ...makeMemoryProposal({ id: "old-summary" }), proposedType: "summaryUpdate" }, makeMemoryProposal({ id: "valid-proposal", proposedType: "brainUpdate", targetId: "mira", content: "I keep my promise." })],
      pendingUpdates: [
        { id: "summary", source: "autoSummary", actions: [{ type: "UPDATE_ROLLING_SUMMARY", content: "obsolete" }] },
        { id: "scene", source: "autoSceneState", actions: [{ type: "UPDATE_SCENE_STATE", content: "obsolete" }, { type: "SET_LAST_SCENE_STATE_TURN", turn: 2 }] },
        { id: "mixed", source: "manual", actions: [{ type: "UPDATE_ROLLING_SUMMARY", content: "obsolete" }, { type: "UPDATE_MESSAGE", messageId: "reply", content: "I carefully enter the observatory." }, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...makeMemoryProposal(), proposedType: "summaryUpdate" } }] },
      ],
    },
  } as unknown as LegacyAdventureInput;
}

export const retiredKeys = /"(?:rollingSummary|sceneState|summaryUpdate|autoSummarize|autoSummarizeEveryNTurns|autoSceneStateEveryNTurns|sceneStateEnabled|summaryEnabled|allowSystemToTruncateSummary|lastSceneStateTurn|UPDATE_ROLLING_SUMMARY|UPDATE_SCENE_STATE|SET_LAST_SCENE_STATE_TURN|autoSummary|autoSceneState|updateSummary)"/;
