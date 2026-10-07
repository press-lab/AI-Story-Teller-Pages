# Scenario fact ownership

One canonical fact has one authoritative home.

Other components may carry a short identifying reference or the minimum local context needed to fulfill their own role. Self-contained does not mean copying related components. Mentioning another card does not automatically load it: inclusion still depends on triggers, explicit inclusion controls, and the context budget. Inspect Context Preview when essential material is missing.

Distinguish objective facts, durable character traits and beliefs, transient thoughts and interpretations, narrative instructions, and historical records. A character's mistaken belief is not competing objective canon. Accepted story prose and preserved history are evidence, not duplicate current-state fields to delete.

## Compact ownership reference

- Narration Rules: primary per-adventure behavior contract. AI Instructions: optional separately organized scenario rules. Together they own agency, point of view, prose, formatting, continuity behavior, NPC autonomy, and pacing principles. Write each rule once.
- Plot Essentials: compact current operating truth, premise, and persistent constraints needed in nearly every plausible next response. Importance alone does not justify inclusion.
- Character Story Card: the subject's identity, biography, durable psychology, capabilities, secrets, Voice Contract, and objective ties. Other Story Cards own their declared recurring subject or completed event.
- Brain: evolving event-specific internal responses. Durability and scope decide ownership, not whether information is private or mental.
- Enrolled directional relationship: authoritative structured current state for the mutable relationship dimensions it tracks. This is an explicit exception to the usual durable-character-card boundary.
- Current Story Arc (currentArc): the active larger thread, its premise, developments, unresolved problems, consequences, and status. Arc Director fields separately own authored pacing and future direction.
- Author's Note: tone, style, and near-context direction; it can persist until edited. Next Output Bias: short-term steering, normally consumed after one successful generation.
- Historical memory: Adventure Chronicle transcript, historical/event Story Cards, and existing update/thought/relationship archives explain how the present arose without competing with current state.

## Narration Rules and AI Instructions

These govern how to tell the story. They do not store biographies, mental profiles, power facts, world lore, current relationships, faction secrets, or active plot state. “Preserve the player's established capabilities” is a behavioral instruction; the capabilities and their mechanics belong on the character card. Do not repeat the same rule in both blocks. A scenario can keep all stable generation rules in Narration Rules and omit AI Instructions.

## Plot Essentials

Use compact current operating truth as well as the overarching premise: essential protagonist status, an always-present party, or a persistent circumstance shaping almost every scene can qualify. This reconciles the older “overarching premise only” guidance with the existing editable current-truth component. Update it when its owned facts change, not only when the entire premise changes.

Plot Essentials is not a lore encyclopedia, character database, plot archive, or reinforcement layer. Occasional entity detail belongs on the appropriate Story Card; active larger-thread progress belongs in Current Story Arc. Reference a companion by name and role if needed, without copying their profile, powers, or relationship tracker. Active content is assembled in section C subject to the normal budget and protection controls; the implementation does not enforce this editorial boundary.

## Story Cards

Existing types are character, location, lore, plot, event, and custom. Factions and relationships are subjects represented through appropriate existing types, not dedicated faction or relationship types.

A character card owns identity, appearance, role, personality, temperament, values, worldview, established beliefs, long-term wants, motivations, ambitions, commitments, stable mental and emotional characteristics, durable behavioral tendencies, capabilities, skills, powers and mechanics, durable history, objective social/family/professional ties, character secrets, and Voice Contract. Relationship facts follow the enrollment boundary below. Keep the biography and durable mental profile together. A lasting desire, enduring fear, or established belief belongs here even when private.

Identify the subject and provide enough local information to portray it when loaded. Do not split essential identity and characterization across unrelated cards. A faction or location card may identify an associated character without copying that character's biography or psychology. References are not loading instructions.

Static means relatively stable facts, not immutable truth. Living cards describe an evolving recurring subject, arrangement, search, obligation, or status. Historical cards describe useful completed events and consequences in past tense; event cards are historical memory. Structured compacts (pact, promise, coverStory, alliance, debt, secret, truce) retain their core facts, current facts, recent developments, status, and archives within that subject's owner. Do not turn every card into immutable biography or create sibling trackers for one subject.

Durable character development can change an established belief, motivation, or personality trait. Reconcile the card once that change is established. Living-card merge/archive operations and additive updates do not guarantee removal of contradictory current assertions; review the resulting live content.

## Brains

Brains are opt-in for major characters. They own thoughts about events and interactions, transient emotional reactions, immediate or situational intentions, emerging suspicions, situational misunderstandings, interpretations of recent experiences, and short-term internal responses. They do not own enduring wants, values, worldview, established beliefs, personality, biography, physical description, capability mechanics, or Voice Contract.

A Brain may show how a durable characteristic shapes a particular reaction without repeating the profile. Thoughts accumulate with validation, deduplication, condensation and archival behavior. An older retained thought is evidence of what the character thought then, not necessarily their current belief. Preserve useful thought history and clarify or retire stale active interpretations using existing editing/update workflows.

When a reaction becomes an established lasting change in values, beliefs, motivation, or temperament, reconcile the character card. Retain relevant event-specific thoughts as thoughts or history, not as a competing profile. A single angry thought should not automatically rewrite a durable value or relationship. There is no general automatic promotion/replacement guarantee. An existing semantic update path can propose a validated storyCardNote for a linked card; that is not a comprehensive ownership reconciliation mechanism.

## Dynamic relationships

Enrollment is opt-in and directional on an existing Brain, with the focus linked to an existing character Story Card. Mara toward Iven is distinct from Iven toward Mara. Without enrollment, durable relationship facts normally live on a character card, or on one explicitly designated living relationship card when the relationship itself is a recurring subject. Choose one authoritative home.

Once a direction is enrolled, its structured current bond, status, and descriptive dimensions own the mutable state they track, even if it persists for years. Current attraction, trust, resentment, suspicion, closeness, and relationship trajectory belong with that designated owner when tracked. Remove overlapping mutable assertions from character cards, relationship cards, Plot Essentials, and freeform Brain fields; do not maintain parallel trackers.

Objective ties and shared history can remain on cards: parent, sibling, spouse, former commander, longtime teammate, or a past event. Reconcile the card if an objective tie changes. “Mara is generally slow to trust” is characterization; “Mara currently trusts Iven” is enrolled pair state; “Iven's evasive answer upset Mara tonight” is an event-specific thought. Thoughts may react to a relationship without becoming a second ledger.

Enrollment offers overlap-review hints, not automatic rewriting of authored text. Player edits and approved relationship changes preserve history. Up to three selected history entries per pair can be deliberately recalled; clearing selections stops recall. Current state and selected history remain separately inspectable and budgeted. Preserve history when removing duplicate live assertions.

## Current Story Arc and Arc Director

Current Story Arc owns the active larger thread: premise, relevant developments, unresolved problems, consequences, and current arc status. Reference characters and factions without reproducing their biographies, durable motivations, or lore. Distinguish established facts from the running record of developments and from authored future direction.

The existing currentArc update path appends developments to a running log; it is not replacement-based. Mark resolutions clearly and use existing editing/reconciliation controls to retire misleading current assertions while preserving useful history. Do not erase valid earlier developments merely because they are no longer current problems.

Arc Director engagement counting remains deterministic: matching selected Story Card/Brain IDs advances counts, not an LLM judgment of drama. Multiple selected matches in a turn can count separately. Phases are simmer, escalate, break, aftermath. Simmer/escalate expose the authored simmer instruction; only break exposes the gated break instruction; aftermath exposes neither. Ask/Auto controls and manual phase controls retain their existing behavior.

Authored pacing and future direction are instructions, not events that have already happened. They should not override established outcomes or player agency. Gating controls instruction visibility, not a guarantee of a particular narrative outcome. Complete Arc → Story Card banks the completed arc using the existing historical plot-card workflow; next-arc continuation also preserves the finished arc before seeding its successor.

## Temporary direction and custom components

Author's Note may persist until edited; it is not automatically a one-turn note. Next Output Bias normally expires after one successful generation, with its existing expiration setting controlling that behavior. Clear or revise temporary pressure when resolved. Neither should become permanent lore, character profiles, or relationship state.

Active Pressure is a compatibility surface, not a standard new component. Existing entries remain editable/filterable in Components and retain update controls. Active entries assemble alongside Plot Essentials in section C, not in an independent pressure section; existing pressure proposals replace the targeted existing entry. Do not recommend creating it for new scenarios. Immediate Momentum is a disabled legacy type and is not assembled into context.

Custom components need a specific declared purpose, such as a reusable mission loop. They must not become catch-all copies of cards, Plot Essentials, Brains, or Current Story Arc. General custom context is included by its existing always-on/pinned controls and budget rules.

## Historical memory

Adventure Chronicle preserves the transcript. Historical/event Story Cards preserve useful completed events and their consequences. Thought archives, relationship history, and component/card update history retain their existing roles. Historical memory explains how the present arose; it is not another current-state tracker.

Rolling Summary and Scene State remain for save compatibility but are not independent assembled context sections. AI Dungeon's Story Summary, Character Creator, and placeholder behavior belong only in explicitly AI Dungeon-specific guidance, not descriptions of AI Story Teller.

## Mutation and reconciliation

Active state-bearing components should describe current canonical state and evolve with accepted events. Behavioral instructions govern narration; historical records preserve past events. Do not mechanically replace those records as if they were current-state fields.

1. Identify the changed fact's authoritative owner.
2. Update it through existing editing or approved update workflows, respecting configured approval controls.
3. Replace or retire obsolete current-state assertions instead of endlessly appending corrections.
4. Search for accidental duplicate assertions elsewhere.
5. Remove or revise stale copies and misleading references.
6. Preserve useful history in existing history/archive surfaces.
7. Do not preserve obsolete setup facts merely because they were authored first.

Accepted story events can establish canon that the scenario did not predetermine. Reconcile supporting state to those events instead of forcing the story back to its original setup. Hypothetical plans, rejected/replaced generations, unreliable dialogue, and NPC beliefs are not automatically objective fact. Review perspective and evidence before updating an owner.

## Before and after examples

Before: Mara's card, Brain, and Plot Essentials each say she values loyalty, wants to restore her family, and trusts Iven. Every change now requires several unrelated edits.

After — character card: “Mara values loyalty and wants to restore her family's standing. Mara distrusts institutions after years of political persecution.” Keep biography, durable psychology, powers, and Voice Contract here.

After — Brain: “After tonight's accusation, Mara suspects her ally concealed evidence and intends to question him privately.” Or: “The magistrate's unexpected help leaves Mara uncertain about his motives.” These are situated interpretations, not proof of concealed evidence or a rewritten worldview.

After — enrolled Mara toward Iven relationship: record current trust/suspicion and trajectory in its structured dimensions. Do not repeat that mutable pair state in the card or Plot Essentials. Keep the specific reaction in thoughts without maintaining another relationship summary.

Before: an opening, Plot Essentials, a relationship card, and a character card each declare the same attraction and shared history “for emphasis.” After: the opening dramatizes a moment; one designated owner stores current relationship state; historical memory records the shared event; Plot Essentials only includes the minimum relevant reference if it shapes nearly every next response. Preserve the opening as story evidence.

Before: “Mara can bend fire” is copied into Narration Rules, the faction card, and her Brain. After: capability mechanics live on Mara's character card; Narration Rules says “Preserve established capabilities”; the faction card identifies Mara's role without reproducing her profile.

Before: a defeated antagonist remains an active threat in several blocks, with “now defeated” appended at the bottom. After: update the threat's owner and stale references, mark the arc resolution, clear resolved temporary pressure, and retain the confrontation in historical memory. An authored future confrontation is not evidence it occurred.

## Overlap audit

- Does this fact already have an authoritative home?
- Is this the correct owner?
- Is another surface independently repeating the same state?
- Would a change require editing several unrelated places?
- Would a short reference provide enough local context?
- Is temporary pressure being mistaken for durable lore?
- Is historical information being presented as current truth?
- Is a character's belief being confused with objective fact?
- Is a durable mental characteristic incorrectly stored in a Brain?
- Is an event-specific reaction being mistaken for lasting characterization?
- If a dynamic relationship is enrolled, have overlapping mutable assertions been removed?
- Are Narration Rules and AI Instructions repeating the same rule?

## Implementation limits

These are authoring recommendations, not new automation guarantees. The narrow componentUpdate helper in src/memory/applyAIMemoryUpdate.ts permits Plot Essentials only; typed reducer proposal paths separately handle Current Story Arc and existing Active Pressure. Configured semantic rules retain their approval/direct-write choices. No new write authority is granted here. No saves are migrated by this guidance. Existing generators, prompts, mutation policies, persistence, and approval settings remain unchanged.

src/ai/authoringBestPractices.ts and its consumers still contain executable guidance using narrower premise language and “always-true” terminology. src/ai/generators.ts can draft broader Brain material. Review generated setup against this reference; documentation does not silently change generation prompts.

src/state/adventureReducer.ts retains additive Story Card paths, bounded living-card merge/archive behavior, and append-based currentArcUpdate. Those operations do not guarantee semantic removal of obsolete current claims. src/triggers/semanticEngine.ts retains model-assisted validation, targeted reconciliation and the linked storyCardNote path; these do not establish objective truth or reconcile every owner automatically.

src/contextBuilder/contextBuilder.ts assembles Brain thoughts and eligible structured relationships, not legacy currentState/relationshipPressure/recentDevelopments blobs. Legacy anchor data can still influence Brain-update prompts in src/triggers/semanticEngine.ts; do not author a second durable profile there. Enrollment overlap hints and existing dedup tools are review aids, not proof of complete overlap detection. For workflow detail, see docs/dynamic-relationships.md, docs/memory-update-quality.md, and docs/memory-reconcile-automation-context.md.
