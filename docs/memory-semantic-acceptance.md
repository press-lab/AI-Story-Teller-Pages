# Lore recovery and model-independent semantic acceptance

## Scope and validation status

This change addresses recovery starvation, exact multi-exchange attribution,
source-linked canon coverage, shortened identity resolution, diagnostics and
non-thinking evaluator configuration. No deterministic event nomination, proposal
quota or extra routine narration request was added. Valid empty results remain a
successful runtime state; the developer benchmark independently measures misses.

No private gameplay export, transcript excerpt, character profile, source-message
ID or story-specific expected answer is included by this change. Deterministic
regressions use invented workshop conversations. Existing repository fixtures from
before this branch are unchanged. Real exports and human-reviewed expectations
must be supplied from local files and are never included in provider prompts as
expected answers.

Real-model quality remains **unverified** without configured provider access and a
reviewed local case manifest. Mocked software tests prove routing and validation,
not whether a model independently recognizes meaningful developments.

## Verified software causes and fixes

- `memoryRecoveryBatch` repeatedly selected the oldest ten pending sources without
  per-source failure state. A failing prefix could permanently exclude newer work.
  Recovery now alternates eligible fresh work and retries, preserving chronological
  order within each request. The existing user-selected cadence is retained.
- Recovery records per-source failures, next eligible turns and batch limits.
  Backoff is 2, 4, then 8 intervals. Batch limits halve toward singleton requests.
  Four failures quarantine a source without marking it successful. Chronicle shows
  its status and permits explicit manual evaluation. Claims persist before dispatch.
- Valid chronological prefixes still commit atomically. Failed suffixes remain
  pending. Completed sources are excluded from automatic processing. Splitting adds
  no extra HTTP calls within an attempt.
- Recovery previously permitted quotes from only the source and three preceding
  transcript messages. `memoryEvidenceWindow` supports up to three adjacent completed
  exchanges, capped at twelve entries, ending at the establishing narrator. It never
  crosses a system/communications boundary or includes later messages.
- Referenced IDs must exist, include the establishing narrator and stay inside that
  window. Separate `evidenceQuotes` entries must occur verbatim in their listed
  original messages. Full content snapshots are preserved. Supporting edits,
  deletions or regeneration invalidate approval. Ordinary inline evidence stays
  within its single-exchange scope; private Brain eligibility is not expanded.
- Name-ranked canon inventory could fill with identities and omit already-recorded
  historical Lore. Recovery now independently includes bounded source-linked Lore.
- Shortened first names could become duplicate identities. Resolution now requires
  a supported full identity in bounded scene context; ambiguity never causes a merge.
  Existing identity cards and historical Lore about their developments remain
  distinct destinations.
- CREATE Lore previously depended on the unrelated local identity-discovery switch.
  Memory-enabled semantic Lore proposals now remain available when that switch is off.
  Uncertainty review, identity safeguards, deduplication and Brain boundaries remain.
- Responses forced medium reasoning and extra reasoning-token headroom. Both are
  removed. The transport selector no longer substitutes a particular provider/model.
  Models can explicitly supply existing historical/living mode and event status.

## Effective configuration and safe diagnostics

The active browser preset overrides saved adventure provider fields in
`useAdventureRuntime.mergeProviderConfig`. A saved preset alone therefore does not
prove the effective model used for a turn. Existing per-request accounting is the
source of truth; older records without transport diagnostics remain unknown.

Memory evaluation rejects invalid Base URLs before HTTP rather than silently
falling back. Model-only evaluator overrides work with an inherited endpoint.
Normalization retains declared capabilities; old saves retain pending sources
without inventing a backlog from their entire transcript. Evaluator selection and
cadence remain app-wide, while the existing background provider settings are
adventure-specific. Narrator configuration remains independent.

Actual HTTP accounting now exposes request hostname, requested/provider-reported
model, output limit, memory-instruction presence, finish reason and raw envelope
presence/completeness. Turn processing records rewrite/discard state and parsing
outcome. Context Preview shows these diagnostics. Keys, URL credentials/query
strings, authorization headers, prompts and private response bodies are not logged.

The protected one-pass instruction, narration quality/word limits, output reserve
and existing correction behavior remain. Historical missing envelopes cannot be
fully diagnosed retrospectively without their original transport diagnostics.
Missing envelopes, invalid JSON and rejected evidence remain visible failures.

## Model-independent non-thinking controls

Settings → **Memory evaluator non-thinking control** stores a documented capability
on the existing background provider configuration:

- `omit`: the selected provider/model does not reason by default; omit reasoning fields.
- `none`: the selected model supports effort `none`; use the transport's documented field.
- `thinkingDisabled`: Chat/Messages supports `thinking.type=disabled`. This is not
  automatically translated into Responses effort `none`.
- `openRouterDisabled`: compatible Chat supports `reasoning.enabled=false`.
- `required`: the selected model requires reasoning; evaluation fails clearly.
- `auto`: use DeepSeek's documented provider-level off toggle; otherwise require
  an explicit documented capability before sending.

There is no model-name catalogue, fixed model or automatic reasoning fallback.
Declare `none` only when the chosen model actually supports it. Provider rejections
remain configuration errors. Reported reasoning despite an off control is rejected.
Client software cannot prove the absence of unreported provider-internal work.
Strict Structured Outputs remain available on compatible Responses endpoints.
The same controls apply to explicit legacy memory discovery.

Provider references:
[DeepSeek controls](https://api-docs.deepseek.com/guides/thinking_mode/),
[OpenRouter controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
Consult the chosen model's documentation when declaring capabilities.

## Private real-model benchmark

Ordinary tests, CI and builds never call a semantic model. The explicit developer
command calls the real existing memory evaluator and applies accepted actions
through the reducer/Inbox path. It records raw findings as well as accepted
proposals, so deduplication cannot hide model false positives.

Keep the provider configuration, export and reviewed case manifest outside Git.
The directory `.memory-eval.local/` and generated reports are ignored. Example
private provider configuration (use your own endpoint/model/capability):

```json
{
  "baseUrl": "https://your-provider.example/v1",
  "model": "your-chosen-model",
  "memoryEvaluationApi": "chat",
  "memoryReasoningControl": "omit",
  "maxOutputTokens": 1400
}
```

A local case manifest is an array of `GoldenMemoryCase` objects. Each has an `id`,
1–10 existing narrator `sourceIds`, `expectation` (`must`, `may`, `empty`), `review`
(`user-requirement` or `developer-provisional`), and `rationale`. Optional `concepts`
is an array of alternative phrase groups scored after inference; `forbidden` lists
unsupported claims to flag. Optional `canon` declares explicit as-of variants via
`removeCardIds`, `cardContents`, and `clearSummary`. These must represent reviewed
current canon, never an injected expected answer.

Optional `acceptance` defines `singleLore`, `historical`, an exact `title`, and
`requiredEvidenceMessageIds`. Those checks are evaluated only after the model
responds and remain separate from required-event discovery recall. The input
builder deliberately reads only source selection and canon, never the rubric.

Build approximately 20–30 reviewed cases covering consequential completed events,
conditional interest, offers/acceptance across exchanges, ordinary dialogue, brief
glances, unfinished plans, already-recorded history, repeated meetings and mere
proximity. Use recorded/unrecorded canon variants where appropriate. Additional
provisional labels require human sign-off.

```powershell
$env:AIST_MEMORY_CONFIG = 'C:\private\memory-provider.json'
$env:AIST_MEMORY_API_KEY = '<provider key>'
$env:AIST_MEMORY_SAVE = 'C:\private\adventure-export.json'
$env:AIST_MEMORY_CASES = 'C:\private\reviewed-memory-cases.json'
npm.cmd run eval:memory -- --case case-id
npm.cmd run eval:memory
```

The local report at `codex-artifacts/memory-semantic/latest.json` contains discovery
recall, full acceptance checks, raw false positives, duplicate/canon-repeat counts,
invalid evidence, rejected/suppressed proposals, successful empties, valid-empty
misses, partial/provider/schema failures, actual HTTP attempts and token use.
Phrase-based screening is transparent but cannot replace human review for
entailment, paraphrased duplicates or unsupported claims.

Optional `inputUsdPerMillion`, `outputUsdPerMillion` and
`cachedInputUsdPerMillion` use developer-supplied current pricing for approximate
cost. Missing rates or usage are reported as unknown. No expected answer is sent
to the semantic evaluator. No tools, browsing or agent workflows are enabled.

## Validation

The deterministic suite covers fresh/retry fairness, progressively split failures,
quarantine/manual retry, valid prefixes, exact evidence and edited dependencies,
one synthetic agreement reaching Inbox, existing canon coverage, identity aliases,
safe diagnostics, declared capabilities and empty/failure/quality-miss states.
Successful cadence remains 20 narration plus 4 recovery requests over 20 turns.

Run `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run smoke:prod` before merging.
The production build's existing large-chunk warning is outside this change's scope.
Live semantic recall, false positives and generated proposals remain outstanding
until the private benchmark runs with configured credentials.

Final code-only validation: 69 test files and 672 tests passed; TypeScript/production build, production smoke, command help and whitespace checks passed. No live model calls were made.
