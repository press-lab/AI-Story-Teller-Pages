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
import { CheckboxField, Field, JsonTextarea, NumberInput } from "./shared";
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
  const backgroundStatus = activeSettings.semanticEvaluationSettings.enabled
    ? `every ${activeSettings.semanticEvaluationSettings.semanticEvalEveryNTurns ?? 1} turns`
    : "off";

  return (
    <section className="page editor-surface settings-page">
      <div className="editor-page-summary">
        <p className="muted">
          App-wide controls for reading comfort, model routing, background cost, memory detection, and sync.
          The common controls stay first; advanced controls stay grouped below.
        </p>
        <div className="editor-stat-row" aria-label="Settings summary">
          <span>{uiPreferences.density}</span>
          <span>{uiPreferences.darkMode ? "dark" : "light"}</span>
          <span>{activeModelLabel}</span>
          <span>background {backgroundStatus}</span>
          {advanced && <span>advanced</span>}
        </div>
      </div>

      <div className="settings-section-grid">

        {/* ── Interface ─────────────────────────────── */}
        <article className="panel settings-card settings-interface-panel">
          <h3>Interface</h3>
          <CheckboxField label="Dark mode" checked={uiPreferences.darkMode} onChange={(darkMode) => updateUi({ darkMode })} />
          <div className="grid two">
            <Field label="Dark mode text color">
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
          <Field label="Density">
            <select
              value={uiPreferences.density}
              onChange={(e) => updateUi({ density: e.target.value as "compact" | "comfortable" })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </Field>
          <div className="grid two">
            <Field label="Story text size (px)">
              <NumberInput min={12} max={24} value={uiPreferences.storyFontSize} onChange={(storyFontSize) => updateUi({ storyFontSize })} />
            </Field>
            <Field label="Story box width (px)">
              <NumberInput min={520} max={1800} value={uiPreferences.storyContentWidth} onChange={(storyContentWidth) => updateUi({ storyContentWidth })} />
            </Field>
            <Field label="Story box position">
              <select
                value={uiPreferences.storyContentAlign}
                onChange={(e) => updateUi({ storyContentAlign: e.target.value as UiPreferences["storyContentAlign"] })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </Field>
            <Field label="Max content width (px)">
              <NumberInput min={600} max={1800} value={uiPreferences.maxContentWidth} onChange={(maxContentWidth) => updateUi({ maxContentWidth })} />
            </Field>
          </div>
          <CheckboxField
            label="Show token estimates in play"
            checked={uiPreferences.showTokenEstimates}
            onChange={(showTokenEstimates) => updateUi({ showTokenEstimates })}
          />
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
                    <div className="grid two">
                      <Field label="Label">
                        <input value={preset.label} onChange={(e) => updatePreset(preset.id, { label: e.target.value })} />
                      </Field>
                      <Field label="Provider Name">
                        <input value={preset.name} onChange={(e) => updatePreset(preset.id, { name: e.target.value })} />
                      </Field>
                    </div>
                    <Field label="Base URL">
                      <input value={preset.baseUrl} onChange={(e) => updatePreset(preset.id, { baseUrl: e.target.value })} />
                    </Field>
                    <Field label="Model">
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
                    <div className="grid two">
                      <Field label="Temperature">
                        <NumberInput value={preset.temperature} onChange={(temperature) => updatePreset(preset.id, { temperature })} />
                      </Field>
                      <Field label="Max Output Tokens">
                        <NumberInput min={1} value={preset.maxOutputTokens} onChange={(maxOutputTokens) => updatePreset(preset.id, { maxOutputTokens })} />
                      </Field>
                      <Field label="Top P (nucleus; 1 = off)">
                        <NumberInput min={0} max={1} value={preset.topP ?? 1} onChange={(topP) => updatePreset(preset.id, { topP })} />
                      </Field>
                      <Field label="Top K (0 = off; unsupported on DeepSeek)">
                        <NumberInput min={0} value={preset.topK ?? 0} onChange={(topK) => updatePreset(preset.id, { topK: topK || undefined })} />
                      </Field>
                      <Field label="Presence Penalty (reduces looping; 0–2)">
                        <NumberInput min={0} value={preset.presencePenalty ?? 0} onChange={(presencePenalty) => updatePreset(preset.id, { presencePenalty })} />
                      </Field>
                      <Field label="Frequency Penalty (0–2)">
                        <NumberInput min={0} value={preset.frequencyPenalty ?? 0} onChange={(frequencyPenalty) => updatePreset(preset.id, { frequencyPenalty })} />
                      </Field>
                    </div>
                    <p className="muted" style={{ fontSize: "0.8em", margin: "0.25rem 0 0" }}>
                      Storytelling profile (AID-style): Temp ~0.7, Top P 0.95, Presence ~0.8. Lower temp + a presence
                      penalty keeps prose coherent without looping. Top K only works on providers that support it.
                    </p>
                    {advanced && (
                      <>
                        <CheckboxField
                          label="Enable prompt caching / sticky sessions"
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
                        <h4>API Throttle</h4>
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
          <p className="muted" style={{ marginTop: "0.5rem" }}>API keys are not written to adventure JSON or IndexedDB saves.</p>
        </article>

        {/* ── Background Cost Mode ──────────────────── */}
        {(() => {
          const sem = activeSettings.semanticEvaluationSettings;
          const bud = activeSettings.tokenBudgetSettings;
          const mem = globalAdventureSettings.memoryDetectionSettings;
          const isOff = !sem.enabled;
          const isLight = sem.enabled && (sem.semanticEvalEveryNTurns ?? 1) >= 5 && (bud.autoSceneStateEveryNTurns ?? 1) >= 5 && mem.enabled && mem.everyNTurns >= 5;
          const isNormal = sem.enabled && (sem.semanticEvalEveryNTurns ?? 1) === 2 && (bud.autoSceneStateEveryNTurns ?? 1) === 2 && mem.enabled && mem.everyNTurns === 3;
          const isHeavy = sem.enabled && (sem.semanticEvalEveryNTurns ?? 1) === 1 && (bud.autoSceneStateEveryNTurns ?? 1) === 1 && mem.enabled && mem.everyNTurns === 1;
          return (
            <article className="panel settings-card settings-section-full" style={{ gridColumn: "1 / -1" }}>
              <h3>Background Cost</h3>
              <div className="toolbar" style={{ marginBottom: "0.5rem" }}>
                <button type="button" className={isOff ? "active" : ""} title="Disable all background AI calls. Play-only." onClick={() => {
                  updateSemanticSettings({ enabled: false, semanticEvalEveryNTurns: 1 });
                  updateBudget({ autoSceneStateEveryNTurns: 0 });
                  updateMemoryDetection({ enabled: false });
                }}>Off</button>
                <button type="button" className={isLight ? "active" : ""} title="PE/Summary check every 5 turns. Character thoughts are free (inline)." onClick={() => {
                  updateSemanticSettings({ enabled: true, semanticEvalEveryNTurns: 5 });
                  updateBudget({ autoSceneStateEveryNTurns: 5 });
                  updateMemoryDetection({ enabled: true, everyNTurns: 5 });
                }}>Light</button>
                <button type="button" className={isNormal ? "active" : ""} title="PE/Summary check every 2–3 turns. Balanced." onClick={() => {
                  updateSemanticSettings({ enabled: true, semanticEvalEveryNTurns: 2 });
                  updateBudget({ autoSceneStateEveryNTurns: 2 });
                  updateMemoryDetection({ enabled: true, everyNTurns: 3 });
                }}>Normal</button>
                <button type="button" className={isHeavy ? "active" : ""} title="PE/Summary check every turn. Maximum tracking." onClick={() => {
                  updateSemanticSettings({ enabled: true, semanticEvalEveryNTurns: 1 });
                  updateBudget({ autoSceneStateEveryNTurns: 1 });
                  updateMemoryDetection({ enabled: true, everyNTurns: 1 });
                }}>Heavy</button>
              </div>
              <div className="grid three" style={{ marginTop: "0.5rem" }}>
                <Field label="Memory every N turns">
                  <NumberInput min={1} value={mem.everyNTurns} onChange={(everyNTurns) => updateMemoryDetection({ everyNTurns: Math.max(1, everyNTurns) })} />
                </Field>
                <Field label="Scene state every N turns (0 = off)">
                  <NumberInput min={0} value={bud.autoSceneStateEveryNTurns ?? 1} onChange={(autoSceneStateEveryNTurns) => updateBudget({ autoSceneStateEveryNTurns })} />
                </Field>
                <Field label="Semantic eval every N turns (0 = off)">
                  <NumberInput min={0} value={sem.semanticEvalEveryNTurns ?? 1} onChange={(semanticEvalEveryNTurns) => updateSemanticSettings({ semanticEvalEveryNTurns })} />
                </Field>
              </div>
            </article>
          );
        })()}

        {/* ── Context Budget (advanced) ─────────────── */}
        {advanced && (
          <article className="panel settings-card settings-section-full" style={{ gridColumn: "1 / -1" }}>
            <h3>Context Budget</h3>
            <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
              <button type="button" title="8k tokens, 15 messages, tight section budgets" onClick={() => updateBudget(lightTokenBudgetPreset)}>Light</button>
              <button type="button" title="16k tokens, 40 messages — balanced default" onClick={() => updateBudget(defaultTokenBudgetSettings)}>Normal</button>
              <button type="button" title="32k tokens, 80 messages, large section budgets — maximum context" onClick={() => updateBudget(heavyTokenBudgetPreset)}>Heavy</button>
            </div>
            <div className="grid two">
              <Field label="Max Context Tokens">
                <NumberInput
                  min={512}
                  value={activeSettings.tokenBudgetSettings.maxContextTokens}
                  onChange={(value) => updateBudget({ maxContextTokens: value })}
                />
              </Field>
              <Field label="Max Recent Messages">
                <NumberInput
                  min={0}
                  value={activeSettings.tokenBudgetSettings.maxRecentMessages}
                  onChange={(value) => updateBudget({ maxRecentMessages: value })}
                />
              </Field>
              <Field label="Memory Priority Mode">
                <select
                  value={activeSettings.tokenBudgetSettings.memoryPriorityMode}
                  onChange={(e) => updateBudget({ memoryPriorityMode: e.target.value as MemoryPriorityMode })}
                >
                  <option value="userLocked">userLocked</option>
                  <option value="systemSuggested">systemSuggested</option>
                  <option value="hybrid">hybrid</option>
                </select>
              </Field>
              <Field label="Trigger Recent Message Window">
                <NumberInput
                  min={0}
                  value={activeSettings.tokenBudgetSettings.recentMessageWindow}
                  onChange={(value) => updateBudget({ recentMessageWindow: value })}
                />
              </Field>
            </div>
            <div className="grid two" style={{ marginTop: "0.5rem" }}>
              <div>
                <CheckboxField
                  label="Allow system to prioritize memory"
                  checked={activeSettings.tokenBudgetSettings.allowSystemToPrioritizeMemory}
                  onChange={(allowSystemToPrioritizeMemory) => updateBudget({ allowSystemToPrioritizeMemory })}
                />
                <CheckboxField
                  label="Allow system to drop unpinned triggered cards"
                  checked={activeSettings.tokenBudgetSettings.allowSystemToDropUnpinnedTriggeredCards}
                  onChange={(allowSystemToDropUnpinnedTriggeredCards) => updateBudget({ allowSystemToDropUnpinnedTriggeredCards })}
                />
                <CheckboxField
                  label="Allow system to truncate rolling summary (legacy)"
                  checked={activeSettings.tokenBudgetSettings.allowSystemToTruncateSummary}
                  onChange={(allowSystemToTruncateSummary) => updateBudget({ allowSystemToTruncateSummary })}
                />
              </div>
              <div>
                <CheckboxField
                  label="Auto-summarize in background (legacy)"
                  checked={activeSettings.tokenBudgetSettings.autoSummarize ?? true}
                  onChange={(autoSummarize) => updateBudget({ autoSummarize })}
                />
                <Field label="Auto-summarize every N turns (legacy)">
                  <NumberInput
                    min={5}
                    value={activeSettings.tokenBudgetSettings.autoSummarizeEveryNTurns ?? 20}
                    onChange={(autoSummarizeEveryNTurns) => updateBudget({ autoSummarizeEveryNTurns })}
                  />
                </Field>
                <Field label="Scene state every N turns (0 = manual only)">
                  <NumberInput
                    min={0}
                    value={activeSettings.tokenBudgetSettings.autoSceneStateEveryNTurns ?? 1}
                    onChange={(autoSceneStateEveryNTurns) => updateBudget({ autoSceneStateEveryNTurns })}
                  />
                </Field>
                <Field label="Section Budgets JSON">
                  <JsonTextarea
                    value={activeSettings.tokenBudgetSettings.sectionBudgets}
                    onValidChange={(sectionBudgets) => updateBudget({ sectionBudgets })}
                  />
                </Field>
              </div>
            </div>
          </article>
        )}

        {/* ── LLM Evaluation (advanced) ─────────────── */}
        {advanced && (
          <article className="panel settings-card">
            <h3>LLM Evaluation</h3>
            <Field label="Evaluation Model Override">
              <input
                value={activeSettings.semanticEvaluationSettings.evaluationModel}
                placeholder={activePreset?.model ?? ""}
                onChange={(e) => updateSemanticSettings({ evaluationModel: e.target.value })}
              />
            </Field>
            <Field label="Messages Included In Evaluation">
              <NumberInput
                min={1}
                value={activeSettings.semanticEvaluationSettings.messagesIncluded}
                onChange={(messagesIncluded) => updateSemanticSettings({ messagesIncluded })}
              />
            </Field>
            <Field label="Semantic eval every N turns (0 = disabled, 1 = every turn)">
              <NumberInput
                min={0}
                value={activeSettings.semanticEvaluationSettings.semanticEvalEveryNTurns ?? 1}
                onChange={(semanticEvalEveryNTurns) => updateSemanticSettings({ semanticEvalEveryNTurns })}
              />
            </Field>
            <CheckboxField
              label="Enable semantic triggers"
              checked={activeSettings.semanticEvaluationSettings.enabled}
              onChange={(enabled) => updateSemanticSettings({ enabled })}
            />
            <CheckboxField
              label="Show evaluation log on Automations page"
              checked={activeSettings.semanticEvaluationSettings.showLog}
              onChange={(showLog) => updateSemanticSettings({ showLog })}
            />
            <Field label="Max Parallel Update Calls">
              <NumberInput
                min={1}
                value={activeSettings.semanticEvaluationSettings.maxParallelUpdateCalls}
                onChange={(maxParallelUpdateCalls) => updateSemanticSettings({ maxParallelUpdateCalls })}
              />
            </Field>
            <CheckboxField
              label="Route all auto-updates to Memory Inbox (disable to auto-apply without review)"
              checked={activeSettings.semanticEvaluationSettings.requireApprovalForAutoUpdates ?? true}
              onChange={(requireApprovalForAutoUpdates) => updateSemanticSettings({ requireApprovalForAutoUpdates })}
            />
            <p className="muted">
              When on, all LLM-generated updates go to Memory Suggestions for your review instead of applying directly.
            </p>
            <h4>Background Provider</h4>
            <p className="muted">
              Route background tasks (evaluation, brain updates, story card updates, and plot updates) through a
              separate provider. Leave blank to use the active preset for all tasks.
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
            <Field label="API Key">
              <input
                type="password"
                value={activeSettings.semanticEvaluationSettings.backgroundProviderConfig?.apiKey ?? ""}
                placeholder="gsk_..."
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
            <h3>Memory Detection</h3>
            <p className="muted">
              After each turn, use the evaluation model to detect new durable facts worth storing as memory proposals.
              The pre-filter skips the call when nothing novel is detected.
            </p>
            <CheckboxField
              label="Enable AI memory detection"
              checked={globalAdventureSettings.memoryDetectionSettings.enabled}
              onChange={(enabled) => updateMemoryDetection({ enabled })}
            />
            {globalAdventureSettings.memoryDetectionSettings.enabled && (
              <>
                <Field label="Run every N turns (1 = every turn)">
                  <NumberInput
                    min={1}
                    value={globalAdventureSettings.memoryDetectionSettings.everyNTurns}
                    onChange={(everyNTurns) => updateMemoryDetection({ everyNTurns: Math.max(1, everyNTurns) })}
                  />
                </Field>
                <CheckboxField
                  label="Generate card content"
                  checked={globalAdventureSettings.memoryDetectionSettings.generateContent}
                  onChange={(generateContent) => updateMemoryDetection({ generateContent })}
                />
                <p className="muted">
                  When on, the AI writes the proposal body in the same call — more useful but costs more tokens.
                  When off, proposals arrive with blank content for you to fill in.
                </p>
                <div className="auto-approve-toggles">
                  <span className="auto-approve-label muted">Auto-approve:</span>
                  <CheckboxField label="Legacy Summary" checked={activeSettings.memoryAutoApprove.summaryUpdate} onChange={(summaryUpdate) => updateMemoryAutoApprove({ summaryUpdate })} />
                  <CheckboxField label="Plot Essentials" checked={activeSettings.memoryAutoApprove.plotEssentialsUpdate} onChange={(plotEssentialsUpdate) => updateMemoryAutoApprove({ plotEssentialsUpdate })} />
                  <CheckboxField label="Active Pressure" checked={activeSettings.memoryAutoApprove.plotPressureUpdate} onChange={(plotPressureUpdate) => updateMemoryAutoApprove({ plotPressureUpdate })} />
                  <CheckboxField label="Current Arc" checked={activeSettings.memoryAutoApprove.currentArcUpdate} onChange={(currentArcUpdate) => updateMemoryAutoApprove({ currentArcUpdate })} />
                  <CheckboxField label="Arc Proposals" checked={activeSettings.memoryAutoApprove.arcProposal} onChange={(arcProposal) => updateMemoryAutoApprove({ arcProposal })} />
                  <CheckboxField label="Story Cards" checked={activeSettings.memoryAutoApprove.storyCard} onChange={(storyCard) => updateMemoryAutoApprove({ storyCard })} />
                  <CheckboxField label="Characters" checked={activeSettings.memoryAutoApprove.brainUpdate} onChange={(brainUpdate) => updateMemoryAutoApprove({ brainUpdate })} />
                </div>
                <p className="muted">
                  These toggles apply to Memory Suggestions created by automatic detection, manual builders,
                  inline memory tags, and Plot Essentials history carry-forward.
                </p>
              </>
            )}
          </article>
        )}

        {/* ── Cloud Sync ────────────────────────────── */}
        {cloudSyncSettings && onCloudSyncSettingsChange && (
          <article className="panel settings-card settings-section-full cloud-sync-panel" style={{ gridColumn: "1 / -1" }}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Personal Cloud Sync</p>
                <h3>Switch between phone and computer</h3>
                <p className="muted">
                  Sync all local adventures through a private GitHub repo. Token is stored only in localStorage.
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
              <Field label="Owner / username">
                <input
                  value={cloudSyncSettings.owner}
                  onChange={(e) => updateCloudSync({ owner: e.target.value })}
                  placeholder="Leave blank to use token owner"
                />
              </Field>
              <Field label="Private repo">
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
              Sync merges by adventure ID and keeps the newest <code>updatedAt</code> copy. It does not sync provider API keys.
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
