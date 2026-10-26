# Shared memory assessment validation

The shared Plot / Story Cards / Brains / discovery assessment previously embedded a Story Card-only instruction to return an array and never suggest Plot updates. It now uses format-independent memory policy, with one four-group JSON object contract. Discovery retains its array contract; single-candidate repair and the legacy narrator envelope retain their own formats. Candidate-only schema hints stay out of the shared assessment.

Validation still requires every group and field, explicit negative reasons, eligible target IDs, real evidence IDs and the establishing narrator citation for positive changes. Missing fields are unfinished work. The validator reports locally constructed `memory_assessment_*` codes and JSON field paths for malformed JSON, wrong types, missing fields, invalid values, unknown targets, duplicate targets, unrequested groups, invalid evidence IDs and missing source citations. Error diagnostics do not include provider responses, offending values, private reasoning or credentials.

Memory Suggestions → Decisions displays the source ID, request stage, code, path and transport outcome. A failed shared assessment produces one failure diagnostic; four independent group transactions do not imply four HTTP requests. HTTP accounting remains separate from semantic validation.

No assessment format repair or additional retry request was added. Automatic retries retain the existing three-attempt backoff/quarantine limit. Explicit manual retry remains available. Failed assessment handling preserves saved assessment/draft/discovery checkpoints, messages, approved proposals and completed groups. Reuse still requires matching evidence/reference/control fingerprints; changed prompt policy invalidates outdated unfinished work. Loading a save does not schedule historical evaluation.

## Offline evidence

`assessmentTransport.test.ts` exercises the final serialized DeepSeek Anthropic-compatible `/anthropic/v1/messages` request, with and without prompt caching. Only HTTP responses are mocked. It covers the original quarantined breakfast source `message_mvohiudy_5a4yw393`, appending eleven completed tattoo sales and Fred's gold to existing product Lore; repeat approval/evaluation cannot duplicate it. The fixture includes verbatim source exchanges and existing topical cards/identity aliases, excluding credentials and private Brains.

Recorded Charms facts are suppressed even if a synthetic assessment nominates them again. Routine actions can complete with an explicit negative decision. Potions source `message_mvoiy27x_5drb0b0c` has both negative and supported public-Lore test cases: the completed Draught of Peace, Snape's spoken assessment, and the pending end-of-week test. Neither case invents his private thoughts or a lasting relationship change. These controlled verdicts verify application behavior, not model judgment.

Recovery tests retain completed groups and approved memory on failure, preserve checkpoints, and resume a quarantined generated draft with one remaining review request and no assessment/generation replay. Worker and Decisions tests cover reload inactivity, bounded retry, continued Play, safe diagnostics and manual retry.

## Same-fixture request and token comparison

The identical `assessmentCost.test.ts` harness ran against pre-fix main `4114061` and the fixed implementation. Synthetic responses and fixture data were held constant. Input/output counts below are **deterministic estimates** from the repository tokenizer, returned as synthetic usage to verify accounting; they are not billed provider measurements.

| Fixture | Requests before → after | Estimated input before → after | Estimated output before → after |
| --- | --- | --- | --- |
| Breakfast sales append | 3 → 3 | 14,304 → 14,275 | 303 → 303 |
| Already recorded Charms | 1 → 1 | 3,558 → 3,529 | 273 → 273 |
| Routine negative | 1 → 1 | 1,360 → 1,331 | 88 → 88 |
| Potions negative | 1 → 1 | 2,730 → 2,701 | 88 → 88 |
| Supported Potions Lore | 3 → 3 | 8,315 → 8,287 | 859 → 859 |
| Invalid assessment array | 1 → 1 | 1,360 → 1,331 | 2 → 2 |
| Total | 10 → 10 | 31,627 → 31,454 | 1,613 → 1,613 |

No live provider test was performed. Offline mocks do not prove that the model follows the corrected prompt. The export's historical generic validation failures do not identify which field failed, and this change does not reconstruct that missing evidence.

Final validation: `npm.cmd test` passed 933 tests in 87 files; `npm.cmd run build` passed TypeScript and Vite; `npm.cmd run smoke:prod` loaded the production index and both bundled assets. The build retains Vite's large-chunk advisory.

## Retry affected sources

1. Load the updated app and open the Hogwarts adventure. Loading alone sends no memory requests.
2. Open **Memory Suggestions → Decisions**. Use **Recovery failed** to find failed/quarantined sources, or search directly by source ID.
3. Search `message_mvohiudy_5a4yw393`, expand its source details, and click **Evaluate this source independently** once. Wait for completion and inspect the assessment/request diagnostics. Explicit retry can incur provider costs.
4. Review the resulting suggestion. A supported sales proposal should append to **Fred and George — Active Magical Products, September 2001**. Approve it if accurate; do not create a second product card manually.
5. Repeat for `message_mvoiy27x_5drb0b0c`. A valid negative decision is acceptable. If Lore is suggested, verify it records only supported public developments and preserves the pending test as pending.
6. Retry other affected sources individually as desired. Completed groups remain saved; no history-wide replay is necessary. If validation still fails, the new diagnostic identifies the field and error code for that new attempt.
