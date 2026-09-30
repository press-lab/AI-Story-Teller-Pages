import { Fragment, useEffect, useState } from "react";
import { buildContext } from "../contextBuilder/contextBuilder";
import { runCondenseContent, runContextDedup, type DedupInputItem, type DedupProposal } from "../ai/contextAI";
import { dedupeTextLines, normalizeCleanupText } from "../memory/deterministicCleanup";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { AdventurePageProps } from "./pageTypes";
import type { ContextBuildResult, ContextItem, ContextSection, ProviderConfig, StoryCard } from "../types/adventure";
import { CheckboxField } from "./shared";

interface DuplicateWarning {
  a: ContextItem;
  b: ContextItem;
  overlap: number;
}

function detectDuplicateContent(sections: ContextSection[]): DuplicateWarning[] {
  const items = sections.flatMap((s) =>
    s.items.filter((entry) => entry.content.trim().length > 80 && entry.sourceType !== "system"),
  );
  const warnings: DuplicateWarning[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const wordsA = new Set(items[i].content.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
      const wordsB = new Set(items[j].content.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
      if (wordsA.size < 10 || wordsB.size < 10) continue;
      const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
      const overlap = intersection / Math.min(wordsA.size, wordsB.size);
      if (overlap > 0.5) warnings.push({ a: items[i], b: items[j], overlap });
    }
  }
  return warnings;
}

function canCondense(sourceType: ContextItem["sourceType"]): boolean {
  return sourceType === "storyCard" || sourceType === "component" || sourceType === "summary";
}

function contextItemKeepScore(item: ContextItem): number {
  return item.priority +
    (item.protected ? 100 : 0) +
    (item.pinned ? 40 : 0) +
    (item.sourceType === "storyCard" ? 30 : 0) +
    Math.min(item.tokenEstimate, 100) / 100;
}

function removeLinesAlreadyCovered(trimContent: string, keepContent: string): string {
  const keepLines = new Set(
    keepContent
      .split(/\r?\n/)
      .map((line) => normalizeCleanupText(line))
      .filter(Boolean),
  );
  const kept = trimContent
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = normalizeCleanupText(line);
      return !normalized || !keepLines.has(normalized);
    })
    .join("\n")
    .trim();
  return dedupeTextLines(kept).text;
}

function deterministicDedupProposals(warnings: DuplicateWarning[]): DedupProposal[] {
  const usedTrimIds = new Set<string>();
  const proposals: DedupProposal[] = [];

  for (const warning of warnings) {
    const [keep, trim] = contextItemKeepScore(warning.a) >= contextItemKeepScore(warning.b)
      ? [warning.a, warning.b]
      : [warning.b, warning.a];
    if (usedTrimIds.has(trim.id) || !canCondense(trim.sourceType)) continue;
    usedTrimIds.add(trim.id);

    const normalizedKeep = normalizeCleanupText(keep.content);
    const normalizedTrim = normalizeCleanupText(trim.content);
    const exactDuplicate = normalizedKeep.length > 0 && normalizedKeep === normalizedTrim;
    const canDeleteTrim = trim.sourceType === "component" || trim.sourceType === "storyCard";
    const suggestedContent = exactDuplicate ? "" : removeLinesAlreadyCovered(trim.content, keep.content);
    const changed = (exactDuplicate && canDeleteTrim) || suggestedContent !== trim.content.trim();

    proposals.push({
      id: `det-dedup-${trim.id}-${keep.id}`,
      source: "deterministic",
      description: changed
        ? `${Math.round(warning.overlap * 100)}% overlap found by local word matching; keep the higher-priority item and trim duplicated lines from the other.`
        : `${Math.round(warning.overlap * 100)}% overlap found by local word matching; no exact duplicate lines were safe to trim automatically.`,
      keepItemId: keep.id,
      keepItemTitle: keep.title,
      trimItemId: trim.id,
      trimItemTitle: trim.title,
      trimItemSourceType: trim.sourceType,
      suggestedContent,
      isConflict: !changed,
    });
  }

  return proposals;
}

function storyCardCondensePatch(card: StoryCard | undefined, content: string): Partial<StoryCard> {
  const patch: Partial<StoryCard> = { content };
  const hasStructuredContext =
    (card?.coreFacts?.length ?? 0) > 0 ||
    (card?.currentFacts?.length ?? 0) > 0 ||
    (card?.recentDevelopments?.length ?? 0) > 0;
  if (hasStructuredContext) {
    patch.coreFacts = [];
    patch.currentFacts = [];
    patch.recentDevelopments = [];
  }
  return patch;
}

function sectionShortLabel(sectionId: string): string {
  const map: Record<string, string> = {
    system: "System",
    aiInstructions: "AI Rules",
    plotEssentials: "Plot",
    authorNote: "Author",
    generalComponents: "Blocks",
    storyCards: "Cards",
    brains: "Chars",
    questState: "Quests",
    rollingSummary: "Summary",
    sceneState: "Scene",
    nextTurnNote: "Bias",
    recentMessages: "Messages",
  };
  return map[sectionId] ?? sectionId;
}

type CondensePhase = "idle" | "loading" | "ready" | "error";

interface CondenseEntry {
  phase: CondensePhase;
  draft?: string;
  editing?: boolean;
  editValue?: string;
  error?: string;
}

interface ContextPreviewPageProps extends AdventurePageProps {
  contextResult?: ContextBuildResult;
  onBuildContext: () => void;
  providerConfig?: ProviderConfig;
}

export function ContextPreviewPage({ adventure, dispatch, contextResult, onBuildContext, providerConfig }: ContextPreviewPageProps) {
  const [preferLivePreview, setPreferLivePreview] = useState(false);
  const result = preferLivePreview ? buildContext(adventure) : (contextResult ?? buildContext(adventure));
  const duplicates = detectDuplicateContent(result.sections);

  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [condenseMap, setCondenseMap] = useState<Record<string, CondenseEntry>>({});
  const [dedupProposals, setDedupProposals] = useState<DedupProposal[]>([]);
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupError, setDedupError] = useState<string | undefined>();
  const [dedupIncludeAI, setDedupIncludeAI] = useState(false);

  const messagesWithUsage = adventure.messages.filter((m) => m.usage != null);
  const totalActualIn = messagesWithUsage.reduce((sum, m) => sum + (m.usage?.promptTokens ?? 0), 0);
  const totalActualOut = messagesWithUsage.reduce((sum, m) => sum + (m.usage?.completionTokens ?? 0), 0);
  const totalCacheRead = messagesWithUsage.reduce((sum, m) => sum + (m.usage?.cacheReadTokens ?? 0), 0);
  const totalCacheWrite = messagesWithUsage.reduce((sum, m) => sum + (m.usage?.cacheCreationTokens ?? 0), 0);
  const hasActualUsage = messagesWithUsage.length > 0;
  const lastSentTokens = [...messagesWithUsage].reverse()[0]?.usage?.promptTokens;
  const avgSentTokens = hasActualUsage ? Math.round(totalActualIn / messagesWithUsage.length) : undefined;

  const bgUsage = adventure.activeState?.backgroundTokenUsage;
  const bgIn = bgUsage?.promptTokens ?? 0;
  const bgOut = bgUsage?.completionTokens ?? 0;
  const hasBgUsage = bgIn > 0 || bgOut > 0;

  const nonEmptySections = result.sections.filter((s) => s.items.length > 0);
  const allItems = result.sections.flatMap((s) => s.items);

  useEffect(() => {
    setPreferLivePreview(false);
  }, [adventure.id]);

  function patchCondense(itemId: string, patch: Partial<CondenseEntry>) {
    setCondenseMap((m) => ({ ...m, [itemId]: { ...{ phase: "idle" as const }, ...m[itemId], ...patch } }));
  }

  async function condenseItem(item: ContextItem) {
    if (!providerConfig) return;
    patchCondense(item.id, { phase: "loading" });
    setExpandedId(item.id);
    try {
      const draft = await runCondenseContent(item.title, item.content, providerConfig);
      patchCondense(item.id, { phase: "ready", draft, editing: false, editValue: draft });
    } catch (err) {
      patchCondense(item.id, { phase: "error", error: err instanceof Error ? err.message : "Condense failed." });
    }
  }

  function deleteItem(item: ContextItem) {
    if (item.sourceType === "component") dispatch({ type: "DELETE_COMPONENT", componentId: item.id });
    else if (item.sourceType === "storyCard") dispatch({ type: "DELETE_STORY_CARD", storyCardId: item.id });
  }

  function applyCondenseToItem(item: ContextItem, content: string) {
    switch (item.sourceType) {
      case "storyCard":
        dispatch({
          type: "UPDATE_STORY_CARD",
          storyCardId: item.id,
          patch: storyCardCondensePatch(adventure.storyCards.find((card) => card.id === item.id), content),
        });
        break;
      case "component":
        dispatch({ type: "UPDATE_COMPONENT", componentId: item.id, patch: { content } });
        break;
      case "summary":
        dispatch({ type: "UPDATE_ROLLING_SUMMARY", content });
        break;
    }
    setPreferLivePreview(true);
    patchCondense(item.id, { phase: "idle", draft: undefined, editValue: undefined });
    setExpandedId(undefined);
  }

  async function runDedup() {
    setDedupLoading(true);
    setDedupError(undefined);
    try {
      const items: DedupInputItem[] = result.sections.flatMap((s) =>
        s.items
          .filter((item) => item.content.trim().length > 80 && canCondense(item.sourceType))
          .map((item) => ({
            id: item.id,
            sourceType: item.sourceType,
            title: item.title,
            content: item.content,
            priority: item.priority,
            isStoryCard: item.sourceType === "storyCard",
          })),
      );
      const proposals = dedupIncludeAI && providerConfig
        ? await runContextDedup(items, providerConfig)
        : deterministicDedupProposals(duplicates);
      setDedupProposals(proposals);
      if (proposals.length === 0) {
        setDedupError(dedupIncludeAI ? "No significant duplicates found." : "No deterministic duplicates found.");
      }
    } catch (err) {
      setDedupError(err instanceof Error ? err.message : "Dedup analysis failed.");
    } finally {
      setDedupLoading(false);
    }
  }

  function applyDedupProposal(proposal: DedupProposal) {
    if (proposal.isConflict) return;
    const trimItem = allItems.find((item) => item.id === proposal.trimItemId);
    if (!trimItem) return;
    if (proposal.suggestedContent) applyCondenseToItem(trimItem, proposal.suggestedContent);
    else deleteItem(trimItem);
    setDedupProposals((prev) => prev.filter((p) => p.id !== proposal.id));
  }

  function dismissProposal(proposalId: string) {
    setDedupProposals((prev) => prev.filter((p) => p.id !== proposalId));
  }

  return (
    <section className="page editor-surface context-preview-page">
      <div className="editor-page-summary">
        <p className="muted">
          Everything the model sees each turn. Click a row to inspect content, condense bulky items, or review excluded context.
        </p>
        <div className="editor-stat-row" aria-label="Context preview counts">
          <span>{result.totalEstimatedTokens.toLocaleString()} est tokens</span>
          <span>{nonEmptySections.length} sections</span>
          <span>{allItems.length} items</span>
          {duplicates.length > 0 && <span>{duplicates.length} duplicates</span>}
        </div>
      </div>

      <div className="editor-command-bar context-preview-toolbar">
        <button
          type="button"
          onClick={() => {
            setPreferLivePreview(false);
            onBuildContext();
          }}
        >
          Rebuild Preview
        </button>
        <button type="button" onClick={() => void runDedup()} disabled={dedupLoading}>
          {dedupLoading ? "Analyzing…" : "Auto Dedup"}
        </button>
        <CheckboxField
          label="Include AI semantic pass"
          checked={dedupIncludeAI}
          disabled={!providerConfig}
          onChange={setDedupIncludeAI}
        />
        <span className="muted token-metrics">
          <span title="Estimated tokens in current context">{result.totalEstimatedTokens.toLocaleString()} est</span>
          <span className="token-metrics-sep">·</span>
          <span title="Total prompt tokens sent to story model across all turns">story {hasActualUsage ? `${totalActualIn.toLocaleString()}↑ ${totalActualOut.toLocaleString()}↓` : "—"}</span>
          <span className="token-metrics-sep">·</span>
          <span title="Prompt tokens sent on the last story turn">last {lastSentTokens != null ? lastSentTokens.toLocaleString() : "—"}</span>
          <span className="token-metrics-sep">·</span>
          <span title="Average prompt tokens per story turn">avg {avgSentTokens != null ? avgSentTokens.toLocaleString() : "—"}</span>
          <span className="token-metrics-sep">·</span>
          <span title="Total tokens used by background AI calls (brain updates, story card updates, plot updates, triggers)">bg {hasBgUsage ? `${bgIn.toLocaleString()}↑ ${bgOut.toLocaleString()}↓` : "—"}</span>
          <span className="token-metrics-sep">·</span>
          <span title="Prompt-cache tokens reported by the provider across story turns">cache {totalCacheRead > 0 || totalCacheWrite > 0 ? `${totalCacheRead.toLocaleString()} read ${totalCacheWrite.toLocaleString()} write` : "—"}</span>
        </span>
        {dedupError && (
          <span className="context-inline-error">
            {dedupError}
            <button type="button" className="error-dismiss" onClick={() => setDedupError(undefined)}>×</button>
          </span>
        )}
      </div>

      {/* AI dedup proposals */}
      {dedupProposals.length > 0 && (
        <div className="dedup-proposals">
          <h4 style={{ margin: "0 0 0.5rem" }}>Dedup Proposals ({dedupProposals.length})</h4>
          {dedupProposals.map((proposal) => (
            <div key={proposal.id} className={`dedup-proposal${proposal.isConflict ? " conflict" : ""}`}>
              <div className="dedup-proposal-header">
                <strong>{proposal.trimItemTitle}</strong>
                <span className="muted"> overlaps </span>
                <strong>{proposal.keepItemTitle}</strong>
                <span className="badge badge-priority" style={{ marginLeft: "0.4rem" }}>
                  {proposal.source === "llm" ? "AI" : "DETECTED"}
                </span>
                {proposal.isConflict && <span className="badge badge-warning" style={{ marginLeft: "0.4rem" }}>Conflict — manual review</span>}
              </div>
              <p className="muted" style={{ margin: "0.2rem 0 0.4rem" }}>{proposal.description}</p>
              {proposal.suggestedContent && !proposal.isConflict && (
                <details>
                  <summary className="muted" style={{ fontSize: "0.8rem" }}>Preview trimmed version</summary>
                  <pre className="dedup-preview">{proposal.suggestedContent}</pre>
                </details>
              )}
              <div className="toolbar">
                {!proposal.isConflict && (
                  <button type="button" className="primary-action" onClick={() => applyDedupProposal(proposal)}>
                    {proposal.suggestedContent ? "Apply Trim" : "Delete Duplicate"}
                  </button>
                )}
                <button type="button" onClick={() => dismissProposal(proposal.id)}>Skip</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Word-overlap warnings when no AI proposals yet */}
      {duplicates.length > 0 && dedupProposals.length === 0 && (
        <details className="panel duplicate-warnings">
          <summary>Duplicate Content Warnings ({duplicates.length})</summary>
          <p className="muted" style={{ margin: "0.25rem 0" }}>
            These items share &gt;50% word overlap. Run <strong>Auto Dedup</strong> for reviewable fixes.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
            {duplicates.map(({ a, b, overlap }, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span><strong>{a.title}</strong> ↔ <strong>{b.title}</strong> <span className="muted">— {Math.round(overlap * 100)}%</span></span>
                {(a.sourceType === "component" || a.sourceType === "storyCard") && (
                  <button type="button" className="danger" style={{ fontSize: "0.75rem", padding: "0.1rem 0.5rem" }}
                    onClick={() => deleteItem(a)}>
                    Delete "{a.title}"
                  </button>
                )}
                {(b.sourceType === "component" || b.sourceType === "storyCard") && (
                  <button type="button" className="danger" style={{ fontSize: "0.75rem", padding: "0.1rem 0.5rem" }}
                    onClick={() => deleteItem(b)}>
                    Delete "{b.title}"
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Main context table */}
      <div className="context-table-wrap">
        <table className="context-table">
          <thead>
            <tr>
              <th className="col-section">Section</th>
              <th className="col-title">Item</th>
              <th className="col-tokens">Tokens</th>
              <th className="col-priority">Pri</th>
              <th className="col-flags">Flags</th>
              <th className="col-policy">Policy</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {nonEmptySections.map((section) => (
              <Fragment key={section.id}>
                <tr className="context-section-row">
                  <td colSpan={7}>
                    <strong>{section.label}</strong>
                    <span className="muted"> — {section.tokenEstimate} tokens · {section.items.length} items</span>
                  </td>
                </tr>
                {section.items.map((item) => {
                  const condense = condenseMap[item.id];
                  const isExpanded = expandedId === item.id;
                  const condenseDraft = condense?.editValue ?? condense?.draft ?? "";
                  return (
                    <Fragment key={item.id}>
                      <tr
                        className={`context-item-row${isExpanded ? " expanded" : ""}`}
                        onClick={() => setExpandedId(isExpanded ? undefined : item.id)}
                      >
                        <td className="col-section muted">{sectionShortLabel(section.id)}</td>
                        <td className="col-title">{item.title}</td>
                        <td className="col-tokens">{item.tokenEstimate}</td>
                        <td className="col-priority">{item.priority > 0 ? item.priority : ""}</td>
                        <td className="col-flags">
                          {item.protected && <span title="Protected">🔒</span>}
                          {item.pinned && <span title="Pinned">📌</span>}
                        </td>
                        <td className="col-policy">{item.inclusionPolicy !== "always" ? item.inclusionPolicy : ""}</td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          {providerConfig && canCondense(item.sourceType) && (
                            <button
                              type="button"
                              className="context-action-btn"
                              disabled={condense?.phase === "loading"}
                              onClick={() => void condenseItem(item)}
                            >
                              {condense?.phase === "loading" ? "…" : "Condense"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="context-expanded-row">
                          <td colSpan={7}>
                            <div className="context-expanded-inner">
                              <div className="context-item-meta muted">
                                {item.sourceType} · generated by {item.generatedBy} · {item.tokenEstimate} tokens
                              </div>
                              <pre className="context-item-text">{item.content}</pre>

                              {condense?.phase === "error" && (
                                <p className="context-inline-error">{condense.error}</p>
                              )}

                              {condense?.phase === "ready" && (
                                <div className="condense-panel">
                                  <div className="condense-panel-header">
                                    <strong>AI Draft</strong>
                                    <span className="muted">
                                      {" "}— {approximateTokenCount(condenseDraft)} tokens
                                      (was {item.tokenEstimate})
                                    </span>
                                  </div>
                                  {condense.editing ? (
                                    <textarea
                                      rows={6}
                                      value={condenseDraft}
                                      onChange={(e) => patchCondense(item.id, { editValue: e.target.value })}
                                    />
                                  ) : (
                                    <pre className="condense-draft">{condense.draft}</pre>
                                  )}
                                  <div className="toolbar">
                                    <button type="button" onClick={() => patchCondense(item.id, { phase: "idle" })}>
                                      Keep Current
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => patchCondense(item.id, { editing: !condense.editing })}
                                    >
                                      {condense.editing ? "Preview" : "Edit Draft"}
                                    </button>
                                    <button
                                      type="button"
                                      className="primary-action"
                                      onClick={() => applyCondenseToItem(item, condenseDraft)}
                                    >
                                      Accept Draft
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Excluded items */}
      {result.excludedItems.length > 0 && (
        <details className="panel">
          <summary>Excluded Items ({result.excludedItems.length})</summary>
          <table className="context-table" style={{ marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Reason</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {result.excludedItems.map((item) => (
                <tr key={item.id} className="context-item-row excluded">
                  <td>{item.title}</td>
                  <td>{item.sourceType}</td>
                  <td>{item.reason.replace(/_/g, " ")}</td>
                  <td className="muted">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* Pending memory proposals */}
      {result.pendingProposals.length > 0 && (
        <details className="panel">
          <summary>
            Memory Proposals / Pending Updates · {result.pendingProposals.length} pending
            {" "}(not in model context — review in Memory Suggestions)
          </summary>
          {result.pendingProposals.map((proposal) => (
            <details key={proposal.id} style={{ marginLeft: "1rem" }}>
              <summary>
                [{proposal.proposedType}] {proposal.title} — {Math.round(proposal.confidence * 100)}%
              </summary>
              <p><strong>Rationale:</strong> {proposal.rationale}</p>
              <pre>{proposal.content}</pre>
              {proposal.suggestedTriggers.length > 0 && (
                <p><strong>Triggers:</strong> {proposal.suggestedTriggers.join(", ")}</p>
              )}
            </details>
          ))}
        </details>
      )}

      {/* Raw provider payload */}
      <details className="panel">
        <summary>Provider Payload Preview</summary>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          The exact JSON sent to the model. The system message holds the stable sections (cached prefix);
          recent messages follow, and the per-turn sections lead the newest user message as a [TURN CONTEXT] block.
        </p>
        <pre>{JSON.stringify(result.messages, null, 2)}</pre>
      </details>

      {/* Context decisions log */}
      {result.decisions.length > 0 && (
        <details className="panel">
          <summary>Context Decisions ({result.decisions.length})</summary>
          <pre>{JSON.stringify(result.decisions, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
