import { describe, expect, it } from "vitest";
import { createDefaultAdventure } from "./defaults";
import { buildRollingSummaryPayload, clampedSummaryStartIndex } from "./rollingSummary";
import type { Adventure } from "../types/adventure";

function summaryAdventure(lastSummarizedMessageIndex: number): Adventure {
  return {
    ...createDefaultAdventure("Summary"),
    rollingSummary: {
      content: "Earlier turns have been compressed.",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastSummarizedMessageIndex,
    },
    messages: [
      { id: "m1", role: "user", content: "First surviving event.", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "m2", role: "assistant", content: "Second surviving event.", createdAt: "2026-01-01T00:01:00.000Z" },
    ],
  };
}

describe("rolling summary payload", () => {
  it("clamps stale summary indexes after story deletion instead of skipping surviving messages", () => {
    const adventure = summaryAdventure(99);

    expect(clampedSummaryStartIndex(adventure)).toBe(2);

    const payload = buildRollingSummaryPayload(adventure);
    expect(payload.fromIndex).toBe(2);
    expect(payload.lastIndex).toBe(2);
    expect(payload.messages[1].content).toContain("No new events.");
  });

  it("includes unsummarized surviving messages when the clamped index points before them", () => {
    const payload = buildRollingSummaryPayload(summaryAdventure(1));

    expect(payload.fromIndex).toBe(1);
    expect(payload.lastIndex).toBe(2);
    expect(payload.messages[1].content).toContain("Second surviving event.");
    expect(payload.messages[1].content).not.toContain("First surviving event.");
  });

  it("handles negative or invalid indexes as unsummarized from the beginning", () => {
    const payload = buildRollingSummaryPayload(summaryAdventure(-10));

    expect(payload.fromIndex).toBe(0);
    expect(payload.messages[1].content).toContain("First surviving event.");
    expect(payload.messages[1].content).toContain("Second surviving event.");
  });
});
