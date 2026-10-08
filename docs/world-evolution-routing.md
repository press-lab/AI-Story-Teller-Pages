# World Evolution ownership and scenario configuration

Traced from HEAD `84466d518f60703e17141f2695f710b8eb285b97` (the requested `2df5e17` plus the CI fixture repair).

| Information | Existing extraction and validation | Persistence owner |
| --- | --- | --- |
| Dynamic relationships | RelationshipsEditor enrolls existing Brain/focus pairs via ENROLL_RELATIONSHIP. Context includes relationship items; relationshipTargets selects only included enrolled pairs. onePassMemoryActions sends relationshipChange to relationshipCandidate, then ADD_MEMORY_PROPOSAL. relationshipIsCurrent checks revisions, enrollment, focus and state before approval; applyRelationship writes dimensions and history. | Brain.relationships; EDIT_RELATIONSHIP remains manual |
| Thoughts and internal state | onePassMemoryActions validates thought evidence and enrolled Brain; applyAIMemoryUpdate handles Brain updates; configured semantic triggers also use that boundary. Reducer applies thought/state actions or reviewed brainUpdate proposals. | Existing Brain fields and thought history |
| Story Card creation/append | onePassMemoryActions validates card/lore/newCard candidates; applyAIMemoryUpdate and ADD_MEMORY_PROPOSAL retain card policy, approval, cooldown and protection checks. Configured semantic updates use the same boundary. | Story Cards |
| Targeted canon replacement | worldEvolutionActions validates visible owner, exact evidence, revision, protections and semantic permissions; ADD_MEMORY_PROPOSAL retains worldChange; approval revalidates it, applyWorldChange changes only the owned fact and archives prior truth. | Story Card, Brain field or Plot Essentials with reversible world history |
| Plot Essentials | Ordinary essentials proposals always require review; configured semantic updates use applyAIMemoryUpdate; targeted canon changes require world validation and review. | plotEssentials component |
| Current Arc / emerging plots | Existing narration envelope plotEvents uses validatePlotEvent and APPLY_PLOT_EVENT. newPlots uses REGISTER_PLOT_THREAD. Legacy ADVANCE_ARC_PACING remains available when World Evolution is off. Terminal events require explicit central-objective closure; completed threads archive. | Current Arc component and WorldEvolutionState threads/archive |

Selection of bounded structured output does not apply mutations or change these routes. Relationship records are never converted into worldChanges, and world Brain fields cannot address relationships.

## Scenario controls

World Evolution controls live in New Adventure setup and Edit → World Blocks (Scenario Configuration). The primary state is adventure.worldEvolutionSettings; Settings has no World Evolution controls or global defaults. Setup passes selected values into the adventure factory. Save/load, export/import and duplication copy those values with the adventure. There is no separate scenario-template configuration model; imported adventures carry their own settings.

New adventures use Living World. Missing settings on older saves normalize to disabled legacy values. Master Off keeps history and the original memory/relationship functionality. Presets write individual values; the displayed preset is derived by comparing those values, so individual edits display Custom unless they exactly match another preset. Master enablement is independent of preset selection.

Character protections stay on that adventure's character card. Relationship evolution gates proposals and approval in the existing relationship validator; manual editing is independent. Character development governs durable character changes, separately from relationship dimensions and temporary Brain thoughts.

| Setting | Quiet Sandbox | Natural Evolution | Living World | Unpredictable World |
| --- | --- | --- | --- | --- |
| Plot progression | Off | Natural | Active | Active |
| Plot resolution | Open-ended | Open-ended | Decisive | Decisive |
| New plots | Off | Occasional | Occasional | Frequent |
| NPC autonomy | Reactive | Reactive | Independent | Independent |
| Offscreen events | Off | Off | On | On |
| Character development | Off | On | On | On |
| Relationship evolution | Off | On | On | On |
| Betrayal | Off | Off | Off | Unrestricted |
| Redemption | Off | Earned | Earned | Unrestricted |
| Hidden motivations | Off | On | On | On |
| Canon reinterpretation | Off | Review | Review | Review |

## Output selection and target inventory

The existing owner validators and reducer actions are previewed against an immutable adventure copy before ranking. Invalid, stale, protected or duplicate candidates do not reserve capacity. Confirmed terminal events rank first, significant canon mutations second, then established nonterminal events, emerging plots, enrolled relationship updates, thoughts and ordinary facts. Routine Brain field captures share ordinary priority rather than automatically displacing thoughts. Quiet narration needs no plot or canon record.

Selection still accepts at most four records / 4,800 serialized characters / 1,200 estimated tokens. Dropped valid candidates are separately retained as bounded diagnostics (up to four / 4,800 characters / 1,200 estimated tokens) in WorldEvolutionIssue, visible in Memory Suggestions alongside the accepted story; they are never model context or auto-applied. Excess beyond diagnostic capacity is identified in review messages. Review uses existing owner editors/proposals rather than replaying stale records automatically.

The world inventory considers included eligible owners, scene names, trigger matches, plot participants, current/recent developments and update recency. Each available owner receives representation before remaining slots are filled by relevance. Enrolled relationship items never enter this inventory. Budget filtering removes inventory entries without substituting larger targets after the instruction has been budgeted. Plot objectives are read from their existing context rather than serialized again.

The loyalty regression used two separately created sandbox adventures, making the proposed timestamp revision intermittent. The inherited fixture repair uses one adventure for both proposal and turn. The assertion remains, and the integration test also checks preserved obsolete-fact history and absence of a pending revival proposal.
