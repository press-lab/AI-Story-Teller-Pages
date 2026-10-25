import { reviewedProposal } from "../test/memoryPlacement";
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

function Review({ stale = false, extraTarget = false, regenerateDraft = false }) {
  const initial = createDefaultAdventure();
  initial.messages = [{ id: "source", role: "assistant", content: "Draconia accepts Seth's proposal.", createdAt: "2026-01-01" }];
  initial.storyCards = ["one", "two"].map(id => makeStoryCard({ id, title: `Seth and Draconia Relationship ${id}`, type: "lore", memoryMode: "living", content: "Seth and Draconia are close." }));
  if (extraTarget) initial.storyCards.push(makeStoryCard({ id: "other", title: "A separate Lore subject", type: "lore", content: "Preserved prior fact." }));
  initial.activeState.memoryProposals = [makeStoryCardSuggestion(initial, "source", initial.messages[0].content, {
    title: "Engagement", content: initial.messages[0].content, evidence: initial.messages[0].content, reason: "A commitment", participants: ["Seth", "Draconia"],
  })];
  initial.activeState.memoryProposals = initial.activeState.memoryProposals.map(p => reviewedProposal(initial, p));
  if (stale) initial.messages[0].content += " This was only a dream.";
  const [adventure, dispatch] = useReducer(adventureReducer, initial);
  return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} onRegenerateProposal={async id => { const p = adventure.activeState.memoryProposals.find(p => p.id === id)!; dispatch({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: id, patch: regenerateDraft ? { content: "Draconia accepts the revised commitment.", placementValidation: undefined } : reviewedProposal(adventure, p) }); }} /><output data-testid="saved">{JSON.stringify(adventure)}</output></>;
}

it("lets the reviewer choose an ambiguous update destination before approval", async () => {
  render(<Review />);
  const user = userEvent.setup();
  expect(screen.getByText(/Several continuing subjects may fit/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "two");
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.storyCards).toHaveLength(2);
  expect(saved.storyCards[0].content).toBe("Seth and Draconia are close.");
  expect(saved.storyCards[1].content).toContain("accepts Seth's proposal");
});

it("allows manual approval after the source entry changes", async () => {
  render(<Review stale />);
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  expect(screen.getByText(/The source evidence or destination changed/)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));
  expect(savedReview().activeState.memoryProposals[0].status).toBe("approved");
  expect(savedReview().storyCards.at(-1)?.content).toBe("Draconia accepts Seth's proposal.");
});

it("approves edited title and content without an AI revalidation request", async () => {
  render(<Review />);
  const user = userEvent.setup();
  const title = screen.getByDisplayValue("Engagement");
  await user.clear(title);
  await user.type(title, "A reviewed commitment");
  const content = screen.getByPlaceholderText("Proposed content...");
  await user.clear(content);
  await user.type(content, "Draconia accepts a lasting commitment to Seth.");
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(savedReview().storyCards.at(-1)).toMatchObject({ title: "A reviewed commitment", content: "Draconia accepts a lasting commitment to Seth." });
});

it("keeps approval available after regenerating the draft without placement validation", async () => {
  render(<Review regenerateDraft />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Regenerate" }));
  expect(screen.getByPlaceholderText("Proposed content...")).toHaveValue("Draconia accepts the revised commitment.");
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(savedReview().storyCards.at(-1)?.content).toBe("Draconia accepts the revised commitment.");
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
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
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
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "");
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
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
  initial.activeState.memoryProposals = initial.activeState.memoryProposals.map(p => reviewedProposal(initial, p));
  if (update) initial.activeState.memoryProposals[0].lore!.occurredAt = initial.storyCards[0].lore!.occurredAt;
  const [adventure, dispatch] = useReducer(adventureReducer, initial);
  return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} onRegenerateProposal={async id => { const p = adventure.activeState.memoryProposals.find(p => p.id === id)!; dispatch({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: id, patch: reviewedProposal(adventure, p) }); }} /><output data-testid="saved">{JSON.stringify(adventure)}</output></>;
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

it.each(["2019-02-30", "February 30, 2019", "2023-02-29"])("keeps unrecognized Event Date %s as text and allows approval", async text => {
  render(<DatedReview />);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Event Date"));
  await user.type(screen.getByLabelText("Event Date"), text);
  expect(screen.getByLabelText("Event Date")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  expect(savedReview().activeState.memoryProposals[0].lore?.occurredAt).toEqual({ text, precision: "unknown" });
  expect(savedReview().storyCards).toHaveLength(0);
  expect(savedReview().storyClock?.current?.date).toBe("2019-02-01");
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(savedReview().storyCards[0].lore?.occurredAt).toEqual({ text, precision: "unknown" });
  expect(normalizeAdventure(savedReview()).storyCards[0].lore?.occurredAt).toEqual({ text, precision: "unknown" });
});

it("shows the actual card type and converts a legacy identity draft into reviewed Lore before approval", async () => {
  const convert = vi.fn();
  function ConversionReview() {
    const initial = createDefaultAdventure();
    initial.storyCards = [makeStoryCard({ id: "moody", title: "Alastor Moody", type: "character", content: "Moody is a veteran Auror. VOICE: Blunt." })];
    initial.messages = [{ id: "lesson", role: "assistant", content: "Moody demonstrated three curses to the class.", createdAt: "2026-01-01" }];
    initial.activeState.memoryProposals = [makeStoryCardSuggestion(initial, "lesson", initial.messages[0].content, { title: "Alastor Moody", type: "character", targetId: "moody",
      content: "Moody is a veteran Auror. He demonstrated three curses. VOICE: Blunt.", evidence: initial.messages[0].content, reason: "Legacy mixed suggestion" })];
    const [a, dispatch] = useReducer(adventureReducer, initial);
    return <><MemoryInboxPage adventure={a} dispatch={dispatch} onRegenerateProposal={async (id, convertToLore) => {
      convert(id, convertToLore);
      const p = makeStoryCardSuggestion(a, "lesson", a.messages[0].content, { title: "Moody’s lesson", type: "lore", content: a.messages[0].content,
        evidence: a.messages[0].content, reason: "Completed lesson history", evidenceReviewed: true });
      dispatch({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: id, patch: reviewedProposal(a, { ...p, id }) });
    }} /><output data-testid="saved">{JSON.stringify(a)}</output></>;
  }
  render(<ConversionReview />); const user = userEvent.setup();
  expect(screen.getAllByText("Update Character · Alastor Moody").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Convert to Lore" }));
  expect(convert).toHaveBeenCalledWith(expect.any(String), true);
  expect(screen.getAllByText("Create Lore · Historical").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = savedReview();
  expect(saved.storyCards[0].content).toBe("Moody is a veteran Auror. VOICE: Blunt.");
  expect(saved.storyCards.find(c => c.type === "lore")?.content).toBe("Moody demonstrated three curses to the class.");
});
