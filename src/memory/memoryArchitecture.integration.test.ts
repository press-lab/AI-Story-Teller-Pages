import { describe, expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { makeBrain } from "../state/defaults";
import { goldenAdventure, makeMemoryProposal } from "../test/goldenAdventure";
import { triggerActionToAdventureActions } from "../triggers/triggerEngine";
import type { Adventure, MemoryProposal } from "../types/adventure";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import { classifyMemory } from "./classificationPolicy";

function reduceAll(adventure: Adventure, actions: Parameters<typeof adventureReducer>[1][]): Adventure {
  return actions.reduce((state, action) => adventureReducer(state, action), adventure);
}

describe("memory architecture smoke path", () => {
  it("keeps proposals out of active context until approved, then routes approved memory safely", () => {
    let adventure: Adventure = {
      ...goldenAdventure(),
      storyCards: [],
      brains: [makeBrain({ id: "brain-margo", characterName: "Margo", triggers: ["Margo"], currentState: "guarded" })],
    };

    const turnOneClassification = classifyMemory("Margo calls Seth 'hedge prince' as a private joke");
    const proposal: MemoryProposal = makeMemoryProposal({
      id: "proposal-1",
      proposedType: turnOneClassification.proposedType,
      title: turnOneClassification.title,
      content: "Margo's private nickname for Seth is 'hedge prince'.",
      suggestedTriggers: turnOneClassification.suggestedTriggers,
      confidence: turnOneClassification.confidence,
      rationale: turnOneClassification.rationale,
    });
    adventure = adventureReducer(adventure, { type: "ADD_MEMORY_PROPOSAL", proposal });
    expect(adventure.activeState.memoryProposals[0].status).toBe("pending");
    expect(buildContext(adventure, { currentInput: "hedge prince" }).sections.find((section) => section.id === "storyCards")?.items).toEqual([]);

    adventure = adventureReducer(adventure, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "proposal-1" });
    expect(adventure.activeState.memoryProposals[0].status).toBe("approved");
    expect(adventure.storyCards).toHaveLength(1);
    expect(buildContext(adventure, { currentInput: "Seth hears Margo say hedge prince." }).sections.find((section) => section.id === "storyCards")?.items[0].title).toBe("Margo");

    const brainUpdate = applyAIMemoryUpdate(adventure, [
      {
        type: "brainPatch",
        brainId: "brain-margo",
        patch: { thoughts: { jealousy_hidden: "3 → Margo feels jealous but hides it." } },
        mode: "replace",
        turn: 3,
      },
    ]);
    adventure = reduceAll(adventure, brainUpdate.actions);
    const brainSection = buildContext(adventure, { currentInput: "Margo watches Seth." }).sections.find((section) => section.id === "brains");
    expect(brainSection?.content).toContain("Margo feels jealous but hides it.");

    const roomLayout = classifyMemory("The couch is against the west wall");
    const ignoredProposal = makeMemoryProposal({
      id: "proposal-room",
      proposedType: roomLayout.proposedType,
      title: roomLayout.title,
      content: roomLayout.content,
      status: "ignored",
    });
    adventure = adventureReducer(adventure, { type: "ADD_MEMORY_PROPOSAL", proposal: ignoredProposal });
    expect(adventure.storyCards.some((card) => card.content.includes("couch"))).toBe(false);

  });
});
