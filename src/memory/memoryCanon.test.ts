import { describe, expect, it } from "vitest";
import { memoryCanonMessages } from "./memoryCanon";
import { createDefaultAdventure, makeComponent, makeStoryCard, makeBrain, normalizeAdventure } from "../state/defaults";

describe("memory canon grounding", () => {
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
    for (const included of ["You are Seth Press", "Seth is the player character", "Julian is a rival bidder", "Seth is immune", "Vampires reflect normally"]) expect(text).toContain(included);
    for (const excluded of ["SECRET CLIMAX", "Unverified old log", "PRIVATE PLAN", "OBSOLETE RULE", "UNRELATED LORE", "DISABLED CHARACTER"]) expect(text).not.toContain(excluded);
  });
  it("defaults arc updates to review while preserving saved explicit choices", () => {
    const a = createDefaultAdventure();
    expect(a.memoryAutoApprove.currentArcUpdate).toBe(false);
    a.memoryAutoApprove.currentArcUpdate = true;
    expect(normalizeAdventure(a).memoryAutoApprove.currentArcUpdate).toBe(true);
  });
});
