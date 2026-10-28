# Lossless storage validation

The codec in `src/db/losslessAdventureStorage.ts` is an experimental foundation. Only tests import it. Existing database, export, cloud-sync and memory-workflow paths do not use it. No migration or background compression worker is enabled.

## Supplied-save result

The private fixture was read from a local path supplied through an environment variable. Its contents and encoded output are not committed.

| Check | Result |
| --- | --- |
| Original JSON size | 41,065,854 bytes |
| Compressed binary payload | 7,219,946 bytes (about 82.4% smaller; excludes envelope metadata) |
| Decoded typed representation | 40,208,808 bytes |
| Story entries / cards / Brains / proposals | 1,042 / 261 / 7 / 307 |
| Exact reference/destination strings checked | 441 |
| Complete sanitized-object round trip | Exact, including property order |
| Context output and proposal-validation decisions | Identical |
| Existing normalization results | Identical |
| Source file after testing | Unchanged |

One isolated Node run measured about 727 ms to encode and 319 ms to decode. These are desktop measurements, not iPhone Safari responsiveness or peak-memory measurements. Compression still requires full serialization and allocation. Do not enable it on the UI thread based on size reduction alone.

## Deterministic replay

HTTP responses are mocked; no real provider requests or charges occur. The original and restored adventure are replayed with controlled clocks and IDs through narration, a single-pass memory request, parsing, reducer commits and API accounting. The harness compares complete request bodies, request ordering, state, token/cache usage and reported costs. Each replay makes two mocked requests, with the same results before and after the round trip.

The supplied fixture passed replays for DeepSeek Chat, GLM 5.3 Flash through OpenRouter, and its configured DeepSeek Messages transport. These are deterministic regression tests, not new model-quality evaluations or historical response replays: the same fixed synthetic replies are used on both sides.

Synthetic fixtures additionally cover positive parsed findings, approvals, rejection/ignore actions, malformed/incomplete output, source and destination edits, changed author controls and undo. Codec tests cover exact Unicode, optional undefined values, sparse arrays, unknown metadata, credential sanitization, independent gzip decoding, an isolated IndexedDB write/read, corruption, size limits and unsupported formats/types.

## Reproduce

The codec and synthetic replay tests run in the normal test suite. The private fixture test is skipped unless `STORY_TELLER_SAVE_FIXTURE` is supplied:

```powershell
$env:STORY_TELLER_SAVE_FIXTURE = 'C:/path/to/private-save.json'
$env:STORY_TELLER_VALIDATION_REPORT = 'codex-artifacts/lossless-save-validation.local'
npm.cmd test -- src/db/losslessAdventureStorage.test.ts src/db/losslessAdventureStorage.replay.test.ts
Remove-Item Env:STORY_TELLER_SAVE_FIXTURE
Remove-Item Env:STORY_TELLER_VALIDATION_REPORT
```

The optional report contains aggregate counts, hashes and timings, not adventure text. Codec support requires native gzip streams and Web Crypto. Unsupported environments receive an explicit error; no alternative format is silently written. The experimental codec has a 256 MiB decoded-size limit and supports ordinary adventure values with explicit preservation of undefined and special numeric values; unsupported object types are rejected.

## Still required before enabling app persistence

Implement and test the actual storage adapter, reversible migration, interrupted/failed writes and storage-quota behavior. Measure browser main-thread blocking and transfer costs before choosing a worker implementation. Incremental writes, deduplicated blob storage, portable compact exports and their compatibility paths remain separate architecture stages. This proof does not establish that the original phone display stall is resolved.
