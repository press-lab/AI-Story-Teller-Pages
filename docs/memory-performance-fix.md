# Memory lookup and save responsiveness

This change fixes the repeated work reproduced with the attached 17.87 MB save. It preserves the memory workflow, provider messages, exact source/destination guards, approval policy and accounting. No private save content is included in the repository.

## Search and batch preparation

`relevantStoryCardInventory()` normalizes the excerpt once per lookup, with unchanged scoring, stable ordering, truncation and result fields. A bounded cache retains at most sixteen exact excerpts and one million text code units for the current adventure/card collection. A WeakRef avoids retaining the card array after its adventure is closed. The exact card metadata signature invalidates cached results even for callers that modify fixture objects in place. Returned arrays are copied so callers cannot corrupt cached results.

Only inventory lookup results are cached. Evidence, coverage, controls, canon and transaction validation continue to use the current state. `relevantProposalCoverage()` also normalizes its excerpt once. The single-pass reference pool indexes exact serialized values once, preserving first-reference ordering and all aliases without repeatedly serializing earlier entries.

## Persistence

`adventureDb.ts` coordinates requests across the runtime, routine autosave and compression maintenance. Identical in-flight requests share their acknowledgement. Successful states are tracked weakly for routine-save deduplication. Pending routine saves for one adventure can be replaced by the newest request, moved after intervening checkpoints. Joining a routine request as a checkpoint upgrades it so it cannot be coalesced away. Explicit checkpoint requests remain ordered durability barriers; success is acknowledged only after commit.

`adventurePersistenceClient.ts` sends an initial sanitized snapshot to one module worker. Subsequent requests contain changed records, changed fields and new archive blocks. Unchanged historical records and Base64 data remain in that worker. The transport preserves object key order, unknown fields, optional undefined values, array ordering and sparse slots. It changes neither the stored JSON schema nor the database schema.

`adventurePersistence.worker.ts` assembles a complete Adventure and calls the existing atomic database path, now in `adventureDbCore.ts`. That path still merges previously stored archive blocks and writes the entire adventure and library summary in the same transaction. Full database copying now happens in the worker. IndexedDB still uses the same database and stores; saves and JSON backups remain complete, self-contained adventures.

Only one persistence request runs at once. Revision/adventure IDs reject stale deltas. Worker errors, message errors, timeouts and aborted transactions reject the save and invalidate its mirror; the next request sends a complete snapshot. A late event from an old worker cannot affect a replacement. Closing/switching the adventure releases the worker after its queued requests finish. A browser without Worker support uses the existing atomic main-thread path for compatibility.

Compression's maintenance timer starts from the current archive manifest, avoiding an unnecessary save of an already-compressed adventure on open. Both routine save paths use the same coordinator. Checkpoint timing in the memory evaluator is unchanged.

## Attached-save verification

Actual desktop headless Chrome, Vite development modules, real PlayPage/runtime/autosave/compression hooks, mocked provider responses, disposable IndexedDB copies. The attached file remained unchanged. These are local diagnostic samples, not mobile measurements or production-device latency guarantees.

| Measurement | Before | After |
| --- | ---: | ---: |
| Three-source memory preparation | 2,111 ms | 58.5 ms |
| Largest frame gap during explicit memory check, compression enabled | 3,328 ms | 114 ms |
| Largest frame gap with compression disabled | 3,366 ms | 102 ms |
| Serialization calls in separately instrumented preparation | 8,694 | 330 |
| Full adventure reads/writes on screen thread during memory check | 7 / 7 | 0 / 0 |
| Save operations during that check | 7 | 5, in persistence worker |
| Already-compressed startup writes | 2 | 1, in persistence worker |

The observed source batch retained the same 932,918 reference-string code units and seventy pooled references. Routine worker transfers during the enabled memory-check sample took at most 1.8 ms synchronously; the initial cold snapshot transfer took 23.6 ms. After startup, the idle control produced no saves or compression jobs.

A separate 100 mocked-turn run grew the transcript from 1,307 to 1,407 messages and the archive from 423 to 522 blocks. The complete normalized/sanitized stored state matched the active state, and all archive data survived database loading and JSON export/import. No provider requests were sent outside the mock.

Main-page heap after forced collection was approximately 34.8 MB initially, 59.0 MB after retaining 100 additional turns/history, and 37.5 MB after closing the harness and clearing its references. This demonstrates release of most retained session data; it does not prove all long-session memory behavior. Worker heap values were not available from this harness's target discovery and are not included. Worker release is separately tested.

Context assembly, React rendering, explicit JSON exports, loading and the initial worker snapshot can still produce shorter main-thread pauses. The database still writes complete records off-thread. Actual mobile hardware and Safari remain untested.

## Tests and reproduction

Regression tests cover legacy inventory-equivalent results and cache invalidation, exact delta reconstruction, small transfers with large unchanged archives, credential sanitization, worker commit acknowledgements, stale revisions/events, failed transactions, crash recovery, coalesced saves, checkpoint ordering and the existing memory/history/import/export behavior. Production smoke now loads both worker bundles as well as the main assets.

```powershell
$env:STORY_TELLER_SAVE_FIXTURE = 'C:/path/to/private-save.json'
$env:AIST_STRESS_TURNS = '100' # optional; all provider responses are mocked
$env:STORY_TELLER_VALIDATION_REPORT = 'C:/path/to/aggregate-report.json' # optional
node scripts/memory-performance-benchmark.mjs
```

The report contains only aggregate metrics, counts and integrity outcomes. The browser uses an isolated temporary profile. `HISTORY_BROWSER` optionally selects a Chrome/Edge/Chromium executable. Run `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run smoke:prod` for repository validation.
