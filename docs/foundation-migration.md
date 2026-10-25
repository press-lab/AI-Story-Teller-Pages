# Original memory foundation migration

Source: local, read-only `C:\Users\sethp\Documents\GitHub\AI Story Teller - Orig`.
Destination baseline: Pages `97c5669` (October 24, 2026). The user selected
`-Orig` after comparison showed major differences between the two possible sources.

## Architectural assessment

| Area | Classification | Decision |
| --- | --- | --- |
| `semanticEngine.runMemoryCycle`, independent plot/card/character condition evaluation and targeted generation | ORIGINAL FOUNDATION | Restore as the normal post-story call chain. Reuse the existing descendant implementation and original conditions/prompts instead of introducing another engine. |
| `brainConditions`, first-person thought patches, cooldowns, archival and condensation | ORIGINAL FOUNDATION | Retain; evaluate a bounded continuing exchange, not only literal names in the final response. More than one character can have a meaningful reaction. |
| Plot Essentials drift, Current Arc event log, external Active Pressure | ORIGINAL FOUNDATION | Restore distinct conditions, respecting explicit component auto-update permissions. Never change Arc Director phases with model verdicts. |
| Original first-card-only and single-winner selection | REQUIRES ADAPTATION | Consider eligible existing cards and characters independently; one changed destination must not suppress another. |
| Original unconditional successful-cycle stamp, silent runtime failure | REQUIRES ADAPTATION | Replace with source-bound, independently completed evaluation groups, bounded retries and inspectable errors. |
| Pages append/create matching, deduplication, chronology and review | PAGES IMPROVEMENT | All four card types accept factual appends. Legacy modes and per-card opt-in no longer gate writes. Keep exact evidence and destination review. |
| Pages evidence windows, canon references, source snapshots, October 24 recovery validation and decision inspector | PAGES IMPROVEMENT | Keep validation and provenance. Use original message IDs and preserve multi-exchange evidence. Keep compact evaluation for explicit legacy catch-up tools. |
| Narrator envelope as normal memory authority, automatic compact recovery of absent envelopes | SUPERSEDED | Normal narration no longer depends on a hidden appendix. Independent evaluation owns normal memory decisions. Legacy envelope parsing remains for stripping old tags; compact tools remain explicit. |
| Deterministic entity scanner | PAGES IMPROVEMENT | Supplemental review-only identity nominations, merged into the same inbox. It does not decide private reactions or plot developments. |
| Provider adapters, Responses transport, endpoint validation, GLM bounded reasoning, API accounting | PAGES IMPROVEMENT | Targeted evaluation/generation/validation use the current memory provider transport, never narrator-only settings. No required JSON mode on unsupported chat endpoints. |
| `useAdventureRuntime`, pending reducer updates, turn pipeline | REQUIRES ADAPTATION | Save final narration before independent work. Commit only results whose source evidence and destination snapshots still match. No background history replay on load. |
| Context builder and Context Preview, budget selection, player agency/response guard, story clock | PAGES IMPROVEMENT | Keep deterministic provider payload, canonical memory selection, gated arc cost and recent transcript ordering. Pending proposals remain outside narration canon. |
| IndexedDB, imports/exports, save normalization, provider-secret stripping | PAGES IMPROVEMENT | Retain browser-only persistence and existing schema. Add only optional evaluation/provenance metadata. Never rewrite saved adventures during migration tests. |
| Original Auto-Cards/quests, rolling summary and scene state compatibility | REQUIRES ADAPTATION | Original Auto-Cards module is already removed. Do not revive it or emit legacy summary/scene buckets into prompts. Retain compatibility fields. |
| Backend/accounts/PostgreSQL | SUPERSEDED | None imported. The selected source and destination are browser-only. |

## Implementation contract

Final story → queued source → independent plot / existing-card / Brain evaluation
and Story Card discovery → targeted generation → evidence validation → shared
proposal router → approval/application through reducer → existing context builder.

Global memory enablement and cadence govern automatic calls. Per-component
`autoUpdate=false` is authoritative; protected destinations require review.
Per-type auto-approval preferences remain saved and effective. Existing pending
legacy recovery is retained for explicit bounded review, never replayed on load.

No live model calls, user-save writes, push or deployment were performed.

## Restored implementation and preserved behavior

`src/triggers/semanticEngine.ts` reuses the original condition builders, targeted
generation prompts, Brain patch format, archival and condensation path. Its
independent plot, existing-card and character checks now run after normal
submit/continue/regeneration through `src/hooks/useAdventureRuntime.ts`.
All changed eligible destinations can fire; the original single-winner behavior
and first-card starvation are superseded. Discovery adds a fourth transaction
group using Pages' existing suggestion constructor and matching policies.

Existing-card Lore updates add only new facts. Character/Location updates still
require exceptional permanent changes; ordinary developments go through Lore
discovery. Completed agreements can be historical even while their future work
remains unfinished. Generated discoveries require original evidence IDs, exact
quotes and semantic review. Brain/component validation uses the same bounded
original exchange and requires evidence from the establishing exchange. No later
messages are supplied while evaluating an older source.

`src/state/adventureReducer.ts` commits each successful group once, checks source
and destination snapshots, preserves incomplete groups on failure, records
auto-approved pressure in proposal history, and invalidates dependent pending
evaluation after source edits. Applying a group with an error makes no partial
memory writes. Earlier successful groups stay committed and are skipped on retry.
Only accepted memory reaches the existing context builder; pending proposals do
not. A new current-state write can invalidate an older pending replacement;
reevaluate that source rather than overwrite newer memory with a stale result.

`src/providers/memoryCompletion.ts` routes condition checks, targeted generation
and review through current Chat/Messages or Responses adapters. Arbitrary chat
endpoints are not forced into JSON mode. Responses uses a strict transport wrapper
whose text is parsed by the original task-specific parser. Existing October 24
reasoning capability checks, GLM bounded reasoning and endpoint validation remain.
Narrator reasoning controls do not carry into a different evaluator model or
endpoint. Exact HTTP accounting uses the separate `memoryEvaluation` purpose;
explicit compact catch-up retains `memoryRecovery` accounting.

Memory Suggestions → Decisions shows completed/failed groups, actual conditions,
generated destinations, validation/suppression records, source-linked proposals
and an explicit per-source retry button. Evidence snapshots are also visible on
Brain and component proposals. Optional printed Brain thoughts are rendered from
approved source-linked proposals, without rewriting narration or its evidence.

## Compatibility and settings

No IndexedDB database/version change is needed. `Message.memoryEvaluation` and
`MemoryProposal.evaluationSource` are optional additive JSON fields. Existing
normalization/import/export retains old messages, thoughts and archives, card and
component histories, proposal statuses, chronology, settings, diagnostics and
pending legacy recovery. Existing narrator/dedicated preference values remain in
exports; both now route normal play through independent evaluation. New defaults
use `evaluator: "independent"`.

- Global **Automatic memory evaluation** governs normal-play memory requests.
- **Evaluate every N story turns** controls cadence; zero means explicit manual
  evaluation only. At most ten queued new sources run in one cadence window.
- **Review all automatic updates** (`requireApprovalForAutoUpdates`) forces
  review. With it off, saved per-type auto-approval preferences apply; protected,
  uncertain and ambiguous destinations still require review.
- Plot Essentials requires `autoUpdate === true`. Current Arc/Active Pressure
  honor explicit opt-outs. Per-target and global card cooldowns remain effective;
  pressure defaults to no cooldown, while arc updates default to four turns.
- Failed source groups back off between attempts and quarantine after three
  automatic attempts. Explicit retries are bounded to selected sources and can
  retry quarantined work. Loading an adventure never issues memory requests.
- Legacy pending recovery is retained for explicit Chronicle/Decisions review.
  It is not silently replayed or reinterpreted as current story action.

The existing deterministic Arc Director phase gate, player-agency/length guards,
continuity checks, author tools, static hosting, context budgets and exact Context
Preview/provider payload agreement remain covered by the existing regressions.
No backend, account infrastructure or new dependencies were added.

## Offline validation (October 24, 2026)

- `npm.cmd test`: **716 tests passed across 73 files**.
- `npm.cmd run build`: TypeScript and the Vite static production build passed.
- `npm.cmd run smoke:prod`: passed; both built assets loaded from local preview.
- `git diff --check`: passed.

The new foundation tests include a read-only eight-message fixture from the July
**Arcane: After the Rocket** save, recording the source hash, and the existing
Hogwarts continuity fixtures. No live provider calls or writes to actual saves
were used. The test runner now restricts discovery to this checkout, excluding
other managed worktrees containing different application revisions.

| Fixed offline routing benchmark | Result |
| --- | ---: |
| Expected positive destinations found | 5 |
| False negatives | 0 |
| False positives | 0 |
| Duplicate destinations | 0 |
| Mocked provider calls | 16 |

These are application-routing results with controlled model replies, **not**
measurements of an LLM's semantic accuracy. The cases cover a private reaction,
ordinary dialogue, a completed event, already-recorded history, and one discovery
with differentiated reactions from two characters. Other regressions cover all
three plot destinations, evidence rejection, failed-group recovery, exactly-once
application, approval/edit/rejection, future context, disabled automation,
separate evaluator configuration and undated imported history.

### Before/after architecture and costs

The committed pre-migration tests at `97c5669` required a narrator appendix for
immediate memory: twenty inline turns expected twenty narration calls; twenty
missing-envelope turns expected twenty narration plus four batched recovery
calls. Those are the **previous committed contract**, not a newly run live
baseline. The overhaul intentionally replaces these assertions with independent
evaluation regressions; legacy payload-adapter coverage remains explicit through
`src/test/legacyMemory.ts`, outside production scheduling.

| Twenty-turn controlled fixture | Narration calls | Independent calls | Estimated total prompt tokens |
| --- | ---: | ---: | ---: |
| Plain prose, no eligible target conditions | 20 | 20 | 46,917 |
| Same prose with legacy envelope | 20 | 20 | 46,917 |
| Existing Brain plus 200 unrelated historical cards | 20 | 40 | 57,281 |

The first two now have identical behavior: an envelope is irrelevant. The large
archive is not dumped into evaluation. A separate actual-HTTP-mock test with the
default pressure condition verifies twenty narration plus forty independent
requests and separately reported usage. Changed targets add generation/review
calls, and condensation can add another call. This architecture prioritizes
continuity over the previous design's smaller request count.

## Remaining limits

Live reliability and provider-specific output adherence remain unmeasured. The
existing capability checks can require explicit configuration on custom endpoints;
models requiring unsupported reasoning controls fail visibly without losing the
story. The existing Vite warning about a bundle exceeding 500 kB remains.

Evidence is bounded to three complete exchanges (at most twelve messages), with
private/OOC boundaries preserved. Longer developments require appropriate recent
context or explicit reconciliation. A condition returning no IDs is logged as a
negative decision without an invented rationale. Ambiguous/stale proposals can
require another explicit evaluation. The runtime keeps generation controls busy
while the scheduled bounded memory work finishes, protecting source ordering.
Historical manual tools remain available for deliberate larger reconciliation.


## Discovery reliability and edited sources

Discovery candidates now have separate accepted, rejected, suppressed and awaiting-retry outcomes. Bad original evidence IDs, missing establishing-source evidence and inexact quotes reject that candidate without discarding unrelated accepted candidates. An entirely invalid nonempty batch remains a failed evaluation, distinct from a successful empty array. Accepted candidates commit together through the existing source/destination snapshot transaction.

Temporary validation failures retain at most three allowlisted drafts in optional `Message.memoryEvaluation.discoveryCheckpoint` metadata. Successfully validated drafts are not regenerated on retry. Evidence dependencies and a SHA-256 digest of card/component references, controls and author corrections invalidate cached reviews when their inputs change. Drafts are noncanonical, excluded from narrator context and the Inbox, and inspectable in Decisions even after quarantine. No checkpoint can apply memory outside the reducer transaction. Old saves need no database migration.

Editing previously tracked evidence resets the affected source and tracked dependent sources to pending, clears their checkpoints, and changes their evaluation revision so in-flight results cannot apply after an edit/revert. Untracked history stays untracked. Editing and loading issue no memory requests; the next normal post-story cadence or an explicit bounded evaluation processes pending work. Approved memories and source-validity checks remain in place.

Validation requires typed verdict fields, including identity attribution for Story Cards and Brains. Missing/malformed fields are retryable invalid output; explicit negative attribution is a semantic rejection retaining its explanation. Lore target metadata distinguishes observable topic history from a character's knowledge. Decisions shows per-attempt returned/accepted/rejected/suppressed/retry-pending counts. Earlier failures remain recorded when a later valid empty result completes a source. Provider diagnostics retain only allowlisted codes/statuses, never arbitrary provider error text.

The read-only Hogwarts fixture records original message IDs and observed diagnostics with a source SHA-256. Its original rejected discovery payloads were not exported; mixed-validity replies and provider responses in tests are synthetic. Offline tests establish routing, persistence and recovery behavior, not improved real-model recall.


The shared suggestion router also requires overlapping facts before merging findings that cite the same exchange and event category; a shared source alone cannot replace one unrelated finding with another.

| Hogwarts source | Exported observation | Verified offline behavior after the patch |
| --- | --- | --- |
| `message_mvn21hfm_yf2oq231` | Three candidates rejected, two rejected on retry, final empty result marked complete. | Synthetic bad-ID candidates get specific diagnostics; a later empty result remains complete with prior failures retained. Separate synthetic mixed-validity batches keep the valid sibling in either order. |
| `message_mvn294vd_jlch3yr9` | Product-interest candidate rejected for identity; later edits left no evaluation marker. | Explicit identity rejection retains its reason. Editing a tracked source requeues it, including old sources whose retained diagnostics establish tracking despite a missing marker. |
| `message_mvn2hnpt_c5rn63pu` | Brain transport failure and discovery source-evidence failure; plot/card groups completed. | Synthetic independent failures preserve the completed groups and remain separately classified/retryable. |

These are controlled provider-response regressions, not a paid replay of the adventure or a claim that its unseen rejected candidates were valid.

Validation for this scoped patch: 789 tests passed; TypeScript/production build and production smoke passed; git diff --check passed. The original uploaded JSON SHA-256 was verified unchanged. No live model requests were made. The existing Vite bundle-size warning remains.


### Responsive memory processing and API cost

Narration loading ends once the finalized story is saved. A single ordered worker
per active adventure evaluates the same bounded cadence window, with separate
Plot / Story Cards / Brains / Discovery progress. Reading and composing stay
available; generation waits for the worker so the next context includes committed
automatic memory. Failed or interrupted evaluations are advisory in the Memory submenu; they never
redirect or block Play. Opening an adventure sends no requests and creates no retry
notice from historical failures. Explicit per-source retry remains in Decisions.

Group commits persist independently through the existing evidence, revision,
destination and approval checks. Stale groups remain pending for reevaluation,
without an immediate retry. Completed groups cannot replay. Switching adventures
prevents the old worker from committing or starting another group.

Each HTTP attempt has a three-minute deadline including the response body. Timeout
adds no automatic HTTP retry, retains completed groups/checkpoints and records a
safe failure classification. Provider billing can continue after client abort;
an explicit later retry may therefore incur another charge for unfinished work.
Historical failures and quarantined sources remain unchanged and inspectable.

No additional requests or review rounds are introduced. Models, token limits,
condition checks, cadence and update parallelism are unchanged. The Story Card
reviewer response envelope explicitly includes its required nested placement,
without relaxing evidence validation. This small prompt clarification has minimal
token overhead. Existing bounded group backoff/retry behavior is preserved. The offline accounting regression
continues to require exactly 20 narration plus 40 independent HTTP requests for
20 turns. No paid API calls are needed for validation.
