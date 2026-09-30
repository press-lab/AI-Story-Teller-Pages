# DeepSeek provider request contract

> **Status:** History (incident record, September 2026) plus a still-valid wire-format rule · **Audience:** contributors · **Verified against:** `e768262`

The public frontend is this repository, press-lab/AI-Story-Teller-Pages.
Pushes to main automatically deploy GitHub Pages; verify the deployment result.

DeepSeek's Anthropic endpoint requires `thinking: { type: "disabled" }`
to disable thinking. `reasoning: { effort: "none" }` is a Responses API
parameter and must not be used for Anthropic messages. The thinking-mode
documentation table merges the OpenAI and Anthropic toggle cells; text-only
extraction can hide that distinction.

References:
- https://api-docs.deepseek.com/guides/anthropic_api/
- https://api-docs.deepseek.com/guides/thinking_mode/

The September 2026 no-content incident persisted on build f8ebfd8 because
the adapter sent the wrong field. The saved adventure used the native
DeepSeek Anthropic endpoint, deepseek-flash, and a 12,000-token output limit.
Do not infer that increasing that limit fixes an ignored thinking toggle.
Provider regression tests verify the documented wire field; mocked responses
do not constitute live provider verification.
