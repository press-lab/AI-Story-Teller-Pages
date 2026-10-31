# Portable memory history compression

Background memory-history compression is disabled at the application level by `ENABLE_HISTORY_COMPRESSION = false`, independently of debug logging. Re-enabling debug logging cannot restart compression. App calls `useMemoryHistoryCompression` unconditionally; both maintenance effects return before reading histories or scheduling work when the flag is false; no compression timers, scans, worker requests or archive save jobs run during normal gameplay, and no new compressed history blocks are generated.

Existing compressed archives remain readable on demand, including archived proposal restoration and integrity/error handling. Normal persistence continues through the existing save worker and save coordinator. With debug logging disabled, lightweight completed-evaluation compaction remains enabled; it omits completed debugging details without GZIP compression. Explicit debug-history cleanup remains available.

The sections below describe the **historical compression implementation**, retained for compatibility and isolated tests. Scheduling and archive-producing reducer actions are disabled in the current build. No provider, prompt, extraction, cadence, accounting or context policy changes are involved.

## Local history audit (October 30, 2026)

The inspected application checkout's remote is `press-lab/AI-Story-Teller-Pages`, with active branch `codex/fix-shared-memory-assessment`. The application worktree was clean before this task. No reset, revert, checkout, merge or rebase was used. The requested October 28 17:40 through October 30 17:40 (-07:00) interval contains the debug-default and existing disable commits below; the original compression implementation and delta-worker migration precede that interval. Patches were inspected, not inferred from titles.

| Exact local commit | Introduced behavior and affected functions |
| --- | --- |
| `3ac14fa66d2aea5d8022f3adea414581612635e5` (Oct 27 23:48:49 -07:00) | Original history machinery: `useMemoryHistoryCompression` maintenance `tick` and archive-save effects; `historyCodec.ts` `pack`, `unpack`, `transform`, `compressHistory`, `decompressHistory` with GZIP/integrity round-trip; `memoryHistoryWorker.ts` `request`/`pump`, `compressHistoryInWorker`, `readHistoryInWorker` and worker handler; `memoryHistory.ts` selection and proposal/evaluation compaction; reducer `ARCHIVE_MEMORY_HISTORY`, `MERGE_MEMORY_HISTORY_PROGRESS`, `APPLY_ARCHIVED_PROPOSAL_ACTION`; original `adventureDb.ts` `saveAdventure` immutable archive merging; runtime `publishHistorySnapshot` and `mergeQueuedUpdates`; on-demand `ArchivedMemoryDetails`/`ArchivedMemoryVersions`. |
| `10d537b555b3e29ab4846fc69b87ea60cf0d0f6f` (Oct 28 16:50:02 -07:00) | Delta persistence architecture: `adventureDbCore.ts` `writeAdventure` retains archive merging; `adventurePersistenceProtocol.ts` `createPersistencePatch`/`applyPersistencePatch`; persistence client/worker and save coordinator. Compression hook initializes its saved-history baseline from existing archives and requests background-priority saves. These persistence features remain intact. |
| `49f58ac1a3dd44149217b2f2078705bd2eb1f31a` (Oct 28 20:20:51 -07:00) | `MEMORY_DEBUG_LOGGING = false`; early returns in both compression effects and `nextHistoryRecord`; `eligibleHistory` excludes debug-omitted evaluations. `compactCompletedEvaluationWithoutDebug` and explicit `pruneDebugHistory` remain separate from GZIP. `writeAdventure` generation guard prevents cleanup resurrection. |
| `d9b6e474335c12f7f5cb91f94348cdfc111d23e2` (Oct 30 11:18:28 -07:00) | Already disabled automatic compression independently of logging, gated selector and archive-producing reducer actions, and removed App's hook mount. This task keeps those gates, names the single flag `ENABLE_HISTORY_COMPRESSION`, and restores an unconditional hook call whose effects exit before maintenance starts. |
| `900e1145fed7798074610244771f7afda45069ef` (Oct 30 11:54:11 -07:00) | Test-only Web Crypto buffer compatibility for old archive fixtures; preserved. |

Later Story Card approval commits `4c533bdb0ba9d4504a896f9b8fe9c4b3790a5dd2` and `f382980a7c8144eec5affc9253f3659a6114b7f8`, and chained retrieval commit `2dd2527b8b6ef1af50784951306e2e6f36730e72`, remain ancestors of the current branch. Normal reducer behavior is unchanged; its only edit here renames the existing compression flag import and two history-only guards. No codec, database, protocol, semantic engine, Story Card policy, context budget, memory detection, approval rule, rolling summary or scene-state implementation was changed.

## Storage and active behavior

`activeState.compressedMemoryHistory` is a versioned manifest of immutable blocks. Each block identifies its record kind and ID, codec version, decoded byte count and SHA-256 digest, and contains Base64 GZIP data. A typed JSON representation preserves unknown fields, property order, optional undefined values, sparse arrays and exact string code units. Tags are structural containers, never interpreted inside arbitrary user objects.

Every archived block contains the **complete original** proposal or evaluation object. Completed evaluation checkpoints retain their status, attempts, revision, batch, counts and completed groups in the active record. Bulky references, evidence, findings, dispositions, assessments and completed work remain in the original archived object. Pending, running, failed and quarantined evaluations are ineligible, including successful drafts and reviews retained for retries. Editing a completed source retains its earlier archived version; claiming its explicit retry clears the old archive marker and uses the existing fresh-checkpoint preparation.

Historical proposals retain their content, title, status, source text/IDs, triggers, participants, event metadata and other routing fields. The compact representation removes placement-validation target/fingerprint copies, and approved proposals' evaluation-source target copies. It retains validation new facts and source IDs, every evidence string used by `suggestionSourceValid`, and rejected/ignored evaluation target snapshots needed for exact destination validity. This deliberately bounds the achievable size reduction without replacing equality with hashes or changing historical suppression. Fact coverage and relevant coverage preserve array order and their existing limit. Historical approval/edit actions restore full evidence in one reducer operation before invoking the existing action. Pending proposals are untouched.

## Worker, concurrency and failure handling

One module Web Worker serves compression and requested decompression. One record is processed at a time; queued explicit detail reads take priority over maintenance. The app waits 500 ms before starting maintenance and yields 100 ms between records. There is no whole-adventure worker transfer or recompression of archived blocks. A 32 MiB decoded record limit and depth limit bound codec allocations; unsupported records or browsers retain their originals and report an error. Production code imports the codec only inside the worker.

Compression immediately decompresses and verifies the exact packed representation before returning a block. The reducer checks adventure identity, record identity and the original immutable object reference against the latest state before storing both the block and compact replacement together. It rejects changed records, duplicate commits and adventure switches. Narration publication merges archive progress committed during a pending provider request; this changes storage only, not provider messages or memory results.

Persistence queues writes per adventure. The previous archive and incoming blocks are merged inside the same IndexedDB transaction as the complete adventure and library summary. Concurrent older snapshots cannot erase committed blocks. Aborts and quota failures retain the previous complete save; the current immutable state still contains the verified archive. Maintenance persistence retries after failure and clears its warning after success. Closing a session during a job leaves the previous full save intact. There is no automatic archive garbage collection or deletion.

## Inspection and compatibility

Memory Decisions exposes original archived evaluation details and earlier versions on demand. Memory Inbox displays compact historical proposals and restores full details only when requested. Corrupt, missing and unsupported blocks report an explicit error and remain preserved. Closing the details view releases its decoded copy. No archive is expanded merely by loading an adventure.

Existing normalization and credential sanitization preserve the optional manifest without decoding it. Existing JSON exports, duplicate imports, IndexedDB copies, GitHub saves and cloud wrappers carry the complete same-adventure JSON, including the manifest. Old and mixed saves retain their existing blocks without automatic migration or expansion. These backups require an app version that understands the new archive for full inspection; older versions cannot display compressed details. Backup size is calculated during an explicit download, with no full-adventure serialization during page rendering.

## Current disabled-build verification

Run `node scripts/memory-history-disabled-browser.mjs` after `npm.cmd run build`. It uses an isolated temporary Chromium profile, a synthetic historical archive and mocked providers against the production preview. An optional read-only large adventure is supported through `STORY_TELLER_SAVE_FIXTURE`. Development modules only construct the fixture. The harness accelerates the existing 120-second memory-assessment idle flush to 100 ms; it does not change application scheduling code.

Chrome 156 on Windows: three narration requests and three memory requests completed three evaluations. Instrumentation observed zero compression jobs, zero history-worker starts, zero timers at the historical compression scheduler's 500/2000 ms delays, and zero additional save-worker requests over a subsequent 6.5-second idle window. One normal persistence worker handled 16 save requests, including 15 deltas; existing archive blocks survived unchanged. With no compression jobs or history worker, no compression-triggered database writes occurred. No long tasks of 50 ms or more were observed in this small synthetic run.

These are activity checks, not a before/after latency benchmark. No measured speed improvement is claimed. Large-save parsing, normalization, explicit JSON exports and other unrelated work may still cause lag; this synthetic run does not diagnose those costs. Hook regressions additionally verify no timeout/interval scheduling or save calls with debug logging both off and on.

## Matched large-adventure verification (October 30, 2026)

Before: production build at `900e1145fed7798074610244771f7afda45069ef`. After: production build with this task's scoped flag/hook edits. Compression was already disabled in the baseline; these measurements do not compare an enabled compressor against a disabled one, and do not establish a performance improvement.

Both runs used the same read-only 41,065,854-byte local adventure (1,042 messages and 307 proposals), Chrome 156 desktop/headless, a fresh temporary profile and isolated IndexedDB. Each test copy adds the same small synthetic archived proposal before instrumentation so old-archive preservation is observable. The source file's SHA-256 was verified unchanged after each run. Three mocked narration calls and two batched memory calls completed all three new narrator evaluations in both runs. Existing batching settings also completed three other queued evaluations. The existing 120-second assessment idle flush is accelerated to 100 ms only inside the test harness. All external provider requests are blocked; no paid calls were made.

| Observed metric | Before | After |
| --- | ---: | ---: |
| Largest main-thread gap | 4,904.7 ms | 4,840.3 ms |
| First autosave completion | 2,596.8 ms | 2,561.2 ms |
| Median worker save request to commit acknowledgement (12 saves) | 259.6 ms | 257.3 ms |
| Final save JSON size | 41,077,204 bytes | 41,077,204 bytes |
| History-compression jobs | 0 | 0 |
| History GZIP encoding calls | 0 | 0 |
| History GZIP decoding/verification calls during gameplay | 0 | 0 |
| History worker starts / compression timers | 0 / 0 | 0 / 0 |
| Committed full-adventure IndexedDB writes | 12 | 12 |
| Persistence requests sent as deltas | 11 | 11 |
| Compression-triggered writes / subsequent idle saves | 0 / 0 | 0 / 0 |
| Existing archive manifest and block bytes preserved | Yes | Yes |

The gap is the largest interval of a native 10 ms main-thread timer across load, gameplay and idle observation, excluding fixture construction and final JSON export. First-autosave timing starts inside the 350 ms autosave callback, before `saveAdventure`, and ends at the first worker commit acknowledgement; it includes preparation, worker startup and main-thread acknowledgement delay but excludes the debounce. Median save timings start at worker dispatch and therefore exclude caller-side preparation. Save size is the final IndexedDB adventure serialized with the export's two-space JSON layout.

Full-adventure database writes remain part of the existing architecture: incremental transport sends deltas to a persistence worker, which reconstructs and commits a complete adventure. No history-compression job caused any of these writes. Archive bytes were unchanged and no history decoding occurred during load/gameplay. Multi-second stalls remain; this scoped change does not diagnose or fix their cause. Small timing differences in this single matched pair are not evidence of improvement.

Validation: 112 test files passed; 1,837 tests passed and two optional fixture-dependent tests were skipped. The focused history/persistence/logging/approval run passed 137 tests (two optional skips). `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run smoke:prod`, and `git diff --check` passed. The build retains its existing large-chunk warning. Production browser checks passed with the large adventure; the original small synthetic mode remains available.

To reproduce the large run, set `STORY_TELLER_SAVE_FIXTURE` to a private local adventure JSON and optionally `STORY_TELLER_VALIDATION_REPORT` to an aggregate report path, then run `node scripts/memory-history-disabled-browser.mjs` after building. The source adventure is never written or included in Git. The original codec and worker implementations remain in place, including typed JSON GZIP/Base64 reads, integrity checks, malformed-archive errors and explicit on-demand details.

## Historical validation and desktop measurements

These historical benchmarks do not measure the current disabled build or establish a current performance improvement.

The private local fixture was read without modification or inclusion in Git. It has 307 resolved proposals and 180 completed evaluations, plus substantial failed/quarantined history that remains active. This is the available 41 MB fixture, not the later 53.12 MB save mentioned in the task.

Actual headless Chrome 156 on Windows using Vite development modules, medians of three repetitions where applicable. These are local comparisons; the production build is validated separately:

| Measurement | Original | Archived |
| --- | ---: | ---: |
| Portable JSON bytes | 41,065,854 | 22,204,929 |
| JSON parse | 64.8 ms | 31.1 ms |
| JSON serialize | 184.8 ms | 81.8 ms |
| IndexedDB save transaction | 238.0 ms | 115.4 ms |
| IndexedDB load + normalization | 77.3 ms | 39.4 ms |
| Memory Inbox React mount | 607.6 ms | 11.4 ms |
| Memory Decisions React mount | 83.4 ms | 74.9 ms |

JSON is **45.9% smaller (1.85:1)**. Compression and exact verification of 487 records took **1,777 ms** through the actual worker; individually reading every block for benchmark verification took 826 ms. Normal loading does not do that decoding. A frame counter advanced 108 times during the worker/reducer loop, with no observed main-thread task of 50 ms or more. The largest synchronous record `postMessage` cost was 0.6 ms. This isolates worker/reducer responsiveness from fixture preparation and does not claim full live-play latency. The normal scheduler adds its deliberate inter-record pauses, so incremental migration wall time is longer than this worker benchmark.

These are desktop measurements, **not actual mobile hardware or Safari tests**. Initial parsing/normalization and explicit JSON downloads still use the main thread. Failed-work evidence, the Chronicle, active destination records and exact historical validity fields remain uncompressed by design; reduction depends on their share of a save. No claim of a 3.71 MB result is made for this different fixture.

Regression/integration tests cover exact recovery, real provider payload equivalence, historical routing/coverage/suppression/approval, unfinished work, interrupted workers, corrupt blocks, stale results, aborted persistence, queued saves, earlier versions after retry, old/mixed/compressed JSON, duplication, on-demand inspection, explicit backup serialization and narration/evaluation proceeding while compression is unresolved. Network responses in tests are mocked; no additional LLM requests are made by compression.

The following utilities cover the historical enabled implementation (the browser compression benchmark is not a current disabled-build performance test). Private-fixture equivalence and Node aggregate timings:

```powershell
$env:STORY_TELLER_SAVE_FIXTURE = 'C:/path/to/private-save.json'
npm.cmd test -- src/memory/memoryHistory.test.ts
```

Run the actual desktop browser benchmark with the same environment variable:

```powershell
node scripts/memory-history-browser-benchmark.mjs
```

`HISTORY_BROWSER` can select a Chromium executable; otherwise the script checks standard Chrome/Edge/Chromium locations. `STORY_TELLER_VALIDATION_REPORT` optionally writes aggregate metrics, never fixture content. The browser runs with an isolated temporary profile and origin. Required repository checks remain `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run smoke:prod`.
