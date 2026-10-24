# Story Card suggestion skill

> Historical architecture/validation record preceding the original-foundation migration. For current automatic scheduling, costs and permissions, use [Foundation migration](foundation-migration.md). The compact pipeline described here remains available for explicit legacy catch-up.

Completed exchange → local detection + existing one-pass LLM assessment → shared matching and merge → Memory Inbox → approval. No new agent, embedding service, scheduled job or normal-play provider request is added. Character, Location, Lore and Custom remain the only primary card types.

## Runtime contract

Brain thought instructions and the shared four-update envelope remain unchanged. The Story Card semantic policy is separate from its structured fields:

```text
STORY CARD MEMORY CHECK
Did anything NEW and MEANINGFUL happen in this exchange? Remember first meetings/kisses, proposals, relationships, commitments, betrayals, discoveries, major decisions, deaths, permanent changes, or significant new people/places. Ignore routine activity, conversation, movement, temporary reactions and repeats.
For each: TYPE (Lore, Character, Location, Custom; prefer Lore); CREATE or UPDATE a relevant existing card; FACT (specific new development); WHEN (current story date unless historical); EVIDENCE (exact supporting quote).
Character/Location hold durable identity or exceptional permanent changes. Plans, threats, dreams and almost-events are not completed actions. Preserve private knowledge and past history. Never invent facts, rewrite whole cards, duplicate memories or suggest Plot Component updates. Return suggestions or an empty updates array.
END STORY CARD MEMORY CHECK
```

```text
Story Card fields: kind=lore (events/changes), newCard (missing identity/reference), card (permanent identity); cardType=lore|character|location|custom; operation=CREATE|UPDATE; target=title; targetId=existing ID for UPDATE; content=new fact, max70 words; evidence=exact quote; reason; triggers=1-3 narrow phrases; optional participants. Shared maximum: four updates.
```

Normal narration receives at most eight relevant targets as `[id,title,type]`. Local matching still checks all cards and aliases. Recovery/catch-up inventories are bounded; irrelevant archived content is not sent.

## Discovery, merging and routing

The local scanner discovers credible new entities only. It never nominates narrative events or identity-status updates from event keywords. The existing narrator's hidden memory envelope identifies meaningful developments using story context; classification cues remain only for matching and metadata on those model findings. Brief exact replies and inferred behavioral claims can remain review candidates. Quote matching establishes attribution, not truth; humans can edit or reject interpretations.

Proper-name discovery qualifies candidate-specific identity evidence, normalizes possessives, filters known titles/aliases, scores unique appearances in the latest 80 narrator entries with a recency weight, and applies a four-exchange entity nomination cooldown. Significant introductions qualify immediately. Organizations use Custom references rather than a Faction type. Participants resolve only to known Character titles and aliases through the same normalized identity matching; explicit valid model participants are preserved. Capitalized prose and possessives cannot fabricate participants or event titles.

The implementation adapts bounded candidates, recency/frequency scoring, duplicate handling and association techniques studied in [Inner Self's integrated Auto-Cards](https://github.com/LewdLeah/Inner-Self/blob/main/src/library.js). A comparison with [Auto-Cards' title extraction and ranking](https://github.com/LewdLeah/Auto-Cards/blob/main/src/library.js) confirms the value of quote/possessive normalization, sentence boundaries, existing-title exclusion and unique occurrence scoring. AIST retains its stronger candidate-specific qualification, including valid introductions at sentence starts. No parallel detector or blanket first-word exclusion is added. AIST's `src/autoCards` files are obsolete stubs and are not the implementation.

Local entities and model findings share `makeStoryCardSuggestion`, `storyCardTargets`, merging and Memory Inbox. Equivalent findings combine evidence and source snapshots; matching missing identities merge across exchanges. Model-only insights survive independently, and local entities survive empty model output. Distinct developments are not merged merely because participants match. Pending/approved/rejected repeats are suppressed. Existing content checks reject recorded facts; copied first/second-person scene dialogue is rejected as Character content rather than appended to a biography. Persisted source fingerprints avoid rescanning unchanged exchanges; source edits invalidate them.

Targeting verifies IDs, compatible types, exact titles, specific aliases/triggers, participants and continuing subjects. Ongoing Lore is preferred for justified updates. Ambiguous targets remain visible choices. All compatible active targets are available to the reviewer, including choices outside the ranked set. CREATE and UPDATE can be switched without silently changing the former target. Closed history is preserved; later developments against a closed title become separately reviewed Lore. Appending preserves prior content and dates. Title cleanup removes actual headings, never the subject of an ordinary factual sentence.

## Approval and evidence

Story Card auto-approval is **optional and off by default**. Saved preferences and the settings/Inbox controls are preserved. Local-only or uncertain findings, ambiguous destinations, protected targets, closed-history follow-ups and exceptional identity changes always require human review. Supported model findings can honor explicit opt-in only after their final source exists and matches its snapshot. Normal play binds the source before applying such findings. No semantic-validation model request is added.

Evidence keeps source IDs and source/player snapshots, including additional cited exchanges in compatibility catch-up results. Edited, deleted or regenerated sources cannot be approved. The user can approve, edit, redirect or reject. Pending suggestions are excluded from narration context.

## Chronology

The persisted clock uses an explicit scenario date or the documented assumed default **2000-01-01**, unrelated to computer/save timestamps. It supports manual correction and includes a small current-date statement in narrator context.

Next/following morning, numeric day/week/month/year skips and explicit dates advance deterministically; month ends clamp to the destination calendar. Player/narrator echoes count once, including the date attached to inline model findings. Flashbacks retain their historical date without rewinding the active clock. Ambiguous durations such as “several days later” retain the active date and expose an unresolved reference in the editor/context. Older imported entries without per-entry dates remain undated or relative; their relative skips are never reapplied to today's clock.

Lore keeps occurrence precision, latest-change date, status and supporting source IDs. Continuing subjects retain the original date and earlier history. A past occurrence may have ongoing consequences.

## Automatic, requested and compatibility paths

Normal play scans the finalized entry and consumes its existing memory envelope. Missing/malformed envelopes keep the current batched recovery cadence and output allowance. Chronicle's **Evaluate Story Card Updates** evaluates one to ten narrator entries with the same scanner, compact assessment, matching, merge and review records using at most one explicitly requested background call. It never rewrites narration or changes Brains. Model failure retains local candidates; reevaluation is idempotent.

Older catch-up/event-search tools retain their compatibility response envelope while using the same semantic instruction, local scanner, suggestion constructor, matching, deduplication and source protections. Automatic memory never targets Plot Essentials, Current Arc, Active Pressure or other components. Explicit manual component tools and deterministic Arc Director pacing remain available.

Brain parser/first-person thought format, accumulation, archival, perspective validation, triggers, cooldowns, cadence, manual tools, context injection and approvals remain unchanged. Imported Brain update instructions are preserved exactly.

## Cost and verification

Identical mocked 20-turn fixtures compare the parent implementation with this change. Counts include narration and missing-envelope recovery; token estimates include content plus the fixture's eight-token message overhead. Output figures are configured allowances, not billed completions. The optional `AIST_COST_REPORT` JSONL output makes the measurements reproducible.

| 20-turn fixture | Calls before → after | Approx. prompt tokens before → after | Output allowance |
| --- | --- | --- | --- |
| Successful inline memory | 20 narration / 0 recovery → same | 59,340 → 59,054 | 24,000 → 24,000 |
| Missing envelopes / batched recovery | 20 narration / 4 recovery → same | 64,558 → 64,156 | 48,000 → 48,000 |
| 60-card archive with Brain updates | 20 narration / 0 recovery → same | 59,989 → 59,738 | 24,000 → 24,000 |

The saved local working-tree baseline also decreased: inline 60,400 → 60,134; recovery 65,834 → 65,452; heavy 61,060 → 60,811, with the same request counts and output limits.

Brain cadence remains seven updates in 20 turns with cooldown three. Provider settings and output allowances are unchanged. Request/token comparisons demonstrate preserved modeled cost; actual monthly billing still depends on provider rates and play volume. Explicit manual evaluations are additional user-requested calls.

Tests cover the requested scenarios plus threats/negation/dreams, organization references, alias victims, entity cooldowns, source fingerprints, short evidence, reviewer redirection, historical follow-ups, monthly/ambiguous progression, and source-date consistency. TypeScript, the full suite, production build and production smoke are required before committing.

Final scoped verification: **514 tests in 62 files passed**; TypeScript, production build and production smoke passed. Full working-tree regression coverage also passes with the existing local Brain/source-review work retained separately.
