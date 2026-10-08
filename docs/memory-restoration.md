# Memory restoration to 1edee2d

Compared against main at `a4727cbd7039c85bbf6734347d39110c76f47039` before editing.

## Restored behavior

Memory/context assembly, runtime orchestration, provider behavior, Dynamic Relationships,
component updating, approval and auto-approval, and native histories return to `1edee2d`.
World Evolution's evaluator/helpers, plot registry, semantic effects, mutation paths,
presets, diagnostics, and controls are removed. Story Director remains absent.
Existing authored scenario instructions and the baseline Current Arc behavior are retained.
No new narrative decisions, agents, requests, evaluators, or reasoning passes are introduced.

## Later fixes retained

- `be99e0e`, `76edbb4`, `59df15f`: Play editor/Suggestions grid containment,
  single-column panel layout, bounded field widths, wrapped controls and preformatted text.
  Existing panel resizing and internal scrolling remain intact.
- `5e76f7f`: user-requested Story Card cleanup goes through ordinary Suggestions,
  with explicit approval and stale-revision checks. World review items are removed.
- Resolved/stale Suggestions cannot be approved again from the UI.

World-specific output selection, provider-attempt diagnostics, and aggressiveness presets
are removed with their machinery; they are not required by the baseline one-pass path.

## Character memory defect

Oldest-first living-card pruning could archive a complete character description as a
single old fact and retain only short recent additions. Archives are not ordinary
narration context. Read-only inspection of Dispatch-Saiyan(2) demonstrated this for
Mandy/Blazer and Margo/Wraith. Arcane-After-the-Rocket had no archived Voice Contract
profile matching that defect. Neither supplied JSON file was modified.

Living character foundations now use existing editable `coreFacts` on the same Story Card.
Later additions remain in budgeted Content, with overflow retained in archivedFacts.
The original profile footprint is retained rather than growing on each update; rolling
Content uses the existing configured cap (or 900-character default). Normal global
context inclusion and budget rules still apply; foundations do not force a card into context.
Direct AI replacements retain the core, explicit core editing remains possible, and
native update histories retain before/after snapshots. Cleanup sees the full character
profile, and duplicate detection includes the core.

Import/load recovery uses a fully identifiable previous append snapshot whose facts
remain live/archived, or an archived paragraph explicitly containing a Voice Contract.
It does not inject every archive or semantically reconstruct missing biographies.
Unrecognizable old profiles still need explicit editing through existing controls.
No new save fields or export schema are introduced.

## Extraction and cost

The existing one-pass prompt more directly asks for established consequential actions,
allegations and consequences as historical lore. Surveillance does not imply a rewritten
personality; an allegation does not establish guilt. Enrolled relationship changes use
Dynamic Relationships. Evidence validation, limits and approval behavior remain unchanged.

Measured with the repository's approximate token formula for no Brains/relationships and
categories plot_beat/world_fact: baseline 5,327 characters / 1,332 estimated tokens;
restored 5,134 / 1,284, a reduction of 48 estimated prompt tokens. Output reserve remains
1,400 tokens. Existing caching code returns to baseline without a new cache mechanism.
Structured character headings add a small per-included-card formatting cost. Restoring
the two damaged Dispatch profiles restores about 590 and 645 tokens of actual authored
character context when those cards are included; this is not a new platform prompt.
No additional requests are introduced; existing configured fallback/manual requests remain.

## Validation

Full suite: 448 tests across 58 files. Focused Play/editor, Suggestions, relationship,
runtime one-pass/request-count and character regressions pass. Type checking and production
build pass. Production smoke passes. Browser inspection confirms the embedded editor and
expanded Suggestions have equal client/scroll widths (no horizontal overflow), internal
vertical scrolling, and visible approval controls in the Play panel.
The build retains the existing large-bundle warning.
