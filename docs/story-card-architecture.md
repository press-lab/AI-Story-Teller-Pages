# Story Card architecture

## Structure and responsibilities

`StoryCardType` has four values: `character`, `location`, `lore`, `custom`.
Lore is the default for events, shared developments, agreements, research and discoveries, even when a participant has a Character card. Append to existing Lore about that topic or create focused Lore. Character updates are exceptional: a specific enduring identity, capability, role/status, relationship or correction must change the profile beyond the scene, with a reason and exact supporting source quotes. Scene participation, dialogue, offers and tests do not justify a biography append. Location/Custom updates concern the enduring subject itself. All four types retain append/create support for eligible facts. Content is the single editable body. Type describes the subject, not its mutability. Plot Components and private Brain state remain separate.

Lore metadata (`StoryCard.lore`) holds `occurredAt`, `lastChangedAt`, `status`
(`completed`, `ongoing`, `unresolved`, `superseded`), Chronicle `sourceMessageIds`,
and optional `knownTo` names. StoryTime stores authored text and precision
(`unknown`, `relative`, `approximate`, `year`, `month`, `day`, `time`); an optional
Gregorian `date` is populated only from valid explicit evidence. Unknown is valid.
Source message IDs are stable references; Chronicle positions and runtime turn
numbers remain separate, not substitutes for dates.

`Adventure.storyClock` is independent of `createdAt`/`updatedAt` and computer time.
The Story Cards editor exposes it and Lore chronology. Explicit `Story date:` /
`Current story date:` headings and `It is <date>` narration can advance it.
Day/week skips advance an anchored Gregorian day; other skips remain relative.
Flashbacks can have their own dates without moving the present backward. Fantasy
calendars, uncertain dates and unknown times remain textual. A manual clock anchor
is retained so edited/undone date evidence can be replayed locally.
The narrator sees the current clock and dates of selected Lore, not all history.
No clock inference request, automatic backfill or wall-clock conversion is added.

## Writes and retrieval

All automatic card writes use the shared append/create proposal pipeline. Every saved card is an eligible destination, including inactive cards, historical Lore and legacy autoUpdate=false cards. Bounded relevance selection limits condition checks; context inclusion and per-card legacy update cooldowns do not authorize or forbid new memory. Global memory enablement/cadence and approval settings remain authoritative. Protected targets require review.

Generated updates contain only new facts. The reducer appends them, retains existing content byte-for-byte, preserves type and authored controls, merges source IDs and relevant triggers, and records revision snapshots. It never silently replaces a biography, changes the voice contract or archives facts for a context budget. Manual editing remains available. Later corrections are dated additions; historical text is not an instruction to replay an event.

Version 3 placement reviews bind the append/create operation, exact draft, source evidence and destination snapshot. Character appends also bind the explicit profile-change exception and exact quotes; missing or fabricated support fails closed. A reviewer can reroute a Character draft into Lore, which receives a separate review with the corrected type and destination. Edits invalidate automatic approval. Old pending reviews require revalidation when processed, never a provider call on load. A mixed or exaggerated draft can be corrected once and separately reviewed; final review freezes the corrected text instead of chasing stylistic rewrites. Exact evidence IDs and quotes remain mandatory, with one bounded model repair for invalid discovery evidence. The application never fabricates or silently fixes evidence.

Lore updates preserve earlier Content, earliest occurrence, source IDs and revision
snapshots. Known dates label appended developments. Recovering older evidence does
not move a known `lastChangedAt` backward. Existing ongoing status and knowledge
restrictions persist unless explicitly changed. Dates alone never mark a subject
resolved. Full Content stays in storage; long unprotected Lore uses a deterministic
relevant excerpt within its existing card token budget (default 200), with an
inspectable truncation decision. Explicitly protected cards retain full content.
Global section/context budgets and drop priorities still apply.

Historical Lore reuses Event Memory's participant/alias references, recall cues,
three-result recall limit, trigger policies and source evidence. A bare participant
name is not a historical recall cue. Manual/always/pinned inclusion remains under
user control. Private knowledge labels explicitly prevent automatic sharing with
other characters; the existing narration instruction also prohibits granting
absent characters unreceived knowledge. These are model-facing constraints, not a
claim that code can guarantee model compliance.

## Compatibility and Brain import

Factories, normalization, direct card import/upsert and JSON restore map legacy
`plot`/`event` to Lore and `faction` to Custom. Legacy type strings remain accepted
at input/history boundaries, not in creation choices. An Event card gains completed
historical Lore metadata unless it already has authored metadata. Content, IDs,
triggers, eventMemory participant/cue/kind/source data, revision snapshots, control
settings, aliases and timestamps remain. Source history types are not rewritten.
Normalization is idempotent and repeated import/upsert preserves card IDs.
Existing Character/Location biographies are not rewritten by this migration.

`normalizeAdventure` now preserves Brain `updateCondition` and `updatePrompt`
exactly, including empty/missing fields and the formerly recognized generic
condition. AID Brain import respects supplied instructions and otherwise leaves
them empty. New Brains keep their factory defaults. The existing runtime's fallback
condition remains nonpersistent. Brain targeting, capture, first-person checks,
append/replace, archival, deduplication, cooldowns, review and context are unchanged.
Other Brain migrations are intentionally retained.

## Compatibility and verification

The Memory Mode selector, ongoing filter and per-card auto-update opt-in have been removed. Legacy memoryMode, autoUpdate, archivedFacts and eventMemory fields remain readable and round-trip without bulk rewriting saves. Dates and completed/ongoing/unresolved status describe facts independently of update eligibility. Existing source-completion and bounded retry/quarantine rules remain; loading an adventure does not replay history or send memory requests.

`storyCardPlacement.test.ts` covers every card type across all three legacy modes, disabled opt-in, inactive/protected targets, preserved bodies and controls, stale evidence, bounded repair and import/export. `hogwartsTattooAppend.test.ts` uses original source excerpts to verify partnership creation, a described paper-transfer technique, Ron's successful test, branding and future production agreements. Provider responses are explicitly mocked; these tests establish pipeline correctness, not live-model semantic accuracy.

## Shared assessment, coverage and retry work

Automatic memory uses one source-bound assessment for Plot, existing Story Cards,
Brains and whether additional discovery is needed, preserving four independent
transaction commits. See [memory-request-orchestration.md](memory-request-orchestration.md).
Relevant Inbox coverage includes proposed factual deltas, validated newFact,
status, target, participants and source IDs, selected newest first after relevance.
It is explicitly noncanonical duplicate coverage. Existing-card results become
coverage for discovery in the same source; they never exclude an entire topic.

Shared pure fact coverage uses narrow paraphrase normalization, retaining actor,
negation and outcome. It runs before repair/review, at Inbox insertion and at
approval against the current destination. It does not use a similarity threshold.
A fully covered approval retains the approved review decision and records an
inspectable no-op without adding another card revision. Partial overlap preserves
the reviewed draft pending edit/revalidation instead of silently changing claims.
Second placement review remains mandatory for corrected content or destinations;
completed reviews are reusable only with matching evidence, content and controls.
