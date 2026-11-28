import { autonomousSubjectNames, isAutonomousLore } from "../memory/autonomousLore";
import { RelationshipParticipants } from "./RelationshipParticipants";
import { linkedRelationships, relationshipCardError, relationshipMatches, relationshipTitle, relationshipWriteError, validateRelationshipIds } from "../memory/relationshipCards";
import { StoryCardTriggerCleanup } from "./StoryCardTriggerCleanup";
import { LoreChronologyEditor } from "./StoryCardChronology";
import { PRIMARY_STORY_CARD_TYPES, primaryStoryCardType, isHistoricalLore, migrateStoryCard } from "../memory/storyCardArchitecture";
import { useEffect, useRef, useState } from "react";
import type { ContextInclusionPolicy, ProviderConfig, StoryCard, StoryCardType, TriggerMatchType } from "../types/adventure";
import type { AuditRecommendation } from "../memory/storyCardAudit";
import { storyCardContextContent } from "../memory/storyCardPolicy";
import { makeStoryCard } from "../state/defaults";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, Highlight, MemoryUpdateHistory, NumberInput, TokenCountBadge, UpdatedAtBadge, commaList, contentSnippet, formatCompactTimestamp, fromCommaList } from "./shared";

const TYPE_ORDER: StoryCardType[] = [...PRIMARY_STORY_CARD_TYPES];
const matchTypes: TriggerMatchType[] = ["keyword", "phrase", "regex"];
const inclusionPolicies: ContextInclusionPolicy[] = ["always", "triggered", "manual", "systemSuggested"];

const TYPE_LABELS: Record<StoryCardType, string> = {
  character: "Character",
  location: "Location",
  object: "Object",
  lore: "Lore",
  relationship: "Relationship",
  custom: "Custom",
};

type SortMode = "alpha" | "recent";
type CardStatusFilter = "all" | "active" | "inactive";
type CardFlagFilter = "all" | "flagged" | "pinned" | "protected";

function CardSummary({ card, query, participantNames }: { card: StoryCard; query: string; participantNames?: string }) {
  const contextContent = storyCardContextContent(card);
  const snippet = contentSnippet(contextContent, query);
  const archivedCount = card.archivedFacts?.split("\n").filter((line) => line.trim()).length ?? 0;
  const memoryUpdatedAt = formatCompactTimestamp(card.lastMemoryUpdatedAt);
  const tokenEstimate = approximateTokenCount(contextContent);
  return (
    <span className="story-card-summary">
      <span className="story-card-title">
        <Highlight text={card.title} query={query} />
      </span>
      <span className="story-card-badges">
        <span className="badge badge-type">{TYPE_LABELS[card.type]}</span>
        {card.type !== "lore" && card.autonomousDevelopment === true && <span className="badge">Autonomous Subject</span>}
        {card.type === "lore" && isAutonomousLore(card.lore?.autonomous) && <span className="badge">Autonomous Lore</span>}
        {!card.active && <span className="badge badge-inactive">Inactive</span>}
        {card.pinned && <span className="badge badge-pinned">Pinned</span>}
        {card.protected && <span className="badge badge-protected">Protected</span>}
        {card.priority > 0 && <span className="badge badge-priority">p{card.priority}</span>}
        {card.keys.length > 0 && <span className="badge badge-priority">{card.keys.length} triggers</span>}
        {archivedCount > 0 && <span className="badge badge-priority">{archivedCount} archived</span>}
        <TokenCountBadge count={tokenEstimate} title="Estimated tokens in live card content" />
        <UpdatedAtBadge value={card.updatedAt} />
        {memoryUpdatedAt && (
          <span className="badge badge-memory-update" title={`Last memory update: ${memoryUpdatedAt}`}>
            Memory {memoryUpdatedAt}
          </span>
        )}
      </span>
      <span className="story-card-keys">
        {card.type === "relationship" ? participantNames : card.keys.length > 0 ? card.keys.slice(0, 4).join(", ") : "title trigger"}
      </span>
      {snippet && <span className="search-snippet"><Highlight text={snippet} query={query} /></span>}
    </span>
  );
}

function cardFactLines(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function StoryCardFactHistory({
  card,
  onArchivedChange,
}: {
  card: StoryCard;
  onArchivedChange: (value: string) => void;
}) {
  const archivedFacts = cardFactLines(card.archivedFacts);
  if (archivedFacts.length === 0) {
    return null;
  }

  return (
    <section className="item-focus-section item-history-section">
      <div className="item-section-heading">
        <div>
          <p className="eyebrow">history</p>
          <h4>Archived facts</h4>
        </div>
        <span className="muted">{archivedFacts.length} archived</span>
      </div>
      <div className="item-history-list">
        {archivedFacts.map((fact, index) => (
          <article key={`${index}-${fact}`} className="item-history-entry">
            <div className="item-history-meta">
              <span>archived fact {index + 1}</span>
              <span className="badge badge-inactive">not sent</span>
            </div>
            <p>{fact}</p>
          </article>
        ))}
      </div>
      <details className="brain-inline-details item-inline-details">
        <summary>Edit archived facts</summary>
        <textarea
          rows={4}
          value={card.archivedFacts ?? ""}
          onChange={(event) => onArchivedChange(event.target.value)}
        />
      </details>
    </section>
  );
}

function sortCards(cards: StoryCard[], mode: SortMode): StoryCard[] {
  if (mode === "alpha") {
    return [...cards].sort((a, b) => a.title.localeCompare(b.title));
  }
  return [...cards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

interface StoryCardsPageProps extends AdventurePageProps {
  providerConfig?: ProviderConfig;
  loading?: boolean;
  onAuditStoryCards?: (nTurns: number, includeAI: boolean) => Promise<AuditRecommendation[]>;
}

type AuditState = {
  status: "running" | "done" | "error";
  recommendations: AuditRecommendation[];
  errorMessage?: string;
};

export function StoryCardsPage({
  adventure,
  dispatch,
  loading,
  onAuditStoryCards,
  providerConfig,
}: StoryCardsPageProps) {
  const [linkEditor, setLinkEditor] = useState<{ cardId?: string; ids: string[] }>();
  const [importText, setImportText] = useState("");
  const [newCardId, setNewCardId] = useState<string | undefined>();
  const [sortMode, setSortMode] = useState<SortMode>("alpha");
  const [typeFilter, setTypeFilter] = useState<StoryCardType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<CardStatusFilter>("all");
  const [flagFilter, setFlagFilter] = useState<CardFlagFilter>("all");
  const [search, setSearch] = useState("");
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [auditTurns, setAuditTurns] = useState(20);
  const [auditIncludeAI, setAuditIncludeAI] = useState(false);
  const [audit, setAudit] = useState<AuditState | null>(null);
  const newCardRef = useRef<HTMLDetailsElement | null>(null);

  function updateRec(id: string, patch: Partial<AuditRecommendation>) {
    setAudit((prev) => prev && {
      ...prev,
      recommendations: prev.recommendations.map((r) => r.id === id ? { ...r, ...patch } : r),
    });
  }

  function approveRec(rec: AuditRecommendation) {
    if (rec.suggestedType === "relationship" || adventure.storyCards.some(card => card.id === rec.cardId && card.type === "relationship")) return;
    if (rec.decision === "approved") return;
    if (rec.action !== "create" && !adventure.storyCards.some(card => card.id === rec.cardId)) {
      setAudit(previous => previous && { ...previous, errorMessage: "Unable to apply — destination card is missing. Keep this recommendation and choose an existing card or create a new one." });
      return;
    }
    if (rec.action !== "delete" && !rec.editedContent.trim()) {
      setAudit(previous => previous && { ...previous, errorMessage: "Unable to apply — recommendation content is empty. Edit the recommendation before approval." });
      return;
    }
    if (rec.action === "delete" && !window.confirm(`Delete Story Card “${rec.title}”?`)) return;
    if (rec.action === "delete" && rec.cardId) {
      dispatch({ type: "DELETE_STORY_CARD", storyCardId: rec.cardId });
    } else if (rec.action === "edit" && rec.cardId) {
      dispatch({
        type: "UPDATE_STORY_CARD",
        storyCardId: rec.cardId,
        patch: {
          content: rec.editedContent,
          keys: rec.editedKeys.split(",").map((k) => k.trim()).filter(Boolean),
          type: primaryStoryCardType(rec.suggestedType),
        },
      });
    } else if (rec.action === "create") {
      const validTypes = new Set<StoryCardType>(PRIMARY_STORY_CARD_TYPES);
      const type: StoryCardType = validTypes.has(rec.suggestedType as StoryCardType)
        ? (rec.suggestedType as StoryCardType)
        : "custom";
      dispatch({
        type: "UPSERT_STORY_CARD",
        storyCard: makeStoryCard({
          title: rec.title,
          content: rec.editedContent,
          keys: rec.editedKeys.split(",").map((k) => k.trim()).filter(Boolean),
          type,
        }),
      });
    }
    updateRec(rec.id, { decision: "approved" });
  }

  async function runAudit() {
    if (!onAuditStoryCards) return;
    setAudit({ status: "running", recommendations: [] });
    try {
      const recs = await onAuditStoryCards(auditTurns, auditIncludeAI);
      setAudit({ status: "done", recommendations: recs });
    } catch (err) {
      setAudit({ status: "error", recommendations: [], errorMessage: err instanceof Error ? err.message : "Audit failed." });
    }
  }

  useEffect(() => {
    if (!newCardId) return;
    setOpenCardId(newCardId);
    newCardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    setNewCardId(undefined);
  }, [newCardId, adventure.storyCards.length]);

  function importCards() {
    try {
      const input = JSON.parse(importText);
      const parsed = Array.isArray(input) ? input : input?.storyCards;
      if (!Array.isArray(parsed)) throw new Error("Expected an array of Story Cards.");
      const incoming = new Map<string, StoryCard>();
      for (const card of parsed) {
        if (!card || typeof card.id !== "string" || !card.id || typeof card.title !== "string" || typeof card.content !== "string"
          || !Array.isArray(card.keys) || incoming.has(card.id)) throw new Error("Invalid Story Card data or duplicate card ID.");
        incoming.set(card.id, migrateStoryCard(card));
      }
      const merged = new Map(adventure.storyCards.map(card => [card.id, card]));
      for (const [id, card] of incoming) merged.set(id, card);
      const finalCards = [...merged.values()];
      for (const card of incoming.values()) {
        const previous = adventure.storyCards.find(saved => saved.id === card.id);
        const error = relationshipWriteError(finalCards, previous, card);
        if (error) throw new Error(card.title + ": " + error);
      }
      for (const card of finalCards) {
        if (card.type !== "relationship" || !Array.isArray(card.relationship?.characterIds)
          || !card.relationship.characterIds.some(id => incoming.has(id))) continue;
        const error = relationshipCardError(finalCards, card);
        if (error) throw new Error(card.title + ": " + error);
      }
      dispatch({ type: "IMPORT_STORY_CARDS", storyCards: [...incoming.values()] });
      setImportText("");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not import story cards.");
    }
  }

  function participantNames(card: StoryCard): string {
    const ids = card.relationship?.characterIds;
    return Array.isArray(ids) ? ids.map(id => adventure.storyCards.find(candidate => candidate.id === id)?.title ?? id).join(" + ") : "";
  }
  const linkConflict = linkEditor && relationshipMatches(adventure.storyCards, linkEditor.ids).find(card => card.id !== linkEditor.cardId);
  const linkError = linkEditor && (validateRelationshipIds(adventure.storyCards, linkEditor.ids)
    ?? (linkConflict ? "A Relationship Card already links these characters." : undefined));
  function saveLinks() {
    if (!linkEditor || linkError) return;
    const relationship = { characterIds: linkEditor.ids };
    if (linkEditor.cardId) dispatch({ type: "UPDATE_STORY_CARD", storyCardId: linkEditor.cardId, patch: { relationship } });
    else {
      const card = makeStoryCard({ type: "relationship", title: relationshipTitle(adventure.storyCards, linkEditor.ids), content: "", relationship });
      dispatch({ type: "UPSERT_STORY_CARD", storyCard: card });
      setNewCardId(card.id);
    }
    setLinkEditor(undefined);
  }

  const searchLower = search.toLowerCase().trim();
  function cardMatchesSearch(card: StoryCard): boolean {
    if (!searchLower) return true;
    const compactText = [
      card.compactKind,
      card.compactStatus,
      ...(card.coreFacts ?? []),
      ...(card.currentFacts ?? []),
      ...(card.recentDevelopments ?? []),
      ...(card.sourceTurnIds ?? []),
    ].filter(Boolean).join(" ");
    return participantNames(card).toLowerCase().includes(searchLower) || card.title.toLowerCase().includes(searchLower) ||
      card.keys.some((k) => k.toLowerCase().includes(searchLower)) ||
      card.content.toLowerCase().includes(searchLower) ||
      compactText.toLowerCase().includes(searchLower);
  }

  function cardMatchesFilters(card: StoryCard): boolean {
    const statusMatches =
      statusFilter === "all" ||
      (statusFilter === "active" && card.active) ||
      (statusFilter === "inactive" && !card.active);
    const flagMatches =
      flagFilter === "all" ||
      (flagFilter === "flagged" && (card.pinned || card.protected)) ||
      (flagFilter === "pinned" && card.pinned) ||
      (flagFilter === "protected" && card.protected);
    const typeMatches = typeFilter === "all" || card.type === typeFilter;
    return typeMatches && statusMatches && flagMatches;
  }

  // Group cards by type, only include types that have at least one card
  const groups: Array<{ type: StoryCardType; cards: StoryCard[] }> = TYPE_ORDER
    .map((type) => ({ type, cards: sortCards(adventure.storyCards.filter((c) => c.type === type && cardMatchesSearch(c) && cardMatchesFilters(c)), sortMode) }))
    .filter((g) => g.cards.length > 0);
  const totalCards = adventure.storyCards.length;
  const activeCards = adventure.storyCards.filter((c) => c.active);
  const activeCount = activeCards.length;
  const visibleCount = groups.reduce((sum, group) => sum + group.cards.length, 0);
  const filtersActive = typeFilter !== "all" || statusFilter !== "all" || flagFilter !== "all";

  return (
    <section className="page editor-surface story-cards-page">
      <div className="editor-page-summary">
        <p className="muted">
          Triggered memory for characters, places, relationships, secrets, rules, and recurring facts.
          Relationship Cards are checked for broken links in the editor. Phrase-key audits cover the other card types. Every card can grow with new facts. Memory appends to a matching subject or creates a new card. Generated changes follow your approval settings.
        </p>
        <div className="editor-stat-row" aria-label="Story card counts">
          <span>{totalCards} total</span>
          <span>{activeCount} active</span>
          {(searchLower || filtersActive) && <span>{visibleCount} shown</span>}
        </div>
      </div>
      <p className="muted editor-legacy-help" style={{ margin: 0 }}>
        Story Cards are <strong>triggered memory</strong> — they enter the model context when their title or trigger keys match
        the current input or recent story. Use them for characters, places, relationships, secrets, rules, and recurring facts
        that are only relevant some of the time. Keep triggers specific; broad keys cause card bleed.
        For always-on world lore that should load every turn regardless, use a <strong>World Block</strong>.
      </p>

      <div className="editor-command-bar">
        <input
          type="search"
          placeholder="Search cards…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="editor-filter-strip" aria-label="Story card filters">
          <select
            aria-label="Filter by card type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as StoryCardType | "all")}
          >
            <option value="all">All card types</option>
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>{TYPE_LABELS[type]}</option>
            ))}
          </select>
          <div className="sort-toggle" role="group" aria-label="Status filter">
            <button
              type="button"
              className={statusFilter === "all" ? "active" : ""}
              aria-pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={statusFilter === "active" ? "active" : ""}
              aria-pressed={statusFilter === "active"}
              onClick={() => setStatusFilter("active")}
            >
              Active
            </button>
            <button
              type="button"
              className={statusFilter === "inactive" ? "active" : ""}
              aria-pressed={statusFilter === "inactive"}
              onClick={() => setStatusFilter("inactive")}
            >
              Inactive
            </button>
          </div>
          <div className="sort-toggle" role="group" aria-label="Card flag filter">
            <button
              type="button"
              className={flagFilter === "all" ? "active" : ""}
              aria-pressed={flagFilter === "all"}
              onClick={() => setFlagFilter("all")}
            >
              Any
            </button>
            <button
              type="button"
              className={flagFilter === "flagged" ? "active" : ""}
              aria-pressed={flagFilter === "flagged"}
              onClick={() => setFlagFilter("flagged")}
            >
              Flagged
            </button>
            <button
              type="button"
              className={flagFilter === "pinned" ? "active" : ""}
              aria-pressed={flagFilter === "pinned"}
              onClick={() => setFlagFilter("pinned")}
            >
              Pinned
            </button>
            <button
              type="button"
              className={flagFilter === "protected" ? "active" : ""}
              aria-pressed={flagFilter === "protected"}
              onClick={() => setFlagFilter("protected")}
            >
              Protected
            </button>
          </div>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            if (typeFilter === "relationship") { setLinkEditor({ ids: [] }); return; }
            const card = makeStoryCard({ title: "New Story Card", content: "", type: typeFilter === "all" ? "custom" : typeFilter });
            dispatch({ type: "UPSERT_STORY_CARD", storyCard: card });
            setNewCardId(card.id);
          }}
        >
          Create Story Card
        </button>
        {linkEditor && <div>
          <RelationshipParticipants cards={adventure.storyCards} selected={linkEditor.ids}
            onChange={ids => setLinkEditor({ ...linkEditor, ids })} />
          {linkError && <p role="alert">{linkError}</p>}
          {linkConflict && <button type="button" onClick={() => { setOpenCardId(linkConflict.id); setLinkEditor(undefined); }}>Open {linkConflict.title}</button>}
          <button type="button" disabled={Boolean(linkError)} onClick={saveLinks}>Save linked characters</button>
          <button type="button" onClick={() => setLinkEditor(undefined)}>Cancel</button>
        </div>}
        <button type="button" onClick={() => { setTypeFilter("relationship"); setLinkEditor({ ids: [] }); }}>Create Relationship Card</button>
        <div className="sort-toggle">
          <button
            type="button"
            className={sortMode === "alpha" ? "active" : ""}
            onClick={() => setSortMode("alpha")}
          >
            A–Z
          </button>
          <button
            type="button"
            className={sortMode === "recent" ? "active" : ""}
            onClick={() => setSortMode("recent")}
          >
            Recent
          </button>
        </div>
      </div>

      {onAuditStoryCards && (
        <details className="panel editor-tools-panel story-card-maintenance-panel" open>
          <summary>Review and Maintain Cards</summary>
          <div className="story-card-maintenance-grid">
              <section className="story-card-tool-card story-card-tool-card-primary">
                <div className="story-card-tool-copy">
                  <h3>Clean up existing cards</h3>
                  <p className="muted">
                    Find broad triggers, stale current facts, misplaced history, duplicate cards, and missing facts and duplicate subjects.
                  </p>
                </div>
                <div className="story-card-tool-controls">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={loading || audit?.status === "running"}
                    onClick={runAudit}
                    title="Review existing cards and get cleanup suggestions: trigger fixes, factual corrections, duplicates and missing subjects."
                  >
                    {audit?.status === "running" ? "Cleaning..." : "Clean Up Cards"}
                  </button>
                  <label className="turn-window-field">
                    <span>Review last</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={auditTurns}
                      onChange={(e) => setAuditTurns(Math.max(1, Number(e.target.value)))}
                      className="audit-turns-input"
                    />
                    <span>turns</span>
                  </label>
                  <CheckboxField
                    label="Include AI semantic pass"
                    checked={auditIncludeAI}
                    onChange={setAuditIncludeAI}
                  />
                </div>
              </section>

          </div>
        </details>
      )}

      <p className="muted">Automatic memory can suggest changes to relevant Story Cards. AIST uses the global memory evaluation interval. Story Cards do not have a separate automatic update interval.</p>

      {providerConfig && <StoryCardTriggerCleanup key={adventure.id} adventure={adventure} dispatch={dispatch} providerConfig={providerConfig} loading={loading} />}

      <details className="panel editor-tools-panel story-card-json-panel">
        <summary>Story Card JSON</summary>
        <div className="story-card-json-actions">
          <button type="button" onClick={() => navigator.clipboard.writeText(JSON.stringify(adventure.storyCards, null, 2))}>
            Copy Story Cards JSON
          </button>
          <span className="muted">Advanced import/export for backups and reusable card packs.</span>
        </div>
        <Field label="Import Story Cards JSON">
          <textarea rows={6} value={importText} onChange={(event) => setImportText(event.target.value)} />
        </Field>
        <button type="button" onClick={importCards}>
          Import Story Cards
        </button>
      </details>

      {groups.length === 0 && (
        <p className="muted">
          {totalCards === 0 ? "No story cards yet." : "No story cards match the current search and filters."}
        </p>
      )}

      {audit && audit.status !== "running" && (
        <div className="audit-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAudit(null); }}>
          <div className="audit-modal">
            <div className="audit-modal-header">
              <h3>Story Card Cleanup</h3>
              <button type="button" className="audit-modal-close" onClick={() => setAudit(null)}>✕</button>
            </div>

            {audit.status === "error" && (
              <p className="audit-error">{audit.errorMessage}</p>
            )}

            {audit.status === "done" && audit.recommendations.length === 0 && (
              <p className="muted">No changes recommended — your story cards look good.</p>
            )}

            {audit.recommendations.map((rec) => (
              <div key={rec.id} className={`audit-rec ${rec.decision !== "pending" ? `audit-rec-${rec.decision}` : ""}`}>
                <div className="audit-rec-header">
                  <span className={`audit-badge audit-badge-${rec.action}`}>{rec.action.toUpperCase()}</span>
                  {rec.source === "deterministic" && <span className="audit-badge audit-badge-det">DETECTED</span>}
                  {rec.action !== "delete" && <span className="audit-badge audit-badge-det">{rec.suggestedMemoryMode}</span>}
                  <span className="audit-rec-title">{rec.title}</span>
                  {rec.decision !== "pending" && (
                    <span className={`audit-badge audit-badge-decision-${rec.decision}`}>{rec.decision}</span>
                  )}
                </div>
                <p className="audit-rec-rationale">{rec.rationale}</p>

                {rec.action !== "delete" && rec.decision !== "approved" && (
                  <div className="audit-rec-fields">
                    <label className="field">
                      <span>Content</span>
                      <textarea
                        rows={5}
                        value={rec.editedContent}
                        onChange={(e) => updateRec(rec.id, { editedContent: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>Keys (comma-separated)</span>
                      <input
                        value={rec.editedKeys}
                        onChange={(e) => updateRec(rec.id, { editedKeys: e.target.value })}
                      />
                    </label>
                    <div className="field-row">
                      <label className="field">
                        <span>Type</span>
                        <select
                          value={rec.suggestedType}
                          onChange={(e) => updateRec(rec.id, { suggestedType: e.target.value as StoryCardType })}
                        >
                          {TYPE_ORDER.map((type) => (
                            <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                          ))}
                        </select>
                      </label>

                    </div>
                  </div>
                )}

                {rec.decision !== "approved" && (
                  <div className="audit-rec-actions">
                    <button type="button" className="manual-approval" onClick={() => approveRec(rec)}>Approve</button>
                    <button type="button" className="danger" onClick={() => updateRec(rec.id, { decision: "rejected" })}>Reject</button>
                  </div>
                )}
              </div>
            ))}

            {audit.errorMessage && <p role="alert">{audit.errorMessage}</p>}
            <div className="audit-modal-footer">
              <button type="button" onClick={() => setAudit(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {groups.map(({ type, cards }) => (
        <div key={type} className="card-group">
          <h4 className="card-group-label">{TYPE_LABELS[type]} <span className="muted">({cards.length})</span></h4>
          <div className="list split-editor-list story-card-editor-list">
            {cards.map((card) => (
              <details
                key={card.id}
                ref={card.id === newCardId ? newCardRef : null}
                className="card story-card-item split-editor-item story-card-editor-item"
                open={openCardId === card.id}
              >
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    setOpenCardId((current) => current === card.id ? null : card.id);
                  }}
                >
                  <CardSummary card={card} query={searchLower} participantNames={participantNames(card)} />
                </summary>

                <div className="editor-card item-inspector story-card-inspector">
                  <div className="panel-heading item-inspector-heading">
                    <div>
                      <p className="eyebrow">
                        {card.active ? "active" : "inactive"} · {TYPE_LABELS[card.type]}
                      </p>
                      <h3>{card.title || "Untitled Card"}</h3>
                      <div className="item-tag-row" aria-label="Story card triggers">
                        {card.type !== "relationship" && card.keys.length === 0 && <span className="item-tag muted">Title trigger only</span>}
                        {card.keys.map((key) => (
                          <span key={key} className="item-tag">{key}</span>
                        ))}
                      </div>
                    </div>
                    <button type="button" className="danger" onClick={() => {
                      const links = linkedRelationships(adventure.storyCards, card.id);
                      if (links.length) { alert("Remove this character from: " + links.map(link => link.title).join(", ")); return; }
                      dispatch({ type: "DELETE_STORY_CARD", storyCardId: card.id });
                    }}>
                      Delete
                    </button>
                  </div>
                  {card.type !== "lore" && <div className="notice">
                    <CheckboxField
                      label="Autonomous World Development"
                      checked={card.autonomousDevelopment === true}
                      onChange={(checked) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { autonomousDevelopment: checked } })}
                    />
                    <p className="muted">Allow the memory model to generate independent off-screen developments involving this subject.</p>
                  </div>}
                  <div className="grid three story-card-primary-fields">
                    <Field label="Title">
                      <input
                        value={card.title}
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { title: event.target.value } })}
                      />
                    </Field>
                    {card.type === "relationship" ? <div>
                      <p>All linked Character Cards must be in context.</p>
                      <p>{participantNames(card)}</p>
                      {relationshipCardError(adventure.storyCards, card) && <p role="alert">{relationshipCardError(adventure.storyCards, card)}</p>}
                      <button type="button" onClick={() => setLinkEditor({ cardId: card.id,
                        ids: Array.isArray(card.relationship?.characterIds) ? [...new Set(card.relationship.characterIds.filter(id => adventure.storyCards.some(candidate => candidate.id === id && candidate.type === "character")))] : [] })}>Edit linked characters</button>
                    </div> : <Field label="Trigger Keys">
                      <input
                        value={commaList(card.keys)}
                        title="Comma-separated; leave blank to use title only."
                        placeholder="Blazer, Blonde Blazer"
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { keys: fromCommaList(event.target.value) } })}
                      />
                    </Field>}
                    <Field label="Type">
                      {linkedRelationships(adventure.storyCards, card.id).length > 0 && <p>Remove this character from {linkedRelationships(adventure.storyCards, card.id).map(link => link.title).join(", ")} before changing its type.</p>}
                      <select
                        value={card.type}
                        disabled={card.type === "relationship" || linkedRelationships(adventure.storyCards, card.id).length > 0}
                        onChange={(event) =>
                          dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { type: event.target.value as StoryCardType } })
                        }
                      >
                        {Object.entries(TYPE_LABELS).filter(([value]) => value !== "relationship" || card.type === "relationship").map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {card.type !== "relationship" && <details className="brain-secondary-details item-secondary-details">
                    <summary>Trigger behavior</summary>

                  <div className="grid two">
                    <Field label="Trigger Match Type">
                      <select
                        value={card.matchType ?? "phrase"}
                        onChange={(event) =>
                          dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { matchType: event.target.value as TriggerMatchType } })
                        }
                      >
                        <option value="keyword">keyword — matches anywhere the word appears, even inside longer words</option>
                        <option value="phrase">phrase — whole-word match, won't fire inside another word (default)</option>
                        <option value="regex">regex — full regular expression for complex patterns</option>
                      </select>
                    </Field>
                  </div>
                  </details>}
                  <section className="item-focus-section">
                    <div className="item-section-heading">
                      <div>
                        <h4>Card text sent when triggered</h4>
                      </div>
                      <span className="muted">{cardFactLines(card.content).length} line{cardFactLines(card.content).length === 1 ? "" : "s"}</span>
                    </div>
                  <LoreChronologyEditor card={card} dispatch={dispatch} messages={adventure.messages} />
                  <Field label="Content">
                    <textarea
                      rows={6}
                      value={card.content}
                      onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { content: event.target.value } })}
                    />
                  </Field>
                  </section>
                  <StoryCardFactHistory
                    card={card}
                    onArchivedChange={(archivedFacts) =>
                      dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { archivedFacts } })
                    }
                  />
                  <MemoryUpdateHistory history={card.memoryUpdateHistory} />
                  {card.archivedFacts?.trim() && (
                    <details className="editor-legacy-help">
                      <summary className="muted">
                        Archived facts ({card.archivedFacts.split("\n").filter((l) => l.trim()).length}) — superseded, kept on record, never sent to the AI
                      </summary>
                      <textarea
                        rows={4}
                        value={card.archivedFacts}
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { archivedFacts: event.target.value } })}
                        style={{ marginTop: "0.5rem", opacity: 0.8 }}
                      />
                    </details>
                  )}
                  <details className="brain-secondary-details item-secondary-details">
                    <summary>Context, automation, and ordering</summary>
                  <div className="notice">
                    <h4>Automatic Memory Eligibility</h4>
                    <p>AIST can evaluate this card when its subject is relevant to recent story events. The evaluator can select up to eight candidate cards. New, lasting facts can produce an update suggestion.</p>
                    <p>Per-card update interval: Not configurable.</p>
                    <p>Per-card automatic update switch: Not available in the current evaluator.</p>
                    <p>Active, Pinned, and Inclusion Policy control when the storyteller receives this card. These settings do not set automatic memory update frequency. Protected cards require review before an automatic update can be applied.</p>
                  </div>
                  <div className="grid four">
                    <Field label="Priority (higher = loaded first)">
                      <NumberInput
                        value={card.priority}
                        onChange={(value) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { priority: value } })}
                      />
                    </Field>
                    <Field label="Token Budget (0 = default ~200; caps live content, older facts archive)">
                      <NumberInput
                        value={card.tokenBudget ?? 0}
                        min={0}
                        onChange={(value) =>
                          dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { tokenBudget: value || undefined } })
                        }
                      />
                    </Field>
                    <CheckboxField
                      label="Active"
                      checked={card.active}
                      onChange={(checked) => dispatch({ type: checked ? "ACTIVATE_STORY_CARD" : "DEACTIVATE_STORY_CARD", storyCardId: card.id })}
                    />
                    <CheckboxField
                      label={card.type === "relationship" ? "Pinned (prioritize when all linked characters are included)" : "Pinned (included even without a trigger match)"}
                      checked={card.pinned}
                      onChange={(checked) => dispatch({ type: checked ? "PIN_STORY_CARD" : "UNPIN_STORY_CARD", storyCardId: card.id })}
                    />
                  </div>
                  {card.type === "lore" && isAutonomousLore(card.lore?.autonomous) &&
                    <p>Originating subjects: {autonomousSubjectNames(adventure, card.lore.autonomous).join(", ")}</p>}
                  <div className="grid two">
                    <CheckboxField
                      label={card.type === "relationship" ? "Protected (first choice of remaining context budget)" : "Protected (cannot be dropped by token truncation)"}
                      checked={card.protected}
                      onChange={(checked) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { protected: checked } })}
                    />
                    {card.type !== "relationship" && <Field label="Inclusion Policy">
                      <select
                        value={card.inclusionPolicy}
                        onChange={(event) =>
                          dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { inclusionPolicy: event.target.value as ContextInclusionPolicy } })
                        }
                      >
                        {inclusionPolicies.map((policy) => (
                          <option key={policy} value={policy}>
                            {policy}
                          </option>
                        ))}
                      </select>
                    </Field>}
                  </div>
                  <Field label="State (runtime note visible to automation conditions)">
                    <input
                      value={card.state}
                      onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { state: event.target.value } })}
                    />
                  </Field>
                  <div className="row">
                    {isHistoricalLore(card) && (
                      <fieldset>
                        <legend>Lore recall and evidence</legend>
                        <Field label="Participants">
                          <input
                            value={commaList(card.eventMemory?.participants ?? [])}
                            onChange={event => dispatch({
                              type: "UPDATE_STORY_CARD", storyCardId: card.id,
                              patch: { eventMemory: {
                                sourceMessageIds: [], recallCues: [], kind: "sharedExperience",
                                ...card.eventMemory, participants: fromCommaList(event.target.value),
                              } },
                            })}
                          />
                        </Field>
                        <Field label="Recall cues">
                          <input
                            value={commaList(card.eventMemory?.recallCues ?? card.keys)}
                            onChange={event => dispatch({
                              type: "UPDATE_STORY_CARD", storyCardId: card.id,
                              patch: { eventMemory: {
                                sourceMessageIds: [], participants: [], kind: "sharedExperience",
                                ...card.eventMemory, recallCues: fromCommaList(event.target.value),
                              } },
                            })}
                          />
                        </Field>
                        <details>
                          <summary>Original event evidence</summary>
                          {!card.eventMemory?.sourceMessageIds.length && <p>No Chronicle source messages are attached.</p>}
                          {card.eventMemory?.sourceMessageIds.map(id => (
                            <p key={id}><strong>{id}</strong>: {adventure.messages.find(message => message.id === id)?.content ?? "Source message is no longer available."}</p>
                          ))}
                        </details>
                      </fieldset>
                    )}
                    <button type="button" onClick={() => dispatch({ type: "REORDER_STORY_CARD", storyCardId: card.id, direction: "up" })}>
                      Move Up
                    </button>
                    <button type="button" onClick={() => dispatch({ type: "REORDER_STORY_CARD", storyCardId: card.id, direction: "down" })}>
                      Move Down
                    </button>
                    <button type="button" className="danger" onClick={() => {
                      const links = linkedRelationships(adventure.storyCards, card.id);
                      if (links.length) { alert("Remove this character from: " + links.map(link => link.title).join(", ")); return; }
                      dispatch({ type: "DELETE_STORY_CARD", storyCardId: card.id });
                    }}>
                      Delete
                    </button>
                  </div>
                  </details>
                </div>
              </details>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
