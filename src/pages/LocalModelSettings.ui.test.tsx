/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { LocalModelSettings } from "./LocalModelSettings";
import { defaultGlobalAdventureSettings, defaultUiPreferences, type ProviderPreset } from "./pageTypes";
import { defaultModelConfig, sanitizeAdventureForPersistence, createDefaultAdventure } from "../state/defaults";
import { localProviderDefaults } from "../providers/providerConfig";

const online: ProviderPreset = { ...defaultModelConfig, id: "online", label: "My online model", apiKey: "cloud-key", maxOutputTokens: 32768 };
const local: ProviderPreset = { ...online, ...localProviderDefaults, id: "local", label: "Local Qwen" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("adds a local preset without changing online credentials or making requests, and preserves its editable settings", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const changed = vi.fn();
  function Harness() {
    const [presets, setPresets] = useState([online]);
    return <SettingsPage dispatch={vi.fn()} providerPresets={presets} activePresetId="online"
      onProviderPresetsChange={next => { changed(next); setPresets(next); }} onSelectPreset={vi.fn()}
      uiPreferences={defaultUiPreferences} onUiPreferencesChange={vi.fn()} globalAdventureSettings={defaultGlobalAdventureSettings} onGlobalAdventureSettingsChange={vi.fn()} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add Model" }));
  fireEvent.click(screen.getByRole("button", { name: "Local (this device)" }));
  const created = changed.mock.calls.at(-1)![0] as ProviderPreset[];
  expect(created[0]).toEqual(online);
  expect(created[1]).toMatchObject({ connectionType: "local", authMode: "none", model: "aist-qwen", apiKey: "", baseUrl: "http://127.0.0.1:8080/v1", maxOutputTokens: 2048 });
  expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Server context capacity (tokens)"), { target: { value: "16384" } });
  expect(changed.mock.calls.at(-1)![0][1].contextWindowTokens).toBe(16384);
  expect(fetch).not.toHaveBeenCalled();
});
it("discovers models, runs generation only on click, and resets status after edits", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "aist-qwen" }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Local model ready." } }] })));
  vi.stubGlobal("fetch", fetch);
  const view = render(<LocalModelSettings preset={local} onChange={vi.fn()} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Test Connection/ }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Connection ready"));
  expect(screen.getByLabelText("Discovered models")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Test Generation" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Generation ready"));
  expect(fetch).toHaveBeenCalledTimes(2);
  view.rerender(<LocalModelSettings preset={{ ...local, baseUrl: "http://127.0.0.1:8081/v1" }} onChange={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Not tested");
});
it("aborts an in-flight test when the preset changes and ignores late results", async () => {
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url, init) => { requestSignal = init.signal; return new Promise(() => {}); }));
  const view = render(<LocalModelSettings preset={local} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Test Connection/ }));
  expect(screen.getByRole("button", { name: "Cancel Test" })).toBeInTheDocument();
  view.rerender(<LocalModelSettings preset={{ ...local, model: "changed" }} onChange={vi.fn()} />);
  expect(requestSignal?.aborted).toBe(true);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Not tested"));
});
it("persists background local capabilities but excludes both provider keys", () => {
  const a = createDefaultAdventure();
  a.modelConfig = { ...local, apiKey: "local-secret" };
  a.semanticEvaluationSettings.backgroundProviderConfig = { ...local, apiKey: "background-secret" };
  const persisted = sanitizeAdventureForPersistence(a);
  expect(JSON.stringify(persisted)).not.toContain("local-secret");
  expect(JSON.stringify(persisted)).not.toContain("background-secret");
  expect(persisted.semanticEvaluationSettings.backgroundProviderConfig).toMatchObject({ connectionType: "local", localRuntime: "llamaCpp", contextWindowTokens: 32768 });
});
