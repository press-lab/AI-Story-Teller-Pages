import { describe, expect, it } from "vitest";
import { classifyMemory } from "./classificationPolicy";

describe("classifyMemory", () => {
  it("classifies private jokes as story cards", () => {
    expect(classifyMemory("Margo calls Seth 'hedge prince' as a private joke").proposedType).toBe("storyCard");
  });

  it("ignores one-off room layouts unless marked important or recurring", () => {
    expect(classifyMemory("The couch is against the west wall").proposedType).toBe("ignore");
    expect(classifyMemory("The couch is against the west wall", { recurring: true }).proposedType).toBe("storyCard");
  });

  it("classifies hidden emotional state as a brain update", () => {
    expect(classifyMemory("Margo feels jealous but hides it", { characterName: "Margo", existingBrainNames: ["Margo"] }).proposedType).toBe("brainUpdate");
  });

  it("does not create brain updates for characters without existing Brain entries", () => {
    const result = classifyMemory("Margo feels jealous but hides it", { characterName: "Margo" });
    expect(result.proposedType).toBe("ignore");
    expect(result.rationale).toContain("No existing BrainEntry");
  });

  it("routes durable character facts to existing Story Cards or story-card proposals when no Brain exists", () => {
    const existing = classifyMemory("Margo promised Seth she would return", {
      characterName: "Margo",
      existingStoryCards: [{ id: "card-margo", title: "Margo", keys: ["Margo"] }],
    });
    expect(existing.proposedType).toBe("storyCard");
    expect(existing.targetId).toBe("card-margo");
    expect(existing.rationale).toContain("existing Story Card");

    const proposal = classifyMemory("Margo promised Seth she would return", { characterName: "Margo" });
    expect(proposal.proposedType).toBe("storyCard");
    expect(proposal.targetId).toBeUndefined();
  });

  it("classifies engagement and magical rules as durable story cards", () => {
    expect(classifyMemory("Seth and Margo are now officially engaged").proposedType).toBe("storyCard");
    expect(classifyMemory("Magic cannot cross the warded threshold").proposedType).toBe("storyCard");
  });

  it("ignores generic movement", () => {
    expect(classifyMemory("The group walked to the elevator").proposedType).toBe("ignore");
  });

  it("classifies immediate current threats as Plot Essentials updates", () => {
    expect(classifyMemory("The Beast is actively hunting Seth tonight").proposedType).toBe("plotEssentialsUpdate");
  });

  it("does not create Brain entries for random one-scene NPCs by default", () => {
    expect(classifyMemory("Tomas feels nervous in the doorway", { characterName: "Tomas" }).proposedType).not.toBe("brainUpdate");
  });
});
