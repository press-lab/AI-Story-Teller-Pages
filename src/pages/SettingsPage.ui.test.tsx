/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
