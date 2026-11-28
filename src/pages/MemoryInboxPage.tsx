import { autonomousSubjectNames, isAutonomousLore } from "../memory/autonomousLore";
import { RelationshipParticipants } from "./RelationshipParticipants";
import { canonicalRelationshipIds, relationshipTitle, validateRelationshipIds, relationshipIdError, relationshipKey, relationshipMatches, relationshipProposalError } from "../memory/relationshipCards";
import { PRIMARY_STORY_CARD_TYPES } from "../memory/storyCardArchitecture";
import { MemorySuggestionBuilder } from "./MemorySuggestionBuilder";
import type { MemoryDraftRequest, ProviderConfig } from "../types/adventure";
import { storyCardAutoApprovalBlockers } from "../memory/storyCardAutoApproval";
import { validateLoreChronology } from "../memory/validateLoreChronology";
import { ArchivedMemoryDetails } from "./ArchivedMemoryDetails";
import { placementValidationError, proposalDestinationLabel } from "../memory/storyCardPlacement";
import { MemoryDecisionsPage } from "./MemoryDecisionsPage";
import { suggestionSourceValid } from "../memory/storyCardSuggestions";
import { memoryTargetSnapshot } from "../memory/memoryCycleState";
import { useEffect, useState } from "react";
import { StoryClockEditor } from "./StoryCardChronology";
import { classifyMemory } from "../memory/classificationPolicy";
import { resolveMemoryTarget } from "../memory/resolveMemoryTarget";
import type { MemoryAutoApproveSettings, MemoryProposal, MemoryProposalType, MemoryReconcileRequest, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import type { AdventurePageProps, MemoryWorkStatus } from "./pageTypes";
import { CheckboxField, Field, JsonTextarea, NumberInput, commaList, fromCommaList } from "./shared";

const proposalTypes: MemoryProposalType[] = [
  "componentDraft",
  "storyCard",
  "brainUpdate",
  "plotEssentialsUpdate",
  "plotMomentumUpdate",
  "ignore",
];
const storyCardTypes = PRIMARY_STORY_CARD_TYPES;

interface MemoryInboxPageProps extends AdventurePageProps {
  onCreateDraft?: (request: MemoryDraftRequest) => Promise<boolean>;
  providerConfig?: ProviderConfig;
  memoryWork?: MemoryWorkStatus;
  onRetryMemory?: () => Promise<void>;
  onContinueWithExistingMemory?: () => void;
  onEvaluateMemory?: (sourceIds: string[]) => Promise<void>;
  onFindEventMemories?: (onProgress: (message: string) => void, signal: AbortSignal, range?: { start: number; end: number }) => Promise<void>;
  onRegenerateProposal?: (proposalId: string, convertToLore?: boolean) => Promise<void>;
  onReconcileMemory?: (request: MemoryReconcileRequest) => Promise<void>;
  loading?: boolean;
}

export function MemoryInboxPage(props: MemoryInboxPageProps) {
  const { memoryWork, loading, onRetryMemory, onContinueWithExistingMemory } = props;
  const [proposalSearch, setProposalSearch] = useState("");
  const [view, setView] = useState<"suggestions" | "decisions">("suggestions");
  return <>
    {memoryWork && (
      <div className="memory-work-notice" role="status" aria-live="polite">
        {memoryWork.status === "running" ? (
          <p>Updating memory{memoryWork.group ? ": " + ({ plot: "Plot", storyCards: "Story Cards", brains: "Brains", discovery: "Discovery" }[memoryWork.group]) : ""} — {memoryWork.remaining} {memoryWork.remaining === 1 ? "entry" : "entries"} remaining. You can write your next turn while this finishes.</p>
        ) : memoryWork.status === "failed" ? (
          <>
            <p>{memoryWork.error ?? "Memory has unfinished evaluations."} Play can continue using saved memory. Retry unfinished checks when ready.</p>
            <button type="button" disabled={loading} onClick={() => void onRetryMemory?.()}>Retry memory</button>
            <button type="button" disabled={loading} onClick={onContinueWithExistingMemory}>Dismiss</button>
          </>
        ) : <p>The next turn will use existing memory. Unfinished evaluations remain saved.</p>}
      </div>
    )}
    <nav aria-label="Memory views" className="editor-stat-row">
      <button type="button" aria-pressed={view === "suggestions"} onClick={() => setView("suggestions")}>Suggestions</button>
      <button type="button" aria-pressed={view === "decisions"} onClick={() => setView("decisions")}>Decisions</button>
    </nav>
    {view === "decisions" ? <MemoryDecisionsPage dispatch={props.dispatch} adventure={props.adventure} loading={props.loading} onEvaluateMemory={props.onEvaluateMemory} onSuggestions={title => { setProposalSearch(title ?? ""); setView("suggestions"); }} /> : <MemorySuggestionsPage {...props} initialSearch={proposalSearch} />}
  </>;
}

function MemorySuggestionsPage({ adventure, dispatch, onCreateDraft, providerConfig, onRegenerateProposal, onReconcileMemory, onFindEventMemories, loading = false, initialSearch = "" }: MemoryInboxPageProps & { initialSearch?: string }) {
  const allProposals = adventure.activeState.memoryProposals.filter(p => p.proposedType !== "plotPressureUpdate").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [eventScan, setEventScan] = useState<AbortController>();
  const [eventProgress, setEventProgress] = useState("");
  const [eventScope, setEventScope] = useState("full");
  const [eventStart, setEventStart] = useState(1);
  const [eventEnd, setEventEnd] = useState(adventure.messages.length);
  const invalidEventRange = eventScope === "range" && (!Number.isInteger(eventStart) || !Number.isInteger(eventEnd) || eventStart < 1 || eventEnd < eventStart || eventEnd > adventure.messages.length);
  const [linkedDraft, setLinkedDraft] = useState(false);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [reconcileDirective, setReconcileDirective] = useState("");
  const [reconcileEntryCount, setReconcileEntryCount] = useState(20);
  const [reconcileIncludeBrains, setReconcileIncludeBrains] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const searchLower = search.toLowerCase().trim();
  const visibleProposals = allProposals.filter((proposal) => !searchLower
    || proposal.title.toLowerCase().includes(searchLower)
    || proposal.content.toLowerCase().includes(searchLower)
    || proposal.sourceText.toLowerCase().includes(searchLower)
    || proposal.rationale.toLowerCase().includes(searchLower)
    || adventure.storyCards.some(c => c.id === proposal.targetId && c.title.toLowerCase().includes(searchLower))
    || adventure.brains.some(b => b.id === proposal.targetId && b.characterName.toLowerCase().includes(searchLower)));
  const pending = visibleProposals.filter((p) => p.status === "pending");
  const groups = new Map<string, { label: string; proposals: MemoryProposal[] }>();
  const normalizeTitle = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const proposal of pending) {
    const ids = proposal.relationship?.characterIds;
    const key = proposal.storyCardType === "relationship" ? "relationship:" + (ids && !relationshipIdError(ids) ? relationshipKey(ids) : proposal.id) : proposal.targetId ? `target:${proposal.proposedType}:${proposal.targetId}`
      : `create:${proposal.proposedType}:${proposal.storyCardType ?? "lore"}:${normalizeTitle(proposal.title)}`;
    const label = proposal.proposedType === "brainUpdate"
      ? `Brain: ${adventure.brains.find(b => b.id === proposal.targetId)?.characterName ?? proposal.title}`
      : proposal.targetId ? adventure.storyCards.find(c => c.id === proposal.targetId)?.title
        ?? adventure.components.find(c => c.id === proposal.targetId)?.title ?? proposal.title
        : `CREATE ${proposal.storyCardType ?? proposal.proposedType}: ${proposal.title}`;
    const group = groups.get(key) ?? { label, proposals: [] };
    group.proposals.push(proposal); groups.set(key, group);
  }
  const resolved = visibleProposals.filter((p) => p.status !== "pending");
  const totalPending = allProposals.filter((p) => p.status === "pending").length;
  const totalResolved = allProposals.length - totalPending;

  function updateProposal(proposal: MemoryProposal, patch: Partial<MemoryProposal>) {
    dispatch({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: proposal.id, patch });
  }

  function createProposal() {
    if (linkedDraft) {
      if (validateRelationshipIds(adventure.storyCards, linkedIds)) return;
      const matches = relationshipMatches(adventure.storyCards, linkedIds);
      if (matches.length > 1) return;
      const target = matches[0];
      const now = nowIso();
      dispatch({ type: "ADD_MEMORY_PROPOSAL", proposal: {
        id: createId("proposal"), proposedType: "storyCard", storyCardType: "relationship",
        relationship: { characterIds: canonicalRelationshipIds(linkedIds) }, sourceText,
        sourceTurnId: adventure.messages.at(-1)?.id ?? "manual",
        title: target?.title ?? relationshipTitle(adventure.storyCards, linkedIds), content: sourceText.trim(),
        targetId: target?.id, suggestedTriggers: [], confidence: 1, status: "pending",
        rationale: "Author-created relationship suggestion.", userInitiated: true, requiresReview: true, createdAt: now, updatedAt: now,
      } });
      setSourceText("");
      return;
    }
    const classified = classifyMemory(sourceText, {
      existingBrainNames: adventure.brains.map((brain) => brain.characterName),
      existingStoryCards: adventure.storyCards.map((card) => ({ id: card.id, title: card.title, keys: card.keys, type: card.type })),
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
        userInitiated: true,
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

  function setAutoApprove(patch: Partial<MemoryAutoApproveSettings>) {
    dispatch({ type: "SET_MEMORY_AUTO_APPROVE", settings: { ...autoApprove, ...patch } });
  }

  return (
    <section className="page editor-surface memory-inbox-page">
      <details className="panel editor-tools-panel">
        <summary>Suggestion visibility and history</summary>
        <section aria-label="Suggestion controls">
          <CheckboxField label="Show suggestions" checked={adventure.memorySuggestionsEnabled !== false}
            onChange={enabled => dispatch({ type: "SET_MEMORY_SUGGESTIONS_ENABLED", enabled })} />
          <p className="muted">When off, automatic pending suggestions are discarded. Drafts you request here remain available for review. Automatic updates keep using your approval settings. AI checks still run.</p>
          <button type="button" onClick={() => dispatch({ type: "CLEAR_SUGGESTION_HISTORY" })}>Clear suggestion history</button>
          <p className="muted">Deletes approved, rejected, and ignored suggestion records from saved JSON. Pending suggestions and saved memories stay. Deleted decisions no longer suppress repeat suggestions.</p>
        </section>
      </details>
      <details className="panel editor-tools-panel">
        <summary>Story date</summary>
        <StoryClockEditor adventure={adventure} dispatch={dispatch} inline />
      </details>
      {onCreateDraft && <MemorySuggestionBuilder key={adventure.id} adventure={adventure} providerConfig={providerConfig} loading={loading} onCreate={onCreateDraft} />}
      <details className="panel editor-tools-panel">
        <summary>Auto-approval — This adventure</summary>
        <section aria-label="Auto-approval — This adventure">
          <div className="auto-approve-toggles">
            <CheckboxField label="Current Arc State" checked={autoApprove.currentArcStateUpdate ?? false} onChange={(v) => setAutoApprove({ currentArcStateUpdate: v })} />
            <CheckboxField label="Plot Essentials" checked={autoApprove.plotEssentialsUpdate} onChange={(v) => setAutoApprove({ plotEssentialsUpdate: v })} />
            <CheckboxField label="Character Self" checked={autoApprove.brainUpdate} onChange={(v) => setAutoApprove({ brainUpdate: v })} />
            <CheckboxField label="Story Cards — Lore" checked={autoApprove.loreStoryCard} onChange={(v) => setAutoApprove({ loreStoryCard: v })} />
            <div>
              <CheckboxField label="Story Cards — Autonomous Lore" checked={autoApprove.autonomousLoreStoryCard === true} onChange={(v) => setAutoApprove({ autonomousLoreStoryCard: v })} />
              <p className="muted">Automatically approve newly generated off-screen world developments. Independent of ordinary Lore auto-approval.</p>
            </div>
            <CheckboxField label="Story Cards — Relationships" checked={autoApprove.relationshipStoryCard} onChange={(v) => setAutoApprove({ relationshipStoryCard: v })} />
            <CheckboxField label="Story Cards — Everything Else" checked={autoApprove.otherStoryCard} onChange={(v) => setAutoApprove({ otherStoryCard: v })} />
          </div>
          <p className="muted">Enabled categories apply valid new suggestions automatically. Existing pending suggestions still need review.</p>
        </section>
      </details>

      <div className="editor-page-summary">
        <p className="muted">
          Review proposed memory writes before they become active story context. Story Card suggestions wait for approval by default. Unconfirmed candidates and sensitive changes always need review.
        </p>
        <div className="editor-stat-row" aria-label="Memory suggestion counts">
          <span>{totalPending} pending</span>
          <span>{totalResolved} resolved</span>
          {searchLower && <span>{visibleProposals.length} shown</span>}
        </div>
      </div>

      <p aria-live="polite">{allProposals.filter(p => p.status === "approved" && p.approvalFeedback).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.approvalFeedback}</p>

      {onFindEventMemories && <details className="panel editor-tools-panel">
        <summary>Event memories from earlier play</summary>
        <label>Scan <select value={eventScope} disabled={Boolean(eventScan)} onChange={e => setEventScope(e.target.value)}>
          <option value="full">Full adventure</option><option value="range">Entry range</option>
        </select></label>
        {eventScope === "range" && <div>
          <label>First entry <input type="number" min={1} max={adventure.messages.length} value={eventStart} disabled={Boolean(eventScan)} onChange={e => setEventStart(e.target.valueAsNumber)} /></label>
          <label>Last entry <input type="number" min={eventStart} max={adventure.messages.length} value={eventEnd} disabled={Boolean(eventScan)} onChange={e => setEventEnd(e.target.valueAsNumber)} /></label>
          <p className="muted">Inclusive Chronicle entry numbers, from 1 to {adventure.messages.length}.</p>
          {invalidEventRange && <p role="alert">Enter a valid first and last entry.</p>}
        </div>}
        <button type="button" disabled={loading || Boolean(eventScan) || invalidEventRange} onClick={async () => {
          const controller = new AbortController(); setEventScan(controller);
          try { await onFindEventMemories(setEventProgress, controller.signal, eventScope === "range" ? { start: eventStart, end: eventEnd } : undefined); }
          catch (error) { setEventProgress(error instanceof Error ? error.message : "Event scan failed."); }
          finally { setEventScan(undefined); }
        }}>Find event memories in earlier play</button>
        {eventScan && <button type="button" onClick={() => eventScan.abort()}>Stop after current excerpt</button>}
        <p className="muted">Scans the Chronicle in excerpts using your background model. Each excerpt uses an AI request. Results remain suggestions for review.</p>
        <p role="status">{eventProgress}</p>
      </details>}
      <div className="editor-command-bar">
        <input
          type="search"
          placeholder="Search suggestions..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

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
        <CheckboxField label="Linked Relationship Card" checked={linkedDraft} onChange={setLinkedDraft} />
        {linkedDraft && <RelationshipParticipants cards={adventure.storyCards} selected={linkedIds} onChange={setLinkedIds} />}
        <button type="button" disabled={!sourceText.trim() || (linkedDraft && (Boolean(validateRelationshipIds(adventure.storyCards, linkedIds))
          || relationshipMatches(adventure.storyCards, linkedIds).length > 1))} onClick={createProposal}>
          Create Suggestion
        </button>
      </details>

      <div className="list">
        {pending.length === 0 && <p className="muted">No pending memory suggestions.</p>}
        {[...groups.values()].map(group => <section className="panel memory-destination-group" key={group.proposals[0].id} aria-label={`${group.label} suggestions`}>
          <h3>{group.label} <span className="badge">{group.proposals.length} {group.proposals.length === 1 ? "proposal" : "proposals"}</span></h3>
          <p className="muted">{group.proposals.slice(0, 3).map(p => p.content.replace(/\s+/g, " ").slice(0, 100)).join(" · ")}{group.proposals.length > 3 ? " …" : ""}</p>
          {group.proposals.map(proposal => <div key={proposal.id}>
            <ProposalCard adventure={adventure} proposal={proposal} dispatch={dispatch} onUpdate={updateProposal} onRegenerate={onRegenerateProposal} />
          </div>)}
        </section>)}
      </div>

      {resolved.length > 0 && (
        <details className="panel memory-history-panel">
          <summary>History ({resolved.length})</summary>
          <div className="list" style={{ marginTop: "0.75rem" }}>
            {resolved.map(proposal => proposal.archivedMemoryHistoryId ? <div className="card" key={proposal.id}>
              <strong>{proposal.title}</strong> · {proposal.status}
              <p>{proposal.content}</p>
              <ArchivedMemoryDetails adventure={adventure} archiveId={proposal.archivedMemoryHistoryId}>{record => {
                if (record.kind !== "proposal" || record.id !== proposal.id) return <p role="alert">Archive record identity mismatch.</p>;
                const apply: typeof dispatch = action => {
                  if ((action.type === "APPROVE_MEMORY_PROPOSAL" || action.type === "UPDATE_MEMORY_PROPOSAL"
                    || action.type === "REJECT_MEMORY_PROPOSAL" || action.type === "IGNORE_MEMORY_PROPOSAL") && action.proposalId === proposal.id) {
                    dispatch({ type: "APPLY_ARCHIVED_PROPOSAL_ACTION", adventureId: adventure.id,
                      archiveId: proposal.archivedMemoryHistoryId!, proposal: record.value, action });
                  }
                };
                return <ProposalCard adventure={adventure} proposal={record.value} dispatch={apply}
                  onUpdate={(_, patch) => apply({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: proposal.id, patch })} />;
              }}</ArchivedMemoryDetails>
            </div> : <ProposalCard key={proposal.id} adventure={adventure} proposal={proposal} dispatch={dispatch} onUpdate={updateProposal} onRegenerate={onRegenerateProposal} />)}
          </div>
        </details>
      )}
    </section>
  );
}

interface ProposalCardProps {
  adventure: AdventurePageProps["adventure"];
  proposal: MemoryProposal;
  dispatch: AdventurePageProps["dispatch"];
  onUpdate: (proposal: MemoryProposal, patch: Partial<MemoryProposal>) => void;
  onRegenerate?: (proposalId: string, convertToLore?: boolean) => Promise<void>;
}

function ProposalCard({ adventure, proposal, dispatch, onUpdate, onRegenerate }: ProposalCardProps) {
  const isPending = proposal.status === "pending";
  const targetCard = proposal.proposedType === "storyCard" ? adventure.storyCards.find(card => card.id === proposal.targetId) : undefined;
  const autoApprovalBlockers = isPending && proposal.proposedType === "storyCard" ? storyCardAutoApprovalBlockers(adventure, proposal) : [];
  const savedReviewReason = proposal.requiresReview
    ? proposal.manualDraft?.componentType === "currentArcPlan" ? "Author approval required." : proposal.rationale.split("Review required:").slice(1).join("Review required:").trim()
      || proposal.rationale.trim() || "Previously marked for manual review."
    : undefined;
  const reviewReasons = isPending ? [...new Set([
    ...(savedReviewReason ? [savedReviewReason] : []),
    ...autoApprovalBlockers.filter(reason => !reason.startsWith("This proposal was previously marked for manual review.")),
  ])] : [];
  const sourceValid = suggestionSourceValid(adventure, proposal);
  const placementError = placementValidationError(adventure, proposal);
  const relationship = proposal.storyCardType === "relationship";
  const relationshipError = relationshipProposalError(adventure, proposal);
  const [editingLinks, setEditingLinks] = useState<string[]>();
  const participantIds = Array.isArray(proposal.relationship?.characterIds) ? proposal.relationship.characterIds : [];
  const destinations = relationship ? relationshipMatches(adventure.storyCards, participantIds)
    : adventure.storyCards.filter(card => card.type !== "relationship");
  const destinationLabel = proposalDestinationLabel(adventure, proposal);
  const [regenerationError, setRegenerationError] = useState<string>();
  const [regenerating, setRegenerating] = useState(false);
  const autonomous = isAutonomousLore(proposal.lore?.autonomous) ? proposal.lore.autonomous : undefined;
  const isLore = proposal.proposedType === "storyCard" && (proposal.storyCardType === "lore" || adventure.storyCards.some(card => card.id === proposal.targetId && card.type === "lore"));
  const chronology = validateLoreChronology(adventure, proposal);
  const dateConflict = chronology.status === "conflict";

  async function handleRegenerate(convertToLore = false) {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    try { setRegenerationError(undefined); await onRegenerate(proposal.id, convertToLore); } catch (error) { setRegenerationError(error instanceof Error ? error.message : "Validation failed."); } finally { setRegenerating(false); }
  }

  const contentEditor = <textarea
    rows={5}
    value={proposal.content}
    onChange={(event) => onUpdate(proposal, { content: event.target.value })}
    placeholder="Proposed content..."
    disabled={proposal.status === "approved"}
  />;

  return (
    <details key={proposal.id} className={`card proposal-card proposal-${proposal.status}`} open={isPending}>
      <summary className="proposal-card-summary">
        <span className="proposal-card-title">
          <strong>{proposal.title || "Untitled suggestion"}</strong>
          {reviewReasons.length > 0 && <span className="proposal-review-reasons" aria-label="Review required reasons">
            Review required: {reviewReasons.join(" · ")}
          </span>}
          <span className="muted">
            {destinationLabel}
          </span>
        </span>
        <span className="story-card-badges">
          {autonomous && <span className="badge">Autonomous Lore</span>}
          <span className="badge badge-type">{Math.round(proposal.confidence * 100)}%</span>
            {isPending && proposal.requiresReview && <span className="badge">Review required</span>}
          {!isPending && <span className="badge badge-inactive">{proposal.status}</span>}
          {proposal.suggestedTriggers.length > 0 && <span className="badge">{proposal.suggestedTriggers.length} keys</span>}
        </span>
        {proposal.manualDraft?.componentType !== "currentArcPlan" &&
          <span className="search-snippet">{proposal.content || proposal.sourceText || "No proposed content yet."}</span>}
      </summary>

      <div className="proposal-card-body">
        <div className="panel-heading">
        <div className="suggestion-meta">
          <p className="eyebrow">
            {destinationLabel}
            {proposal.status !== "pending" ? ` · ${proposal.status}` : ""}
          </p>
          <input
            value={proposal.title}
            onChange={(event) => onUpdate(proposal, { title: event.target.value })}
            disabled={proposal.status === "approved"}
          />
        </div>
        </div>
      {autonomous && <p>Originating subjects: {autonomousSubjectNames(adventure, autonomous).join(", ")}</p>}
      {!autonomous && proposal.storyCardReview && <>
        <Field label="Story Card destination"><select value={proposal.targetId ?? ""} disabled={proposal.status === "approved"}
          onChange={event => {
            const card = adventure.storyCards.find(card => card.id === event.target.value);
            const suggestedTitle = proposal.storyCardReview!.suggestedTitle;
            const createTitle = suggestedTitle;
            onUpdate(proposal, { targetId: card?.id, title: card?.title ?? createTitle,
              ...(proposal.evaluationSource ? { evaluationSource: { ...proposal.evaluationSource, target: card ? memoryTargetSnapshot(adventure, "storyCard", card.id) : undefined } } : {}),
              cardOperation: card ? "append" : "create", storyCardType: card?.type ?? proposal.storyCardType, appendContent: card ? true : undefined, memoryMode: card?.memoryMode ?? proposal.memoryMode,
              storyCardReview: { ...proposal.storyCardReview!, operation: card ? "update" : "create" } });
          }}>
          <option value="">CREATE — new Story Card</option>
          {proposal.targetId && !adventure.storyCards.some(card => card.id === proposal.targetId) && <option value={proposal.targetId}>Missing destination — choose another</option>}
          {destinations.map(card => <option key={card.id} value={card.id}>APPEND — {card.title}{proposal.storyCardReview!.targetCandidates.includes(card.id) ? " (suggested)" : ""}</option>)}
        </select></Field>
      </>}
      {!autonomous && proposal.proposedType === "storyCard" && !proposal.storyCardReview && <Field label="Story Card destination">
        <select value={proposal.targetId ?? ""} disabled={proposal.status === "approved" || Boolean(proposal.manualDraft)} onChange={event => {
          const card = adventure.storyCards.find(card => card.id === event.target.value);
          onUpdate(proposal, { targetId: card?.id, cardOperation: card ? "append" : "create", storyCardType: card?.type ?? proposal.storyCardType });
        }}>
          <option value="">CREATE — new Story Card</option>
          {proposal.targetId && !adventure.storyCards.some(card => card.id === proposal.targetId) && <option value={proposal.targetId}>Missing destination — choose another</option>}
          {destinations.map(card => <option key={card.id} value={card.id}>APPEND — {card.title}</option>)}
        </select>
      </Field>}
      {relationship && <p>Linked characters: {participantIds.map(id => (adventure.storyCards.find(card => card.id === id)?.title ?? "Missing") + " (" + id + ")").join(", ")}</p>}
      {relationshipError && <p role="alert">{relationshipError}</p>}
      {relationship && isPending && !proposal.manualDraft && <>
        {editingLinks ? <>
          <RelationshipParticipants cards={adventure.storyCards} selected={editingLinks} onChange={setEditingLinks} />
          <button type="button" disabled={Boolean(validateRelationshipIds(adventure.storyCards, editingLinks)) || relationshipMatches(adventure.storyCards, editingLinks).length > 1} onClick={() => {
            const target = relationshipMatches(adventure.storyCards, editingLinks)[0];
            onUpdate(proposal, { relationship: { characterIds: canonicalRelationshipIds(editingLinks) }, targetId: target?.id, title: target?.title ?? relationshipTitle(adventure.storyCards, editingLinks),
              cardOperation: target ? "append" : "create", appendContent: target ? true : undefined, placementValidation: undefined, requiresReview: true,
              evaluationSource: proposal.evaluationSource && { ...proposal.evaluationSource, target: undefined } });
            setEditingLinks(undefined);
          }}>Save proposal participants</button>
          <button type="button" onClick={() => setEditingLinks(undefined)}>Cancel</button>
        </> : <button type="button" onClick={() => setEditingLinks(participantIds.filter(id => adventure.storyCards.some(card => card.id === id && card.type === "character")))}>Edit proposal participants</button>}
      </>}
      {proposal.manualDraft?.componentType === "currentArcPlan"
        ? <details><summary>Read or edit the Plan</summary>{contentEditor}</details>
        : contentEditor}

        <div className="row">
          <button
            type="button"
            className="manual-approval" disabled={proposal.status === "approved" || Boolean(relationshipError)}
            onClick={() => dispatch({ type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id })}
          >
            Approve
          </button>
          {isPending && (
            <>
              {onRegenerate && !autonomous && !proposal.manualDraft && proposal.proposedType !== "currentArcStateUpdate" && (
                <button type="button" disabled={regenerating} onClick={() => handleRegenerate()}>
                  {regenerating ? "…" : "Regenerate"}
                </button>
              )}
              {onRegenerate && proposal.proposedType === "storyCard" && !proposal.manualDraft && !isLore && <button type="button" disabled={regenerating} onClick={() => handleRegenerate(true)}>Convert to Lore</button>}
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

      {proposal.status !== "approved" && proposal.approvalFeedback && <p role="status">{proposal.approvalFeedback}</p>}
      {regenerationError && <p role="alert">{regenerationError}</p>}
      {isPending && (placementError || !sourceValid || dateConflict) && <p role="status">Review needed: {placementError || (dateConflict ? "Event date conflicts with source chronology." : "Source evidence or destination changed.")} See Review details below.</p>}
      <details className="editor-tools-panel"><summary>Review details</summary>
      {isPending && placementError && <p role="status">{placementError} You can still approve this draft manually.</p>}
      {isPending && !sourceValid && <p role="status">The source evidence or destination changed. Review the current draft; you can still approve it.</p>}
      {proposal.placementValidation && <p>{proposal.placementValidation.reason}</p>}
      {!autonomous && proposal.evaluationSource && <details><summary>Independent evaluation evidence</summary>
        <p>Destination: {proposal.targetId ?? "new Story Card"}</p>
        {proposal.evaluationSource.messages.map(source => <div key={source.id}><code>{source.id}</code><blockquote>{source.content}</blockquote></div>)}
      </details>}
      {!autonomous && proposal.storyCardReview && <div className="panel">
        <p>{proposal.storyCardReview.candidateOnly ? "Unconfirmed candidate — verify the interpretation against the source." : "Evidence-based suggestion — review before applying."} Detection: {proposal.storyCardReview.origin}.</p>
        {Boolean(proposal.storyCardReview.evidenceQuotes?.length) && <details><summary>Supporting source quotes</summary>
          <ul>{proposal.storyCardReview.evidenceQuotes!.map((item, index) => <li key={`${item.messageId}-${index}`}><code>{item.messageId}</code><blockquote>{item.quote}</blockquote></li>)}</ul>
        </details>}
        {proposal.lore && <p>{proposal.lore.status} · Sources: {proposal.lore.sourceMessageIds.join(", ")}</p>}
        {proposal.storyCardReview.targetCandidates.length > 1 && !proposal.targetId && <p>Several continuing subjects may fit. Choose an update target or keep this as a separate card.</p>}
      </div>}
      {isPending && proposal.proposedType === "storyCard" && <div aria-label="Automatic approval status">
        {autoApprovalBlockers.length ? <ul>{autoApprovalBlockers.map(reason => <li key={reason}>{reason}</li>)}</ul>
          : <p>This suggestion remains pending. Auto-approval settings apply to new suggestions; review this draft explicitly.</p>}
      </div>}
      {isPending && dateConflict && <div role="alert">
        <p>Date conflict: this event’s proposed date does not agree with its source chronology.</p>
        <p>{chronology.status === "conflict" ? chronology.reason : ""}</p>
      </div>}
      </details>

      <details className="editor-tools-panel">
        <summary>{autonomous ? "Generation context" : "Source & details"}</summary>
        {proposal.eventMemory && <p>Historical Lore · {proposal.eventMemory.kind} · Participants: {proposal.eventMemory.participants.join(", ")} · Recall cues: {proposal.eventMemory.recallCues.join(", ")} · Source messages: {proposal.eventMemory.sourceMessageIds.join(", ")}</p>}
        <div className="grid two">
          {autonomous ? <section aria-label="Generation context">
            <p>This event was generated independently of foreground narration. The source entry provides context, not direct evidence that the event occurred.</p>
            <blockquote>{proposal.sourceText}</blockquote>
          </section> : <Field label="Source">
            <textarea
              rows={2}
              value={proposal.sourceText}
              onChange={(event) => onUpdate(proposal, { sourceText: event.target.value })}
            />
          </Field>}
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
              disabled={proposal.status === "approved" || Boolean(proposal.manualDraft) || Boolean(autonomous)}
            >
              {(proposal.proposedType === "currentArcStateUpdate" ? [proposal.proposedType] : proposalTypes).map((type) => (
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
                  value={targetCard?.type ?? proposal.storyCardType ?? ""}
                  onChange={(event) => onUpdate(proposal, { storyCardType: event.target.value as StoryCardType, targetId: undefined, appendContent: undefined, placementValidation: undefined })}
                  disabled={proposal.status === "approved" || Boolean(targetCard) || Boolean(proposal.manualDraft) || relationship || Boolean(autonomous)}
                >
                  <option value="">Select a card type</option>
                  {storyCardTypes.filter(type => type !== "relationship" || relationship).map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>

            </>
          )}
          <Field label="Triggers">
            <input
              value={relationship ? "" : commaList(proposal.suggestedTriggers)}
              readOnly={relationship}
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
        {(proposal.storyCardPatch || proposal.componentPatch) && (
          <div className="grid two">
            {proposal.storyCardPatch && (
              <Field label="Story Card Patch">
                {proposal.status !== "approved" ? (
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
                {proposal.status !== "approved" ? (
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
