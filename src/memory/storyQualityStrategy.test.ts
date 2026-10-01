import { describe, expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer, proposalTargetChanged } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { evaluateStoryResponseGuard } from "../state/storyResponseGuard";
import { currentTurnThreadIds } from "../state/turnPipeline";
import { continuityCanon } from "../continuityLint";
import type { Adventure, AdventureAction, MemoryProposal } from "../types/adventure";
import { memoryPassConfig, memoryPassCoverage, MEMORY_PASS_MAX_MESSAGES } from "./compactMemoryFallback";
import { memoryUpdateActions, MEMORY_OUTPUT_RESERVE } from "./onePassMemory";

/**
 * Behavior from docs/story-quality-continuity-strategy.md: information-integrity fixes for the
 * background memory pass, stale-write protection, provenance, agency, continuity, and arc pacing.
 */

function fixture(): Adventure {
  const adventure = createDefaultAdventure("Story quality strategy");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true };
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, storyCard: true, brainUpdate: true, storyStateUpdate: true };
  adventure.brains = [makeBrain({ id: "mira-brain", characterName: "Mira", active: true, knowledge: "Knows: the pass is guarded.\nDoes not know: the duke's plan." })];
  adventure.storyCards = [makeStoryCard({ id: "mira-card", title: "Mira", content: "- Mira is a scout.\n- Mira lives alone in the tower.", active: true, memoryMode: "living", pinned: true })];
  adventure.components = [
    makeComponent({ id: "state", title: "Story State", type: "storyState", content: "Location: the tower.", active: true, alwaysOn: true, protected: true, inclusionPolicy: "always", autoUpdate: true }),
  ];
  adventure.messages = [
    { id: "message_1", role: "user", content: "I tell Mira the duke is coming.", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "message_2", role: "assistant", content: "Mira swears under her breath. She now knows the duke plans to seize the tower tonight.", createdAt: "2026-01-01T00:00:01.000Z" },
  ] as Adventure["messages"];
  return adventure;
}

const reduce = (state: Adventure, actions: AdventureAction[]) => actions.reduce(adventureReducer, state);

function passActions(adventure: Adventure, updates: unknown[]) {
  const context = buildContext(adventure, {});
  const visibleIds = new Set(context.sections.flatMap((s) => s.items.map((i) => i.id)));
  visibleIds.add("state");
  return memoryUpdateActions(
    adventure,
    { visibleIds, eligibleThoughtTargets: ["Mira"] },
    updates,
    adventure.messages.map((m) => ({ id: m.id, content: m.content })),
    "message_2",
    "Background memory pass: one API call",
  );
}

function proposal(patch: Partial<MemoryProposal>): MemoryProposal {
  return {
    id: patch.id ?? "p", sourceTurnId: "turn-1", sourceText: "evidence text here", proposedType: "storyStateUpdate", title: "Story State",
    content: "Location: the gate.", suggestedTriggers: [], confidence: 0.75, rationale: "Memory pass", status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...patch,
  };
}

describe("memory pass coverage", () => {
  it("re-reads every unprocessed message after a failed pass, and reports what no longer fits", () => {
    const adventure = fixture();
    adventure.messages = Array.from({ length: 80 }, (_, i) => ({ id: `message_${i}`, role: i % 2 ? "assistant" : "user", content: `turn ${i}`, createdAt: "2026-01-01T00:00:00.000Z" })) as Adventure["messages"];
    adventure.activeState.lastMemoryPassMessageId = "message_70";
    expect(memoryPassCoverage(adventure)).toMatchObject({ uncoveredMessages: 0 });
    expect(memoryPassCoverage(adventure).window[0].id).toBe("message_69");

    adventure.activeState.lastMemoryPassMessageId = "message_5";
    const coverage = memoryPassCoverage(adventure);
    expect(coverage.window).toHaveLength(MEMORY_PASS_MAX_MESSAGES);
    expect(coverage.uncoveredMessages).toBe(74 - MEMORY_PASS_MAX_MESSAGES);
  });

  it("uses a bookkeeping profile instead of the narrator's sampling settings", () => {
    const config = memoryPassConfig({ name: "x", baseUrl: "https://x", model: "m", temperature: 1.1, maxOutputTokens: 1200, presencePenalty: 0.8, frequencyPenalty: 0.4 });
    expect(config).toMatchObject({ temperature: 0.3, presencePenalty: 0, frequencyPenalty: 0, maxOutputTokens: MEMORY_OUTPUT_RESERVE });
  });
});

describe("memory pass provenance and claims", () => {
  it("links each update to the message containing its evidence and records the claim type", () => {
    const actions = passActions(fixture(), [
      { kind: "card", target: "Mira", content: "Mira swore when told the duke was coming.", evidence: "I tell Mira the duke is coming", reason: "reaction", claim: "fact" },
    ]);
    const added = actions.find((a) => a.type === "ADD_MEMORY_PROPOSAL");
    expect(added?.type === "ADD_MEMORY_PROPOSAL" && added.proposal.sourceTurnId).toBe("message_1");
    expect(added?.type === "ADD_MEMORY_PROPOSAL" && added.proposal.claim).toBe("fact");
  });

  it("retires pending drafts whose source message is erased, and drops late results from removed messages", () => {
    let state = fixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, storyStateUpdate: false };
    state = reduce(state, [{ type: "ADD_MEMORY_PROPOSAL", proposal: proposal({ id: "a", sourceTurnId: "message_2", baseContent: "Location: the tower." }) }]);
    expect(state.activeState.memoryProposals[0].status).toBe("pending");
    state = reduce(state, [{ type: "REMOVE_LAST_ASSISTANT_MESSAGE" }]);
    expect(state.activeState.memoryProposals[0].status).toBe("ignored");
    state = reduce(state, [{ type: "ADD_MEMORY_PROPOSAL", proposal: proposal({ id: "late", sourceTurnId: "message_2", content: "Location: the cellar." }) }]);
    expect(state.activeState.memoryProposals.some((p) => p.id === "late")).toBe(false);
  });
});

describe("pending drafts", () => {
  it("keeps thought and knowledge drafts for one Brain side by side", () => {
    let state = fixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, brainUpdate: false };
    state = reduce(state, passActions(state, [
      { kind: "thought", target: "Mira", content: "If the duke takes the tower, I lose everything.", evidence: "She now knows the duke plans to seize the tower tonight", reason: "fear", claim: "belief" },
      { kind: "knows", target: "Mira", content: "Knows: the duke plans to seize the tower tonight.\nDoes not know: who told the duke.", evidence: "She now knows the duke plans to seize the tower tonight", reason: "new knowledge" },
    ]));
    const pending = state.activeState.memoryProposals.filter((p) => p.status === "pending" && p.proposedType === "brainUpdate");
    expect(pending).toHaveLength(2);
  });

  it("keeps distinct pending additions to one card, and a newer replacement supersedes the older one", () => {
    let state = fixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, storyCard: false, storyStateUpdate: false };
    const append = (id: string, content: string) => proposal({ id, proposedType: "storyCard", title: "Mira", targetId: "mira-card", appendContent: true, content });
    state = reduce(state, [
      { type: "ADD_MEMORY_PROPOSAL", proposal: append("c1", "Mira is afraid of deep water since the flood.") },
      { type: "ADD_MEMORY_PROPOSAL", proposal: append("c2", "Mira owes the ferryman a favor for her rescue.") },
      { type: "ADD_MEMORY_PROPOSAL", proposal: append("c3", "Mira is afraid of deep water since the flood.") },
      { type: "ADD_MEMORY_PROPOSAL", proposal: proposal({ id: "s1", content: "Location: the gate." }) },
      { type: "ADD_MEMORY_PROPOSAL", proposal: proposal({ id: "s2", content: "Location: the gate, with Mira." }) },
    ]);
    const byId = Object.fromEntries(state.activeState.memoryProposals.map((p) => [p.id, p.status]));
    expect(byId).toMatchObject({ c1: "pending", c2: "pending", s1: "ignored", s2: "pending" });
    expect(byId.c3).toBeUndefined();
  });
});

describe("stale writes", () => {
  it("holds an auto-approved replacement for review when its target was edited after drafting", () => {
    let state = fixture();
    state = reduce(state, [{ type: "UPDATE_COMPONENT", componentId: "state", patch: { content: "Location: the tower roof (edited by the player)." } }]);
    const stale = proposal({ id: "stale", targetId: "state", baseContent: "Location: the tower." });
    expect(proposalTargetChanged(state, stale)).toBe(true);
    state = reduce(state, [{ type: "ADD_MEMORY_PROPOSAL", proposal: stale }]);
    expect(state.components.find((c) => c.id === "state")?.content).toContain("edited by the player");
    expect(state.activeState.memoryProposals[0]).toMatchObject({ id: "stale", status: "pending" });

    const fresh = proposal({ id: "fresh", targetId: "state", content: "Location: the roof.", baseContent: "Location: the tower roof (edited by the player)." });
    state = reduce(state, [{ type: "ADD_MEMORY_PROPOSAL", proposal: fresh }]);
    expect(state.components.find((c) => c.id === "state")?.content).toBe("Location: the roof.");
  });

  it("re-applies a fact supersession to the card as it is now, keeping later edits", () => {
    let state = fixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, storyCard: false };
    state = reduce(state, passActions(state, [
      { kind: "card", target: "Mira", content: "Mira now shares the tower with the player.", replaces: "Mira lives alone in the tower.", evidence: "She now knows the duke plans to seize the tower tonight", reason: "arrangement" },
    ]));
    const draft = state.activeState.memoryProposals.find((p) => p.status === "pending")!;
    expect(draft.supersedes).toBeDefined();
    state = reduce(state, [{ type: "UPDATE_STORY_CARD", storyCardId: "mira-card", patch: { content: "- Mira is a scout and a cartographer.\n- Mira lives alone in the tower." } }]);
    state = reduce(state, [{ type: "APPROVE_MEMORY_PROPOSAL", proposalId: draft.id }]);
    const card = state.storyCards.find((c) => c.id === "mira-card")!;
    expect(card.content).toContain("cartographer");
    expect(card.content).toContain("shares the tower");
    expect(card.content).not.toContain("lives alone");
  });
});

describe("narration repairs", () => {
  it("accepts first-person player actions as authorizing the matching narration", () => {
    expect(evaluateStoryResponseGuard("You follow her down the stairs.", 250, "I follow her.").playerAgencyViolation).toBe(false);
    expect(evaluateStoryResponseGuard("You follow her down the stairs.", 250, "I wait.").playerAgencyViolation).toBe(true);
  });

  it("gives the continuity checker established canon, not just recent messages", () => {
    const adventure = fixture();
    const canon = continuityCanon(buildContext(adventure, {}));
    expect(canon).toContain("Location: the tower.");
    expect(canon).toContain("Mira is a scout");
  });
});

describe("arc engagement", () => {
  it("counts only threads in this turn's text, and one character's card and Brain once", () => {
    const adventure = fixture();
    adventure.storyCards.push(makeStoryCard({ id: "duke-card", title: "Duke Halvar", content: "Rules the valley.", keys: ["the duke"], active: true }));
    adventure.brains.push(makeBrain({ id: "duke-brain", characterName: "Duke Halvar", triggers: ["the duke"], active: true }));
    adventure.components.push(makeComponent({ id: "arc", title: "Arc", type: "currentArc", content: "", active: true, arcThreadKeys: ["duke-card", "duke-brain", "mira-brain"] }));
    expect(currentTurnThreadIds(adventure, "The duke's riders reach the gate.")).toEqual(["duke-card"]);
    expect(currentTurnThreadIds(adventure, "Rain falls on the empty road.")).toEqual([]);
  });
});
