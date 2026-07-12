import { describe, expect, it } from "vitest";
import { parseAidStoryCards } from "./aidCardParser";
import { parseComponentsJson } from "./componentParser";

describe("story card JSON parser", () => {
  it("maps story cards and detects character brain candidates", () => {
    const result = parseAidStoryCards(
      JSON.stringify([
        {
          title: "Princess Azula",
          keys: "Azula,Princess Azula",
          value: "Blue-fire prodigy.",
          type: "character",
        },
        {
          title: "Nyx",
          keys: "{\"agent\":\"Nyx\",\"percent\":30}",
          value: "nyx.brain.setu = \"Setu surprised me.\";",
          type: "Brain",
          description: "setu: Setu surprised me.",
        },
      ]),
    );

    expect(result.error).toBeUndefined();
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].storyCard.title).toBe("Princess Azula");
    expect(result.cards[0].storyCard.keys).toEqual(["Azula", "Princess Azula"]);
    expect(result.cards[1].suggestion).toBe("brain");
    expect(result.cards[1].brainCandidate?.characterName).toBe("Nyx");
    expect(result.cards[1].brainCandidate?.source).toBe("imported");
    expect(result.cards[1].brainCandidate?.currentState).toBe("setu: Setu surprised me.");
  });
});

describe("plot component parser", () => {
  it("imports exported component JSON and preserves component settings", () => {
    const result = parseComponentsJson(
      JSON.stringify({
        openingScene: "Rain falls upward from the Sump tonight.",
        components: [
          {
            id: "component-plot",
            title: "Plot Essentials",
            type: "plotEssentials",
            content: "Nyx remains secret.",
            priority: 92,
            alwaysOn: true,
            active: true,
            pinned: true,
            protected: true,
            inclusionPolicy: "always",
            state: "",
            autoUpdate: false,
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:00.000Z",
          },
          {
            title: "Active Pressure",
            type: "activePressure",
            content: "The relay is failing.",
            autoUpdate: true,
          },
        ],
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.openingScene).toBe("Rain falls upward from the Sump tonight.");
    expect(result.skipped).toHaveLength(0);
    expect(result.components).toHaveLength(2);
    expect(result.components[0].component).toMatchObject({
      id: "component-plot",
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "Nyx remains secret.",
      priority: 92,
      alwaysOn: true,
      pinned: true,
      protected: true,
      inclusionPolicy: "always",
    });
    expect(result.components[1].component).toMatchObject({
      title: "Active Pressure",
      type: "activePressure",
      content: "The relay is failing.",
      priority: 245,
      autoUpdate: true,
    });
  });

  it("skips unknown or empty components with reviewable reasons", () => {
    const result = parseComponentsJson(
      JSON.stringify({
        components: [
          { title: "Wrong", type: "mystery", content: "Unknown type." },
          { title: "Momentum", type: "immediateMomentum", content: "Disabled type." },
          { title: "Empty", type: "plotEssentials", content: "  " },
        ],
      }),
    );

    expect(result.components).toHaveLength(0);
    expect(result.skipped.map((item) => item.reason)).toEqual([
      'Unknown component type "mystery".',
      "Immediate Momentum is disabled.",
      "Component content was empty.",
    ]);
  });

  it("accepts an opening-scene-only setup file", () => {
    const result = parseComponentsJson(
      JSON.stringify({
        openingScene: "The relay says: Come closer.",
      }),
    );

    expect(result.components).toHaveLength(0);
    expect(result.openingScene).toBe("The relay says: Come closer.");
    expect(result.warnings).toContain("Opening scene found; no plot components were included.");
  });
});
