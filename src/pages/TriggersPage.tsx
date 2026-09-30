import { useState } from "react";
import type { InlineMemoryCategory, TriggerEvaluationMode, TriggerMatchType, TriggerSource } from "../types/adventure";
import { makeTriggerRule } from "../state/defaults";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, JsonTextarea, NumberInput, UpdatedAtBadge, commaList, fromCommaList } from "./shared";

const sources: TriggerSource[] = ["input", "output", "both"];
const matchTypes: TriggerMatchType[] = ["keyword", "phrase", "regex"];
const evaluationModes: TriggerEvaluationMode[] = ["semantic", "keyword", "regex"];
const quietMemoryCategories: Record<InlineMemoryCategory, boolean> = {
  character_reveal: true,
  world_fact: true,
  relationship: false,
  plot_beat: false,
  status_change: false,
};
const balancedMemoryCategories: Record<InlineMemoryCategory, boolean> = {
  character_reveal: true,
  world_fact: true,
  relationship: true,
  plot_beat: true,
  status_change: true,
};

export function TriggersPage({ adventure, dispatch }: AdventurePageProps) {
  const [flagKey, setFlagKey] = useState("");
  const [flagValue, setFlagValue] = useState("");
  const [ruleSearch, setRuleSearch] = useState("");
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);

  const searchLower = ruleSearch.trim().toLowerCase();
  const sortedRules = [...adventure.triggerRules].sort((a, b) => b.priority - a.priority);
  const visibleRules = sortedRules.filter((rule) => {
    if (!searchLower) return true;
    return (
      rule.name.toLowerCase().includes(searchLower)
      || rule.condition.toLowerCase().includes(searchLower)
      || rule.updatePrompt.toLowerCase().includes(searchLower)
      || rule.patterns.some((pattern) => pattern.toLowerCase().includes(searchLower))
    );
  });
  const enabledRuleCount = adventure.triggerRules.filter((rule) => rule.enabled).length;

  function createTrigger() {
    const triggerRule = makeTriggerRule({ name: "New Trigger" });
    dispatch({ type: "UPSERT_TRIGGER_RULE", triggerRule });
    setOpenRuleId(triggerRule.id);
  }

  function setFlag() {
    const key = flagKey.trim();
    if (!key) return;
    const raw = flagValue.trim();
    const value = raw === "true" ? true : raw === "false" ? false : !Number.isNaN(Number(raw)) && raw !== "" ? Number(raw) : raw;
    dispatch({ type: "SET_STATE_FLAG", key, value });
    setFlagKey("");
    setFlagValue("");
  }

  return (
    <section className="page editor-surface triggers-page">
      <div className="editor-page-summary">
        <p className="muted">
          Automations watch turns for authored conditions, then update memory, plot state, flags, or review proposals.
          Keep rules searchable and expand only the one you are editing.
        </p>
        <div className="editor-stat-row" aria-label="Automation counts">
          <span>{adventure.triggerRules.length} rules</span>
          <span>{enabledRuleCount} enabled</span>
          <span>{adventure.activeState.triggerLog.length} fired</span>
          {searchLower && <span>{visibleRules.length} shown</span>}
        </div>
      </div>

      <div className="editor-command-bar triggers-command-bar">
        <input
          type="search"
          placeholder="Search automations..."
          value={ruleSearch}
          onChange={(event) => setRuleSearch(event.target.value)}
        />
        <button type="button" onClick={createTrigger}>
          Create Trigger
        </button>
      </div>

      <details className="panel editor-tools-panel" open>
        <summary>System memory triggers</summary>
        <p className="muted">
          Inline story card detection runs without extra API calls. The model flags permanent story facts while writing
          each response, then proposals go to Memory Suggestions for approval.
        </p>
        {(() => {
          const st = adventure.systemTriggers;
          const enabled = st.enabled !== false;
          const categories: Array<{ key: InlineMemoryCategory; label: string; description: string }> = [
            { key: "relationship", label: "Relationship Milestone", description: "First between characters, revealed preference, dynamic shift" },
            { key: "world_fact", label: "World Fact", description: "New location, organization, rule, or permanent world detail" },
            { key: "character_reveal", label: "Character Reveal", description: "Character discloses backstory, secret, or personal truth" },
            { key: "plot_beat", label: "Plot Beat", description: "Alliance, betrayal, new threat, or permanent consequence sealed" },
            { key: "status_change", label: "Status Change", description: "Rank, title, allegiance, or relationship status changes" },
          ];
          return (
            <>
              <CheckboxField
                label="Enable system triggers"
                checked={enabled}
                onChange={(v) => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...st, enabled: v } })}
              />
              <div className="toolbar">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...st, enabled: true, categories: quietMemoryCategories } })}
                >
                  Quiet entity-only
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...st, enabled: true, categories: balancedMemoryCategories } })}
                >
                  Balanced story memory
                </button>
              </div>
              <p className="muted">
                Quiet tracks new characters and world facts. Balanced also tracks relationship, plot, and status milestones;
                the prompt still asks for only the strongest durable memory tag per response.
              </p>
              <div className="grid two disabled-when-off" data-disabled={!enabled}>
                {categories.map(({ key, label, description }) => (
                  <div key={key}>
                    <CheckboxField
                      label={label}
                      checked={st.categories[key] !== false}
                      onChange={(v) => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...st, categories: { ...st.categories, [key]: v } } })}
                    />
                    <p className="muted">{description}</p>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </details>

      <details className="panel editor-tools-panel">
        <summary>How automations work</summary>
        <p className="muted">
          Keyword and regex rules scan story text synchronously before and after generation. Semantic rules ask the AI
          to evaluate natural-language conditions after the turn completes in the background.
        </p>
        <p className="muted">
          Actions can update Story Cards, Brains, Plot Essentials, state flags, or Memory Suggestion proposals. Use
          Trigger History and Evaluation Log to see what fired and why.
        </p>
      </details>

      <div className="automation-grid">
        <div className="list trigger-rule-list">
          {visibleRules.length === 0 && <p className="muted">No automation rules match that search.</p>}
          {visibleRules.map((rule) => {
            const isOpen = openRuleId === rule.id;
            return (
              <details
                key={rule.id}
                className="card story-card-item split-editor-item trigger-rule-item"
                open={isOpen}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open;
                  setOpenRuleId(nextOpen ? rule.id : openRuleId === rule.id ? null : openRuleId);
                }}
              >
                <summary>
                  <span className="story-card-summary trigger-rule-summary">
                    <span className="story-card-title">{rule.name || "Untitled trigger"}</span>
                    <span className="story-card-badges">
                      <span className="badge badge-type">{rule.evaluationMode ?? "semantic"}</span>
                      <span className={rule.enabled ? "badge" : "badge badge-inactive"}>{rule.enabled ? "Enabled" : "Off"}</span>
                      {rule.actions.length > 0 && <span className="badge">{rule.actions.length} actions</span>}
                      <UpdatedAtBadge value={rule.updatedAt} />
                    </span>
                    <span className="story-card-keys">{rule.patterns.length > 0 ? rule.patterns.join(", ") : "No patterns"}</span>
                    <span className="search-snippet">{rule.condition || rule.updatePrompt || "No condition set."}</span>
                  </span>
                </summary>

                <div className="editor-card trigger-rule-editor">
                  <div className="grid two">
                    <Field label="Name">
                      <input
                        value={rule.name}
                        onChange={(event) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { name: event.target.value } })}
                      />
                    </Field>
                    <CheckboxField
                      label="Enabled"
                      checked={rule.enabled}
                      onChange={(checked) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { enabled: checked } })}
                    />
                  </div>
                  <div className="grid four">
                    <Field label="Evaluation Mode">
                      <select
                        value={rule.evaluationMode ?? "semantic"}
                        onChange={(event) =>
                          dispatch({
                            type: "UPDATE_TRIGGER_RULE",
                            triggerRuleId: rule.id,
                            patch: { evaluationMode: event.target.value as TriggerEvaluationMode },
                          })
                        }
                      >
                        {evaluationModes.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Source">
                      <select
                        value={rule.source}
                        onChange={(event) =>
                          dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { source: event.target.value as TriggerSource } })
                        }
                      >
                        {sources.map((source) => (
                          <option key={source} value={source}>
                            {source}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Match Type">
                      <select
                        value={rule.matchType}
                        onChange={(event) =>
                          dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { matchType: event.target.value as TriggerMatchType } })
                        }
                      >
                        {matchTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Priority">
                      <NumberInput
                        value={rule.priority}
                        onChange={(value) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { priority: value } })}
                      />
                    </Field>
                    <Field label="Cooldown">
                      <NumberInput
                        min={0}
                        value={rule.cooldownTurns}
                        onChange={(value) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { cooldownTurns: value } })}
                      />
                    </Field>
                  </div>
                  <Field label="Semantic Condition">
                    <textarea
                      rows={3}
                      value={rule.condition}
                      onChange={(event) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { condition: event.target.value } })}
                    />
                  </Field>
                  <Field label="Update Prompt Override">
                    <textarea
                      rows={4}
                      value={rule.updatePrompt}
                      placeholder="Optional. Generated content actions use their default target prompt when this is empty."
                      onChange={(event) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { updatePrompt: event.target.value } })}
                    />
                  </Field>
                  <Field label="Patterns">
                    <input
                      value={commaList(rule.patterns)}
                      onChange={(event) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { patterns: fromCommaList(event.target.value) } })}
                    />
                  </Field>
                  <Field label="Conditions JSON">
                    <JsonTextarea value={rule.conditions} onValidChange={(conditions) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { conditions } })} />
                  </Field>
                  <Field label="Actions JSON">
                    <JsonTextarea value={rule.actions} onValidChange={(actions) => dispatch({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: rule.id, patch: { actions } })} rows={8} />
                  </Field>
                  <p className="muted">Last fired turn: {rule.lastFiredTurn ?? "never"}</p>
                  <button type="button" className="danger" onClick={() => dispatch({ type: "DELETE_TRIGGER_RULE", triggerRuleId: rule.id })}>
                    Delete
                  </button>
                </div>
              </details>
            );
          })}
        </div>

        <div className="list automation-side-list">
          <article className="panel">
            <h3>Trigger History</h3>
            {adventure.activeState.triggerLog.length === 0 && <p className="muted">No triggers fired yet.</p>}
            {adventure.activeState.triggerLog.map((entry) => (
              <div key={entry.id} className="log-entry">
                <strong>{entry.triggerName}</strong>
                <p>
                  Turn {entry.turn} - {entry.source} - pattern {entry.matchedPattern ?? "(unknown)"} - {entry.actionCount} actions
                </p>
                <p className="muted">{entry.textSnippet}</p>
              </div>
            ))}
          </article>

          {adventure.semanticEvaluationSettings.showLog && (
            <article className="panel">
              <h3>Evaluation Log</h3>
              {adventure.activeState.evaluationLog.length === 0 && <p className="muted">No semantic evaluations logged yet.</p>}
              {adventure.activeState.evaluationLog.slice(0, 20).map((entry) => (
                <details key={entry.id} className="log-entry">
                  <summary>
                    Turn {entry.turn}: {entry.conditionsFired.length} fired / {entry.conditionsEvaluated.length} evaluated
                  </summary>
                  <p className="muted">Created {new Date(entry.createdAt).toLocaleString()}</p>
                  <h4>Fired Conditions</h4>
                  <pre>{JSON.stringify(entry.conditionsFired, null, 2)}</pre>
                  <h4>Actions Executed</h4>
                  <pre>{JSON.stringify(entry.actionsExecuted, null, 2)}</pre>
                  <h4>Generated Content</h4>
                  <pre>{JSON.stringify(entry.generatedContent, null, 2)}</pre>
                  <h4>Errors</h4>
                  <pre>{JSON.stringify(entry.errors, null, 2)}</pre>
                  <h4>Conditions Evaluated</h4>
                  <pre>{JSON.stringify(entry.conditionsEvaluated, null, 2)}</pre>
                </details>
              ))}
            </article>
          )}

          <article className="panel">
            <h3>State Flags</h3>
            <p className="muted">
              Runtime key-value flags readable by trigger conditions (<code>field: "stateFlag"</code>).
            </p>
            {Object.keys(adventure.activeState.stateFlags).length === 0 && <p className="muted">No flags set.</p>}
            {Object.entries(adventure.activeState.stateFlags).map(([key, value]) => (
              <div key={key} className="card state-flag-item">
                <div className="grid two">
                  <span><strong>{key}</strong></span>
                  <span className="muted">{typeof value}: {String(value)}</span>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => dispatch({ type: "SET_STATE_FLAG", key, value: "" })}
                >
                  Clear
                </button>
              </div>
            ))}
            <div className="grid two">
              <Field label="Key">
                <input value={flagKey} onChange={(event) => setFlagKey(event.target.value)} placeholder="flagName" />
              </Field>
              <Field label="Value">
                <input value={flagValue} onChange={(event) => setFlagValue(event.target.value)} placeholder="true / false / 0 / string" />
              </Field>
            </div>
            <button type="button" disabled={!flagKey.trim()} onClick={setFlag}>
              Set Flag
            </button>
          </article>
        </div>
      </div>
    </section>
  );
}
