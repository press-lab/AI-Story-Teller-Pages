# Memory decision inspector

> Historical architecture/validation record preceding the original-foundation migration. For current automatic scheduling, costs and permissions, use [Foundation migration](foundation-migration.md). The compact pipeline described here remains available for explicit legacy catch-up.

Memory → Decisions is a read-only view of persisted observations. Suggestions retains the existing review controls. Native expandable rows, labeled controls, wrapping source IDs and the existing wrapping toolbar support narrow screens and keyboard navigation.

The latest 600 structured diagnostic events are retained per adventure. They travel with normal autosave, JSON export/import and IndexedDB persistence. Existing evaluation logs are preserved independently. Older turns can show proposals, recovery state and source-linked evaluation logs even when new diagnostic stages are unavailable. The timeline shows the latest 100 matching narrator messages; search can locate older matching messages.

Captured observations include inline instruction presence, envelope parsing and candidate kinds; submitted candidate fields, evidence, rationale and validation outcomes; reducer acceptance, merging and suppression; review status changes; recovery queue cause, attempts, per-source validation and committed completion. A candidate passing validation can still be suppressed or its recovery source transaction rejected. Completion is recorded only when the reducer commits a recovery result against the unchanged source snapshots.

Recovery request metadata separates transport, JSON parsing, source validation and committed completion. Model names are configured request models. Token usage is shown as a shared batch total with all source IDs, never as a cost charged to each source. Unreported usage is labeled unavailable. Narration usage comes from the source message's recorded usage. Historical API records without reliable source attribution are not assigned to a turn.

The inspector cannot explain why a model omitted a candidate or what it considered internally. An empty updates array means zero candidates, not a semantic judgment about every story fact. Missing envelopes mean an incomplete evaluation. Only supplied rationale is shown; no retrospective AI explanation is requested. Events whitelist bounded candidate fields and request metadata, excluding provider bodies, prompts, credentials and hidden reasoning.

No prompts, model settings, output budgets, scheduling, retry policy, detection or evidence rules are changed. Inspector interactions have no dispatch or provider dependency.
