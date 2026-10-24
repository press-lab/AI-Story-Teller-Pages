# Automatic interpersonal memory reliability

Baseline: latest `origin/main` fetched on October 24, 2026, commit
`84ab46fc5d913caa17f70dc457c91a416d3a2333`. No private export is included here.
The supplied export was inspected read-only: 229 cards, all `autoUpdate=false`,
automatic detection every turn, turn 125 complete in all four independent groups,
and an earlier dinner response with pending legacy recovery.

## Root causes and scoped changes

Line references below describe this implementation unless identified as baseline.

- `src/state/turnPipeline.ts:123` previously persisted every assistant reply with
  undefined input mode. `src/memory/memoryEvidenceWindow.ts:5` now resolves story
  messages, including legacy assistant modes inferred from their player input;
  line 15 selects three story exchanges without spending the budget on OOC replies.
  Original message IDs/content remain unchanged. `memoryUpdateEvidence.ts:6`,
  `memoryCycleState.ts:12`, and `semanticEngine.ts:84` use that same distinction.
  `memoryCanon.ts:32` retains the last four explicit player OOC references as
  separately labelled continuity corrections, never event evidence.
- `src/memory/storyCardSuggestions.ts:11` previously emphasized first kisses and
  said almost-events were not completed actions, without distinguishing the
  interaction from its intended outcome. Discovery now explicitly covers meaningful
  advances, attempts, invitation decisions, confessions and boundaries, with
  counterexamples for ordinary gestures and research meals. Brains retain authored
  conditions (`semanticEngine.ts:264`); common guidance at line 104 distinguishes
  supported private change from observable Lore. No forced Brain firing was added.
- `src/memory/storyCardSuggestions.ts:122` previously inferred uncertainty from
  words anywhere in the evidence, including questions and negated outcomes. After
  successful source-bound semantic review, discovery uses explicit candidate/status
  metadata instead. Other callers keep their conservative lexical fallback.
  `memoryDetection.ts:197` preserves candidate review and source quotes; significant
  attempts are instructed to require review, ambiguous interpretations unresolved.
  Semantic validation receives the review-only classification, not an extra call.
- `src/memory/storyCardEntities.ts:126` previously accepted named places simply
  from their proper name and place noun. It now requires an attached identity or
  durable location description. New academy/fortress descriptions remain eligible;
  a dialogue destination mention alone does not. This deliberately conservative
  local gate leaves subtler valid discoveries to semantic evaluation.
- `src/memory/memoryDetection.ts:131` aligns the JSON example with required exact
  evidence quotes, original source IDs, memory mode and event status. Lines 155-164
  fail closed on invalid sources, metadata or quotes, including a missing quote
  from the establishing narrator. Source-bound mode/status fields are required.
- `src/memory/memoryDetection.ts:102` and line 144 record semantic returned counts,
  zero results, validation failures and duplicate/permission suppressions. Before,
  these paths could be silent. `semanticEngine.ts:1980` separates semantic discovery
  from deterministic identity nominations; the old line 1980 marked either as
  `storyCardDiscovery`. `adventureReducer.ts:1326` retains diagnostic-only actions
  on a failed non-stale transaction while withholding all memory writes. Stale
  transactions still discard everything. Provider exception bodies are not logged
  by the changed discovery/condition/review paths.

Existing-card eligibility (`semanticEngine.ts:337`) still respects auto-update
permissions and cooldowns. Discovery also suppresses protected opt-out destinations;
independent new historical Lore does not target the character biography. Existing
approval settings, source snapshots, reducers, deduplication and plot permissions
remain authoritative. No save migration, automatic historical replay, new mandatory
model request, or normal-turn retry was added. Prompt text changes slightly affect
input tokens; actual billing and changed-candidate call volume remain model-dependent.

## Hermione decision output: observed before, controlled after

The before column is the supplied export's actual persisted result. It does not
reveal whether the semantic model returned an empty array or candidates were lost:
the old diagnostics did not record that distinction. The after column is a synthetic
software-path regression with a controlled candidate and accepted review, not a
fresh paid evaluation of the private scene.

| Decision | Before: observed turn 125 | After: controlled significant-flirtation fixture |
| --- | --- | --- |
| Existing character update | None (opted out) | None (opted out) |
| Brain condition | Not fired | No private change assumed |
| Semantic Lore proposals | 0; raw return count unrecorded | 1; returned count recorded |
| Location proposal from tower mention | 1 deterministic nomination | 0 |
| Discovery fired label | `storyCardDiscovery` for identity alone | Semantic and identity origins separately counted |
| Lore content | Absent | Seth leaned in during flirtation; Hermione deliberately leaned back and then invited him to walk her to her tower; intent uncertain |
| Candidate status | Absent | `candidateOnly=true`, `requiresReview=true`, `eventStatus=unresolved` |
| Kiss or relationship asserted | None | None; no confirmed attempt or completed kiss |

With a semantic empty array, the new output instead records `zero_candidates`
with `candidateKinds=[semanticLore]`, even if an independent identity qualifies.
With invalid evidence it records `validation_rejected` and a failed group; it
neither invents quotes nor falls back to another mandatory model request.

## Regression evidence and limits

Synthetic cases in `src/memory/originalFoundation.test.ts` cover an explicit
attempt followed by withdrawal, a mutual first kiss, a significant ambiguous
lean/withdrawal, ordinary book-reading, accepted research dinner, unchanged
opted-out identity, source-contract failures, reruns, OOC persistence and the full
three-exchange budget. Identity tests cover tower dialogue and a genuinely new
academy. Legacy pending recovery remains listed by `pendingMemoryRecovery` for
explicit review and is not scheduled by `memoryCycleSources`; existing Decisions
UI regressions cover pending/quarantined recovery visibility.

Existing test assertions were updated to count proposal actions separately from
new diagnostics and expect sanitized provider failures. The old boundary test now
correctly excludes a legacy untagged assistant response to OOC input.

These tests establish software-path behavior, conservative routing and prompt
contracts. They do not establish that a particular model detects all significant
interpersonal developments. The ambiguous lean can justify a candidate only when
context establishes significance; code cannot deterministically infer intent,
consent, romantic meaning, or a new private perception from that gesture. Actual
provider detection quality remains unmeasured; no live calls were made and no API
keys or private adventure fixtures were committed. The completed source is not
silently replayed: older evaluations require explicit review/retry.

Validation completed: **745 tests passed across 75 files** (`npm.cmd test`),
including the relevant targeted regressions. `npm.cmd run typecheck`,
`npm.cmd run build`, `npm.cmd run smoke:prod`, and `git diff --check` passed.
The existing Vite bundle-size warning remains.
