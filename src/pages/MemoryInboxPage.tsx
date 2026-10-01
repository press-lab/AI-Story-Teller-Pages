import { useState } from "react";
import { classifyMemory } from "../memory/classificationPolicy";
import { resolveMemoryTarget } from "../memory/resolveMemoryTarget";
import { proposalTargetChanged } from "../state/adventureReducer";
import { memoryHealthIssues } from "../memory/memoryHealth";
import type { MemoryAutoApproveSettings, MemoryProposal, MemoryProposalType, MemoryReconcileRequest, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, JsonTextarea, NumberInput, commaList, fromCommaList } from "./shared";

const proposalTypes: MemoryProposalType[] = [
  "storyCard",
  "brainUpdate",
  "plotEssentialsUpdate",
  "currentArcUpdate",
  "arcProposal",
  "plotPressureUpdate",
  "storyStateUpdate",
  "sceneDirectionUpdate",
  "plotMomentumUpdate",
  "summaryUpdate",
  "ignore",
];
const storyCardTypes: StoryCardType[] = ["character", "location", "lore", "plot", "event", "custom"];

interface MemoryInboxPageProps extends AdventurePageProps {
  onFindEventMemories?: (onProgress: (message: string) => void, signal: AbortSignal) => Promise<void>;
  onRegenerateProposal?: (proposalId: string) => Promise<void>;
  onReconcileMemory?: (request: MemoryReconcileRequest) => Promise<void>;
  loading?: boolean;
}

export function MemoryInboxPage({ adventure, dispatch, onRegenerateProposal, onReconcileMemory, onFindEventMemories, loading = false }: MemoryInboxPageProps) {
  const allProposals = [...adventure.activeState.memoryProposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [eventScan, setEventScan] = useState<AbortController>();
  const [eventProgress, setEventProgress] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [reconcileDirective, setReconcileDirective] = useState("");
  const [reconcileEntryCount, setReconcileEntryCount] = useState(20);
  const [reconcileIncludeBrains, setReconcileIncludeBrains] = useState(true);
  const [search, setSearch] = useState("");
  const searchLower = search.toLowerCase().trim();
  const visibleProposals = allProposals.filter((proposal) => !searchLower
    || proposal.title.toLowerCase().includes(searchLower)
    || proposal.content.toLowerCase().includes(searchLower)
    || proposal.sourceText.toLowerCase().includes(searchLower)
    || proposal.rationale.toLowerCase().includes(searchLower));
  const pending = visibleProposals.filter((p) => p.status === "pending");
  const resolved = visibleProposals.filter((p) => p.status !== "pending");
  const pendingStoryState = allProposals.filter((p) => p.status === "pending" && p.proposedType === "storyStateUpdate" && !p.requiresReview);

  function approveAllStoryState() {
    // Oldest first, so a later full rewrite or line edit lands last.
    [...pendingStoryState].reverse().forEach((proposal) => dispatch({ type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id }));
  }
  const totalPending = allProposals.filter((p) => p.status === "pending").length;
  const totalResolved = allProposals.length - totalPending;

  function updateProposal(proposal: MemoryProposal, patch: Partial<MemoryProposal>) {
    dispatch({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: proposal.id, patch });
  }

  function createProposal() {
    const classified = classifyMemory(sourceText, {
      existingBrainNames: adventure.brains.map((brain) => brain.characterName),
      existingStoryCards: adventure.storyCards.map((card) => ({ id: card.id, title: card.title, keys: card.keys })),
    });
    const routed = resolveMemoryTarget(adventure, {
      proposedType: classified.proposedType,
      title: classified.title,
      content: classified.content,
      sourceText,
      suggestedTriggers: classified.suggestedTriggers,
      targetId: classified.targetId,
      rationale: classified.rationale,
    });
    const timestamp = nowIso();
    dispatch({
      type: "ADD_MEMORY_PROPOSAL",
      proposal: {
        id: createId("proposal"),
        sourceTurnId: adventure.messages.at(-1)?.id ?? "manual",
        sourceText,
        proposedType: routed.proposedType,
        title: routed.title,
        content: routed.content,
        suggestedTriggers: routed.suggestedTriggers,
        confidence: classified.confidence,
        rationale: routed.rationale ?? classified.rationale,
        status: "pending",
        targetId: routed.targetId,
        appendContent: routed.appendContent,
        memoryMode: routed.memoryMode,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
    setSourceText("");
  }

  async function runReconcile() {
    const directive = reconcileDirective.trim();
    if (!onReconcileMemory) return;
    await onReconcileMemory({
      directive,
      entryCount: Math.max(1, Math.min(100, Math.round(reconcileEntryCount || 20))),
      includeBrains: reconcileIncludeBrains,
    });
  }

  const autoApprove = adventure.memoryAutoApprove;
  const healthIssues = memoryHealthIssues(adventure);
  const activeCorrections = (adventure.activeState.corrections ?? []).filter((correction) => correction.status === "active");

  function setAutoApprove(patch: Partial<MemoryAutoApproveSettings>) {
    dispatch({ type: "SET_MEMORY_AUTO_APPROVE", settings: { ...autoApprove, ...patch } });
  }

  return (
    <section className="page editor-surface memory-inbox-page">
      <div className="editor-page-summary">
        <p className="muted">
          Review proposed memory writes before they become active story context. Event Memories always wait for your approval.
        </p>
        <div className="editor-stat-row" aria-label="Memory suggestion counts">
          <span>{totalPending} pending</span>
          <span>{totalResolved} resolved</span>
          {searchLower && <span>{visibleProposals.length} shown</span>}
        </div>
      </div>

      {healthIssues.length > 0 && (
        <details className="panel memory-health-panel" open={healthIssues.some((issue) => issue.severity === "warning")}>
          <summary>Memory health ({healthIssues.length})</summary>
          <ul className="memory-health-list">
            {healthIssues.map((issue) => (
              <li key={issue.id}>
                <strong>{issue.severity === "warning" ? "⚠ " : ""}{issue.title}</strong>
                <p className="muted" style={{ margin: "0.15rem 0 0.5rem" }}>{issue.detail}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {activeCorrections.length > 0 && (
        <div className="panel">
          <strong>Author corrections in effect</strong>
          <p className="muted" style={{ margin: "0.25rem 0" }}>
            Your out-of-character corrections, and story edits that removed recorded text. The narrator follows them for a few turns, and the next memory pass retracts what they reject from Story State, cards, and knowledge.
          </p>
          <ul>
            {activeCorrections.map((correction) => (
              <li key={correction.id}>
                <span className="muted">Turn {correction.turn}{correction.seenByPass ? " · read by memory" : " · waiting for the memory pass"}: </span>
                {correction.text.length > 300 ? `${correction.text.slice(0, 300)}…` : correction.text}
                {" "}<button type="button" onClick={() => dispatch({ type: "DISMISS_CORRECTION", correctionId: correction.id })}>Dismiss</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onFindEventMemories && <div className="panel">
        <button type="button" disabled={loading || Boolean(eventScan)} onClick={async () => {
          const controller = new AbortController(); setEventScan(controller);
          try { await onFindEventMemories(setEventProgress, controller.signal); }
          catch (error) { setEventProgress(error instanceof Error ? error.message : "Event scan failed."); }
          finally { setEventScan(undefined); }
        }}>Find event memories in earlier play</button>
        {eventScan && <button type="button" onClick={() => eventScan.abort()}>Stop after current excerpt</button>}
        <p className="muted">Scans the Chronicle in excerpts using your background model. Each excerpt uses an AI request. Results remain suggestions for review.</p>
        <p role="status">{eventProgress}</p>
      </div>}
      <div className="editor-command-bar">
        <input
          type="search"
          placeholder="Search suggestions..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <details className="panel editor-tools-panel">
        <summary>Rules &amp; auto-approve</summary>
        <h3>Memory Suggestions</h3>
        <p className="muted">
          Memory Suggestions holds AI-proposed changes to your story data — Story State rewrites, new Story Cards, Character Self updates
          (thoughts and knowledge boundaries), Plot Essentials rewrites, Active Pressure updates, and legacy Summary changes.
          A newer Story State suggestion replaces an older one that is still pending. The AI generates these automatically after turns or when
          you use <strong>Remember This</strong>. Review each proposal and <strong>Approve</strong> to apply it,
          <strong> Reject</strong> to dismiss it cleanly, or <strong>Ignore</strong> to remove it from view without applying.
          You can edit the content before approving.
          {" "}<strong>Approved Story Cards, Character Self updates, Plot Essentials, and Active Pressure become active context</strong> — the model reads them when their section is included.
          Be especially careful with Character Self and plot updates: approving emotional escalation or relationship milestones
          unchecked is how characters drift. Edit proposals before approving, or reject ones that pull the story somewhere you don't want.
        </p>
        <div className="auto-approve-toggles">
          <span className="auto-approve-label muted">Auto-approve:</span>
          <CheckboxField label="Legacy Summary" checked={autoApprove.summaryUpdate} onChange={(v) => setAutoApprove({ summaryUpdate: v })} />
          <CheckboxField label="Plot Essentials" checked={autoApprove.plotEssentialsUpdate} onChange={(v) => setAutoApprove({ plotEssentialsUpdate: v })} />
          <CheckboxField label="Active Pressure" checked={autoApprove.plotPressureUpdate} onChange={(v) => setAutoApprove({ plotPressureUpdate: v })} />
          <CheckboxField label="Current Arc" checked={autoApprove.currentArcUpdate} onChange={(v) => setAutoApprove({ currentArcUpdate: v })} />
          <CheckboxField label="Arc Proposals" checked={autoApprove.arcProposal} onChange={(v) => setAutoApprove({ arcProposal: v })} />
          <CheckboxField label="Story Cards" checked={autoApprove.storyCard} onChange={(v) => setAutoApprove({ storyCard: v })} />
          <CheckboxField label="Characters" checked={autoApprove.brainUpdate} onChange={(v) => setAutoApprove({ brainUpdate: v })} />
          <CheckboxField label="Story State" checked={autoApprove.storyStateUpdate} onChange={(v) => setAutoApprove({ storyStateUpdate: v })} />
          <CheckboxField label="Scene Direction" checked={autoApprove.sceneDirectionUpdate !== false} onChange={(v) => setAutoApprove({ sceneDirectionUpdate: v })} />
        </div>
      </details>

      <details className="panel">
        <summary>Check Recent Entries</summary>
        <div className="grid two">
          <Field label="Entries to check">
            <NumberInput
              value={reconcileEntryCount}
              min={1}
              onChange={(value) => setReconcileEntryCount(Math.max(1, Math.min(100, Math.round(value || 20))))}
            />
          </Field>
          <CheckboxField
            label="Include Character Self"
            checked={reconcileIncludeBrains}
            onChange={setReconcileIncludeBrains}
          />
        </div>
        <Field label="What changed? (optional)">
          <textarea
            rows={3}
            value={reconcileDirective}
            onChange={(event) => setReconcileDirective(event.target.value)}
            placeholder="Optional: Ambessa is defeated and no longer an active pressure; keep Caitlyn angry about Jinx as a personal conflict."
          />
        </Field>
        <button type="button" disabled={!onReconcileMemory || loading} onClick={() => void runReconcile()}>
          {loading ? "Checking..." : "Check & Draft Updates"}
        </button>
      </details>

      <details className="panel">
        <summary>Manual Suggestion</summary>
        <Field label="Source Text">
          <textarea
            rows={3}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Paste narrative content to classify into a memory suggestion."
          />
        </Field>
        <button type="button" disabled={!sourceText.trim()} onClick={createProposal}>
          Create Suggestion
        </button>
      </details>

      {pendingStoryState.length > 1 && (
        <div className="row" style={{ gap: "0.5rem", alignItems: "center", margin: "0.5rem 0" }}>
          <button type="button" onClick={approveAllStoryState}>Approve all Story State edits ({pendingStoryState.length})</button>
          <span className="muted">Applies oldest first; line edits only change their own line.</span>
        </div>
      )}

      <div className="list">
        {pending.length === 0 && <p className="muted">No pending memory suggestions.</p>}
        {pending.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} targetChanged={proposal.status === "pending" && proposalTargetChanged(adventure, proposal)} dispatch={dispatch} onUpdate={updateProposal} onRegenerate={onRegenerateProposal} />
        ))}
      </div>

      {resolved.length > 0 && (
        <details className="panel memory-history-panel">
          <summary>History ({resolved.length})</summary>
          <div className="list" style={{ marginTop: "0.75rem" }}>
            {resolved.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} targetChanged={proposal.status === "pending" && proposalTargetChanged(adventure, proposal)} dispatch={dispatch} onUpdate={updateProposal} onRegenerate={onRegenerateProposal} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

interface ProposalCardProps {
  proposal: MemoryProposal;
  targetChanged?: boolean;
  dispatch: AdventurePageProps["dispatch"];
  onUpdate: (proposal: MemoryProposal, patch: Partial<MemoryProposal>) => void;
  onRegenerate?: (proposalId: string) => Promise<void>;
}

function ProposalCard({ proposal, targetChanged = false, dispatch, onUpdate, onRegenerate }: ProposalCardProps) {
  const isPending = proposal.status === "pending";
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerate() {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    try { await onRegenerate(proposal.id); } finally { setRegenerating(false); }
  }

  return (
    <details key={proposal.id} className={`card proposal-card proposal-${proposal.status}`} open={isPending}>
      <summary className="proposal-card-summary">
        <span className="proposal-card-title">
          <strong>{proposal.title || "Untitled suggestion"}</strong>
          <span className="muted">
            {proposal.proposedType}
          </span>
        </span>
        <span className="story-card-badges">
          <span className="badge badge-type">{Math.round(proposal.confidence * 100)}%</span>
            {isPending && proposal.requiresReview && <span className="badge">Review required</span>}
          {targetChanged && <span className="badge badge-protected" title="The target was edited after this suggestion was drafted. Approving replaces those edits.">Target edited since</span>}
          {proposal.claim && proposal.claim !== "fact" && <span className="badge">{proposal.claim}</span>}
          {!isPending && <span className="badge badge-inactive">{proposal.status}</span>}
          {proposal.suggestedTriggers.length > 0 && <span className="badge">{proposal.suggestedTriggers.length} keys</span>}
        </span>
        <span className="search-snippet">{proposal.content || proposal.sourceText || "No proposed content yet."}</span>
      </summary>

      <div className="proposal-card-body">
        <div className="panel-heading">
        <div className="suggestion-meta">
          <p className="eyebrow">
            {proposal.proposedType}
            {proposal.status !== "pending" ? ` · ${proposal.status}` : ""}
          </p>
          <input
            value={proposal.title}
            onChange={(event) => onUpdate(proposal, { title: event.target.value })}
            disabled={!isPending}
          />
        </div>
        <div className="row">
          <button
            type="button"
            onClick={() => dispatch({ type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id })}
          >
            Approve
          </button>
          {isPending && (
            <>
              {onRegenerate && (
                <button type="button" disabled={regenerating} onClick={handleRegenerate}>
                  {regenerating ? "…" : "Regenerate"}
                </button>
              )}
              <button
                type="button"
                onClick={() => dispatch({ type: "REJECT_MEMORY_PROPOSAL", proposalId: proposal.id })}
              >
                Reject
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => dispatch({ type: "IGNORE_MEMORY_PROPOSAL", proposalId: proposal.id })}
              >
                Ignore
              </button>
            </>
          )}
        </div>
      </div>

      {proposal.stateLine?.op === "set" && proposal.baseContent !== undefined && (
        <p className="muted" style={{ margin: "0.25rem 0" }}>Before: {proposal.baseContent || "(line not present)"}</p>
      )}
      {proposal.threadOp && (
        <p className="muted" style={{ margin: "0.25rem 0" }}>
          {proposal.threadOp.op === "add" ? "Opens a new thread:" : proposal.threadOp.op === "update" ? `Rewords thread ${proposal.threadOp.threadId} (was: ${proposal.baseContent ?? "?"}):` : `Resolves ${proposal.threadOp.threadIds.length} thread${proposal.threadOp.threadIds.length === 1 ? "" : "s"}:`}
        </p>
      )}
      {proposal.stateLine && proposal.stateLine.op !== "set" && (
        <p className="muted" style={{ margin: "0.25rem 0" }}>{proposal.stateLine.op === "add" ? "Adds this item to" : "Removes this item from"} {proposal.stateLine.label}:</p>
      )}
      <textarea
        rows={proposal.stateLine ? 2 : 5}
        value={proposal.content}
        onChange={(event) => onUpdate(proposal, { content: event.target.value })}
        placeholder="Proposed content..."
        disabled={proposal.status === "approved"}
      />

      <details className="editor-tools-panel">
        <summary>Source &amp; details</summary>
        {proposal.eventMemory && <p>Event Memory · {proposal.eventMemory.kind} · Participants: {proposal.eventMemory.participants.join(", ")} · Recall cues: {proposal.eventMemory.recallCues.join(", ")} · Source messages: {proposal.eventMemory.sourceMessageIds.join(", ")}</p>}
        <div className="grid two">
          <Field label="Source">
            <textarea
              rows={2}
              value={proposal.sourceText}
              onChange={(event) => onUpdate(proposal, { sourceText: event.target.value })}
            />
          </Field>
          <Field label="Rationale">
            <textarea
              rows={2}
              value={proposal.rationale}
              onChange={(event) => onUpdate(proposal, { rationale: event.target.value })}
            />
          </Field>
        </div>
        <div className="grid three">
          <Field label="Type">
            <select
              value={proposal.proposedType}
              onChange={(event) => onUpdate(proposal, { proposedType: event.target.value as MemoryProposalType })}
              disabled={!isPending}
            >
              {proposalTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          {proposal.proposedType === "storyCard" && (
            <>
              <Field label="Card Type">
                <select
                  value={proposal.storyCardType ?? "custom"}
                  onChange={(event) => onUpdate(proposal, { storyCardType: event.target.value as StoryCardType })}
                  disabled={!isPending}
                >
                  {storyCardTypes.map((type) => <option key={type} value={type}>{type === "event" ? "Event Memory" : type}</option>)}
                </select>
              </Field>
              <Field label="Memory Mode">
                <select
                  value={proposal.memoryMode ?? "static"}
                  onChange={(event) => onUpdate(proposal, { memoryMode: event.target.value as MemoryProposal["memoryMode"] })}
                  disabled={!isPending}
                >
                  <option value="static">static</option>
                  <option value="living">living</option>
                  <option value="historical">historical</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Triggers">
            <input
              value={commaList(proposal.suggestedTriggers)}
              onChange={(event) => onUpdate(proposal, { suggestedTriggers: fromCommaList(event.target.value) })}
            />
          </Field>
          <Field label="Confidence">
            <NumberInput
              value={proposal.confidence}
              min={0}
              onChange={(value) => onUpdate(proposal, { confidence: Math.max(0, Math.min(1, value)) })}
            />
          </Field>
        </div>
        {proposal.proposedType === "storyCard" && (
          <div className="grid two">
            <CheckboxField
              label="Let AI auto-update this card after relevant scenes"
              checked={proposal.autoUpdate === true}
              disabled={!isPending}
              onChange={(autoUpdate) => onUpdate(proposal, { autoUpdate })}
            />
            <Field label="Auto-update cooldown">
              <NumberInput
                value={proposal.autoUpdateCooldownTurns ?? 3}
                min={0}
                disabled={!isPending || proposal.autoUpdate !== true}
                onChange={(value) => onUpdate(proposal, { autoUpdateCooldownTurns: value })}
              />
            </Field>
          </div>
        )}
        {(proposal.storyCardPatch || proposal.componentPatch) && (
          <div className="grid two">
            {proposal.storyCardPatch && (
              <Field label="Story Card Patch">
                {isPending ? (
                  <JsonTextarea
                    rows={3}
                    value={proposal.storyCardPatch}
                    onValidChange={(storyCardPatch) => onUpdate(proposal, { storyCardPatch })}
                  />
                ) : (
                  <textarea rows={3} value={JSON.stringify(proposal.storyCardPatch, null, 2)} readOnly />
                )}
              </Field>
            )}
            {proposal.componentPatch && (
              <Field label="Plot Patch">
                {isPending ? (
                  <JsonTextarea
                    rows={3}
                    value={proposal.componentPatch}
                    onValidChange={(componentPatch) => onUpdate(proposal, { componentPatch })}
                  />
                ) : (
                  <textarea rows={3} value={JSON.stringify(proposal.componentPatch, null, 2)} readOnly />
                )}
              </Field>
            )}
          </div>
        )}
      </details>
      </div>
    </details>
  );
}
