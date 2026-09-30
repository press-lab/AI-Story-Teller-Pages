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

  it("shows only applicable provider controls and reports inactive semantic rules", async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        adventure={createDefaultAdventure("Settings Test")}
        dispatch={vi.fn()}
        providerPresets={[makePreset()]}
        activePresetId="preset-test"
        onProviderPresetsChange={vi.fn()}
        onSelectPreset={vi.fn()}
        uiPreferences={{ ...defaultUiPreferences, showAdvancedSettings: true }}
        onUiPreferencesChange={vi.fn()}
        globalAdventureSettings={defaultGlobalAdventureSettings}
        onGlobalAdventureSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText("No semantic automations active")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Remember while narrating")).toHaveLength(1);
    expect(screen.queryByLabelText(/Top K/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRouter routing preference")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Enable prompt caching / sticky sessions")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Section Budgets JSON")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Test Model/ }));
    expect(screen.queryByLabelText(/Top K/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Presence Penalty (reduces looping; 0–2)")).toBeInTheDocument();
  });

  it("hides rejected sampling controls on the DeepSeek Anthropic path", async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        adventure={createDefaultAdventure("Anthropic Settings")}
        dispatch={vi.fn()}
        providerPresets={[{ ...makePreset(), baseUrl: "https://api.deepseek.com/anthropic" }]}
        activePresetId="preset-test"
        onProviderPresetsChange={vi.fn()}
        onSelectPreset={vi.fn()}
        uiPreferences={{ ...defaultUiPreferences, showAdvancedSettings: true }}
        onUiPreferencesChange={vi.fn()}
        globalAdventureSettings={defaultGlobalAdventureSettings}
        onGlobalAdventureSettingsChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Test Model/ }));
    expect(screen.queryByLabelText(/Top K/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Presence Penalty/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Frequency Penalty/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Enable prompt caching / sticky sessions")).toBeInTheDocument();
  });

  it("lets the user enable prompt caching on the active provider preset", async () => {
    const user = userEvent.setup();
    const onProviderPresetsChange = vi.fn();
    const dispatch = vi.fn<(action: AdventureAction) => void>();
    const advancedPrefs: UiPreferences = { ...defaultUiPreferences, showAdvancedSettings: true };

    function StatefulSettingsPage() {
      const [presets, setPresets] = useState([{ ...makePreset(), baseUrl: "https://openrouter.ai/api/v1" }]);
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
      const [presets, setPresets] = useState([{ ...makePreset(), baseUrl: "https://openrouter.ai/api/v1" }]);
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
    expect(screen.getByLabelText("Top K (0 = off)")).toBeInTheDocument();
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
