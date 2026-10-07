import { describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeComponent } from "../state/defaults";
import { runComponentAudit } from "./componentAudit";

describe("runComponentAudit", () => {
  it("flags disabled legacy Immediate Momentum blocks without needing an LLM pass", async () => {
    const adventure = {
      ...createDefaultAdventure("Component Audit"),
      components: [
        makeComponent({
          id: "legacy-momentum",
          title: "Immediate Momentum",
          type: "immediateMomentum",
          content: "Go to the next room.",
          active: true,
        }),
      ],
    };

    const recommendations = await runComponentAudit(adventure, adventure.modelConfig, 20);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      action: "delete",
      componentId: "legacy-momentum",
      suggestedType: "custom",
    });
  });

  it("suggests deterministic bloat reductions before any AI pass", async () => {
    const adventure = {
      ...createDefaultAdventure("Component Audit"),
      components: [
        makeComponent({
          id: "plot-essentials",
          title: "Plot Essentials",
          type: "plotEssentials",
          content: "- The gate is sealed.\n- The gate is sealed.\n- Margo has the ward key.",
          active: true,
        }),
        makeComponent({
          id: "active-pressure",
          title: "Active Pressure",
          type: "activePressure",
          content:
            "The Red Ring is closing the city gates before Seth can extract Margo. " +
            "\nThis also repeats old history about the first gala and the basement chase.",
          active: true,
        }),
      ],
    };

    const recommendations = await runComponentAudit(adventure, adventure.modelConfig, 20);

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "det-duplicate-lines-plot-essentials",
          editedContent: "- The gate is sealed.\n- Margo has the ward key.",
        }),
        expect.objectContaining({
          id: "det-pressure-long-active-pressure",
          editedContent: "The Red Ring is closing the city gates before Seth can extract Margo.",
        }),
      ]),
    );
  });
});

it("does not suggest creating or converting to pressure when it is absent", async () => {
  const provider = await import("../providers/openAICompatible");
  const mock = vi.spyOn(provider, "sendOpenAICompatibleChatCompletion").mockResolvedValue({ content: JSON.stringify([
    { action: "create", title: "Pressure", rationale: "A threat appeared.", suggestedContent: "The duke demands tribute.", suggestedType: "activePressure" },
    { action: "edit", componentId: "plot", title: "Pressure", rationale: "A threat appeared.", suggestedContent: "The duke demands tribute.", suggestedType: "activePressure" },
    { action: "edit", componentId: "plot", title: "Plot", rationale: "Clarify the premise.", suggestedContent: "The exiles seek a home.", suggestedType: "plotEssentials" }
  ]), raw: {} });
  try {
    const adventure = createDefaultAdventure("No pressure");
    adventure.components = [makeComponent({ id: "plot", title: "Plot", type: "plotEssentials", content: "The exiles need a home." })];
    const recs = await runComponentAudit(adventure, adventure.modelConfig, 20, { includeAI: true });
    expect(recs.some(r => r.suggestedType === "activePressure")).toBe(false);
    expect(recs.some(r => r.suggestedType === "plotEssentials")).toBe(true);
    expect(mock.mock.calls[0][0].messages[0].content).not.toMatch(/Active Pressure|activePressure/);
  } finally { mock.mockRestore(); }
});
