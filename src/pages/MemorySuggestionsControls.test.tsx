/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createDefaultAdventure, normalizeAdventure } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { approvalAdventure, approvalProposal } from "../test/memoryApproval";
import { MemoryInboxPage } from "./MemoryInboxPage";

afterEach(cleanup);
it("discards pending suggestions while retaining normal automatic application", () => {
  let a = createDefaultAdventure();
  a.activeState.memoryProposals = [makeMemoryProposal(), makeMemoryProposal({ id: "old", status: "rejected" })];
  a = reduce(a, { type: "SET_MEMORY_SUGGESTIONS_ENABLED", enabled: false });
  expect(a.activeState.memoryProposals.map(p => p.id)).toEqual(["old"]);
  a = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "new" }) });
  expect(a.activeState.memoryProposals.map(p => p.id)).toEqual(["old"]);
  const automatic = approvalAdventure();
  automatic.memorySuggestionsEnabled = false;
  automatic.memoryAutoApprove.brainUpdate = true;
  const applied = reduce(automatic, { type: "ADD_MEMORY_PROPOSAL", proposal: approvalProposal("brainUpdate") });
  expect(applied.activeState.memoryProposals[0]?.status).toBe("approved");
  expect(applied.brains[0].currentState).toBe("New state");
  expect(normalizeAdventure(JSON.parse(JSON.stringify(a))).memorySuggestionsEnabled).toBe(false);
});
it("clears resolved suggestion JSON without deleting pending work or canon", () => {
  const a = createDefaultAdventure();
  a.activeState.memoryProposals = [makeMemoryProposal(), ...(["approved", "rejected", "ignored"] as const).map(status => makeMemoryProposal({ id: status, status }))];
  const next = reduce(a, { type: "CLEAR_SUGGESTION_HISTORY" });
  expect(next.activeState.memoryProposals).toEqual([a.activeState.memoryProposals[0]]);
  expect(next.storyCards).toBe(a.storyCards);
  expect(next.messages).toBe(a.messages);
  expect(next.activeState.apiCalls).toBe(a.activeState.apiCalls);
});
it("clears decision evidence but preserves failed work, completion guards and suggestions", () => {
  let a = createDefaultAdventure();
  a = reduce(a, { type: "ADD_MESSAGE", id: "source", role: "assistant", content: "A source", createdAt: "2026-01-01" });
  const completed = { status: "complete", turn: 1, attempts: 1, completedGroups: [], assessment: { debug: "old evidence" } } as unknown as NonNullable<typeof a.messages[number]["memoryEvaluation"]>;
  const failed = { status: "failed", turn: 1, attempts: 1, completedGroups: [] } as NonNullable<typeof a.messages[number]["memoryEvaluation"]>;
  a.messages = [{ ...a.messages[0], memoryEvaluation: completed }, { ...a.messages[0], id: "failed", memoryEvaluation: failed }];
  a.activeState.memoryProposals = [makeMemoryProposal({ status: "rejected" })];
  const next = reduce(a, { type: "CLEAR_DECISION_HISTORY" });
  expect(next.messages[0].memoryEvaluation?.status).toBe("complete");
  expect(next.messages[0].memoryEvaluation?.assessment).toBeUndefined();
  expect(next.messages[1].memoryEvaluation).toBe(failed);
  expect(next.activeState.memoryProposals).toBe(a.activeState.memoryProposals);
  expect(next.activeState.apiCalls).toBe(a.activeState.apiCalls);
});
it("places content adjacent to actions and dispatches separate cleanup controls", () => {
  const a = createDefaultAdventure();
  a.activeState.memoryProposals = [makeMemoryProposal()];
  const dispatch = vi.fn();
  render(<MemoryInboxPage adventure={a} dispatch={dispatch} />);
  const content = screen.getByPlaceholderText("Proposed content...");
  expect(content.nextElementSibling?.textContent).toContain("Approve");
  expect(screen.getByText("Review details", { selector: "summary" }).parentElement?.hasAttribute("open")).toBe(false);
  fireEvent.click(screen.getByLabelText("Show suggestions"));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "SET_MEMORY_SUGGESTIONS_ENABLED", enabled: false });
  fireEvent.click(screen.getByText("Clear suggestion history"));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "CLEAR_SUGGESTION_HISTORY" });
  fireEvent.click(screen.getByText("Decisions", { selector: "button" }));
  fireEvent.click(screen.getByText("Clear decision history"));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "CLEAR_DECISION_HISTORY" });
});
