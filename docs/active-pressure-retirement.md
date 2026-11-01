# Active Pressure retirement and Library latency

Active Pressure is retired across defaults, reload, context, both memory pipelines, manual tools, imports, audits, approvals, and built-in scenarios. Existing text remains in inactive legacy components with auto-update disabled. Pending old pressure proposals become ignored. Legacy type names remain readable. Story text, Story Cards, Brains, Plot Essentials, and Arc Director phases are not migrated into a replacement feature. Brain relationshipPressure remains supported.

Library selection now paints Loading before opening an adventure and prevents duplicate selections. Event recall caches normalization and character-alias lookups within each call, preserving first-match order. The caches never survive the call.

Before retirement, complete context results matched the previous implementation across 23 local saves and three inputs each: 69 comparisons, zero differences. On the slow fixture, context assembly fell from approximately 2.8 seconds to 116 ms in profiled headless Chrome runs; the optimized dashboard paint checkpoint was 154 ms. These are desktop samples, not iPhone measurements.

Retirement intentionally removes pressure text from context. A copied-save probe found 117 fewer estimated tokens and the same 19 selected Story Cards in the latest local snapshot. Other saves may change chained selection or budget results because that source is gone. Original save files were not edited.

Tests cover reload idempotence, preserved legacy text, reducer guards, old proposals, mixed queued and trigger work, no paid manual pressure requests, imports, seeds, and valid siblings in mixed model output. Generic worker and router tests continue covering supported components. Validation: 1852 tests passed, 2 skipped; TypeScript, production build, and production smoke passed.
