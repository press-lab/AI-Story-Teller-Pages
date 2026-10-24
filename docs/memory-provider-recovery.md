# Paused Memory Suggestions and recovery

The background memory evaluator is independent of narration. A working narrator does not establish that memory evaluation ran. A background Base URL such as `1` is invalid. Memory preflight now stops before claiming a source or spending its retry attempt, logs `configuration` with a safe failure code, and displays an actionable pause message. An empty background model inherits the active provider model; an empty effective model is invalid. Invalid overrides never select a substitute memory provider.

## Recover existing failed or quarantined sources

1. In provider settings, correct Background Base URL to the intended absolute HTTP(S) endpoint. Set the intended background model, or leave it blank to inherit the active provider model. Correct provider access and credentials locally; do not put keys in exported saves or issue reports.
2. Open Memory Suggestions → Decisions, select **Recovery failed**, and expand a source. Inspect its error and completed groups.
3. Use **Evaluate this source** on selected entries. Requests are explicit and bounded (the runtime accepts one to ten sources). Start with one source and inspect discovery diagnostics and proposals before processing more history. Correcting settings or loading an adventure never launches historical recovery.
4. Review the pending suggestions normally. Do not reset evaluation metadata or delete cards/proposals to force recovery.

Manual recovery can retry failed/quarantined sources regardless of their old attempt count. It skips completed groups and completed sources, retains source text and evidence checks, and uses the existing proposal approval/rejection and deduplication boundaries. A remaining provider/output failure can fail again; configuration correction is not a guarantee of a successful model response. New unclaimed pending entries remain eligible at the existing bounded cadence on a subsequent story turn.

## Read the diagnostics

- `configuration` / `memory_background_base_url_invalid`, `memory_provider_base_url_invalid`, or `memory_provider_model_missing`: no provider request ran; fix the named setting.
- `transport_api` / `memory_provider_request_failed`: the request failed; raw provider exceptions are omitted to avoid persisting credentials.
- `invalid_model_output` / `memory_model_output_invalid`: output failed parsing or the source contract. Evidence rejection is also recorded separately.
- `zero_candidates` with `semanticLore`: the discovery model returned an empty candidate array, a legitimate result.
- `candidates_produced` is the count before validation; `validation_rejected` and `candidate_suppressed` explain discarded candidates.

`storyCards` is maintenance of existing cards. `discovery` is new durable-subject/event discovery. Completion of maintenance does not establish discovery success. Each group's completion/failure is recorded independently. Offline tests use controlled replies to verify routing, evidence, outcome distinctions and recovery; they do not prove any particular provider will recognize an event.

## Reproduction evidence

The supplied Hogwarts export contained 305 messages: 20 quarantined, 3 failed and 7 completed memory evaluations. Its invalid Background Base URL was already rejected at the transport boundary, but the runtime claimed sources before reaching that check. Three attempts could therefore quarantine valid evidence without sending a memory request. Discovery and condition catches hid the known configuration error behind generic provider/output failures. The saved export is user data and was not modified; regression scenes are small sanitized in-test exchanges.
