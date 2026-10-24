# Semantic memory evaluation and reliability

Narrator memory remains the default: the existing hidden `<memory_updates>{"updates":[]}</memory_updates>` contract, no extra normal-turn request, and recovery after five story turns. Deterministic discovery still nominates credible identities only. Narrative developments come from model evaluation.

## Optional dedicated evaluator

In Settings, enable Advanced settings and open Memory Detection:

1. Choose **Dedicated background semantic evaluator**. Selecting it starts at five story turns per evaluation. Set the cadence explicitly to 1 for per-turn evaluation, or 0 for manual-only evaluation through Chronicle's **Evaluate Story Card Updates**.
2. Select **OpenAI Responses with strict Structured Outputs** for the memory API. The blank-provider defaults are `https://api.openai.com/v1` and `gpt-6.1-sol`. Set the Background Provider API key; `gpt-6-astra` is also supported. Existing compatible background providers remain available through the existing transport.
3. Leave the narration preset on DeepSeek or any existing narrator. Existing Brain capture remains inline. Story Card evaluation uses the background queue and ordinary Memory Inbox approval/deduplication.

Only the supplied bounded exchanges, adjacent evidence, relevant complete canon, scene/continuity references, source dates and existing proposals are sent. ChatGPT conversations, tools and personal memories are not available to this request. The memory Responses request uses medium reasoning, a strict transport schema, `store: false`, no tools and one HTTP attempt. It reserves 2,048 reasoning tokens above the existing bounded memory output allowance. Normal narration output budgets and visible word limits are unchanged. The existing correction request receives the existing hidden-memory reserve so it can evaluate its rewritten story.

API attempts and reported usage, including reasoning/output and cached-input usage, use existing accounting. Keys remain in existing runtime configuration and are removed from persisted/exported adventures by the existing sanitizer.

## Verified defects and limits

Both supplied Hogwarts exports name DeepSeek in saved model configuration, but their recorded narration, correction and recovery API calls name `z-ai/glm-5.3-flash`. The Blackfriars export shows the same runtime-model mismatch. Saved configuration alone does not prove DeepSeek produced those replies. Invalid background URL `1` falls back through the existing resolver.

Verified code defects:

- Narration's existing rewrite request removed the draft envelope and requested visible prose only, making inline memory unavailable on corrected turns. It now evaluates the final rewrite with canon and the memory contract. Discarded draft facts remain ineligible.
- Context budgeting could drop the memory instruction. It is now retained as a runtime contract.
- Anthropic processing retained only the first text block; later blocks could contain the envelope. All text blocks are now preserved, excluding reasoning, and finish reasons are propagated. OpenAI text-block responses are also supported.
- Recovery swallowed request errors, conflated JSON/schema/evidence failures and discarded entire otherwise attributable batches. Valid chronological prefixes can now complete atomically, with failed sources retained; duplicate/foreign IDs reject attribution.
- Recovery validation errors could mark the source complete. Invalid candidates now retain the source. Adjacent evidence must name real bounded source IDs; existing additional-source snapshots guard edits and regeneration. Inline partial success is retained, while source-bound Brain deduplication prevents replay under a paraphrase.
- The prompt broadly dismissed conversation; it now distinguishes routine dialogue from consequential disclosures, conditional decisions and distinctive first impressions. Significance remains a model judgment, never deterministic event nomination.

The old exports contain neither raw response bodies nor finish reasons. They cannot establish the exact cause of every missing envelope or recovery failure, including whether any individual reply was truncated. No blanket narration-budget increase was made. Live model quality and account-specific API access require the user's configured credentials; automated verification uses mocked responses.

## Outcomes and validation

Existing evaluation logs distinguish valid proposals, valid zero/new-meaningful-update results, missing/incomplete/malformed envelopes, truncation, provider failures/refusals, response-schema failures and evidence rejection. Intentional Brain cooldowns retain the existing cadence rather than triggering recovery.

Regression fixtures contain only the first ten Hogwarts narrator exchanges, their original IDs, the relevant original Harry/Seth cards and the documented Rebecca recognition. Tests exercise the Harry non-recognition Lore through the actual Responses adapter and reducer, source invalidation, sorting, rune interest, prank discussion, zero results, failed recovery, partial retries, private Brain boundaries and explicit evaluator cadence. These tests verify routing and safeguards with supplied model findings; they do not claim to measure live-model detection quality.

Official contracts: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
