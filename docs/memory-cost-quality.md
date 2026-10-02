# Background memory cost and quality

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
