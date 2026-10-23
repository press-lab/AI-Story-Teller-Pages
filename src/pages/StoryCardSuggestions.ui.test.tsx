/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { IDBFactory } from "fake-indexeddb";
import { getAdventure, saveAdventure } from "../db/adventureDb";
import type { Adventure } from "../types/adventure";
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

function DatedReview({ update = false }) {
  const initial = createDefaultAdventure();
  initial.storyClock = { origin: "established", current: { text: "2019-02-01", date: "2019-02-01", precision: "day" } };
  initial.messages = [{ id: "dated-source", role: "assistant", content: "Seth and Draconia shared their first kiss.", storyTime: initial.storyClock.current, createdAt: "2026-01-01" }];
  if (update) initial.storyCards = [makeStoryCard({ id: "history", title: "Seth and Draconia Relationship History", type: "lore", memoryMode: "living", content: "Their original meeting.", lore: { status: "ongoing", sourceMessageIds: ["meeting"], occurredAt: { text: "2018-01-01", date: "2018-01-01", precision: "day" }, lastChangedAt: { text: "2018-01-01", date: "2018-01-01", precision: "day" } } })];
  initial.activeState.memoryProposals = [makeStoryCardSuggestion(initial, "dated-source", initial.messages[0].content, {
    title: update ? "Seth and Draconia Relationship History" : "First kiss", content: initial.messages[0].content, evidence: initial.messages[0].content, reason: "A milestone", participants: ["Seth", "Draconia"],
  })];
  if (update) initial.activeState.memoryProposals[0].lore!.occurredAt = initial.storyCards[0].lore!.occurredAt;
  const [adventure, dispatch] = useReducer(adventureReducer, initial);
  return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output data-testid="saved">{JSON.stringify(adventure)}</output></>;
}

const savedReview = (): Adventure => JSON.parse(screen.getByTestId("saved").textContent!);

it.each([false, true])("edits Event Date before approval, persists it, and keeps the clock unchanged (UPDATE=%s)", async update => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  render(<DatedReview update={update} />);
  const user = userEvent.setup();
  const before = savedReview();
  const input = screen.getByLabelText("Event Date");
  expect(input).toHaveValue("2019-02-01");
  await user.clear(input);
  await user.type(input, "2019-02-14");
  const corrected = { text: "2019-02-14", date: "2019-02-14", precision: "day" };
  expect(savedReview().activeState.memoryProposals[0].lore).toMatchObject({ occurredAt: corrected, lastChangedAt: corrected });
  expect(savedReview().storyClock).toEqual(before.storyClock);
  // A pending correction survives both JSON and the real IndexedDB persistence boundary.
  await saveAdventure(normalizeAdventure(JSON.parse(JSON.stringify(savedReview()))));
  expect((await getAdventure(before.id))?.activeState.memoryProposals[0].lore?.occurredAt).toEqual(corrected);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const approved = savedReview();
  expect(approved.storyCards).toHaveLength(1);
  expect(approved.storyCards[0].lore?.occurredAt).toEqual(update ? before.storyCards[0].lore?.occurredAt : corrected);
  expect(approved.storyCards[0].lore?.lastChangedAt).toEqual(corrected);
  if (update) expect(approved.storyCards[0].content).toContain("Their original meeting.\n[2019-02-14]");
  expect(approved.storyClock).toEqual(before.storyClock);
  await saveAdventure(normalizeAdventure(JSON.parse(JSON.stringify(approved))));
  const reloaded = await getAdventure(before.id);
  expect(reloaded?.storyCards[0].lore).toEqual(approved.storyCards[0].lore);
  expect(reloaded?.storyClock).toEqual(before.storyClock);
});

it.each([
  ["around midwinter", "approximate"],
  ["12 Frostfall, Year of the Dragon", "day"],
  ["three days before the coronation", "relative"],
  ["", "unknown"],
] as const)("approves textual/unknown Event Date %s with precision %s", async (text, precision) => {
  render(<DatedReview />);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Event Date"));
  if (text) await user.type(screen.getByLabelText("Event Date"), text);
  await user.selectOptions(screen.getByLabelText("Event Date precision"), precision);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(savedReview())));
  expect(saved.storyCards[0].lore?.occurredAt).toEqual({ text, precision });
  expect(saved.storyClock?.current?.date).toBe("2019-02-01");
});

it.each(["2019-02-30", "February 30, 2019", "2023-02-29"])("rejects invalid exact Event Date %s without normalization or approval", async text => {
  render(<DatedReview />);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Event Date"));
  await user.type(screen.getByLabelText("Event Date"), text);
  expect(screen.getByLabelText("Event Date")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(savedReview().activeState.memoryProposals[0].lore?.occurredAt?.date).toBeUndefined();
  expect(savedReview().storyCards).toHaveLength(0);
  expect(savedReview().storyClock?.current?.date).toBe("2019-02-01");
  await user.clear(screen.getByLabelText("Event Date"));
  await user.type(screen.getByLabelText("Event Date"), "2024-02-29");
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(savedReview().storyCards[0].lore?.occurredAt?.date).toBe("2024-02-29");
});
