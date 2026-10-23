# Story Card suggestion engine

Automatic destinations are reviewed Story Cards and existing Brains. This extends the established four-type card architecture: Character, Location, Lore, Custom. Legacy plot/event inputs already normalize to Lore; no new type migration is introduced here.

## Runtime instruction

The following is embedded in the existing narration response contract. The surrounding envelope remains `<memory_updates>{"updates":[]}</memory_updates>` with a shared four-update limit. Brain thought instructions and response fields retain their existing contract.

```text
STORY CARD MEMORY CHECK
Review the completed entry and player input. Did anything NEW and MEANINGFUL happen worth remembering? Ignore routine activity, movement, temporary feelings and repeated facts.
Use kind=lore for events/changes (first meetings, dates, kisses, proposals, commitments, betrayals, discoveries, decisions, deaths, permanent changes). Prefer an existing relevant Lore title; otherwise use a specific new title. Use kind=newCard and cardType=character|location for an important missing identity, or kind=card for an exceptional permanent identity change. Custom is explicit reference material.
Each needs target (existing exact title or specific new subject), content (the NEW fact only, max 70 words), evidence (exact source quote), reason, and 1-3 specific triggers for new cards. Optional targetId, participants and subject help matching. Multiple meaningful suggestions are allowed within the shared four-update limit. All Story Card changes await review. Do not regenerate cards or erase earlier events.
Plans are not completed actions; almost/conditional events are unconfirmed. Preserve private knowledge. Use established story time; never invent a precise historical date. Code attaches source IDs and dates.
Never suggest Plot Essentials, Current Arc, Active Pressure or any Plot Component update. Return suggestions or an empty updates array.
END STORY CARD MEMORY CHECK
```

## Local discovery and association

`storyCardSuggestions.ts` nominates candidates locally after the final assistant entry is saved. Maintainable milestone patterns cover first meetings/dates/kisses, proposals/acceptance, marriage, breakup, reconciliation, promises, betrayal, death, discovery, transformation and major outcomes. Ordinary dinner/movement does not qualify. Almost, intended, rumored, conditional and planned outcomes are marked unconfirmed. No nomination silently establishes canon. Death/destruction checks identify the affected subject rather than treating a killer as a victim.

Proper-name candidates use titles and aliases to filter known subjects, count unique mentions in the latest 80 narrator entries, and rank by frequency weighted toward recent exchanges. Repetition helps uncover recurring entities; a significant introduction or named location can qualify immediately. At most two missing identities and a bounded set of milestones are nominated per exchange. Nomination never invents traits from one reaction. Equivalent pending/rejected/approved findings suppress repeat nominations, while distinct new developments remain eligible. Existing semantic-card cooldowns and Brain cooldowns retain their behavior.

The design studied [Inner Self's integrated Auto-Cards implementation](https://github.com/LewdLeah/Inner-Self/blob/main/src/library.js), particularly turn-based title candidates, recency-weighted frequency ranking, bounded association searches and duplicate filtering. The AIST implementation is original and uses the existing reducer/proposal pipeline; it does not import that framework, add a background agent or store a separate opaque memory index.

## Merge and Create versus Update

Both detectors create the same typed proposal. Equivalent findings from an exchange merge by event kind, exact supporting evidence and meaningful content overlap. Participants alone never prove equivalence. A confirmed model interpretation is preferred when its source supports it; an uncertain source remains unconfirmed. Both sources' evidence is retained. Model-only findings survive without a pattern; local findings survive an empty model result.

Targeting searches active cards by verified ID/exact title, specific aliases/trigger phrases, meaningful subject overlap, and associated participants. Continuing relationship/conflict subjects can receive a new development; participant overlap alone cannot attach a kiss to an unrelated government-conflict card. Historical completed cards stay immutable through generated updates. Tied plausible targets become visible choices in Memory Inbox, including CREATE. The verified result is not rerouted by a second fuzzy matcher. Approval appends chronology and preserves earlier content. Exceptional identity changes and their supporting Lore are separately reviewable.

Review proposals preserve source/player IDs and exact snapshots. Deleted, edited or regenerated sources cannot be approved. Reevaluate the revised source to obtain a fresh candidate. Pending suggestions remain excluded from narrator context.

## Story time

`initialStoryClock` uses an explicit opening/scene date, otherwise **2000-01-01** as a deterministic assumed anchor. The clock persists and the UI/context label established versus assumed time. It is unrelated to the real calendar or save timestamps and supports manual correction.

Next morning/day, numeric day/week skips, and explicit in-world headings advance locally. Player/narrator repetitions of the same transition count once, including during import replay. No transition retains the date; tomorrow's plans do not advance it. Flashbacks carry their historical date without rewinding the active clock. Textual fantasy/approximate dates preserve their precision. Older undated imports do not receive the newly assumed date. Suggestions attach available source time, precision, status and source IDs; an evolving subject keeps its original occurrence and gains a last-change date.

## On-demand evaluation and routing boundaries

Chronicle's **Evaluate Story Card Updates** evaluates one entry or a range of one to ten narrator entries. It runs the same scanner first and then at most one background-model request with the same Story Card instruction, source validation, target matcher, merge and review path. It never writes narration or Brain thoughts. Model failure retains locally detected candidates. The selected entry range is bounded before a provider call. Repeated evaluation suppresses equivalent pending/approved/rejected results.

Normal turns add only local scanning. Existing recovery batching and output allowances remain. Recovery sends at most eight relevant card targets rather than the whole inventory. No embeddings, scheduled jobs, semantic-validation calls or additional agents were added. Provider settings and Brain update frequency remain unchanged.

One-pass component kinds are rejected. Automatic semantic component conditions and generated component actions are excluded. Plot Essentials, Current Arc, Active Pressure and their UI/manual tools remain. Deterministic Arc Director behavior is independent and unchanged. Explicit user-requested authoring/reconciliation tools retain their existing scope.

## Cost and validation

Same mocked 20-turn fixtures, with identical provider settings and completed story outputs. Approximate tokens include message-content estimates plus the fixture's eight-token overhead per message. Output figures are configured maximum allowances, not actual billed completions.

| Fixture | Requests before → after | Prompt tokens before → after | Output allowance before → after |
| --- | --- | --- | --- |
| Inline memory | 20 narration / 0 recovery → same | 70,493 → 59,340 | 24,000 → 24,000 |
| Missing envelopes | 20 narration / 4 recovery → same | 77,966 → 64,558 | 48,000 → 48,000 |
| 60-card Lore collection with Brain | 20 narration / 0 recovery → same | 71,020 → 59,989 | 24,000 → 24,000 |

Brain updates stayed at seven with cooldown three; irrelevant archived Lore stayed out of the payload. These are reproducible relative measurements against the parent commit, not a prediction of provider billing or a guarantee of a monthly dollar amount. `AIST_COST_REPORT` optionally writes the benchmark's JSONL measurements.

Tests cover the requested 26 scenarios plus ambiguous target selection, multiple updates to one subject, stale source extensions, destroyed locations, imported clock replay and Chronicle review controls. The complete suite, TypeScript production build and production smoke check are required before committing.

Final scoped validation: **486 tests in 61 files passed**, including the on-demand runtime integration cases. TypeScript, production build and production smoke checks passed. The working-tree regression suite also passed before the final target-ID and runtime cases were added.
