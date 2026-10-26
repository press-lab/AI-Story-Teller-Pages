# Deterministic memory processing report

Repository: press-lab/AI-Story-Teller-Pages.
Verified base: `5b3c34a60e3aca77ce00af26283f03201e19d2ea`.
Branch: `codex/fix-shared-memory-assessment`.

Normal memory processing uses one extraction request. Local code parses, normalizes, validates, and routes the findings. The existing proposal reducer stores the results. The legacy pipeline keeps its paid validators.

## Modified files and functions

| File | Modified functions or declarations |
| --- | --- |
| `src/memory/singlePassMemory.ts` | `POLICY`, `normalizeSinglePassFinding` (new), `singlePassFindingSchemaError`, `unwrapResponse` (new), `recoverSourceRecords` (new), `parseSinglePassMemoryResponse`, `runSinglePassMemoryBatch`. `buildSinglePassMemoryMessages` uses the new policy. |
| `src/memory/singlePassMemoryValidation.ts` | `singlePassSourceError`, `toSinglePassProposal`, `validateSinglePassSource`. |
| `src/triggers/semanticEngine.ts` | `localComponentValidation` (new), `generatedActionsFor`, its local `bindLocalProposal` helper (new), `runSemanticPostTurnEvaluation`, `runManualBrainUpdate`, `runManualPlotEssentialsUpdate`, `runManualStoryCardsUpdate`, `runManualPEComponentUpdate`, `runMemoryReconcile`, `runMemoryCycle`. |
| `src/state/adventureReducer.ts` | `adventureReducer`, in `COMMIT_SINGLE_PASS_MEMORY_BATCH`. |
| `src/types/adventure.ts` | `ProviderUsage`, `ApiCallRecord`, `SinglePassMemorySourceResult`, `MemoryDiagnostic`. No executable functions. |
| `src/providers/apiCallAccounting.ts` | `optionalProviderUsage` (new), `fetchWithAccounting`. |
| `src/providers/openAICompatible.ts` | `addUsage`, `sendOpenAIRequestOnce`, `sendAnthropicRequest`. |
| `src/providers/openAIMemoryResponses.ts` | `sendOpenAIMemoryResponse`. |
| `src/providers/memoryCostSummary.ts` | `summarizeMemoryCosts`. |
| `src/pages/MemoryDecisionsPage.tsx` | `MemoryCostSummary`, diagnostic `labels`. |
| `src/memory/singlePassMemory.test.ts` | Existing extraction suite; new anonymous tests for wrappers, metadata recovery, malformed payloads, source IDs, and truncated JSON. |
| `src/memory/singlePassMemoryValidation.test.ts` | New anonymous test for Brain thought overwrite and unusable Brain patches. Existing evidence, protected-target, profile, and stale-source tests remain. |
| `src/memory/singlePassMemory.comparison.test.ts` | Existing comparison test; new anonymous tests that count actual mocked HTTP attempts for manual tools, failed requests, local work, and Brain-derived notes. |
| `src/memory/memoryPipeline.regression.test.ts` | New anonymous test for partial source recovery, duplicate suppression, and failed-source scheduling. |
| `src/memory/memoryArchitecture.integration.test.ts` | New anonymous test for normalized findings, pending proposals, and explicit approval. |
| `src/state/adventureReducer.test.ts` | New anonymous test for accepted and rejected sibling findings, failed source state, pending sources, and reload. |
| `src/memory/storyCardPlacement.test.ts` | New anonymous test for local rejection of a private note on a Character profile. |
| `src/triggers/semanticEngine.test.ts` | Validator mock setup now retains the real `memoryUpdateShapeError` export. |
| `src/memory/memoryQuality.integration.test.ts` | Manual component tests now check local validation and explicit review instead of a paid semantic verdict. Legacy validator tests remain. |
| `src/memory/reconcileLore.test.ts` | Reconciliation tests now check local placement, unchanged generated content, and explicit review. Removed the unused paid-verdict fixture helper. |
| `src/pages/BrainsPage.preview.test.tsx` | Provider fixture and preview tests now use a new thought key and one generation request. They do not authorize overwrites. |
| `src/providers/openAICompatible.test.ts` | Existing retry accounting test extended; new anonymous tests for optional metrics, precedence, cache usage, and unknown usage. |
| `src/providers/memoryCostSummary.test.ts` | New anonymous tests for reasoning usage, visible output, separate costs, and incomplete coverage. |
| `src/providers/apiCallAccounting.timeout.test.ts` | New anonymous tests for unavailable metrics, HTTP errors, and partial usage. Existing timeout tests remain. |
| `docs/deterministic-memory-processing-report.md` | This report. No executable functions. |

## Deterministic recovery rules

- Keep the outer `sources` array. Require one identifiable record for each requested source. Reject duplicate and unknown source IDs. Never guess source attribution.
- Require `kind`, a valid destination where needed, a usable factual payload, and evidence. Do not create facts, quotes, Brain patches, or destination IDs.
- For a missing title, use the existing target title or character name. For a new card, use a short literal content excerpt. The excerpt uses up to eight words and 60 characters. When possible, it excludes the final word so it cannot equal the complete factual payload.
- For a missing reason, use `Extracted from narrator source <sourceId>.`.
- For a missing candidate flag, use `true`.
- For a missing card operation, use `append` for an existing target and `create` for a new card.
- For missing card type or mode, use the existing target values. For an unspecified new card, use `lore` and `static`.
- For missing event status, use `unresolved`. Do not infer completion from words in the story.
- For missing triggers, use `generatedStoryCardTriggers`. For missing participants, use an empty array.
- Keep valid explicit metadata. A conservative default sets `candidateOnly=true`. Record local recovery and ignored unknown fields in diagnostics.
- Remove a byte-order mark, one complete Markdown fence, and complete leading thought sections. Keep unmatched tags. Do not extract records from unmatched thought sections.
- If outer JSON parsing fails, scan string state, escapes, and bracket depth. Recover only balanced source objects inside the root `sources` array. Parse each object with `JSON.parse`. Do not reconstruct cut strings or objects.
- Keep original finding indexes. Keep valid sibling proposals when another finding or source fails. Record failed sources. Only explicit Retry can start another attempt.

The existing source checkpoints, chronological commit order, reference checks, proposal path, evidence checks, placement checks, permissions, word limits, and factual coverage checks remain. New-card append metadata now uses the same absent value as the reducer. This keeps placement fingerprints stable through proposal storage.

## Removed normal paid validation

`generatedActionsFor` takes an explicit `local` or `legacy` policy at each call site.

Normal Brain updates no longer call `validateMemoryUpdate`. They retain JSON parsing, patch sanitization, recognized-field checks, unchanged-field removal, duplicate thought suppression, overwrite protection, archive restrictions, and the approval path.

Brain-derived Story Card notes no longer call `validateMemoryUpdate`. A linked card must exist. Local code binds the source and placement. Every note requires review. A Character append without the existing profile-change contract is rejected locally.

Normal Story Card updates no longer call `validateStoryCardProposal`. They keep the generated delta, bind local placement, and require review. An ambiguous Character event becomes a new Lore proposal. Manual reconciliation also uses local placement and review instead of paid Story Card validation.

Normal Plot, Active Pressure, and Current Arc updates no longer call `validateMemoryUpdate`. Local code checks the existing component, its type, its format, its size, and duplicate coverage. Invalid output does not produce an update marker. Plot Essentials and Active Pressure remain replacements. Current Arc remains an append.

The paid implementations in `validateMemoryUpdate.ts` and `validateStoryCardProposal.ts` remain unchanged. The existing legacy cycle explicitly selects `legacy`. Their legacy tests remain.

## Request counts

The before counts below come from baseline code paths. They are not measured provider charges. They assume one usable generation response and one accepted validator response where applicable. The after counts are actual `fetch` attempts with mocked network responses.

| Workflow | Baseline path | After |
| --- | --- | --- |
| Automatic single-pass batch, up to three sources | 1 | 1 |
| Manual Brain generation | 2 | 1 |
| Manual Story Card generation | At least 2; a corrected placement could need more | 1 per selected card |
| Manual Plot or Active Pressure generation | 2 | 1 per selected component |
| Manual Current Arc through `runManualPEComponentUpdate` | This operation did not accept Current Arc | 1 |
| Ordinary targeted Current Arc action | 1, or 2 for an independently validated legacy action | 1 for local processing |
| Local validation | 0 HTTP attempts | 0 |
| Local JSON recovery | 0 HTTP attempts | 0 |
| Local duplicate suppression | 0 HTTP attempts | 0 |
| Failed manual Brain HTTP attempt | No new retry was added | 1; no automatic retry |

The existing three-source scripted comparison measured seven HTTP attempts for the explicit legacy flow and one for the single-pass flow. Both used the same stored sources. Legacy made one assessment, three discovery requests, and three validation requests. Single-pass made one extraction request. These are separate pipeline measurements, not evidence that the old single-pass path made seven requests.

## Accounting

Reasoning usage uses this precedence: `completion_tokens_details.reasoning_tokens`, then `output_tokens_details.reasoning_tokens`, then `reasoning_tokens`. Invalid or absent values remain unknown. A valid nonnegative `usage.cost` becomes `reportedCostUsd`.

Reasoning tokens remain part of completion tokens. Tariff estimates use the full completion count. Visible output is calculated only when completion and reasoning counts are known and consistent. Incomplete reported-cost coverage has no total. Reported costs and tariff estimates stay separate. Partial usage retains available optional metrics without inventing missing token counts. Missing cache or optional metric coverage remains unknown when retry responses are combined. If either retry response has no complete usage, aggregate usage is unknown. The ledger still retains the available usage for each attempt.

The existing ledger shows purpose, stage, model, provider host, status, token fields, visible output, reported cost, and available verified tariff estimates. Accounting does not store prompts, response bodies, or keys. No usage request was added.

## Validation results

- `npm.cmd test -- --reporter=dot`: 96 test files passed; 1,147 tests passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed. Vite reports a JavaScript chunk larger than 500 kB. No bundle-splitting change was made.
- `npm.cmd run smoke:prod`: passed. The production HTML and two referenced assets loaded.
- `git diff --check`: passed before staging.

The regression suite covers partial failures, accepted siblings, pending and failed states, duplicate suppression, source edits, protected destinations, Character exceptions, and Brain overwrite restrictions. HTTP tests count failed attempts as well as successful attempts. Legacy tests remain separate from the new local-path HTTP tests.

## Limits and live verification

No unresolved compile or test failure remains. No saved adventure data was changed. No dependency, memory pipeline, model-specific parser, provider setting, narrator prompt, context budget, activation rule, or cadence change was added.

Some old manual-tool tests required a second model to reject semantic mistakes. That expectation conflicts with this specification. Those tests now require explicit review. The local checks were not presented as a substitute semantic verdict. The existing profile, overwrite, source, and placement checks were kept.

Local evidence checks can establish that a quote is exact. They cannot prove that a generated claim follows from the quote. The first model can still misread consent, attribution, knowledge, chronology, or lasting character change. A reviewer must inspect uncertain drafts.

A cut source object cannot be recovered. Its source remains failed until explicit Retry. Complete sibling source objects can still commit.

Live gameplay must check multi-turn attribution, player agency, private knowledge, uncertain relationships, event completion, profile changes, and proposal usefulness. It must also check response handling on the user's actual remote and local endpoints. Production smoke tests check static delivery, not browser gameplay or provider behavior.

Memory quality is not verified by these unit and integration tests. No live provider request was made for this task. Reasoning usage is shown only when the provider supplies it. No reduction in API charges is claimed.
