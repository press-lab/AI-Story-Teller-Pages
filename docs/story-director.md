# Story-led progression and canon reconciliation

## Current architecture and scope

The browser runtime uses `turnPipeline.ts` for submit, continue, and regenerate. Accepted prose passes response guards, continuity correction, inline-memory extraction, reducer insertion, output triggers, and existing authored Arc Director engagement. It is then displayed and persisted before story-state evaluation. The evaluator never plans the generation it is judging. Comms are excluded.

A Play Loop is an existing `custom` component with `contextRole: "playLoop"`. Legacy custom components titled exactly `Play Loop` or `Core Gameplay Loop` are recognized unless explicitly marked `general`. New adventures include one. Normalization separates only the exact shipped sentence “Continue the active scene in response to the player, keeping the fiction live and unresolved.” from Narration Rules, preserving it in the loop. Arbitrary authored instructions are not parsed or weakened. Existing scenario-specific loop text remains editable and unchanged during suspension. Other embedded sandbox guidance can be moved into a designated custom block in Components.

The Components checkbox designates a loop. Its normal inclusion controls and token budget still apply. Suspension excludes it without changing its active flag or text. Context Preview reports exclusion; a separately named progression permission occupies section E. Player agency, prose, and other storyteller rules remain intact. Scene openness does not mean the plot must remain unresolved.

## Semantic evaluation

An active designated loop enables one separate provider evaluation after each accepted story response. It reads at most 40 recent messages / 48,000 characters, tracked threads, active arc content, and owner titles. This window bounds cost, not plot duration or progression. It uses the existing background-provider resolver, accounts tokens, requests JSON, and times out after 60 seconds per request.

NORMAL_PLAY is the fallback. Dormant possibilities, faction mentions, isolated dramatic appearances, and elapsed turns are not progression. ACTIVE_PROGRESSION requires material story action and an explicit judgment that sandbox drift obstructs that action. CLOSURE permits earned answers and consequences without extra layers or a predetermined ending. RESOLVED restores play unless another thread independently qualifies. Suspension requires confidence >= 0.9 and an exact quotation from an accepted recent assistant message. Quotations verify provenance, not objective truth; the semantic instructions distinguish accusations, beliefs, plans, and committed events.

A meaningful change or newly changed material thread triggers a second reconciliation request. It inspects every eligible existing state owner, including untriggered cards, rather than only cards loaded for narration. Requests exceeding the explicit 240,000-character bound fail visibly instead of silently dropping owners. Failed evaluation or reconciliation restores normal play and preserves the accepted prose. This adds one request per evaluated turn and a second for meaningful developments; it is independent of inline-memory enablement.

The authored deterministic Arc Director remains separate. The semantic evaluator does not change its phases, counts, or authored future instructions, and never reveals its gated break early.

## Canon mutation and ownership

Validated batches enter through `applyAIMemoryUpdate` and typed reducer actions. Each edit carries source evidence, STATE_UPDATE/CANON_COMMIT classification, reason, previous live-owner snapshot, replacement, and obsolete assertions. Snapshots exclude accumulated update/thought/relationship histories to avoid copying ever-growing archives into every batch during long play. All live owners and the source must still match before any edit applies. Stale batches cannot partially apply.

Allowed owners are existing Plot Essentials, Current Arc, compatibility Active Pressure, nonhistorical Story Cards, existing Brain thoughts, and enrolled directional relationships. Narration rules, AI Instructions, Author's Note, Play Loop, authored arc pacing, provider settings, and historical records are excluded. No automatic Brain creation or speculative new owner creation is added.

Complete card replacements retire old compact live fields and move the previous archive into the existing update-history snapshot so legacy guarded-memory code cannot resurrect contradictions. The replacement includes surviving relevant facts. Current Arc replacement clears its old premise; a fully resolved component becomes inactive. Historical card conversion preserves completed consequences and removes pin/protection. Unchanged facts stay in their owner. Old component/card versions remain in update history; superseded thoughts are archived; relationship revisions and history are preserved.

Dynamic relationship state belongs to the enrolled pair, with unchanged dimension names and quoted NPC knowledge evidence. Objective ties remain on character cards. Relationship edits always require review. Other edits obey the existing semantic approval setting and corresponding memory auto-approval toggles. If any edit needs review, the entire batch waits together in **Components → Story state**; approval is revalidated. Pending changes never enter narrator context.

Editing/deleting/replacing a source passage rolls back its applied batch if the owners still match the applied versions. If later edits prevent safe rollback, the batch is marked stale and the evaluation log requests review instead of overwriting later work. Undo/redo does not silently reapply stale canon.

## Inspection and validation

Components → Story state exposes current reasons, quoted events, batch status, previous owners, replacements, and obsolete assertions. Triggers evaluation logs record transitions, failures, classifications, and affected owners. Context Preview shows the exact included/excluded loop and progression permission. These administrative details are not appended to the player-facing story.

Tests cover the reversible modes, high-confidence/evidence boundary, multiple threads, authored break gating, protected mutation targets, betrayal replacement, stale atomic batches, approval/rejection, relationship ownership/history, discarded prose, provider failure, and post-generation ordering. Local long-save replays read the sibling saves repository without copying or changing it. Set `STORY_DIRECTOR_SAVE_DIR` elsewhere; the replay is explicitly skipped when no local saves exist. The replay tests structural behavior across long transcripts using supplied normal-play verdicts. They do not establish live-model semantic accuracy or false-positive rates; provider responses are mocked. Live narrative quality still needs playtesting with the chosen model.
