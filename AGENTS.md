# AI Story Teller Agent Guide

> **Status:** Canonical (rules and invariants) · **Audience:** contributors and agents · **Verified against:** `e768262`

## Documentation Map

- `AGENTS.md` (this file): rules, invariants, and the finish workflow. Wins any conflict with other docs.
- `FEATURES.md`: how every system behaves today — section order, memory surfaces, proposal types, turn loop.
- `README.md`: setup, deploy, and a short overview. It links here instead of repeating the contract.
- `docs/README.md`: index of every other doc with its status (Guide, History, Proposal, Reference) and a UI-label ↔ code-name glossary.
- `src/pages/HelpPage.tsx`: the in-app Documentation page. User-facing; keep it consistent with `FEATURES.md`.
- `.claude/agents/aist-workspace.md`: Pages vs Saves repo routing and save-file mechanics.

Docs under `docs/` marked History or Proposal describe past incidents or unbuilt designs. Do not treat them as current behavior.

## Architecture

This is a browser-only React + TypeScript + Vite app. There is no backend. Adventure data is persisted in IndexedDB through `src/db/adventureDb.ts`. Tiny user configuration, including the runtime API key, is stored in localStorage through `src/hooks/useLocalStorage.ts`.

The core rule is that adventure state changes go through:

```ts
adventureReducer(state: Adventure, action: AdventureAction): Adventure
```

Do not directly mutate adventure objects in components, trigger engines, importers, or provider code. UI controls dispatch typed actions. Runtime flows may call the reducer repeatedly to produce the next immutable adventure state.

## Important Folders

- `src/types`: strong shared TypeScript types for adventure data, context, providers, triggers, legacy quest fields, and reducer actions.
- `src/state`: default factories and `adventureReducer`.
- `src/db`: IndexedDB persistence.
- `src/contextBuilder`: deterministic context assembly and budget enforcement.
- `src/triggers`: trigger matching, cooldowns, trigger action mapping, and logs.
- `src/memory`: memory classification policy, AI memory mutation boundary helpers, and memory architecture tests.
- `src/quests`: legacy quest compatibility helpers. Quest state is not part of default context assembly.
- `src/providers`: OpenAI-compatible chat completion provider.
- `src/importers`: AI Dungeon import parsers (story text and story cards).
- `src/autoCards`: legacy Auto-Card compatibility helpers. Auto-Cards are not an active product surface.
- `src/tokenizer`: approximate token estimator.
- `src/pages`: plain inspectable UI pages.

## Coding Rules

- Keep code explicit and readable. Avoid clever abstractions unless they remove real duplication.
- Keep pure functions pure. Context assembly, matching, trigger mapping, token estimation, and import/export should remain unit-testable without React.
- API keys must not be written into adventure JSON or IndexedDB.
- **No opaque mega-buckets.** Do not create any section that bundles multiple conceptually distinct context types without individual item visibility. Every token in the model context must belong to a named, inspectable section.
- Context assembly order is fixed (see `ContextSectionKind` and the section-order table in `FEATURES.md`) and ordered for provider prefix caching: stable system prefix (system → aiInstructions → plotEssentials → currentArc → components → pinnedStoryCards) → recentMessages (chunk-aligned) → per-turn `[TURN CONTEXT]` block in the newest user message (storyState → sceneDirection → activePressure → arcProgress → storyCards → brains → authorNote → nextTurnNote → corrections → challengeMode).
- The cached prefix holds only content that changes rarely: Active Pressure (P, `activePressure`), the arc's development log (C3, `arcProgress`), and pinned living Story Cards ride in the turn context. The arc premise and gated phase direction stay in C2.
- The newest `tokenBudgetSettings.minRecentMessages` messages (default 6) outrank unprotected memory under budget pressure; they are trimmed only after everything else unprotected, and that release is logged. Protected context is never dropped for them.
- Never put per-turn data (triggered cards, brains, Story State, lists of eligible targets, turn numbers) in the system message: it breaks the provider prompt cache for everything after it. Never send per-turn context as a system message either; Anthropic-style adapters hoist system messages to the front.
- The narrator prompt must not carry memory bookkeeping instructions. Automatic memory writes belong to the background memory pass.
- `aiInstructions`, `plotEssentials`, and `authorNote` components each occupy their own section (B, C, D). The active `currentArc` component occupies section C2, between Plot Essentials and Components. General always-on or pinned custom components go to section E (`components`).
- Pinned / always Story Cards are section F0 (`pinnedStoryCards`, cached prefix); triggered Story Cards are section F (`storyCards`). Brains are section G (thoughts plus knowledge boundary). Story State is section S (`storyState`). Author's Note (D) sits closest to the newest turn for AID-style influence. Next Output Bias is section J. The Continuity Challenge instruction is section M (`challengeMode`), injected when active or on an out-of-character turn. Recent messages are section K.
- Rolling Summary and Scene State are retained on the adventure object for save-compat but are no longer emitted as their own assembled sections (see `FEATURES.md` §18). Quest state is not part of the default section assembly.
- Protected means non-droppable during token truncation. Pinned means prioritized, not automatically non-droppable.
- Only the system shell and user-marked protected context are absolutely non-droppable.
- Budget cuts are controlled by `memoryPriorityMode`, `allowSystemToPrioritizeMemory`, and `allowSystemToDropUnpinnedTriggeredCards`. `allowSystemToTruncateSummary` is legacy: Rolling Summary is not assembled into context.
- In `userLocked`, drop older recent messages before memory when possible. In `systemSuggested`, the lowest scored unprotected item may drop first. In `hybrid`, system-suggested memory can drop before user-locked context.
- Log excluded context items with `budget_exceeded`, `inactive`, `cooldown`, or `not_triggered`.
- Log context build decisions for inclusion, exclusion, truncation, and ordering. Include `generatedBy` in ordering decisions.
- `ContextItem.generatedBy` must be set: `"system"` for the system shell, `"ai"` for items derived from AI-generated source (`source === "generated"`), `"user"` otherwise. Message items: `"user"` for user role, `"ai"` for assistant role, `"system"` for system role.
- Context Preview must match the provider payload returned by `buildContext`. Empty sections are excluded from the payload but always present in `result.sections`.
- `ContextBuildResult.pendingProposals` exposes pending Memory Proposals for the UI. These are never included in the model payload.
- AI-generated memory updates must go through `src/memory/applyAIMemoryUpdate.ts` and then through reducer actions.
- AI may update BrainEntry fields (thoughts, knowledge boundary) only when the BrainEntry already exists, StoryCard content/triggers/state (a fact on a static card may be superseded or retracted only when an author correction requires it), Plot Essentials component content, the one-sentence Active Pressure component through the `plotPressureUpdate` path only, the Story State component and open threads through the `storyStateUpdate` path only, the Scene Direction component through the `sceneDirectionUpdate` path only (full replacement; skipped when the block's "Background memory pass suggests Story State updates" switch — `autoUpdate` — is off).
- AI must not mutate AI Instructions, Author's Note, provider config, trigger definitions, quest definitions, raw imports, or the system shell.
- Memory Inbox proposals live in `activeState.memoryProposals`; approving/rejecting/ignoring proposals must go through reducer actions.
- Do not add silent stubs. If a feature is incomplete, label it clearly in both code and UI.

## Memory Placement Policy

- **Adventure Chronicle**: `adventure.messages`, the complete persisted transcript. Keep it uncompressed. Never automatically include the full Chronicle in model context. It is source material for summaries and memory proposals, not direct context.
- **Rolling Summary**: `adventure.rollingSummary`, legacy compression of the Chronicle. It is retained on the adventure object for save compatibility but is not emitted as a model context section. Must not overwrite story cards, brains, or components.
- **Next Output Bias**: `activeState.nextTurnNote`, a user-written short-term steering note for the next generation. Appears in section J, is visible in Context Preview, token-counted, reducer-driven, and expires after one successful generation by default.
- **Story Cards**: durable recurring facts — private jokes, nicknames, secrets, promises, relationship facts, magical rules, recurring objects, locations, factions. Trigger-matched or pinned. Section F. Optional AI auto-updates use per-card cooldown fields (`autoUpdateCooldownTurns`, `lastAutoUpdateTurn`).
- **Brains**: opt-in evolving character-internal state for major characters only. Do not create BrainEntries for random NPCs, locations, factions, objects, or one-scene characters. Brain updates only apply when a BrainEntry already exists. If no BrainEntry exists, route durable character memory to an existing Story Card or a Story Card proposal in Memory Inbox.
- **Plot Essentials**: compact overarching premise, central long-term conflict, and persistent story-wide constraints. Change only when those foundations change; immediate stakes belong in Active Pressure and ongoing storyline progress belongs in Current Arc. Section C. AI may update these through the approved `plotEssentialsUpdate` proposal path only.
- **Active Pressure**: one sentence naming the current external threat, obligation, or force pressing on the player character. Section P (turn context). Auto-generated through `plotPressureUpdate`, auto-approved by default, and replaced when stakes change.
- **Story State**: the authoritative current truth — day/time, location, relationship status, living/sleeping arrangements, who has met whom, open threads. Section S, always included when non-empty, protected. The background memory pass suggests full rewrites through `storyStateUpdate`, reviewed in Memory Suggestions by default (auto-approve is opt-in); a newer pending suggestion supersedes an older one. The narrator is told Story State and recent turns override older cards.
- **Background memory pass**: `src/memory/compactMemoryFallback.ts` (`runBackgroundMemoryPass`) is the only automatic memory writer — one JSON call every `memoryDetectionSettings.everyNTurns` story turns. It must not escalate into `runMemoryCycle` and must not run after out-of-character turns. Only a valid pass advances `lastMemoryPassMessageId`; replacement proposals carry `baseContent` and are never auto-applied over a newer edit. Story State updates prefer targeted `stateLine` edits through the same `storyStateUpdate` path. Story State text is bounded (`STORY_STATE_MAX_WORDS` 400 in `src/memory/storyStateLines.ts`): line edits that would grow an over-long block are refused, and a consolidating full rewrite of an over-long block always requires review.
- **Open threads**: `adventure.storyThreads` (`StoryThread`, `src/memory/storyThreads.ts`), data beside the Story State text, not inside it. Each has a stable id (`t3`), status open/resolved, and turn history. The narrator reads open threads as the end of section S (no ids); the memory pass sees ids and changes them only through `storyStateUpdate` proposals carrying `threadOp` (add / update / resolve; `keep` consolidates). At most `MAX_OPEN_THREADS` (8) open; adding past it is refused; resolving 4+ at once always requires review. Saves with an "Open threads:" line in Story State text migrate once in `normalizeAdventure`. A full Story State rewrite never carries or supersedes threads. The player edits threads through `ADD/UPDATE/RESOLVE/REOPEN/DELETE_STORY_THREAD`.
- **Scene Direction**: a singleton `sceneDirection` component (section S2, turn context): who is present, each NPC's current aim, and the choice left to the player. Written only by the background memory pass through `sceneDirectionUpdate` (auto-approved by default, `autoUpdate` switch on the block), replaced every pass, shown with its turn. It must never decide outcomes or player actions and is not a planning call.
- **Author corrections**: `activeState.corrections`. An out-of-character player message, or an edit/erase/regeneration of a message that applied memory came from, records a correction. Active out-of-character corrections are sent to the narrator as section N (`corrections`, turn context, protected). The background memory pass sees active corrections as authoritative evidence, may `retract` a card fact or supersede a fact on a static card only with correction evidence, runs at the next story turn when a correction is unread, and marks corrections seen; they retire after `CORRECTION_ACTIVE_TURNS`. The narrator must never acknowledge a correction in character. The pass may propose at most one Event Memory per pass, always reviewed, when `suggestEventMemories` is on.
- **Immediate Momentum**: disabled legacy component type. Keep the type for old-save compatibility, but do not generate it, auto-update it, import it, or assemble it into context.
- **AI Instructions**: persistent generation rules. Section B. AI must not modify.
- **Author's Note**: tonal / mood layer. Section D. AI must not modify.
- **Memory Inbox**: `activeState.memoryProposals` — AI/system-suggested memory updates before they become active context. Proposals have `status: "pending" | "approved" | "rejected" | "ignored"`. Pending proposals appear in Context Preview but are never model context. Approving a proposal converts it to a Story Card, Brain update, Plot Essentials update, Active Pressure update, or legacy Summary update via reducer actions.

Use `classifyMemory` in `src/memory/classificationPolicy.ts` when creating deterministic proposals. If a character has no BrainEntry, route durable character facts to an existing Story Card or a Story Card proposal; do not create a brainUpdate proposal by default. Ephemeral scenery, one-off room layouts, generic movement, and throwaway details should be ignored unless marked important or recurring.

Do not add an opaque Memory Bank retrieval layer. A future Inspectable Memory Bank is acceptable only if it is a separate visible context surface with source turns, relevance reasons, token costs, usage metadata, and user controls for approve/edit/archive/delete.

## Known Architecture Decision: Semantic Engine vs Memory Proposals

The semantic post-turn evaluator (`src/triggers/semanticEngine.ts`) can apply brain, story card, and Plot Essentials updates **directly** — via `applyAIMemoryUpdate` → reducer actions — when `semanticEvaluationSettings.requireApprovalForAutoUpdates` is `false`. When that setting is `true`, generated updates become Memory Inbox proposals and do not mutate active memory until approved.

Auto-Cards are a removed legacy surface. Do not reintroduce an Auto-Card review queue without adding explicit UI, reducer actions, and context-builder tests.

The reason direct brain/story-card/plotEssentials updates are allowed as an option: every semantic trigger that fires a memory-update action was **explicitly configured by the user** (condition string + action type + target ID). The user opted into this behavior. These are not surprise AI suggestions — they are user-defined rules executing.

Memory Inbox / Memory Proposals is the path for **unstructured AI-suggested new memory** — the `classifyMemory` flow, or future summary-extraction passes — where the source text is arbitrary and the AI is making a freeform durable-memory suggestion that the user has not pre-authorized.

If you want to require user review for all semantic memory writes, set `requireApprovalForAutoUpdates` to `true` in Settings. Keep tests for both modes.

## Arc Director (deterministic story pacing)

The Arc Director makes an antagonist's arc climb and *break* on its own, configured on a single `currentArc` component. The design rationale is in `docs/adventure-design.md`; this is the implementation contract.

**Where it lives**
- `ArcPacingState` and the `arc*` fields on `ComponentEntry` (`arcThreadKeys`, `arcPace`, `arcTriggerMode`, `arcSimmerInstruction`, `arcBreakInstruction`, `arcState`) — `src/types/adventure.ts`.
- The phase gate — the `currentArc` block in `src/contextBuilder/contextBuilder.ts`.
- `ADVANCE_ARC_PACING` (per-turn engagement counter + phase transitions) and `SET_ARC_PHASE` (manual override / confirm a pending break), plus the pace→threshold table — `src/state/adventureReducer.ts`.
- The engagement signal — `src/state/turnPipeline.ts` dispatches `ADVANCE_ARC_PACING` with the Story Card / Brain ids that triggered in-scene this turn.
- Setup UI — the `ArcDirector` panel in `src/pages/ComponentsPage.tsx`.

**Phases:** `simmer → escalate → break → aftermath`. `simmer`/`escalate` inject `arcSimmerInstruction`; `break` injects `arcBreakInstruction`; `aftermath` injects neither.

**Invariants — do not break these:**
- `arcBreakInstruction` (the cost) MUST NOT be assembled into context before `phase === "break"`. This is the core safety property — the model cannot land the climax on something it never sees. Any refactor of the `currentArc` context block must preserve it; a contextBuilder test guards it.
- Pacing advances on COUNTED engagement (`threadEngagement`), never on an LLM verdict. Do not add a "let the model judge if it's dramatic yet" path — that reintroduces the unmanaged ledger the feature exists to delete.
- Phase transitions are one-way except an explicit `SET_ARC_PHASE` reset to `simmer` (which clears `threadEngagement`).
- Elapsed turns never resolve an arc. After `ARC_BREAK_DURATION` turns in break, `pendingResolution` asks the player; `break → aftermath` happens only through `SET_ARC_PHASE` (manual Resolve) or an approved, always-reviewed `currentArcUpdate` with `resolvesArc`.
- Engagement counts only thread ids matched in the current turn's own text, with a character's Story Card and Brain counted once.
- Engagement counts only ids listed in the arc's `arcThreadKeys`.

**Model-fidelity constraint (system-wide):** the design assumes a model that honors long rule blocks (DeepSeek V3.2 / `deepseek-chat` class). The Arc Director controls only *when* the break instruction appears; whether the model *spends the authored cost* at the climax is a model-capability matter the code does not and cannot enforce. Flash-tier models skim long prompts and will fake the cost.

## AI Generation Buttons (user-initiated)

`src/ai/generators.ts` powers the ✨ Generate buttons: component content (Narration Rules / AI Instructions / Author's Note), a full Arc Director setup from a concept, and a character Brain from a name. These are distinct from autonomous AI memory mutation: they run only on an explicit user click, are grounded in a compact adventure snapshot, and produce content the user reviews (preview → Apply) or that lands via a reducer action the user invoked. They are therefore allowed to populate `narrationRules` / `aiInstructions` / `authorNote` / `currentArc` arc fields / new Brains — which *autonomous* AI memory updates may NOT touch. Keep that distinction: the AI-write boundary in the Memory Placement Policy governs *unprompted* writes, not user-requested generation.

## Adding a Memory Surface

1. Define the type in `src/types/adventure.ts`.
2. Add factory/default/normalization behavior in `src/state/defaults.ts`.
3. Add typed reducer actions and tests.
4. Add context builder behavior and golden context tests if it can affect prompts.
5. Add an inspectable UI path.
6. Add AI mutation boundary tests before allowing generated updates to write to it.

## Required Finish Workflow

After any completed scoped code or documentation change, do not stop at a summary. Finish by:

1. Run the relevant validation commands, including the full Validation set below when feasible.
1b. If the change alters behavior described in `FEATURES.md`, this file, `README.md`, or the in-app Help page, update those docs in the same commit.
2. Check `git status --short` and stage only the files changed for the scoped task.
3. Commit the scoped work.
4. Push the current branch to its tracked remote.
5. Report the full commit hash to the user.

If committing or pushing is unsafe or impossible, report the exact blocker and the current commit/staging state. Leave unrelated dirty files unstaged and call them out separately.

## Validation

Run:

```sh
npm.cmd test
npm.cmd run build
npm.cmd run smoke:prod
```

The build runs TypeScript first and then creates the GitHub Pages-compatible static bundle in `dist/`.
