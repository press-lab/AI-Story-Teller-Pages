# World Evolution request audit

Audit of `401b27c`, `bdb7e53`, `1edee2d`, `3c25be0` and `e3c432` before hardening:

| Path | Gate | Requests |
| --- | --- | --- |
| Narration | Submit, continue or regenerate | 1 |
| One-pass memory and World Evolution | Hidden output on narration; deterministic processing | 0 additional |
| Response guard | Length or player-agency violation | 1 correction |
| Continuity | Risky claims, configured provider | 1 check/rewrite |
| Compact memory recovery | Missing/invalid envelope and memory cadence | 1 |
| Full memory recovery | Compact failure | Multiple configured extraction/update requests; disabled for active World Evolution in e3c432 |
| Semantic rules | Enabled rules and cadence | Evaluation plus configured update requests |
| Arc continuation | Legacy aftermath with enrolled threads and no options | 1 generation |
| Authoring, audit, reconciliation | User action | Separate from routine turns |

All references retain the one-pass narration architecture and conditional background paths. Historical lore (`bdb7e53`) and relationship ownership (`1edee2d`) change payloads, not the ordinary minimum request count. The initial World Evolution commit adds structured plot output; e3c432 adds world instructions and targeted changes without another routine evaluator. Its arc-dependent activation incorrectly leaves empty sandboxes on the older full-fallback path.

Provider routing resolves the configured background model, otherwise the narration provider. Continuity, memory and semantic helpers use that resolver. OpenAI-compatible and Anthropic transports both exist. GLM has an existing single empty-length retry (2048 then 8192 reasoning reserve); correction responses aggregate usage. Counting these aggregated responses as requests would undercount retries and can double-count usage. Accounting must therefore occur at each HTTP attempt, before aggregation.

No live paid requests were used for this audit. Approximate context and hidden-output token counts are estimates, not provider billing measurements. Unknown pricing or absent usage must remain unknown. Existing narration caps and the 1400-token memory reserve are retained.

## Identical fixture measurements

Reproduce with `node scripts/measure-world-evolution-cost.mjs`. Actual historical TypeScript modules receive identical adventure JSON and quiet narration with an empty envelope. Background features are disabled. Input estimates sum the application's estimator over provider messages, excluding transport overhead and hidden reasoning.

| Revision | Empty sandbox input | Active arc input | Requests/turn | Empty structured output |
| --- | ---: | ---: | ---: | ---: |
| 401b27c | 2035 | 2087 | 1 | 4 |
| bdb7e53 | 2199 | 2251 | 1 | 4 |
| 1edee2d | 2104 | 2155 | 1 | 4 |
| 3c25be0 | 2104 | 2296 | 1 | 4 |
| e3c432 | 2104 | 2936 | 1 | 4 |
| Hardened | 2526 | 2685 | 1 | 4 |

Empty-sandbox capture now works, costing 422 estimated input tokens above e3c432. With an active arc, the hardened prompt saves 251 estimated tokens. Relative to the relationship baseline the increases are 422/530; relative to 401b27c they are 491/598. Lore and relationship ownership remain available. The script fails if ordinary request count exceeds one or fixture overhead exceeds 650 estimated tokens relative to 1edee2d.

A representative progress event is 62 estimated structured-output tokens in the initial small plot schema and 91 with explicit objective, revision, certainty and autonomy. Empty output remains 4. These are schema examples, not observed model generation distributions. Quiet fixtures produce no fallback or correction in any revision. Actual failure-frequency changes cannot be inferred from mocked scenes; diagnostics record them during real use.

## Bounds and recovery

- The worst supported instruction inventory (four 160-character target IDs with 80-character revisions/protection flags and four 160-character plot IDs) is 3,847 characters / 962 estimated tokens. Inventories exclude historical/inactive/omitted targets, are rebuilt after budget cuts, and consume the existing memory-item budget. Complete owners and duplicated plot objectives are not serialized into instructions.
- All four output arrays share four records, 4,800 serialized characters and 1,200 estimated output tokens. Each record is limited to 2,400 characters / 600 estimated tokens. Content/previous/evidence fields have individual limits. Excess complete candidates are reported for review; safe records survive.
- Visible narration caps and the 1,400-token hidden reserve are unchanged. Approximate limits are not exact provider tokenizer guarantees.
- At most twelve active emerging plots are created; completed plots move to persistent archival history. Context selects at most four active and two relevant historical plots, with two recent events each. Saved history is retained rather than repeatedly sent to the model.
- Missing, malformed or truncated envelopes can use the existing single compact recovery request at the existing cadence. World Evolution never promotes compact failure into full fallback. Failed recovery remains visible and needs manual review. Legacy mode retains its full fallback. A correction alone does not introduce a recovery call; discarded records are never applied.

Request diagnostics count each HTTP attempt, including GLM retries, independently of aggregated message/background usage. Missing input/output usage remains unknown. Anthropic cache-read/cache-creation input is included in total input. Dollar costs require measured usage and explicitly supplied model pricing, or an OpenRouter-reported cost; routing to another model removes inherited pricing. The ledger retains the last 100 measured turn numbers and survives persistence. API keys and runtime correlation settings are removed from exports.
