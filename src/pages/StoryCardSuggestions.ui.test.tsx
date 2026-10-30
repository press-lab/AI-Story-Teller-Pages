import { reviewedProposal } from "../test/memoryPlacement";
/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  expect(savedReview().activeState.memoryProposals[0].lore).toMatchObject({ occurredAt: update ? before.storyCards[0].lore!.occurredAt : corrected, lastChangedAt: corrected });
  expect(savedReview().storyClock).toEqual(before.storyClock);
  // A pending correction survives both JSON and the real IndexedDB persistence boundary.
  await saveAdventure(normalizeAdventure(JSON.parse(JSON.stringify(savedReview()))));
  expect((await getAdventure(before.id))?.activeState.memoryProposals[0].lore?.lastChangedAt).toEqual(corrected);
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Confirm this event date" }));
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
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
  expect(screen.getAllByText("Append to Character · Alastor Moody").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Convert to Lore" }));
  expect(convert).toHaveBeenCalledWith(expect.any(String), true);
  expect(screen.getAllByText("Create Lore · Moody’s lesson").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = savedReview();
  expect(saved.storyCards[0].content).toBe("Moody is a veteran Auror. VOICE: Blunt.");
  expect(saved.storyCards.find(c => c.type === "lore")?.content).toBe("Moody demonstrated three curses to the class.");
});

import { qualityFixture } from "../test/memoryQuality";
import { makeMemoryProposal } from "../test/goldenAdventure";
function GroupedReview() {
  const { a } = qualityFixture();
  a.activeState.memoryProposals = [
    makeMemoryProposal({ id: "one", title: "First subject label", storyCardType: "lore", targetId: "relationship", appendContent: true, content: "Draconia accepted a design safeguard." }),
    makeMemoryProposal({ id: "two", title: "Different subject label", storyCardType: "lore", targetId: "relationship", appendContent: true, content: "Seth retained control of the shop." }),
    makeMemoryProposal({ id: "three", title: "Quidditch Trials", storyCardType: "lore", content: "Ron plans to try out for Keeper." }),
    makeMemoryProposal({ id: "four", title: "  quidditch trials  ", storyCardType: "lore", content: "Harry will observe the trials." }),
    makeMemoryProposal({ id: "five", proposedType: "brainUpdate", targetId: "brain-Fred", title: "Private reaction", content: JSON.stringify({ thoughts: { latest: "I will judge her by her work." } }) }),
  ];
  const [adventure, dispatch] = useReducer(adventureReducer, a);
  return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output data-testid="grouped-state">{JSON.stringify(adventure)}</output></>;
}
it("groups by destination ID, normalized CREATE title/type and Brain character; search and individual edits/approval remain independent", async () => {
  render(<GroupedReview />); const user = userEvent.setup();
  const relationship = screen.getByRole("region", { name: "Seth and Draconia's Public Exposure suggestions" });
  expect(within(relationship).getByRole("heading")).toHaveTextContent("2 proposals");
  expect(screen.getByRole("region", { name: /CREATE lore: Quidditch Trials suggestions/i })).toHaveTextContent("2 proposals");
  expect(screen.getByRole("region", { name: "Brain: Fred suggestions" })).toHaveTextContent("1 proposal");
  const drafts = within(relationship).getAllByPlaceholderText("Proposed content...");
  await user.clear(drafts[0]); await user.type(drafts[0], "A revised independent safeguard.");
  expect(drafts[1]).toHaveValue("Seth retained control of the shop.");
  await user.click(within(relationship).getAllByRole("button", { name: "Approve" })[0]);
  const state = JSON.parse(screen.getByTestId("grouped-state").textContent!);
  expect(state.activeState.memoryProposals.find((p: { id: string }) => p.id === "two").status).toBe("pending");
  expect(screen.getByLabelText("Memory suggestion counts")).toHaveTextContent("4 pending");
  await user.type(screen.getByPlaceholderText("Search suggestions..."), "Keeper");
  expect(screen.getByLabelText("Memory suggestion counts")).toHaveTextContent("1 shown");
  expect(screen.getByRole("region", { name: /CREATE lore: Quidditch Trials suggestions/i })).toHaveTextContent("1 proposal");
});

import * as historyWorker from "../memory/memoryHistoryWorker";
import { compactHistoricalProposal } from "../memory/memoryHistory";
it("opens archived history beside grouped pending proposals without changing either", async () => {
  const { a } = qualityFixture();
  const original = makeMemoryProposal({ id: "resolved", title: "Original archived agreement", storyCardType: "lore", status: "rejected", content: "A preserved reviewed development." });
  const record = { kind: "proposal" as const, id: original.id, value: original };
  const block = { id: "archive", version: 1 as const, format: "aist-memory-history" as const, encoding: "typed-json-gzip-base64" as const,
    kind: "proposal" as const, recordId: original.id, decodedBytes: 100, sha256: "0".repeat(64), data: "synthetic-worker-result" };
  a.activeState.memoryProposals = [compactHistoricalProposal(original, block.id), makeMemoryProposal({ id: "pending", title: "Quidditch Trials", storyCardType: "lore", content: "Ron plans to audition." })];
  a.activeState.compressedMemoryHistory = { version: 1, blocks: { archive: block } };
  const read = vi.spyOn(historyWorker, "readHistoryInWorker").mockResolvedValue(record);
  try {
    render(<MemoryInboxPage adventure={a} dispatch={vi.fn()} />);
    expect(read).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByText("History (1)", { selector: "summary" }));
    await userEvent.setup().click(screen.getByText("Original archived details", { selector: "summary" }));
    expect(await screen.findByText("Complete original record (JSON)")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(block);
    expect(screen.getByRole("region", { name: "CREATE lore: Quidditch Trials suggestions" })).toHaveTextContent("1 proposal");
    expect(a.activeState.memoryProposals[0].status).toBe("rejected");
  } finally { read.mockRestore(); }
});


it("adds no date confirmation for normal proposals and invalidates a deliberate override after editing", async () => {
  render(<DatedReview />);
  const user = userEvent.setup();
  expect(screen.queryByRole("button", { name: "Confirm this event date" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  const input = screen.getByLabelText("Event Date");
  await user.clear(input); await user.type(input, "2019-02-04");
  expect(screen.getByText("Date conflict: this event’s proposed date does not agree with its source chronology.")).toBeVisible();
  expect(screen.getByText(/Source event date 2019-02-01; proposed occurrence 2019-02-04/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Confirm this event date" }));
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.type(screen.getByDisplayValue("First kiss"), " privately");
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Confirm this event date" })).toBeVisible();
  await user.clear(input); await user.type(input, "2019-02-01");
  expect(screen.queryByRole("button", { name: "Confirm this event date" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(savedReview().activeState.memoryProposals[0].status).toBe("approved");
});


import { loreCorrectionFixture } from "../test/loreDateCorrection";
import type { AdventureAction } from "../types/adventure";

function BulkReview({ onAction = (_action: AdventureAction) => {} }: { onAction?: (action: AdventureAction) => void }) {
  const [adventure, reduce] = useReducer(adventureReducer, undefined, loreCorrectionFixture);
  return <><MemoryInboxPage adventure={adventure} dispatch={action => { onAction(action); reduce(action); }} />
    <output data-testid="saved">{JSON.stringify(adventure)}</output>
    <button onClick={() => reduce({ type: "REJECT_MEMORY_PROPOSAL", proposalId: "stale" })}>Resolve selected source</button>
    <button onClick={() => reduce({ type: "SET_STORY_CLOCK", clock: { current: { text: "2001-09-09", date: "2001-09-09", precision: "day" } } })}>Advance externally</button>
    <button onClick={() => reduce({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: "stale", patch: { content: "Edited archive discovery." } })}>Edit selected externally</button>
  </>;
}

it("shows the clock above evaluation tools, starts unselected, and offers selection only for pending Lore", async () => {
  render(<BulkReview />);
  expect(screen.getByRole("heading", { name: "Current Story Date: 2001-09-08 (Saturday)" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Current Story Date" }).compareDocumentPosition(screen.getByText("Check Recent Entries")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const boxes = screen.getAllByRole("checkbox", { name: /^Select Lore:/ });
  expect(boxes).toHaveLength(4); boxes.forEach(box => expect(box).not.toBeChecked());
  expect(screen.queryByRole("button", { name: "Review Date Changes" })).not.toBeInTheDocument();
  const before = savedReview();
  await userEvent.setup().click(screen.getByRole("checkbox", { name: "Select Lore: Archive discovery" }));
  expect(screen.getByText("1 selected · 1 eligible for correction")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Select Lore: Royal appointment" })).not.toBeChecked();
  expect(savedReview()).toEqual(before);
});

it("selects only visible eligible Lore and leaves explicitly historical suggestions for individual review", async () => {
  render(<BulkReview />); const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Search suggestions..."), "Archive discovery");
  await user.click(screen.getByRole("button", { name: "Select visible eligible Lore" }));
  expect(screen.getByText("1 selected · 1 eligible for correction")).toBeVisible();
  await user.clear(screen.getByPlaceholderText("Search suggestions..."));
  expect(screen.getByRole("checkbox", { name: "Select Lore: Royal appointment" })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Trade treaty" }));
  expect(screen.getByText("2 selected · 1 eligible for correction")).toBeVisible();
  expect(screen.getByText(/Excluded: The source establishes a different/)).toBeVisible();
  expect(screen.getAllByLabelText("Event Date")).toHaveLength(4);
});

it("requires review and confirmation, allows cancellation, and commits one batch without approval", async () => {
  const actions = vi.fn(); render(<BulkReview onAction={actions} />); const user = userEvent.setup();
  const before = savedReview();
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Archive discovery" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Archive agreement" }));
  await user.click(screen.getByRole("button", { name: "Review Date Changes" }));
  expect(savedReview()).toEqual(before); expect(actions).not.toHaveBeenCalled();
  expect(screen.getByText("This replaces the proposed event dates for the selected pending Lore. Original Chronicle messages and existing approved Story Cards will not change.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel date changes" }));
  expect(savedReview()).toEqual(before);
  await user.click(screen.getByRole("button", { name: "Review Date Changes" }));
  await user.click(screen.getByRole("button", { name: "Confirm and Apply Dates" }));
  expect(actions).toHaveBeenCalledTimes(1);
  expect(actions.mock.calls[0][0].type).toBe("APPLY_CURRENT_STORY_DATE_TO_PENDING_LORE");
  const after = savedReview();
  expect(after.activeState.memoryProposals[0]).toMatchObject({ status: "pending", lore: { occurredAt: { date: "2001-09-08" } } });
  expect(after.activeState.memoryProposals[2]).toMatchObject({ lore: { occurredAt: { date: "2001-09-04" }, lastChangedAt: { date: "2001-09-08" } } });
  expect(after.messages).toEqual(before.messages); expect(after.storyCards).toEqual(before.storyCards);
  expect(after.activeState.memoryProposals.slice(4)).toEqual(before.activeState.memoryProposals.slice(4));
  expect(screen.getByRole("status", { name: "Saved Lore date changes" })).toHaveTextContent("Archive discovery: 2001-09-08 (Saturday) — saved");
  expect(screen.queryByRole("button", { name: "Review Date Changes" })).not.toBeInTheDocument();
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  await saveAdventure(normalizeAdventure(JSON.parse(JSON.stringify(after))));
  const loaded = await getAdventure(after.id);
  expect(loaded?.activeState.memoryProposals[0].lore).toEqual(after.activeState.memoryProposals[0].lore);
  expect(loaded?.activeState.memoryProposals[0].chronologyConfirmationFingerprint).toBe(after.activeState.memoryProposals[0].chronologyConfirmationFingerprint);
});

it.each(["Advance externally", "Edit selected externally"])("blocks stale confirmation after %s", async button => {
  render(<BulkReview />); const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Archive discovery" }));
  await user.click(screen.getByRole("button", { name: "Review Date Changes" }));
  await user.click(screen.getByRole("button", { name: button }));
  expect(screen.getByRole("button", { name: "Confirm and Apply Dates" })).toBeDisabled();
  expect(savedReview().activeState.memoryProposals[0].lore?.occurredAt?.date).toBe("2001-09-02");
});

it("removes resolved selections and never persists or restores local selection", async () => {
  const view = render(<BulkReview />); const user = userEvent.setup();
  const before = JSON.stringify(savedReview());
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Archive discovery" }));
  expect(JSON.stringify(savedReview())).toBe(before);
  await user.click(screen.getByRole("button", { name: "Resolve selected source" }));
  expect(screen.queryByRole("button", { name: "Review Date Changes" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Royal appointment" }));
  const saved = savedReview(); view.unmount();
  render(<MemoryInboxPage adventure={normalizeAdventure(JSON.parse(JSON.stringify(saved)))} dispatch={vi.fn()} />);
  screen.getAllByRole("checkbox", { name: /^Select Lore:/ }).forEach(box => expect(box).not.toBeChecked());
});


it("applies the Suggestions clock draft to the saved adventure and persists its anchor", async () => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  const actions = vi.fn(); render(<BulkReview onAction={actions} />); const user = userEvent.setup();
  const before = savedReview();
  const input = screen.getByLabelText("Current story time", { exact: true });
  await user.clear(input); await user.type(input, "September 10, 2001");
  expect(savedReview()).toEqual(before); expect(actions).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply Story Date" }));
  expect(actions).toHaveBeenCalledTimes(1);
  const saved = savedReview();
  expect(saved.storyClock).toMatchObject({ current: { date: "2001-09-10" }, anchor: { date: "2001-09-10" }, anchorMessageId: before.messages.at(-1)!.id });
  expect(screen.getByRole("heading", { name: "Current Story Date: September 10, 2001 (Monday)" })).toBeVisible();
  expect(saved.messages).toEqual(before.messages); expect(saved.storyCards).toEqual(before.storyCards);
  expect(saved.activeState.memoryProposals).toEqual(before.activeState.memoryProposals);
  await saveAdventure(normalizeAdventure(JSON.parse(JSON.stringify(saved))));
  expect((await getAdventure(saved.id))?.storyClock).toEqual(saved.storyClock);
});


import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { loreDateConfirmed } from "../memory/validateLoreChronology";
import { correctionBatch } from "../test/loreDateCorrection";
it("retains confirmed pending corrections across the actual JSON export/import boundary", () => {
  const initial = loreCorrectionFixture();
  const corrected = adventureReducer(initial, correctionBatch(initial));
  const imported = importAdventureJson(exportAdventureJson(corrected));
  expect(imported.storyClock).toEqual(corrected.storyClock);
  for (const id of ["stale", "append"]) {
    const proposal = imported.activeState.memoryProposals.find(p => p.id === id)!;
    expect(proposal.lore).toEqual(corrected.activeState.memoryProposals.find(p => p.id === id)!.lore);
    expect(proposal.status).toBe("pending");
    expect(loreDateConfirmed(imported, proposal)).toBe(true);
  }
});


it("keeps the Story Cards toggle bound and persisted, with auto-approved history and understandable pending review", async () => {
  const { looseMemoryFixture } = await import("../test/looseMemory");
  const { prepareSinglePassMemoryBatch, parseSinglePassMemoryResponse } = await import("../memory/singlePassMemory");
  let { a } = looseMemoryFixture(); a.storyCards = [];
  a.messages[0].content = "The research team gained access to the library archives. Eleanor is a sixth-year Ravenclaw.";
  const batch = await prepareSinglePassMemoryBatch(a, ["narrator-1"]);
  const result = parseSinglePassMemoryResponse("(lore: Archive access = The research team gained access to the library archives.)\n(character: Eleanor Vale = Eleanor is a sixth-year Ravenclaw.)",
    ["narrator-1"], a, batch.outputAliases, batch).sources[0];
  a = adventureReducer(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = adventureReducer(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: [{ result, checkpoint: batch.checkpoints[0].checkpoint }] });
  function ApprovalSettings({ initial }: { initial: Adventure }) {
    const [adventure, dispatch] = useReducer(adventureReducer, initial);
    return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output data-testid="approval-state">{JSON.stringify(adventure)}</output></>;
  }
  const page = render(<ApprovalSettings initial={a} />); const user = userEvent.setup();
  expect(screen.getByLabelText("Memory suggestion counts")).toHaveTextContent("1 pending");
  const history = screen.getByText("History (1)").closest("details")!;
  expect(history).toHaveTextContent("Archive access"); expect(history).toHaveTextContent("approved");
  expect(screen.getAllByText(/Character profile changes require author review/).length).toBeGreaterThan(0);
  await user.click(screen.getByText("Memory Approval Rules"));
  const toggle = screen.getByRole("checkbox", { name: "Story Cards" });
  expect(toggle).toBeChecked();
  expect(screen.getByText("Story Card auto-approval is active. Valid suggestions can apply automatically.")).toBeInTheDocument();
  await user.click(toggle); expect(toggle).not.toBeChecked();
  const disabled = JSON.parse(screen.getByTestId("approval-state").textContent!) as Adventure;
  expect(disabled.memoryAutoApprove.storyCard).toBe(false);
  await saveAdventure(disabled);
  const loaded = normalizeAdventure((await getAdventure(disabled.id))!);
  page.unmount(); render(<ApprovalSettings initial={loaded} />);
  await user.click(screen.getByText("Memory Approval Rules"));
  expect(screen.getByRole("checkbox", { name: "Story Cards" })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Story Cards" }));
  expect(JSON.parse(screen.getByTestId("approval-state").textContent!).activeState.memoryProposals.find((p: { title: string }) => p.title === "Eleanor Vale").status).toBe("pending");
  const pending = screen.getByRole("region", { name: /CREATE character: Eleanor Vale suggestions/i });
  await user.click(within(pending).getByRole("button", { name: "Approve" }));
  expect(JSON.parse(screen.getByTestId("approval-state").textContent!).storyCards.some((c: { title: string }) => c.title === "Eleanor Vale")).toBe(true);
});


import { SettingsPage } from "./SettingsPage";
import { defaultGlobalAdventureSettings, defaultUiPreferences } from "./pageTypes";
it.each([[true, false], [true, true], [false, false], [false, true]])("shares approval controls across pages and persistence (card=%s, global=%s)", async (storyCard, requireApprovalForAutoUpdates) => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  const initial = createDefaultAdventure();
  initial.memoryAutoApprove.storyCard = storyCard;
  initial.semanticEvaluationSettings.requireApprovalForAutoUpdates = requireApprovalForAutoUpdates;
  function BothPages() {
    const [adventure, dispatch] = useReducer(adventureReducer, initial);
    return <><div data-testid="inbox"><MemoryInboxPage adventure={adventure} dispatch={dispatch} /></div>
      <div data-testid="settings"><SettingsPage adventure={adventure} dispatch={dispatch} providerPresets={[]} activePresetId=""
        onProviderPresetsChange={vi.fn()} onSelectPreset={vi.fn()} uiPreferences={{ ...defaultUiPreferences, showAdvancedSettings: true }} onUiPreferencesChange={vi.fn()}
        globalAdventureSettings={defaultGlobalAdventureSettings} onGlobalAdventureSettingsChange={vi.fn()} /></div>
      <output data-testid="saved">{JSON.stringify(adventure)}</output></>;
  }
  render(<BothPages />); const user = userEvent.setup();
  const inbox = within(screen.getByTestId("inbox")); const settings = within(screen.getByTestId("settings"));
  await user.click(inbox.getByText("Memory Approval Rules"));
  const assertControls = (card: boolean, global: boolean) => {
    for (const page of [inbox, settings]) {
      expect((page.getByLabelText("Story Cards") as HTMLInputElement).checked).toBe(card);
      expect((page.getByLabelText("Require review for automatic updates") as HTMLInputElement).checked).toBe(global);
    }
    expect(inbox.getByText(!card ? "Story Card auto-approval is disabled." : global
      ? "Story Card auto-approval is blocked because Require review for automatic updates is enabled."
      : "Story Card auto-approval is active. Valid suggestions can apply automatically.")).toBeInTheDocument();
  };
  assertControls(storyCard, requireApprovalForAutoUpdates);
  await user.click(inbox.getByLabelText("Story Cards"));
  assertControls(!storyCard, requireApprovalForAutoUpdates);
  // Settings groups may be collapsed; the underlying shared control still dispatches normally.
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.click(settings.getByLabelText("Require review for automatic updates"));
  assertControls(!storyCard, !requireApprovalForAutoUpdates);
  const saved = savedReview();
  const imported = importAdventureJson(exportAdventureJson(saved));
  await saveAdventure(imported);
  const reloaded = (await getAdventure(imported.id))!;
  expect(reloaded.memoryAutoApprove).toEqual(saved.memoryAutoApprove);
  expect(reloaded.semanticEvaluationSettings).toEqual(saved.semanticEvaluationSettings);
});
