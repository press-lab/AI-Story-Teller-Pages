# Story quality, continuity, memory updates, and API cost

> **Status:** Proposal — analysis and recommendations; no application changes implemented.
> **Audience:** Seth and future contributors.
> **Reviewed:** 2026-09-30, against `82321cffab90c4769ecefd30acb60fe2e76371a3` on `main`.
> **Scope:** Current application code and recent fixes. No saves were changed. Code inspection establishes behavior and risks; it does not establish real-model prose quality or realized savings.

## Recommendation

Keep the current architecture: a capable narrator, deterministic context assembly, and one separate background memory call that maintains the existing visible memory surfaces.

The next investment should make that memory path **complete, fact-preserving, and reliably applied**, then improve which facts reach narration, then remove avoidable API work. A stronger narrator cannot recall a fact that never reaches its context. A cheaper memory model is expensive if its mistakes repeatedly require corrections.

Treat the objectives in this order:

1. **Story quality and continuity:** distinct characters, responsive scenes, player agency, earned consequences, accurate current facts, and meaningful callbacks.
2. **Reliable context maintenance:** important developments reach the right component, card, or Brain without inventing facts or erasing unchanged ones.
3. **Lower cost:** minimize spend per satisfying, accepted story turn, subject to the first two objectives.

This is not a recommendation to add a planner, critic, summarizer, and narrator call to every turn. Most proposed reliability improvements are deterministic bookkeeping around the existing call.

## What the recent fixes already give us

The current direction is worth preserving:

| Existing behavior | Why it helps | Evidence |
|---|---|---|
| Narrator writes prose; automatic memory is a separate JSON call, normally every three story turns | Removes competing output duties from narration and amortizes memory overhead | [Runtime](../src/hooks/useAdventureRuntime.ts), [background pass](../src/memory/compactMemoryFallback.ts) |
| Memory window follows a previous-pass message marker, with overlap and a bounded catch-up window | Covers more than a fixed recent excerpt during ordinary scheduled operation | `memoryPassWindow` |
| Story State stores current facts; Brains include knowledge boundaries | Addresses relationship resets, repeated introductions, and characters knowing private information | [Memory contract](../src/memory/onePassMemory.ts) |
| Stable system prefix, chunk-aligned history, changing context in the newest user message | Creates opportunities for prefix reuse while keeping memory inspectable | [Context builder](../src/contextBuilder/contextBuilder.ts) |
| Living cards can supersede an old fact; new Story State suggestions replace older pending suggestions | Reduces contradictory card facts and review-queue clutter | [Memory contract](../src/memory/onePassMemory.ts), [reducer](../src/state/adventureReducer.ts) |
| Usage aggregates multiple calls and tracks lifetime usage, including discarded work when usage is returned | Makes cost comparisons more honest | [Provider usage](../src/providers/usage.ts), runtime |
| Story Cards auto-approve now honors the user's toggle for plot and protected cards; Plot Essentials still require review | Makes configured automation actually apply those card suggestions | Commit `82321cf`, memory contract |

“Every three turns” is the default, not necessarily an existing adventure's active configuration. Likewise, automatic detection does not mean automatic application: Story State, cards, Brains, and Current Arc are reviewed by default; Active Pressure auto-approves by default.

Normal play no longer schedules the legacy `runMemoryCycle`. User-configured semantic rules, manual AI tools, response rewrites, continuity checks, and arc continuation can still add calls.

## Highest-priority findings

These are source-backed mechanisms and risks, not claims that every one has already harmed a particular save.

### 1. Memory coverage can advance after a failed pass

`startMemoryPass` records `SET_LAST_MEMORY_CYCLE_TURN`, including the message marker, even when the pass reports `valid: false`. The next pass then reads from that newer marker, retaining only the normal overlap. Earlier facts in the failed window can fall out.

There are two related limits:

- A long backlog is truncated to the latest `max(60, 2N + 2)` messages; a message-count ceiling is not a token ceiling.
- Valid JSON is considered a valid pass even when individual updates are rejected. Twelve updates and a bounded output cannot guarantee that every important change was processed.

**Proposal:** separate last attempt, scanned-through coverage, and unresolved/rejected work. Failures should retain unprocessed evidence for the next scheduled slot, without triggering a retry storm. Process long backlogs in bounded chronological chunks. A valid empty result can complete a scan; rejected items and overflow need explicit disposition.

**Success condition:** a transient failure or long pause cannot silently make an important source event unreachable by memory maintenance.

### 2. Reviewed memory can lose developments while waiting for approval

The pass reads active canon and pending new-card titles. It does not read the contents of pending Story State suggestions. A new Story State proposal marks the older pending proposal ignored.

Example: one pass proposes “Mira moved in.” The player keeps playing without approving it. Later, that scene leaves the pass window. A new state rewrite can omit the arrangement because neither active canon nor the new excerpt contains it.

The reducer also suppresses another pending proposal for the same non-state type/title/target. This can block distinct later card facts. Thought and knowledge proposals for the same Brain both use `brainUpdate`, so they can compete when review is enabled.

**Proposal:** retain evidence-backed pending changes as a separate, inspectable draft chain used by the memory worker. Keep them out of narrator canon until approved. Merge distinct additions; replace only genuinely superseded changes; retain rejected decisions. Identify Brain thought additions and knowledge replacements separately.

Approving an old full replacement should check whether its target changed since drafting. Rebase or request review of the conflict rather than overwrite newer facts.

**Success condition:** leaving the review inbox unopened for twenty turns does not discard distinct developments or silently roll back later edits.

### 3. Evidence presence is weaker than evidence support

`memoryUpdateActions` checks whether a normalized evidence quote occurs in a supplied message, plus shape, size, target, and some duplicate rules. That is useful, but a quote does not prove every claim in a 250-word state replacement or a character's knowledge.

For example, “Mira watches him leave” does not establish that she knows his destination. “Maybe we should move in” does not establish a living arrangement.

**Proposal:** have the existing memory call return small changes with source message IDs, quoted evidence, and the old value being replaced. Deterministic validation checks source existence, target revision, allowed fields, and preservation of unrelated facts. Review ambiguous inference; do not add a paid judge to every fact.

Full human-readable Story State and knowledge text can remain the presentation. Internally, field-level changes would make omissions and contradictions easier to detect. This would require a deliberate schema/UI change, not silent string patching.

### 4. The memory worker sees a narrator-shaped reference set

The background pass builds references from `buildContext` after narration's relevance and token-budget decisions. A card mentioned earlier in the pass window may be listed by title while its content is absent from canon; an existing card must be visible to be updated.

This couples two different questions: “What does this next scene need?” and “Which records changed anywhere in the unprocessed turns?”

**Proposal:** select bounded memory references from the entire evidence window: matching identities and aliases, relevant relationship cards, existing values for every update target, Story State, and applicable plot context. Use a memory-specific token budget. Do not send the whole card inventory or hidden future arc instructions.

Also separate knowledge eligibility from thought cadence: `eligibleBrainsForCapture` filters out Brains on cooldown before both kinds of update. Learning a secret should not wait merely because a private reaction was recently recorded.

### 5. The continuity checker can remove legitimate established facts

[Continuity lint](../src/continuityLint.ts) activates on several regex patterns and checks only eight recent messages. It does not receive Story State, relevant cards, or older event evidence.

A promise established fifty turns ago can be valid canon while absent from those eight messages. The checker is instructed to soften unsupported claims and may erase a correct callback. Conversely, many contradictions will never match its patterns.

**Proposal:** provide a compact set of claim-relevant canon and distinguish “contradicted,” “unsupported,” and “unknown.” Preserve legitimate new world/NPC developments; scrutinize retroactive claims about the player, earlier events, and character knowledge. Prefer minimal edits with inspectable reasons.

This is a targeted repair path, not the authority that decides all story truth.

## What belongs where

Better updates come from narrower responsibilities, not asking every component to summarize everything.

| Surface | Keep here | Update when |
|---|---|---|
| Narration Rules / AI Instructions | Perspective, player agency, prose behavior, durable scenario rules | User edits or explicitly invokes generation; never autonomous memory writes |
| Author's Note | Short tonal or scene emphasis | User-directed changes |
| Plot Essentials | Premise, long-term conflict, persistent world-wide constraints | A foundational change occurs; review required |
| Active Pressure | One sentence naming the live external obligation/threat | The pressure materially changes or resolves; a quiet scene need not invent danger |
| Current Arc | Premise and concise consequential progress; Director owns pacing | A relevant development completes; never let memory change authored phase/cost |
| Story State | Current time, place, arrangements, relationships, meetings, unresolved threads | Established current truth changes; carry forward unchanged values |
| Living Story Card | Durable subject/relationship facts that can evolve | A lasting addition or explicit supersession occurs |
| Static Story Card / voice contract | Identity, stable setting facts, characteristic behavior | Explicit additions or author revision; preserve voice and identity |
| Brain | A major character's private reaction and knowledge boundary | New supported thought or acquired knowledge; no automatic creation for incidental NPCs |
| Event Memory | A distinctive completed experience worth recalling later | Currently manual tools/explicit Chronicle scan; historical facts are retained |
| Chronicle | Original transcript and evidence | Append/edit through existing user-facing controls; do not replace it with summaries |
| Next Output Bias | One-turn steering | User requests a temporary emphasis |

A single event may legitimately affect several surfaces. If Mira accepts a standing room offer, Story State records the arrangement; a relationship card can retain the durable commitment; her Brain changes only if the scene supports a reaction or new knowledge. Plot Essentials should usually stay untouched.

“No update” is a good result when nothing lasting changed. More cards, more thoughts, or a freshly rewritten component are not quality metrics.

## Improve the storytelling itself

Continuity is necessary, but a perfectly consistent story can still be dull.

**Keep narration focused on one playable beat.** The existing turn-scope contract already emphasizes agency and immediate consequences. Preserve it. Evaluate whether scenes respond to the player's actual intent, NPCs pursue independent goals, voices remain distinguishable, consequences persist, and the player gets a meaningful opening to act.

Use [the taste profile](./user-taste-profile.md) as scenario guidance: competent protagonists, distinct ensemble agendas, action with consequences, charged relationships, and earned downtime. Do not turn that into an automatic demand for danger every turn or manufacture jealousy in an established bond.

**Consolidate competing instructions.** The system shell says OOC corrections may be acknowledged and then the scene continued, while factory Narration Rules say respond as a collaborator and stop. Resolve that policy explicitly. Remove duplicated rules only after checking their function; preserve user-authored scenario constraints.

**Preserve recent scene texture.** Dialogue rhythm, interrupted actions, emotional subtext, and physical staging cannot all be reconstructed from Story State. Keep enough raw recent history to continue the scene naturally. The default is a 16,000-token context budget with 6,000 for recent messages; these are starting settings, not proven optima. Inspect actual retained messages after all budget cuts and chunk alignment.

**Use deterministic pacing without forcing plots.** Preserve the Arc Director's phase gate and counted engagement. Add evaluation cases where the player ignores a subplot, where an arc resolves, and where quiet aftermath is appropriate. Never expose the future break instruction early to improve “planning.”

**Choose models by observed failures.** Keep a capable narrator as the baseline. Test candidate narrator and memory models separately on the same fixtures. Do not infer that a pricing tier guarantees or prevents fidelity. A memory model must preserve unchanged facts, identities, and knowledge boundaries; fluent JSON alone is insufficient.

## Make automatic memory useful without constant supervision

The long-term target should be **automatic routine maintenance with review for consequential uncertainty**. The current toggles are coarser than that.

Today, keep Story State review enabled during a short measured trial and inspect suggestions promptly. Story Cards auto-approve now also covers plot/protected card suggestions, so that toggle is not a “safe additions only” mode. Leave it off during baseline diagnosis if those changes need review.

Future behavior should distinguish:

- Directly evidenced routine changes, such as an established arrival or a character being told a fact.
- Consequential changes, such as identity, foundational plot, a major relationship commitment, or disputed retcons.
- Unsupported or conflicting inferences, which should remain unapplied.

Do not use model-reported confidence alone to make this distinction. The current proposal confidence of `0.75` is a constant, not a calibrated probability.

The same background request can produce both auto-applicable routine changes and reviewable proposals. Add provenance and undo at the update boundary; never promote pending material to hidden canon.

Out-of-character corrections need durable handling too. They currently skip automatic post-turn memory work; a later pass can see them if still in its window, but persistence is not guaranteed. A proposed correction queue should preserve the player's intended retcon separately from in-world events and ensure the relevant memory is reconciled.

Likewise, regeneration and transcript edits need provenance-aware invalidation: identify memory based on removed/replaced text, preserve independent facts, and reconcile only affected records. Queuing asynchronous updates avoids some timing hazards but does not establish that a full replacement still matches the current target revision.

## Retrieve the right memory before adding more memory

The current title/keyword matching and bounded Event Memory recall are inspectable and require no retrieval API call. Improve these first:

1. Show cards repeatedly mentioned in source turns but never included, and explain whether matching, activity, or budget caused exclusion.
2. Resolve character aliases consistently and prioritize the active scene's participants. A passing name mention should not by itself imply physical presence or dramatic engagement.
3. Keep central identities and standing commitments available without pinning every memory. Pinning and protection are different controls.
4. Keep event callbacks specific: participant plus a distinctive cue, with a small bounded result set. Current automatic event recall is capped at two.
5. Separate current facts from historical truth. A breakup changes today's relationship without erasing the event when the relationship began.

Automatic background memory currently neither creates nor edits Event Memory cards. This leaves some long-term callbacks dependent on manual capture or Chronicle scanning. After core reliability work, consider proposing exceptional completed events within the existing pass, using exact source IDs and mandatory review. That would be a new product policy requiring explicit documentation and tests, not an existing feature.

An embedding search layer is a later option only if alias/cue retrieval demonstrably misses useful memories. It must remain a visible surface with evidence, relevance reasons, token costs, and controls, as required by [AGENTS.md](../AGENTS.md). A backend is not a prerequisite for these nearer-term improvements.

## Reduce costs without weakening the story

### Count the real work

The normal baseline is approximately:

```text
calls per accepted turn =
  1 narration
  + response-guard rewrite frequency
  + continuity-check frequency
  + 1 / memory cadence
  + custom semantic-rule calls
  + amortized arc/manual/retry/regeneration calls
```

At cadence three, narration plus scheduled memory alone averages about 1.33 calls per turn over a long run. Initial scheduling, failures, and extra paths change the observed number.

[The response guard](../src/state/storyResponseGuard.ts) can trigger a rewrite for excess length or suspected agency violations. Its action matching is second-person and phrase-based. “I follow her” in player input may not exempt “You follow her” in narration. This is a concrete false-positive case to evaluate before changing the guard. The rewrite is not run through the same guard again, and continuity lint runs afterward.

Measure false corrections as well as missed violations. A rewrite that damages good prose costs money and quality.

### Give memory its own generation settings

The background resolver inherits narrator configuration, including sampling and maximum output, unless overridden by the available background settings. The memory pass caps output at `min(backgroundConfig.maxOutputTokens, 2000)`; factory maximum output is 1,200. Thus 2,000 is a ceiling, not guaranteed capacity.

Twelve updates, full State/knowledge replacements, and repeated evidence may not fit. Lower sampling variability and zero novelty penalties are reasonable **trial settings** for bookkeeping, with a separate output budget sized to measured completion needs. Support provider-specific capability checks and explicit truncation diagnostics.

First reduce unnecessary replacement text and repeated quotes. Then adjust capacity. Do not save a few output tokens at the expense of losing the entire JSON response.

### Protect useful cache reuse

The current “stable” prefix still contains Active Pressure, the evolving Current Arc log, and pinned living cards. Updating them can invalidate reuse of later prefix content.

Start by suppressing redundant rephrasing, keeping arc entries consequential, and measuring prefix changes. Correctness must win when a real fact changes.

If measurements justify it, split stable arc premise/identity from dynamic progress and pressure into separately named, inspectable sections. **This would change the repository's fixed context-order contract**, so it needs coordinated design, docs, and tests. Do not silently move per-turn content into system messages or withhold fresh facts for caching.

Cache behavior is provider-specific. DeepSeek documents automatic context caching and hit/miss reporting; Anthropic documents prefix matching and explicit/automatic cache boundaries. The current adapter marks system content; history alignment alone does not prove that every provider caches the whole history. Measure the actual adapter and usage fields. [DeepSeek caching](https://api-docs.deepseek.com/guides/kv_cache/), [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

### Tune cadence after coverage is trustworthy

Keep three turns as the baseline. Test other intervals only after failures, pending changes, and backlog coverage are handled. A longer interval reduces repeated instructions/reference overhead, but the evidence window grows and memory becomes older.

For illustration, over 90 turns, cadence three makes roughly 30 scheduled passes and cadence five roughly 18. That is 40% fewer memory calls, **not** 40% less total spend. Larger windows and additional repairs can erase the saving.

A later adaptive scheduler could run earlier after explicit corrections or salient changes and delay routine maintenance modestly. Keep a maximum freshness bound and one serialized worker per adventure. Heuristics must not become the sole way important changes get noticed.

### Price requests correctly

Track each request's purpose, provider/model, input, output, cache reads/writes, latency, outcome, and associated source turn. The current lifetime totals are a strong start, but aggregated tokens alone cannot accurately price mixed models or missing usage.

Use the provider's billing semantics to separate uncached input, cache reads, cache writes, and output; avoid charging cached input twice. Unknown usage should remain unknown. Report both total session cost and cost per accepted turn, including corrections and discarded generations. No fixed dollar savings are established by this review.

## Evaluation that can decide whether a change is better

Use fixed representative snapshots and source excerpts from saves, without modifying synchronized originals. Separate deterministic reliability tests from paid model evaluations.

| Test family | What must be observed |
|---|---|
| Current truth | Day/time, location, relationship, sleeping arrangement, and introductions survive a long scene transition |
| Knowledge boundaries | Absent characters do not learn a secret; present characters gain knowledge through a supported channel |
| Memory completeness | An early-window fact survives a failed pass; a backlog is covered; unrelated fields survive replacements |
| Review and concurrency | Distinct pending facts persist; thought/knowledge coexist; stale async replacements do not overwrite newer edits |
| Player agency | First-/second-/third-person authored actions are distinguished from invented choices; rewrites preserve valid intent |
| Long-term recall | A real older promise survives lint; a distinctive event is recalled when cued without unsolicited callbacks |
| Plot and voice | No early arc cost, endless escalation, forced subplot, repeated beat, flattened voice, or manufactured commitment |
| Correction/edit | OOC retcons persist; regenerated or deleted events no longer supply active memory |
| Provider limits | Truncated/malformed output, unavailable usage, and unsupported response formatting are visible and recoverable |

For model comparisons, hold the snapshot, prompt version, and player action constant; use repeated samples and blind human preference where possible. First establish the current baseline, then change one factor at a time. A later 100-turn pilot is useful, but rare continuity failures require longer runs and regression fixtures.

Track:

- Human preference for prose, character voice, agency, responsiveness, and pacing.
- Continuity corrections and regenerations per 100 turns, with error categories.
- Important supported changes captured/applied versus missed; false facts and lost unchanged facts.
- Time from source event to active memory, plus pending-review age.
- Memory parse/rejection/overflow rates and confirmed coverage gaps.
- Calls, tokens, cache behavior, latency, total cost, and cost per accepted turn.

A cheap variant passes only if it preserves the agreed quality bar. Local tests can prove reducer and payload behavior; they cannot prove that prose is enjoyable or that a model follows long prompts in real play.

## Order of work

| Phase | Work | Gate before proceeding |
|---|---|---|
| 1. Establish baseline | Use the current fixes; inspect context, updates, review delay, and all request categories on a representative run | Failures and costs can be attributed to specific paths |
| 2. Make memory reliable | Separate attempt/coverage markers; preserve pending deltas; revision-check replacements; independent memory references; knowledge eligibility; explicit overflow | Deterministic failure/review/concurrency fixtures retain all required facts |
| 3. Improve narrative fidelity | Canon-aware lint, more accurate agency detection, consistent OOC rules, retrieval diagnostics, provenance-aware retcons | Fewer continuity/agency errors without worse prose or pacing |
| 4. Optimize measured waste | Dedicated memory profile, redundant update suppression, provider-aware caching, cadence and model trials | Cost per accepted turn falls while quality and memory accuracy hold |
| 5. Expand only for demonstrated gaps | Exceptional event capture, inspectable semantic retrieval, or larger architecture changes | A concrete recurring failure warrants the added complexity |

The recommended first implementation scope is Phase 2, beginning with failed-pass coverage and preservation of unapproved changes. Keep the narrator/memory separation Claude established. Make the information path dependable before making it cheaper.
