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
  await user.click(screen.getByRole("button", { name: "Apply Story Date" }));
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


it("keeps the original Story Cards clock editor independent of approved Lore dates", async () => {
  render(<Editor />);
  const user = userEvent.setup();
  const before = JSON.parse(screen.getByTestId("saved").textContent!);
  await user.click(screen.getByText(/Current story clock:/, { selector: "summary" }));
  const input = screen.getByLabelText("Current story time", { exact: true });
  await user.clear(input); await user.type(input, "2001-09-04");
  await user.click(screen.getByRole("button", { name: "Apply Story Date" }));
  const after = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(after.storyClock.current.date).toBe("2001-09-04");
  expect(after.storyCards).toEqual(before.storyCards);
  expect(after.messages).toEqual(before.messages);
});


import { StoryClockEditor } from "./StoryCardChronology";
import { vi } from "vitest";

it("keeps clock drafts local, validates exact dates, applies once, and synchronizes external changes", () => {
  const adventure = createDefaultAdventure(); const dispatch = vi.fn();
  const view = render(<StoryClockEditor adventure={adventure} dispatch={dispatch} inline />);
  expect(screen.getByRole("heading", { name: /Current Story Date: 2000-01-01.*assumed/ })).toBeVisible();
  const apply = screen.getByRole("button", { name: "Apply Story Date" });
  expect(apply).toBeDisabled();
  const input = screen.getByLabelText("Current story time", { exact: true });
  for (const value of ["2001-09-", "February 30, 2001", "2001-02-29", "2001-09-31"]) {
    fireEvent.change(input, { target: { value } });
    expect(dispatch).not.toHaveBeenCalled();
    if (value !== "2001-09-") expect(apply).toBeDisabled();
  }
  fireEvent.change(input, { target: { value: "September 8, 2001" } });
  expect(dispatch).not.toHaveBeenCalled(); expect(apply).toBeEnabled();
  fireEvent.click(apply);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch).toHaveBeenCalledWith({ type: "SET_STORY_CLOCK", clock: { current: { text: "September 8, 2001", date: "2001-09-08", precision: "day" } } });
  const saved = adventureReducer(adventure, dispatch.mock.calls[0][0]);
  view.rerender(<StoryClockEditor adventure={saved} dispatch={dispatch} inline />);
  expect(apply).toBeDisabled();
  expect(screen.getByRole("heading", { name: "Current Story Date: September 8, 2001 (Saturday)" })).toBeVisible();
  const external = adventureReducer(saved, { type: "ADD_MESSAGE", role: "assistant", content: "The next morning" });
  view.rerender(<StoryClockEditor adventure={external} dispatch={dispatch} inline />);
  expect(input).toHaveValue("2001-09-09");
  expect(screen.getByRole("heading", { name: "Current Story Date: 2001-09-09 (Sunday)" })).toBeVisible();
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it.each(["Third Frost, Year of the Raven", "around midwinter", "three days before the coronation"])("preserves textual story calendars: %s", text => {
  const adventure = createDefaultAdventure(); const dispatch = vi.fn();
  adventure.storyClock!.pendingReference = "Several days later";
  render(<StoryClockEditor adventure={adventure} dispatch={dispatch} inline />);
  expect(screen.getByRole("alert")).toHaveTextContent("Unresolved time passage");
  fireEvent.change(screen.getByLabelText("Current story time", { exact: true }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Story Date" }));
  expect(dispatch.mock.calls[0][0].clock.current).toMatchObject({ text });
  expect(dispatch.mock.calls[0][0].clock.current.date).toBeUndefined();
});


it.each([
  ["2001-09-08", "Saturday"], ["2001-09-09", "Sunday"], ["2001-09-10", "Monday"],
  ["2001-09-11", "Tuesday"], ["2001-09-12", "Wednesday"], ["2001-09-13", "Thursday"],
  ["2001-09-14", "Friday"], ["2000-02-29", "Tuesday"],
])("shows the Gregorian weekday for %s without changing the saved clock", (date, weekday) => {
  const adventure = createDefaultAdventure(); const dispatch = vi.fn();
  adventure.storyClock = { origin: "established", current: { text: date, date, precision: "day" } };
  const before = JSON.stringify(adventure);
  render(<StoryClockEditor adventure={adventure} dispatch={dispatch} inline />);
  expect(screen.getByRole("heading", { name: `Current Story Date: ${date} (${weekday})` })).toBeVisible();
  expect(screen.getByLabelText("Current story time", { exact: true })).toHaveValue(date);
  expect(JSON.stringify(adventure)).toBe(before);
  expect(dispatch).not.toHaveBeenCalled();
});
