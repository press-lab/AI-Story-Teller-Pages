/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import type { AdventureAction } from "../types/adventure";
import { SettingsPage } from "./SettingsPage";
import type { ProviderPreset, UiPreferences } from "./pageTypes";
import { defaultGlobalAdventureSettings, defaultUiPreferences } from "./pageTypes";

function makePreset(): ProviderPreset {
  return {
    ...defaultModelConfig,
    apiKey: "test-key",
    id: "preset-test",
    label: "Test Model",
    promptCaching: false,
  };
}

describe("SettingsPage API throttle controls", () => {
  afterEach(() => {
    cleanup();
  });

  it("lets the user enable prompt caching on the active provider preset", async () => {
    const user = userEvent.setup();
    const onProviderPresetsChange = vi.fn();
    const dispatch = vi.fn<(action: AdventureAction) => void>();
    const advancedPrefs: UiPreferences = { ...defaultUiPreferences, showAdvancedSettings: true };

    function StatefulSettingsPage() {
      const [presets, setPresets] = useState([makePreset()]);
      return (
        <SettingsPage
          adventure={createDefaultAdventure("Prompt Cache Test")}
          dispatch={dispatch}
          providerPresets={presets}
          activePresetId="preset-test"
          onProviderPresetsChange={(next) => {
            setPresets(next);
            onProviderPresetsChange(next);
          }}
          onSelectPreset={vi.fn()}
          uiPreferences={advancedPrefs}
          onUiPreferencesChange={vi.fn()}
          globalAdventureSettings={defaultGlobalAdventureSettings}
          onGlobalAdventureSettingsChange={vi.fn()}
        />
      );
    }

    render(<StatefulSettingsPage />);

    await user.click(screen.getByRole("button", { name: /Test Model/ }));
    await user.click(screen.getByLabelText("Enable prompt caching / sticky sessions"));

    expect(onProviderPresetsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "preset-test",
          promptCaching: true,
        }),
      ]),
    );
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "SET_MODEL_CONFIG",
        config: expect.objectContaining({ promptCaching: true }),
      }),
    );
  });

  it("lets the user choose an OpenRouter routing preference", async () => {
    const user = userEvent.setup();
    const onProviderPresetsChange = vi.fn();
    const dispatch = vi.fn<(action: AdventureAction) => void>();
    const advancedPrefs: UiPreferences = { ...defaultUiPreferences, showAdvancedSettings: true };

    function StatefulSettingsPage() {
      const [presets, setPresets] = useState([makePreset()]);
      return (
        <SettingsPage
          adventure={createDefaultAdventure("Routing Test")}
          dispatch={dispatch}
          providerPresets={presets}
          activePresetId="preset-test"
          onProviderPresetsChange={(next) => {
            setPresets(next);
            onProviderPresetsChange(next);
          }}
          onSelectPreset={vi.fn()}
          uiPreferences={advancedPrefs}
          onUiPreferencesChange={vi.fn()}
          globalAdventureSettings={defaultGlobalAdventureSettings}
          onGlobalAdventureSettingsChange={vi.fn()}
        />
      );
    }

    render(<StatefulSettingsPage />);

    await user.click(screen.getByRole("button", { name: /Test Model/ }));
    await user.selectOptions(screen.getByLabelText("OpenRouter routing preference"), "price");

    expect(onProviderPresetsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "preset-test",
          openRouterProviderSort: "price",
        }),
      ]),
    );
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "SET_MODEL_CONFIG",
        config: expect.objectContaining({ openRouterProviderSort: "price" }),
      }),
    );
  });

  it("lets the user configure provider request throttling", async () => {
    const user = userEvent.setup();
    const onProviderPresetsChange = vi.fn();
    const dispatch = vi.fn<(action: AdventureAction) => void>();
    const advancedPrefs: UiPreferences = { ...defaultUiPreferences, showAdvancedSettings: true };

    function StatefulSettingsPage() {
      const [presets, setPresets] = useState([makePreset()]);
      return (
        <SettingsPage
          adventure={createDefaultAdventure("Throttle Test")}
          dispatch={dispatch}
          providerPresets={presets}
          activePresetId="preset-test"
          onProviderPresetsChange={(next) => {
            setPresets(next);
            onProviderPresetsChange(next);
          }}
          onSelectPreset={vi.fn()}
          uiPreferences={advancedPrefs}
          onUiPreferencesChange={vi.fn()}
          globalAdventureSettings={defaultGlobalAdventureSettings}
          onGlobalAdventureSettingsChange={vi.fn()}
        />
      );
    }

    render(<StatefulSettingsPage />);

    await user.click(screen.getByRole("button", { name: /Test Model/ }));
    await user.click(screen.getByLabelText("Enable API request throttle"));

    expect(onProviderPresetsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "preset-test",
          requestThrottle: expect.objectContaining({ enabled: true }),
        }),
      ]),
    );
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "SET_MODEL_CONFIG",
        config: expect.objectContaining({
          requestThrottle: expect.objectContaining({ enabled: true }),
        }),
      }),
    );

    await user.clear(screen.getByLabelText("Minimum seconds between API calls"));
    await user.type(screen.getByLabelText("Minimum seconds between API calls"), "7");

    expect(onProviderPresetsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "preset-test",
          requestThrottle: expect.objectContaining({ minSecondsBetweenRequests: 7 }),
        }),
      ]),
    );
  });
});


it("configures independent memory transport and cadence without changing narration", async () => {
  const user = userEvent.setup();
  const onPresets = vi.fn();
  const onSettings = vi.fn();
  function SettingsFixture() {
    const [settings, setSettings] = useState(defaultGlobalAdventureSettings);
    return <SettingsPage dispatch={vi.fn()} providerPresets={[makePreset()]} activePresetId="preset-test"
      onProviderPresetsChange={onPresets} onSelectPreset={vi.fn()} uiPreferences={{ ...defaultUiPreferences, showAdvancedSettings: true }}
      onUiPreferencesChange={vi.fn()} globalAdventureSettings={settings} onGlobalAdventureSettingsChange={next => { setSettings(next); onSettings(next); }} />;
  }
  render(<SettingsFixture />);
  expect(screen.getByLabelText("Evaluate every N story turns")).toHaveValue(1);
  await user.selectOptions(screen.getByLabelText("Memory evaluation API"), "openaiResponses");
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({
    memoryDetectionSettings: expect.objectContaining({ evaluator: "independent", everyNTurns: 1 }),
    semanticEvaluationSettings: expect.objectContaining({ memoryEvaluationApi: "openaiResponses" }),
  }));
  expect(onPresets).not.toHaveBeenCalled();
  cleanup();
});


it("keeps global memory cadence visible and separate from custom rules and approval", async () => {
  const user = userEvent.setup();
  const onSettings = vi.fn();
  const dispatch = vi.fn();
  const adventure = createDefaultAdventure("Separate settings");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, everyNTurns: 17 };
  function Fixture() {
    const [settings, setSettings] = useState(defaultGlobalAdventureSettings);
    const [prefs, setPrefs] = useState({ ...defaultUiPreferences, showAdvancedSettings: false });
    return <SettingsPage adventure={adventure} dispatch={dispatch} providerPresets={[makePreset()]} activePresetId="preset-test"
      onProviderPresetsChange={vi.fn()} onSelectPreset={vi.fn()} uiPreferences={prefs} onUiPreferencesChange={setPrefs}
      globalAdventureSettings={settings} onGlobalAdventureSettingsChange={next => { setSettings(next); onSettings(next); }} />;
  }
  render(<Fixture />);
  expect(screen.getByRole("heading", { name: "Automatic Memory Evaluation" })).toBeVisible();
  expect(screen.getByLabelText("Automatic memory evaluation")).toBeVisible();
  const interval = screen.getByLabelText("Evaluate every N story turns");
  expect(interval).toBeVisible();
  expect(interval).toHaveValue(1);
  expect(interval).toHaveAttribute("min", "0");
  expect(interval).toHaveAttribute("max", "100");
  fireEvent.change(interval, { target: { value: "6" } });
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({ memoryDetectionSettings: expect.objectContaining({ everyNTurns: 6 }) }));
  fireEvent.change(interval, { target: { value: "0" } });
  expect(interval).toHaveValue(0);
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({ memoryDetectionSettings: expect.objectContaining({ everyNTurns: 0 }) }));
  expect(dispatch).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("Show advanced settings"));
  expect(screen.getAllByLabelText("Evaluate every N story turns")).toHaveLength(1);
  expect(screen.getAllByLabelText("Automatic memory evaluation")).toHaveLength(1);
  expect(screen.queryByLabelText(/Auto-summarize|Scene state every/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Check custom semantic rules every N turns"), { target: { value: "9" } });
  expect(dispatch).toHaveBeenLastCalledWith({ type: "SET_SEMANTIC_EVALUATION_SETTINGS", settings: { ...adventure.semanticEvaluationSettings, semanticEvalEveryNTurns: 9 } });
  expect(interval).toHaveValue(0);
  await user.click(screen.getByLabelText("Automatic memory evaluation"));
  expect(screen.getByLabelText("Automatic memory evaluation")).not.toBeChecked();
  for (const label of ["Legacy Summary", "Plot Essentials", "Active Pressure", "Current Arc (off: review generated events before they become canon)", "Arc Proposals", "Story Cards", "Characters"]) {
    expect(screen.getByLabelText(label)).toBeVisible();
  }
  await user.click(screen.getByLabelText("Story Cards"));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "SET_MEMORY_AUTO_APPROVE", settings: { ...adventure.memoryAutoApprove, storyCard: !adventure.memoryAutoApprove.storyCard } });
  await user.click(screen.getByLabelText("Require review for automatic updates"));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "SET_SEMANTIC_EVALUATION_SETTINGS", settings: { ...adventure.semanticEvaluationSettings, requireApprovalForAutoUpdates: false } });
  expect(adventure.memoryDetectionSettings.everyNTurns).toBe(17);
  cleanup();
});
