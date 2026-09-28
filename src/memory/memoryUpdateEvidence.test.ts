import { describe, expect, it } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { latestMemoryTurn } from "./memoryUpdateEvidence";

describe("latestMemoryTurn", () => {
  it("keeps the latest user action and response separate from older context and system notes", () => {
    const a = createDefaultAdventure("Evidence");
    a.messages = [
      { createdAt: "2026-09-27T12:00:00Z", id: "old", role: "user", content: "Walk home" },
      { createdAt: "2026-09-27T12:00:00Z", id: "old-reply", role: "assistant", content: "A watcher follows" },
      { createdAt: "2026-09-27T12:00:00Z", id: "new", role: "user", content: "Keep walking" },
      { createdAt: "2026-09-27T12:00:00Z", id: "new-reply", role: "assistant", content: "The rain continues" },
      { createdAt: "2026-09-27T12:00:00Z", id: "note", role: "system", content: "Maintenance" },
    ];
    expect(latestMemoryTurn(a).map(m => m.id)).toEqual(["new", "new-reply"]);
    a.messages = [];
    expect(latestMemoryTurn(a)).toEqual([]);
  });
});
