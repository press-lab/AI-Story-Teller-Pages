/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { worldPresetName } from "../memory/worldPresets";
import { ComponentsPage } from "./ComponentsPage";
import { SettingsPage } from "./SettingsPage";
import { defaultGlobalAdventureSettings, defaultUiPreferences } from "./pageTypes";
import type { Adventure, NewAdventureSetup } from "../types/adventure";
import { AdventuresPage } from "./AdventuresPage";
import { WorldEvolutionPanel } from "./WorldEvolutionPanel";

afterEach(cleanup);
describe("scenario configuration controls", () => {
  it("applies every explicit preset mapping in the adventure editor and derives Custom from individual edits", async () => {
    const user = userEvent.setup();
    let latest!: Adventure;
    function Editor() {
      const [a, setA] = useState(createDefaultAdventure("Scenario")); latest = a;
      return <ComponentsPage adventure={a} dispatch={action => setA(old => adventureReducer(old, action))} />;
    }
    render(<Editor />);
    expect(screen.getByRole("article", { name: "Scenario Configuration" })).toBeInTheDocument();
    expect(screen.getByLabelText("World Dynamism")).toHaveValue("Living World");
    const fields = ["plotProgression", "plotResolution", "newPlotGeneration", "npcAutonomy", "offscreenEvents", "characterDevelopment", "relationshipEvolution", "betrayal", "redemption", "hiddenMotivations", "canonReinterpretation"] as const;
    const expected = [
      ["Quiet Sandbox", ["off", "openEnded", "off", "reactive", false, false, false, "off", "off", false, "off"]],
      ["Natural Evolution", ["natural", "openEnded", "occasional", "reactive", false, true, true, "off", "earned", true, "review"]],
      ["Living World", ["active", "decisive", "occasional", "independent", true, true, true, "off", "earned", true, "review"]],
      ["Unpredictable World", ["active", "decisive", "frequent", "independent", true, true, true, "unrestricted", "unrestricted", true, "review"]],
    ] as const;
    for (const [preset, values] of expected) {
      await user.selectOptions(screen.getByLabelText("World Dynamism"), preset);
      expect(fields.map(key => latest.worldEvolutionSettings![key])).toEqual(values);
      expect(worldPresetName(latest.worldEvolutionSettings!)).toBe(preset);
    }
    await user.click(screen.getByText("Advanced World Evolution"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Betrayal" }), "earned");
    expect(screen.getByLabelText("World Dynamism")).toHaveValue("Custom");
    await user.click(screen.getByLabelText("Enable World Evolution"));
    await user.selectOptions(screen.getByLabelText("World Dynamism"), "Natural Evolution");
    expect(latest.worldEvolutionSettings!.enabled).toBe(false);
  });
  it("passes selected configuration through actual New Adventure submission", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async (_setup: NewAdventureSetup) => undefined);
    render(<AdventuresPage adventures={[]} onCreate={onCreate} onOpen={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    await user.selectOptions(screen.getByLabelText("World Dynamism"), "Quiet Sandbox");
    await user.click(screen.getByRole("button", { name: "Create Adventure" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(worldPresetName(onCreate.mock.calls[0][0].worldEvolutionSettings!)).toBe("Quiet Sandbox");
  });
  it("has no World Evolution controls in global Settings even with an active adventure", () => {
    render(<SettingsPage adventure={createDefaultAdventure("Scenario")} dispatch={vi.fn()} providerPresets={[{ ...defaultModelConfig, apiKey: "", id: "test", label: "Test" }]} activePresetId="test" onProviderPresetsChange={vi.fn()} onSelectPreset={vi.fn()} uiPreferences={defaultUiPreferences} onUiPreferencesChange={vi.fn()} globalAdventureSettings={defaultGlobalAdventureSettings} onGlobalAdventureSettingsChange={vi.fn()} />);
    expect(screen.queryByLabelText("Enable World Evolution")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("World Dynamism")).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Scenario Configuration" })).not.toBeInTheDocument();
  });
  it("shows dropped candidates with accepted narration for review", async () => {
    const user = userEvent.setup();
    const a = createDefaultAdventure("Review");
    a.messages = [{ id: "story", role: "assistant", content: "Marcus permanently ended the conspiracy.", createdAt: a.createdAt }];
    a.worldEvolutionState!.issues = [{ id: "issue", sourceTurnId: "story", status: "unrecorded", reason: "Output capacity reached", droppedRecords: [{ route: "worldChanges", record: { targetId: "marcus", content: "Marcus supports the rebellion." } }] }];
    render(<WorldEvolutionPanel adventure={a} dispatch={vi.fn()} />);
    await user.click(screen.getByText("Dropped worldChanges candidate — review before applying"));
    expect(screen.getByText(/"targetId": "marcus"/)).toBeInTheDocument();
    await user.click(screen.getByText("Accepted narration"));
    expect(screen.getByText("Marcus permanently ended the conspiracy.")).toBeInTheDocument();
  });
  it("keeps archived world history visible with the master switch Off", () => {
    const a = createDefaultAdventure("Archive"); a.worldEvolutionSettings!.enabled = false;
    a.worldEvolutionState!.archivedThreads = [{ id: "plot", title: "Conspiracy", objective: "Expose conspiracy", participants: [], originEvidence: "A conspiracy emerged.", sourceTurnId: "story", phase: "aftermath", revision: 1, events: [], outcome: "The conspiracy permanently ended." }];
    render(<WorldEvolutionPanel adventure={a} dispatch={vi.fn()} />);
    expect(screen.getByText("World Evolution record")).toBeInTheDocument();
    expect(screen.getByText("Outcome: The conspiracy permanently ended.")).toBeInTheDocument();
  });
});
