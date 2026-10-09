import { describe, expect, it } from "vitest";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { createDefaultAdventure, normalizeAdventure } from "../state/defaults";
import type { Adventure, AdventureAction } from "../types/adventure";
import { memoryRecoveryBatch, pendingMemoryRecovery } from "./memoryRecoveryBatch";

function addMissedTurn(adventure: Adventure, turn: number) {
  return [
    { type: "ADD_MESSAGE", id: `story-${turn}`, role: "assistant", content: `Final narrative ${turn}` },
    { type: "QUEUE_MEMORY_RECOVERY", messageId: `story-${turn}`, turn },
    { type: "INCREMENT_TURN" },
    { type: "ADVANCE_MEMORY_RECOVERY_TURN" },
  ].reduce((state, action) => reduce(state, action as AdventureAction), adventure);
}
function fixture() {
  let state = createDefaultAdventure("Recovery");
  state.memoryDetectionSettings.enabled = true;
  for (let turn = 1; turn <= 5; turn++) state = addMissedTurn(state, turn);
  return state;
}

describe("persisted recovery batches", () => {
  it("claims before retry and retains every source through reload and failure", () => {
    let state = fixture();
    expect(memoryRecoveryBatch(state)).toHaveLength(5);
    state = reduce(state, { type: "CLAIM_MEMORY_RECOVERY", turn: 5 });
    state = normalizeAdventure(JSON.parse(JSON.stringify(state)));
    expect(memoryRecoveryBatch(state)).toHaveLength(0);
    expect(pendingMemoryRecovery(state)).toHaveLength(5);
    for (let turn = 6; turn <= 9; turn++) {
      state = addMissedTurn(state, turn);
      expect(memoryRecoveryBatch(state)).toHaveLength(0);
    }
    state = addMissedTurn(state, 10);
    expect(memoryRecoveryBatch(state).map(m => m.id)).toEqual(Array.from({ length: 10 }, (_, i) => `story-${i + 1}`));
  });

  it("rejects stale results atomically, including edits and regenerations", () => {
    const initial = fixture();
    const sources = memoryRecoveryBatch(initial).map(({ id, content }) => ({ id, content }));
    const complete: AdventureAction = { type: "COMPLETE_MEMORY_RECOVERY", sources,
      actions: [{ type: "SET_STATE_FLAG", key: "memoryApplied", value: true }] };
    const edited = { ...initial, messages: initial.messages.map(m => m.id === "story-5" ? { ...m, content: "Regenerated narrative" } : m) };
    expect(reduce(edited, complete)).toBe(edited);
    const removed = reduce(initial, { type: "REMOVE_LAST_ASSISTANT_MESSAGE" });
    expect(reduce(removed, complete)).toBe(removed);
    const completed = reduce(initial, complete);
    expect(pendingMemoryRecovery(completed)).toHaveLength(0);
    expect(completed.activeState.stateFlags.memoryApplied).toBe(true);
    expect(reduce(completed, complete)).toBe(completed);
  });

  it("waits for a new batch after a long run of successful inline turns", () => {
    let state = fixture();
    const sources = memoryRecoveryBatch(state);
    state = reduce(state, { type: "CLAIM_MEMORY_RECOVERY", turn: 5 });
    state = reduce(state, { type: "COMPLETE_MEMORY_RECOVERY", sources, actions: [] });
    for (let turn = 6; turn <= 15; turn++) state = reduce(state, { type: "ADVANCE_MEMORY_RECOVERY_TURN" });
    state = addMissedTurn(state, 16);
    expect(memoryRecoveryBatch(state)).toHaveLength(0);
    for (let turn = 17; turn <= 20; turn++) state = reduce(state, { type: "ADVANCE_MEMORY_RECOVERY_TURN" });
    expect(memoryRecoveryBatch(state)).toHaveLength(1);
  });

  it("accepts old saves without inventing a backlog from their historical transcript", () => {
    const old = createDefaultAdventure("Old save");
    old.messages = [{ id: "old", role: "assistant", content: "Old narrative", createdAt: "2020-01-01" }];
    expect(memoryRecoveryBatch(normalizeAdventure(old))).toEqual([]);
  });
});
