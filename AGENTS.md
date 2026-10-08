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
- AI may update BrainEntry fields only when the BrainEntry already exists, StoryCard content/triggers/state, and Plot Essentials component content.
- AI must not mutate AI Instructions, Author's Note, provider config, trigger definitions, quest definitions, raw imports, or the system shell.
- Memory Inbox proposals live in `activeState.memoryProposals`; approving/rejecting/ignoring proposals must go through reducer actions.
- Do not add silent stubs. If a feature is incomplete, label it clearly in both code and UI.

## Memory Placement Policy

Authoring boundary: [Fact ownership and overlap audit](docs/fact-ownership.md), also available in UI Help. One canonical fact has one authoritative home. This is editorial guidance, not permission to change prompts or mutation policies. Keep objective facts, durable psychology, event-specific thoughts, narrative instructions, and historical evidence distinct.

- **Adventure Chronicle**: `adventure.messages`, the complete persisted transcript. Keep it uncompressed. Never automatically include the full Chronicle in model context. It is source material for summaries and memory proposals, not direct context.
- **Rolling Summary**: `adventure.rollingSummary`, legacy compression of the Chronicle. It is retained on the adventure object for save compatibility but is not emitted as a model context section. Must not overwrite story cards, brains, or components.
- **Next Output Bias**: `activeState.nextTurnNote`, a user-written short-term steering note for the next generation. Appears in section J, is visible in Context Preview, token-counted, reducer-driven, and expires after one successful generation by default.
- **Story Cards**: durable recurring facts — private jokes, nicknames, secrets, promises, relationship facts, magical rules, recurring objects, locations, factions. Trigger-matched or pinned. Section F. Optional AI auto-updates use per-card cooldown fields (`autoUpdateCooldownTurns`, `lastAutoUpdateTurn`).
- **Brains**: opt-in event-specific internal responses for major characters only. Durable psychology, biography, capability mechanics and Voice Contract belong on the character card. Enrolled directional relationships explicitly own their tracked mutable pair state; do not duplicate it in cards or freeform thoughts. Do not create BrainEntries for random NPCs, locations, factions, objects, or one-scene characters. Brain updates only apply when a BrainEntry already exists. If no BrainEntry exists, route durable character memory to an existing Story Card or a Story Card proposal in Memory Inbox.
- **Plot Essentials**: compact current operating truth, premise, and constraints needed in nearly every plausible next response. Essential current status or an always-present party may qualify; importance alone does not. Update owned facts when established events change them; active larger-thread progress belongs in Current Story Arc. Section C. AI may update these through the approved `plotEssentialsUpdate` proposal path only.
- **Immediate Momentum**: disabled legacy component type. Keep the type for old-save compatibility, but do not generate it, auto-update it, import it, or assemble it into context.
- **AI Instructions**: optional separately organized scenario-specific generation rules. Narration Rules is the primary per-adventure contract; do not repeat rules in both or store profiles/lore/state in either. Section B. AI must not modify.
- **Author's Note**: tone, style and near-context direction, which may persist until edited. Clear resolved temporary direction; do not store profiles or relationship state here. Section D. AI must not modify.
- **Memory Inbox**: `activeState.memoryProposals` — AI/system-suggested memory updates before they become active context. Proposals have `status: "pending" | "approved" | "rejected" | "ignored"`. Pending proposals appear in Context Preview but are never model context. Approving a proposal converts it to a Story Card, Brain update, Plot Essentials update, or legacy Summary update via reducer actions.

Use `classifyMemory` in `src/memory/classificationPolicy.ts` when creating deterministic proposals. If a character has no BrainEntry, route durable character facts to an existing Story Card or a Story Card proposal; do not create a brainUpdate proposal by default. Ephemeral scenery, one-off room layouts, generic movement, and throwaway details should be ignored unless marked important or recurring.

Do not add an opaque Memory Bank retrieval layer. A future Inspectable Memory Bank is acceptable only if it is a separate visible context surface with source turns, relevance reasons, token costs, usage metadata, and user controls for approve/edit/archive/delete.

## Known Architecture Decision: Semantic Engine vs Memory Proposals

The semantic post-turn evaluator (`src/triggers/semanticEngine.ts`) can apply brain, story card, and Plot Essentials updates **directly** — via `applyAIMemoryUpdate` → reducer actions — when `semanticEvaluationSettings.requireApprovalForAutoUpdates` is `false`. When that setting is `true`, generated updates become Memory Inbox proposals and do not mutate active memory until approved.

Auto-Cards are a removed legacy surface. Do not reintroduce an Auto-Card review queue without adding explicit UI, reducer actions, and context-builder tests.

The reason direct brain/story-card/plotEssentials updates are allowed as an option: every semantic trigger that fires a memory-update action was **explicitly configured by the user** (condition string + action type + target ID). The user opted into this behavior. These are not surprise AI suggestions — they are user-defined rules executing.

Memory Inbox / Memory Proposals is the path for **unstructured AI-suggested new memory** — the `classifyMemory` flow, or future summary-extraction passes — where the source text is arbitrary and the AI is making a freeform durable-memory suggestion that the user has not pre-authorized.

If you want to require user review for all semantic memory writes, set `requireApprovalForAutoUpdates` to `true` in Settings. Keep tests for both modes.

## Story-led progression and canon reconciliation

See [Story Director](docs/story-director.md). A designated custom Play Loop is conditionally included; post-generation semantic judgment never advances the authored Arc Director counters/phases. Keep its default conservative and preserve sandbox wording. Evaluation failures with no grounded items restore normal play in Auto; manual modes persist until Auto is selected. Evidence references resolve to exact accepted assistant text, with latest-only references for detected changes and canon edits. Invalid evaluator items must not discard independently validated threads, but canon batches remain atomic; canon reconciliation failures preserve an independently validated progression verdict. Preserve rejected provider responses and allow at most one validation repair request per stage.

The dedicated `canonReconciliation` AI-update boundary is an explicit exception to the legacy narrow mutation rules above: evidence-backed atomic replacements may update existing state components (Plot Essentials, Current Arc, Active Pressure), nonhistorical cards, existing Brain thoughts, and enrolled relationships. It must preserve owner history, reject stale batches atomically, respect memory approval settings, and require review for relationships. It may not mutate narrator instructions, Play Loop text, authored pacing, or provider configuration. Keep discarded-generation rollback and mutation-boundary tests.

## Retired Arc Director

The authored Arc Director is retired. Keep its serialized fields and legacy types for save compatibility, but do not expose pacing controls, advance pacing during turns, generate continuations or arc proposals, or include simmer/break directions in provider context. Reject legacy `arcProposal` memory writes, including approval of proposals loaded from saves. Current Story Arc remains an active fact/state component; its content and premise are distinct from retired pacing instructions.

Story Director canon changes require explicit approval by default. Automatic application requires `memoryAutoApprove.storyDirector === true`, approval enabled for every affected memory type, and the global semantic review requirement off. Relationships still require review. Per-item Story Director locks continue to block changes. Pending batches are reviewable in Memory Suggestions and Components.

## AI Generation Buttons (user-initiated)

`src/ai/generators.ts` powers the user-initiated Generate buttons for component content and character Brains. These run only on explicit user action and remain distinct from autonomous memory writes. Legacy authored Arc Director generators are no longer exposed in the UI; do not restore their controls or automatic continuation calls.

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
