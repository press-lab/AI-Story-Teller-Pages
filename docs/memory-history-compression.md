# Portable memory history compression

Background memory-history compression is disabled at the application level by `MEMORY_HISTORY_COMPRESSION_ENABLED = false`, independently of debug logging. Re-enabling debug logging cannot restart compression. App no longer mounts `useMemoryHistoryCompression`; no compression timers, scans, worker requests or archive save jobs run during normal gameplay, and no new compressed history blocks are generated.

Existing compressed archives remain readable on demand, including archived proposal restoration and integrity/error handling. Normal persistence continues through the existing save worker and save coordinator. With debug logging disabled, lightweight completed-evaluation compaction remains enabled; it omits completed debugging details without GZIP compression. Explicit debug-history cleanup remains available.

The sections below describe the **historical compression implementation**, retained for compatibility and isolated tests. Scheduling and archive-producing reducer actions are disabled in the current build. No provider, prompt, extraction, cadence, accounting or context policy changes are involved.

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

Run `node scripts/memory-history-disabled-browser.mjs` after `npm.cmd run build`. It uses an isolated temporary Chromium profile, a synthetic historical archive and mocked providers against the production preview. Development modules only construct the fixture. The harness accelerates the existing 120-second memory-assessment idle flush to 100 ms; it does not change application scheduling code.

Chrome 156 on Windows: three narration requests and three memory requests completed three evaluations. Instrumentation observed zero compression jobs, zero history-worker starts, zero timers at the historical compression scheduler's 500/2000 ms delays, and zero additional save-worker requests over a subsequent 6.5-second idle window. One normal persistence worker handled 16 save requests, including 15 deltas; existing archive blocks survived unchanged. With no compression jobs or history worker, no compression-triggered database writes occurred. No long tasks of 50 ms or more were observed in this small synthetic run.

These are activity checks, not a before/after latency benchmark. No measured speed improvement is claimed. Large-save parsing, normalization, explicit JSON exports and other unrelated work may still cause lag; this synthetic run does not diagnose those costs. Hook regressions additionally verify no timeout/interval scheduling or save calls with debug logging both off and on.

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
