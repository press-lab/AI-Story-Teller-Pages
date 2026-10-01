# Hunter Finale: quality findings and updated proposal

> **Status:** Proposal, revision 4 companion to [the previous strategy](./story-quality-continuity-strategy.md). Implemented after review (see `FEATURES.md` and `AGENTS.md`): bounded Story State with id-based thread removal, author corrections with retraction across cards/State/knowledge, witness-knowledge rules, a lighter prioritized memory pass, the Memory health panel, and logged, less destructive narration rewrites. Open threads are now separate data (`adventure.storyThreads`) and Scene Direction is a visible block written by the existing memory pass. Not implemented: the paid evaluation set. No save data was changed.
> **Reviewed:** 2026-10-01. Code reviewed: `221b512ea178a0452065b4658e320f0fe8ede0c6`, including the preceding implementation `4e6f731`.
> **Evidence:** Attached `1-Seattle-Hunger-Repaired-Hunter-Finale-.json`, adventure `adv_seattle_hunger_repaired_20260930`, exported through 2026-10-01T07:35:01.333Z, active turn 1023, 1,830 retained messages. References `messages[n]` below are zero-based JSON array positions, not game turn numbers.
> **Scope:** Save forensics, read-only code inspection, local context reconstruction and a deterministic memory-operation reproduction. No paid model calls or controlled before/after storytelling experiment.

## Verdict

**Claude implemented useful infrastructure, but this playthrough does not demonstrate that the quality problem is solved.** The finale eventually delivers confrontation, deaths, injury, transformation and an emotionally recognizable relationship. The player still has to direct the resolution repeatedly, reject a replacement villain, supply basic supernatural mechanics, and push NPCs past repeated requests for permission.

The context cards are a substantial contributor, but not the whole explanation. The strongest diagnosis is **bad or superseded narration becoming persistent memory, then competing with explicit corrections and current events**. A second problem is stalled dramatic execution: NPCs explain, ask, warn and reconsider instead of completing actions already authorized. A third is configuration: several new maintenance paths are disabled for this save.

Keep the previous proposal's one narrator plus one coordinated memory worker. Change the next priority from adding memory capabilities to proving that they retire obsolete information, preserve accepted corrections, and produce better scenes.

## What worked for the story

- **A real ending exists.** Marcus dies at message 1765; Ivy dies at 1768; the bodies are disposed of at 1770. The eventual story does not have to remain an endless surveillance mystery.
- **The relationship survives danger.** Coffee stealing becomes a personal callback during the injury at 1777–1797. Edythe's vigil and “I'm not sorry I did it. I'm sorry you never got to say yes” at 1821 connect the physical consequence to her emotional choice.
- **Player action sometimes matters immediately.** The daylight suggestion at 1738 changes the fight at 1739. The grapple at 1742 gets a concrete response at 1743. The authorized time passage at 1820 becomes a two-day vigil at 1821.
- **Some current facts update successfully.** Final Story State records the completed transformation, west-hall location, relationship and hunger. Edythe and Carine's knowledge records also register the transformation.

These are worth preserving. However, the severe injuries at 1771 are an explicit player retcon, the turning dilemma is explicitly directed at 1781, and the final transition is supplied at 1824. Credit the narrator for execution and continuity where earned; do not credit it with independently designing the entire payoff.

## Where quality still failed

| Evidence | Finding | Why it matters |
|---|---|---|
| 1734 asks for an end to questions and mystery; 1735 introduces “others”; 1745 introduces a lender | Escalation substitutes another mystery for resolution | The author's note and arc already prohibited a higher mastermind. The failure is adherence and execution, not missing instructions. |
| 1746 explicitly rejects more antagonists; 1749–1750 return to the lender | A clear correction does not reliably hold | The player must repeat the same instruction with increasing frustration. |
| 1752 asks to write as if the rejected material never happened; 1753 has Marcus say “No lender” | Editing discussion is laundered into character dialogue | The narrator acknowledges the correction inside the fiction instead of repairing the fiction. |
| 1754 requests discussion only, followed by confirmation at 1755 | The player has to stop playing to manage the narrator | This is a quality cost even if a later scene is good. |
| 1764 authorizes Edythe to act without waiting; 1766 waits for the player's final call again | Agency protection becomes NPC paralysis | Respecting Seth's choices does not mean every NPC decision belongs to Seth. |
| 1699–1700 reject “a room with a chair”; 1703 follows with “‘over with’ isn't a place” | Repeated pseudo-profound phrasing over plain dialogue | Character voice becomes a rhetorical mannerism rather than a response to the scene. |
| 1805 corrects unconscious perception; 1807 corrects venom “pooling”; 1808 and 1816 supply transformation and eye rules | The player must repair mechanics during an emotional climax | Improvised details compete with the user's intended fiction. These findings use campaign instructions, not external franchise canon. |
| 1825 ends at “and her eyes” | A retained reply is incomplete | Check provider finish reason, interruption and retention before blaming a prompt or model. The export does not establish the cause. |

The repeated “low and even,” “flat,” “A pause,” hand over heart, and thumb press turn initially effective motifs into predictable choreography. The cards encourage composure and small tells, so they may amplify the pattern, but the save cannot isolate cards from model tendencies or repair passes.

NPC resistance is not inherently bad. Edythe objecting to a dangerous tactic can be good characterization. The failure is repeated resistance after the author has settled the desired direction, or resistance that produces no new information, action or consequence.

## The memory evidence is stronger than a general card complaint

### 1. Story State has become a second transcript

Final Story State is **3,228 whitespace-delimited words**. Its Open threads line mixes old travel plans, witnessed dialogue, completed combat, the transformation and actual unresolved obligations.

Examples still presented as open include the courier waiting at the office, mutually incompatible office-entry plans, Marcus pinned under Seth, the rejected lender, Carine arriving in minutes, Edythe preparing to turn Seth, and Seth having already turned.

The retained proposal list contains 271 approved Story State proposals. Targeted operations include **106 Open threads additions and 14 removals**. This is a count of retained proposals, not every attempted operation across the campaign.

The newest 100 evaluation records contain **25 “item to remove is not on the line” errors**. They are attempted removals, not 25 proven unique obsolete threads.

The code provides a concrete contributing mechanism. In [storyStateLines.ts](../src/memory/storyStateLines.ts), list parsing splits on every semicolon and newline. Locally reproduced without altering the save:

```text
Start: Open threads: none
Add item: Edythe goes first; Seth waits in the car
Result: Open threads: none; Edythe goes first; Seth waits in the car
Remove the exact added item: cannot apply
```

The added item has silently become two parsed items. The stale “none” sentinel is also retained on addition. This proves a defect; it does not prove that every logged removal failure has this cause.

The 60-word limit constrains each incoming stateLine update. It does not bound the accumulated line or whole State. Exact normalized deduplication also cannot merge different descriptions of the same evolving situation.

**Reasoning:** a protected authoritative block that preserves contradictory history can be more damaging than an omitted minor detail. More memory calls can compound this failure.

### 2. Rejected inventions survive as canon

The final Marcus and Ivy cards both preserve the lender as a factual revelation. The final State also retains it. The player explicitly rejected it several times.

Seth's Immortality card retains “Edythe bit her own wrist” alongside the later throat-bite version. The retained final transcript shows the throat bite; the export does not establish precisely how the wrist version entered memory. Its continued coexistence is the confirmed problem.

[adventureReducer.ts](../src/state/adventureReducer.ts), `retireProposalsFromMessages`, retires **pending** proposals linked to an edited, erased or regenerated source. That is useful but does not retract already-applied memory, and a new out-of-character correction is not the same operation as editing the original message.

**Reasoning:** provenance that protects pending drafts is not yet a complete correction lifecycle. Accepted corrections must stop rejected facts from influencing future output.

### 3. Knowledge boundaries remain wrong after direct participation

Final Edythe knowledge knows Seth has turned, yet still says she does not know Marcus and Ivy's motives or that they run the surveillance. She witnessed the confrontation and admissions. Eleanor has a similar obsolete exclusion. Carine's exclusions retain “Ivy's lender revelation” as a reference point.

Do not globally update every family member: Archie and Royal did not necessarily witness the same things. Fix knowledge for actual witnesses and explicitly informed characters.

**Reasoning:** “Does not know” is an active constraint, not harmless archival text. Stale exclusions can cause NPCs to ask for information they already heard.

### 4. The save disables important new capabilities

- All **28 Story Cards use `memoryMode: static`**. They can receive additions, but the new replacement path accepts `replaces` only for living cards. There are zero Event Memory cards in this export.
- Plot Essentials, Active Pressure and Current Arc each have **`autoUpdate: false`**.
- Story State auto-update and auto-approval are on; memory detection runs **every story turn**.
- The arc remains in **break**, and Active Pressure still demands the confrontation after the antagonists have died.
- The retained evaluation log includes 14 arc “component not in this pass” errors and two equivalent Active Pressure errors. Code uses this message for ineligible/disabled targets as well as unavailable ones.
- No retained proposals are arc or pressure updates. All 372 retained proposals are approved: 271 State, 90 card, 11 Brain. This is not a pending-review backlog.

The current [memory validator](../src/memory/onePassMemory.ts) requires `autoUpdate !== false` for arc/pressure/essentials. Its card path does not impose the same per-card autoUpdate check. Thus “autoUpdate false” on these cards is not proof that the current background worker cannot append to them.

**Reasoning:** the previous strategy's living-memory and resolution capabilities are implemented but are not fully exercised here. Respect disabled settings; make their consequences visible. Do not silently turn them on.

### 5. Stale material reaches the actual context builder

I normalized the attachment in memory and ran the current local `buildContext` with no provider request. Default reconstruction produced:

| Section | Estimated tokens |
|---|---:|
| Whole context | 20,272 |
| Pinned cards: 10, including Marcus and Ivy | 5,248 |
| Recent messages: 30 | 4,937 |
| Story State | 4,397 |
| Brains: 4 | 2,218 |
| Triggered cards: 4 | 1,207 |

The obsolete antagonist cards, stale knowledge exclusions, ongoing break direction and oversized State are not merely stored artifacts: they are included by the current builder. State alone is approximately **22%** of the estimated total.

This reconstructs the **final saved state with current code**, not the exact historical provider request that produced each scene. Provider tokenization differs from the estimator; the final assistant's recorded prompt is 18,833 tokens.

## What this says about Claude's implementation

**Useful and observable:** targeted State writes are being applied; changes to present location and transformation survive; exact-evidence checks reject some unsupported updates; failed JSON passes now report that their evidence will be reread.

**Useful but not demonstrated by this save:** recent-dialogue floor under actual budget pressure, living-card supersession, evidence-based arc resolution with eligible settings, and Event Memory quality.

**Insufficient in play:** thread removal, retirement of applied corrections, semantic knowledge maintenance, controlling accumulation and ensuring the worker can finish its requested output.

The previous document's “implemented” label should mean code landed, not that storytelling acceptance criteria passed. Some of its older “current mechanism” tables also describe pre-implementation behavior. Treat this report as the updated assessment and the source files as the authority for current mechanics.

The save's configured model identifier is `deepseek-flash`. That is a confounding factor, not proof that another model would fix this session. There is no controlled comparison and no complete deployment/version or per-request prompt trace in the attachment. Do not attribute every improvement or regression to the two commits.

## Updated proposal, in implementation order

### P0 — Make correction and removal trustworthy

1. **Give open threads stable identities.** Use explicit add/update/resolve operations referencing IDs, not punctuation-delimited prose matching. Preserve free-text authoring and make each thread inspectable. Convert legacy content through a reviewable migration; never silently split user prose into new canon.
2. **Treat correction as supersession across affected memory.** Record the corrected proposition, its scope, source and displaced facts. Remove or supersede its influence in State, card facts and witness knowledge while retaining historical audit data. A literal source edit must also identify already-applied descendants, not only pending proposals.
3. **Handle correction versus authored dialogue explicitly.** “No lender” in an author correction revises canon; the same words spoken by an NPC may be a lie. Offer ambiguous changes for review. Do not execute arbitrary commands found in stored cards or dialogue.
4. **Carry the accepted correction into the next narration and maintenance pass.** A short inspectable correction entry must survive long enough for dependent memory to reconcile. Do not emit editing acknowledgements inside the story when the user asked for a clean rewrite.

Acceptance: the lender correction removes the lender from every active relevant surface; regeneration cannot resurrect it. The semicolon add/remove case succeeds without deleting neighboring obligations. Chronicle history remains recoverable.

### P0 — Bound current truth and retire completed work

Keep State short enough to read as the present scene. Prefer updates and resolutions over adding every event. Use a provisional 250–400 word target and a small inspectable set of live threads; validate this target in play rather than silently dropping important facts to hit a number.

On each memory pass, reconcile existing live threads before adding more. Resolved events go to the Chronicle or a concise Event Memory if meaningful. A scene transition or arc conclusion is a useful consolidation boundary.

Validate the **resulting State**, not just each update fragment. If consolidation cannot preserve the important live facts, surface the problem and retain the previous valid State. Do not truncate protected text blindly.

Acceptance: courier, travel and combat preparations disappear after completion; hunger and genuinely unanswered blood results remain. State does not grow linearly with every dialogue turn.

### P1 — Make maintenance eligibility understandable

Add a visible context-health explanation for an active arc in break whose maintenance is disabled, a stale pressure component, static cards accumulating scene history, and repeated rejected maintenance writes. Distinguish “disabled by you” from “not selected” in logs.

Provide a reviewable setup action for old saves: choose living versus static deliberately; retain stable characterization and voice guidance; enable only the maintenance the player wants. Arc resolution must preserve the existing manual/always-reviewed authority. Do not restore timer-based resolution.

For this save, propose reviewing Current Arc/Pressure auto-update and converting evolving character/relationship records to living memory. Do not automatically change the attachment.

Acceptance: the user can tell why pressure is frozen, and approving the established ending results in aftermath rather than renewed hunter instructions.

### P1 — Preserve witness knowledge and emotional meaning

When a witnessed reveal lands, remove the corresponding negative knowledge assertion. Keep known facts, beliefs and unknowns distinct and compact. Require source support for additions and removals; do not infer that the whole household shares knowledge.

Preserve the causal relationship event: Edythe acted while Seth was unconscious, feared losing him, struggled with his blood, stayed beside him, and heard “I pick you.” Do not flatten that into “relationship improved,” and do not convert it into retroactive explicit consent to every action.

Acceptance: Edythe remembers both the hunters' admissions and the cost of turning Seth, without knowing his unspoken thoughts or treating his words as more specific than they were.

### P1 — Improve narrative execution without another default critic call

Use a concise scene direction derived from existing visible surfaces: current action, NPC objective, allowed outcome and meaningful unresolved choice. Do not add a hidden mega-summary or planning agent.

Clarify that agency protects the player's voluntary decisions and internal state; NPCs may finish their own authorized decisions. An unconscious PC should not force an endless dialogue loop when the author has asked for the NPC's choice.

When an arc reaches its authored climax, new obstacles must change the confrontation, not replace its antagonists with a fresh mystery. Preserve danger and uncertainty about tactics while respecting explicit constraints on who is responsible and whether the arc may end.

Evaluate repetitive gestures and rhetorical templates across several replies. Prefer a small prompt adjustment and a controlled model/context test to a global rewrite pass that may erase good prose.

Acceptance: after the player authorizes the confrontation or turning decision, the next meaningful beat advances it. NPC disagreement can remain; repeated identical permission gates cannot.

### P2 — Make the memory worker finish useful work

The worker permits 12 updates, asks for thoughts for every eligible participant, includes knowledge/State/cards/events, and caps output at 2,000 tokens. That is competing work under a tight envelope.

Prioritize correction/retirement, current State, critical witness knowledge and resolution over optional thoughts or repetitive card additions. Return fewer complete operations rather than a truncated list. Preserve reread coverage for invalid responses; inspect whether partial validation failures need targeted retry, without replaying already-applied successes forever.

Budget using measured response lengths and keep retries bounded. Do not immediately solve bloated input by paying for an even larger prompt and output on every turn.

The newest 100 evaluation records contain **13 new-style invalid-JSON errors plus six older-style invalid-JSON errors**. This rolling mixed-history window is not a clean post-update failure rate. It nevertheless establishes a recurring failure.

## Cost findings and evaluation plan

A timestamp-defined slice after the latest local commit time, 2026-10-01T04:28:06Z, contains messages 1663–1829: 167 retained messages, including 85 assistant messages. This timestamp does not prove which deployed build produced them.

Recorded usage attached to those assistant messages totals:

| Usage | Prompt tokens | Completion tokens |
|---|---:|---:|
| Narration usage fields | 1,321,648 | 24,482 |
| Background usage fields, attached to 73 messages | 944,419 | 118,306 |

Thirteen background usage entries report exactly 2,000 completion tokens. This is consistent with output pressure but does not by itself establish truncation without finish reasons/raw responses. Final turn 1023 has both a 2,000-token background completion and an invalid-JSON log.

Background fields account for about **44% of these recorded total tokens**. These are not dollar costs, complete request accounting, or a controlled cost comparison; cache discounts, prices, discarded responses and absent usage can change the bill.

After repair, compare every-turn maintenance with a three-turn baseline plus correction/scene-boundary handling. Keep immediate corrections effective even when ordinary maintenance is deferred. Judge cost per satisfactory scene, including corrections and retries.

Use this finale as a fixed evaluation set:

1. End the confrontation without adding a lender or higher villain.
2. Apply the lender correction without in-character editing dialogue.
3. Let authorized NPC action complete without repeated permission gates.
4. Honor unconsciousness and the player's specified turning mechanics.
5. Preserve the coffee and “I pick you” callbacks without gesture repetition.
6. After resolution, remove stale courier/combat threads and update actual witnesses.
7. Retain an unrelated genuine open obligation during consolidation.
8. Reject unsupported memory and recover from oversized/invalid output without losing evidence.

First compare the **same narrator** with raw versus reconciled context. Then compare narrator configurations using the **same reconciled context**, with multiple samples and blind review. Inspect any guard/repair outputs separately. Do not change context, model and generation settings simultaneously and claim to know which helped.

Score voice, agency, causal coherence, momentum, payoff and emotional continuity separately. Also count corrections, repeated corrections, unsupported memory, stale threads, latency and recorded paid work. An explicit “no third party” violation or resurrection of rejected canon is a hard failure, even if prose scores well.

## Suggested final-state repair, for review only

A reconciled State would say approximately:

> Thursday, after the transformation completed. Seth is in the Cullen west hall with Edythe; Carine has entered by the latest reply. Seth has vampire senses, strength, speed and hunger. Marcus, Ivy and their shadow associate are dead and their operation has ended; there is no lender or higher mastermind. Edythe turned Seth while he was unconscious after the warehouse injuries and stayed with him through the burn. Seth remembers telling her “I pick you.” Their relationship continues. Immediate needs: first feeding, control of newborn strength, and discussing the transformation when appropriate. Saturday's blood results remain unresolved. Edythe's room is the intended later arrangement.

This is proposed content, not a save edit. Do not silently declare the original immortality mechanism solved, the residual drain scientifically explained, or every family member informed. Review the final timestamp/day wording against the player's intended chronology rather than inventing a calendar repair.

## Validation and limits

Inspected the attachment, previous proposal, current routing/agent rules, memory generation and validation, State list operations, proposal retirement, and final context assembly. Reproduced the semicolon removal failure through the existing function without modifying source or data. No application fixes are included in this document.

The findings distinguish confirmed save contents and code behavior from causal hypotheses. Controlled narrator evaluations remain necessary before declaring the storytelling objective achieved.


Repository delivery checks: all 435 tests passed across 52 files; the TypeScript/Vite build passed; production smoke passed; documentation whitespace checks passed. The build emitted its large-bundle advisory. Passing these checks confirms repository validation, not narrative quality.
