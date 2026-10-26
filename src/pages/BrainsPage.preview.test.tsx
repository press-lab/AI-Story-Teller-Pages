/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { BrainsPage } from "./BrainsPage";
import { createDefaultAdventure, defaultModelConfig, makeBrain } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runManualBrainUpdate } from "../triggers/semanticEngine";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import type { Adventure } from "../types/adventure";

vi.mock("../providers/openAICompatible", async original => ({ ...await original<typeof import("../providers/openAICompatible")>(), sendOpenAICompatibleChatCompletion: vi.fn() }));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const newest = "30 → I need to inspect the recovered ward myself.";
beforeEach(() => {
  provider.mockReset();
  provider.mockImplementation(async request => ({ raw: {}, content: request.messages.some(message => message.content.includes("MEMORY UPDATE VALIDATION"))
    ? JSON.stringify({ accepted: true, meaningfulChange: true, reason: "The supplied source supports this private reaction.", evidenceMessageIds: ["evidence"], identityMatchesTarget: true })
    : JSON.stringify({ thoughts: { alpha: newest, ...(request.messages.some(m => m.content.includes("exceed 1 characters")) ? { zzz: null } : {}) } }) }));
});
afterEach(cleanup);

function seed(review: boolean) {
  const a = createDefaultAdventure();
  a.activeState.turn = 30;
  a.semanticEvaluationSettings = { ...a.semanticEvaluationSettings, requireApprovalForAutoUpdates: review };
  a.brains = [makeBrain({ id: "mira", characterName: "Mira", updateMode: "append", thoughts: { turn_900: "9 → I used to distrust the key." } })];
  a.messages = [{ id: "evidence", role: "assistant", content: "Mira discovers the recovered ward.", createdAt: "2026-10-24" }];
  return a;
}
function Editor({ initial }: { initial: Adventure }) {
  const [adventure, setAdventure] = useState(initial);
  return <BrainsPage adventure={adventure} dispatch={action => setAdventure(current => adventureReducer(current, action))}
    loading={false} onUpdateBrainNow={async brainId => {
      const result = await runManualBrainUpdate(adventure, { ...defaultModelConfig, apiKey: "offline-test" }, brainId);
      setAdventure(current => result.actions.reduce(adventureReducer, current));
    }} />;
}

it.each([false, true])("shows the actual Update Now thought after collapsing, with approval status preserved: review=%s", async review => {
  const user = userEvent.setup(); render(<Editor initial={seed(review)} />);
  const summary = document.querySelector(".brain-item > summary") as HTMLElement;
  await user.click(summary);
  await user.click(screen.getByRole("button", { name: "Update Now" }));
  await screen.findByTitle(newest);
  await user.click(summary);
  expect(document.querySelector(".brain-item")).not.toHaveAttribute("open");
  const preview = document.querySelector(".brain-summary-thought")!;
  expect(preview).toHaveTextContent(newest);
  if (review) expect(preview).toHaveTextContent("Pending approval:");
  else expect(preview).not.toHaveTextContent("Pending approval:");
  expect(provider).toHaveBeenCalledTimes(2);
});

it("identifies an updated existing key even when another thought has the same turn", async () => {
  const a = seed(false);
  a.brains[0].thoughts = { alpha: "30 → My earlier interpretation.", zzz: "30 → Another thought from this turn." };
  const user = userEvent.setup(); render(<Editor initial={a} />);
  const summary = document.querySelector(".brain-item > summary") as HTMLElement;
  await user.click(summary);
  await user.click(screen.getByRole("button", { name: "Update Now" }));
  await screen.findByTitle(newest);
  await user.click(summary);
  expect(document.querySelector(".brain-summary-thought")).toHaveTextContent(newest);
});

it("orders legacy thoughts by their recorded turn rather than digits in the label", () => {
  const a = seed(false);
  a.brains[0].thoughts = { turn_900: "9 → An older thought.", realization: newest };
  render(<Editor initial={a} />);
  expect(document.querySelector(".brain-summary-thought")).toHaveTextContent(newest);
});

it("preserves the new thought preview when Update Now also condenses the thought log", async () => {
  const a = seed(false);
  a.brains[0].condenseThreshold = 1;
  a.brains[0].thoughts = { alpha: "30 → My earlier interpretation.", zzz: "30 → Another thought from this turn." };
  const user = userEvent.setup(); render(<Editor initial={a} />);
  const summary = document.querySelector(".brain-item > summary") as HTMLElement;
  await user.click(summary);
  await user.click(screen.getByRole("button", { name: "Update Now" }));
  await screen.findByTitle(newest);
  await user.click(summary);
  expect(document.querySelector(".brain-summary-thought")).toHaveTextContent(newest);
  expect(provider).toHaveBeenCalledTimes(2);
});


it("explains the Brain cooldown and preserves the existing update dispatch", async () => {
  const user = userEvent.setup();
  const a = seed(false);
  a.brains[0].autoUpdateCooldownTurns = 0;
  a.brains[0].lastUpdatedTurn = 12;
  const dispatch = vi.fn();
  function Fixture() {
    const [adventure, setAdventure] = useState(a);
    return <BrainsPage adventure={adventure} dispatch={action => {
      dispatch(action);
      setAdventure(current => adventureReducer(current, action));
    }} loading={false} onUpdateBrainNow={async () => undefined} />;
  }
  render(<Fixture />);
  await user.click(document.querySelector(".brain-item > summary")!);
  await user.click(screen.getByText("Update cadence and priority", { selector: "summary" }));
  const interval = screen.getByLabelText("Minimum turns between automatic Brain updates");
  expect(interval).toHaveValue(0);
  expect(screen.getByText(/0 disables the cooldown/)).toBeVisible();
  expect(screen.queryByText(/every turn character appears/i)).not.toBeInTheDocument();
  expect(screen.getByText(/An appearance alone does not cause an update/)).toBeVisible();
  expect(screen.getAllByText(/The evaluator can group several meaningful developments/)).toHaveLength(1);
  expect(screen.getByLabelText("Last recorded Brain update turn")).toHaveValue("12");
  expect(screen.getByLabelText("Last recorded Brain update turn")).toHaveAttribute("readonly");
  fireEvent.change(interval, { target: { value: "7" } });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "UPDATE_BRAIN", brainId: "mira", patch: { autoUpdateCooldownTurns: 7 } });
  fireEvent.change(interval, { target: { value: "0" } });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "UPDATE_BRAIN", brainId: "mira", patch: { autoUpdateCooldownTurns: undefined } });
  await user.click(screen.getByText("Automation & context settings", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("Condition for a meaningful Brain change"), { target: { value: "A lasting private decision changes." } });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "UPDATE_BRAIN", brainId: "mira", patch: { updateCondition: "A lasting private decision changes." } });
  expect(screen.getByLabelText("Update Prompt Override")).toBeVisible();
});
