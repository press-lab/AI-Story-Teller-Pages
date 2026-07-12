# AI Story Teller Agent Guide

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
- Context assembly order is fixed (see `ContextSectionKind` and the section-order table in `FEATURES.md`): system → aiInstructions → plotEssentials → currentArc → components → storyCards → brains → authorNote → nextTurnNote → challengeMode → recentMessages.
- `aiInstructions`, `plotEssentials`, and `authorNote` components each occupy their own section (B, C, D). The active `currentArc` component occupies section C2, between Plot Essentials and Components. General always-on or pinned custom components go to section E (`components`).
- Story Cards are section F (`storyCards`). Brains are section G. Author's Note (D) is placed near recent context for AID-style influence. Next Output Bias is section J. The Continuity Challenge instruction is section M (`challengeMode`), injected just before Recent Messages when active. Recent messages are section K.
- Rolling Summary and Scene State are retained on the adventure object for save-compat but are no longer emitted as their own assembled sections (see `FEATURES.md` §18). Quest state is not part of the default section assembly.
- Protected means non-droppable during token truncation. Pinned means prioritized, not automatically non-droppable.
- Only the system shell and user-marked protected context are absolutely non-droppable.
- Budget cuts are controlled by `memoryPriorityMode`, `allowSystemToPrioritizeMemory`, `allowSystemToDropUnpinnedTriggeredCards`, and `allowSystemToTruncateSummary`.
- In `userLocked`, drop older recent messages before memory when possible. In `systemSuggested`, the lowest scored unprotected item may drop first. In `hybrid`, system-suggested memory can drop before user-locked context.
- Log excluded context items with `budget_exceeded`, `inactive`, `cooldown`, or `not_triggered`.
- Log context build decisions for inclusion, exclusion, truncation, and ordering. Include `generatedBy` in ordering decisions.
- `ContextItem.generatedBy` must be set: `"system"` for the system shell, `"ai"` for items derived from AI-generated source (`source === "generated"`), `"user"` otherwise. Message items: `"user"` for user role, `"ai"` for assistant role, `"system"` for system role.
- Context Preview must match the provider payload returned by `buildContext`. Empty sections are excluded from the payload but always present in `result.sections`.
- `ContextBuildResult.pendingProposals` exposes pending Memory Proposals for the UI. These are never included in the model payload.
- AI-generated memory updates must go through `src/memory/applyAIMemoryUpdate.ts` and then through reducer actions.
- AI may update BrainEntry fields only when the BrainEntry already exists, StoryCard content/triggers/state, Plot Essentials component content, and the one-sentence Active Pressure component through the `plotPressureUpdate` path only.
- AI must not mutate AI Instructions, Author's Note, provider config, trigger definitions, quest definitions, raw imports, or the system shell.
- Memory Inbox proposals live in `activeState.memoryProposals`; approving/rejecting/ignoring proposals must go through reducer actions.
- Do not add silent stubs. If a feature is incomplete, label it clearly in both code and UI.

## Memory Placement Policy

- **Adventure Chronicle**: `adventure.messages`, the complete persisted transcript. Keep it uncompressed. Never automatically include the full Chronicle in model context. It is source material for summaries and memory proposals, not direct context.
- **Rolling Summary**: `adventure.rollingSummary`, legacy compression of the Chronicle. It is retained on the adventure object for save compatibility but is not emitted as a model context section. Must not overwrite story cards, brains, or components.
- **Next Output Bias**: `activeState.nextTurnNote`, a user-written short-term steering note for the next generation. Appears in section J, is visible in Context Preview, token-counted, reducer-driven, and expires after one successful generation by default.
- **Story Cards**: durable recurring facts — private jokes, nicknames, secrets, promises, relationship facts, magical rules, recurring objects, locations, factions. Trigger-matched or pinned. Section F. Optional AI auto-updates use per-card cooldown fields (`autoUpdateCooldownTurns`, `lastAutoUpdateTurn`).
- **Brains**: opt-in evolving character-internal state for major characters only. Do not create BrainEntries for random NPCs, locations, factions, objects, or one-scene characters. Brain updates only apply when a BrainEntry already exists. If no BrainEntry exists, route durable character memory to an existing Story Card or a Story Card proposal in Memory Inbox.
- **Plot Essentials**: tiny always-on current-state constraints. Section C. AI may update these through the approved `plotEssentialsUpdate` proposal path only.
- **Active Pressure**: one sentence naming the current external threat, obligation, or force pressing on the player character. Section C. Auto-generated through `plotPressureUpdate`, auto-approved by default, and replaced when stakes change.
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
