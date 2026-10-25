import { backgroundProviderConfigIssue } from "../providers/backgroundProvider";
import { useState } from "react";
import type { Adventure, MemoryDiagnostic } from "../types/adventure";

const labels: Record<string, string> = {
  discovery_summary: "Discovery outcomes", candidate_awaiting_retry: "Candidate awaiting validation retry",
  checkpoint_invalidated: "Saved discovery drafts invalidated",
  proposal_approved: "Suggestion approved", proposal_rejected: "Suggestion rejected", proposal_ignored: "Suggestion ignored",
  not_attempted: "No memory evaluation attempted", instruction_omitted: "Memory instruction omitted",
  envelope_missing: "Memory envelope missing", envelope_malformed: "Memory envelope malformed",
  draft_discarded: "Memory evaluation discarded after narrative rewrite",
  zero_candidates: "Model returned zero memory candidates.", candidates_produced: "Candidates produced",
  validation_accepted: "Candidate accepted by validation", validation_rejected: "Candidate rejected by validation",
  candidate_suppressed: "Candidate suppressed", candidate_merged: "Candidate merged",
  proposal_accepted: "Suggestion queued", automatically_approved: "Automatically approved memory",
  recovery_validated: "Recovery source passed validation (commit tracked separately)", recovery_attempted: "Recovery attempted", recovery_queued: "Recovery queued", recovery_completed: "Recovery completed", recovery_failed: "Recovery failed",
  evaluation_queued: "Independent evaluation queued", evaluation_started: "Independent evaluation started",
  evaluation_completed: "Evaluation group completed", evaluation_failed: "Evaluation group failed", evaluation_stale: "Evaluation discarded after an edit",
};
const label = (outcome: string) => labels[outcome] ?? outcome;
function explanation(reason?: string) {
  if (reason && /evidence is not|quote must come|exact evidence quote/i.test(reason)) return "Rejected: the supplied evidence quote does not appear in the permitted source messages.";
  if (reason?.startsWith("source_attribution_invalid")) return "Rejected: this source transaction contains invalid source references or an update without a target Story Card ID.";
  return reason;
}

export function MemoryDecisionsPage({ adventure, onSuggestions, onEvaluateMemory, loading }: { adventure: Adventure; onSuggestions: (title?: string) => void; onEvaluateMemory?: (sourceIds: string[]) => Promise<void>; loading?: boolean }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const diagnostics = adventure.activeState.memoryDiagnostics ?? [];
  const turns = adventure.messages.map((message, index) => ({ message, position: index + 1 }))
    .filter(({ message }) => message.role === "assistant").reverse();
  const records = (id: string) => diagnostics.filter(entry => entry.sourceId === id);
  const pending = adventure.messages.filter(m => m.memoryRecovery?.status === "pending").length;
  const quarantined = adventure.messages.filter(m => m.memoryRecovery?.status === "quarantined").length;
  const missing = diagnostics.filter(d => d.outcome === "envelope_missing").length;
  const rejected = diagnostics.filter(d => d.outcome === "validation_rejected").length;
  const proposals = adventure.activeState.memoryProposals;
  const visible = turns.filter(({ message, position }) => {
    const entries = records(message.id);
    const linked = proposals.filter(p => p.sourceTurnId === message.id || entries.some(e => e.proposalId === p.id));
    const recovery = message.memoryRecovery;
    const matches = filter === "all" || filter === "missing" && !linked.length && !entries.some(e => e.outcome === "automatically_approved")
      || filter === "rejected" && entries.some(d => d.outcome === "validation_rejected")
      || filter === "pending" && (recovery?.status === "pending" || ["pending", "running"].includes(message.memoryEvaluation?.status ?? ""))
      || filter === "failed" && (Boolean(recovery?.failures || recovery?.status === "quarantined") || ["failed", "quarantined"].includes(message.memoryEvaluation?.status ?? ""))
      || filter === "completed" && (message.memoryEvaluation?.status === "complete" || recovery?.status === "complete" || !recovery
        && entries.some(d => d.stage === "inline" && ["zero_candidates", "candidates_produced"].includes(d.outcome))
        && !entries.some(d => d.outcome === "validation_rejected"));
    return matches && `${position} ${message.id} ${message.content} ${entries.map(e => JSON.stringify(e.candidate)).join(" ")} ${linked.map(p => p.title).join(" ")}`.toLowerCase().includes(search.toLowerCase());
  }).slice(0, 100);
  return <section className="page editor-surface" aria-label="Memory decisions" style={{ overflowWrap: "anywhere", minWidth: 0 }}>
    <h2>Memory decisions</h2>
    {backgroundProviderConfigIssue(adventure) && <p role="alert">{backgroundProviderConfigIssue(adventure)}</p>}
    <p>Observed pipeline decisions. Zero candidates does not explain what the model considered important. Diagnostics retain the latest 600 events; older stages may be unavailable.</p>
    <p aria-label="Decision counts">{pending} pending recovery · {quarantined} quarantined recovery · {missing} missing envelopes · {rejected} recent rejected candidates · {proposals.filter(p => p.status === "pending").length} pending proposals</p>
    <div className="editor-stat-row">
      <label>Filter <select value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All turns</option><option value="missing">Missing suggestions</option>
        <option value="rejected">Rejected candidates</option><option value="pending">Recovery pending</option>
        <option value="failed">Recovery failed</option><option value="completed">Completed</option>
      </select></label>
      <label>Search decisions <input value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: "100%" }} /></label>
    </div>
    <p className="muted">Newest first. Showing up to 100 matching narrator messages. Counts use retained diagnostics and current persisted recovery/proposal state.</p>
    {!visible.length && <p>No matching turns.</p>}
    {visible.map(({ message, position }) => {
      const entries = records(message.id);
      const inline = entries.find(d => d.stage === "inline");
      const candidates = entries.filter(d => d.stage === "candidate");
      const summaries = entries.filter(entry => entry.outcome === "discovery_summary" && entry.counts);
      const checkpoint = message.memoryEvaluation?.discoveryCheckpoint;
      const latestCounts = summaries.at(-1)?.counts;
      const linked = proposals.filter(p => p.sourceTurnId === message.id || entries.some(e => e.proposalId === p.id));
      const logs = adventure.activeState.evaluationLog.filter(e => e.actionsExecuted.includes(`Memory source: ${message.id}`));
      const recovery = message.memoryRecovery;
      return <details key={message.id} style={{ borderBottom: "1px solid var(--border-color, #888)", padding: "0.75rem 0" }}>
        <summary>Message {position} · {message.memoryEvaluation ? `Independent evaluation ${message.memoryEvaluation.status}` : inline ? label(inline.outcome) : "Diagnostics unavailable for older turns"} · {latestCounts ? `${latestCounts.returned} returned / ${latestCounts.accepted} accepted drafts / ${latestCounts.rejected} rejected / ${latestCounts.suppressed} suppressed / ${latestCounts.retryPending} awaiting retry` : `${candidates.length} candidate diagnostic records (candidate count unavailable)`} · recovery {recovery?.status ?? "not recorded"} · {linked.length} suggestions</summary>
        <p><strong>Source:</strong> {message.id} · <time>{message.createdAt}</time></p>
        <p>{message.content.slice(0, 240)}{message.content.length > 240 ? "…" : ""}</p>
        <h3>Independent evaluation</h3>
        <p>Status: {message.memoryEvaluation?.status ?? "not recorded; older sources are evaluated only on request"}. Attempts: {message.memoryEvaluation?.attempts ?? 0}. Completed groups: {message.memoryEvaluation?.completedGroups.join(", ") || "none"}.</p>
        {message.memoryEvaluation?.lastError && <p>{message.memoryEvaluation.lastError}</p>}
        {entries.filter(entry => entry.stage === "independent").map(entry => <p key={entry.id}>{label(entry.outcome)} · {entry.reason}</p>)}
        {logs.map(log => <details key={log.id}><summary>Conditions and generated destinations</summary>
          <ul>{log.conditionsEvaluated.map(condition => <li key={condition.id}><strong>{condition.label}</strong> ({condition.sourceType}) — {log.conditionsFired.includes(condition.id) ? "condition fired" : "condition did not fire; no model rationale supplied"}<p>{condition.condition}</p></li>)}</ul>
          {log.generatedContent.map((item, index) => <p key={index}>{item.targetType}: {item.title} ({item.targetId ?? "new destination"}) — {item.preview}</p>)}
          {log.errors.map((error, index) => <p key={index}>{error}</p>)}
        </details>)}
        {onEvaluateMemory && message.memoryEvaluation?.status !== "complete" && <button type="button" disabled={loading} onClick={() => void onEvaluateMemory([message.id])}>Evaluate this source independently</button>}
        <h3>A. Inline evaluation</h3>
        <p>{message.memoryEvaluation ? "Independent evaluation owns memory for this source; narrator metadata is not used." : inline ? label(inline.outcome) : "Diagnostics unavailable for older turns. No conclusion about evaluation can be drawn from missing metadata."}</p>
        {inline && ["envelope_missing", "envelope_malformed", "instruction_omitted", "draft_discarded"].includes(inline.outcome) && <p>Memory evaluation failed; no decision is available.</p>}
        {inline && <p>Memory instruction supplied: {inline.instructionSupplied ? "yes" : "no"}. Envelope parsed: {inline.envelopeParsed ? "yes" : "no"}. Returned candidate kinds: {inline.candidateKinds?.join(", ") || "none"}. {inline.model && `Configured narrator model: ${inline.model}`}</p>}
        <h3>B. Candidate evaluation</h3>
        {summaries.map(entry => <p key={entry.id}>Discovery attempt {entry.evaluationAttempt ?? "unknown"}: {entry.counts!.returned} returned · {entry.counts!.accepted} accepted · {entry.counts!.rejected} rejected · {entry.counts!.suppressed} suppressed · {entry.counts!.retryPending} awaiting retry. {entry.reason}</p>)}
        {checkpoint && <details><summary>Saved discovery drafts ({checkpoint.candidates.length})</summary>
          <p>These drafts are held for an atomic evaluation commit. They are not active memories or narration context. Exhausted retries preserve drafts for explicit retry.</p>
          {checkpoint.candidates.map((draft, index) => <article key={index}><h4>{draft.candidate.title}: {draft.status}</h4>
            <p>{draft.candidate.content}</p><p>{draft.reason}</p>
            {draft.candidate.evidenceQuotes?.map((quote, i) => <blockquote key={i}>[{quote.messageId}] {quote.quote}</blockquote>)}
          </article>)}
        </details>}
        {!candidates.length && <p>No candidate diagnostics recorded.</p>}
        {entries.filter(d => d.candidate).map(entry => <Candidate key={entry.id} entry={entry} />)}
        <h3>C. Background recovery</h3>
        <p>{recovery ? `Status: ${recovery.status}. Recorded attempts: ${entries.filter(e => e.outcome === "recovery_attempted").length} (retained diagnostics). Failed attempts: ${recovery.failures ?? 0}. Last attempt story turn: ${recovery.lastAttemptTurn ?? "not recorded"}. Next eligible story turn: ${recovery.nextEligibleTurn ?? "not recorded"}.` : "No recovery queue record available."}</p>
        {recovery?.lastError && <p>{recovery.lastError}</p>}
        {entries.filter(e => e.stage === "recovery").map(entry => <div key={entry.id}>
          <p>{label(entry.outcome)} · {entry.createdAt} {entry.reason}</p>
          {entry.sourceIds && <details><summary>Batch request information</summary>
            <p>Sources: {entry.sourceIds.join(", ")}</p><p>Transport: {entry.transport ?? "not recorded"}; JSON parsed: {entry.parsed === true ? "yes" : "not confirmed"}</p><p>Configured model: {entry.model ?? "unavailable"}</p>
            <p>Batch total (shared across all sources): {entry.usage?.promptTokens ?? "unreported"} input tokens; {entry.usage?.completionTokens ?? "unreported"} output tokens. Transport success alone does not establish parsing or validation success.</p>
          </details>}
        </div>)}
        {message.usage && <p>Narration usage for this message: {message.usage.promptTokens} input / {message.usage.completionTokens} output tokens.</p>}
        <h3>D. Final disposition</h3>
        {linked.map(p => <p key={p.id}>{p.title}: {p.status === "approved" && entries.some(e => e.proposalId === p.id && e.outcome === "automatically_approved") ? "automatically approved" : p.status} <button type="button" onClick={() => onSuggestions(p.title)}>Open suggestion</button></p>)}
        {!linked.length && <p>{message.memoryEvaluation?.status === "complete" && latestCounts
          ? latestCounts.returned === 0 ? "Discovery completed with zero candidates; earlier attempts remain recorded above."
            : latestCounts.rejected === latestCounts.returned ? "Discovery completed with all candidates rejected; no suggestion queued."
              : latestCounts.suppressed === latestCounts.returned ? "Discovery completed with all candidates suppressed; no suggestion queued."
                : "Discovery completed; inspect candidate outcomes and final suggestion dispositions."
          : entries.some(e => e.outcome === "automatically_approved") ? "Automatically approved memory applied." : (inline?.outcome === "zero_candidates" && !recovery || recovery?.status === "complete" && entries.some(e => e.stage === "recovery" && e.outcome === "zero_candidates")) ? "Valid evaluation with no suggestions." : recovery?.status === "complete" ? "Recovery completed; no retained suggestion linked to this source." : "No linked suggestion. Evaluation may be unresolved, suppressed, or unavailable; inspect recorded stages above."}</p>}
        <details><summary>Existing evaluation logs and technical classifications</summary>
          {entries.map(e => <p key={e.id}>{e.stage}: {e.outcome} {e.group} {e.failureCategory} {e.failureCode} {e.providerCode} {e.httpStatus ? `HTTP ${e.httpStatus}` : ""} {e.reason}</p>)}
          {logs.map(log => <div key={log.id}><p>{log.actionsExecuted.join(" · ")}</p><p>{log.errors.join(" · ")}</p></div>)}
        </details>
      </details>;
    })}
  </section>;
}

function Candidate({ entry }: { entry: MemoryDiagnostic }) {
  const candidate = entry.candidate!;
  return <article><h4>{candidate.kind}: {candidate.title || "Untitled candidate"}</h4>
    <p>{candidate.content}</p><p>Source: {entry.sourceId} · Target Story Card: {candidate.targetId ?? "none recorded"}</p>
    <p>Submitted evidence:</p><blockquote style={{ whiteSpace: "pre-wrap" }}>{candidate.evidence || "Not recorded"}</blockquote>
    <p>Model-provided rationale: {candidate.rationale || "Not supplied"}</p>
    <p>{entry.origin ? `${entry.origin} evaluation: ` : ""}{label(entry.outcome)}. {explanation(entry.reason)}</p>
    <details><summary>Technical classification</summary><p>{entry.stage}: {entry.outcome}</p><p>{entry.reason}</p></details>
  </article>;
}
