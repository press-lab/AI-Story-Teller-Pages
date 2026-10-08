import type { Adventure } from "../types/adventure";

export function RequestDiagnostics({ adventure }: { adventure: Adventure }) {
  const records = adventure.activeState.providerRequests ?? [];
  const turns = [...new Set(records.map(r => r.turn))].sort((a, b) => b - a);
  const frequency = (purpose: string) => turns.filter(t => records.some(r => r.turn === t && r.purpose === purpose)).length;
  return <details className="panel"><summary>API requests by turn ({records.length} recorded attempts)</summary>
    <p>Last {turns.length} measured turns: memory fallback {frequency("compactMemoryFallback")}/{turns.length}; response correction {frequency("responseCorrection")}/{turns.length}; continuity checks {frequency("continuity")}/{turns.length}, corrections {turns.filter(t => records.some(r => r.turn === t && r.continuityCorrected)).length}/{turns.length}. Retries are separate attempts. Earlier uninstrumented turns are excluded.</p>
    <table><thead><tr><th>Turn / purpose / model</th><th>Requests</th><th>Input / output</th><th>Hidden output estimate</th><th>Cost USD</th></tr></thead><tbody>
      {turns.map(turn => {
        const rows = records.filter(r => r.turn === turn);
        const known = rows.every(r => r.usage !== undefined);
        const costKnown = rows.every(r => r.costUSD !== undefined);
        return <tr key={turn}><td>{turn}: {rows.map(r => `${r.purpose} (${r.model}${r.success ? "" : "; failed/empty"})`).join(", ")}</td><td>{rows.length} total; {rows.filter(r => r.purpose === "narration").length} narration; {rows.filter(r => r.purpose !== "narration").length} background/correction</td>
          <td>{known ? `${rows.reduce((n, r) => n + r.usage!.promptTokens, 0)} / ${rows.reduce((n, r) => n + r.usage!.completionTokens, 0)} actual` : `unknown actual; ${rows.reduce((n, r) => n + r.inputTokensEstimate, 0)} / ${rows.reduce((n, r) => n + r.outputTokensEstimate, 0)} text estimate`}</td>
          <td>{rows.reduce((n, r) => n + r.structuredOutputTokensEstimate, 0)} estimated tokens</td><td>{costKnown ? rows.reduce((n, r) => n + r.costUSD!, 0).toFixed(6) : "unknown"}</td></tr>;
      })}
    </tbody></table>
    <p className="muted">Text estimates exclude hidden reasoning and transport overhead. Cost uses reported provider cost or explicitly configured pricing with measured uncached usage. No guessed pricing.</p>
  </details>;
}
