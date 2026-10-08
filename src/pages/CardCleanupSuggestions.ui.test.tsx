// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryInboxPage } from "./MemoryInboxPage";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import type { Adventure } from "../types/adventure";

afterEach(cleanup);

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
