# World Evolution implementation status

This is an incremental implementation, not the complete Persistent World Evolution feature.

New adventures save scenario settings with the requested defaults. Imported adventures without those fields receive conservative legacy values. The current runtime uses plot progression, NPC autonomy, and offscreen event settings for Current Arc plot events. Other stored settings are visible in Settings but have no runtime effect yet.

The existing narration response can carry `plotEvents` in its one-pass memory envelope. Local validation checks the active arc ID, an exact quote from the accepted story, and an outcome contained in that quote. Accepted events are reduced into `arcState.events`; terminal events store `arcState.outcome` and move the arc to aftermath. Subsequent Current Arc context shows the outcome without the unresolved premise, prior log, or pacing instructions. If a completed arc is archived through an existing manual control, its outcome is included in the historical card.

For new adventures, mention-count pacing and automatic continuation generation are disabled. Legacy adventures retain their prior pacing and continuation behavior. No new routine model call is introduced by the plot event path.

## Incomplete work

- Targeted canon operations with revisions, review, protection, and rollback are not implemented.
- Character development, betrayal, redemption, and identity protection are not enforced by the new settings.
- Offscreen world consequences beyond Current Arc status are not persisted. Rumor and knowledge boundaries still need explicit state.
- Emerging plots do not yet have a tracked lifecycle.
- Representative cost measurements against all three baseline commits have not been performed.
- The complete fifteen-scenario end-to-end test matrix is not implemented.

The local evidence check proves provenance of text, not the truth of a semantic inference. It requires the proposed outcome to be part of the quoted narrative, but it cannot decide whether a complex mystery is actually solved. This limitation needs stronger validation within the same response envelope before the feature is complete.
