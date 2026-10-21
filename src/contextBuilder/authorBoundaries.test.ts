import { describe, expect, it } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { buildContext } from "./contextBuilder";

describe("author response boundaries", () => {
  it("uses a protected OOC contract and suppresses narrative capture for Author input", () => {
    const adventure = createDefaultAdventure("Author");
    adventure.messages = [{ id: "author", role: "user", inputMode: "comms", content: "Why did Mira leave?", createdAt: "2026-10-21" }];
    const result = buildContext(adventure);
    const system = result.messages[0].content;
    expect(system).toContain("AUTHOR RESPONSE CONTRACT: Reply ONLY out of character");
    expect(system).not.toContain("TURN SCOPE CONTRACT:");
    expect(system).not.toContain("[CHARACTER THOUGHT CAPTURE]");
    expect(system).not.toContain("[MEMORY TAGGING]");
    const contract = result.sections.flatMap(section => section.items).find(item => item.id === "turn-scope-contract");
    expect(contract?.protected).toBe(true);
    expect(result.messages.at(-1)?.content).toBe("[Out of Character author input]\nWhy did Mira leave?");
    expect(result.sections.find(section => section.id === "recentMessages")?.items[0].content).toBe(result.messages.at(-1)?.content);
    expect(adventure.messages[0].content).toBe("Why did Mira leave?");
  });

  it("labels historical author replies but resumes the story contract on a story turn", () => {
    const adventure = createDefaultAdventure("Mixed");
    adventure.messages = [
      { id: "reply", role: "assistant", inputMode: "comms", content: "She needs time.", createdAt: "2026-10-21" },
      { id: "story", role: "user", inputMode: "story", content: 'I open the door.\nai - Keep Mira quiet.\n"Hello?"', createdAt: "2026-10-21" },
    ];
    const result = buildContext(adventure);
    expect(result.messages[0].content).toContain("TURN SCOPE CONTRACT:");
    expect(result.messages[0].content).not.toContain("AUTHOR RESPONSE CONTRACT:");
    expect(result.messages[0].content).toContain('the marker "ai -" (case-insensitive');
    expect(result.messages[0].content).toContain("Characters cannot hear, read, answer, react to, or gain knowledge");
    expect(result.messages.at(-2)?.content).toBe("[Out of Character reply]\nShe needs time.");
    expect(result.messages.at(-1)?.content).toBe(adventure.messages[1].content);
  });

  it("does not confuse capture suppression with Author mode", () => {
    const result = buildContext(createDefaultAdventure("Author"), { skipThoughtCapture: true });
    expect(result.messages[0].content).toContain("TURN SCOPE CONTRACT:");
  });
});
