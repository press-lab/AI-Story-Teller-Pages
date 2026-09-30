# Memory update quality

> **Status:** History · **Audience:** contributors · **Verified against:** `e768262`
>
> Describes validation for the legacy memory cycle and semantic writes. The background memory pass uses its own local checks (evidence quotes, target eligibility, duplicates; see `FEATURES.md` §6) and does not make separate model-based review calls.

Automatic memory evaluation distinguishes the latest player turn and response from older attribution context. Active Pressure requires a new threat, changed stakes or obligation, or resolution supported by a latest-turn message. Rephrasing the same situation, routine movement, and leisure activity do not justify replacing pressure. Resolution can leave no immediate pressure; updates do not need to manufacture a replacement danger.

Story-card and brain updates require explicit identity verification before either a proposal or a direct semantic write. Brain review checks the named character's perspective and access to knowledge, so a player's messages or plans cannot simply become an NPC's first-person thoughts. An uncertain or malformed review produces no update. Brain condensation may archive entries but cannot rewrite validated text or add facts. Traits promoted from brains to story cards also receive story-card validation.

These are model-assisted checks, not a guarantee of factual accuracy. Existing saves are not migrated or rewritten. Brain validation adds a background request for a nonempty candidate update. The Seattle regression tests mock provider responses to verify the enforcement boundary, latest-turn evidence requirements, pressure resolution, and identity rejection.
