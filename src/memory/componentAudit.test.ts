import { describe, expect, it } from "vitest";
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
