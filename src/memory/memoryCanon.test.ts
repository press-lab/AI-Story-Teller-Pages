import { describe, expect, it } from "vitest";
import { memoryCanonMessages } from "./memoryCanon";
import { createDefaultAdventure, makeComponent, makeStoryCard, makeBrain, normalizeAdventure } from "../state/defaults";

describe("memory canon grounding", () => {
  it("omits default prose rules and off-scene profiles while preserving one-hop canon and custom instructions", () => {
    const a = createDefaultAdventure();
    a.components.push(makeComponent({ title: "Canon exception", type: "aiInstructions", content: "Vampires reflect normally." }));
    a.storyCards = [
      makeStoryCard({ title: "Player", content: "Seth is the player character.", type: "character" }),
      makeStoryCard({ title: "Edythe", content: "Edythe's sister is Eleanor.", type: "character" }),
      makeStoryCard({ title: "Eleanor", content: "Eleanor is a mechanic.", type: "character" }),
      makeStoryCard({ title: "Oath", content: "Honor the oath.", protected: true }),
      ...Array.from({ length: 20 }, (_, i) => makeStoryCard({ title: `Absent ${i}`, type: "character", content: "OFFSCENE ".repeat(100) })),
    ];
    const text = memoryCanonMessages(a, "Edythe speaks to me.", "Review the meeting").map(m => m.content).join("\n");
    for (const fact of ["player character", "sister is Eleanor", "Eleanor is a mechanic", "reflect normally", "Honor the oath"]) expect(text).toContain(fact);
    expect(text).not.toContain("OFFSCENE");
    expect(text).not.toContain("END OPEN:");
    expect(text.length).toBeLessThan(a.storyCards.map(c => c.content).join("\n").length / 4);
    a.components[0].content = "Custom narration canon: Seth cannot swim.";
    expect(memoryCanonMessages(a, "Edythe speaks.", "Review").map(m => m.content).join("\n")).toContain("Seth cannot swim");
  });

  it("includes player identity and relevant rules without leaking private or gated state", () => {
    const a = createDefaultAdventure();
    a.components = [
      makeComponent({ title: "Identity", type: "plotEssentials", content: "You are Seth Press, Westlake's lawyer." }),
      makeComponent({ title: "Gift rules", type: "custom", alwaysOn: true, content: "Seth is immune to psychic intrusion." }),
      makeComponent({ title: "Cross Bid", type: "currentArc", content: "Unverified old log", arcBreakInstruction: "SECRET CLIMAX" }),
      makeComponent({ title: "Disabled rules", type: "aiInstructions", active: false, content: "OBSOLETE RULE" }),
    ];
    a.storyCards = [
      makeStoryCard({ title: "Seth Press", type: "custom", content: "Seth is the player character." }),
      makeStoryCard({ title: "Julian Cross", type: "character", content: "Julian is a rival bidder, not Seth." }),
      makeStoryCard({ title: "Vampires", keys: ["Edythe"], content: "", coreFacts: ["Vampires reflect normally."] }),
      makeStoryCard({ title: "Unrelated", content: "UNRELATED LORE" }),
      makeStoryCard({ title: "Disabled character", type: "character", active: false, content: "DISABLED CHARACTER" }),
    ];
    a.brains = [makeBrain({ characterName: "Edythe", thoughts: { secret: "PRIVATE PLAN" } })];
    const text = memoryCanonMessages(a, "Edythe asks you about the deal.", "Append an arc event").map(m => m.content).join("\n");
    for (const included of ["You are Seth Press", "Seth is the player character", "Seth is immune", "Vampires reflect normally"]) expect(text).toContain(included);
    for (const excluded of ["SECRET CLIMAX", "Unverified old log", "PRIVATE PLAN", "OBSOLETE RULE", "UNRELATED LORE", "DISABLED CHARACTER", "Julian is a rival bidder"]) expect(text).not.toContain(excluded);
  });
  it("keeps discovery cards local to evidence while retaining protected facts and authored rules", () => {
    const a = createDefaultAdventure();
    a.components = [
      makeComponent({ title: "Narration", type: "narrationRules", content: "CUSTOM PROSE RULE" }),
      makeComponent({ title: "World", type: "aiInstructions", content: "Seattle vampires are secret." }),
    ];
    a.storyCards = [
      makeStoryCard({ title: "Lucian", type: "character", content: "Lucian runs a club." }),
      makeStoryCard({ title: "Edythe", type: "character", content: "Edythe knows Lucian." }),
      makeStoryCard({ title: "Oath", content: "Protected continuity.", protected: true }),
    ];
    const text = memoryCanonMessages(a, "Lucian enters.", "Discover Edythe", true).map(m => m.content).join("\n");
    expect(text).toContain("Lucian runs a club");
    expect(text).toContain("Protected continuity");
    expect(text).toContain("Seattle vampires are secret");
    expect(text).toContain("CUSTOM PROSE RULE");
    expect(text).not.toContain("Edythe knows Lucian");
  });
  it("defaults arc updates to review while preserving saved explicit choices", () => {
    const a = createDefaultAdventure();
    expect(a.memoryAutoApprove.currentArcUpdate).toBe(false);
    a.memoryAutoApprove.currentArcUpdate = true;
    expect(normalizeAdventure(a).memoryAutoApprove.currentArcUpdate).toBe(true);
  });
});
