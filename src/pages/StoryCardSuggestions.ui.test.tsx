/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { makeStoryCardSuggestion } from "../memory/storyCardSuggestions";
import { MemoryInboxPage } from "./MemoryInboxPage";
import { ChroniclePage } from "./ChroniclePage";

afterEach(cleanup);

function Review({ stale = false, extraTarget = false }) {
  const initial = createDefaultAdventure();
  initial.messages = [{ id: "source", role: "assistant", content: "Draconia accepts Seth's proposal.", createdAt: "2026-01-01" }];
  initial.storyCards = ["one", "two"].map(id => makeStoryCard({ id, title: `Seth and Draconia Relationship ${id}`, type: "lore", memoryMode: "living", content: "Seth and Draconia are close." }));
  if (extraTarget) initial.storyCards.push(makeStoryCard({ id: "other", title: "A separate Lore subject", type: "lore", content: "Preserved prior fact." }));
  initial.activeState.memoryProposals = [makeStoryCardSuggestion(initial, "source", initial.messages[0].content, {
    title: "Engagement", content: initial.messages[0].content, evidence: initial.messages[0].content, reason: "A commitment", participants: ["Seth", "Draconia"],
  })];
  if (stale) initial.messages[0].content += " This was only a dream.";
  const [adventure, dispatch] = useReducer(adventureReducer, initial);
  return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output data-testid="saved">{JSON.stringify(adventure)}</output></>;
}

it("lets the reviewer choose an ambiguous update destination before approval", async () => {
  render(<Review />);
  const user = userEvent.setup();
  expect(screen.getByText(/Several continuing subjects may fit/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "two");
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.storyCards).toHaveLength(2);
  expect(saved.storyCards[0].content).toBe("Seth and Draconia are close.");
  expect(saved.storyCards[1].content).toContain("accepts Seth's proposal");
});

it("blocks stale source approval even when the revised entry retains the old text", () => {
  render(<Review stale />);
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(screen.getByText(/This suggestion cannot be approved/)).toBeInTheDocument();
});

it("evaluates a Chronicle entry or selected range without opening the entry editor", async () => {
  const adventure = createDefaultAdventure();
  adventure.messages = [
    { id: "player", role: "user", content: "I listen.", createdAt: "2026-01-01" },
    { id: "first", role: "assistant", content: "They meet.", createdAt: "2026-01-01" },
    { id: "second", role: "assistant", content: "They make a promise.", createdAt: "2026-01-01" },
  ];
  const evaluate = vi.fn(async () => undefined);
  render(<ChroniclePage adventure={adventure} dispatch={vi.fn()} onEvaluateStoryCards={evaluate} />);
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: "Evaluate Story Card Updates" })[0]);
  expect(evaluate).toHaveBeenLastCalledWith(["first"]);
  expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  await user.click(screen.getByText("Evaluate Story Card Updates", { selector: "summary" }));
  await user.click(screen.getByRole("button", { name: "Evaluate range" }));
  expect(evaluate).toHaveBeenLastCalledWith(["first", "second"]);
  expect(screen.getByRole("status")).toHaveTextContent("Review suggestions in Memory Inbox");
});

it("lets the reviewer redirect to a compatible target outside the ranked candidates", async () => {
  render(<Review extraTarget />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "other");
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.storyCards).toHaveLength(3);
  expect(saved.storyCards[2].content).toContain("Preserved prior fact.");
  expect(saved.storyCards[2].content).toContain("accepts Seth's proposal");
});

it("can change an UPDATE into a separate CREATE without touching the former target", async () => {
  render(<Review />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "two");
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "");
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.storyCards).toHaveLength(3);
  expect(saved.storyCards.slice(0, 2).every((card: { content: string }) => card.content === "Seth and Draconia are close.")).toBe(true);
  expect(saved.storyCards[2].title).toBe("Engagement");
});
