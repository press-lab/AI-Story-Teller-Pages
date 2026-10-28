# Large-save storage architecture with unchanged memory behavior

Status: design only. No parser, evaluator, runtime, save format, or user-data migration is implemented by this document.

## Decision and boundaries

Treat the current memory workflow as a fixed contract. Optimize its representation at persistence and presentation boundaries. Keep the existing in-memory `Adventure`, reducer actions, exact snapshot strings, and comparison functions unchanged in the first implementation.

This explicitly supersedes proposals to replace live snapshot comparisons with hashes, reorganize card content, summarize Brain history, change memory selection, or lazily omit evidence from the runtime adventure.

Fixed behavior includes prompts and provider payloads; parsing, routing, assessment, placement and approval; context selection and ordering; evidence and stale-result checks; cadence, retries, batching and commit groups; API accounting and cost records; the complete Chronicle; and all card, Brain, component and proposal contents. Existing save completion barriers remain in the same positions. A storage optimization must not acknowledge a save before its transaction commits.

The boundary is outside the workflow, rather than a new processing step after parsing. Some existing checkpoints are deliberately saved before a request returns. Those checkpoints use the same storage adapter, with no change to when the workflow waits for them.

## Evidence

The supplied save is 41,065,854 bytes, with 1,042 messages, 261 cards, seven Brains and 307 proposals. Approximate compact JSON field sizes are 1.36 MB for actual cards, 0.07 MB for actual Brains and 0.41 MB for message content. Single-pass reference strings occupy about 20.3 MB; serialized destination values in proposal source and placement records account for another 12.2 MB. Field totals are diagnostic estimates, not independently additive file sizes.

An offline gzip measurement of the original file produced 7,242,627 bytes. Among 441 selected reference/destination strings, 280 were distinct. Their raw string bytes totalled 31,170,058 before deduplication and 24,087,542 afterwards; independently compressing the distinct strings produced 6,095,388 bytes. These are measurements, not a promised production envelope size or phone performance result. JSON escaping, base64, framing, and implementation choices affect the final size.

The earlier library-summary and bounded-transcript changes reduce known overhead. Neither those changes nor these measurements establish the cause of the reported display stall.

## Architecture

### 1. A reversible persistence codec

Define separate storage types and a versioned codec:

    runtime Adventure
      -> existing sanitization
      -> lossless encoding
      -> IndexedDB / explicitly versioned backup envelope

    stored bytes
      -> validated lossless decoding
      -> existing normalization at its current boundary
      -> runtime Adventure

The required invariant is `decode(encode(sanitizedAdventure))` deeply equals `sanitizedAdventure`, before normalization. Existing normalization behavior is assessed separately; do not introduce another normalization pass.

Start with a whole-adventure lossless codec as a correctness baseline. It retains every field, unknown compatible fields, array order, exact strings, checkpoint statuses and accounting records. It never rewrites the JSON inside a `referenceState` or destination `value` string. Serializing the enclosing document must preserve those strings' code units, including whitespace, escaping and unusual Unicode.

Preserve optional properties whose values are `undefined`, and preserve property iteration order wherever existing snapshot serialization depends on it. Plain JSON serialization alone does not preserve every value currently accepted by IndexedDB. Use an explicit typed storage representation where necessary, and distinguish storage tags from user-authored metadata; arbitrary user objects must never be interpreted as references.

The codec version identifies the representation, encoding and integrity checks. Integrity digests detect damaged storage; they do not replace the evaluator's exact equality checks. Codec code must have no provider dependency and must never call the parser, evaluator or reducer to reconstruct missing content. Missing or corrupt data causes an explicit load failure, not inferred success or an automatic paid retry.

Do not claim this baseline alone fixes responsiveness: full serialization, decompression and in-memory allocation still process a full adventure. Measure main-thread blocking and peak memory before enabling compression by default. Off-thread work is acceptable only after measuring the structured-clone cost of sending the adventure to that worker.

### 2. Write changed records, preserving the same logical adventure

After the codec baseline passes equivalence tests, introduce a partitioned IndexedDB representation behind the same repository interface. A revision manifest references the adventure header, ordered messages, ordered cards, Brains, components, proposals, and diagnostic/accounting records. Preserve ordering explicitly, along with all otherwise-unclassified fields; do not silently drop fields by enumerating only today's schema.

Persist only records whose serialized contents changed, plus their updated manifest references. Stable IDs identify entities; immutable object identity can be a fast-path hint within the current session. The correctness boundary is the complete serialized record, not timestamps or a manually maintained list of 'important' fields. Deletions and moves must update the manifest too.

Large opaque snapshot strings can be stored once as immutable, losslessly compressed blobs and referenced by storage records. Decoding restores the original strings in their original domain fields. A digest can locate candidate identical blobs, but verify exact stored content before deduplicating a candidate; a digest match must never silently alias unequal values. References exist only in the storage schema, never in `Adventure` or provider input.

A load still assembles the complete runtime adventure before handing it to existing code. Lazy-loading historical evidence into the live evaluator is deliberately excluded. This phase reduces repeated writes and cloning; it does not promise to reduce the fully loaded adventure's memory footprint.

### 3. Transaction and concurrency rules

Prepare encoding outside the IndexedDB transaction. Commit changed records, required blobs, manifest revision and library summary together in one transaction. Readers see either the previous complete revision or the next complete revision. Publish the new revision only after commit; an aborted transaction leaves the previous revision available.

Serialize save requests per adventure in enqueue order. Preserve existing awaited-save barriers and error propagation; do not add write coalescing, fire-and-forget saves or evaluation scheduling changes in this work. Use an expected base revision to detect competing writes from another tab; report a conflict instead of silently overwriting or performing a semantic merge.

Retain referenced blobs while any committed revision uses them. Do not add automatic evidence/history deletion or terminal-checkpoint pruning. Reclaiming unreachable storage blobs is a separate, tested maintenance operation, never a memory-policy decision.

## Compatibility and migration

Keep existing plain JSON import/export working. Compact backups, if introduced, get an explicit envelope version and contain every referenced blob; no export may depend on the originating browser's database. Ship readers before enabling new-format writers, including GitHub saves and cloud bundles. Older app versions cannot be presumed to understand compact exports, so retain an expanded legacy JSON export.

Apply local migration to a new representation while retaining the original until successful decoding and equality verification. Make migration interruption-safe and resumable without triggering memory requests, changing statuses, or replaying completed work. Account for temporary storage headroom: preserving both versions costs space. If space is insufficient, retain and use the original representation.

Existing credential sanitization remains mandatory before encoding. Compression and deduplication are not credential protection. Never migrate or rewrite synchronized captured saves as part of implementation testing; use isolated copies.

## Acceptance gates

1. Codec round trips preserve the entire sanitized object and exact snapshot strings across legacy and current saves, unknown fields, Unicode, empty values and repeated IDs/content cases.
2. Replay identical recorded provider responses and user/reducer actions through the original representation and a codec round trip with controlled clocks/IDs. Provider request count, purpose, order, payloads and limits must match; reducer results, approvals, rejections, diagnostic reasons and accounting must match.
3. Explicitly exercise edits to source text, destination content and author controls during an outstanding request. Existing stale checks must accept and reject exactly the same cases after reload. Include pending/failed work, partial group completion, explicit retry, undo/redo, and approved/rejected/ignored proposal coverage.
4. Inject aborted writes, interrupted migration, missing/corrupt blobs, quota errors, competing tab revisions and forced digest collisions. No partial adventure, false match or extra model call is allowed.
5. Exercise plain exports, compact envelopes if enabled, GitHub/cloud wrappers and duplicate imports. Reloaded semantics must match each existing pathway's sanitization/normalization baseline.
6. Benchmark the supplied save and synthetic larger saves offline: save size, changed-write bytes, load/save latency, main-thread stalls, peak memory and latest-response display latency. Device/browser measurements are required before attributing the phone symptom to storage.

## Delivery order

First add baseline measurements and equivalence tests. Then implement and verify the codec without changing runtime contracts. Next enable compact local persistence with reversible migration. Introduce partitioned writes as a separately reviewed change after round-trip equivalence holds. Extend portable formats only after their readers and compatibility tests exist.

Stop at any equivalence failure and fix the adapter. Do not compensate by changing parsing, validation, evidence scope, retry policy, API behavior or memory content. If profiling still points inside the existing evaluator or snapshot generation, report that result as a separate proposed scope rather than quietly including it here.
