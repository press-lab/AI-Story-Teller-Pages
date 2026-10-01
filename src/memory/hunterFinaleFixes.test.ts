import { describe, expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { applyProviderResponse } from "../state/turnPipeline";
import type { Adventure, AdventureAction } from "../types/adventure";
import { memoryHealthIssues } from "./memoryHealth";
import { makeStoryThread } from "./storyThreads";
import { memoryUpdateActions } from "./onePassMemory";
import { applyStoryStateLine, MAX_OPEN_THREADS, normalizeStoryState, openThreads, storyStateLineValue, stripStoryStateIds, tryStoryStateLine } from "./storyStateLines";

/** Acceptance cases from docs/hunter-finale-quality-review.md. */

const reduce = (state: Adventure, actions: AdventureAction[]) => actions.reduce(adventureReducer, state);

const STORY = "Marcus spits blood. Ivy is already dead on the warehouse floor. Edythe pins Marcus while Seth holds the door.";
const LENDER_FACT = "Marcus admitted they owe a debt to a lender who funds the surveillance.";

function fixture(): Adventure {
  const adventure = createDefaultAdventure("Hunter finale");
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, storyCard: true, brainUpdate: true, storyStateUpdate: true };
  adventure.storyCards = [
    makeStoryCard({ id: "marcus", title: "Marcus", content: `Marcus is a hunter who tracked Seth for weeks. ${LENDER_FACT} He keeps a revolver.`, active: true, memoryMode: "static", pinned: true }),
  ];
  adventure.brains = [makeBrain({ id: "edythe", characterName: "Edythe", active: true, knowledge: "Knows: Seth is human.\nDoes not know: why Marcus and Ivy watch Seth." })];
  adventure.components = [
    makeComponent({ id: "state", title: "Story State", type: "storyState", content: "Location: the warehouse.\nOpen threads: none", active: true, alwaysOn: true, protected: true, inclusionPolicy: "always", autoUpdate: true }),
  ];
  adventure.messages = [
    { id: "message_1", role: "assistant", content: STORY, createdAt: "2026-01-01T00:00:00.000Z" },
  ] as Adventure["messages"];
  return adventure;
}

function pass(adventure: Adventure, updates: unknown[], extraEvidence: Array<{ id: string; content: string }> = []) {
  const context = buildContext(adventure, {});
  const visibleIds = new Set(context.sections.flatMap((s) => s.items.map((i) => i.id)));
  visibleIds.add("state");
  return memoryUpdateActions(adventure, { visibleIds, eligibleThoughtTargets: adventure.brains.map((b) => b.characterName) }, updates,
    [...adventure.messages.map((m) => ({ id: m.id, content: m.content })), ...extraEvidence], "message_1", "Background memory pass: one API call");
}

describe("open threads", () => {
  it("adds and removes an item that contains a semicolon, and drops the 'none' sentinel", () => {
    const start = "Open threads: none";
    const added = applyStoryStateLine(start, { label: "Open threads", op: "add" }, "Edythe goes first; Seth waits in the car")!;
    expect(openThreads(added)).toEqual([{ id: 1, text: "Edythe goes first; Seth waits in the car" }]);
    expect(applyStoryStateLine(added, { label: "Open threads", op: "remove" }, "Edythe goes first; Seth waits in the car")).toBe("Open threads: none");
    expect(applyStoryStateLine(added, { label: "Open threads", op: "remove" }, "t1")).toBe("Open threads: none");
  });

  it("removes one thread without touching its neighbours, and caps live threads", () => {
    let content = "Location: the hall.\nOpen threads: none";
    for (const thread of ["the courier", "the blood results", "the office plan"]) content = applyStoryStateLine(content, { label: "Open threads", op: "add" }, thread)!;
    content = applyStoryStateLine(content, { label: "Open threads", op: "remove" }, "t2")!;
    expect(openThreads(content).map((t) => t.text)).toEqual(["the courier", "the office plan"]);
    expect(storyStateLineValue(content, "Location")).toBe("the hall.");
    for (let i = openThreads(content).length; i < MAX_OPEN_THREADS; i++) content = applyStoryStateLine(content, { label: "Open threads", op: "add" }, `thread ${i}`)!;
    expect(tryStoryStateLine(content, { label: "Open threads", op: "add" }, "one too many")).toMatchObject({ error: expect.stringContaining("resolve one first") });
  });

  it("hides thread ids from the narrator but keeps them for the memory pass", () => {
    const adventure = fixture();
    adventure.components[0].content = normalizeStoryState("Location: the hall.\nOpen threads: the courier; the blood results");
    expect(adventure.components[0].content).toContain("[t1] the courier");
    const payload = buildContext(adventure, {}).messages.map((m) => m.content).join("\n");
    expect(payload).toContain("- the courier");
    expect(payload).not.toContain("[t1]");
    expect(stripStoryStateIds(adventure.components[0].content)).not.toContain("[t");
  });
});

describe("bounded Story State", () => {
  function oversized(): Adventure {
    const adventure = fixture();
    adventure.components[0].content = `Location: the warehouse.\nRelationships: ${"history ".repeat(450)}\nHas met: Marcus; Ivy`;
    adventure.storyThreads = [makeStoryThread([], "the courier waits", 1), { ...makeStoryThread([], "Marcus is pinned", 1), id: "t2" }];
    return adventure;
  }

  it("refuses line edits that grow an over-long block, but welcomes removals", () => {
    const adventure = oversized();
    const grow = pass(adventure, [{ kind: "stateLine", target: "Has met", op: "add", content: "a brand new acquaintance", evidence: "Edythe pins Marcus while Seth holds the door", reason: "x" }]);
    expect(grow.some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
    const shrink = pass(adventure, [{ kind: "stateLine", target: "Has met", op: "remove", content: "Ivy", evidence: "Ivy is already dead on the warehouse floor", reason: "done" }]);
    expect(shrink.some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(true);
  });

  it("holds a consolidating rewrite of an over-long block for review, and keeps threads out of the text", () => {
    let state = oversized();
    const consolidated = "Location: the warehouse.\nRelationships: Seth and Edythe are together.\nOpen threads:\n- the blood results";
    state = reduce(state, pass(state, [{ kind: "state", target: "Story State", content: consolidated, evidence: "Edythe pins Marcus while Seth holds the door", reason: "consolidate" }]));
    const proposal = state.activeState.memoryProposals.find((p) => p.proposedType === "storyStateUpdate")!;
    expect(proposal).toMatchObject({ status: "pending", requiresReview: true });
    expect(state.components[0].content).toContain("history history");

    expect(proposal.content).not.toContain("Open threads");
    expect(proposal.content).not.toContain("blood results");
  });
});

describe("author corrections", () => {
  function corrected(): Adventure {
    let state = fixture();
    state = reduce(state, [{ type: "ADD_MESSAGE", role: "user", content: "There is no lender and no higher villain. Marcus and Ivy were working alone.", inputMode: "comms", id: "message_2" }]);
    return state;
  }

  it("records an out-of-character message as a correction the narrator sees", () => {
    const state = corrected();
    expect(state.activeState.corrections).toHaveLength(1);
    expect(state.activeState.corrections![0]).toMatchObject({ source: "outOfCharacter", status: "active", messageId: "message_2" });
    const turn = buildContext(state, { currentInput: "I check Marcus's pockets." }).messages.at(-1)!.content;
    expect(turn).toContain("N. Author Corrections");
    expect(turn).toContain("There is no lender");
  });

  it("retracts the rejected fact from a static card, even a guarded one, and it does not come back", () => {
    let state = corrected();
    state.storyCards[0].archivedFacts = LENDER_FACT;
    const correction = state.activeState.corrections![0];
    state = reduce(state, pass(state, [
      { kind: "retract", target: "Marcus", content: LENDER_FACT, evidence: "There is no lender and no higher villain", reason: "author rejected the lender", claim: "correction" },
    ], [{ id: `correction:${correction.id}`, content: correction.text }]));
    const card = state.storyCards.find((c) => c.id === "marcus")!;
    expect(card.content).not.toContain("lender");
    expect(card.content).toContain("tracked Seth for weeks");
    expect(card.content).toContain("revolver");
    expect(card.archivedFacts ?? "").not.toContain("lender");
    // A later unrelated update to the card does not resurrect the fact.
    state = reduce(state, pass(state, [{ kind: "card", target: "Marcus", content: "Marcus died in the warehouse.", evidence: "Edythe pins Marcus while Seth holds the door", reason: "death" }]));
    expect(state.storyCards.find((c) => c.id === "marcus")!.content).not.toContain("lender");
  });

  it("allows superseding a static card fact only with correction evidence", () => {
    const state = corrected();
    const correction = state.activeState.corrections![0];
    const update = { kind: "card", target: "Marcus", content: "Marcus and Ivy worked alone.", replaces: LENDER_FACT, evidence: "There is no lender and no higher villain", reason: "correction" };
    expect(pass(state, [update]).some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
    expect(pass(state, [update], [{ id: `correction:${correction.id}`, content: correction.text }]).some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(true);
  });

  it("turns an edit to a message with applied memory into a correction", () => {
    let state = fixture();
    state = reduce(state, pass(state, [{ kind: "card", target: "Marcus", content: "Ivy died on the warehouse floor.", evidence: "Ivy is already dead on the warehouse floor", reason: "death" }]));
    expect(state.activeState.memoryProposals.some((p) => p.status === "approved" && p.sourceTurnId === "message_1")).toBe(true);
    state = reduce(state, [{ type: "UPDATE_MESSAGE", messageId: "message_1", content: "Marcus spits blood. Ivy runs." }]);
    expect(state.activeState.corrections?.[0]).toMatchObject({ source: "messageEdited", status: "active" });
    expect(state.activeState.corrections?.[0].text).toContain("Ivy died on the warehouse floor");
  });

  it("retires a correction once a memory pass has read it and a few turns have passed", () => {
    let state = corrected();
    const id = state.activeState.corrections![0].id;
    state = reduce(state, [{ type: "MARK_CORRECTIONS_SEEN", correctionIds: [id] }]);
    expect(state.activeState.corrections![0]).toMatchObject({ seenByPass: true, status: "active" });
    state = reduce(state, [{ type: "INCREMENT_TURN" }, { type: "INCREMENT_TURN" }, { type: "INCREMENT_TURN" }]);
    expect(state.activeState.corrections![0].status).toBe("reconciled");
    expect(buildContext(state, {}).sections.find((s) => s.id === "corrections")!.items).toHaveLength(0);
  });
});

describe("knowledge and pass load", () => {
  it("accepts a fuller knowledge boundary and caps thoughts per pass", () => {
    const adventure = fixture();
    adventure.brains.push(makeBrain({ id: "ivy", characterName: "Ivy", active: true }), makeBrain({ id: "marcus-brain", characterName: "Marcus", active: true }));
    const knows = `Knows: ${"Marcus and Ivy ran the surveillance and admitted it in the warehouse ".repeat(8)}\nDoes not know: what Seth thought while unconscious.`;
    const actions = pass(adventure, [
      { kind: "knows", target: "Edythe", content: knows, evidence: "Edythe pins Marcus while Seth holds the door", reason: "witnessed" },
      { kind: "thought", target: "Edythe", content: "I will not let him take Seth.", evidence: "Edythe pins Marcus while Seth holds the door", reason: "a" },
      { kind: "thought", target: "Marcus", content: "This is not how it was supposed to end.", evidence: "Marcus spits blood", reason: "b" },
      { kind: "thought", target: "Ivy", content: "I should have run.", evidence: "Ivy is already dead on the warehouse floor", reason: "c" },
    ]);
    const log = actions.find((a) => a.type === "LOG_EVALUATION_RESULT");
    expect(log?.type === "LOG_EVALUATION_RESULT" && log.entry.actionsExecuted).toEqual(expect.arrayContaining(["Knowledge: Edythe", "Thought: Edythe", "Thought: Marcus"]));
    expect(log?.type === "LOG_EVALUATION_RESULT" && log.entry.errors.join(" ")).toContain("more than 2 thoughts");
  });

  it("says when a block's AI updates are switched off instead of a vague rejection", () => {
    const adventure = fixture();
    adventure.components.push(makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "Hunters close in.", active: true, autoUpdate: false }));
    const actions = pass(adventure, [{ kind: "pressure", target: "Active Pressure", content: "The hunters are dead.", evidence: "Ivy is already dead on the warehouse floor", reason: "resolved" }]);
    const log = actions.find((a) => a.type === "LOG_EVALUATION_RESULT");
    expect(log?.type === "LOG_EVALUATION_RESULT" && log.entry.errors.join(" ")).toContain("switched off for this block (disabled by you)");
  });
});

describe("memory health", () => {
  it("explains the conditions found in the Hunter Finale save without changing anything", () => {
    const adventure = fixture();
    adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true, everyNTurns: 1 };
    adventure.storyThreads = Array.from({ length: 12 }, (_, i) => ({ ...makeStoryThread([], `thread ${i}`, 1), id: `t${i + 1}` }));
    adventure.components.push(
      makeComponent({ id: "arc", title: "Arc", type: "currentArc", content: "", active: true, autoUpdate: false, arcState: { phase: "break", tier: 5, threadEngagement: {}, pendingBreak: false } }),
      makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "Confront the hunters.", active: true, autoUpdate: false }),
    );
    adventure.storyCards = Array.from({ length: 10 }, (_, i) => makeStoryCard({ id: `c${i}`, title: `Card ${i}`, content: "x", active: true, memoryMode: "static" }));
    adventure.activeState.evaluationLog = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, turn: i, createdAt: "", conditionsEvaluated: [], conditionsFired: [], actionsExecuted: [], generatedContent: [], errors: ["Memory pass skipped: Open threads: item to remove is not on the line"] }));
    const before = JSON.stringify(adventure);
    const ids = memoryHealthIssues(adventure).map((issue) => issue.id);
    expect(ids).toEqual(expect.arrayContaining(["story-state-size", "arc-updates-off", "pressure-frozen", "no-living-cards", "memory-every-turn", "rejections:item to remove is not on the line"]));
    expect(JSON.stringify(adventure)).toBe(before);
  });
});

describe("narration repairs", () => {
  it("logs why a draft was rewritten", async () => {
    const adventure = fixture();
    const context = buildContext(adventure, {});
    const { adventure: next } = await applyProviderResponse({
      adventure, response: { content: "Edythe crosses the room.", repairNotes: ["visible response is 300 words over the 250-word limit"] }, mode: "story", preProviderContext: context,
    });
    const entry = next.activeState.evaluationLog.at(-1)!;
    expect(entry.actionsExecuted).toEqual(["Narration rewritten: visible response is 300 words over the 250-word limit"]);
  });
});
