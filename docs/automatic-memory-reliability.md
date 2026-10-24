# Automatic memory reliability audit

> Historical architecture/validation record preceding the original-foundation migration. For current automatic scheduling, costs and permissions, use [Foundation migration](foundation-migration.md). The compact pipeline described here remains available for explicit legacy catch-up.

Baseline: origin/main `86a5499` (24 October 2026). Source: the supplied Hogwarts University export, inspected read-only. The fixture contains four small transcript windows; no adventure file was changed.

## Findings and changes

1. **Inline contract competes with scene stopping rules.** `src/contextBuilder/contextBuilder.ts:362` assembles one system message, followed by chronological transcript messages. At baseline line 443 the one-pass contract preceded scenario narration rules, including the export's instruction to end naturally when Seth can respond. `src/hooks/useAdventureRuntime.ts:135` and `:142` explicitly restate the envelope permission in the later correction request, explaining a plausible prompt-adherence difference. The ledger establishes correlation, not a controlled causal model experiment. Move runtime scope/memory contracts after scenario narration rules within the same system section; make the empty envelope mandatory and explicitly distinguish stopping visible narration from ending the response (`src/memory/onePassMemory.ts:16`). Section ordering, Context Preview, visible pacing and agency rules remain intact.

2. **Output allowance was already present.** `src/hooks/useAdventureRuntime.ts:65`, `:74`, and `:143` reserve up to 1,400 memory tokens for direct and corrected narration. `src/state/turnPipeline.ts:93` parses the final response and `:183` queues missing/invalid envelopes. No memory-only narration rewrite or additional normal-play request was added.

3. **Recovery schema isolation stopped at the first structural failure.** `src/memory/compactMemoryFallback.ts:174` previously accepted only a chronological valid prefix. It now skips structurally malformed/missing sources and validates other independent sources in chronological order. Duplicate/foreign source IDs still reject the whole response, and evidence/attribution validation remains atomic within each source. Reiterate the exact JSON shape after source metadata (`:117`), without accepting invented formats or repairing unsupported candidates. Remove the whole inline-only prose/envelope preamble when constructing recovery instructions, so the mandatory XML rule never competes with recovery JSON. Exact quotes, bounded evidence windows, target checks, source snapshots, completion marking and retry backoff remain unchanged.

4. **Presence required a literal name in the current exchange.** The thought guard (`src/memory/onePassMemory.ts:156`) rejected the original pronoun-only Draconia continuation. `continuousThoughtParticipant` (`:67`) narrowly accepts an immediately preceding named participating partner and current third-person conversational action, while rejecting competing known characters, author boundaries, departure/scene-change cues and mere named mentions. This is deliberately conservative; it is not general coreference resolution. Current-turn quoted evidence and eligible/visible Brain checks still apply.

5. **Provider-specific controls could cross endpoint boundaries.** `src/providers/backgroundProvider.ts:31` inherited the narrator's explicit reasoning control even for a different background endpoint. It now inherits only for the same endpoint; a separate endpoint uses its explicit declaration or existing documented endpoint adapter. Unknown capabilities still fail before sending. Tests cover OpenRouter-to-DeepSeek separation.

## Provider findings and uncertainty

The export's 202 ledger records use OpenRouter GLM for all 120 narration, 53 correction and 13 recovery calls; other purposes account for the remaining records. Its saved preset is `deepseek-flash`, with no separate evaluator endpoint/model override. Runtime configuration and the call ledger, rather than that preset, determine the actual request.

Current main already includes OpenRouter GLM low-effort handling (`src/providers/memoryReasoning.ts:24`), request-body JSON mode (`src/providers/openAICompatible.ts:263`), specific HTTP rejection classifications (`:283`), and explicit-control reasoning assertions (`:414`). These were retained. OpenRouter documents `reasoning.effort`, reasoning consuming the completion budget, and model capability discovery: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens . GLM's always-on reasoning and low effort are documented by NVIDIA: https://docs.nvidia.com/nim/vision-language-models/latest/get-started/advanced/get-started-glm-5-3-flash.html . An off control is not interchangeable with low effort. No safety assertion was removed or newly bypassed.

Historical errors include invalid schema, rejected evidence, generic HTTP 400 and unknown non-thinking capability. The export does not preserve the raw evaluator JSON or rejected provider request/response bodies, so the precise old schema shapes and every historical 400 cannot be reconstructed. No live credentials were used. Provider-specific adherence, output consumption and endpoint acceptance remain unmeasured here; no new capability catalogue or speculative retry was introduced.

## Before/after measurements

The same six focused tests were replayed against baseline production files and the changed files, using mocked provider responses.

| Measurement | Baseline | Changed |
| --- | ---: | ---: |
| Focused realistic/isolation tests passing | 4/6 | 6/6 |
| Grounded meeting/research Story Card proposals | 2 | 2 |
| Legitimate pronoun-only Brain proposals | 0 | 1 |
| Legitimate Brain candidate rejected as absent | 1 | 0 |
| Repeated recorded prototype event proposals | 0 | 0 |
| Valid source completions across two malformed-source batches | 1/4 | 2/4 |
| Sources retained pending in those batches | 3/4 | 2/4 |
| Malformed sources persisted | 0 | 0 |
| Mocked recovery provider requests across those batches | 2 | 2 |

Historical inline metrics supplied with the export: 31/31 normal narrations lacked envelopes; 25/26 corrected narrations parsed envelopes; 68/97 assistant sources await recovery; 13 proposals (11 approved, 2 rejected, none pending). The file inspection confirms the 68 pending sources and proposal counts. Some ledger entries omit diagnostic fields and records include intermediate attempts: do not treat raw narration-call counts as distinct finalized turns.

These historical/live metrics have no measured after value: the user's save and pending recovery queue were not modified or replayed against a paid provider. Deterministic parsing tests still require an empty envelope for a valid negative evaluation; missing envelopes remain recoverable failures. Prompt ordering tests verify the change, not a claimed live envelope success percentage.

## Validation

- `npm.cmd test -- --exclude '**/.codex-worktrees/**'`: current source suite, including direct/corrected narration, zero/missing envelopes, provider transport/control tests, source attribution, historical deduplication, retry/backoff and completion idempotence.
- `npm.cmd run build`: TypeScript and production bundle.
- `npm.cmd run smoke:prod`: production asset loading.

An unfiltered `npm.cmd test` also discovers unrelated nested worktrees; that run failed in their old UI suites. The current source suite is reported separately. No changes were made to those worktrees or to test discovery configuration.

Final validation: 731 current-source tests across 71 files passed; TypeScript/production build and production smoke passed.
