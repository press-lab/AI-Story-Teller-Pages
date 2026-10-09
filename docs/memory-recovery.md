# Batched automatic memory recovery

## Call paths

Before this change, `submitTurn`, `continueTurn`, and `regenerateLastResponse` in
`useAdventureRuntime.ts` saved the narrative and started `startMemoryFallback`.
That function inspected the latest evaluation log for a missing or invalid inline
envelope, then called `runCompactMemoryFallback`. With `everyNTurns: 1`, each
missing envelope could add a request. An invalid compact result called
`runMemoryCycle`, whose legacy stages could generate additional requests.

`sendStoryCompletionWithGuard` can issue a separate correction request. Its
`storyResponseGuard.ts` prompt strips hidden tags and requests visible prose only.
Reattaching the discarded draft's envelope would apply potentially invalid facts.
`applyProviderResponse` can also run a continuity check and discard draft memory
when that check rewrites the prose.

Now valid inline envelopes still use the existing memory validation and reducer
path. Missing, malformed, budget-omitted, and corrected envelopes mark the final
persisted assistant message as pending. Recovery reads those final messages,
including edits, and uses their IDs for provenance. Deleted/regenerated drafts do
not remain in the batch. A failed regeneration restores the original narrative.

## Scheduling and persistence

- A batch becomes due after approximately five successful story turns from its
  earliest pending source. Existing intervals greater than five are respected.
- Communications, failed narration requests, and regeneration do not advance the
  separate persisted recovery story counter. Valid inline turns do advance it.
- The attempt counter is saved before sending a recovery request. IndexedDB saves
  now resolve at transaction commit, not at the earlier `put` success event.
- Due recovery finishes before another story generation starts. This serializes
  generation and recovery while keeping the completed narrative visible.
- Reload resumes an already-due batch. A previously claimed batch is not replayed
  immediately; unresolved sources remain pending until the next interval.
- Each request handles up to ten oldest pending sources, allowing catch-up after
  failures. There is no legacy-cycle escalation or provider-level recovery retry.
- Invalid JSON, missing source results, unsupported JSON mode, and network errors
  retain the batch. The next attempt waits another five story turns (or the
  configured longer interval). Repeated failure never deletes pending sources.
- Completion checks each source ID and content atomically before applying memory;
  stale results after deletion, editing, or regeneration are rejected.
- All added save fields are optional. Old saves load without retroactively queuing
  their entire historical transcript. No exported save data was modified.

## Recovery grounding and accuracy

The prompt contains pending final exchanges, adjacent context for reference
resolution, relevant character/Story Card/Brain canon, and Plot Essentials,
Active Pressure, and Current Arc context. It excludes general scenario
instructions, narration rules, and unrelated pinned card content. Whole selected
canon items are used; there is no new character-profile truncation for cost.
Existing context-builder budget and inclusion policies still apply.

Recovery requires a result for every source turn. Each source retains the inline
allowance of four updates and one new card; the entire batch is not constrained
to four updates. Background output allowance scales per source without changing
narration model, narration output limits, or saved response-length settings.
Exact evidence is validated against each final source exchange. Existing AI
mutation boundaries, Brain eligibility, proposal approval, durable-character
checks, and review requirements for historical lore remain in force.

## Request and token accounting

`fetchWithAccounting` records each actual HTTP attempt at the provider boundary,
including retries, network failures, and non-success HTTP responses. Purpose is
`narration`, `correction` (including continuity checks), `memoryRecovery`, or
`otherBackground`. Records include model, timestamp, status and provider-reported
usage, with no prompts, API keys, or response bodies. The adventure retains the
last 500 attempt records plus cumulative per-purpose totals.

Context Preview exposes the totals, pending memory count, and recent attempt
records. Unknown usage is explicit and is not an estimate of zero consumption.
These totals start with this feature; historical story-message and background
usage counters remain available for save compatibility and are not added to the
new totals. A crash cannot reveal tokens that the provider never reported back.

## Measurements (2026-10-09)

Baseline implementation: `1595c2c24a1c444f7a1abec629ccb84ffd9983c3`.
All measurements below used mocks, with no paid/live API requests.

The supplied Dispatch: Saiyan Season 2 export had automatic memory enabled,
`everyNTurns: 1`, and 1,281,133 accumulated background prompt tokens. Its latest
100 evaluation records contained 52 missing-envelope records and 48 compact
fallback records. Evaluation records are not a complete HTTP request ledger.

A baseline runtime test simulated 20 envelope-free turns with successful compact
recovery: **20 narration + 20 recovery = 40 provider requests**.
The corresponding new runtime and HTTP-boundary tests measured
**20 narration + 4 recovery = 24 requests**. That is 16 fewer requests in this
controlled case, with narration requests unchanged.

Additional 20-turn regressions measured:

| Response behavior | Narration | Recovery attempts | Legacy cycles |
| --- | ---: | ---: | ---: |
| Missing inline envelopes | 20 | 4 | 0 |
| Malformed inline envelopes | 20 | 4 | 0 |
| Valid inline memory | 20 | 0 | 0 |
| Missing envelopes and invalid recovery JSON | 20 | 4 | 0 |

The invalid-recovery scenario retains all 20 sources. Tests also cover reload,
network failure and delayed retry, corrected/regenerated final text, stale
completion rejection, per-source provenance, more than four durable updates
across a batch, and separate usage accounting when correction fails.

A local prompt comparison used the export's last five assistant responses,
running the original recovery prompt against each corresponding transcript
prefix and the new prompt against the five-source batch:

| Measure | Five original requests | One batch request |
| --- | ---: | ---: |
| Prompt characters (joined message contents) | 309,132 | 47,881 |
| Estimated prompt tokens (`approximateTokenCount`) | 77,213 | 11,956 |

These are measured prompt sizes and local token estimates, **not actual billed
tokens or production savings**. Model outputs, cache behavior, correction rates,
and provider-reported usage will determine real cost. The export was read locally
for this measurement; its contents and the temporary measurement fixture were
not committed.
