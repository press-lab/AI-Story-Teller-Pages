# Assessment batching verification

Implemented on current main based on `6a75b0e`, which contains the requested baseline and Brain recovery fixes. No live provider was used.

Automatic assessment uses one actual HTTP request for up to three fresh narrator sources. One or two tracked sources wait for 120 seconds of idle time on a visible page. Manual selection remains immediate. Valid siblings are stored before downstream processing. Narrator/evidence edits block stale commits; relevant reference edits invalidate assessment reuse. Initial and compact-repair transport failures follow backoff without individual fan-out.

## Exact changed files and functions

| File | Added or modified functions / changes |
| --- | --- |
| `src/types/adventure.ts` | Add `MemoryAssessmentBatchSource`, checkpoint `assessmentSourceFingerprint`, attribution `batchSourceIds`, and `STORE_MEMORY_ASSESSMENT_BATCH`. Keep checkpoint version 1. |
| `src/memory/memoryAssessment.ts` | Extract unchanged `SHARED_MEMORY_ASSESSMENT_POLICY`; add `assessmentSourceFingerprint()` and `assessMemoryBatch()`; modify `assessMemory()` checkpoint reuse. Reuse `assessmentInputs()` without changing classification text. Pool exact messages, canon, Cards, Brains and Plot references. |
| `src/memory/assessmentValidation.ts` | Add `parseMemoryAssessmentBatch()`; retain `parseMemoryAssessment()` for each source with its own eligible conditions and evidence. |
| `src/state/adventureReducer.ts` | Add guarded, idempotent batch-checkpoint storage in `adventureReducer()`. |
| `src/providers/memoryCompletion.ts` | Add `memoryBatchProvider()` to preserve cancellation guards and runtime batch attribution. |
| `src/triggers/semanticEngine.ts` | Add `buildMemoryAssessmentConditions()`; use it in `runMemoryCycle()` and batch preparation. Preserve group order, Brain batching, target-work reuse, generation and semantic validation. |
| `src/hooks/useAdventureRuntime.ts` | Modify `useAdventureRuntime()` effects, `prepareNarration()`, `startIndependentMemory()`, `startPostTurnWork()` and cleanup in `submitTurn()`, `continueTurn()`, `regenerateLastResponse()`. Add `armAssessmentIdleTimer()`, `isFreshAssessment()`, batch-size and deadline constants. Reuse the existing worker and `persistActions()`. |
| `src/test/memoryAssessment.ts` | Add `mockAssessmentBatch()`; modify `mockAssessment()` to recognize batch payloads. |
| `src/test/hogwartsAssessment.ts` | Modify `mockAssessmentHttp()` for the batch schema while retaining HTTP counts and approximate input/output tokens. |
| `src/memory/assessmentCost.test.ts` | Add identical-fixture standalone/batch HTTP, token, downstream and source-specific suggestion comparison. |
| `src/memory/sharedAssessment.test.ts` | Add regressions for separate events, private knowledge, malformed siblings, evidence/source/target edits, reload, downstream-failure reuse, cancellation, exact deduplication and long-history evidence windows. Update relevant Brain-edit expectations. |
| `src/hooks/useAdventureRuntime.memoryWorker.test.tsx` | Add fake-clock tests for batching, partial flush, reset, manual evaluation, switching/reload, hidden pages, active narration, stale edits, transport/repair backoff and usage counted once. Existing worker/recovery tests accelerate only the idle deadline. |
| `src/hooks/useAdventureRuntime.onePass.test.tsx` | Update idle/cadence expectations; retain finalized narration, correction, configuration recovery and historical-load checks. |
| `src/hooks/useAdventureRuntime.apiAccounting.test.tsx` | Verify 20 narration plus 7 assessment HTTP requests (last two sources flush at idle), usage, batch attribution and failure/reload accounting. |
| `src/hooks/storyCardArchitecture.cost.test.tsx` | Update all three twenty-turn scenarios to 7 assessment requests after partial idle flush. |
| `src/state/adventureReducer.test.ts` | Add the new action to exhaustive typed action coverage. |
| `docs/memory-assessment-batching.md` | This verification report. |

`validateStoryCardProposal()` already skips a second review for an unchanged accepted draft and retains its cache; it remains unchanged. Corrected drafts/placements still receive their required review. Existing `MemoryGroupWork.drafts` reuse of successful target results remains intact. Existing accounting retains `appCommit` and reports missing provider usage as unreported in API records.

## Identical-fixture offline measurements

Tokens below are deterministic approximations returned as mock provider usage, not real billed tokens. Standalone and batch paths use identical fixtures, positive decisions and downstream replies. Suggestions match exactly by source, category and content. Existing Lore deltas require zero generation calls.

| Scenario | Assessment HTTP | Repair HTTP | Downstream HTTP | Assessment input | Assessment output | All input / output | Mock cost difference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| three-durable-events | 3 -> 1 | 0 -> 0 | 3 -> 3 | 8872 -> 3596 | 362 -> 380 | 19317 / 676 -> 14041 / 694 | -0.005240 |
| three-no-change | 3 -> 1 | 0 -> 0 | 0 -> 0 | 8635 -> 3596 | 264 -> 281 | 8635 / 264 -> 3596 / 281 | -0.005005 |
| two-idle | 2 -> 1 | 0 -> 0 | 2 -> 2 | 5797 -> 3207 | 238 -> 252 | 12733 / 441 -> 10143 / 455 | -0.002562 |
| one-manual | 1 -> 1 | 0 -> 0 | 1 -> 1 | 2843 -> 2843 | 117 -> 117 | 6298 / 215 -> 6298 / 215 | 0.000000 |
| one-invalid-record | 3 -> 2 | 0 -> 1 | 3 -> 3 | 8872 -> 6550 | 362 -> 483 | 19317 / 676 -> 17804 / 1159 | -0.000547 |

The malformed-record case uses one batch call, one compact repair and one individual fallback. Both valid siblings survive. Transport failures instead defer unfinished sources to existing backoff.

Mock cost uses synthetic rates of 1 per million input tokens and 2 per million output tokens, identically on both sides. These are test-only units, not provider pricing assumptions or actual API dollar savings. The normal three-event case saves 5,258 total mocked tokens: 5,276 fewer input tokens and 18 additional output tokens, reducing synthetic cost by 0.005240 units. Actual savings require new provider usage after deployment, isolated by `appCommit`.

## Validation and limitations

- `npm test`: 90 test files passed; 1,034 tests passed; 0 failed.
- `npm run build`: passed (TypeScript and Vite), with the existing large-chunk advisory.
- `npm run smoke:prod`: passed; two production assets loaded successfully.
- `git diff --check`: passed.

No source-specific suggestion regression was observed in the offline fixtures: invitation acceptance and the separate research agreement remain separate; an attempted kiss remains an attempt; private Brain targets stay character-specific; absent characters receive no target; routine exchanges add no proposals. Mocks establish routing, evidence boundaries and accounting, not live-model semantic quality.

No saved story data, narration prompts, detection policy, approval settings, UI, provider pricing assumptions or Brain batching policy were changed.
