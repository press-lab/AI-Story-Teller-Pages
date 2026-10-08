import { useEffect, useRef, useState } from "react";
import type { ContextInclusionPolicy, StoryCard, StoryCardAIBuilderIntent, StoryCardCompactKind, StoryCardCompactStatus, StoryCardMemoryMode, StoryCardType, TriggerMatchType, StoryCardAIBuilderRequest } from "../types/adventure";
import type { AuditRecommendation } from "../memory/storyCardAudit";
import { storyCardContextContent } from "../memory/storyCardPolicy";
import { makeStoryCard } from "../state/defaults";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, Highlight, MemoryUpdateHistory, NumberInput, TokenCountBadge, UpdatedAtBadge, commaList, contentSnippet, formatCompactTimestamp, fromCommaList } from "./shared";

const TYPE_ORDER: StoryCardType[] = ["character", "location", "lore", "plot", "event", "custom"];
const MEMORY_MODE_OPTIONS: StoryCardMemoryMode[] = ["static", "living", "historical"];
const COMPACT_KIND_OPTIONS: Array<{ value: StoryCardCompactKind; label: string }> = [
  { value: "pact", label: "Pact / deal" },
  { value: "promise", label: "Promise / oath" },
  { value: "coverStory", label: "Cover story / shield" },
  { value: "alliance", label: "Alliance / truce" },
  { value: "debt", label: "Debt / obligation" },
  { value: "secret", label: "Secret" },
  { value: "truce", label: "Truce" },
];
const COMPACT_STATUS_OPTIONS: StoryCardCompactStatus[] = ["active", "strained", "broken", "resolved", "superseded"];
const matchTypes: TriggerMatchType[] = ["keyword", "phrase", "regex"];
const inclusionPolicies: ContextInclusionPolicy[] = ["always", "triggered", "manual", "systemSuggested"];

const TYPE_LABELS: Record<StoryCardType, string> = {
  character: "Character",
  location: "Location",
  lore: "Lore",
  plot: "Plot",
  event: "Event Memory",
  custom: "Custom",
};

type SortMode = "alpha" | "recent";
type CardStatusFilter = "all" | "active" | "inactive";
type CardMemoryFilter = "all" | "living";
type CardFlagFilter = "all" | "flagged" | "pinned" | "protected";
type StoryCardModeChoice = "auto" | StoryCardMemoryMode;

const DEFAULT_AI_RECENT_MESSAGE_COUNT = 8;
const MAX_AI_RECENT_MESSAGE_COUNT = 50;

const CARD_BUILDER_INTENTS: Array<{ value: StoryCardAIBuilderIntent; label: string }> = [
  { value: "relationship", label: "Relationship / dynamic" },
  { value: "character", label: "Character / voice" },
  { value: "subplot", label: "Ongoing subplot / status" },
  { value: "secret", label: "Secret / reveal" },
  { value: "rule", label: "Rule / lore" },
  { value: "location", label: "Location" },
  { value: "faction", label: "Faction" },
  { value: "object", label: "Object" },
  { value: "event", label: "Completed event" },
  { value: "auto", label: "Let AI choose" },
];

function clampAiRecentMessageCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_AI_RECENT_MESSAGE_COUNT, Math.round(value)));
}

/** A card the memory engine manages in place (auto-appends new facts, archives old ones). */
export function isLivingCard(card: StoryCard): boolean {
  return card.memoryMode === "living" || (card.state ?? "").split(/\s+/).includes("living");
}

/** Shown before a living card's title so they're instantly identifiable in the list. */
export const LIVING_CARD_PREFIX = "⟳ ";

function CardSummary({ card, query }: { card: StoryCard; query: string }) {
  const contextContent = storyCardContextContent(card);
  const snippet = contentSnippet(contextContent, query);
  const living = isLivingCard(card);
  const archivedCount = card.archivedFacts?.split("\n").filter((line) => line.trim()).length ?? 0;
  const memoryUpdatedAt = formatCompactTimestamp(card.lastMemoryUpdatedAt);
  const tokenEstimate = approximateTokenCount(contextContent);
  return (
    <span className="story-card-summary">
      <span className="story-card-title">
        {living && <span className="badge badge-priority" title="Living card — auto-updated; old facts are archived, not deleted">{LIVING_CARD_PREFIX}Living</span>}{" "}
        <Highlight text={card.title} query={query} />
      </span>
      <span className="story-card-badges">
        <span className="badge badge-type">{TYPE_LABELS[card.type]}</span>
        {card.compactKind && <span className="badge badge-priority">{card.compactKind}</span>}
        {card.compactStatus && <span className="badge badge-priority">{card.compactStatus}</span>}
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
        {card.keys.length > 0 ? card.keys.slice(0, 4).join(", ") : "title trigger"}
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

function hasStructuredFacts(card: StoryCard): boolean {
  return Boolean(card.coreFacts?.length || card.currentFacts?.length || card.recentDevelopments?.length);
}

function factListText(facts: string[] | undefined): string {
  return (facts ?? []).join("\n");
}

function factListFromText(text: string): string[] {
  return text
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
  loading?: boolean;
  onBuildStoryCardMemory?: (request: StoryCardAIBuilderRequest) => Promise<void>;
  onSuggestCardUpdates?: () => Promise<void>;
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
  onBuildStoryCardMemory,
  onSuggestCardUpdates,
  onAuditStoryCards,
}: StoryCardsPageProps) {
  const [importText, setImportText] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [aiIntent, setAiIntent] = useState<StoryCardAIBuilderIntent>("relationship");
  const [aiMemoryMode, setAiMemoryMode] = useState<StoryCardModeChoice>("living");
  const [aiRecentMessageCount, setAiRecentMessageCount] = useState(DEFAULT_AI_RECENT_MESSAGE_COUNT);
  const [aiTargetCardId, setAiTargetCardId] = useState("");
  const [aiAutoUpdate, setAiAutoUpdate] = useState(true);
  const [aiAutoUpdateCooldown, setAiAutoUpdateCooldown] = useState(3);
  const [newCardId, setNewCardId] = useState<string | undefined>();
  const [sortMode, setSortMode] = useState<SortMode>("alpha");
  const [statusFilter, setStatusFilter] = useState<CardStatusFilter>("all");
  const [memoryFilter, setMemoryFilter] = useState<CardMemoryFilter>("all");
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
    if (rec.action === "delete" && rec.cardId) {
      dispatch({ type: "DELETE_STORY_CARD", storyCardId: rec.cardId });
    } else if (rec.action === "edit" && rec.cardId) {
      dispatch({
        type: "UPDATE_STORY_CARD",
        storyCardId: rec.cardId,
        patch: {
          content: rec.editedContent,
          keys: rec.editedKeys.split(",").map((k) => k.trim()).filter(Boolean),
          type: rec.suggestedType,
          memoryMode: rec.suggestedMemoryMode,
        },
      });
    } else if (rec.action === "create") {
      const validTypes = new Set<StoryCardType>(["character", "location", "lore", "plot", "event", "custom"]);
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
          memoryMode: rec.suggestedMemoryMode,
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
      const parsed = JSON.parse(importText) as StoryCard[];
      if (!Array.isArray(parsed)) throw new Error("Expected an array of story cards.");
      parsed.forEach((card) => dispatch({ type: "UPSERT_STORY_CARD", storyCard: card }));
      setImportText("");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not import story cards.");
    }
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
    return card.title.toLowerCase().includes(searchLower) ||
      card.keys.some((k) => k.toLowerCase().includes(searchLower)) ||
      card.content.toLowerCase().includes(searchLower) ||
      compactText.toLowerCase().includes(searchLower);
  }

  function cardMatchesFilters(card: StoryCard): boolean {
    const statusMatches =
      statusFilter === "all" ||
      (statusFilter === "active" && card.active) ||
      (statusFilter === "inactive" && !card.active);
    const memoryMatches = memoryFilter === "all" || isLivingCard(card);
    const flagMatches =
      flagFilter === "all" ||
      (flagFilter === "flagged" && (card.pinned || card.protected)) ||
      (flagFilter === "pinned" && card.pinned) ||
      (flagFilter === "protected" && card.protected);
    return statusMatches && memoryMatches && flagMatches;
  }

  // Group cards by type, only include types that have at least one card
  const groups: Array<{ type: StoryCardType; cards: StoryCard[] }> = TYPE_ORDER
    .map((type) => ({ type, cards: sortCards(adventure.storyCards.filter((c) => c.type === type && cardMatchesSearch(c) && cardMatchesFilters(c)), sortMode) }))
    .filter((g) => g.cards.length > 0);
  const totalCards = adventure.storyCards.length;
  const activeCards = adventure.storyCards.filter((c) => c.active);
  const autoCard = adventure.storyCards.find((c) => c.autoUpdate);
  const activeCount = activeCards.length;
  const visibleCount = groups.reduce((sum, group) => sum + group.cards.length, 0);
  const livingCount = adventure.storyCards.filter(isLivingCard).length;
  const filtersActive = statusFilter !== "all" || memoryFilter !== "all" || flagFilter !== "all";

  async function handleBuildStoryCardMemory() {
    if (!onBuildStoryCardMemory || !aiDescription.trim()) return;
    await onBuildStoryCardMemory({
      description: aiDescription.trim(),
      intent: aiIntent,
      memoryMode: aiMemoryMode === "auto" ? undefined : aiMemoryMode,
      recentMessageCount: aiRecentMessageCount,
      targetCardId: aiTargetCardId || undefined,
      autoUpdate: aiAutoUpdate,
      autoUpdateCooldownTurns: aiAutoUpdate ? aiAutoUpdateCooldown : undefined,
    });
    setAiDescription("");
  }

  return (
    <section className="page editor-surface story-cards-page">
      <div className="editor-page-summary">
        <p className="muted">
          Triggered memory for characters, places, relationships, secrets, rules, and recurring facts.
          Keep triggers specific; always-on lore belongs in Plot.
        </p>
        <div className="editor-stat-row" aria-label="Story card counts">
          <span>{totalCards} total</span>
          <span>{activeCount} active</span>
          <span>{livingCount} living</span>
          {(searchLower || filtersActive) && <span>{visibleCount} shown</span>}
        </div>
      </div>
      <p className="muted editor-legacy-help" style={{ margin: 0 }}>
        Story Cards are <strong>triggered memory</strong> — they enter the model context when their title or trigger keys match
        the current input or recent story. Use them for characters, places, relationships, secrets, rules, and recurring facts
        that are only relevant some of the time. Keep triggers specific; broad keys cause card bleed.
        For always-on world lore that should load every turn regardless, use a <strong>World Block</strong>.
      </p>

      {onBuildStoryCardMemory && (
        <details className="panel">
          <summary>Draft a Story Card with AI</summary>
          <p className="muted">
            Describe what you want generated, choose how many recent messages should ground it, and the AI will draft a pending Memory Suggestion using Story Card best practices.
          </p>
          <div className="grid three">
            <Field label="Card focus">
              <select
                value={aiIntent}
                onChange={(event) => setAiIntent(event.target.value as StoryCardAIBuilderIntent)}
              >
                {CARD_BUILDER_INTENTS.map((intent) => (
                  <option key={intent.value} value={intent.value}>{intent.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Target card">
              <select value={aiTargetCardId} onChange={(event) => setAiTargetCardId(event.target.value)}>
                <option value="">Create new card</option>
                {adventure.storyCards.map((card) => (
                  <option key={card.id} value={card.id}>{card.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Memory mode">
              <select
                value={aiMemoryMode}
                onChange={(event) => {
                  const next = event.target.value as StoryCardModeChoice;
                  setAiMemoryMode(next);
                  if (next === "living") setAiAutoUpdate(true);
                  if (next === "historical") setAiAutoUpdate(false);
                }}
              >
                <option value="living">living - current evolving tracker</option>
                <option value="static">static - always-true reference</option>
                <option value="historical">historical - completed past event</option>
                <option value="auto">let AI choose</option>
              </select>
            </Field>
          </div>
          <div className="grid three">
            <Field label="Use last messages">
              <NumberInput
                value={aiRecentMessageCount}
                min={0}
                max={MAX_AI_RECENT_MESSAGE_COUNT}
                onChange={(recentMessageCount) => setAiRecentMessageCount(clampAiRecentMessageCount(recentMessageCount))}
              />
            </Field>
            <CheckboxField
              label="Let AI keep this card updated after relevant scenes"
              checked={aiAutoUpdate}
              disabled={aiMemoryMode === "historical"}
              onChange={setAiAutoUpdate}
            />
            <Field label="Auto-update cooldown">
              <NumberInput
                value={aiAutoUpdateCooldown}
                min={0}
                disabled={!aiAutoUpdate || aiMemoryMode === "historical"}
                onChange={setAiAutoUpdateCooldown}
              />
            </Field>
          </div>
          <Field label="Describe what to generate">
            <textarea
              rows={5}
              value={aiDescription}
              onChange={(event) => setAiDescription(event.target.value)}
              placeholder="Example: Generate a location card for Jinx's hideout from the recent scene, focusing on durable layout, sensory details, hazards, and trigger phrases."
            />
          </Field>
          <div className="toolbar">
            <button
              type="button"
              className="primary-action"
              disabled={loading || !aiDescription.trim()}
              onClick={() => void handleBuildStoryCardMemory()}
            >
              {loading ? "Drafting..." : "Draft Card Suggestion"}
            </button>
            <span className="muted">Nothing is added to active memory until you approve it.</span>
          </div>
        </details>
      )}

      <div className="editor-command-bar">
        <input
          type="search"
          placeholder="Search cards…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="editor-filter-strip" aria-label="Story card filters">
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
          <div className="sort-toggle" role="group" aria-label="Memory filter">
            <button
              type="button"
              className={memoryFilter === "all" ? "active" : ""}
              aria-pressed={memoryFilter === "all"}
              onClick={() => setMemoryFilter("all")}
            >
              Any
            </button>
            <button
              type="button"
              className={memoryFilter === "living" ? "active" : ""}
              aria-pressed={memoryFilter === "living"}
              onClick={() => setMemoryFilter("living")}
            >
              Living
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
            const card = makeStoryCard({ title: "New Story Card", content: "" });
            dispatch({ type: "UPSERT_STORY_CARD", storyCard: card });
            setNewCardId(card.id);
          }}
        >
          Create Story Card
        </button>
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

      {(onAuditStoryCards || onSuggestCardUpdates) && (
        <details className="panel editor-tools-panel story-card-maintenance-panel" open>
          <summary>Review and Maintain Cards</summary>
          <div className="story-card-maintenance-grid">
            {onAuditStoryCards && (
              <section className="story-card-tool-card story-card-tool-card-primary">
                <div className="story-card-tool-copy">
                  <h3>Clean up existing cards</h3>
                  <p className="muted">
                    Find broad triggers, stale current facts, misplaced history, duplicate cards, and profile details that should be split into living or historical cards.
                  </p>
                </div>
                <div className="story-card-tool-controls">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={loading || audit?.status === "running"}
                    onClick={runAudit}
                    title="Review existing cards and get cleanup suggestions: trigger fixes, profile splits, mode changes, edits, deletes, and new child cards."
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
            )}

            {onSuggestCardUpdates && (
              <section className="story-card-tool-card">
                <div className="story-card-tool-copy">
                  <h3>Suggest updates from recent play</h3>
                  <p className="muted">
                    Ask the AI to review recent story turns and draft Memory Suggestions for active cards. You still approve them before they become memory.
                  </p>
                </div>
                <div className="story-card-tool-controls">
                  <button
                    type="button"
                    disabled={loading || activeCards.length === 0}
                    onClick={onSuggestCardUpdates}
                    title="Ask the AI to review recent story turns and suggest updates to all active Story Cards. Results appear in Memory Suggestions."
                  >
                    {loading ? "Generating..." : "Suggest Card Updates"}
                  </button>
                </div>
              </section>
            )}
          </div>
        </details>
      )}

      <details className="panel editor-tools-panel story-card-automation-panel">
        <summary>Automatic Card Updates</summary>
        <div className="story-card-settings-grid">
          <Field label="System-wide auto-update cooldown">
            <span className="turn-window-field">
              <span>Update at most once every</span>
              <input
                type="number"
                min={0}
                value={adventure.semanticEvaluationSettings.storyCardCooldownTurns ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value));
                  dispatch({ type: "SET_SEMANTIC_EVALUATION_SETTINGS", settings: { ...adventure.semanticEvaluationSettings, storyCardCooldownTurns: v || undefined } });
                }}
                className="audit-turns-input"
              />
              <span>turns</span>
            </span>
          </Field>
          <CheckboxField
            label="Auto-update one card per semantic eval"
            checked={!!autoCard}
            onChange={(checked) => {
              if (!checked && autoCard) {
                dispatch({ type: "UPDATE_STORY_CARD", storyCardId: autoCard.id, patch: { autoUpdate: false } });
              } else if (checked && !autoCard && activeCards.length > 0) {
                dispatch({ type: "UPDATE_STORY_CARD", storyCardId: activeCards[0].id, patch: { autoUpdate: true } });
              }
            }}
          />
          <Field label="Card to auto-update">
            <select
              value={autoCard?.id ?? ""}
              disabled={!autoCard}
              onChange={(e) => {
                const newId = e.target.value;
                adventure.storyCards.forEach((c) => {
                  if (c.autoUpdate && c.id !== newId) {
                    dispatch({ type: "UPDATE_STORY_CARD", storyCardId: c.id, patch: { autoUpdate: false } });
                  }
                });
                if (newId) dispatch({ type: "UPDATE_STORY_CARD", storyCardId: newId, patch: { autoUpdate: true } });
              }}
            >
              {!autoCard && <option value="">none selected</option>}
              {activeCards.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </Field>
          {autoCard && (
            <Field label="Selected card cooldown">
              <NumberInput
                value={autoCard.autoUpdateCooldownTurns ?? 3}
                min={0}
                onChange={(autoUpdateCooldownTurns) =>
                  dispatch({ type: "UPDATE_STORY_CARD", storyCardId: autoCard.id, patch: { autoUpdateCooldownTurns } })
                }
              />
            </Field>
          )}
        </div>
      </details>

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

                {rec.action !== "delete" && rec.decision === "pending" && (
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
                      <label className="field">
                        <span>Memory mode</span>
                        <select
                          value={rec.suggestedMemoryMode}
                          onChange={(e) => updateRec(rec.id, { suggestedMemoryMode: e.target.value as StoryCardMemoryMode })}
                        >
                          {MEMORY_MODE_OPTIONS.map((mode) => (
                            <option key={mode} value={mode}>{mode}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                {rec.decision === "pending" && (
                  <div className="audit-rec-actions">
                    <button type="button" onClick={() => approveRec(rec)}>Approve</button>
                    <button type="button" className="danger" onClick={() => updateRec(rec.id, { decision: "rejected" })}>Reject</button>
                  </div>
                )}
              </div>
            ))}

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
                  <CardSummary card={card} query={searchLower} />
                </summary>

                <div className="editor-card item-inspector story-card-inspector">
                  <div className="panel-heading item-inspector-heading">
                    <div>
                      <p className="eyebrow">
                        {card.active ? "active" : "inactive"} · {TYPE_LABELS[card.type]} · {card.memoryMode ?? "static"}
                      </p>
                      <h3>{card.title || "Untitled Card"}</h3>
                      <div className="item-tag-row" aria-label="Story card triggers">
                        {card.keys.length === 0 && <span className="item-tag muted">Title trigger only</span>}
                        {card.keys.map((key) => (
                          <span key={key} className="item-tag">{key}</span>
                        ))}
                      </div>
                    </div>
                    <button type="button" className="danger" onClick={() => dispatch({ type: "DELETE_STORY_CARD", storyCardId: card.id })}>
                      Delete
                    </button>
                  </div>
                  <div className="grid three story-card-primary-fields">
                    <Field label="Title">
                      <input
                        value={card.title}
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { title: event.target.value } })}
                      />
                    </Field>
                    <Field label="Trigger Keys">
                      <input
                        value={commaList(card.keys)}
                        title="Comma-separated; leave blank to use title only."
                        placeholder="Blazer, Blonde Blazer"
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { keys: fromCommaList(event.target.value) } })}
                      />
                    </Field>
                    <Field label="Type">
                      <select
                        value={card.type}
                        onChange={(event) =>
                          dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { type: event.target.value as StoryCardType, ...(event.target.value === "event" ? { memoryMode: "historical", autoUpdate: false } : {}) } })
                        }
                      >
                        {Object.entries(TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <details className="brain-secondary-details item-secondary-details">
                    <summary>Trigger behavior</summary>
                  <Field label="Memory Mode">
                    <select
                      value={card.memoryMode ?? "static"}
                      disabled={card.type === "event"}
                      onChange={(event) =>
                        dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { memoryMode: event.target.value as StoryCard["memoryMode"] } })
                      }
                    >
                      <option value="static">static — always-true reference facts</option>
                      <option value="living">living — current evolving subject, updates merge/archive</option>
                      <option value="historical">historical — past event or completed arc record</option>
                    </select>
                  </Field>
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
                  </details>
                  <section className="item-focus-section">
                    <div className="item-section-heading">
                      <div>
                        <p className="eyebrow">compact memory</p>
                        <h4>Structured compact facts</h4>
                      </div>
                      {card.compactKind && <span className="badge badge-priority">{card.compactStatus ?? "active"}</span>}
                    </div>
                    <p className="muted">
                      When this card is included by a trigger, pin, Always policy, or manual force, these facts are sent
                      in Core, Current, Recent order. Kind and Status label that text; they do not trigger the card.
                      A one-time save migration or a Story Card memory update can sort text into these fields;
                      editing Content directly does not.
                    </p>
                    <div className="grid two">
                      <Field label="Compact Kind">
                        <select
                          value={card.compactKind ?? ""}
                          onChange={(event) => {
                            const value = event.target.value as StoryCardCompactKind | "";
                            dispatch({
                              type: "UPDATE_STORY_CARD",
                              storyCardId: card.id,
                              patch: value
                                ? { compactKind: value, compactStatus: card.compactStatus ?? "active", memoryMode: "living" }
                                : { compactKind: undefined, compactStatus: undefined },
                            });
                          }}
                        >
                          <option value="">none</option>
                          {COMPACT_KIND_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Compact Status">
                        <select
                          value={card.compactStatus ?? "active"}
                          onChange={(event) =>
                            dispatch({
                              type: "UPDATE_STORY_CARD",
                              storyCardId: card.id,
                              patch: { compactStatus: event.target.value as StoryCardCompactStatus },
                            })
                          }
                        >
                          {COMPACT_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Core Facts">
                      <textarea
                        rows={4}
                        value={factListText(card.coreFacts)}
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { coreFacts: factListFromText(event.target.value) } })}
                      />
                    </Field>
                    <Field label="Current Facts">
                      <textarea
                        rows={3}
                        value={factListText(card.currentFacts)}
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { currentFacts: factListFromText(event.target.value) } })}
                      />
                    </Field>
                    <Field label="Recent Developments">
                      <textarea
                        rows={3}
                        value={factListText(card.recentDevelopments)}
                        onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { recentDevelopments: factListFromText(event.target.value) } })}
                      />
                    </Field>
                    {card.sourceTurnIds?.length ? (
                      <Field label="Source Turns">
                        <input
                          value={card.sourceTurnIds.join(", ")}
                          onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { sourceTurnIds: fromCommaList(event.target.value) } })}
                        />
                      </Field>
                    ) : null}
                  </section>
                  <section className="item-focus-section">
                    <div className="item-section-heading">
                      <div>
                        <p className="eyebrow">content field</p>
                        <h4>{hasStructuredFacts(card) ? "Additional notes sent with structured facts" : "Card text sent when included"}</h4>
                      </div>
                      <span className="muted">{cardFactLines(card.content).length} line{cardFactLines(card.content).length === 1 ? "" : "s"}</span>
                    </div>
                  <p className="muted">
                    {hasStructuredFacts(card)
                      ? "The structured facts above are the main card text. Content is appended as Notes; an empty box here does not mean the card is empty."
                      : "With no structured facts, Content is the entire card text sent when this card is included."}
                  </p>
                  <Field label="Content">
                    <textarea
                      rows={6}
                      value={card.content}
                      onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { content: event.target.value } })}
                    />
                  </Field>
                  <details>
                    <summary>Preview assembled Story Card fields (before context budgeting)</summary>
                    <pre className="context-item-text">{storyCardContextContent(card) || "(empty card)"}</pre>
                  </details>
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
                      label="Pinned (included even without a trigger match)"
                      checked={card.pinned}
                      onChange={(checked) => dispatch({ type: checked ? "PIN_STORY_CARD" : "UNPIN_STORY_CARD", storyCardId: card.id })}
                    />
                  </div>
                  <div className="grid two">
                    <CheckboxField
                      label="Protected (cannot be dropped by token truncation)"
                      checked={card.protected}
                      onChange={(checked) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { protected: checked } })}
                    />
                    <Field label="Inclusion Policy">
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
                    </Field>
                  </div>
                  <Field label="State (runtime note visible to automation conditions)">
                    <input
                      value={card.state}
                      onChange={(event) => dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { state: event.target.value } })}
                    />
                  </Field>
                  <div className="row">
                    {card.type === "event" && (
                      <fieldset>
                        <legend>Event Memory recall and evidence</legend>
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
                    <button type="button" className="danger" onClick={() => dispatch({ type: "DELETE_STORY_CARD", storyCardId: card.id })}>
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
