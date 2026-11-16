import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderConfig, StoryCardType } from "../types/adventure";
import type { AdventurePageProps } from "./pageTypes";
import { planTriggerCleanup, runTriggerCleanup, triggerCleanupConfig, triggerCleanupSnapshot, type TriggerCleanupResult } from "../memory/storyCardTriggerCleanup";

export function StoryCardTriggerCleanup({ adventure, dispatch, providerConfig, loading }: AdventurePageProps & { providerConfig: ProviderConfig; loading?: boolean }) {
  const [scope, setScope] = useState<StoryCardType | "all">("all");
  const [results, setResults] = useState<TriggerCleanupResult[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [error, setError] = useState("");
  const run = useRef(0);
  const stop = useRef(false);
  useEffect(() => () => { run.current++; stop.current = true; }, [adventure.id]);
  const setup = useMemo(() => {
    try {
      const config = triggerCleanupConfig(adventure, providerConfig);
      const cards = adventure.storyCards.filter(card => scope === "all" || card.type === scope);
      return { config, cards, plan: planTriggerCleanup(cards, config) };
    } catch { return undefined; }
  }, [adventure, providerConfig, scope]);
  async function start() {
    if (!setup || running) return;
    const job = ++run.current;
    stop.current = false;
    setRunning(true); setCompleted(0); setTotalBatches(setup.plan.batches.length); setError(""); setDecisions({}); setResults(setup.plan.skipped);
    try {
      await runTriggerCleanup(setup.plan, setup.config, (batch, count) => {
        if (run.current === job) { setResults(previous => [...previous, ...batch]); setCompleted(count); }
      }, () => run.current === job && !stop.current);
    } catch { if (run.current === job) setError("Cleanup failed. Existing triggers are unchanged."); }
    finally { if (run.current === job) setRunning(false); }
  }
  function apply(result: TriggerCleanupResult) {
    const card = adventure.storyCards.find(card => card.id === result.cardId);
    if (!card || triggerCleanupSnapshot(card) !== result.original) {
      setDecisions(previous => ({ ...previous, [result.cardId]: "Card changed or was removed. Run cleanup again before applying." }));
      return;
    }
    if (!result.keys || result.error) return;
    dispatch({ type: "UPDATE_STORY_CARD", storyCardId: card.id, patch: { keys: result.keys } });
    setDecisions(previous => ({ ...previous, [card.id]: "Applied" }));
  }
  return <details className="panel editor-tools-panel" open>
    <summary>Clean up trigger phrases with AI</summary>
    <p>The title already triggers recall. Review natural alternate names and memorable event references without changing card content. Custom includes factions and organizations.</p>
    <label>Cards to review <select aria-label="Trigger cleanup category" value={scope} disabled={running} onChange={event => setScope(event.target.value as typeof scope)}>
      <option value="all">All Story Cards</option><option value="character">Character</option><option value="location">Location</option><option value="lore">Lore</option><option value="custom">Custom (including factions)</option>
    </select></label>
    {setup ? <p className="muted">{setup.cards.length} cards selected; {setup.plan.batches.length} sequential AI requests; approximately {setup.plan.estimatedInputTokens.toLocaleString()} input tokens, plus output. Uses the background provider when configured. {setup.plan.skipped.length} cards require manual review. Full card text is sent; none is truncated.</p>
      : <p role="alert">Correct the background provider settings before running cleanup.</p>}
    <button type="button" disabled={loading || running || !setup?.cards.length} onClick={() => void start()}>{running ? "Cleaning trigger phrases..." : "Preview Trigger Cleanup"}</button>
    {running && <button type="button" onClick={() => { stop.current = true; }}>Stop after current request</button>}
    <p role="status">{completed > 0 || running ? `${completed} batches completed. ` : ""}{results.length > 0 ? `${results.length} card results available.` : ""}{!running && completed > 0 && completed < totalBatches ? "Stopped before all batches completed. Unprocessed cards are unchanged." : ""}</p>
    {error && <p role="alert">{error}</p>}
    {results.map(result => <article className="panel" key={result.cardId}>
      <h3>{result.title}</h3>
      {result.error ? <p role="alert">{result.error}</p> : <>
        <p><strong>Existing:</strong> {result.oldKeys.join(", ") || "Title only"}</p>
        <p><strong>Proposed:</strong> {result.keys?.join(", ") || "Title only"}</p>
        <p>{result.reason}</p>
        {result.splitNote && <p><strong>Possible separate event (review only):</strong> {result.splitNote}</p>}
        {decisions[result.cardId] ? <p>{decisions[result.cardId]}</p> : JSON.stringify(result.keys) === JSON.stringify(result.oldKeys) ? <p>No change needed.</p> : <>
          <button type="button" onClick={() => apply(result)}>Apply triggers for {result.title}</button>
          <button type="button" onClick={() => setDecisions(previous => ({ ...previous, [result.cardId]: "Rejected" }))}>Reject triggers for {result.title}</button>
        </>}
      </>}
    </article>)}
  </details>;
}
