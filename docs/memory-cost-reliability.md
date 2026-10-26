# Memory cost and reliability correction

BLUF: Keep the current Lore, trigger, attribution, and placement rules. Remove redundant assessment work and paid repair chains. Use the same source evidence for Brain generation and review. Preserve successful work. Require an explicit retry after a failure.

The user withdrew the fixed dollar target. The objective is useful, reliable memory per paid request. This change does not reduce the number of eligible memories or increase the assessment batch size.

**Save evidence**

Both supplied attachments have SHA-256 `d3a8d1f1fbb35043d261b3b660e7ca22e6d704bfdd8ecc772c16602076269f79`.
The export contains 825 messages, 418 assistant messages, 500 retained API records, and 600 retained memory diagnostics. The retained call window is 2026-10-26 03:00:01 through 16:51:26 UTC. The messages start on October 24. This export cannot establish last week's daily cost.

The deployed build is `81e8c3e3b77022f3bb3b6ffd3c7374a45c9d580f`. The original local checkout was `23394fd0b31cbd23bf6138426760225c40110254`. The correction starts from the deployed build, which includes assessment batching.

| Observed build | Retained calls | Saved assistant replies | Estimated session USD at its time | Same usage at off-peak USD |
| --- | ---: | ---: | ---: | ---: |
| `9bc1d7f` | 156 | 23 | 0.22579 | 0.22579 |
| `6fda8ab` | 188 | 41 | 0.61214 | 0.30607 |
| `81e8c3e` | 59 | 7 | 0.08798 | 0.08798 |

These are session totals, not controlled experiments. Each reply count includes one OOC reply. Calls can include corrections, regeneration, and recovery for older sources. Usage is missing from three, one, and one records respectively. Missing usage is not a confirmed zero charge. The latest session contains six in-story responses and one OOC response. It is not a completed steady-state sample.

At equal off-peak rates, the two earlier session totals correspond to about $9.82 and $7.47 per 1,000 saved assistant replies. This suggests that the earlier fix helped. The second session's peak tariff masks that reduction. It does not prove a causal saving because the story work differs.

| Latest build stage | Calls | Estimated USD |
| --- | ---: | ---: |
| Narration | 7 | 0.015455 |
| Assessment | 7 | 0.020161 |
| Target generation | 11 | 0.022355 |
| Validation | 28 | 0.021783 |
| Discovery | 5 | 0.007800 |
| Format repair | 1 | 0.000428 |
| Total | 59 | 0.087982 |

One assessment was still running. Memory accounts for about 82% of the known cost. Two completed three-source batches cost about $0.0097. Four later completed assessments for already-batched sources cost about $0.0105. A fifth repeated assessment had no usage yet. Eighteen calls carry attempt 2 and cost about $0.02963; those calls are not all proven avoidable. Sixteen Brain calls are attributed to older sources and cost about $0.01520. Those categories overlap and must not be added.

Use the recorded `appCommit` for attribution. Do not infer a deployed build from a commit timestamp. Ninety-seven retained calls have no build identity; some used GLM. They are excluded from this build comparison. The aggregate lifetime totals lack enough cache and model detail to reconstruct a full historical bill.

DeepSeek Flash list rates, checked October 26, are $0.15 per million uncached input tokens, $0.003 per million cached input tokens, and $0.60 per million output tokens off-peak. Peak rates are double. These estimates use the timestamp of each request. See [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).

The Anthropic adapter stores raw `input_tokens` in `promptTokens`. That value excludes cache reads. Add the cache charge; do not subtract cache reads again. In this export, 195 records have more cached tokens than stored prompt tokens. See [Anthropic token accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [DeepSeek compatibility](https://api-docs.deepseek.com/guides/anthropic_api/). No provider invoice was supplied. No live paid calls were made for this change.

**Commit findings**

| Commit | Relevant behavior | Decision |
| --- | --- | --- |
| `f77c1a1` | Generates reusable Story Card topic triggers. | Keep the trigger policy. |
| `728ede2` | Routes events to Lore and requires evidence for enduring Character changes. | Keep the placement policy and exact evidence checks. |
| `4114061` | Shares assessment across four groups and saves work checkpoints. | Keep the architecture. Correct reuse invalidation. |
| `9bc1d7f` | Normalizes assessment output and adds bounded paid repair. | Keep deterministic normalization. Remove the extra repair request. |
| `6fda8ab` | Batches Brain deltas and uses existing Lore assessment drafts. | Keep both savings. Correct the evidence mismatch. |
| `6a75b0e` | Adds explicit old-source Brain evidence for validation and recovery. | Give generation the same old-source evidence. |
| `eab8ece`, merged in `81e8c3e` | Batches up to three assessments, but includes mutable references in reuse identity. | Preserve decisions across verified automatic writes when eligible conditions remain unchanged. |
| `23394fd`, merged in `81e8c3e` | Aligns controls with runtime behavior. | Preserve control and approval behavior. |

**Correction procedure and implemented locations**

Line numbers refer to the correction branch. Use the function name if a later edit moves a line.

| File and line | Function or block | Correction |
| --- | --- | --- |
| `src/memory/memoryAssessment.ts:71` | `assessMemory()` | Reuse a valid assessment after a verified automatic reference update. Send only message IDs, roles, and content in latest-turn evidence. Stop after an invalid response. Do not buy a format repair. |
| `src/memory/memoryAssessment.ts:117` | `memoryDecisionState()` | Ignore the legacy Story Card `lastAutoUpdateTurn` counter. Keep checks for content, controls, evidence, and destinations. |
| `src/memory/memoryAssessment.ts:143` | `assessmentSourceState()` | Record exact classification dependencies for unfinished work. Include policy, source, conditions, canon, Cards, Brains, and Plot. |
| `src/memory/memoryAssessment.ts:154` | `assessMemoryBatch()` | Put reference pools before changing evidence. Save each valid sibling. Return invalid source IDs without a paid repair or individual fallback. |
| `src/memory/memoryAssessment.ts:228` | `rebaseAutomaticAssessments()` | Compare the saved state with the state before an automatic reducer write. Update the reuse state only when that comparison matches and eligible conditions are unchanged. Use the same evidence window as runtime evaluation. Never hide an earlier author edit. |
| `src/state/adventureReducer.ts:1124` | `adventureReducer()` | Refresh assessment reuse after automatic memory writes. Keep all writes inside reducer actions. |
| `src/state/adventureReducer.ts:1252` | `COMMIT_MEMORY_EVALUATION_GROUP` | Preserve the refreshed checkpoint across later group commits. Remove the extra dependency snapshot when all groups complete. |
| `src/triggers/semanticEngine.ts:383` | `sendTargetedUpdate()` | Use the queued Brain source IDs for generation. Do not use the current unrelated scene. Serialize only evidence fields. |
| `src/triggers/semanticEngine.ts:468` | `generatedActionsFor()` | Retain valid drafts after transport failures. Remove a semantically rejected Brain draft before an explicit retry. Do not pay to review the same rejected draft again. |
| `src/memory/memoryEvidenceWindow.ts:33` | `brainBatchEvidenceMessages()` | Collect the bounded evidence window for each queued source. Give generation and validation the same evidence. Exclude later events. |
| `src/memory/memoryDetection.ts:93` | `detectStoryCardProposals()` | Move source-specific instructions out of the shared system prefix. Keep exact quote checks. Reject invalid evidence without an extra repair request. |
| `src/hooks/useAdventureRuntime.ts:426` | `startIndependentMemory()` | Save valid batch siblings. Mark invalid siblings for explicit retry. Do not start individual fallback assessments. |
| `src/memory/memoryCycleState.ts:8` | `memoryCycleSources()` | Exclude failed entries from automatic scheduling. Keep manual retry available. |
| `src/types/adventure.ts:90` | `MemoryAssessmentCheckpoint` | Add optional `reusableState` data. Retain compatibility with older checkpoints. |
| `src/pages/MemoryDecisionsPage.tsx:56` | Memory decisions explanation | Tell the user that failed entries require Retry. |

The stale-counter defect was reproduced. Runtime evaluation used the historical source turn, while reducer replay used the current turn. The resulting counter difference discarded later Brain and discovery groups even though Story Card content matched. The regression now completes all four groups after three real automatic Lore appends with one assessment request and all three distinct memories retained.

The Brain regression uses two queued old sources and a later unrelated source. Generation and review now receive the same old evidence. The request excludes the unrelated event and saved memory/accounting metadata.

The assessment reuse boundary is deliberate. A relevant author edit or eligible-condition change still requires a new assessment. Source edits still reject stale results. Completed groups still cannot replay. Existing successful sibling draft and review checkpoints remain available for explicit recovery.

DeepSeek uses prefix matching for caching and ignores Anthropic `cache_control` markers. Stable prompt content must precede changing source data. See [DeepSeek caching](https://api-docs.deepseek.com/guides/kv_cache/). Cache savings remain provider-dependent; this change does not claim a measured live cache-hit improvement.

**Verification and use**

1. Run `npm.cmd test`.
2. Run `npm.cmd run build`.
3. Run `npm.cmd run smoke:prod`.
4. Confirm that a successful three-source batch does not send another assessment after ordinary automatic appends with unchanged eligible conditions.
5. Confirm that an author edit invalidates the affected saved assessment.
6. Confirm that malformed batch output keeps valid siblings and sends no repair or fallback request.
7. Confirm that later story turns do not retry a failed request.
8. Confirm that explicit retry preserves completed groups and successful target work.
9. Confirm that Lore placement, distinct events, exact quotes, private knowledge, protected targets, and trigger tests pass.
10. Compare provider tokens for completed narrator sources after release. Separate new work from old recovery, OOC replies, and peak tariffs.

The automated suite checks routing and request behavior. It does not prove that a live model will never return invalid output. Required semantic validation and final review of corrected drafts remain. Removing automatic repair means an invalid result can remain unfinished until the user selects Retry. The app does not silently accept it or convert it to a negative discovery decision.

The attached save was not modified. Narration prompts, memory eligibility rules, trigger generation rules, and per-type approval preferences were not reduced to obtain a lower cost.

Validation completed: 91 test files passed, 1,051 tests passed, TypeScript and Vite build passed, production smoke passed with two assets loaded, and `git diff --check` passed. The build retains the existing large-bundle advisory. No live model quality or billed-cost reduction is claimed.
