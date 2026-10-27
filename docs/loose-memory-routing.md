# Tolerant memory extraction and deterministic routing

Starting commit: e9c5fbc35cfe09b9c46b343434feb33150f0cf6d. The clean
application checkout and freshly fetched origin/main matched before editing;
a second fetch confirmed no newer remote changes before commit. The ending
commit and verified remote SHA are provided in the completion response.
The implementation uses the current application checkout; the separate
worktree already holding local main and all synchronized saves were untouched.

Reference read: [Inner-Self/src/library.js](https://github.com/LewdLeah/Inner-Self/blob/main/src/library.js),
blob fc7ca5b56ae5179bd1ba65fc1ef1d53f1d17546e, including all requested ranges
for forgiving delimiters, normalization, interpretation, entity detection,
matching, deduplication and output handling. No AI Dungeon runtime or Auto-Cards
generation requests were imported.

## Model contract and pipeline

    one memory completion
      -> parseLooseMemoryOperations
      -> resolveLooseSource
      -> resolveLooseCategory
      -> resolveLooseDestination
      -> buildLooseFinding / normalizeSinglePassFinding
      -> validateSinglePassSource
      -> COMMIT_SINGLE_PASS_MEMORY_BATCH
      -> ADD_MEMORY_PROPOSAL
      -> activeState.memoryProposals

The preferred output is (category.subtype: Subject = New information), one
operation per fact under S1/S2/S3. Brain defaults to thoughts and Story Card to
lore. NONE explicitly evaluates an empty source. The prompt no longer asks for
MEM/TEXT/END/DONE, database IDs, evidence or target aliases, quotes, thought keys,
triggers, internal mutation enums or a JSON output schema. Historical JSON and
MEM retain compatibility paths.

The router supplies actual target IDs, operations, patches, fresh deterministic
thought keys, Story Card subtype, triggers, resolved participants, conservative
mode/status, provenance and placement/review metadata. It does not persist,
mutate the Adventure or call a provider. Every loose finding has
candidateOnly=true: all surviving proposals await manual review even when
per-type auto-approval is enabled. Protection and approval controls remain.

## Parser grammar and recovery

Accepted forms include:
- (brain: George Weasley = I think this could become a real business.)
- [Brain: George Weasley = I think this could become a real business.]
- {brain: George Weasley = I think this could become a real business.}
- brain: George Weasley = I think this could become a real business.
- brain George Weasley: I think this could become a real business.
- story card lore: Tattoo Business = The first batch ships tomorrow.
- lore: Tattoo Business = The first batch ships tomorrow.
- component.currentArc: Main Arc = The investigation has entered its final phase.

Case and label separators normalize locally. Canonical aliases cover
thought/private thought, Brain state/relationship/emotion/developments, all real
Brain fields, lore/event/story/memory, storycard/story card, character/new
character, location/place, custom story card, and every actual ComponentType.
Unknown explicit subtypes remain explicit for rejection. An unknown category
with a clear assignment remains unclassified for review-only Lore recovery.

Source headers accept S1, S1:, [S1], Source 1 and Source 1:, including an operation
prefixed on the same line. A one-source batch may omit its source label; a
multi-source batch never guesses attribution. Explicit empty sections and NONE
count as evaluated. Missing sections do not.

Recovery handles missing opening/closing brackets, mismatched brackets,
whitespace, repeated delimiters, bullets, numbered entries, outer quotes,
multiline values, adjacent blocks, complete Markdown fences and complete
reasoning wrappers. Only complete reasoning is removed. Unfinished reasoning or
fenced output is not parsed; prior valid siblings survive. Recognizable
operation/source boundaries recover a preceding unclosed operation.

Only the first valid assignment boundary divides subject/content. Later equals
or colons remain factual text. Balanced factual parentheses, f(x), brackets and
|| outside an explicit Character correction survive. Only the correction
grammar splits the enduring reason after ||. Factual sentences are never
reconstructed, arbitrary paragraphs without a boundary are not promoted to
memories, and text is never executed.

The parser result is transient. Optional finding/checkpoint fields are
backward-compatible and require no database migration or adventure rewrite.

## Routing decision table

Every proposal below passes existing validation, placement and deduplication
and requires review.

| Category/subtype | Destination rule | Finding/proposal outcome |
| --- | --- | --- |
| Brain.thoughts (default) | Unique normalized exact active characterName in the source's eligible Brain manifest; otherwise unique exact linked Character alias resolving to that eligible Brain | brain / patch / brainUpdate with fresh local thought key |
| Brain.currentState | Same unique Brain lookup | brainUpdate patch for currentState |
| Brain.relationshipPressure | Same lookup | brainUpdate patch for relationshipPressure |
| Brain.emotionalInterpretation | Same lookup | brainUpdate patch for emotionalInterpretation |
| Brain.recentDevelopments | Same lookup | brainUpdate patch for recentDevelopments |
| Brain.notes | Same lookup | brainUpdate patch for notes |
| Brain absent/inactive/ineligible/ambiguous | No unique eligible active perspective | Precise rejection; no Brain creation or Lore fallback |
| Lore exact title | Search only Lore, exact normalized title first | Unique ID: append storyCard proposal |
| Lore exact key | No exact-title match, exact normalized Lore key | Unique ID: append |
| Lore topical | Call storyCardTargets(adventure, finding), filter returned IDs to Lore | One ID: append; no Character/Location/Custom destination |
| Lore multiple matches | Several exact or topical choices | Retain factual content and all candidate IDs in Story Card review metadata; no arbitrary choice or multi-card write |
| Lore no match | No matching Lore destination | New Lore proposal |
| Lore protected/stale/duplicate | Preserve author protection and target/source snapshots; run fact coverage | Review protected; fail stale transaction; suppress covered fact |
| Character new identity | Exact Character title/key, then matchingStoryCardEntities establish no existing identity | New Character proposal with local name triggers, no Brain |
| Character already covered | Existing identity and duplicate fact | Suppressed with recorded disposition |
| Existing Character ordinary development | Existing unique identity without explicit justified enduring correction | Review-only Lore candidate; factual topic title prevents biography-title deduplication erasing it |
| Character.update | Existing unique identity plus fact and nonempty explicit reason after || | Append to actual Character ID; local identityChange plus narrator evidence; characterProfileChangeError runs |
| Character ambiguous or unjustified correction | Multiple identities, no existing correction target or missing reason | Reject, never duplicate profile or invent an enduring explanation |
| Location durable property | Unique exact normalized Location title/key | Append; no match creates reviewed Location; ambiguity rejects |
| Location event classified as Lore | Model identifies event instead of enduring property | Lore path; location profile untouched |
| Custom durable subject | Unique exact normalized Custom title/key | Append; no match creates reviewed Custom; ambiguity rejects |
| Unclassified assignment | Valid source and nonempty subject/fact with assignment boundary, no conflicting explicit category | Review-only Lore using normal Lore resolution |
| Component.plotEssentials | Exact title, correct subtype, source eligibility, active, autoUpdate=true | Replacement / plotEssentialsUpdate |
| Component.currentArc | Exact title and correct existing active eligible arc, no opt-out | Append delta / currentArcUpdate; no Director phase change |
| Component.activePressure | Exact title, subtype and active eligible target, no opt-out | Replacement / plotPressureUpdate |
| Component.immediateMomentum | Exact title and correct active existing subtype, no opt-out | Replacement / plotMomentumUpdate; always review, only explicit manual approval applies to matching source/target snapshot |
| Component.narrationRules | Recognized but unsupported | Explicit unsupported-destination rejection |
| Component.aiInstructions | Recognized but unsupported | Same rejection |
| Component.authorNote | Recognized but unsupported | Same rejection |
| Component.memory | Recognized but unsupported | Same rejection, no Lore fallback |
| Component.custom | Recognized but unsupported | Same rejection, no Lore fallback |
| Component missing/duplicate/inactive/opted out/wrong subtype/new creation | No unique eligible existing target | Reject, never create or select first array entry |
| Unknown explicit subtype | Explicit category remains intact | Reject instead of guessing another subtype |

The unsupported component reason is exactly: "Recognized component subtype;
automatic memory routing is not permitted."

Local code establishes structural identity and placement. The model's category
supplies semantic classification: Location/Custom durability, knowledge and
completion are not invented through new keyword heuristics. Source attachment
is provenance, not semantic proof. A structurally eligible but unsupported
interpretation remains review-required rather than becoming an automatic write.
Plans, attempts and future meetings preserve their original wording. Loose Lore
status defaults conservatively to unresolved instead of asserting completion.

Brain thoughts never overwrite live or archived keys. Duplicate coverage ignores
local turn prefixes and checks live and archived thoughts. Existing card coverage
also recognizes an exact normalized factual delta contained in its target.
Existing pending/dismissed coverage, event deduplication, source revisions,
historical evidence windows, author controls and stale destinations remain.

## Partial results and diagnostics

Explicitly empty evaluations complete. Valid plus rejected operations complete
with valid siblings committed and each precise rejection retained in checkpoint
dispositions. Fully duplicate evaluations complete with suppression dispositions.
All recognized candidates rejected, missing/unattributable/absent sources,
stale checkpoints or provider errors fail the affected source. Valid independent
sources still commit. No automatic repair or retry was added.

Optional parsedCount/routedCount/proposedCount supplement existing
accepted/rejected/suppressed/review counts. Proposed counts reflect actual
retained proposals after reducer suppression. Source diagnostics expose all six
requested operation counts without adding private Brain text to normalization
logs.

## Six actual Memory Inbox results

Both required tests exercise the full production path:
src/hooks/useAdventureRuntime.singlePass.test.tsx (actual hook and HTTP transport)
and src/memory/memoryPipeline.regression.test.ts (provider through reducer).

The fixture contains existing Fred/George/Draconia Character cards and eligible
Brains, business Lore, Great Hall Location, Rune Tattoo System Custom card,
Active Pressure, Current Arc, and three saved narrator sources.

| Input | Asserted activeState.memoryProposals outcome |
| --- | --- |
| Weasley Tattoo Business | Exactly one Lore append to ID business |
| George's belief | Exactly one brainUpdate to ID brain-george with the exact belief |
| Eleanor Vale | Exactly one new Character proposal, no target ID |
| Observatory Annex | Exactly one new Location proposal, no target ID (fixture's existing Location is Great Hall) |
| Draconia Research Meeting | Exactly one new Lore proposal; future meeting remains explicitly uncompleted |
| Ministry Deadline | Exactly one plotPressureUpdate to eligible ID pressure |

All six remain pending/review-required despite enabled auto-approval preferences.
All Character biographies, Brain state and components remain unchanged before
approval. Each proposal carries its own saved narrator's exact original content,
not a later sibling's evidence. All three sources complete with two parsed,
routed, proposed and review-required operations each; none rejected/suppressed.

The missing S1 closing bracket loses neither S1 operation. Exactly one memory
extraction HTTP request is made, alongside three unchanged narration requests.
There are zero extra generation, repair or paid validation requests and no
legacy worker calls. The reducer test also proves the commit cannot replay.

## Every added or modified file and function

| File | Scope |
| --- | --- |
| src/memory/looseMemoryParser.ts (added) | Types LooseMemoryOperation/LooseMemoryParseResult; parseLooseMemoryOperations; labels, label, key, head, recognizableStart, cleanEdge, decoration; local flush/reject |
| src/memory/looseMemoryRouter.ts (added) | resolveLooseSource, resolveLooseCategory, resolveLooseDestination, buildLooseFinding, routeLooseMemoryOperations; normalize/hash helpers and resolution types |
| src/memory/looseMemoryParser.test.ts (added) | 91 exact grammar/recovery/source/content-preservation cases; no database, React or provider |
| src/memory/looseMemoryRouter.test.ts (added) | 66 Brain/card/component, ambiguity, eligibility, coverage, stale source and reducer/approval cases |
| src/test/looseMemory.ts (added) | looseMemoryFixture, shared response and source narrations |
| src/test/looseMemoryAssertions.ts (added) | expectSixLooseProposals, exact shared Inbox/provenance/source/counter assertions |
| src/memory/singlePassMemory.ts (modified) | POLICY; singlePassReferenceState; prepareSinglePassMemoryBatch; normalizeSinglePassFinding allowlist; singlePassFindingSchemaError; parseSinglePassMemoryResponse; parseSinglePassMemoryCommands partial-failure handling; runSinglePassMemoryBatch |
| src/memory/singlePassMemoryValidation.ts (modified) | validateSinglePassFinding Momentum support; toSinglePassProposal subtype/candidate/operation mapping; validateSinglePassSource partial success, duplicate coverage and suppression |
| src/state/adventureReducer.ts (modified) | routedProposal keeps local destinations; applyApprovedMemoryProposal reviewed Momentum replacement; reduceAdventure COMMIT_SINGLE_PASS_MEMORY_BATCH counts and ADD_MEMORY_PROPOSAL ambiguity retention |
| src/types/adventure.ts (modified) | Finding kinds/operations/candidate IDs; optional source/checkpoint/diagnostic counts |
| src/memory/singlePassMemory.test.ts (modified) | Partial results require completion and retain exact rejected-operation assertions |
| src/hooks/useAdventureRuntime.singlePass.test.tsx (modified) | Partial-source completion and six-proposal HTTP/runtime test |
| src/memory/memoryPipeline.regression.test.ts (modified) | Six-proposal provider-to-reducer test |
| src/state/adventureReducer.test.ts (modified) | Completion with precise rejection reason, accepted/rejected dispositions, counts and untouched unexamined sources |
| docs/loose-memory-routing.md (added) | This report |

No scheduling changes were made in useAdventureRuntime.ts. Narration, cadence,
batch size, Story Card triggering, content budgets and Memory Inbox UI remain.

## Final verification and limits

- npm test: 1,428 tests passed across 98 files.
- npm run typecheck: passed.
- npm run build: passed, 139 modules transformed.
- npm run smoke:prod: passed, index and both JS/CSS assets loaded.
- git diff --check: passed.
- Existing Vite large-bundle warning remains; build/smoke succeed.
- Legacy JSON/MEM, continuity, approval, stale evidence and API accounting tests remain in the full suite.
- No failing tests were deleted. Superseded partial-source failure expectations were replaced with completion plus exact rejection/disposition assertions.
- No live paid model replay was performed.

This verifies the complete extraction-to-Inbox path and one memory request per
batch. Real-model suggestion quality and monthly dollar spend are not measured
by offline checks. Observe acceptance and token usage during normal play before
claiming a dollar saving or recall improvement. The ending SHA and push result
are verified after this report is committed and appear in the completion response.
