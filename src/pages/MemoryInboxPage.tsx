import { placementValidationError, proposalDestinationLabel } from "../memory/storyCardPlacement";
import { MemoryDecisionsPage } from "./MemoryDecisionsPage";
import { proposalLore } from "../memory/storyCardArchitecture";
import { suggestionSourceValid } from "../memory/storyCardSuggestions";
import { memoryTargetSnapshot } from "../memory/memoryCycleState";
import { formatStoryTime } from "../memory/storyTime";
import { ProposalEventDate } from "./ProposalEventDate";
import { useState } from "react";
import { classifyMemory } from "../memory/classificationPolicy";
import { resolveMemoryTarget } from "../memory/resolveMemoryTarget";
import type { MemoryAutoApproveSettings, MemoryProposal, MemoryProposalType, MemoryReconcileRequest, StoryCardType } from "../types/adventure";
import { createId, nowIso } from "../utils/id";
import type { AdventurePageProps, MemoryWorkStatus } from "./pageTypes";
import { CheckboxField, Field, JsonTextarea, NumberInput, commaList, fromCommaList } from "./shared";

const proposalTypes: MemoryProposalType[] = [
  "storyCard",
  "brainUpdate",
  "plotEssentialsUpdate",
  "currentArcUpdate",
  "arcProposal",
  "plotPressureUpdate",
  "plotMomentumUpdate",
  "summaryUpdate",
  "ignore",
];
const storyCardTypes: StoryCardType[] = ["character", "location", "lore", "custom"];

interface MemoryInboxPageProps extends AdventurePageProps {
  memoryWork?: MemoryWorkStatus;
  onRetryMemory?: () => Promise<void>;
  onContinueWithExistingMemory?: () => void;
  onEvaluateMemory?: (sourceIds: string[]) => Promise<void>;
  onFindEventMemories?: (onProgress: (message: string) => void, signal: AbortSignal) => Promise<void>;
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
            <p>{memoryWork.error ?? "Memory has unfinished evaluations."} Retry unfinished work or continue with existing memory.</p>
            <button type="button" disabled={loading} onClick={() => void onRetryMemory?.()}>Retry memory</button>
            <button type="button" disabled={loading} onClick={onContinueWithExistingMemory}>Continue with existing memory</button>
          </>
        ) : <p>The next turn will use existing memory. Unfinished evaluations remain saved.</p>}
      </div>
    )}
    <nav aria-label="Memory views" className="editor-stat-row">
      <button type="button" aria-pressed={view === "suggestions"} onClick={() => setView("suggestions")}>Suggestions</button>
      <button type="button" aria-pressed={view === "decisions"} onClick={() => setView("decisions")}>Decisions</button>
    </nav>
    {view === "decisions" ? <MemoryDecisionsPage adventure={props.adventure} loading={props.loading} onEvaluateMemory={props.onEvaluateMemory} onSuggestions={title => { setProposalSearch(title ?? ""); setView("suggestions"); }} /> : <MemorySuggestionsPage {...props} initialSearch={proposalSearch} />}
  </>;
}

function MemorySuggestionsPage({ adventure, dispatch, onRegenerateProposal, onReconcileMemory, onFindEventMemories, loading = false, initialSearch = "" }: MemoryInboxPageProps & { initialSearch?: string }) {
  const allProposals = [...adventure.activeState.memoryProposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [eventScan, setEventScan] = useState<AbortController>();
  const [eventProgress, setEventProgress] = useState("");
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
    || proposal.rationale.toLowerCase().includes(searchLower));
  const pending = visibleProposals.filter((p) => p.status === "pending");
  const resolved = visibleProposals.filter((p) => p.status !== "pending");
  const totalPending = allProposals.filter((p) => p.status === "pending").length;
  const totalResolved = allProposals.length - totalPending;

  function updateProposal(proposal: MemoryProposal, patch: Partial<MemoryProposal>) {
    dispatch({ type: "UPDATE_MEMORY_PROPOSAL", proposalId: proposal.id, patch });
  }

  function createProposal() {
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
          Memory Suggestions holds AI-proposed changes to your story data — new Story Cards, Character Self updates,
          Plot Essentials rewrites, Active Pressure updates, and legacy Summary changes. The AI generates these automatically after turns or when
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
          <CheckboxField label="Story Cards" checked={autoApprove.storyCard} onChange={(storyCard) => setAutoApprove({ storyCard })} />
          <CheckboxField label="Characters" checked={autoApprove.brainUpdate} onChange={(v) => setAutoApprove({ brainUpdate: v })} />
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

      <div className="list">
        {pending.length === 0 && <p className="muted">No pending memory suggestions.</p>}
        {pending.map((proposal) => (
          <ProposalCard key={proposal.id} adventure={adventure} proposal={proposal} dispatch={dispatch} onUpdate={updateProposal} onRegenerate={onRegenerateProposal} />
        ))}
      </div>

      {resolved.length > 0 && (
        <details className="panel memory-history-panel">
          <summary>History ({resolved.length})</summary>
          <div className="list" style={{ marginTop: "0.75rem" }}>
            {resolved.map((proposal) => (
              <ProposalCard key={proposal.id} adventure={adventure} proposal={proposal} dispatch={dispatch} onUpdate={updateProposal} onRegenerate={onRegenerateProposal} />
            ))}
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
  const sourceValid = suggestionSourceValid(adventure, proposal);
  const placementError = placementValidationError(adventure, proposal);
  const destinationLabel = proposalDestinationLabel(adventure, proposal);
  const [regenerationError, setRegenerationError] = useState<string>();
  const [regenerating, setRegenerating] = useState(false);
  const isLore = proposal.proposedType === "storyCard" && (proposal.storyCardType === "lore" || adventure.storyCards.some(card => card.id === proposal.targetId && card.type === "lore"));
  const lore = isLore ? proposalLore(adventure, proposal) : undefined;

  async function handleRegenerate(convertToLore = false) {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    try { setRegenerationError(undefined); await onRegenerate(proposal.id, convertToLore); } catch (error) { setRegenerationError(error instanceof Error ? error.message : "Validation failed."); } finally { setRegenerating(false); }
  }

  return (
    <details key={proposal.id} className={`card proposal-card proposal-${proposal.status}`} open={isPending}>
      <summary className="proposal-card-summary">
        <span className="proposal-card-title">
          <strong>{proposal.title || "Untitled suggestion"}</strong>
          <span className="muted">
            {destinationLabel}
          </span>
        </span>
        <span className="story-card-badges">
          <span className="badge badge-type">{Math.round(proposal.confidence * 100)}%</span>
            {isPending && proposal.requiresReview && <span className="badge">Review required</span>}
          {!isPending && <span className="badge badge-inactive">{proposal.status}</span>}
          {proposal.suggestedTriggers.length > 0 && <span className="badge">{proposal.suggestedTriggers.length} keys</span>}
        </span>
        <span className="search-snippet">{proposal.content || proposal.sourceText || "No proposed content yet."}</span>
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
            disabled={!isPending}
          />
        </div>
        <div className="row">
          <button
            type="button"
            disabled={proposal.status === "approved"}
            onClick={() => dispatch({ type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id })}
          >
            Approve
          </button>
          {isPending && (
            <>
              {onRegenerate && (
                <button type="button" disabled={regenerating} onClick={() => handleRegenerate()}>
                  {regenerating ? "…" : "Regenerate"}
                </button>
              )}
              {onRegenerate && proposal.proposedType === "storyCard" && !isLore && <button type="button" disabled={regenerating} onClick={() => handleRegenerate(true)}>Convert to Lore</button>}
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

      {isPending && placementError && <p role="status">{placementError} You can still approve this draft manually.</p>}
      {isPending && !sourceValid && <p role="status">The source evidence or destination changed. Review the current draft; you can still approve it.</p>}
      {proposal.placementValidation && <p>{proposal.placementValidation.reason}</p>}
      {regenerationError && <p role="alert">{regenerationError}</p>}
      {proposal.evaluationSource && <details><summary>Independent evaluation evidence</summary>
        <p>Destination: {proposal.targetId ?? "new Story Card"}</p>
        {proposal.evaluationSource.messages.map(source => <div key={source.id}><code>{source.id}</code><blockquote>{source.content}</blockquote></div>)}
      </details>}
      {proposal.storyCardReview && <div className="panel">
        <p>{proposal.storyCardReview.candidateOnly ? "Unconfirmed candidate — verify the interpretation against the source." : "Evidence-based suggestion — review before applying."} Detection: {proposal.storyCardReview.origin}.</p>
        {Boolean(proposal.storyCardReview.evidenceQuotes?.length) && <details><summary>Supporting source quotes</summary>
          <ul>{proposal.storyCardReview.evidenceQuotes!.map((item, index) => <li key={`${item.messageId}-${index}`}><code>{item.messageId}</code><blockquote>{item.quote}</blockquote></li>)}</ul>
        </details>}
        {proposal.lore && <p>Occurred: {formatStoryTime(proposal.lore.occurredAt)} · {proposal.lore.status} · Sources: {proposal.lore.sourceMessageIds.join(", ")}</p>}
        <Field label="Story Card destination"><select value={proposal.targetId ?? ""} disabled={!isPending}
          onChange={event => {
            const card = adventure.storyCards.find(card => card.id === event.target.value);
            const suggestedTitle = proposal.storyCardReview!.suggestedTitle;
            const createTitle = adventure.storyCards.some(existing => existing.title.toLowerCase() === suggestedTitle.toLowerCase())
              ? `${suggestedTitle}: ${proposal.content.slice(0, 60)}` : suggestedTitle;
            onUpdate(proposal, { targetId: card?.id, title: card?.title ?? createTitle,
              ...(proposal.evaluationSource ? { evaluationSource: { ...proposal.evaluationSource, target: card ? memoryTargetSnapshot(adventure, "storyCard", card.id) : undefined } } : {}),
              cardOperation: card ? "append" : "create", storyCardType: card?.type ?? proposal.storyCardType, appendContent: card ? true : undefined, memoryMode: card?.memoryMode ?? proposal.memoryMode,
              storyCardReview: { ...proposal.storyCardReview!, operation: card ? "update" : "create" } });
          }}>
          <option value="">CREATE — new Story Card</option>
          {adventure.storyCards.map(card => <option key={card.id} value={card.id}>APPEND — {card.title}{proposal.storyCardReview!.targetCandidates.includes(card.id) ? " (suggested)" : ""}</option>)}
        </select></Field>
        {proposal.storyCardReview.targetCandidates.length > 1 && !proposal.targetId && <p>Several continuing subjects may fit. Choose an update target or keep this as a separate card.</p>}
      </div>}
      {isPending && lore && <ProposalEventDate value={proposal.targetId ? lore.lastChangedAt ?? lore.occurredAt : lore.occurredAt}
        onChange={time => onUpdate(proposal, { lore: { ...lore, occurredAt: time, lastChangedAt: time } })} />}
      <textarea
        rows={5}
        value={proposal.content}
        onChange={(event) => onUpdate(proposal, { content: event.target.value })}
        placeholder="Proposed content..."
        disabled={proposal.status === "approved"}
      />

      <details className="editor-tools-panel">
        <summary>Source &amp; details</summary>
        {proposal.eventMemory && <p>Historical Lore · {proposal.eventMemory.kind} · Participants: {proposal.eventMemory.participants.join(", ")} · Recall cues: {proposal.eventMemory.recallCues.join(", ")} · Source messages: {proposal.eventMemory.sourceMessageIds.join(", ")}</p>}
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
                  onChange={(event) => onUpdate(proposal, { storyCardType: event.target.value as StoryCardType, targetId: undefined, appendContent: undefined, placementValidation: undefined })}
                  disabled={!isPending}
                >
                  {storyCardTypes.map((type) => <option key={type} value={type}>{type}</option>)}
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
