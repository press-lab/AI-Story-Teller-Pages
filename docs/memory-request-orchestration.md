# Automatic memory request orchestration

## Scope and source baseline

Implementation baseline: `00db16c5c309d0d0a7d0886b49d9b0864c5a8605` in
`AI-Story-Teller-Pages`, branch `codex/validated-memory-placement`. This identifies
the local checkout, not the deployed build. No paid requests or deployment were
performed. Existing Hogwarts fixtures supply original excerpts/source IDs and
exported diagnostics; unseen rejected provider payloads remain unknown. Recorded
error labels alone do not establish a cause. Save data and fixtures were not
rewritten. The full referenced Hogwarts export is not present under this task's
`sync/`; existing checked-in diagnostic excerpts were used read-only.

Before implementation, 63 existing tests passed across `originalFoundation`,
`storyCardArchitecture.cost` and `useAdventureRuntime.apiAccounting`. The latter
mocks HTTP at fetch, so its counts are actual attempted requests through provider
adapters, rather than logical conditions or proposal counts.

| Controlled fixture | Before memory requests | After memory requests | Narration requests |
| --- | ---: | ---: | ---: |
| 20 quiet turns, default pressure | 40 | 20 | 20 |
| 20 quiet turns, Brain and 200 unrelated historical cards | 40 | 20 | 20 |
| 20 plain turns without eligible targets | 20 | 20 | 20 |
| Quiet source with all three eligible target groups | 4 | 1 | outside fixture |
| Five-case foundation routing benchmark | 17 | 16 | outside fixture |

The five-case benchmark still produces five expected destinations, no unexpected
or duplicate destinations, with controlled replies. The new assessment chooses
no additional discovery for ordinary dialogue and Brain-only changes. An
assessment that positively requires discovery still costs a discovery request;
for a source with no existing targets this can add a request relative to the old
unconditional discovery path. Request counts are not dollar-cost percentages:
prompt sizes, output sizes, caching and provider pricing differ.

New retry measurements: a two-Brain group with one failed validation uses five
requests initially (assessment, two generations, two validations), then one
validation request on retry. Successful sibling work commits only when the whole
Brain group succeeds. A corrected Story Card draft whose final review fails uses
four requests initially, then only the final review on retry. Discovery with a
failed review uses three requests, then one review after unrelated metadata/card
additions. These are newly measured cases, not retrospective baseline claims.

## Current flow and responsibilities

`turnPipeline` saves finalized narration and queues the source. The ordered worker
in `useAdventureRuntime` claims bounded cadence work and calls `runMemoryCycle`.
It still never replays history on load, and manual evaluation, explicit retries,
backoff, quarantine and legacy recovery retain their existing entry points.

`memoryAssessment.assessMemory` makes one structured assessment of Plot, existing
Story Cards, Brains and additional discovery. Each target result has an eligible
condition ID, concise factual delta and evidence IDs. Each group has an explicit
reason. Discovery has a required boolean, reason and evidence array. Unknown IDs,
missing fields, invalid types or changes lacking the establishing source are
visible invalid-output failures. They never imply empty results, trigger the
old three assessments, or authorize a discovery skip. All qualifying targets are
returned; there is no winner or default Brain cooldown/character quota.

The latest player/narrator exchange establishes changes. Up to three complete
exchanges remain available to resolve pronouns, short answers, participant
identity, message receipt and explicitly established off-screen disclosure. A
name in old context only nominates a potential participant. The model must find
a relevant latest change; an absent mention does not establish knowledge. This
is a semantic contract, not a claim that application code guarantees model recall.

Plot Essentials retains premise/constraints, Active Pressure external threat or
obligation, Current Arc established arc progress with Director controls preserved,
Character cards enduring profiles, Lore observable events/shared developments and
Brains supported private interpretations. Private Brain text is not supplied to
public generation/discovery as canon. Shared assessment sees each eligible Brain
for its own decision and explicitly forbids transferring that content to public
facts or another character. Authored conditions, explicit cooldowns, protected
review, source validation, chronology, uncertainty and multi-target changes stay.

Targeted generation and evidence/placement validation remain separate where
needed. Existing-card results commit before discovery, supplying handled factual
coverage. A valid negative additional-discovery decision skips its semantic call
with an inspectable reason, while the local identity scanner still produces
review-only nominations. A malformed or stale assessment leaves unfinished work.

## Coverage and application

`factCoverage` is shared by generation/review, discovery candidate processing,
Inbox insertion, equivalent suggestions and approval. Canon and proposed coverage
are separate: relevant suggestions include pending, approved, rejected and ignored
statuses, proposed facts or validated newFact, targets, participants and sources.
Newest-first relevance selection replaces whole-title substring matching and an
oldest-tail limit. Targeted generation and discovery receive this as duplicate
coverage, never evidence of story truth or character knowledge.

Local comparison uses conservative, narrow paraphrase forms for invitation
acceptance, research collaboration and attempted actions, with punctuation/date
line normalization. It never uses a broad similarity threshold, sorts actors,
removes negation or equates offered/accepted/attended, proposed/agreed/completed,
attempted/completed kisses or different private speakers. It intentionally misses
some free paraphrases; the shared semantic assessment also sees relevant recorded
and considered facts. Exact legacy Event Memory deduplication remains separate.

Fully covered candidates are suppressed before repair/review or targeted
generation where the assessment delta suffices. One handled fact does not silence
other facts in the source. On approval, the latest destination is checked again.
A fully covered draft records a no-op and retains the approved decision/provenance.
Partial overlap leaves the full draft pending for edit/revalidation, rather than
silently trimming a reviewed claim. Metadata-only patches remain eligible.

## Checkpoints, failures and accounting

Optional source metadata stores the assessment, failed-group target drafts and
completed parsed reviews. Completed groups cannot replay. Fingerprints bind reuse
to source evidence, relevant canon/reference content, target content/controls,
authored prompts and policy/schema versions. Discovery no longer hashes the full
card/component collections. Unrelated timestamps, adventure titles and unselected
archive changes do not invalidate work. Changed evidence or relevant controls do;
source revision and full destination checks still reject in-flight stale commits.
Full snapshots may refresh incidental metadata only after substantive dependencies
match. Cached drafts/reviews are noncanonical and excluded from narrator context.

Each failed group retains successful target work and successful reviews, including
the first correction review before a failed frozen-draft review. Valid generated
drafts survive failed validation. Invalid generated syntax/schema is classified
as local invalid output and regenerated on retry; reparsing it forever cannot fix
it. Transport errors use safe allowlisted provider categories. Semantic rejection
and valid no-change are completed decisions, not retryable provider failures.
No-change and placement none are processed before write-only fields are required.
Changed content/destination still requires separate review; its cache key differs.

Brain generation can select old keys to archive in its original patch; retained
text and new state are reviewed as one complete patch. The standalone archival
selection request was removed. Existing archive storage and deterministic budget
protection remain. Locally unchanged patches skip semantic review.

Actual HTTP accounting records source, group (shared for assessment), stage and
source-attempt number for assessment/generation/discovery/validation/repair.
Retry requests have attempt > 1. No dedicated Brain-maintenance request remains
in this automatic path. Reuse, suppression and skip records are decisions, not
HTTP counts or provider prompt-cache hits. Decisions exposes assessment results,
held target work and source request records. Diagnostics store no credentials,
raw HTTP bodies or private model reasoning. Intended factual drafts and structured
verdicts remain inspectable noncanonical retry data.

## Verification and remaining limits

Final validation: **904 tests passed across 84 files**; TypeScript/Vite production
build, production smoke (two local assets) and `git diff --check` passed.
The tracked feature branch already contained eight unpushed commits before this
scope. Pushing it would also publish that earlier work, so this scoped change is
committed locally; no push or deployment is performed. Existing Vite large-bundle warnings remain. Tests cover quiet calls,
identity nominations, accepted invitations, pronouns/short answers, private
attribution, off-screen knowledge boundaries, consecutive changes, multiple facts,
shared card/discovery coverage, paraphrases and approval ordering, changed outcomes,
partial failures, relevant/unrelated edits, no-change, malformed assessments,
manual retry and legacy recovery.

Mocked routing and request accounting are not real-model quality or latency
measurements. A larger shared prompt may change adherence/latency, and conservative
coverage can miss uncommon paraphrases. Significant detections remain semantic;
no keyword-only replacement, cadence increase, narration/config/context-budget
change or historical save consolidation was introduced.

## Implementation map

- `src/triggers/semanticEngine.ts`: `runMemoryCycle`, `generatedActionsFor`,
  `sendTargetedUpdate`, `defaultBrainPrompt`; shared assessment orchestration,
  target-work reuse, noncanonical coverage and one-patch Brain archival.
- `src/memory/memoryAssessment.ts` (new): `assessMemory`, `assessmentInputs`,
  `memoryDecisionState`, `fingerprint`; strict assessment, meaningful dependency
  digests and negative-decision transaction guard.
- `src/memory/factCoverage.ts` (new): `factKey`, `factsCovered`, `hasFactOverlap`,
  `proposalCoverage`, `relevantProposalCoverage`; pure conservative coverage.
- `src/memory/memoryDetection.ts`: `detectStoryCardProposals`; conditional discovery,
  newest-first fact inventory, pre-repair suppression and relevant checkpoints.
- `src/memory/storyCardSuggestions.ts`: `equivalentStoryCardSuggestions`; remove
  broad overlap-threshold merging of distinct developments.
- `src/memory/validateMemoryUpdate.ts`, `validateStoryCardProposal.ts`: no-write
  verdict handling, completed-review cache and separate corrected-draft review.
- `src/state/adventureReducer.ts`: `COMMIT_MEMORY_EVALUATION_GROUP`,
  `ADD_MEMORY_PROPOSAL`, `APPROVE_MEMORY_PROPOSAL`, `appendCardContent`; persist
  reusable work, reject stale decisions and suppress covered application.
- `src/providers/memoryCompletion.ts`: `sendMemoryCompletion`,
  `memoryGroupProvider`; stage/source/group/attempt attribution and request guards.
- `src/providers/apiCallAccounting.ts`: `fetchWithAccounting`; attach attribution
  to each actual HTTP record. `src/types/adventure.ts` adds optional typed metadata.
- `src/pages/MemoryDecisionsPage.tsx`: show shared group decisions, held target
  work, completed reviews and actual source requests.
- `src/memory/sharedAssessment.test.ts` and `src/test/memoryAssessment.ts` (new):
  strict mocked replies and request-flow/coverage/retry regressions.
- Existing regressions updated for the contract: `originalFoundation.test.ts`,
  `loreDefaultPlacement.test.ts`, `storyCardArchitecture.cost.test.tsx`,
  `useAdventureRuntime.apiAccounting.test.tsx`, `useAdventureRuntime.memoryWorker.test.tsx`,
  `useAdventureRuntime.onePass.test.tsx`, `BrainsPage.preview.test.tsx`.
- `AGENTS.md`, `docs/foundation-migration.md`, `docs/story-card-architecture.md`
  and this document describe the new contract and retain historical measurements.

Inspected existing scheduler/evidence/provider/placement call sites in
`turnPipeline.ts`, `useAdventureRuntime.ts`, `memoryCycleState.ts`,
`memoryEvidenceWindow.ts`, `storyCardPlacement.ts` and `backgroundProvider.ts`
retain their established behavior; no source changes were needed there.
