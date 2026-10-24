/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    ? JSON.stringify({ accepted: true, meaningfulChange: true, evidenceMessageIds: ["evidence"], identityMatchesTarget: true })
    : JSON.stringify({ thoughts: { alpha: newest } }) }));
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
  expect(provider).toHaveBeenCalledTimes(3);
});
