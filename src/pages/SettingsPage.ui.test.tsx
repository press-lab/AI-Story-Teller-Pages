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
    await user.click(screen.getByLabelText("Reuse repeated prompt text when the provider supports it"));

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

describe("Settings cleanup", () => {
  afterEach(() => cleanup());

  it("hides retired controls and keeps the live recent-message token limit editable", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn<(action: AdventureAction) => void>();
    render(
      <SettingsPage
        adventure={createDefaultAdventure("Settings cleanup")}
        dispatch={dispatch}
        providerPresets={[makePreset()]}
        activePresetId="preset-test"
        onProviderPresetsChange={vi.fn()}
        onSelectPreset={vi.fn()}
        uiPreferences={{ ...defaultUiPreferences, showAdvancedSettings: true }}
        onUiPreferencesChange={vi.fn()}
        globalAdventureSettings={{
          ...defaultGlobalAdventureSettings,
          memoryDetectionSettings: { ...defaultGlobalAdventureSettings.memoryDetectionSettings, enabled: false },
        }}
        onGlobalAdventureSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Story Cards")).toBeInTheDocument();
    expect(screen.queryByLabelText("Allow system to truncate rolling summary (legacy)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Auto-summarize in background (legacy)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Scene state every N turns (0 = manual only)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Section Budgets JSON")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Legacy Summary")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Let the narrator suggest memories while writing")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Test Model/ }));
    expect(screen.queryByLabelText("Provider Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Separate API key for background work (this session only)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Token limit for recent story messages"), { target: { value: "1800" } });
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "SET_TOKEN_BUDGET_SETTINGS",
      settings: expect.objectContaining({
        sectionBudgets: expect.objectContaining({ recentMessages: 1800 }),
      }),
    }));
  });
});
