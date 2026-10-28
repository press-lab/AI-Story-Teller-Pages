# Single-pass memory quality

This change preserves the existing single-pass memory architecture and its one
`sendMemoryCompletion()` request per batch of one to three narrator sources.
Runtime scheduling, idle flush, retry controls, provider configuration, request
accounting and output limits are unchanged. No new dependencies are used.

## Changed boundaries

- `prepareSinglePassMemoryBatch()` now supplies an explicit Character personality
  reference for each eligible matched Brain. `singlePassCharacterCard()` prefers a
  valid Character link, then a unique whitespace/case-normalized name or alias.
  Ambiguous profiles are omitted. Already supplied profiles are referenced through
  the existing pool; otherwise `singlePassPersonality()` prioritizes personality,
  motivations, relationships and voice within 500 characters. The exact selected
  profile and identity participate in `singlePassReferenceState()` validation.
- The single-pass `POLICY` asks for supported first-person private meaning,
  incremental changes and no update when nothing changed. It forbids transcript
  copies, invented feelings and unwitnessed knowledge. Lore instructions compare
  canon and considered suggestions and distinguish new consequences from retelling.
- `brainConditions()` has a broader default private-change condition. Authored
  conditions, eligibility, matching and cooldowns remain intact. The separate
  `defaultBrainPrompt()` generation path is unchanged.
- `privateThoughtQualityReason()` conservatively recognizes quoted dialogue,
  near-total contiguous source copies and existing Brain text without turn
  prefixes. `validateSinglePassSource()` records quality suppressions separately
  from validation failures, preserving valid siblings and successful empty sources.
- `safeLoreAppendTarget()` permits only unique exact Lore titles or explicit,
  specific topical aliases. `resolveLooseDestination()` retains advisory ranked
  candidates as review choices when automatic placement is unsafe; the fact and
  proposed CREATE title survive. Other Story Card routing remains intact.
- `loreNovelty()` in `factCoverage.ts` compares individual statements within the
  same destination/subject, including pending/resolved compact historical proposals
  and earlier accepted findings. Exact and narrowly normalized facts can be
  suppressed; lexical similarity only requires review. Partial drafts stay intact.
- `ADD_MEMORY_PROPOSAL` rechecks current coverage and retains title conflicts or
  uncertain overlaps for review. Lore bypasses older cross-card fuzzy deletion;
  the existing `contentLooksDuplicate()` thresholds are unchanged.
- `equivalentStoryCardSuggestions()` uses the same Lore fact normalization and
  subject/date boundaries before merging proposals. Explicit occurrence dates and
  bracketed dates survive both merging and coverage.
- `APPROVE_MEMORY_PROPOSAL` rechecks current canon. Covered approvals are recorded
  as no-ops; partially covered drafts remain pending. CREATE title collisions
  require explicit destination selection or a changed title. No canon is silently
  redirected or overwritten, and source/history records remain available.
  `applyApprovedMemoryProposal()` appends validated Lore without the legacy helper
  that discarded bracketed date prefixes; other card appends retain that helper.
- `MemorySuggestionsPage()` groups pending proposals by destination ID, or
  normalized CREATE title/type; Brain groups use character names. Group labels,
  counts and previews follow search results. Individual proposal controls and lazy
  archived-history inspection remain independent. Stable group render keys keep
  title editing usable.

## Baseline measurements

Compared directly with `3ac14fa66d2aea5d8022f3adea414581612635e5` using the
same synthetic three-source adventure and identical mocked response. The seven
findings contain Fred's copied spoken line, two supported private interpretations,
three narrowly rephrased recorded Lore facts and one new consequence. No live
provider was called. Temporary baseline modules were removed after measurement.

| Measurement | Starting commit | Updated |
| --- | ---: | ---: |
| Brain proposals | 3 | 2 |
| Lore proposals | 4 | 1 |
| Provider requests for three sources | 1 | 1 |
| Total prompt characters | 18,472 | 20,723 |
| Approximate prompt tokens | 4,618 | 5,181 |
| Policy characters / approximate tokens | 3,723 / 930 | 5,614 / 1,403 |
| Payload characters / approximate tokens | 14,749 / 3,688 | 15,109 / 3,778 |

The increase is approximately 563 input tokens (12.2%) in this compact fixture:
473 for instructions/examples and 90 for explicit pooled profile references.
These are repository `approximateTokenCount()` estimates, not billed tokenizer
counts. Unpooled profiles add at most 500 content characters per matched Brain;
the pool reuses identical references across sources. Prompt size varies with the
adventure, source count and existing inventory.

## Regression coverage and limits

Synthetic regressions cover private voices, absent perspectives, existing thought
preservation, empty successful evaluations, profile dependency edits, unrelated
Quidditch/relationship destinations, exact and ambiguous topics, explicit choices,
tattoo/blazer/ring duplicates, new consequences, actors, negation, uncertainty,
plans/actions, attempts/completion, offers/acceptance, dated occurrences, approval
ordering and partial draft preservation. UI tests cover counts, search, independent
editing/approval and opening archived history. Runtime tests cover shared Brain/Lore
requests and successful suppression-only sources without a retry or repair request.
Existing compression worker and persistence tests remain part of the full suite.

Deterministic checks do not establish semantic truth. Unsupported knowledge,
subtle paraphrases, implicit subjects and ambiguous pronouns still depend on the
extraction instructions and author review. Novelty deletion requires exact or
narrowly established wording within the same subject; uncertain similarity survives.
Semicolon qualifiers stay with their claim; sentence splitting is conservative.
Explicitly dated or otherwise distinct occurrences are retained. Identical undated
retellings cannot always be distinguished from separate occurrences. Source-copy
checks intentionally allow short quotations within substantial private meaning.
No existing saves or Story Cards were cleaned up or migrated.

## Validation results

- `npm.cmd test`: 104 test files passed; 1,491 tests passed, 1 existing test skipped.
- `npm.cmd run build`: TypeScript and Vite production build passed.
- `npm.cmd run smoke:prod`: production assets loaded successfully.
- `git diff --check`: passed.

The build retains its existing large-chunk advisory. No live API tests ran.
