/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { StoryCardsPage } from "./StoryCardsPage";

afterEach(cleanup);

function Editor() {
  const initial = createDefaultAdventure();
  initial.storyCards = [makeStoryCard({ id: "lore", title: "The Ministry negotiations", type: "lore", content: "The official demands access.", keys: ["research access"] })];
  const [adventure, dispatch] = useReducer(adventureReducer, initial);
  return <><StoryCardsPage adventure={adventure} dispatch={dispatch} /><output data-testid="saved">{JSON.stringify(adventure)}</output></>;
}

it("offers four types and edits the independent story clock and Lore chronology", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByText(/Current story clock: 2000-01-01/));
  await user.clear(screen.getByLabelText("Current story time", { exact: true }));
  await user.type(screen.getByLabelText("Current story time", { exact: true }), "February 1, 2019");
  await user.click(document.querySelector(".story-card-editor-item > summary")!);
  const type = screen.getByLabelText("Type", { exact: true });
  expect(within(type).getAllByRole("option").map(option => (option as HTMLOptionElement).value)).toEqual(["character", "location", "lore", "custom"]);
  expect(screen.queryByLabelText("Core Facts")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Current Facts")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Recent Developments")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Occurred at", { exact: true }), "2019-01-18");
  await user.selectOptions(screen.getByLabelText("Lore status"), "unresolved");
  await user.type(screen.getByLabelText("Known to (private knowledge)"), "Seth, Draconia");
  await user.tab();
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.storyClock.current).toMatchObject({ date: "2019-02-01", precision: "day" });
  expect(saved.storyCards[0].lore).toMatchObject({ occurredAt: { date: "2019-01-18" }, status: "unresolved", knownTo: ["Seth", "Draconia"] });
});


it("explains relevance selection without per-card scheduling and keeps context controls editable", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(document.querySelector(".story-card-editor-item > summary")!);
  await user.click(screen.getByText("Context, automation, and ordering", { selector: "summary" }));
  expect(screen.getByRole("heading", { name: "Automatic Memory Eligibility" })).toBeVisible();
  expect(screen.getByText("Per-card update interval: Not configurable.")).toBeVisible();
  expect(screen.getByText("Per-card automatic update switch: Not available in the current evaluator.")).toBeVisible();
  expect(screen.getByText(/up to eight candidate cards/)).toBeVisible();
  expect(screen.queryByLabelText(/auto.?update|automatic.*update|cooldown/i)).not.toBeInTheDocument();
  const initial = JSON.parse(screen.getByTestId("saved").textContent!);
  await user.click(screen.getByLabelText("Pinned (included even without a trigger match)"));
  await user.click(screen.getByLabelText("Protected (cannot be dropped by token truncation)"));
  await user.click(screen.getByLabelText("Active", { exact: true }));
  await user.selectOptions(screen.getByLabelText("Inclusion Policy"), "always");
  fireEvent.change(screen.getByLabelText("Priority (higher = loaded first)"), { target: { value: "73" } });
  fireEvent.change(screen.getByLabelText("Token Budget (0 = default ~200; caps live content, older facts archive)"), { target: { value: "430" } });
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.storyCards[0]).toMatchObject({ pinned: true, protected: true, active: false, inclusionPolicy: "always", priority: 73, tokenBudget: 430 });
  expect(saved.storyCards[0].autoUpdate).toEqual(initial.storyCards[0].autoUpdate);
  expect(saved.storyCards[0].autoUpdateCooldownTurns).toEqual(initial.storyCards[0].autoUpdateCooldownTurns);
});
