// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryInboxPage } from "./MemoryInboxPage";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import type { Adventure } from "../types/adventure";
import { pendingSuggestionCount } from "../memory/suggestionList";

afterEach(cleanup);

it("puts existing unrecorded events in the ordinary pending list and resolves them through its controls", () => {
  const initial = createDefaultAdventure("Unified suggestions");
  initial.worldEvolutionState = { threads: [], history: [], issues: [{ id: "missing", sourceTurnId: "turn", reason: "Missing structured output", status: "unrecorded" }] };
  let latest = initial;
  function Harness() {
    const [adventure, setAdventure] = useState(initial);
    latest = adventure;
    return <MemoryInboxPage adventure={adventure} dispatch={action => setAdventure(a => adventureReducer(a, action))} />;
  }
  render(<Harness />);
  expect(screen.getByText("World Evolution")).toBeTruthy();
  expect(screen.queryByText("No pending memory suggestions.")).toBeNull();
  expect(screen.getByText("1 pending")).toBeTruthy();
  expect(pendingSuggestionCount(latest)).toBe(1);
  expect(screen.getByText("Review unrecorded developments").closest("details")?.className).toContain("proposal-card");
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(latest.worldEvolutionState?.issues[0]).toMatchObject({ status: "dismissed", reviewStatus: "rejected" });
  expect(pendingSuggestionCount(latest)).toBe(0);
  expect(screen.getByText("1 resolved")).toBeTruthy();
  expect(latest.storyCards).toEqual(initial.storyCards);
});

it("groups recurring capture failures and reviews the whole group without losing evidence", () => {
  const initial = createDefaultAdventure("Capture failures");
  initial.worldEvolutionState!.issues = [1, 2, 3].map(n => ({ id: `missing-${n}`, sourceTurnId: `turn-${n}`, status: "unrecorded", reason: "Memory envelope missing; story preserved." }));
  let latest = initial;
  function Harness() {
    const [adventure, setAdventure] = useState(initial); latest = adventure;
    return <MemoryInboxPage adventure={adventure} dispatch={action => setAdventure(a => adventureReducer(a, action))} />;
  }
  render(<Harness />);
  expect(pendingSuggestionCount(latest)).toBe(1);
  expect(screen.getByText("Review memory capture failures")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
  expect(pendingSuggestionCount(latest)).toBe(0);
  expect(latest.worldEvolutionState!.issues.every(i => i.status === "dismissed")).toBe(true);
});

it("approves a cleanup deletion from Suggestions through the real card reducer", () => {
  const initial = createDefaultAdventure("Cleanup review");
  initial.storyCards = [makeStoryCard({ id: "duplicate", title: "Duplicate", content: "Old lore." })];
  initial.activeState.memoryProposals = [{ id: "cleanup", proposedType: "storyCard", targetId: "duplicate",
    title: "Duplicate", content: "", suggestedTriggers: [], sourceTurnId: "audit", sourceText: "Old lore.",
    rationale: "Duplicate card", confidence: 1, requiresReview: true, status: "pending", createdAt: initial.updatedAt, updatedAt: initial.updatedAt,
    cardAudit: { action: "delete", expectedRevision: initial.storyCards[0].updatedAt } }];
  let latest: Adventure = initial;
  function Harness() {
    const [adventure, setAdventure] = useState(initial);
    latest = adventure;
    return <MemoryInboxPage adventure={adventure} dispatch={action => setAdventure(a => adventureReducer(a, action))} />;
  }
  render(<Harness />);
  expect(screen.getByText("Approval deletes this Story Card. Reject or Ignore keeps it.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(latest.storyCards).toHaveLength(0);
  expect(latest.activeState.memoryProposals[0].status).toBe("approved");
});
