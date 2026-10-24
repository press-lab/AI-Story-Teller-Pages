# Story Card architecture

## Structure and responsibilities

`StoryCardType` has four values: `character`, `location`, `lore`, `custom`.
Character and Location hold durable identity; ordinary developments go to Lore.
Custom remains explicit reference material. Content is the single editable body.
Relationships, politics, discoveries, first meetings, commitments and events are
subjects of Lore, not additional top-level types. Plot Components remain separate.

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

Ordinary automatic Character/Location content writes are blocked at the AI boundary
and reducer. Suggestions targeting identity with ordinary developments become Lore.
Exceptional death/alive confirmation, permanent transformation/capability change
or explicit identity correction requires review. Approval can update the identity
and creates supporting historical Lore. The lexical exception check nominates
review; it does not establish truth. Explicit card editing remains available, as
does reviewed AI-assisted authoring; model envelopes cannot set its user-initiated flag.

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

## Request/cost evidence

Normal turns still make one narration request containing the hidden memory tail.
Missing/malformed envelopes queue recovery, not immediate retries. Existing recovery
attempts wait at least five story turns (or a larger configured interval), with up
to ten queued sources. No scheduler/provider/cooldown/output reserve is changed.
Configured semantic rules, manual authoring and agency/continuity correction remain
their existing separate request paths. The recovery output allowance remains
min(background provider output cap, 1,400) times the evaluated source count;
narration reserve stays 1,400.

The 20-turn mocked provider regression measures requests, estimated prompt tokens
and configured output-token ceilings, not dollars or actual generated tokens.
Before changes, the existing dirty workspace measured 20 narration / 0 recovery
calls, 62,934 estimated prompt tokens, 24,000 output budget for valid envelopes;
missing envelopes measured 20 / 4, 68,918 prompt tokens, 48,000 output budget.
The same workspace after this change measured 62,314 / 68,174 prompt tokens with
identical calls and output budgets. Its pre-existing Brain-topic/discovery work
remains outside this commit.

An independent unchanged committed-HEAD copy measured 74,053 / 82,238 prompt tokens
for the same sessions, with the same 20/0 and 20/4 requests and 24,000 / 48,000 output
ceilings. The isolated committed-change copy measured 70,493 / 77,966 prompt tokens
(about 4.8% / 5.2% lower), with identical requests and output ceilings.
A third 20-turn session with 60 stored Lore cards and a three-turn Brain cooldown
measured 20 requests and seven Brain updates both before and after; prompt estimates
fell from 74,580 to 71,020 and the output ceiling remained 24,000. None of the
unrelated Lore archive was injected. The full scoped suite passed 449 tests.
Tests enforce no additional requests or larger output budget and no prompt-token
increase over that committed baseline. Provider billing, caching, narration lengths
and live usage vary; this does not guarantee a particular daily/monthly dollar cost.

## Deliberately deferred

The suggestion engine still needs its separate routing/judgment redesign:

- Improve meaningful-event nomination, same-continuing-subject matching and selection
  of identity exceptions beyond conservative lexical review gates.
- Replace the old `classifyMemory` immediate/current-state-to-Plot-Essentials rule.
  Existing pressure, arc and essentials automation is unchanged in this phase;
  none is added as a consequence of the Story Card migration.
- Improve old existing-card semantic prompts that can nominate ordinary biography
  updates. The new boundary blocks those writes; it does not add a corrective LLM call.
- Add richer fantasy-calendar parsing/date inference only after evaluating its cost.
  Ambiguous dates remain unknown/textual now.

No autonomous agent, embeddings service, second normal-turn pass, recurring date
call, automatic historical scan or new background subscription is introduced.

## Main files

Generated cards must have reusable topic triggers covering their content, rather
than depending on an exact scene sentence or elaborate title. Generation prompts
request 3–6 short phrases (for example, "runic research", "ward design", or
"government reform"). Useful title phrases and shared relevant topics are kept;
unrelated character-name cues and empty catch-all words remain filtered.
`generatedStoryCardTriggers` derives grounded phrases from the title/body when
the model omits usable keys. This runs for discovery, proposal routing, approval
(including older triggerless pending suggestions), and generated scenario cards.
It adds no provider calls and does not rewrite existing adventures on load.

Schema: `src/types/adventure.ts`. Migration and Brain import fix:
`src/state/defaults.ts`, `src/importers/aidCardParser.ts`. Writes/history:
`src/state/adventureReducer.ts`, `src/memory/applyAIMemoryUpdate.ts`.
Architecture/time/retrieval: `src/memory/storyCardArchitecture.ts`,
`src/memory/storyTime.ts`, `src/memory/eventMemory.ts`,
`src/contextBuilder/contextBuilder.ts`. Editing: `src/pages/StoryCardsPage.tsx`,
`src/pages/StoryCardChronology.tsx`. Creation controls/prompts: Adventures, Memory
Inbox, adventure generator, Story Card audit/builder and one-pass memory modules.
Regression tests cover migrations, round-trips, identity durability/death, Lore
dates/history/recall/privacy/budgets, Brain imports/fallbacks, editor controls,
clock skips/flashbacks/undo, and 20-turn request/token accounting.
