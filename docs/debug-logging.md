# Persistent debug logging

Detailed persistent logging is **disabled by default** by the single code constant
`MEMORY_DEBUG_LOGGING = false` in `src/config/debugLogging.ts`.

To re-enable it, change that value to `true`, rebuild (`npm.cmd run build`), and
redeploy the application. Newly generated activity then records diagnostics,
full Component/Story Card before/after revisions, and completed evaluation and
resolved proposal archives through the existing compression worker. Past logs
cannot be recreated. There is no runtime/UI debug setting; `showLog` is unrelated.

With the flag false, trigger logs, memory diagnostics, evaluation logs, new revision
snapshots, and new compressed debug archives are not retained. The background
compression scan, timers, archive saves and missing-worker warning do not run.
Completed validated evaluations retain status, identity/revision, attempt/turn,
completion groups, batch identity and result counters; full reference/source
copies, repeated evidence, findings/dispositions and finished checkpoints are
removed only after proposals have been processed successfully. Running, failed,
quarantined and partial evaluations keep their exact retry and dependency data.
Resolved proposals retain their operational fields: rejected/ignored evidence and
destination snapshots affect duplicate suppression and later approval decisions.
No new archive copies of them are made. Pending proposals remain intact.

Gameplay, Brain auto-approval, Lore suggestions, memory routing, timestamps,
source attribution, recovery, Chronicle, undo/redo and current memories continue
normally. API request ledger, totals, status, provider/model attribution and token
usage remain unchanged. Actual story and memory content still grow the save.

## Optional cleanup of an existing adventure

1. Download a **full JSON backup** using the existing adventure export control.
2. Open Memory Suggestions → Decisions → **Clear saved debug history**.
3. Read and accept the confirmation; deleted debugging history cannot be reconstructed.

The typed reducer action `PRUNE_DEBUG_HISTORY` clears old diagnostics, trigger and
evaluation logs, card/component revision histories, completed debug payloads and
compressed debug blocks/references. Legacy diagnostic source-edit markers become
compact source IDs so editing old evidence still invalidates evaluation, including
sources restored by undo. Undo/redo entries remain intact; a removed archive
reference is safely resolved when its message is restored.
Unfinished work and pending proposals are preserved; resolved proposal records
continue supplying coverage and suppression. This never runs on load/import/save.
The cleanup generation prevents persistence from merging removed archives back
from the previous save and rejects archive progress across cleanup generations.
Cleanup does not change the logging switch, and works with either flag value.

## Implementation map

| File | Functions or declarations changed |
| --- | --- |
| `src/config/debugLogging.ts` | `MEMORY_DEBUG_LOGGING` (the only logging switch; shipped `false`) |
| `src/state/adventureReducer.ts` | `recordComponentMemoryUpdate`, `recordStoryCardMemoryUpdate`, `adventureReducer`, `reduceAdventure`, `applyStoryPatch` |
| `src/memory/memoryHistory.ts` | `compactCompletedEvaluationWithoutDebug`, `pruneDebugHistory`, `eligibleHistory`, `nextHistoryRecord` |
| `src/memory/singlePassMemory.ts` | `singlePassReferenceState` excludes only legacy Momentum debug revisions; `prepareSinglePassMemoryBatch` documents preservation of full running guards |
| `src/hooks/useMemoryHistoryCompression.ts` | `useMemoryHistoryCompression` gates both background effects and cancels jobs when cleanup changes the generation |
| `src/db/adventureDbCore.ts` | `writeAdventure` merges historical blocks only within the same cleanup generation |
| `src/state/turnPipeline.ts` | `applyProviderResponse` avoids constructing the context-selection diagnostic when disabled |
| `src/App.tsx` | `App` retains the unconditional hook call and gates its warning |
| `src/pages/MemoryDecisionsPage.tsx` | `MemoryDecisionsPage` adds confirmed reducer cleanup, logging notices and accurate compact evaluation counts |
| `src/pages/MemoryInboxPage.tsx` | `MemoryInboxPage` passes the existing dispatch to Decisions |
| `src/types/adventure.ts` | `MemoryEvaluationState`, `ActiveState`, `AdventureAction` add compact-record metadata, cleanup generation/source markers and `PRUNE_DEBUG_HISTORY` |

`compactHistoricalEvaluation`, `compactHistoricalProposal`, the archive codec,
worker, and archived detail viewer remain available. Resolved proposal fields are
deliberately retained: source checks, dismissed coverage and later decisions read
them. No archive identifier is added without an actual archive.

## Verification and measured save growth

The full suite exercises legacy detailed-history assertions with the central flag
mocked ON, plus explicit OFF/ON runtime, validation, compaction and cleanup tests.
Both JSON and command single-pass responses run through the runtime in both modes.
Coverage includes Brain auto-approval, Lore, dismissed duplicate suppression,
failed/interrupted retry, legacy source edits, undo/redo, archive inspection,
IndexedDB cleanup persistence and identical model payloads/API accounting.

The new `src/memory/debugLogging.regression.test.ts` contains a private-save
benchmark. Run it with `AIST_DEBUG_LOGGING_SAVE_FIXTURE` pointing to a local full
adventure JSON or synchronized save envelope. It reads the fixture, verifies its
hash is unchanged, and prints aggregate metrics; it never writes save contents.

Representative large-save result (UTF-8 bytes):

| Measurement | Bytes / requests |
| --- | ---: |
| Original synchronized JSON file | 6,609,700 bytes |
| Normalized full JSON export before cleanup | 6,406,608 bytes |
| Full JSON export after explicit cleanup | 3,511,116 bytes |
| Growth over ten identical simulated turns, logging OFF | 72,189 bytes |
| Growth over ten identical simulated turns, logging ON | 1,989,271 bytes |
| Scripted provider requests, OFF | 20 (10 narration + 10 memory) |
| Scripted provider requests, ON | 20 (10 narration + 10 memory) |

Both growth measurements start from the same cleaned adventure with identical
simulation controls. Each turn runs the actual narration/context and single-pass
preparation/validation/reducer paths, approves a new Lore suggestion and updates a
simulated Plot component. ON also runs the existing history compression workflow.
Provider responses and usage are scripted, with no paid network requests. Payloads,
request counts and accounting match across modes. These are size measurements,
not live model quality, billed-cost or mobile performance claims. Normalization
and cleanup are reported separately; story content still grows with logging OFF.

Required validation commands: `npm.cmd test`, `npm.cmd run build`, and
`npm.cmd run smoke:prod`.
