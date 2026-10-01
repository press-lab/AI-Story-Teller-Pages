import { describe, expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, normalizeAdventure } from "../state/defaults";
import type { Adventure, AdventureAction } from "../types/adventure";
import { memoryUpdateActions } from "./onePassMemory";
import { makeStoryThread, MAX_OPEN_THREADS, openStoryThreads } from "./storyThreads";

const reduce = (state: Adventure, actions: AdventureAction[]) => actions.reduce(adventureReducer, state);
const STORY = "Carine checks the vials again. The blood results are still not back. Edythe asks Carine to call the courier off.";
const EVIDENCE = "Edythe asks Carine to call the courier off";

function fixture(): Adventure {
  const adventure = createDefaultAdventure("Threads");
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, storyStateUpdate: true };
  adventure.brains = [makeBrain({ id: "edythe", characterName: "Edythe", active: true })];
  const state = adventure.components.find((c) => c.type === "storyState")!;
  state.content = "Location: the Cullen house.";
  adventure.storyThreads = [];
  for (const text of ["the courier waits in the lobby", "Carine's blood results are pending", "Marcus is pinned under Seth"]) {
    adventure.storyThreads.push(makeStoryThread(adventure.storyThreads, text, 1));
  }
  adventure.messages = [{ id: "message_1", role: "assistant", content: STORY, createdAt: "2026-01-01T00:00:00.000Z" }] as Adventure["messages"];
  return adventure;
}

function pass(adventure: Adventure, updates: unknown[]) {
  return memoryUpdateActions(adventure, { visibleIds: new Set(), eligibleThoughtTargets: ["Edythe"] }, updates,
    adventure.messages.map((m) => ({ id: m.id, content: m.content })), "message_1", "Background memory pass: one API call");
}

describe("open threads as data", () => {
  it("moves a legacy Open threads line out of Story State text once, keeping ids and semicolon items", () => {
    const legacy = createDefaultAdventure("Old save");
    delete (legacy as Partial<Adventure>).storyThreads;
    legacy.components.find((c) => c.type === "storyState")!.content = "Location: the hall.\nOpen threads:\n- [t4] Edythe goes first; Seth waits in the car\n- the blood results\nHas met: Carine";
    const migrated = normalizeAdventure(legacy);
    expect(migrated.storyThreads.map((t) => [t.id, t.text])).toEqual([["t4", "Edythe goes first; Seth waits in the car"], ["t5", "the blood results"]]);
    expect(migrated.components.find((c) => c.type === "storyState")!.content).toBe("Location: the hall.\nHas met: Carine");
    expect(normalizeAdventure(migrated).storyThreads).toEqual(migrated.storyThreads);

    const oneLine = createDefaultAdventure("Older save");
    delete (oneLine as Partial<Adventure>).storyThreads;
    oneLine.components.find((c) => c.type === "storyState")!.content = "Open threads: the courier.; the office plan";
    expect(normalizeAdventure(oneLine).storyThreads.map((t) => t.text)).toEqual(["the courier.", "the office plan"]);
  });

  it("shows the narrator plain bullets and the memory pass the ids", () => {
    const adventure = fixture();
    const stateItem = buildContext(adventure, {}).sections.find((s) => s.id === "storyState")!.items[0];
    expect(stateItem.content).toContain("Open threads:\n- the courier waits in the lobby");
    expect(stateItem.content).not.toContain("[t1]");
  });

  it("adds, rewords, and resolves threads by id through Memory Suggestions", () => {
    let state = fixture();
    state = reduce(state, pass(state, [
      { kind: "thread", op: "resolve", target: "t1, t3", content: "the courier was sent away and Marcus is dead", evidence: EVIDENCE, reason: "done" },
      { kind: "thread", op: "add", target: "new", content: "Edythe wants the courier called off", evidence: EVIDENCE, reason: "new" },
      { kind: "thread", op: "update", target: "t2", content: "Carine's blood results are still not back", evidence: "The blood results are still not back", reason: "reworded" },
    ]));
    const threads = state.storyThreads;
    expect(threads.find((t) => t.id === "t1")!.status).toBe("resolved");
    expect(threads.find((t) => t.id === "t3")!.status).toBe("resolved");
    expect(threads.find((t) => t.id === "t2")!.text).toBe("Carine's blood results are still not back");
    expect(openStoryThreads(threads).map((t) => t.id)).toEqual(["t2", "t4"]);
  });

  it("reads an old-style Open threads line edit as a thread change", () => {
    let state = fixture();
    state = reduce(state, pass(state, [{ kind: "stateLine", target: "Open threads", op: "remove", content: "the courier waits in the lobby", evidence: EVIDENCE, reason: "done" }]));
    expect(state.storyThreads.find((t) => t.id === "t1")!.status).toBe("resolved");
  });

  it("caps open threads and holds a bulk resolve for review", () => {
    let state = fixture();
    for (let i = state.storyThreads.length; i < MAX_OPEN_THREADS; i++) state = reduce(state, [{ type: "ADD_STORY_THREAD", text: `thread ${i}` }]);
    expect(pass(state, [{ kind: "thread", op: "add", target: "new", content: "one too many", evidence: EVIDENCE, reason: "x" }])
      .some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
    state = reduce(state, pass(state, [{ kind: "thread", op: "resolve", target: "t1, t2, t3, t4", content: "all settled", evidence: EVIDENCE, reason: "x" }]));
    const bulk = state.activeState.memoryProposals.find((p) => p.threadOp?.op === "resolve")!;
    expect(bulk).toMatchObject({ status: "pending", requiresReview: true });
    expect(openStoryThreads(state.storyThreads)).toHaveLength(MAX_OPEN_THREADS);
    state = reduce(state, [{ type: "APPROVE_MEMORY_PROPOSAL", proposalId: bulk.id }]);
    expect(openStoryThreads(state.storyThreads)).toHaveLength(MAX_OPEN_THREADS - 4);
  });

  it("consolidates an over-long list by keeping the live threads, always for review", () => {
    let state = fixture();
    state.storyThreads = Array.from({ length: 30 }, (_, i) => ({ ...makeStoryThread([], `old thread ${i}`, 1), id: `t${i + 1}` }));
    state = reduce(state, pass(state, [{ kind: "thread", op: "keep", target: "t2, t30", content: "everything else finished", evidence: EVIDENCE, reason: "consolidate" }]));
    const proposal = state.activeState.memoryProposals.find((p) => p.threadOp)!;
    expect(proposal).toMatchObject({ status: "pending", requiresReview: true });
    state = reduce(state, [{ type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id }]);
    expect(openStoryThreads(state.storyThreads).map((t) => t.id)).toEqual(["t2", "t30"]);
    expect(state.storyThreads).toHaveLength(30);
  });

  it("never lets a full Story State rewrite supersede or carry thread changes", () => {
    let state = fixture();
    state.memoryAutoApprove = { ...state.memoryAutoApprove, storyStateUpdate: false };
    state = reduce(state, pass(state, [{ kind: "thread", op: "resolve", target: "t1", content: "sent away", evidence: EVIDENCE, reason: "x" }]));
    state = reduce(state, pass(state, [{ kind: "state", target: "Story State", content: "Location: the hall.\nOpen threads:\n- invented", evidence: EVIDENCE, reason: "x" }]));
    const pending = state.activeState.memoryProposals.filter((p) => p.status === "pending");
    expect(pending.map((p) => Boolean(p.threadOp)).sort()).toEqual([false, true]);
    expect(pending.find((p) => !p.threadOp)!.content).toBe("Location: the hall.");
  });

  it("lets the player add, reword, resolve, reopen, and delete threads", () => {
    let state = fixture();
    state = reduce(state, [
      { type: "ADD_STORY_THREAD", text: "the lease renewal" },
      { type: "UPDATE_STORY_THREAD", threadId: "t4", text: "the lease renewal is due Friday" },
      { type: "RESOLVE_STORY_THREAD", threadId: "t1" },
      { type: "REOPEN_STORY_THREAD", threadId: "t1" },
      { type: "DELETE_STORY_THREAD", threadId: "t3" },
    ]);
    expect(state.storyThreads.map((t) => [t.id, t.status, t.text])).toEqual([
      ["t1", "open", "the courier waits in the lobby"],
      ["t2", "open", "Carine's blood results are pending"],
      ["t4", "open", "the lease renewal is due Friday"],
    ]);
  });
});

describe("scene direction", () => {
  const scene = "Present: Edythe, Carine, Seth.\nAims: Carine wants a second blood draw; Edythe wants the courier gone before Seth sees him.\nOpen choice: whether Seth agrees to the draw.";

  it("is written by the memory pass, auto-approved by default, and sent per turn with its age", () => {
    let state = fixture();
    state.activeState.turn = 7;
    state = reduce(state, pass(state, [{ kind: "scene", target: "Scene Direction", content: scene, evidence: EVIDENCE, reason: "scene" }]));
    const component = state.components.find((c) => c.type === "sceneDirection")!;
    expect(component.content).toBe(scene);
    const result = buildContext(state, { currentInput: "I hold out my arm." });
    expect(result.messages[0].content).not.toContain("second blood draw");
    expect(result.messages.at(-1)!.content).toContain("S2. Scene Direction");
    expect(result.messages.at(-1)!.content).toContain("As of turn 7");
  });

  it("requires an Aims line and respects the block's switch", () => {
    const state = fixture();
    expect(pass(state, [{ kind: "scene", target: "Scene Direction", content: "Present: everyone.", evidence: EVIDENCE, reason: "x" }])
      .some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
    state.components = state.components.map((c) => c.type === "sceneDirection" ? { ...c, autoUpdate: false } : c);
    expect(pass(state, [{ kind: "scene", target: "Scene Direction", content: scene, evidence: EVIDENCE, reason: "x" }])
      .some((a) => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
  });

  it("is added to old saves on load", () => {
    const old = createDefaultAdventure("Old");
    old.components = old.components.filter((c) => c.type !== "sceneDirection");
    expect(normalizeAdventure(old).components.filter((c) => c.type === "sceneDirection")).toHaveLength(1);
  });
});
