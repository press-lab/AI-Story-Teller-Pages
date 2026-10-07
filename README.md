# AI Story Teller

A browser-only MVP for building and playing local AI adventure sessions. It uses React, TypeScript, Vite, IndexedDB persistence, and an OpenAI-compatible provider call. Users supply their own API key in Settings.

## Setup

```sh
npm.cmd install
npm.cmd run dev
```

Build for production:

```sh
npm.cmd run build
```

Preview the production build:

```sh
npm.cmd run preview
```

## GitHub Pages Deploy

The Vite config uses `base: "./"` so the built app can be served from a GitHub Pages project path.

1. Run `npm.cmd run build`.
2. Publish the `dist/` folder with your preferred Pages workflow.
3. No backend or server configuration is required.

## Architecture

All adventure state mutations go through `src/state/adventureReducer.ts` using the full `AdventureAction` union from `src/types/adventure.ts`.

IndexedDB stores adventures in `src/db/adventureDb.ts`. localStorage stores only small runtime settings, including API key and provider preferences. Exported adventure JSON strips API keys.

## Context Assembly Contract

`src/contextBuilder/contextBuilder.ts` builds the exact provider payload shown in Context Preview. The first payload message is the assembled model-facing context, and the following payload messages are the included recent transcript messages.

**There is no opaque "Adventure & Memories" bucket.** Every token in the model context belongs to a named, inspectable section. Empty sections are omitted from the payload but always appear in `ContextBuildResult.sections` so the user can verify what is and is not loaded.

Context sections, in fixed order:

| ID | Label | Contents |
|---|---|---|
| `system` | A. System Shell | Global generation rules — always protected |
| `aiInstructions` | B. AI Instructions | Components with `type === "aiInstructions"` |
| `plotEssentials` | C. Plot Essentials | `plotEssentials` components |
| `currentArc` | C2. Current Story Arc | Active arc log and gated Arc Director phase instruction |
| `components` | E. Components | General always-on or pinned custom components |
| `storyCards` | F. Story Cards | Triggered / pinned Story Cards |
| `brains` | G. Brains | Active Brain entries for triggered characters |
| `authorNote` | D. Author's Note | Components with `type === "authorNote"`; placed near recent context for AID-style influence |
| `nextTurnNote` | J. Next Output Bias | User-written short-term steering note for the next generation |
| `challengeMode` | M. Continuity Challenge | One-turn correction instruction when the player challenges continuity |
| `recentMessages` | K. Recent Messages | Short-term transcript window |

Rolling Summary, Scene State, Quest State, Auto-Cards, and Immediate Momentum are legacy/save-compatible surfaces only. They are not assembled into the default model context.

Memory Proposals (`activeState.memoryProposals`) are shown in Context Preview under "Memory Proposals / Pending Updates" but are never included in the model payload until approved. `ContextBuildResult.pendingProposals` carries the pending set.

Every `ContextItem` exposes:
- `tokenEstimate` — approximate token cost
- `id` / `title` — item identity
- `content` — exact text sent
- `priority` — ordering within its section
- `protected` — cannot be dropped by token truncation
- `pinned` — prioritized but droppable if budget requires
- `inclusionPolicy` — `always | triggered | manual | systemSuggested`
- `generatedBy` — `"user" | "system" | "ai"`

`ContextBuildResult.decisions` records every inclusion, exclusion, truncation, and ordering decision with a human-readable reason string. `ContextBuildResult.excludedItems` lists every item omitted, with reason `budget_exceeded`, `inactive`, `cooldown`, or `not_triggered`.

Budget cuts are deterministic but configurable:

- Only the system shell and user-marked `protected` context are absolutely non-droppable.
- `pinned` means strongly prioritized, not automatically non-droppable.
- `memoryPriorityMode` controls the drop order: `userLocked` (drop old messages first), `systemSuggested` (drop lowest-scored item first), `hybrid` (drop system-suggested context before user-locked context).
- `allowSystemToDropUnpinnedTriggeredCards` and `allowSystemToPrioritizeMemory` gate additional budget behaviors. `allowSystemToTruncateSummary` is legacy because Rolling Summary is no longer assembled into context.

The Context Preview page shows:
1. **Ordered Sections** — each section with per-item token estimate, priority, protected/pinned flags, inclusion policy, and generatedBy.
2. **Memory Proposals / Pending Updates** — pending proposals with source text, type, rationale, confidence; not model context.
3. **Provider Payload Preview** — the exact JSON sent to the model. Must match the Ordered Sections content exactly.

## Memory Architecture

- **Adventure Chronicle**: `adventure.messages`, the full persisted transcript. Inspectable in the Chronicle tab. Never automatically compressed or flooded into model context.
- **Rolling Summary**: `adventure.rollingSummary`, legacy compression of the Chronicle retained for save compatibility. It is not emitted as a model context section.
- **Next Output Bias**: `activeState.nextTurnNote`, a visible short-term steering note. It appears in section J, is token-counted, and expires after one successful generation by default.
- **Story Cards**: durable triggered records for one subject: character, location, faction, object, relationship, secret, rule, or completed event. Cards carry `memoryMode` (`static`, `living`, or `historical`) so generated updates know whether to write always-true facts, current evolving state, or past-tense history. The Story Cards page can turn a user description into a pending AI-generated Memory Proposal for review. Optional AI auto-updates use a per-card cooldown and can be routed through Memory Inbox when approval is required.
- **Brains**: opt-in character-internal state for major characters only. AI may update a Brain only when a `BrainEntry` already exists. Do not create Brains for random NPCs.
- **Plot Essentials**: tiny always-on current operating truth: what is happening now, open tensions, obligations, and major constraints that should shape every scene. PE replacement proposals overwrite the block; outgoing facts become pending historical Story Card proposals for review. Section C.
- **Immediate Momentum**: disabled legacy component type. It is not generated, imported, auto-updated, or sent to the model.
- **Narration Rules**: the primary per-adventure behavior contract, copied from defaults but editable during creation and afterward. Loaded with the system shell before other context.
- **AI Instructions**: optional persistent scenario-specific behavior rules in section B. Use them for stable genre, drift prevention, and prose contracts, not facts or the repeatable sandbox loop. The designated Play Loop custom component owns that loop so it can be temporarily excluded during earned progression or closure. AI Instructions are unnecessary when Narration Rules already contain the complete stable contract. Avoid duplicating rules. Autonomous AI updates cannot modify these.
- **Author's Note**: author-layer mood or tonal constraints. Section D. AI must not modify these.
- **Memory Inbox / Proposals**: `activeState.memoryProposals`, where AI-suggested durable memories wait for user approval. Pending proposals appear in Context Preview but are not model context. Approving converts them to Story Cards, Brain updates, Plot Essentials edits, or legacy Summary updates through reducer actions.
- **Protected**: non-droppable during token truncation. `aiInstructions`, `plotEssentials`, and `authorNote` components are protected by default.
- **Pinned**: prioritized for inclusion and ordering, but droppable if budget is exhausted and the item is not also protected.

Use `src/memory/classificationPolicy.ts` for deterministic memory routing. Use `src/memory/applyAIMemoryUpdate.ts` for AI-generated memory updates.

### Deferred Memory Bank Idea

An optional Inspectable Memory Bank may be useful later, but it is intentionally not part of the MVP. Story Cards, Brains, Memory Inbox, Plot Essentials, Current Arc, Next Output Bias, and Recent Messages already cover the current context roles without an additional retrieval layer.

If added later, Memory Bank entries must be their own visible context section with item-level source turns, token cost, relevance reason, usage count, last-used timestamp, and approve/edit/archive/delete controls. They must never enter the model as an opaque retrieved-memory bucket.

## AI Mutation Boundaries

AI-generated memory updates use validated reducer actions. The narrow component
update helper, older typed proposals, and post-story replacement batches have
different target sets and approval checks.

Allowed AI update targets:

- BrainEntry fields
- StoryCard content, triggers, and state
- Plot Essentials content through the narrow component-update helper
- Existing Current Arc and compatibility Active Pressure through typed update/proposal paths
- Existing eligible state owners through the post-story replacement batch (including enrolled directional relationship state, which always requires review)

Rejected AI update targets:

- Narration Rules, AI Instructions, Author's Note, and designated Play Loop components
- authored Arc Director pacing and historical records
- provider/model config
- trigger rule definitions
- quest definitions
- raw imported source text
- system shell/global generation rules

If an entity has no BrainEntry, AI-driven memory routing must not create or update a Brain by default. Durable character facts should route to an existing Story Card when possible, otherwise to a pending Story Card proposal in Memory Inbox. Random NPCs, one-scene characters, locations, factions, and objects should not receive BrainEntries by default.

The generation flow is implemented in `src/hooks/useAdventureRuntime.ts` and `src/state/turnPipeline.ts`:

1. Save user message through the reducer.
2. Evaluate keyword/regex triggers synchronously.
3. Build deterministic context.
4. Call the OpenAI-compatible story provider and save the model output.
5. Persist story state.
6. Evaluate accepted story state when a designated Play Loop is active, then reconcile meaningful canon changes through validated replacement batches.
7. Run semantic trigger evaluation and generated updates in the background.
8. Apply generated updates through the reducer and persist again.

See [Story-led progression and canon reconciliation](docs/story-director.md) for Play Loop suspension/restoration, owner replacement, approval controls, debugging, cost, and validation limits.

The context builder in `src/contextBuilder/contextBuilder.ts` follows the required deterministic section order and returns the final provider payload, ordered sections, section token estimates, total estimate, and excluded items.

## Implemented MVP Surfaces

- Adventure create, open, duplicate, delete, export, import, and runtime reset.
- IndexedDB persistence.
- Play UI with submit, continue, regenerate, last-message editing, save status, token display, and context preview.
- Components, Story Cards, Brains, Triggers, Memory Inbox, Chronicle, Context Preview, Settings, Saves, and Import/Export tabs.
- Chronicle and Memory Inbox tabs for inspecting transcript history and proposed durable memories.
- Trigger matching for keyword, phrase, and regex; deterministic priority order; cooldowns; trigger log.
- LLM semantic trigger evaluation with generated updates for brains, story cards, Plot Essentials, and Current Arc.
- Full trigger action suite wired through the reducer.
- Legacy quest, Auto-Card, Rolling Summary, and Scene State fields preserved for older saves, but not part of default runtime context.
- AIST adventure JSON backup/restore for full playable saves.
- Approximate token estimator in `src/tokenizer/approximateTokenCount.ts`.

## Architecture Decision: Semantic Engine and Memory Proposals

The semantic post-turn evaluator can apply brain, story card, Plot Essentials, and Current Arc updates through reducer-backed proposal/update paths. When `semanticEvaluationSettings.requireApprovalForAutoUpdates` is `true`, generated updates become Memory Inbox proposals and do not mutate active memory until approved.

Memory Inbox / Memory Proposals is the path for unstructured AI-suggested new memory (the `classifyMemory` flow), where the AI is making a novel durable-memory suggestion the user has not pre-authorized.

Rolling Summary and Scene State remain as legacy save-compatible data fields. They are not emitted into the model payload by `buildContext`.

See `AGENTS.md` for implementation guidance if you want to change this behavior.

## Known Limitations

- Token counts are approximate by design. The estimator is named `approximateTokenCount` so a real tokenizer can replace it later.
- Provider integration starts with OpenAI-compatible chat completion APIs. DeepSeek works through the default base URL/model, and other compatible providers can be configured in Settings.
- Trigger action editing uses JSON textareas for inspectability in this MVP.

## Stub Inventory

Legacy stubs remain for removed systems: `src/autoCards/*` and `src/quests/questEngine.ts` are kept so older imports do not break, but they are not active product surfaces.

## Testing

```sh
npm.cmd test
npm.cmd run build
npm.cmd run smoke:prod
```

The deterministic test suite covers context order/inclusion/exclusion, story-card triggering and truncation, trigger matching/action mapping, reducer actions, AI memory mutation boundaries, memory classification, Memory Inbox approval/rejection, backup/restore behavior, golden memory architecture, and a multi-turn play smoke path.

Live provider checks are opt-in and use `.env.test.local`:

```sh
npm.cmd run test:live
```

The live suite verifies the OpenAI-compatible Groq provider call, semantic trigger evaluation, manual brain update, and Remember This proposals. Do not commit `.env.test.local`; it is ignored and should contain only throwaway test keys.

## Adding Memory Surfaces Safely

1. Add explicit TypeScript types in `src/types/adventure.ts`.
2. Add default and normalization handling in `src/state/defaults.ts`.
3. Add reducer actions; do not mutate adventure state outside `adventureReducer`.
4. Decide where the surface appears in context and update context contract tests.
5. If AI can write to it, route through `applyAIMemoryUpdate` or add a tested approval/proposal path.
6. Make the surface visible in UI before treating it as product behavior.
