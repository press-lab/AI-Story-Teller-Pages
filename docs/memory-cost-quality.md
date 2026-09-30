# Background memory cost and quality

## 2026-09-30 redesign (from the Seattle Hunger playthrough)

Evidence from a 911-turn save: background memory used ~15.5M prompt tokens against ~10M
for the story itself; the one-pass envelope was missing on 73% of turns (deepseek-flash);
the narrator prompt's cache hit stopped ~1.1k tokens in because the one-pass block listed
per-turn targets; there was no current-state layer, so relationship status, sleeping
arrangements, who had met whom, and the day of the week drifted; and the central
relationship card had triggers that never matched and had not updated in ~700 turns.

Changes:
- The narrator only narrates. One background memory pass every N turns writes all memory.
- Story State (always included) carries current truth; Brains carry knowledge boundaries.
- Living-card facts can be superseded instead of accumulating contradictions.
- Stable context is a cacheable system prefix; per-turn context rides in the newest user
  message; history is trimmed in chunks of 10.
- Out-of-character corrections withhold arc direction, force the continuity check, and can
  optionally use DeepSeek reasoning.

Targets to watch in play: out-of-character corrections at or below ~3 per 100 turns, and
most story-call input served from cache. These are observations to make, not guarantees.


Memory maintenance keeps the narrator's model, context budget, response length,
and cadence settings unchanged. The optimization is in background reference
selection, prompt reuse, and redundant proposals.

- Background canon includes directly relevant cards, player identity, pinned or
  protected cards, always-on cards, and one hop of linked canon. Unrelated active
  character profiles are no longer included just because they are characters.
- Only the unchanged factory Narration Rules are omitted from background canon.
  Customized rules and AI Instructions remain: they can contain user-authored
  constraints. Targeted updates and validation retain the target's identity and
  voice; validation also retrieves canon named by the proposed replacement.
- Targeted generation places changing target instructions after named canon, in a
  user message. Its system instructions stay fixed, including when an Anthropic
  adapter hoists system messages. This allows providers with prefix caching to
  reuse the references across target updates. Discovery instructions stay separate
  from changing card/proposal inventories. Cache hits depend on provider behavior;
  shorter reference sets do not imply a fixed percentage reduction in the bill.
- Inline memory tagging and discovery use the same higher plot-memory threshold.
  Routine hospitality, affection, flirting, or tentative invitations do not alone
  establish a new plot. Discovery sees prior proposal contents and rejects exact
  captured facts even under different titles. Completed event memories retain
  independent discovery and occurrence-aware deduplication.
- Discovery reads at least two messages per configured cadence turn, or the larger
  existing evidence window. Explicit Chronicle scans keep their supplied excerpts.
  Validation, approval rules, identity checks, and pressure-change checks remain.

## Pins and existing saves

Guarded pact/promise facts remain preserved and prioritized when included, but
classification no longer pins a card automatically. A pin includes an active card
even without a trigger match. Important obligations can still be explicitly pinned.

Existing saved pins are retained because old saves do not distinguish automatic
pins from user choices. To quiet a previously auto-pinned subplot, open Story Cards
and uncheck **Pinned (included even without a trigger match)**. This choice now
survives subsequent guarded-memory updates. No exported save files are migrated.

## Verification

Regression coverage includes unrelated versus matching plot scenes, preservation of
guarded facts and explicit pins, persistent unpinning, player identity and linked
canon, custom rules, proposed-character validation, duplicate discovery, five-turn
evidence coverage, and completed event discovery despite character-card coverage.
The full suite also checks private Brain and arc-break isolation, continuity,
automatic versus reviewed updates, and context budgets.

No additional paid provider calls are needed for these deterministic and mocked
regressions. Real prose quality and realized cache savings still need observation
during play; automated tests do not establish model behavior or a billing guarantee.
