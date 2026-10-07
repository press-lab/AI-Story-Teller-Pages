# Relationship retry: Brain thought investigation

The supplied Dispatch: Saiyan export was last updated on October 6, 2026 at 22:23:34 UTC. Inspection did not modify the export or synchronized saves.

## Evidence

- All seven Brains had empty relationship collections. The new relationship proposal path was unused.
- After the original feature commit time, the saved evaluation log contains 50 inline processing entries reporting a missing envelope, 45 compact fallback entries, and 34 accepted thoughts: Mandy 12, Nix 13, Margo 3, Eliot 6. These are log-entry counts, not distinct retained story turns.
- No post-feature entry reports invalid memory JSON. The retained pre-feature log also contains two missing-envelope entries, so missing envelopes were not exclusive to the relationship release.
- Brain auto-approval was enabled; relationship auto-approval was disabled. The fallback-applied thoughts are ordinary Brain updates under that setting.
- The four-update limit and 1,400-token output reserve existed before the feature. The feature did not reduce either limit. However, both parsers previously rejected an otherwise valid envelope wholesale if it contained five updates.
- The original feature unnecessarily inserted relationship instructions even when no relationships were enrolled. This changed the narrator prompt for users who had not opted in.
- The configured provider used an Anthropic-compatible endpoint. Its response reader retained only the first text block, which could lose a memory envelope in a later block. Raw provider responses are absent from the save, so that mechanism cannot be proven for these particular missing envelopes.
- A visible-story correction intentionally produces prose without the discarded draft's memory. Previously its diagnostic was indistinguishable from a narrator omitting the envelope.

## Changes and verification

The retry restores the character Story Card focus selector, structured state, reviewed proposals and bounded history recall. Relationship instructions now appear only for eligible pairs. A regression hash checks the no-relationship memory instruction against commit 5049262. No narrator model, response setting, thought eligibility rule, approval preference, fallback cadence, or output reserve was changed.

Oversized batches now retain up to four valid updates, considering thoughts first and logging overflow rather than failing the whole envelope. Invalid candidates do not consume update slots. Inline and compact fallback routes share this validation. Missing or genuinely malformed envelopes still use the existing fallback call.

All Anthropic text blocks are concatenated in order, including split JSON tokens; non-text reasoning blocks remain excluded. Visible-story corrections have an explicit discard diagnostic while still recovering memory only from the corrected story. Historical cards are excluded from the fallback's editable target inventory, matching the existing write boundary.

Regression tests cover ordinary thoughts with no relationships, mixed thought/relationship updates, five-candidate batches, invalid candidates before valid thoughts, split provider blocks, fallback token accounting, independent review, and correction call accounting. A temporary read-only audit rebuilt context from the supplied save and verified memory instruction inclusion, no relationship instructions, Margo/Eliot thought eligibility, and the saved context budget.

These tests establish deterministic behavior; they do not demonstrate that a live model will always emit its requested envelope. The save does not establish a single cause for every missing envelope, and the investigation does not attribute all 50 misses to either the shared limit or the feature.
