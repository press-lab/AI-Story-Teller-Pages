import { useState } from "react";
import type { Adventure, AdventureAction, ArcPace, ArcPhase, ArcTriggerMode, ComponentEntry, ComponentType, ContextInclusionPolicy, PlotAIBuilderRequest } from "../types/adventure";
import type { ComponentAuditRecommendation } from "../memory/componentAudit";
import { makeComponent } from "../state/defaults";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, Highlight, MemoryUpdateHistory, NumberInput, TokenCountBadge, UpdatedAtBadge, contentSnippet, formatCompactTimestamp } from "./shared";

const ARC_PACE_LABELS: Record<ArcPace, string> = {
  short: "Short — breaks quickly",
  medium: "Medium",
  long: "Long",
  epic: "Epic — a slow, season-long burn",
};

/**
 * Arc Director — set the antagonist ("the Baddie"), the pace ("the Timer"), the cost,
 * and who springs the climax. Pacing is deterministic; the break instruction is withheld
 * from the AI's context until the arc actually reaches the break phase.
 */
function ArcDirector({
  adventure,
  component,
  dispatch,
  onGenerateArc,
  onProposeArcFromHistory,
  loading,
}: {
  adventure: Adventure;
  component: ComponentEntry;
  dispatch: (action: AdventureAction) => void;
  onGenerateArc?: (componentId: string, concept: string) => Promise<void>;
  onProposeArcFromHistory?: (componentId: string) => Promise<void>;
  loading?: boolean;
}) {
  const [concept, setConcept] = useState("");
  const [arcActionStatus, setArcActionStatus] = useState("");
  const arc = component.arcState ?? { phase: "simmer" as ArcPhase, tier: 0, threadEngagement: {}, pendingBreak: false };
  const threadKeys = component.arcThreadKeys ?? [];
  const threadSet = new Set(threadKeys);
  const turn = adventure.activeState.turn;
  const configured = threadKeys.length > 0;
  const totalEngagement = threadKeys.reduce((sum, key) => sum + (arc.threadEngagement[key] ?? 0), 0);
  const canCompleteArc = Boolean(component.arcPremise?.trim() || component.content.trim());
  const phaseStatus = arc.phase === "break"
    ? "Break armed for next output. Press Continue or take a turn."
    : arc.phase === "aftermath"
      ? canCompleteArc
        ? "Arc is in aftermath. Complete it to a Story Card or choose the next direction."
        : "No arc premise or log to save yet."
      : "";

  const candidates = [
    ...adventure.storyCards.map((card) => ({ id: card.id, label: card.title, kind: "Card" })),
    ...adventure.brains.map((brain) => ({ id: brain.id, label: brain.characterName, kind: "Brain" })),
  ];

  const patch = (next: Partial<ComponentEntry>) =>
    dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: next });
  const setPhase = (phase: ArcPhase) => {
    const statusByPhase: Record<ArcPhase, string> = {
      simmer: "Arc reset to simmer. Engagement counters are cleared.",
      escalate: "Arc moved to escalate. It will keep building until the break gate opens.",
      break: "Break armed for next output. Press Continue or take a turn to let the model see the cost instruction.",
      aftermath: "Arc moved to aftermath. Complete it into a Story Card or choose the next direction.",
    };
    setArcActionStatus(statusByPhase[phase]);
    dispatch({ type: "SET_ARC_PHASE", componentId: component.id, phase, turn });
  };
  const completeArcToStoryCard = () => {
    const title = component.arcPremise?.trim() || component.title;
    dispatch({ type: "COMPLETE_ARC_TO_STORY_CARD", componentId: component.id });
    setArcActionStatus(`Completed arc saved as Story Card: ${title}. Current Arc is clear and simmering.`);
  };
  const toggleThread = (id: string, on: boolean) =>
    patch({ arcThreadKeys: on ? [...threadKeys, id] : threadKeys.filter((key) => key !== id) });

  return (
    <div className="editor-card" style={{ borderLeft: "3px solid #b9770e", marginBottom: "0.75rem" }}>
      <strong>🎬 Arc Director</strong>
      <p className="muted" style={{ fontSize: "0.85em", marginTop: "0.25rem" }}>
        Make the antagonist's arc climb out of the loop and actually break. Pacing is automatic and
        deterministic — the cost instruction is withheld from the AI until the arc is ripe, so it can't
        land the climax early. See <code>docs/adventure-design.md</code>.
      </p>

      {onGenerateArc && (
        <Field label="✨ Generate this arc from a concept">
          <div className="row" style={{ gap: "0.5rem", alignItems: "stretch" }}>
            <input
              style={{ flex: 1 }}
              placeholder="e.g. a gang leader who killed my father runs the city's underworld"
              value={concept}
              onChange={(event) => setConcept(event.target.value)}
            />
            <button
              type="button"
              disabled={loading || !concept.trim()}
              onClick={() => void onGenerateArc(component.id, concept.trim()).then(() => setConcept(""))}
              title="Write the premise, simmer behavior, cost, pace, and trigger mode following best practices. You still pick the threads below."
            >
              {loading ? "Generating…" : "Generate Arc"}
            </button>
          </div>
        </Field>
      )}

      {onProposeArcFromHistory && (
        <div style={{ margin: "0.25rem 0 0.5rem" }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onProposeArcFromHistory(component.id)}
            title="Read the last ~50 turns and draft an arc that grows out of what's been happening. It goes to the Memory Inbox for your approval — nothing is applied until you approve it."
          >
            {loading ? "Reading the story…" : "✨ Suggest an arc from recent play → Inbox"}
          </button>
          <p className="muted" style={{ fontSize: "0.8em", margin: "0.25rem 0 0" }}>
            For a story that's gone quiet. The AI reads recent play and proposes a new arc; review and
            approve it in the Memory Inbox. Approving seeds this arc and starts it simmering.
          </p>
        </div>
      )}

      <div className="row" style={{ alignItems: "center", gap: "0.75rem", margin: "0.5rem 0" }}>
        <span className="badge badge-priority">{arc.phase.toUpperCase()}</span>
        <span className="muted">Tier {arc.tier}/5 · engagement {totalEngagement}</span>
        {arc.pendingBreak && <span className="badge badge-protected">Ready to break</span>}
      </div>

      {arc.pendingBreak && (
        <div className="row" style={{ gap: "0.5rem", margin: "0.5rem 0", alignItems: "center" }}>
          <span>The arc is ripe — let it break?</span>
          <button type="button" className="danger" onClick={() => setPhase("break")}>Let it break</button>
          <button type="button" onClick={() => patch({ arcState: { ...arc, pendingBreak: false } })}>Not yet</button>
        </div>
      )}

      {arc.phase === "aftermath" && (component.arcContinuationOptions?.length ?? 0) > 0 && (
        <div className="editor-card" style={{ borderLeft: "3px solid #2e7d32", margin: "0.5rem 0" }}>
          <strong>This arc resolved — where does it go next?</strong>
          <p className="muted" style={{ fontSize: "0.85em", margin: "0.25rem 0" }}>
            Picking one banks the finished arc as a Story Card and starts the next arc fresh (simmering). Or write your own below.
          </p>
          {component.arcContinuationOptions!.map((opt, index) => (
            <div key={index} style={{ marginTop: "0.4rem" }}>
              <button
                type="button"
                onClick={() => dispatch({ type: "APPLY_ARC_CONTINUATION", componentId: component.id, option: opt })}
                title={opt.premise}
              >
                {opt.label}
              </button>
              <span className="muted" style={{ fontSize: "0.85em", marginLeft: "0.5rem" }}>{opt.premise}</span>
            </div>
          ))}
        </div>
      )}

      <Field label="Pacing triggers — which Story Cards / Brains advance this arc?">
        <p className="muted">Each selected card or brain that triggers adds one engagement per turn. Multiple matches add multiple points, even during ordinary conversation. Choose specific threats or evidence; selecting a frequent companion or a broad deal card can rush the arc. With no selections, pacing stays manual.</p>
        <div style={{ maxHeight: "9rem", overflowY: "auto", border: "1px solid #444", borderRadius: "4px", padding: "0.4rem" }}>
          {candidates.length === 0 && <p className="muted" style={{ margin: 0 }}>Create Story Cards or Brains first.</p>}
          {candidates.map((candidate) => (
            <label key={candidate.id} className="arc-thread-option">
              <input type="checkbox" checked={threadSet.has(candidate.id)} onChange={(event) => toggleThread(candidate.id, event.target.checked)} />
              <span>
                {candidate.label} <span className="muted">({candidate.kind}){threadSet.has(candidate.id) ? ` · ${arc.threadEngagement[candidate.id] ?? 0} engagements` : ""}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <div className="grid two">
        <Field label="The Timer — how long should it simmer?">
          <select value={component.arcPace ?? "medium"} onChange={(event) => patch({ arcPace: event.target.value as ArcPace })}>
            {(["short", "medium", "long", "epic"] as ArcPace[]).map((pace) => (
              <option key={pace} value={pace}>{ARC_PACE_LABELS[pace]}</option>
            ))}
          </select>
        </Field>
        <Field label="Who springs the break?">
          <select value={component.arcTriggerMode ?? "ask"} onChange={(event) => patch({ arcTriggerMode: event.target.value as ArcTriggerMode })}>
            <option value="ask">Ask me first (leash)</option>
            <option value="auto">Let the AI spring it (auto)</option>
          </select>
        </Field>
      </div>

      <CheckboxField
        label="Auto-continue the next arc (surprise me — no chooser, no spoiler)"
        checked={component.arcAutoContinue === true}
        onChange={(arcAutoContinue) => patch({ arcAutoContinue })}
      />
      <p className="muted" style={{ fontSize: "0.8em", margin: "0 0 0.5rem" }}>
        When this arc resolves, the Director silently picks the most convergent next arc and seeds it
        simmering — you meet the new threat in the story, not a menu. Off = you pick from drafted directions.
      </p>

      <Field label="How the baddie behaves while building (simmer)">
        <textarea
          rows={3}
          placeholder="Recur through traps, hostage plays, near-misses. Stay off-screen — glimpses, not monologues. Always connected to the larger plan."
          value={component.arcSimmerInstruction ?? ""}
          onChange={(event) => patch({ arcSimmerInstruction: event.target.value })}
        />
      </Field>
      <Field label="How the confrontation lands — the cost (only injected at break)">
        <textarea
          rows={3}
          placeholder="The antagonist forces a confrontation that can't be deferred. It is allowed to cost the cast — named allies can die, ground can be lost. The player stays the strongest; the win is just expensive."
          value={component.arcBreakInstruction ?? ""}
          onChange={(event) => patch({ arcBreakInstruction: event.target.value })}
        />
      </Field>

      {(configured || canCompleteArc || arcActionStatus || phaseStatus) && (
        <div className="row" style={{ gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            disabled={!configured || arc.phase === "break"}
            onClick={() => setPhase("break")}
            title="Force the climax now, regardless of pacing."
          >
            {arc.phase === "break" ? "Break armed" : "Spring it now"}
          </button>
          <button type="button" disabled={!configured} onClick={() => setPhase("aftermath")} title="Mark the arc resolved, without archiving it yet.">Move to aftermath</button>
          <button
            type="button"
            disabled={!canCompleteArc}
            onClick={completeArcToStoryCard}
            title="Create a historical plot Story Card from this arc log, then clear Current Arc for the next arc."
          >
            {"Complete Arc -> Story Card"}
          </button>
          <button type="button" disabled={!configured} onClick={() => setPhase("simmer")} title="Reset pacing and start a fresh climb.">Reset to simmer</button>
          {(arcActionStatus || phaseStatus) && (
            <span className="badge badge-protected" role="status">
              {arcActionStatus || phaseStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const SINGLETON_TYPES = new Set<ComponentType>(["narrationRules", "aiInstructions", "plotEssentials", "currentArc", "authorNote"]);

const activeComponentTypes: ComponentType[] = ["narrationRules", "aiInstructions", "plotEssentials", "currentArc", "authorNote", "custom"];
const inclusionPolicies: ContextInclusionPolicy[] = ["always", "triggered", "manual", "systemSuggested"];

const TYPE_LABELS: Record<ComponentType, string> = {
  narrationRules: "Narration Rules",
  aiInstructions: "AI Instructions",
  plotEssentials: "Plot Essentials",
  currentArc: "Current Story Arc",
  activePressure: "Active Pressure",
  immediateMomentum: "Immediate Momentum",
  authorNote: "Author's Note",
  memory: "Lore Block (legacy)",
  custom: "Custom",
};

const TYPE_DESCRIPTIONS: Record<ComponentType, string> = {
  narrationRules: "The primary per-adventure behavior contract — POV, format, player agency, continuity, tone, and hard writing rules. Loaded first with the system shell. It is valid to keep all stable generation rules here and use no AI Instructions block.",
  aiInstructions: "Optional scenario-specific rules separated for organization. Use this only when you want a distinct drift-prevention or genre contract outside Narration Rules. Do not duplicate rules already present in Narration Rules; both blocks load every turn.",
  plotEssentials: "Current operating truth — what is happening now, open tensions, obligations, and major constraints that should shape every scene. Keep it compact and replace it when it drifts. Outgoing facts become reviewable historical Story Card proposals.",
  currentArc: "A running log of the active story arc — auto-updated as arc-relevant events occur. Seed it with a one-line Arc Premise that defines what this arc is about. The AI only appends entries when something genuinely advances or complicates that premise. When the arc is complete, graduate it to a Story Card and start fresh.",
  activePressure: "",
  immediateMomentum: "Disabled legacy component. Immediate next-beat direction now belongs in Recent Messages or the one-turn Next Output Bias.",
  authorNote: "Near-context narrative direction — inserted just before Recent Messages for maximum influence on the next response. One per adventure. Most powerful mid-session correction tool: if a character is drifting too passive, too emotional, or too reactive, add a directive here before the next turn. 'Nix should have a project she is actively working on right now' resets the register immediately.",
  memory: "Legacy lore block. Move content to a Story Card with type Lore for triggered inclusion.",
  custom: "A general-purpose context block. Configure inclusion policy, priority, and protection manually.",
};

function componentContextText(component: ComponentEntry): string {
  if (component.type !== "currentArc") return component.content;

  const phase = component.arcState?.phase ?? "simmer";
  const phaseDirection =
    phase === "break"
      ? component.arcBreakInstruction?.trim()
      : phase === "simmer" || phase === "escalate"
        ? component.arcSimmerInstruction?.trim()
        : undefined;

  if (!component.content.trim() && !component.arcPremise?.trim() && !phaseDirection) return "";

  const premiseHeader = component.arcPremise?.trim() ? `[Arc Premise: ${component.arcPremise.trim()}]\n` : "";
  const directionBlock = phaseDirection ? `\n\n[ARC DIRECTION \u2014 ${phase.toUpperCase()}]\n${phaseDirection}` : "";
  return premiseHeader + (component.content.trim() || "(no entries yet)") + directionBlock;
}

function ComponentSummary({ component, query }: { component: ComponentEntry; query: string }) {
  const snippet = contentSnippet(component.content, query);
  const memoryUpdatedAt = formatCompactTimestamp(component.lastMemoryUpdatedAt);
  const tokenEstimate = approximateTokenCount(componentContextText(component));
  return (
    <span className="story-card-summary">
      <span className="story-card-title"><Highlight text={TYPE_LABELS[component.type]} query={query} /></span>
      <span className="story-card-badges">
        {!component.active && <span className="badge badge-inactive">Inactive</span>}
        {component.pinned && <span className="badge badge-pinned">Pinned</span>}
        {component.protected && <span className="badge badge-protected">Protected</span>}
        {component.priority > 0 && <span className="badge badge-priority">p{component.priority}</span>}
        <TokenCountBadge count={tokenEstimate} title="Estimated tokens in plot context" />
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
  onSuggestPlotUpdates?: () => Promise<void>;
  onBuildPlotMemory?: (request: PlotAIBuilderRequest) => Promise<void>;
  onAuditComponents?: (nTurns: number, includeAI: boolean) => Promise<ComponentAuditRecommendation[]>;
  onRegeneratePlotEssentials?: (componentId: string) => Promise<string>;
  onUpdatePEComponentNow?: (componentId: string) => Promise<void>;
  /** Generate fresh content for Narration Rules / AI Instructions / Author's Note. Returns a string for review. */
  onGenerateComponent?: (componentId: string) => Promise<string>;
  /** Generate an Arc Director setup from a concept and apply it to the Current Arc component. */
  onGenerateArc?: (componentId: string, concept: string) => Promise<void>;
  /** Draft an arc from recent play and drop it in the Memory Inbox for approval. */
  onProposeArcFromHistory?: (componentId: string) => Promise<void>;
}

type ComponentAuditState = {
  status: "running" | "done" | "error";
  recommendations: ComponentAuditRecommendation[];
  errorMessage?: string;
};

const GENERATABLE_COMPONENT_TYPES = new Set<ComponentType>(["narrationRules", "aiInstructions", "authorNote"]);
const COMPONENT_AUDIT_TYPES: ComponentType[] = ["plotEssentials", "activePressure", "currentArc", "custom", "memory"];

const PLOT_GROUP_DEFINITIONS: Array<{
  id: string;
  title: string;
  description: string;
  types: ComponentType[];
}> = [
  {
    id: "contract",
    title: "Core Story Contract",
    description: "How the story is written and steered.",
    types: ["narrationRules", "aiInstructions", "authorNote"],
  },
  {
    id: "current-state",
    title: "Current Story State",
    description: "What is true right now and what pressure is active.",
    types: ["plotEssentials", "activePressure", "currentArc"],
  },
];

export function ComponentsPage({ adventure, dispatch, loading, onSuggestPlotUpdates, onBuildPlotMemory, onAuditComponents, onRegeneratePlotEssentials, onUpdatePEComponentNow, onGenerateComponent, onGenerateArc, onProposeArcFromHistory }: ComponentsPageProps) {
  const [search, setSearch] = useState("");
  const [plotBuilderDescription, setPlotBuilderDescription] = useState("");
  const [plotBuilderTarget, setPlotBuilderTarget] = useState<PlotAIBuilderRequest["target"]>("plotEssentials");
  const [plotBuilderTargetComponentId, setPlotBuilderTargetComponentId] = useState("");
  const [plotBuilderUseRecentStory, setPlotBuilderUseRecentStory] = useState(true);
  const [pePreview, setPePreview] = useState<Record<string, string>>({});
  const [peRegenerating, setPeRegenerating] = useState<string | null>(null);
  const [graduateConfirm, setGraduateConfirm] = useState<string | null>(null);
  const [graduateStatus, setGraduateStatus] = useState<{ componentId: string; message: string } | null>(null);
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

  function handleGraduateArc(component: ComponentEntry) {
    const canGraduate = Boolean(component.arcPremise?.trim() || component.content.trim());
    if (!canGraduate) return;
    if (graduateConfirm !== component.id) {
      setGraduateConfirm(component.id);
      setGraduateStatus(null);
      return;
    }
    const title = component.arcPremise?.trim() || component.title;
    dispatch({ type: "COMPLETE_ARC_TO_STORY_CARD", componentId: component.id });
    setGraduateConfirm(null);
    setGraduateStatus({ componentId: component.id, message: `Completed arc saved as Story Card: ${title}.` });
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
  const hasActivePlotEssentials = adventure.components.some((c) => c.type === "plotEssentials" && c.active);

  const availableTypes = activeComponentTypes.filter(
    (t) => !SINGLETON_TYPES.has(t) || !existingTypes.has(t),
  );

  const searchLower = search.toLowerCase().trim();
  const visibleComponents = [...adventure.components]
    .sort((a, b) => b.priority - a.priority)
    .filter((c) => !searchLower ||
      TYPE_LABELS[c.type].toLowerCase().includes(searchLower) ||
      c.content.toLowerCase().includes(searchLower)
    );
  const activeCount = adventure.components.filter((component) => component.active).length;
  const groupedComponentIds = new Set<string>();
  const componentGroups = PLOT_GROUP_DEFINITIONS
    .map((group) => {
      const components = visibleComponents.filter((component) => group.types.includes(component.type));
      components.forEach((component) => groupedComponentIds.add(component.id));
      return { ...group, components };
    })
    .filter((group) => group.components.length > 0);
  const extraComponents = visibleComponents.filter((component) => !groupedComponentIds.has(component.id));
  if (extraComponents.length > 0) {
    componentGroups.push({
      id: "extras",
      title: "Extra World Blocks",
      description: "Optional always-on or custom context.",
      types: [],
      components: extraComponents,
    });
  }
  const plotBuilderTargetComponents = adventure.components.filter((component) => component.type === plotBuilderTarget);
  const selectedPlotBuilderComponentId = plotBuilderTargetComponentId || plotBuilderTargetComponents[0]?.id;

  async function handleBuildPlotMemory() {
    if (!onBuildPlotMemory || !plotBuilderDescription.trim()) return;
    await onBuildPlotMemory({
      description: plotBuilderDescription.trim(),
      target: plotBuilderTarget,
      targetComponentId: selectedPlotBuilderComponentId,
      useRecentStory: plotBuilderUseRecentStory,
    });
    setPlotBuilderDescription("");
  }

  return (
    <section className="page editor-surface components-page">
      <div className="editor-page-summary">
        <p className="muted">
          Always-on plot truth, narration rules, author direction, and custom context blocks.
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
        <strong> Narration Rules, AI Instructions, Plot Essentials,</strong> and <strong>Author's Note</strong> are singletons.
        AI Instructions are optional; Narration Rules can hold the complete stable behavior contract by themselves.
      </p>

      {onBuildPlotMemory && (
        <details className="panel">
          <summary>Draft plot memory with AI</summary>
          <p className="muted">
            Describe the current situation, pressure, or correction. The AI drafts a pending update for the selected plot component.
          </p>
          <div className="grid three">
            <Field label="Target">
              <select
                value={plotBuilderTarget}
                onChange={(event) => {
                  setPlotBuilderTarget(event.target.value as PlotAIBuilderRequest["target"]);
                  setPlotBuilderTargetComponentId("");
                }}
              >
                <option value="plotEssentials">Plot Essentials</option>
                {adventure.components.some(c => c.type === "activePressure") && <option value="activePressure">Active Pressure</option>}
              </select>
            </Field>
            <Field label="Component">
              <select
                value={selectedPlotBuilderComponentId ?? ""}
                onChange={(event) => setPlotBuilderTargetComponentId(event.target.value)}
              >
                {plotBuilderTargetComponents.length === 0 && <option value="">Create if approved</option>}
                {plotBuilderTargetComponents.map((component) => (
                  <option key={component.id} value={component.id}>{component.title}</option>
                ))}
              </select>
            </Field>
            <CheckboxField
              label="Use recent story"
              checked={plotBuilderUseRecentStory}
              onChange={setPlotBuilderUseRecentStory}
            />
          </div>
          <Field label="Plot brief">
            <textarea
              rows={4}
              value={plotBuilderDescription}
              onChange={(event) => setPlotBuilderDescription(event.target.value)}
              placeholder="Example: The gala has shifted from social cover to a hostage crisis; keep the mission active, the Red Ring off-balance, and the player's next move open."
            />
          </Field>
          <div className="toolbar">
            <button
              type="button"
              className="primary-action"
              disabled={loading || !plotBuilderDescription.trim()}
              onClick={() => void handleBuildPlotMemory()}
            >
              {loading ? "Drafting..." : "Draft Plot Suggestion"}
            </button>
            <span className="muted">The draft opens in Memory Suggestions for review.</span>
          </div>
        </details>
      )}

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
            onClick={() => dispatch({ type: "UPSERT_COMPONENT", component: makeComponent({ title: TYPE_LABELS[type], content: "", type }) })}
          >
            Add {TYPE_LABELS[type]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => dispatch({ type: "UPSERT_COMPONENT", component: makeComponent({ title: "New Block", content: "", type: "custom" }) })}
        >
          Add Custom Block
        </button>
      </div>

      {(onAuditComponents || onSuggestPlotUpdates) && (
        <details className="panel editor-tools-panel component-maintenance-panel" open>
          <summary>Review and Maintain Components</summary>
          <div className="component-maintenance-grid">
            {onAuditComponents && (
              <section className="component-tool-card component-tool-card-primary">
                <div className="component-tool-copy">
                  <h3>Clean up plot components</h3>
                  <p className="muted">
                    Find bloated Plot Essentials, disabled legacy blocks, duplicate always-on facts, and current-state/history drift.
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
            )}

            {onSuggestPlotUpdates && (
              <section className="component-tool-card">
                <div className="component-tool-copy">
                  <h3>Suggest Plot Essentials updates</h3>
                  <p className="muted">
                    Ask the AI to draft Memory Suggestions from recent play. Results open in Memory Suggestions for review.
                  </p>
                </div>
                <div className="component-tool-controls">
                  <button
                    type="button"
                    disabled={loading || !hasActivePlotEssentials}
                    onClick={onSuggestPlotUpdates}
                    title="Ask the AI to review recent story turns and suggest updates to Plot Essentials. Results appear in Memory Suggestions."
                  >
                    {loading ? "Generating..." : "Suggest Plot Updates"}
                  </button>
                </div>
              </section>
            )}
          </div>
        </details>
      )}

      <div className="component-group-list">
        {componentGroups.map((group) => (
          <details key={group.id} className="component-group-panel" open>
            <summary className="component-group-summary">
              <span>
                <strong>{group.title}</strong>
                <span className="muted">{group.description}</span>
              </span>
              <span className="badge badge-type">{group.components.length}</span>
            </summary>
            <div className="list split-editor-list component-editor-list">
        {group.components.map((component) => (
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

            <div className="editor-card item-inspector component-inspector">
              <div className="panel-heading item-inspector-heading">
                <div>
                  <p className="eyebrow">
                    {component.active ? "active" : "inactive"} · {component.inclusionPolicy}
                  </p>
                  <h3>{TYPE_LABELS[component.type]}</h3>
                  <div className="story-card-badges">
                    {component.type === "currentArc" && (
                      <span className="badge badge-priority">{(component.arcState?.phase ?? "simmer").toUpperCase()}</span>
                    )}
                    {component.pinned && <span className="badge badge-pinned">Pinned</span>}
                    {component.protected && <span className="badge badge-protected">Protected</span>}
                    {component.priority > 0 && <span className="badge badge-priority">p{component.priority}</span>}
                  </div>
                </div>
                <div className="row">
                  {(component.type === "plotEssentials" || component.type === "activePressure" || component.type === "currentArc") && onUpdatePEComponentNow && (
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
              </div>
              <p className="muted component-type-hint">{TYPE_DESCRIPTIONS[component.type]}</p>
              {component.type === "currentArc" && (
                <Field label="Arc Premise" style={{ marginBottom: "0.5rem" }}>
                  <textarea
                    rows={2}
                    placeholder="One-line premise — what is this arc building toward? e.g. 'Kira is building toward deserting the Fire Nation'"
                    value={component.arcPremise ?? ""}
                    onChange={(event) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { arcPremise: event.target.value } })}
                  />
                  <p className="muted" style={{ marginTop: "0.25rem", fontSize: "0.85em" }}>
                    The AI auto-appends arc entries only when events meaningfully advance <em>this specific premise</em>. Without a premise, auto-update is disabled.
                  </p>
                </Field>
              )}
              {component.type === "currentArc" && (
                <details className="brain-secondary-details item-secondary-details component-arc-details" open>
                  <summary className="component-arc-summary">
                    <span>Arc Director</span>
                    <span className="badge badge-priority">{(component.arcState?.phase ?? "simmer").toUpperCase()}</span>
                    {!(component.arcPremise?.trim() || component.content.trim()) && (
                      <span className="badge badge-type">No arc log</span>
                    )}
                  </summary>
                  <ArcDirector adventure={adventure} component={component} dispatch={dispatch} onGenerateArc={onGenerateArc} onProposeArcFromHistory={onProposeArcFromHistory} loading={loading} />
                </details>
              )}
              <section className="item-focus-section">
                <div className="item-section-heading">
                  <div>
                    <p className="eyebrow">{component.type === "currentArc" ? "arc log" : "context block"}</p>
                    <h4>{component.type === "currentArc" ? "Current story arc history" : "Text sent to the model"}</h4>
                  </div>
                  <span className="muted">{component.content.split("\n").filter((line) => line.trim()).length} line{component.content.split("\n").filter((line) => line.trim()).length === 1 ? "" : "s"}</span>
                </div>
              <Field label={component.type === "currentArc" ? "Arc Log" : "Content"}>
                <textarea
                  rows={6}
                  value={component.content}
                  onChange={(event) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { content: event.target.value } })}
                />
              </Field>
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
              {(component.type === "plotEssentials" || component.type === "activePressure" || component.type === "currentArc") && (
                <div className="grid two">
                  {component.type === "plotEssentials" && (
                    <CheckboxField
                      label="Auto-suggest full replacements when current truth drifts"
                      checked={component.autoUpdate ?? adventure.memoryDetectionSettings.enabled}
                      onChange={(autoUpdate) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { autoUpdate } })}
                    />
                  )}
                  <Field label="Auto-update cooldown (turns)">
                    <NumberInput
                      value={component.autoUpdateCooldownTurns ?? (component.type === "currentArc" ? 4 : 3)}
                      min={0}
                      onChange={(value) => dispatch({ type: "UPDATE_COMPONENT", componentId: component.id, patch: { autoUpdateCooldownTurns: value } })}
                    />
                  </Field>
                  <Field label="Last updated (turn)">
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
                {(component.type === "plotEssentials" || component.type === "activePressure" || component.type === "currentArc") && onUpdatePEComponentNow && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onUpdatePEComponentNow(component.id)}
                    title="Ask the AI to review recent story turns and generate an updated version. Result goes to Memory Suggestions for review."
                  >
                    {loading ? "Generating…" : "Update Now"}
                  </button>
                )}
                {component.type === "currentArc" && (
                  <button
                    type="button"
                    className={graduateConfirm === component.id ? "danger" : ""}
                    disabled={!component.arcPremise?.trim() && !component.content.trim()}
                    title="Graduate the completed arc to a permanent Story Card and reset the arc log."
                    onClick={() => handleGraduateArc(component)}
                  >
                    {graduateConfirm === component.id ? "Confirm — Graduate Arc" : "Complete Arc → Story Card"}
                  </button>
                )}
                {graduateConfirm === component.id && (
                  <button type="button" onClick={() => setGraduateConfirm(null)}>Cancel</button>
                )}
                {graduateStatus?.componentId === component.id && (
                  <span className="badge badge-protected" role="status">{graduateStatus.message}</span>
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
          </details>
        ))}
            </div>
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
