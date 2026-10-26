# Brain batch recovery verification

Implemented against `9557e39` (the commit after `6fda8ab`).

## Changed files and functions

| File | Changes |
| --- | --- |
| `src/memory/brainBatchRecovery.ts` | New `reconcileBrainBatchState`: indexed current story-source validation, buffer deduplication, ordered salvage, frozen reservation and draft/cache release, Brain group completion. No provider requests or proposal application. |
| `src/memory/memoryEvidenceWindow.ts` | New `brainBatchEvidenceMessages`: resolves one to three explicit narrator sources and immediately preceding story inputs; rejects missing/OOC sources. `memoryEvidenceWindow` unchanged. |
| `src/memory/validateMemoryUpdate.ts` | `validateMemoryUpdateUncached` uses explicit batch evidence; `validateMemoryUpdate` fingerprints current batch evidence, target Brain state, patch, ordered IDs, and policy. Semantic identity, knowledge and meaningful-change checks retained. |
| `src/memory/memoryAssessment.ts` | `assessmentInputs` builds stable source identity from revision, ordered evidence and eligible IDs/conditions plus contract version; `assessMemory` reuses valid decisions, with legacy full-fingerprint fallback. Full downstream fingerprints remain. |
| `src/types/adventure.ts` | Optional `MemoryAssessmentCheckpoint.sourceFingerprint`. No migration version added. |
| `src/state/adventureReducer.ts` | `reduceAdventure`: UPDATE_MESSAGE, DELETE_MESSAGE, DELETE_LAST_MESSAGE, REMOVE_LAST_ASSISTANT_MESSAGE and COMMIT_MEMORY_EVALUATION_GROUP reconcile buffers and reject stale batches. `undoStoryEdit`/`redoStoryEdit` use new `reconcileStoryHistory` and `reconcileStoryMutation` helpers to preserve history, invalidate changed evidence and salvage deleted-owner checkpoints. |
| `src/state/defaults.ts` | `normalizeAdventure` reconciles once after normalization. |
| `src/triggers/semanticEngine.ts` | `runMemoryCycle` reconciles before automatic selection and reuses frozen batches only on matching work fingerprints. `generatedActionsFor` returns `memory_brain_batch_source_stale` without provider calls on source mismatch. |
| `src/memory/sharedAssessment.test.ts` | Recovery, ordering, malformed types, deleted owners, idempotency, no approved-patch replay, older evidence, cache invalidation, subsequent automatic processing, genuine edits, eligible conditions and legacy checkpoint regressions. |
| `src/hooks/useAdventureRuntime.memoryWorker.test.tsx` | Runtime edit/delete/last-delete/remove-assistant, undo/redo, reload and pending-generation stale-result regressions; existing pending-validation cancellation retained. |
| `src/memory/assessmentCost.test.ts` | Identical mocked HTTP harness measures four required request-count scenarios against pre-fix and repaired code. |
| `src/memory/assessmentTransport.test.ts` | Reassessment failure integrity test now changes the source revision to require reassessment; existing appCommit logging assertions retained. |
| `docs/brain-batch-recovery-verification.md` | This verification record. |

## Verification results

- `npm.cmd test`: 90 test files, 1,013 tests passed.
- `npm.cmd run build`: passed TypeScript and Vite; bundle size advisory remains.
- `npm.cmd run smoke:prod`: passed; both production assets loaded.
- `git diff --check`: passed.
- All regression requests use mocked providers/HTTP. No paid requests were made.

## Measured request counts

The identical new HTTP harness was run against an isolated archive of `9557e39` and the repaired source. These are offline request counts, not measured billing or model-quality results.

| Scenario | Assessments before -> after | Brain generations before -> after | Other requests after |
| --- | --- | --- | --- |
| Edited source retry | 1 -> 1 | 0 -> 0 | 0; the newly qualifying delta is buffered until batching is due |
| Unchanged source, proposal status changed pending -> approved, discovery unfinished | 1 -> 0 | 0 -> 0 | 1 discovery, using current coverage |
| Stale frozen batch cleanup on normalization | 0 -> 0 | 0 -> 0 | 0; baseline left stale work stranded, repaired code releases it |
| Valid three-source automatic batch | 3 -> 3 normal per-turn assessments | 1 -> 1 | 1 validation; zero extra assessments beyond normal turns |

The stale frozen fixture previously retained sources one and two (including edited two); recovery retains valid one and three and completes the interrupted old Brain group. Subsequent automatic processing is separately tested with one new per-turn assessment, one Brain generation and one validation.

## Buffer recovery and limits

The 13-entry regression fixture has three edited and three deleted sources: reconciliation discards six invalid deltas and preserves seven valid deltas with unchanged text, evidence IDs and source turns. Repeated reconciliation makes no requests, proposals or approvals. The three-source failed-batch test preserves the first and third deltas, clears frozen work and reservations, and processes survivors on a subsequent automatic cycle.

The accessible local Hogwarts exports and synchronized saves predate this buffer. The six/seven result above is measured on the mocked regression fixture, not a claim that the newer user export was repaired. No save JSON was changed.

No implementation acceptance criterion remains unmet in the mocked regression suite. The specific newer Hogwarts export was unavailable for direct replay. Per-turn assessment frequency, the general evidence window, three-narrator limit, manual Brain behavior, approval settings, narration, UI, classification, and semantic policy remain unchanged. Existing appCommit API logging is retained.
