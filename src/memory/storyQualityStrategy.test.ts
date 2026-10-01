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
import { applyStoryStateLine, storyStateLineValue } from "./storyStateLines";

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

function passActions(adventure: Adventure, updates: unknown[], allowEvents = false) {
  const context = buildContext(adventure, {});
  const visibleIds = new Set(context.sections.flatMap((s) => s.items.map((i) => i.id)));
  visibleIds.add("state");
  return memoryUpdateActions(
    adventure,
    { visibleIds, eligibleThoughtTargets: ["Mira"], allowEvents },
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

const LABELED_STATE = [
  "Day/Time: Tuesday night.",
  "Location: the tower, alone.",
  "Relationships: Mira and the player are wary allies.",
  "Has met: Mira (scout); the ferryman (owed a favor)",
  "Open threads: the duke's riders; the missing seal",
].join("\n");

function labeledFixture(): Adventure {
  const adventure = fixture();
  adventure.components = adventure.components.map((c) => c.id === "state" ? { ...c, content: LABELED_STATE } : c);
  return adventure;
}

const EVIDENCE = "She now knows the duke plans to seize the tower tonight";

describe("targeted Story State edits", () => {
  it("changes one labeled line and leaves every other line byte-for-byte", () => {
    const next = applyStoryStateLine(LABELED_STATE, { label: "Location", op: "set" }, "the tower gate, with Mira.")!;
    expect(storyStateLineValue(next, "Location")).toBe("the tower gate, with Mira.");
    expect(next.split("\n").filter((line) => !line.startsWith("Location"))).toEqual(LABELED_STATE.split("\n").filter((line) => !line.startsWith("Location")));
  });

  it("adds and removes list items, inserts a missing line in order, and refuses unlabeled text", () => {
    // A legacy single-line list is rewritten as bullets with thread ids on its first edit.
    const added = applyStoryStateLine(LABELED_STATE, { label: "Open threads", op: "add" }, "the burned bridge")!;
    expect(storyStateLineValue(added, "Open threads")).toBe("- the duke's riders\n- the missing seal\n- [t1] the burned bridge");
    const removed = applyStoryStateLine(added, { label: "Open threads", op: "remove" }, "the missing seal")!;
    expect(storyStateLineValue(removed, "Open threads")).toBe("- the duke's riders\n- [t1] the burned bridge");
    expect(applyStoryStateLine(LABELED_STATE, { label: "Open threads", op: "remove" }, "a thread that never existed")).toBeUndefined();
    const inserted = applyStoryStateLine(LABELED_STATE, { label: "Arrangements", op: "set" }, "Mira sleeps in the spare room.")!;
    expect(inserted.split("\n").indexOf("Arrangements: Mira sleeps in the spare room.")).toBe(3);
    expect(applyStoryStateLine("Just some prose.", { label: "Location", op: "set" }, "x")).toBeUndefined();
  });

  it("drafts a line edit through Memory Suggestions and applies it to the current block", () => {
    let state = labeledFixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, storyStateUpdate: false };
    state = reduce(state, passActions(state, [
      { kind: "stateLine", target: "Location", op: "set", content: "the tower gate, with Mira.", evidence: EVIDENCE, reason: "moved" },
    ]));
    const draft = state.activeState.memoryProposals.find((p) => p.status === "pending")!;
    expect(draft).toMatchObject({ proposedType: "storyStateUpdate", title: "Story State · Location", stateLine: { label: "Location", op: "set" }, baseContent: "the tower, alone." });

    // The player edits a different line meanwhile; approval keeps that edit.
    state = reduce(state, [{ type: "UPDATE_COMPONENT", componentId: "state", patch: { content: LABELED_STATE.replace("Tuesday night.", "Tuesday, just before midnight.") } }]);
    expect(proposalTargetChanged(state, draft)).toBe(false);
    state = reduce(state, [{ type: "APPROVE_MEMORY_PROPOSAL", proposalId: draft.id }]);
    const content = state.components.find((c) => c.id === "state")!.content;
    expect(content).toContain("just before midnight");
    expect(content).toContain("Location: the tower gate, with Mira.");
  });

  it("auto-applies a line edit unless that same line was edited after drafting", () => {
    let state = labeledFixture();
    const actions = passActions(state, [{ kind: "stateLine", target: "Location", op: "set", content: "the cellar.", evidence: EVIDENCE, reason: "moved" }]);
    state = reduce(state, [{ type: "UPDATE_COMPONENT", componentId: "state", patch: { content: LABELED_STATE.replace("the tower, alone.", "the roof (player edit).") } }]);
    state = reduce(state, actions);
    expect(storyStateLineValue(state.components.find((c) => c.id === "state")!.content, "Location")).toBe("the roof (player edit).");
    expect(state.activeState.memoryProposals[0].status).toBe("pending");
  });

  it("keeps different lines side by side; a newer edit to one line or a full rewrite supersedes", () => {
    let state = labeledFixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, storyStateUpdate: false };
    state = reduce(state, passActions(state, [
      { kind: "stateLine", target: "Location", op: "set", content: "the gate.", evidence: EVIDENCE, reason: "a" },
      { kind: "stateLine", target: "Open threads", op: "add", content: "the burned bridge", evidence: EVIDENCE, reason: "b" },
      { kind: "stateLine", target: "Open threads", op: "remove", content: "the missing seal", evidence: EVIDENCE, reason: "c" },
    ]));
    expect(state.activeState.memoryProposals.filter((p) => p.status === "pending")).toHaveLength(3);
    state = reduce(state, passActions(state, [{ kind: "stateLine", target: "Location", op: "set", content: "the cellar.", evidence: EVIDENCE, reason: "d" }]));
    const location = state.activeState.memoryProposals.filter((p) => p.stateLine?.label === "Location");
    expect(location.map((p) => p.status).sort()).toEqual(["ignored", "pending"]);
    state = reduce(state, passActions(state, [{ kind: "state", target: "Story State", content: LABELED_STATE.replace("alone", "with Mira"), evidence: EVIDENCE, reason: "rewrite" }]));
    const pending = state.activeState.memoryProposals.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].stateLine).toBeUndefined();
  });

  it("rejects line edits when Story State has no labeled lines", () => {
    const state = fixture();
    state.components = state.components.map((c) => c.id === "state" ? { ...c, content: "Prose with no labels." } : c);
    const actions = passActions(state, [{ kind: "stateLine", target: "Location", content: "the gate.", evidence: EVIDENCE, reason: "x" }]);
    expect(actions.some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
  });
});

describe("automatic Event Memory suggestions", () => {
  const event = {
    kind: "event", target: "The tower warning", content: "The player warned Mira the duke was coming; she learned his plan to seize the tower, which turned their wary alliance into a shared defense.",
    evidence: EVIDENCE, reason: "turning point", eventKind: "revelation", participants: ["Mira"], recallCues: ["the tower", "the duke's riders"],
  };

  it("suggests at most one event per pass, always for review, linked to its source message", () => {
    let state = fixture();
    state = reduce(state, passActions(state, [event, { ...event, target: "Another event" }], true));
    const events = state.activeState.memoryProposals.filter((p) => p.storyCardType === "event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "pending", requiresReview: true, memoryMode: "historical", eventMemory: { kind: "revelation", participants: ["Mira"], sourceMessageIds: ["message_2"] } });
    expect(state.storyCards.some((card) => card.type === "event")).toBe(false);
  });

  it("rejects absent participants and generic cues, and stays off when disabled", () => {
    const state = fixture();
    const has = (actions: AdventureAction[]) => actions.some((a) => a.type === "ADD_MEMORY_PROPOSAL");
    expect(has(passActions(state, [{ ...event, participants: ["Captain Orlo"] }], true))).toBe(false);
    expect(has(passActions(state, [{ ...event, recallCues: ["remember when"] }], true))).toBe(false);
    expect(has(passActions(state, [event], false))).toBe(false);
  });
});

describe("minimum recent dialogue", () => {
  function crowded(minRecentMessages: number): Adventure {
    const adventure = fixture();
    adventure.storyCards.push(makeStoryCard({ id: "lore", title: "Old Lore", content: "lore ".repeat(150), keys: ["tower"], active: true, priority: 10 }));
    adventure.messages = Array.from({ length: 8 }, (_, i) => ({ id: `message_${i}`, role: i % 2 ? "assistant" : "user", content: `tower turn ${i} `.repeat(20), createdAt: "2026-01-01T00:00:00.000Z" })) as Adventure["messages"];
    adventure.tokenBudgetSettings = { ...adventure.tokenBudgetSettings, maxContextTokens: 1760, maxRecentMessages: 8, recentMessageWindow: 8, minRecentMessages };
    return adventure;
  }

  it("keeps the newest N messages ahead of unprotected memory", () => {
    const result = buildContext(crowded(6), {});
    const recent = result.sections.find((s) => s.id === "recentMessages")!.items.map((i) => i.id);
    expect(recent).toEqual(expect.arrayContaining(["message_7", "message_6", "message_5", "message_4", "message_3", "message_2"]));
    expect(result.excludedItems.some((e) => e.id === "lore" && e.reason === "budget_exceeded")).toBe(true);

    const legacy = buildContext(crowded(0), {});
    expect(legacy.excludedItems.some((e) => e.id === "lore")).toBe(false);
  });

  it("never drops protected context for the floor, and logs when the floor cannot fit", () => {
    const adventure = crowded(6);
    adventure.tokenBudgetSettings = { ...adventure.tokenBudgetSettings, maxContextTokens: 1 };
    const result = buildContext(adventure, {});
    expect(result.sections.find((s) => s.id === "system")!.items.length).toBeGreaterThan(0);
    expect(result.decisions.some((d) => d.itemId === "recent-dialogue-floor" && d.action === "truncated")).toBe(true);
  });
});

describe("cache-friendly layout", () => {
  function arcAdventure(): Adventure {
    const adventure = fixture();
    adventure.components.push(
      makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "The duke's riders close in.", active: true }),
      makeComponent({ id: "arc", title: "Arc", type: "currentArc", content: "Mira learned of the plan.", active: true, arcPremise: "The duke's coup", arcThreadKeys: ["mira-card"], arcSimmerInstruction: "Glimpses of riders.", arcBreakInstruction: "The coup costs the tower.", arcState: { phase: "simmer", tier: 0, threadEngagement: {}, pendingBreak: false } }),
    );
    return adventure;
  }

  it("sends Active Pressure, the arc log, and pinned living cards per turn, keeping the prefix stable", () => {
    const adventure = arcAdventure();
    const result = buildContext(adventure, { currentInput: "I wait." });
    const [system] = result.messages;
    const turn = result.messages.at(-1)!.content;
    expect(system.content).toContain("The duke's coup");
    expect(system.content).toContain("Glimpses of riders.");
    for (const perTurn of ["The duke's riders close in.", "Mira learned of the plan.", "Mira lives alone in the tower."]) {
      expect(system.content).not.toContain(perTurn);
      expect(turn).toContain(perTurn);
    }

    const changed = { ...adventure, components: adventure.components.map((c) => c.id === "pressure" ? { ...c, content: "The riders have turned back." } : c.id === "arc" ? { ...c, content: `${c.content}\n\nThe gate was barred.` } : c) };
    expect(buildContext(changed, { currentInput: "I wait." }).messages[0].content).toBe(system.content);
  });

  it("still withholds the break instruction until the break phase", () => {
    const adventure = arcAdventure();
    const payload = buildContext(adventure, {}).messages.map((m) => m.content).join("\n");
    expect(payload).not.toContain("The coup costs the tower.");
    adventure.components = adventure.components.map((c) => c.id === "arc" ? { ...c, arcState: { ...c.arcState!, phase: "break" } } : c);
    expect(buildContext(adventure, {}).messages[0].content).toContain("The coup costs the tower.");
  });
});