import { ARC_INTENSITIES, ARC_INTENSITY_LABELS, ARC_STATE_TEMPLATE, arcStateSections, formatArcState, normalizeArcIntensity } from "../memory/currentArc";
import { useState } from "react";
import type { Adventure, AdventureAction, ComponentEntry, ComponentType, ContextInclusionPolicy } from "../types/adventure";
import type { ComponentAuditRecommendation } from "../memory/componentAudit";
import { makeComponent } from "../state/defaults";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, Highlight, MemoryUpdateHistory, NumberInput, TokenCountBadge, UpdatedAtBadge, contentSnippet, formatCompactTimestamp } from "./shared";

const SINGLETON_TYPES = new Set<ComponentType>(["narrationRules", "aiInstructions", "plotEssentials", "currentArcPlan", "currentArcState"]);

const activeComponentTypes: ComponentType[] = ["narrationRules", "aiInstructions", "plotEssentials", "currentArcPlan", "currentArcState", "custom"];
const inclusionPolicies: ContextInclusionPolicy[] = ["always", "triggered", "manual", "systemSuggested"];

const TYPE_LABELS: Record<ComponentType, string> = {
  narrationRules: "Narration Rules",
  aiInstructions: "AI Instructions",
  plotEssentials: "Plot Essentials",
  currentArcPlan: "Current Arc Plan",
  currentArcState: "Current Arc State",
  activePressure: "Active Pressure",
  immediateMomentum: "Immediate Momentum",
  authorNote: "Author's Note",
  memory: "Lore Block (legacy)",
  custom: "Custom",
};

const TYPE_DESCRIPTIONS: Record<ComponentType, string> = {
  currentArcPlan: "Intended conflict and possible progression.",
  currentArcState: "Active circumstances and completed arc history. Automatic participation requires an active Plan and non-Dormant intensity.",
  narrationRules: "The primary per-adventure behavior contract — POV, format, player agency, continuity, tone, and hard writing rules. Loaded first with the system shell. It is valid to keep all stable generation rules here and use no AI Instructions block.",
  aiInstructions: "Optional scenario-specific rules separated for organization. Use this only when you want a distinct drift-prevention or genre contract outside Narration Rules. Do not duplicate rules already present in Narration Rules; both blocks load every turn.",
  plotEssentials: "Current operating truth — what is happening now, open tensions, obligations, and major constraints that should shape every scene. Keep it compact and replace it when it drifts. Outgoing facts become reviewable historical Story Card proposals.",
  activePressure: "Retired legacy component; inactive and excluded from context and memory updates.",
  immediateMomentum: "Disabled legacy component. Immediate next-beat direction now belongs in Recent Messages or the one-turn Next Output Bias.",
  authorNote: "Retired. Saved text is available for reference.",
  memory: "Legacy lore block. Move content to a Story Card with type Lore for triggered inclusion.",
  custom: "A general-purpose context block. Configure inclusion policy, priority, and protection manually.",
};

function ArcStateEditor({ component, dispatch }: { component: ComponentEntry; dispatch: ComponentsPageProps["dispatch"] }) {
  const { current, completed } = arcStateSections(component.content, true) ?? { current: component.content, completed: "" };
  const update = (currentText: string, completedText: string) => dispatch({
    type: "UPDATE_COMPONENT", componentId: component.id, patch: { content: formatArcState(currentText, completedText) },
  });
  return <>
    <Field label="Current Developments">
      <textarea rows={4} value={current} onChange={event => update(event.target.value, completed)} />
    </Field>
    <Field label="Completed Developments">
      <textarea rows={4} value={completed} onChange={event => update(current, event.target.value)} />
    </Field>
  </>;
}

function ComponentSummary({ component, query }: { component: ComponentEntry; query: string }) {
  const snippet = component.type === "currentArcPlan" ? "" : contentSnippet(component.content, query);
  const memoryUpdatedAt = formatCompactTimestamp(component.lastMemoryUpdatedAt);
  const tokenEstimate = approximateTokenCount(component.content);
  return (
    <span className="story-card-summary">
      <span className="story-card-title"><Highlight text={component.type === "custom" ? component.title || TYPE_LABELS.custom : TYPE_LABELS[component.type]} query={query} /></span>
      <span className="story-card-badges">
        {component.type === "authorNote" ? <span className="badge badge-inactive">Retired</span> : !component.active && <span className="badge badge-inactive">Inactive</span>}
        {component.type !== "authorNote" && component.pinned && <span className="badge badge-pinned">Pinned</span>}
        {component.type !== "authorNote" && component.protected && <span className="badge badge-protected">Protected</span>}
        {component.type !== "authorNote" && component.priority > 0 && <span className="badge badge-priority">p{component.priority}</span>}
        {component.type !== "authorNote" && <TokenCountBadge count={tokenEstimate} title="Estimated tokens in plot context" />}
        <UpdatedAtBadge value={component.updatedAt} />
        {memoryUpdatedAt && (
          <span className="badge badge-memory-update" title={`Last memory update: ${memoryUpdatedAt}`}>
            Memory {memoryUpdatedAt}
          </span>
        )}
      </span>
      {snippet && <span className="search-snippet"><Highlight text={snippet} query={query} /></span>}
    </span>
  );
}

interface ComponentsPageProps extends AdventurePageProps {
  loading?: boolean;
  onAuditComponents?: (nTurns: number, includeAI: boolean) => Promise<ComponentAuditRecommendation[]>;
  onRegeneratePlotEssentials?: (componentId: string) => Promise<string>;
  onUpdatePEComponentNow?: (componentId: string) => Promise<void>;
  /** Generate fresh content for Narration Rules / AI Instructions. Returns a string for review. */
  onGenerateComponent?: (componentId: string) => Promise<string>;
}

type ComponentAuditState = {
  status: "running" | "done" | "error";
  recommendations: ComponentAuditRecommendation[];
  errorMessage?: string;
};

const GENERATABLE_COMPONENT_TYPES = new Set<ComponentType>(["narrationRules", "aiInstructions"]);
const COMPONENT_AUDIT_TYPES: ComponentType[] = ["plotEssentials", "custom", "memory"];

export function ComponentsPage({ adventure, dispatch, loading, onAuditComponents, onRegeneratePlotEssentials, onUpdatePEComponentNow, onGenerateComponent }: ComponentsPageProps) {
  const [search, setSearch] = useState("");
  const [pePreview, setPePreview] = useState<Record<string, string>>({});
  const [peRegenerating, setPeRegenerating] = useState<string | null>(null);
  const [openComponentId, setOpenComponentId] = useState<string | null>(null);
  const [componentAuditTurns, setComponentAuditTurns] = useState(20);
  const [componentAuditIncludeAI, setComponentAuditIncludeAI] = useState(false);
  const [componentAudit, setComponentAudit] = useState<ComponentAuditState | null>(null);

  function updateComponentAuditRec(id: string, patch: Partial<ComponentAuditRecommendation>) {
    setComponentAudit((prev) => prev && {
      ...prev,
      recommendations: prev.recommendations.map((rec) => rec.id === id ? { ...rec, ...patch } : rec),
    });
  }

  function approveComponentAuditRec(rec: ComponentAuditRecommendation) {
    if (rec.action === "delete" && rec.componentId) {
      dispatch({ type: "DELETE_COMPONENT", componentId: rec.componentId });
    } else if (rec.action === "edit" && rec.componentId) {
      const current = adventure.components.find((component) => component.id === rec.componentId);
      if (current?.type === "plotEssentials" && rec.suggestedType === "plotEssentials" && current.content !== rec.editedContent) {
        dispatch({ type: "APPLY_COMPONENT_UPDATE", componentId: rec.componentId, content: rec.editedContent });
        if (current.title !== rec.title) {
          dispatch({ type: "UPDATE_COMPONENT", componentId: rec.componentId, patch: { title: rec.title } });
        }
      } else {
        dispatch({
          type: "UPDATE_COMPONENT",
          componentId: rec.componentId,
          patch: {
            title: rec.title,
            content: rec.editedContent,
            type: rec.suggestedType,
          },
        });
      }
    } else if (rec.action === "create") {
      dispatch({
        type: "UPSERT_COMPONENT",
        component: makeComponent({
          title: rec.title || TYPE_LABELS[rec.suggestedType],
          type: rec.suggestedType,
          content: rec.editedContent,
          active: true,
        }),
      });
    }
    updateComponentAuditRec(rec.id, { decision: "approved" });
  }

  async function runComponentAudit() {
    if (!onAuditComponents) return;
    setComponentAudit({ status: "running", recommendations: [] });
    try {
      const recommendations = await onAuditComponents(componentAuditTurns, componentAuditIncludeAI);
      setComponentAudit({ status: "done", recommendations });
    } catch (err) {
      setComponentAudit({
        status: "error",
        recommendations: [],
        errorMessage: err instanceof Error ? err.message : "Component cleanup failed.",
      });
    }
  }

  async function handleRegeneratePE(componentId: string) {
    if (!onRegeneratePlotEssentials || peRegenerating) return;
    setPeRegenerating(componentId);
    try {
      const result = await onRegeneratePlotEssentials(componentId);
      setPePreview((prev) => ({ ...prev, [componentId]: result }));
    } catch {
      // silent — user can retry
    } finally {
      setPeRegenerating(null);
    }
  }

  async function handleGenerateComponent(componentId: string) {
    if (!onGenerateComponent || peRegenerating) return;
    setPeRegenerating(componentId);
    try {
      const result = await onGenerateComponent(componentId);
      setPePreview((prev) => ({ ...prev, [componentId]: result }));
    } catch {
      // silent — user can retry
    } finally {
      setPeRegenerating(null);
    }
  }
  const existingTypes = new Set(adventure.components.map((c) => c.type));

  const availableTypes = activeComponentTypes.filter(
    (t) => !SINGLETON_TYPES.has(t) || !existingTypes.has(t),
  );

  const searchLower = search.toLowerCase().trim();
  const visibleComponents = adventure.components.filter(c => c.type !== "activePressure")
    .sort((a, b) => b.priority - a.priority)
    .filter((c) => !searchLower ||
      TYPE_LABELS[c.type].toLowerCase().includes(searchLower) ||
      (c.type === "custom" && c.title.toLowerCase().includes(searchLower)) ||
      c.content.toLowerCase().includes(searchLower)
    );
  const activeCount = adventure.components.filter((component) => component.active && component.type !== "activePressure" && component.type !== "authorNote").length;
  return (
    <section className="page editor-surface components-page">
      <div className="editor-page-summary">
        <p className="muted">
          Narration rules, plot context, and custom blocks.
          Use Cards for facts that should only load when relevant.
        </p>
        <div className="editor-stat-row" aria-label="World block counts">
          <span>{adventure.components.length} total</span>
          <span>{activeCount} active</span>
          {searchLower && <span>{visibleComponents.length} shown</span>}
        </div>
      </div>

      <p className="muted editor-legacy-help" style={{ margin: 0 }}>
        World Blocks are <strong>always-on context</strong> — they load every turn regardless of the story.
        Use them for narration rules, plot state, and author direction.
        For characters, places, and lore that should only load <em>when relevant</em>, use <strong>Story Cards</strong> — they're more token-efficient.
        <strong> Narration Rules, AI Instructions, and Plot Essentials</strong> are singletons.
        AI Instructions are optional; Narration Rules can hold the complete stable behavior contract by themselves.
      </p>

      <div className="editor-command-bar">
        <input
          type="search"
          placeholder="Search blocks…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {availableTypes.filter((t) => SINGLETON_TYPES.has(t)).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => dispatch({ type: "UPSERT_COMPONENT", component: makeComponent({ title: TYPE_LABELS[type], content: type === "currentArcState" ? ARC_STATE_TEMPLATE : "", type }) })}
          >
            Add {TYPE_LABELS[type]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const component = makeComponent({ title: "New Block", content: "", type: "custom" });
            dispatch({ type: "UPSERT_COMPONENT", component });
            setSearch("");
            setOpenComponentId(component.id);
          }}
        >
          Add Custom Block
        </button>
      </div>

      {onAuditComponents && (
        <details className="panel editor-tools-panel component-maintenance-panel" open>
          <summary>Review and Maintain Components</summary>
          <div className="component-maintenance-grid">
              <section className="component-tool-card component-tool-card-primary">
                <div className="component-tool-copy">
                  <h3>Clean up plot components</h3>
                  <p className="muted">
                    Find bloated Plot Essentials, stale active pressure, disabled legacy blocks, duplicate always-on facts, and current-state/history drift.
                  </p>
                </div>
                <div className="component-tool-controls">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={loading || componentAudit?.status === "running"}
                    onClick={runComponentAudit}
                    title="Review existing plot components and get cleanup suggestions."
                  >
                    {componentAudit?.status === "running" ? "Cleaning..." : "Clean Up Components"}
                  </button>
                  <label className="turn-window-field">
                    <span>Review last</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={componentAuditTurns}
                      onChange={(event) => setComponentAuditTurns(Math.max(1, Number(event.target.value)))}
                      className="audit-turns-input"
                    />
                    <span>turns</span>
                  </label>
                  <CheckboxField
                    label="Include AI semantic pass"
                    checked={componentAuditIncludeAI}
                    onChange={setComponentAuditIncludeAI}
                  />
                </div>
              </section>

          </div>
        </details>
      )}

      <div className="list split-editor-list component-editor-list">
        {visibleComponents.map((component) => (
          <details
            key={component.id}
            className="card story-card-item split-editor-item component-editor-item"
            open={openComponentId === component.id}
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                setOpenComponentId((current) => current === component.id ? null : component.id);
              }}
            >
              <ComponentSummary component={component} query={searchLower} />
            </summary>

            {component.type === "authorNote" ? (
              <div className="editor-card item-inspector component-inspector">
                <p>Author’s Note is disabled. Use AI Instructions for enduring tone and Next Output Bias for immediate direction.</p>
                <Field label="Saved note">
                  <textarea rows={6} value={component.content} readOnly />
                </Field>
              </div>
            ) : (
            <div className="editor-card item-inspector component-inspector">
              <div className="panel-heading item-inspector-heading">
                <div>
                  <p className="eyebrow">
                    {component.active ? "active" : "inactive"} · {component.inclusionPolicy}
                  </p>
                  <h3>{component.type === "custom" ? component.title || TYPE_LABELS.custom : TYPE_LABELS[component.type]}</h3>
                  <div className="story-card-badges">
                    {component.pinned && <span className="badge badge-pinned">Pinned</span>}
                    {component.protected && <span className="badge badge-protected">Protected</span>}
                    {component.priority > 0 && <span className="badge badge-priority">p{component.priority}</span>}
                  </div>
                </div>
                <div className="row">
                  {component.type === "plotEssentials" && onUpdatePEComponentNow && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => onUpdatePEComponentNow(component.id)}
                      title="Ask the AI to review recent story turns and generate an updated version. Result goes to Memory Suggestions for review."
                    >
                      {loading ? "Generating..." : "Update Now"}
                    </button>
                  )}
                  {component.type === "plotEssentials" && onRegeneratePlotEssentials && (
                    <button
                      type="button"
                      disabled={!!peRegenerating}
                      onClick={() => handleRegeneratePE(component.id)}
                      title="Ask the AI to consolidate and rewrite Plot Essentials, removing resolved events and keeping active state."
                    >
                      {peRegenerating === component.id ? "Generating..." : "Regenerate"}
                    </button>
                  )}
                  {GENERATABLE_COMPONENT_TYPES.has(component.type) && onGenerateComponent && (
                    <button
                      type="button"
                      disabled={!!peRegenerating}
                      onClick={() => handleGenerateComponent(component.id)}
                      title="Ask the AI to write this block from the adventure's premise and cast, following best practices. Review before applying."
                    >
                      {peRegenerating === component.id ? "Generating..." : (component.content.trim() ? "Regenerate" : "Generate")}
                    </button>
                  )}
                  <button type="button" className="danger" onClick={() => dispatch({ type: "DELETE_COMPONENT", componentId: component.id })}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="grid two">
                <Field label="Type">
                  <select
                    value={component.type}
                    onChange={(event) => {
                      const newType = event.target.value as ComponentType;
                      dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { type: newType, title: TYPE_LABELS[newType] } });
                    }}
                  >
                    {[component.type, ...activeComponentTypes.filter((t) => t !== component.type && (!SINGLETON_TYPES.has(t) || !existingTypes.has(t)))].map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </Field>
                {component.type === "custom" && (
                  <Field label="Name">
                    <input
                      key={component.title}
                      defaultValue={component.title}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      onBlur={(event) => {
                        const title = event.target.value.trim() || TYPE_LABELS.custom;
                        event.currentTarget.value = title;
                        if (title !== component.title) dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { title } });
                      }}
                    />
                  </Field>
                )}
              </div>
              <p className="muted component-type-hint">{TYPE_DESCRIPTIONS[component.type]}</p>
              {component.type === "currentArcState" && (
                <>
                  <Field label="Arc intensity">
                    <select value={normalizeArcIntensity(component.arcIntensity)} onChange={event =>
                      dispatch({ type: "UPDATE_COMPONENT", componentId: component.id,
                        patch: { arcIntensity: normalizeArcIntensity(event.target.value) } })}>
                      {ARC_INTENSITIES.map((intensity, index) =>
                        <option key={intensity} value={intensity}>{ARC_INTENSITY_LABELS[index]}</option>)}
                    </select>
                  </Field>
                  <button type="button" disabled={!arcStateSections(component.content)?.completed ||
                    /^(?:none|no completed developments)[.!]?$/i.test(arcStateSections(component.content)?.completed ?? "")}
                    onClick={() => dispatch({ type: "CONVERT_ARC_STATE_TO_LORE", componentId: component.id })}>
                    Convert to Lore
                  </button>
                </>
              )}
              <section className="item-focus-section">
                <div className="item-section-heading">
                  <div>
                    <p className="eyebrow">context block</p>
                    <h4>{component.type === "currentArcPlan" ? "Plan content" : "Component content"}</h4>
                  </div>
                  <span className="muted">{component.content.split("\n").filter((line) => line.trim()).length} line{component.content.split("\n").filter((line) => line.trim()).length === 1 ? "" : "s"}</span>
                </div>
              {component.type === "currentArcState" ? <ArcStateEditor component={component} dispatch={dispatch} />
                : <Field label="Content">
                  <textarea
                    rows={6}
                    value={component.content}
                    onChange={(event) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { content: event.target.value } })}
                  />
                </Field>}
              </section>
              <MemoryUpdateHistory history={component.memoryUpdateHistory} />
              {pePreview[component.id] !== undefined && (
                <Field label="Regenerated (review before applying)">
                  <textarea
                    rows={6}
                    value={pePreview[component.id]}
                    onChange={(event) => setPePreview((prev) => ({ ...prev, [component.id]: event.target.value }))}
                  />
                </Field>
              )}
              <details className="brain-secondary-details item-secondary-details">
                <summary>Automation, context settings, and actions</summary>
              {component.type === "plotEssentials" && (
                <div className="grid two">
                  <CheckboxField
                    label="Allow automatic Plot Essentials updates"
                    checked={component.autoUpdate ?? false}
                    onChange={(autoUpdate) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { autoUpdate } })}
                  />
                  <Field label="Minimum turns between memory updates">
                    <NumberInput
                      value={component.autoUpdateCooldownTurns ?? 3}
                      min={0}
                      onChange={(value) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { autoUpdateCooldownTurns: value } })}
                    />
                  </Field>
                  <p className="muted">0 disables the cooldown. This interval applies to this component. The global evaluation schedule still applies. A cooldown does not force an update.</p>
                  <Field label="Recorded memory update turn">
                    <input value={component.lastAutoUpdateTurn ?? "Never"} readOnly />
                  </Field>
                </div>
              )}
              <div className="grid four">
                <Field label="Priority (higher loads first)">
                  <NumberInput
                    value={component.priority}
                    onChange={(value) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { priority: value } })}
                  />
                </Field>
                <Field label="Token Budget (0 = no limit)">
                  <NumberInput
                    value={component.tokenBudget ?? 0}
                    min={0}
                    onChange={(value) =>
                      dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { tokenBudget: value || undefined } })
                    }
                  />
                </Field>
                <CheckboxField
                  label="Active"
                  checked={component.active}
                  onChange={(checked) =>
                    dispatch({ type: checked ? "ACTIVATE_COMPONENT" : "DEACTIVATE_COMPONENT", componentId: component.id })
                  }
                />
                <CheckboxField
                  label="Pinned (loads before triggered items)"
                  checked={component.pinned}
                  onChange={(checked) => dispatch({ type: checked ? "PIN_COMPONENT" : "UNPIN_COMPONENT", componentId: component.id })}
                />
              </div>
              <CheckboxField
                label="Always on (ignore inclusion policy — load every turn)"
                checked={component.alwaysOn}
                onChange={(checked) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { alwaysOn: checked } })}
              />
              <div className="grid two">
                <CheckboxField
                  label="Protected (cannot be dropped by token truncation)"
                  checked={component.protected}
                  onChange={(checked) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { protected: checked } })}
                />
                <Field label="Inclusion Policy">
                  <select
                    value={component.inclusionPolicy}
                    onChange={(event) =>
                      dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { inclusionPolicy: event.target.value as ContextInclusionPolicy } })
                    }
                  >
                    {inclusionPolicies.map((policy) => (
                      <option key={policy} value={policy}>
                        {policy}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="State (runtime note visible to automation conditions)">
                <input
                  value={component.state}
                  onChange={(event) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { state: event.target.value } })}
                />
              </Field>
              <div className="row">
                <button type="button" onClick={() => dispatch({ type: "REORDER_COMPONENT", componentId: component.id, direction: "up" })}>
                  Move Up
                </button>
                <button type="button" onClick={() => dispatch({ type: "REORDER_COMPONENT", componentId: component.id, direction: "down" })}>
                  Move Down
                </button>
                {component.type === "plotEssentials" && onUpdatePEComponentNow && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onUpdatePEComponentNow(component.id)}
                    title="Ask the AI to review recent story turns and generate an updated version. Result goes to Memory Suggestions for review."
                  >
                    {loading ? "Generating…" : "Update Now"}
                  </button>
                )}
                {component.type === "plotEssentials" && onRegeneratePlotEssentials && (
                  <button
                    type="button"
                    disabled={!!peRegenerating}
                    onClick={() => handleRegeneratePE(component.id)}
                    title="Ask the AI to consolidate and rewrite Plot Essentials, removing resolved events and keeping active state."
                  >
                    {peRegenerating === component.id ? "Generating…" : "Regenerate"}
                  </button>
                )}
                {GENERATABLE_COMPONENT_TYPES.has(component.type) && onGenerateComponent && (
                  <button
                    type="button"
                    disabled={!!peRegenerating}
                    onClick={() => handleGenerateComponent(component.id)}
                    title="Ask the AI to write this block from the adventure's premise and cast, following best practices. Review before applying."
                  >
                    {peRegenerating === component.id ? "Generating…" : (component.content.trim() ? "✨ Regenerate" : "✨ Generate")}
                  </button>
                )}
                {pePreview[component.id] !== undefined && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { content: pePreview[component.id] } });
                        setPePreview((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== component.id)));
                      }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setPePreview((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== component.id)))}
                    >
                      Discard
                    </button>
                  </>
                )}
                <button type="button" className="danger" onClick={() => dispatch({ type: "DELETE_COMPONENT", componentId: component.id })}>
                  Delete
                </button>
              </div>
              </details>
            </div>
            )}
          </details>
        ))}
      </div>

      {componentAudit && componentAudit.status !== "running" && (
        <div className="audit-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) setComponentAudit(null); }}>
          <div className="audit-modal">
            <div className="audit-modal-header">
              <h3>Plot Component Cleanup</h3>
              <button type="button" className="audit-modal-close" onClick={() => setComponentAudit(null)}>x</button>
            </div>

            {componentAudit.status === "error" && (
              <p className="audit-error">{componentAudit.errorMessage}</p>
            )}

            {componentAudit.status === "done" && componentAudit.recommendations.length === 0 && (
              <p className="muted">No changes recommended - your plot components look good.</p>
            )}

            {componentAudit.recommendations.map((rec) => (
              <div key={rec.id} className={`audit-rec ${rec.decision !== "pending" ? `audit-rec-${rec.decision}` : ""}`}>
                <div className="audit-rec-header">
                  <span className={`audit-badge audit-badge-${rec.action}`}>{rec.action.toUpperCase()}</span>
                  {rec.source === "deterministic" && <span className="audit-badge audit-badge-det">DETECTED</span>}
                  {rec.action !== "delete" && <span className="audit-badge audit-badge-det">{TYPE_LABELS[rec.suggestedType]}</span>}
                  <span className="audit-rec-title">{rec.title}</span>
                  {rec.decision !== "pending" && (
                    <span className={`audit-badge audit-badge-decision-${rec.decision}`}>{rec.decision}</span>
                  )}
                </div>
                <p className="audit-rec-rationale">{rec.rationale}</p>

                {rec.action !== "delete" && (
                  <div className="audit-rec-fields">
                    <div className="field-row">
                      <Field label="Title">
                        <input
                          value={rec.title}
                          onChange={(event) => updateComponentAuditRec(rec.id, { title: event.target.value })}
                          disabled={rec.decision !== "pending"}
                        />
                      </Field>
                      <Field label="Type">
                        <select
                          value={rec.suggestedType}
                          onChange={(event) => updateComponentAuditRec(rec.id, { suggestedType: event.target.value as ComponentType })}
                          disabled={rec.decision !== "pending"}
                        >
                          {COMPONENT_AUDIT_TYPES.map((type) => (
                            <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Content">
                      <textarea
                        rows={6}
                        value={rec.editedContent}
                        onChange={(event) => updateComponentAuditRec(rec.id, { editedContent: event.target.value })}
                        disabled={rec.decision !== "pending"}
                      />
                    </Field>
                  </div>
                )}

                <div className="audit-rec-actions">
                  <button type="button" disabled={rec.decision !== "pending"} onClick={() => approveComponentAuditRec(rec)}>
                    Approve
                  </button>
                  <button type="button" disabled={rec.decision !== "pending"} onClick={() => updateComponentAuditRec(rec.id, { decision: "rejected" })}>
                    Reject
                  </button>
                </div>
              </div>
            ))}

            <div className="audit-modal-footer">
              <button type="button" onClick={() => setComponentAudit(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
