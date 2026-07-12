import { useMemo, useState } from "react";
import { AdventureThumbnailFrame } from "../components/AdventureThumbnail";
import { buildContext } from "../contextBuilder/contextBuilder";
import { getAdventureThumbnail } from "../utils/adventureImages";
import type { PlayRuntimeProps } from "./pageTypes";

function scenePreview(adventure: PlayRuntimeProps["adventure"]): string {
  const latestAssistant = [...adventure.messages].reverse().find((message) => message.role === "assistant");
  return latestAssistant?.content || adventure.openingScene || "No scene text yet.";
}

function previewText(text: string, maxLength = 900): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

export function DashboardPage({
  adventure,
  dispatch,
  contextResult,
  saveStatus,
  onBuildContext,
  onOpenContext,
  onOpenTab,
  onPullLatest,
}: PlayRuntimeProps) {
  const [pulling, setPulling] = useState(false);

  async function handlePull() {
    if (!onPullLatest) return;
    setPulling(true);
    try { await onPullLatest(); } finally { setPulling(false); }
  }
  const computedContext = useMemo(() => contextResult ?? buildContext(adventure), [adventure, contextResult]);
  const pendingProposals = adventure.activeState.memoryProposals.filter((proposal) => proposal.status === "pending");
  const activeCards = adventure.storyCards.filter((card) => card.active);
  const activeCharacters = adventure.brains.filter((brain) => brain.active);
  const thumbnail = getAdventureThumbnail(adventure);

  return (
    <section className="page adventure-detail-page">
      <article className="adventure-hero-card">
        <AdventureThumbnailFrame thumbnail={thumbnail} title={adventure.title} className="adventure-cover" />
        <div className="adventure-hero-body">
          <div>
            <p className="eyebrow">Current Adventure</p>
            <h2>{adventure.title}</h2>
            <p className="muted">
              Turn {adventure.activeState.turn} · {saveStatus}
            </p>
          </div>
          <div className="adventure-hero-actions">
            <button type="button" className="primary-action" onClick={() => onOpenTab?.("play")}>
              Continue
            </button>
            {onPullLatest && (
              <button type="button" disabled={pulling} onClick={handlePull}>
                {pulling ? "Updating…" : "Update"}
              </button>
            )}
            <button type="button" onClick={() => onOpenTab?.("edit")}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                onBuildContext();
                onOpenContext();
              }}
            >
              Inspect
            </button>
          </div>
        </div>
      </article>

      <div className="adventure-detail-grid">
        <article className="adventure-prose-panel">
          <p className="eyebrow">Latest Scene</p>
          <p>{previewText(scenePreview(adventure))}</p>
        </article>

        <aside className="adventure-stats-panel">
          <div className="adventure-stat">
            <span>Story Cards</span>
            <strong>{activeCards.length}</strong>
          </div>
          <div className="adventure-stat">
            <span>Characters</span>
            <strong>{activeCharacters.length}</strong>
          </div>
          <div className="adventure-stat">
            <span>Context</span>
            <strong>{computedContext.totalEstimatedTokens} tokens</strong>
          </div>
          <div className="adventure-stat">
            <span>Memory</span>
            <strong>{pendingProposals.length} pending</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}
