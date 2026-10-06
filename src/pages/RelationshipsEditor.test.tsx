// @vitest-environment jsdom
import { useReducer } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RelationshipsEditor } from "./RelationshipsEditor";
import { MemoryInboxPage } from "./MemoryInboxPage";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain } from "../state/defaults";
import { buildContext } from "../contextBuilder/contextBuilder";
import { onePassMemoryActions } from "../memory/onePassMemory";
afterEach(cleanup);
function base() { const a = structuredClone(createDefaultAdventure()); a.brains = [makeBrain({ id: "kori", characterName: "Kori" })]; return a; }
it("enrolls from the Brain editor and exposes starting history and recall", () => {
  function Harness() { const [adventure, dispatch] = useReducer(adventureReducer, base()); return <RelationshipsEditor adventure={adventure} dispatch={dispatch} brain={adventure.brains[0]} />; }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Focus character"), { target: { value: "Seth" } });
  fireEvent.change(screen.getByLabelText("Bond"), { target: { value: "friends" } });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "close" } });
  fireEvent.change(screen.getByLabelText(/Named dimensions/), { target: { value: "trust: guarded" } });
  fireEvent.click(screen.getByText("Save relationship"));
  expect(screen.getByText("Kori → Seth")).toBeTruthy();
  const recall = screen.getByLabelText("Recall player-setup") as HTMLInputElement;
  fireEvent.click(recall); expect(recall.checked).toBe(true);
  expect(screen.getByText("Player-authored starting relationship")).toBeTruthy();
});
it("shows both states, evidence, source and an approval that appends history", () => {
  const state = { bond: "friends", status: "close", dimensions: { trust: "guarded" } };
  let a = adventureReducer(base(), { type: "ENROLL_RELATIONSHIP", brainId: "kori", focus: "Seth", state });
  const r = a.brains[0].relationships[0];
  const evidence = "Kori watches Seth return her keepsake.";
  a = onePassMemoryActions(a, buildContext(a, { currentInput: "Kori and Seth meet." }), [{ kind: "relationshipChange", target: "kori", relationshipId: r.id, focus: "Seth", revision: 0,
    proposed: { ...state, dimensions: { trust: "growing" } }, evidence, knowledgeEvidence: evidence, reason: "Observed care" }], evidence, "source-turn-7").reduce(adventureReducer, a);
  function Harness() { const [adventure, dispatch] = useReducer(adventureReducer, a); return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output>History count: {adventure.brains[0].relationships[0].history.length}</output></>; }
  render(<Harness />);
  expect(screen.getByText("Previous state")).toBeTruthy(); expect(screen.getByText("Proposed state")).toBeTruthy();
  expect(screen.getByText(/Source turn: source-turn-7/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Approve" })); expect(screen.getByText("History count: 2")).toBeTruthy();
});
