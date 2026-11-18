import { expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { loreAppendDayError } from "./datedLoreRouting";
import { parseLooseMemoryOperations } from "./looseMemoryParser";

it("requires original evidence and detects conflicting occurrence dates", () => {
  const a = createDefaultAdventure();
  const day = { text: "2018-09-29", date: "2018-09-29", precision: "day" as const };
  a.messages = [
    { id: "original", role: "assistant", content: "They agreed to study the sealed archive together.", createdAt: "", storyTime: day },
    { id: "current", role: "assistant", content: "They received the archive key.", createdAt: "", storyTime: day },
  ];
  a.storyCards = [makeStoryCard({ id: "archive", type: "lore", title: "Archive agreement", content: "Later unrelated material.",
    lore: { status: "ongoing", sourceMessageIds: ["original"], occurredAt: day } })];
  const p = { proposedType: "storyCard", targetId: "archive", sourceTurnId: "current",
    rationale: "They agreed to study the sealed archive together. This adds the agreed access key." } as Parameters<typeof loreAppendDayError>[1];
  expect(loreAppendDayError(a, p)).toBeUndefined();
  expect(loreAppendDayError(a, { ...p, rationale: "Continues the pub scene." })).toMatch(/quote/);
  a.messages[0].storyTime = { ...day, date: "2018-09-22", text: "2018-09-22" };
  expect(loreAppendDayError(a, p)).toMatch(/conflicts/);
  a.messages.shift();
  expect(loreAppendDayError(a, p)).toMatch(/unavailable/);
});

it.each(["object", "location", "custom", "lore"])("removes %s update metadata from factual content", type => {
  const parsed = parseLooseMemoryOperations(["S1", "(storyCard." + type + ".update: Prism = The prism refracts blue light. || Research prism || This adds its spectral limit.)"].join(String.fromCharCode(10)), ["S1"]);
  expect(parsed.operations[0].content).toBe("The prism refracts blue light.");
  expect(parsed.operations[0].loreAppend?.destination).toBe("Research prism");
});
