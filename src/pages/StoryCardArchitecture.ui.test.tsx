/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  await user.click(screen.getByText(/Current story clock: unknown/));
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
