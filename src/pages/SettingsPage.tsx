import { useState } from "react";
import type {
  Adventure,
  AdventureAction,
  CloudSyncSettings,
  MemoryAutoApproveSettings,
  MemoryDetectionSettings,
  MemoryPriorityMode,
  OpenRouterProviderSort,
  ProviderRequestThrottle,
  SemanticEvaluationSettings,
  TokenBudgetSettings,
} from "../types/adventure";
import type { GlobalAdventureSettings, ProviderPreset, RuntimeProviderSettings, UiPreferences } from "./pageTypes";
import { defaultUiPreferences } from "./pageTypes";
import { CheckboxField, Field, NumberInput } from "./shared";
import {
  lightTokenBudgetPreset,
  defaultTokenBudgetSettings,
  heavyTokenBudgetPreset,
} from "../state/defaults";
import {
  createDevelopmentAdventureJson,
  createDevelopmentStoryCardsJson,
  developmentAdventureTitle,
} from "../dev/developmentAdventure";
import {
  createDispatchAdventureJson,
  createDispatchStoryCardsJson,
  dispatchAdventureTitle,
} from "../dev/dispatchAdventure";

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const fallbackThrottle: ProviderRequestThrottle = {
  enabled: false,
  minSecondsBetweenRequests: 2,
  maxRequestsPerMinute: 20,
};

interface SettingsPageProps {
  adventure?: Adventure;
  dispatch: (action: AdventureAction) => void;
  providerPresets: ProviderPreset[];
  activePresetId: string;
  onProviderPresetsChange: (presets: ProviderPreset[]) => void;
  onSelectPreset: (id: string) => void;
  uiPreferences: UiPreferences;
  onUiPreferencesChange: (prefs: UiPreferences) => void;
  globalAdventureSettings: GlobalAdventureSettings;
  onGlobalAdventureSettingsChange: (settings: GlobalAdventureSettings) => void;
  cloudSyncSettings?: CloudSyncSettings;
  cloudSyncStatus?: string;
  onCloudSyncSettingsChange?: (settings: CloudSyncSettings) => void;
  onPushCloudSync?: () => Promise<void>;
  onPullCloudSync?: () => Promise<void>;
  onLoadDevelopmentAdventure?: () => Promise<void>;
  onLoadDispatchAdventure?: () => Promise<void>;
}

export function SettingsPage({
  adventure,
  dispatch,
  providerPresets,
  activePresetId,
  onProviderPresetsChange,
  onSelectPreset,
  uiPreferences,
  onUiPreferencesChange,
  globalAdventureSettings,
  onGlobalAdventureSettingsChange,
  cloudSyncSettings,
  cloudSyncStatus,
  onCloudSyncSettingsChange,
  onPushCloudSync,
  onPullCloudSync,
  onLoadDevelopmentAdventure,
  onLoadDispatchAdventure,
}: SettingsPageProps) {
  const advanced = uiPreferences.showAdvancedSettings;
  const [expandedPresetId, setExpandedPresetId] = useState<string | null>(null);

  const activePreset = providerPresets.find((p) => p.id === activePresetId) ?? providerPresets[0];

  function updateUi(patch: Partial<UiPreferences>) {
    onUiPreferencesChange({ ...uiPreferences, ...patch });
  }

  function updateCloudSync(patch: Partial<CloudSyncSettings>) {
    if (!cloudSyncSettings || !onCloudSyncSettingsChange) return;
    onCloudSyncSettingsChange({ ...cloudSyncSettings, ...patch });
  }

  function updatePreset(id: string, patch: Partial<ProviderPreset>) {
    const updated = providerPresets.map((p) => (p.id === id ? { ...p, ...patch } : p));
    onProviderPresetsChange(updated);
    if (adventure && id === activePresetId) {
      const next = updated.find((p) => p.id === id)!;
      dispatch({ type: "SET_MODEL_CONFIG", config: next });
    }
  }

  function updatePresetApiKey(id: string, apiKey: string) {
    onProviderPresetsChange(providerPresets.map((p) => (p.id === id ? { ...p, apiKey } : p)));
  }

  function updateThrottle(id: string, patch: Partial<ProviderRequestThrottle>) {
    const preset = providerPresets.find((p) => p.id === id);
    if (!preset) return;
    const current = preset.requestThrottle ?? fallbackThrottle;
    updatePreset(id, { requestThrottle: { ...current, ...patch } });
  }

  function addPreset() {
    const base = activePreset ?? providerPresets[0];
    const newId = `preset-${Date.now()}`;
    const newPreset: ProviderPreset = { ...(base ?? { name: "", baseUrl: "", model: "", apiKey: "", temperature: 0.7, maxOutputTokens: 2048, topP: 0.95, presencePenalty: 0.8, frequencyPenalty: 0 }), id: newId, label: "New Model", apiKey: "" };
    onProviderPresetsChange([...providerPresets, newPreset]);
    setExpandedPresetId(newId);
  }

  function deletePreset(id: string) {
    const remaining = providerPresets.filter((p) => p.id !== id);
    onProviderPresetsChange(remaining);
    if (id === activePresetId && remaining.length > 0) onSelectPreset(remaining[0].id);
    if (expandedPresetId === id) setExpandedPresetId(remaining[0]?.id ?? null);
  }

  function updateBudget(patch: Partial<TokenBudgetSettings>) {
    if (adventure) { dispatch({ type: "SET_TOKEN_BUDGET_SETTINGS", settings: { ...adventure.tokenBudgetSettings, ...patch } }); return; }
    onGlobalAdventureSettingsChange({ ...globalAdventureSettings, tokenBudgetSettings: { ...activeSettings.tokenBudgetSettings, ...patch } });
  }

  function updateSemanticSettings(patch: Partial<SemanticEvaluationSettings>) {
    if (adventure) { dispatch({ type: "SET_SEMANTIC_EVALUATION_SETTINGS", settings: { ...adventure.semanticEvaluationSettings, ...patch } }); return; }
    onGlobalAdventureSettingsChange({ ...globalAdventureSettings, semanticEvaluationSettings: { ...activeSettings.semanticEvaluationSettings, ...patch } });
  }

  function updateMemoryDetection(patch: Partial<MemoryDetectionSettings>) {
    onGlobalAdventureSettingsChange({ ...globalAdventureSettings, memoryDetectionSettings: { ...globalAdventureSettings.memoryDetectionSettings, ...patch } });
  }

  function updateMemoryAutoApprove(patch: Partial<MemoryAutoApproveSettings>) {
    if (adventure) { dispatch({ type: "SET_MEMORY_AUTO_APPROVE", settings: { ...adventure.memoryAutoApprove, ...patch } }); return; }
    onGlobalAdventureSettingsChange({ ...globalAdventureSettings, memoryAutoApprove: { ...activeSettings.memoryAutoApprove, ...patch } });
  }

  const activeSettings: GlobalAdventureSettings = adventure ? {
    tokenBudgetSettings: adventure.tokenBudgetSettings,
    semanticEvaluationSettings: adventure.semanticEvaluationSettings,
    memoryDetectionSettings: adventure.memoryDetectionSettings,
    memoryAutoApprove: adventure.memoryAutoApprove,
  } : globalAdventureSettings;
  const activeModelLabel = activePreset?.label || activePreset?.model || "No model";
  const ruleInterval = activeSettings.semanticEvaluationSettings.semanticEvalEveryNTurns ?? 1;
  const backgroundStatus = activeSettings.semanticEvaluationSettings.enabled && ruleInterval > 0
    ? `every ${ruleInterval} turn${ruleInterval === 1 ? "" : "s"}`
    : "off";

  return (
    <section className="page editor-surface settings-page">
      <div className="editor-page-summary">
        <p className="muted">
          Choose how the app looks, which model tells the story, and how story memory is handled.
          Appearance, model presets, and GitHub apply on this device. Context, custom rules, and approval choices change the open adventure, or become defaults for new adventures. The narrator memory switch applies to every adventure.
        </p>
        <div className="editor-stat-row" aria-label="Settings summary">
          <span>{uiPreferences.density}</span>
          <span>{uiPreferences.darkMode ? "dark" : "light"}</span>
          <span>{activeModelLabel}</span>
          <span>AI rules {backgroundStatus}</span>
          {advanced && <span>advanced</span>}
        </div>
      </div>

      <div className="settings-section-grid">

        {/* ── Interface ─────────────────────────────── */}
        <article className="panel settings-card settings-interface-panel">
          <h3>Reading and appearance</h3>
          <CheckboxField label="Dark mode" checked={uiPreferences.darkMode} onChange={(darkMode) => updateUi({ darkMode })} />
          <div className="grid two">
            <Field label="Text color in dark mode">
              <input
                type="color"
                value={uiPreferences.darkModeTextColor || defaultUiPreferences.darkModeTextColor}
                onChange={(e) => updateUi({ darkModeTextColor: e.target.value })}
              />
            </Field>
            <Field label="Reset text color">
              <button type="button" onClick={() => updateUi({ darkModeTextColor: defaultUiPreferences.darkModeTextColor })}>
                Reset
              </button>
            </Field>
          </div>
          <Field label="Spacing">
            <select
              value={uiPreferences.density}
              onChange={(e) => updateUi({ density: e.target.value as "compact" | "comfortable" })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </Field>
          <div className="grid two">
            <Field label="Story text size">
              <NumberInput min={12} max={24} value={uiPreferences.storyFontSize} onChange={(storyFontSize) => updateUi({ storyFontSize })} />
            </Field>
            <Field label="Story reading width">
              <NumberInput min={520} max={1800} value={uiPreferences.storyContentWidth} onChange={(storyContentWidth) => updateUi({ storyContentWidth })} />
            </Field>
            <Field label="Story position">
              <select
                value={uiPreferences.storyContentAlign}
                onChange={(e) => updateUi({ storyContentAlign: e.target.value as UiPreferences["storyContentAlign"] })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </Field>
            <Field label="Width of menus and editors">
              <NumberInput min={600} max={1800} value={uiPreferences.maxContentWidth} onChange={(maxContentWidth) => updateUi({ maxContentWidth })} />
            </Field>
          </div>
          <CheckboxField
            label="Show estimated model usage while playing"
            checked={uiPreferences.showTokenEstimates}
            onChange={(showTokenEstimates) => updateUi({ showTokenEstimates })}
          />
          <p className="muted">Reading width and text size change the story display on this device. They do not change the words sent to the model.</p>
          <CheckboxField
            label="Show advanced settings"
            checked={uiPreferences.showAdvancedSettings}
            onChange={(showAdvancedSettings) => updateUi({ showAdvancedSettings })}
          />
        </article>

        {/* ── Models ────────────────────────────────── */}
        <article className="panel settings-card settings-models-panel">
          <div className="preset-list-header">
            <h3 style={{ margin: 0 }}>Models</h3>
            <button type="button" onClick={addPreset}>+ Add Model</button>
          </div>
          {providerPresets.map((preset) => {
            const isActive = preset.id === activePresetId;
            const isExpanded = expandedPresetId === preset.id;
            return (
              <div key={preset.id} className="preset-item">
                <div className="preset-item-header">
                  <button
                    type="button"
                    className="preset-item-toggle"
                    onClick={() => setExpandedPresetId(isExpanded ? null : preset.id)}
                  >
                    <strong>{preset.label || "(unnamed)"}</strong>
                    <span className="muted preset-item-model"> · {preset.model || "no model set"}</span>
                    <span className="preset-item-caret">{isExpanded ? " ▲" : " ▼"}</span>
                  </button>
                  <div className="preset-item-actions">
                    {isActive ? (
                      <span className="status-pill">Active</span>
                    ) : (
                      <button type="button" onClick={() => onSelectPreset(preset.id)}>Use</button>
                    )}
                    {providerPresets.length > 1 && (
                      <button type="button" className="danger" onClick={() => deletePreset(preset.id)}>Delete</button>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="preset-item-form">
                    <Field label="Name shown in the app">
                      <input value={preset.label} onChange={(e) => updatePreset(preset.id, { label: e.target.value })} />
                    </Field>
                    <Field label="Provider API address">
                      <input value={preset.baseUrl} onChange={(e) => updatePreset(preset.id, { baseUrl: e.target.value })} />
                    </Field>
                    <Field label="Model ID">
                      <input value={preset.model} onChange={(e) => updatePreset(preset.id, { model: e.target.value })} />
                    </Field>
                    <Field label="API Key">
                      <input
                        type="password"
                        value={preset.apiKey}
                        onChange={(e) => updatePresetApiKey(preset.id, e.target.value)}
                        placeholder="Stored only in localStorage"
                      />
                    </Field>
                    <p className="muted">Enter the API address, model ID, and key supplied by your model provider. The key stays in this browser and is not included in adventure saves.</p>
                    {advanced && <div className="grid two">
                      <Field label="Writing variety (temperature)">
                        <NumberInput value={preset.temperature} onChange={(temperature) => updatePreset(preset.id, { temperature })} />
                      </Field>
                      <Field label="Maximum response tokens">
                        <NumberInput min={1} value={preset.maxOutputTokens} onChange={(maxOutputTokens) => updatePreset(preset.id, { maxOutputTokens })} />
                      </Field>
                      <Field label="Word choice variety (Top P; 1 = off)">
                        <NumberInput min={0} max={1} value={preset.topP ?? 1} onChange={(topP) => updatePreset(preset.id, { topP })} />
                      </Field>
                      <Field label="Word choice limit (Top K; 0 = off)">
                        <NumberInput min={0} value={preset.topK ?? 0} onChange={(topK) => updatePreset(preset.id, { topK: topK || undefined })} />
                      </Field>
                      <Field label="Encourage new topics (presence penalty; 0–2)">
                        <NumberInput min={0} value={preset.presencePenalty ?? 0} onChange={(presencePenalty) => updatePreset(preset.id, { presencePenalty })} />
                      </Field>
                      <Field label="Reduce repeated words (frequency penalty; 0–2)">
                        <NumberInput min={0} value={preset.frequencyPenalty ?? 0} onChange={(frequencyPenalty) => updatePreset(preset.id, { frequencyPenalty })} />
                      </Field>
                    </div>}
                    {advanced && <p className="muted" style={{ fontSize: "0.8em", margin: "0.25rem 0 0" }}>
                      These model options change how varied the writing can be. The story length control in Play may set a lower response limit than Maximum response tokens. Some providers ignore unsupported options.
                    </p>}
                    {advanced && (
                      <>
                        <CheckboxField
                          label="Reuse repeated prompt text when the provider supports it"
                          checked={preset.promptCaching ?? false}
                          onChange={(promptCaching) => updatePreset(preset.id, { promptCaching })}
                        />
                        <Field label="OpenRouter routing preference">
                          <select
                            value={preset.openRouterProviderSort ?? ""}
                            onChange={(e) =>
                              updatePreset(preset.id, {
                                openRouterProviderSort: (e.target.value || undefined) as OpenRouterProviderSort | undefined,
                              })
                            }
                          >
                            <option value="">Balanced default</option>
                            <option value="price">Lowest price</option>
                            <option value="latency">Lowest latency</option>
                            <option value="throughput">Highest throughput</option>
                          </select>
                        </Field>
                        <p className="muted">
                          OpenRouter's default already weighs lower price with uptime. Lowest price disables that
                          load balancing; use latency or throughput if the model is feeling slow.
                        </p>
                        <h4>Request limits</h4>
                        <p className="muted">Space out model requests if your provider has a rate limit. This also slows background AI tasks.</p>
                        <CheckboxField
                          label="Enable API request throttle"
                          checked={preset.requestThrottle?.enabled ?? fallbackThrottle.enabled}
                          onChange={(enabled) => updateThrottle(preset.id, { enabled })}
                        />
                        <div className="grid two">
                          <Field label="Minimum seconds between API calls">
                            <NumberInput
                              min={0}
                              value={preset.requestThrottle?.minSecondsBetweenRequests ?? fallbackThrottle.minSecondsBetweenRequests}
                              onChange={(minSecondsBetweenRequests) => updateThrottle(preset.id, { minSecondsBetweenRequests })}
                            />
                          </Field>
                          <Field label="Max API calls per minute">
                            <NumberInput
                              min={0}
                              value={preset.requestThrottle?.maxRequestsPerMinute ?? fallbackThrottle.maxRequestsPerMinute}
                              onChange={(maxRequestsPerMinute) => updateThrottle(preset.id, { maxRequestsPerMinute })}
                            />
                          </Field>
                        </div>
                        <p className="muted">Enforced before every provider call. Use 0 for no per-minute cap.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="muted" style={{ marginTop: "0.5rem" }}>Each model preset is saved on this device. API keys are not written to adventure saves.</p>
        </article>

        <article className="panel settings-card settings-section-full">
          <h3>Remember story details</h3>
          <CheckboxField label="Let the narrator suggest memories while writing" checked={globalAdventureSettings.memoryDetectionSettings.enabled} onChange={(enabled) => updateMemoryDetection({ enabled })} />
          <p className="muted">Applies to every adventure on this device. The narrator can include small, evidence-based memory updates with a story response. Some changes wait in Memory Suggestions for your review. If an update is missing or unreadable, a separate recovery request may run. Custom AI rules and continuity checks can also make extra requests.</p>
        </article>
        {/* ── Context Budget (advanced) ─────────────── */}
        {advanced && (
          <article className="panel settings-card settings-section-full" style={{ gridColumn: "1 / -1" }}>
            <h3>What the model remembers each turn</h3>
            <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
              <button type="button" title="8k tokens, 15 messages, tight section budgets" onClick={() => updateBudget(lightTokenBudgetPreset)}>Light</button>
              <button type="button" title="16k tokens, 40 messages — balanced default" onClick={() => updateBudget(defaultTokenBudgetSettings)}>Normal</button>
              <button type="button" title="32k tokens, 80 messages, large section budgets — maximum context" onClick={() => updateBudget(heavyTokenBudgetPreset)}>Heavy</button>
            </div>
            <div className="grid two">
              <Field label="Total prompt token limit">
                <NumberInput
                  min={512}
                  value={activeSettings.tokenBudgetSettings.maxContextTokens}
                  onChange={(value) => updateBudget({ maxContextTokens: value })}
                />
              </Field>
              <Field label="Maximum recent messages">
                <NumberInput
                  min={0}
                  value={activeSettings.tokenBudgetSettings.maxRecentMessages}
                  onChange={(value) => updateBudget({ maxRecentMessages: value })}
                />
              </Field>
              <Field label="What to trim first when the prompt is full">
                <select
                  value={activeSettings.tokenBudgetSettings.memoryPriorityMode}
                  onChange={(e) => updateBudget({ memoryPriorityMode: e.target.value as MemoryPriorityMode })}
                >
                  <option value="userLocked">Older messages first</option>
                  <option value="systemSuggested">Lowest priority details first</option>
                  <option value="hybrid">Suggested details, then older messages</option>
                </select>
              </Field>
              <Field label="Recent messages checked for Story Card and character matches">
                <NumberInput
                  min={0}
                  value={activeSettings.tokenBudgetSettings.recentMessageWindow}
                  onChange={(value) => updateBudget({ recentMessageWindow: value })}
                />
              </Field>
            </div>
            <p className="muted">Light, Normal, and Heavy set starting limits. Larger limits can cost more and may exceed what your model accepts.</p>
            <div className="grid two" style={{ marginTop: "0.5rem" }}>
              <div>
                <CheckboxField
                  label="Let the app choose which memory to keep when space is tight"
                  checked={activeSettings.tokenBudgetSettings.allowSystemToPrioritizeMemory}
                  onChange={(allowSystemToPrioritizeMemory) => updateBudget({ allowSystemToPrioritizeMemory })}
                />
                <CheckboxField
                  label="Allow unpinned Story Cards to be left out when space is tight"
                  checked={activeSettings.tokenBudgetSettings.allowSystemToDropUnpinnedTriggeredCards}
                  onChange={(allowSystemToDropUnpinnedTriggeredCards) => updateBudget({ allowSystemToDropUnpinnedTriggeredCards })}
                />
              </div>
              <Field label="Token limit for recent story messages">
                <NumberInput
                  min={0}
                  value={activeSettings.tokenBudgetSettings.sectionBudgets.recentMessages ?? 3000}
                  onChange={(recentMessages) => updateBudget({ sectionBudgets: { ...activeSettings.tokenBudgetSettings.sectionBudgets, recentMessages } })}
                />
              </Field>
            </div>
            <p className="muted">The model sees selected story details and recent messages, not the full Chronicle. Protected details stay in the prompt. Pinned details get priority but may still be left out to fit the limit.</p>
          </article>
        )}

        {/* ── LLM Evaluation (advanced) ─────────────── */}
        {advanced && (
          <article className="panel settings-card">
            <h3>Background AI and custom rules</h3>
            <p className="muted">Continuity checks, memory recovery, and custom AI rules can make extra model requests. Custom rules run after turns only when you have created them on the Automations page and enabled them below.</p>
            <Field label="Alternative model ID on the active API (optional)">
              <input
                value={activeSettings.semanticEvaluationSettings.evaluationModel}
                placeholder={activePreset?.model ?? ""}
                onChange={(e) => updateSemanticSettings({ evaluationModel: e.target.value })}
              />
            </Field>
            <Field label="Recent messages used for background checks">
              <NumberInput
                min={1}
                value={activeSettings.semanticEvaluationSettings.messagesIncluded}
                onChange={(messagesIncluded) => updateSemanticSettings({ messagesIncluded })}
              />
            </Field>
            <Field label="Check rules every number of turns (0 = never)">
              <NumberInput
                min={0}
                value={activeSettings.semanticEvaluationSettings.semanticEvalEveryNTurns ?? 1}
                onChange={(semanticEvalEveryNTurns) => updateSemanticSettings({ semanticEvalEveryNTurns })}
              />
            </Field>
            <CheckboxField
              label="Run custom AI rules after turns"
              checked={activeSettings.semanticEvaluationSettings.enabled}
              onChange={(enabled) => updateSemanticSettings({ enabled })}
            />
            <CheckboxField
              label="Show AI rule decisions on the Automations page"
              checked={activeSettings.semanticEvaluationSettings.showLog}
              onChange={(showLog) => updateSemanticSettings({ showLog })}
            />
            <Field label="Maximum background updates at once">
              <NumberInput
                min={1}
                value={activeSettings.semanticEvaluationSettings.maxParallelUpdateCalls}
                onChange={(maxParallelUpdateCalls) => updateSemanticSettings({ maxParallelUpdateCalls })}
              />
            </Field>
            <CheckboxField
              label="Ask before saving changes made by custom AI rules"
              checked={activeSettings.semanticEvaluationSettings.requireApprovalForAutoUpdates ?? true}
              onChange={(requireApprovalForAutoUpdates) => updateSemanticSettings({ requireApprovalForAutoUpdates })}
            />
            <p className="muted">
              When on, changes made by custom AI rules appear in Memory Suggestions for review. The memory controls below govern routine story memory.
            </p>
            <h4>Background model connection</h4>
            <p className="muted">
              Optional: send background AI work to a different API address and model. Leave both blank to use the active model.
              Background requests use the active model's API key unless you enter a separate key below. A separate key works for this session only; it is not saved with the adventure.
            </p>
            <Field label="Base URL">
              <input
                value={activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.baseUrl ?? ""}
                placeholder="https://api.groq.com/openai/v1"
                onChange={(e) =>
                  updateSemanticSettings({
                    backgroundProviderConfig: {
                      ...activeSettings.semanticEvaluationSettings.backgroundProviderConfig,
                      baseUrl: e.target.value,
                      model: activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.model ?? "",
                    },
                  })
                }
              />
            </Field>
            <Field label="Separate API key for background work (this session only)">
              <input
                type="password"
                value={activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.apiKey ?? ""}
                onChange={(e) =>
                  updateSemanticSettings({
                    backgroundProviderConfig: {
                      ...activeSettings.semanticEvaluationSettings.backgroundProviderConfig,
                      baseUrl: activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.baseUrl ?? "",
                      model: activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.model ?? "",
                      apiKey: e.target.value,
                    },
                  })
                }
              />
            </Field>
            <Field label="Model">
              <input
                value={activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.model ?? ""}
                placeholder="llama-3.3-70b-versatile"
                onChange={(e) =>
                  updateSemanticSettings({
                    backgroundProviderConfig: {
                      ...activeSettings.semanticEvaluationSettings.backgroundProviderConfig,
                      baseUrl: activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.baseUrl ?? "",
                      model: e.target.value,
                    },
                  })
                }
              />
            </Field>
          </article>
        )}

        {/* ── Memory Detection (advanced) ───────────── */}
        {advanced && (
          <article className="panel settings-card">
            <h3>Which memory changes need review?</h3>
            <p className="muted">
              The narrator returns evidenced memory suggestions with the story. Local checks reject malformed, duplicate, or unsupported updates without another API call.
            </p>
            <p className="muted">These choices apply to the open adventure, or to new adventures when none is open. They also affect suggestions created by manual tools, even when narrator memory is off. When a switch is off, suggestions of that type wait for you in Memory Suggestions.</p>
            <div className="auto-approve-toggles">
              <span className="auto-approve-label muted">Auto-approve:</span>
              <CheckboxField label="Plot Essentials" checked={activeSettings.memoryAutoApprove.plotEssentialsUpdate} onChange={(plotEssentialsUpdate) => updateMemoryAutoApprove({ plotEssentialsUpdate })} />
              <CheckboxField label="Active Pressure" checked={activeSettings.memoryAutoApprove.plotPressureUpdate} onChange={(plotPressureUpdate) => updateMemoryAutoApprove({ plotPressureUpdate })} />
              <CheckboxField label="Current Arc developments" checked={activeSettings.memoryAutoApprove.currentArcUpdate} onChange={(currentArcUpdate) => updateMemoryAutoApprove({ currentArcUpdate })} />
              <CheckboxField label="New arc suggestions from story history" checked={activeSettings.memoryAutoApprove.arcProposal} onChange={(arcProposal) => updateMemoryAutoApprove({ arcProposal })} />
              <CheckboxField label="Story Cards" checked={activeSettings.memoryAutoApprove.storyCard} onChange={(storyCard) => updateMemoryAutoApprove({ storyCard })} />
              <CheckboxField label="Character memory (thoughts during narration)" checked={activeSettings.memoryAutoApprove.brainUpdate} onChange={(brainUpdate) => updateMemoryAutoApprove({ brainUpdate })} />
            </div>
            <p className="muted">
              Story Cards preserve lasting facts; Character thoughts hold private reactions; Active Pressure is the immediate outside threat; Current Arc tracks the ongoing storyline. Plot Essentials changes the story's foundations and always needs review when suggested during narration. Plot cards and protected Story Cards also always need review.
            </p>
          </article>
        )}

        {/* ── Cloud Sync ────────────────────────────── */}
        {cloudSyncSettings && onCloudSyncSettingsChange && (
          <article className="panel settings-card settings-section-full cloud-sync-panel" style={{ gridColumn: "1 / -1" }}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Personal Cloud Sync</p>
                <h3>Move adventures between devices</h3>
                <p className="muted">
                  Copy adventures between devices using a GitHub repository. Use a private repository for personal stories. The GitHub token stays in this browser, not in adventure saves.
                </p>
              </div>
            </div>

            <div className="grid three">
              <Field label="GitHub token">
                <input
                  type="password"
                  value={cloudSyncSettings.token}
                  onChange={(e) => updateCloudSync({ token: e.target.value })}
                  placeholder="Fine-grained token with repo contents access"
                />
              </Field>
              <Field label="GitHub owner or username">
                <input
                  value={cloudSyncSettings.owner}
                  onChange={(e) => updateCloudSync({ owner: e.target.value })}
                  placeholder="Leave blank to use token owner"
                />
              </Field>
              <Field label="GitHub repository name">
                <input
                  value={cloudSyncSettings.repo}
                  onChange={(e) => updateCloudSync({ repo: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid three">
              <Field label="Branch">
                <input
                  value={cloudSyncSettings.branch}
                  onChange={(e) => updateCloudSync({ branch: e.target.value })}
                />
              </Field>
              <Field label="Sync file path">
                <input
                  value={cloudSyncSettings.path}
                  onChange={(e) => updateCloudSync({ path: e.target.value })}
                />
              </Field>
              <CheckboxField
                label="Create private repo if missing"
                checked={cloudSyncSettings.createPrivateRepoIfMissing}
                onChange={(createPrivateRepoIfMissing) => updateCloudSync({ createPrivateRepoIfMissing })}
              />
            </div>

            <div className="toolbar">
              <button type="button" disabled={!onPullCloudSync} onClick={onPullCloudSync}>
                Pull From GitHub
              </button>
              <button type="button" disabled={!onPushCloudSync} onClick={onPushCloudSync}>
                Push To GitHub
              </button>
              {cloudSyncStatus && <span className="status-pill">{cloudSyncStatus}</span>}
            </div>
            <p className="notice">
              Pull combines this device's adventures with GitHub; Push uploads the combined library. For the same adventure, the more recently changed copy wins. Model API keys are never included.
            </p>
          </article>
        )}

        {/* ── Dev Adventure (advanced) ──────────────── */}
        {advanced && onLoadDevelopmentAdventure && (
          <details className="panel settings-card settings-section-full dev-adventure-panel" style={{ gridColumn: "1 / -1" }}>
            <summary>Developer Test Adventure</summary>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Playtest Seed</p>
                <h3>{developmentAdventureTitle}</h3>
                <p className="muted">
                  Loads a complete adult Fire Nation AU scenario with World Blocks, Story Cards, Characters,
                  semantic triggers, a quest, legacy rolling summary data, and one opening message.
                </p>
              </div>
            </div>
            <div className="toolbar">
              <button type="button" onClick={onLoadDevelopmentAdventure}>
                Load Development Adventure
              </button>
              <button
                type="button"
                onClick={() => downloadJson("ai-story-teller-dev-adventure.json", createDevelopmentAdventureJson())}
              >
                Download Adventure JSON
              </button>
              <button
                type="button"
                onClick={() => downloadJson("ai-story-teller-dev-story-cards.json", createDevelopmentStoryCardsJson())}
              >
                Download Story Cards JSON
              </button>
            </div>
            <p className="notice">
              The full adventure JSON can be re-uploaded through Import / Export. The Story Cards JSON can be
              pasted or uploaded in New Adventure setup or the Story Cards editor.
            </p>
          </details>
        )}

        {advanced && onLoadDispatchAdventure && (
          <details className="panel settings-card settings-section-full dev-adventure-panel" style={{ gridColumn: "1 / -1" }}>
            <summary>Developer Test Adventure — Dispatch (Supers)</summary>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Playtest Seed</p>
                <h3>{dispatchAdventureTitle}</h3>
                <p className="muted">
                  Loads the SDN superhero dispatch scenario: Seth / Titan (Absolute Adaptation), Z-Team, a
                  five-way romantic tangle, a mission loop, preloaded brains, and a configured Arc Director
                  pointed at Shroud and the Red Ring.
                </p>
              </div>
            </div>
            <div className="toolbar">
              <button type="button" onClick={onLoadDispatchAdventure}>
                Load Dispatch Adventure
              </button>
              <button
                type="button"
                onClick={() => downloadJson("ai-story-teller-dispatch-adventure.json", createDispatchAdventureJson())}
              >
                Download Adventure JSON
              </button>
              <button
                type="button"
                onClick={() => downloadJson("ai-story-teller-dispatch-story-cards.json", createDispatchStoryCardsJson())}
              >
                Download Story Cards JSON
              </button>
            </div>
            <p className="notice">
              The full adventure JSON can be re-uploaded through Import / Export. The Story Cards JSON can be
              pasted or uploaded in New Adventure setup or the Story Cards editor.
            </p>
          </details>
        )}

      </div>
    </section>
  );
}
