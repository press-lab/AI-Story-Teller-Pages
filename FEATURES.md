# AI Story Teller — Feature Map

System architecture, feature inventory, and interaction map. Updated after each major change.

---

## Architecture Overview

The app is browser-only, local-first, IndexedDB-persisted, no backend. All LLM calls go directly from the browser to OpenAI-compatible endpoints. State is managed through a pure Redux-style reducer (`adventureReducer`). The core loop is: **player input → context build → provider → response → background systems → persist**.

---

## 1. Core Turn Loop

**Files:** `state/turnPipeline.ts`, `hooks/useAdventureRuntime.ts`

### What happens on each turn (in order):

1. `ADD_MESSAGE` — store player input
2. `applyRuntimeEngines` on `input` — keyword/regex trigger rules fire synchronously
3. `buildContext` — assembles provider payload (see Context Builder)
4. Provider call — sends to LLM
5. Stray memory envelopes / legacy tags are stripped without applying them (the narrator is never asked for memory output)
6. Continuity Lint — if risky claim patterns matched, optional LLM correction pass
7. `ADD_MESSAGE` — store cleaned assistant response
8. `CONSUME_NEXT_TURN_NOTE` — clears if `expiresAfterUse`
9. `applyRuntimeEngines` on `output` — keyword/regex trigger rules fire again
10. `INCREMENT_TURN` — advances turn counter, clears `challengeMode`, prunes expired force-include entries

Out-of-character (comms) turns build context with `outOfCharacter: true`: arc phase direction is withheld and the Continuity Challenge instruction is injected. With the preset option "Use reasoning on out-of-character corrections (DeepSeek only)", comms turns also send `thinking: enabled` with a larger output reserve.

### Background (async, after turn — not blocking):
- **Background memory pass** (`memory/compactMemoryFallback.ts` → `runBackgroundMemoryPass`): the single automatic memory writer. One JSON-mode call every `memoryDetectionSettings.everyNTurns` story turns (never after comms turns) reads every message since the previous pass plus related canon and returns Story State, character thoughts, knowledge boundaries, card, pressure, arc and essentials updates. A failed pass is logged and waits for the next slot; it never escalates into the multi-call `runMemoryCycle`.
- Semantic evaluation (`runSemanticPostTurnEvaluation`) every `semanticEvalEveryNTurns` turns, only when the user configured semantic trigger rules
- Arc continuation runs exceptionally after an arc reaches aftermath. Custom rule and arc requests are guarded against overlap.

---

## 2. Context Builder

**File:** `contextBuilder/contextBuilder.ts`

Pure function — builds the provider payload each turn. Sections are assembled in order and subject to token budget management.

### Payload layout (ordered for provider prefix caching)

1. **System message — stable prefix.** Only sections that rarely change, so providers with prefix caching (DeepSeek, Anthropic, OpenRouter) can reuse it turn after turn.
2. **Recent history**, chronological. The oldest kept message is aligned to an absolute index in chunks of 10 (`RECENT_MESSAGE_CHUNK`), so the start of the history stays identical for several turns instead of sliding every turn.
3. **Turn context** — per-turn sections rendered as a `[TURN CONTEXT] … [END TURN CONTEXT]` block at the start of the newest user message (or as a trailing user message when history ends on an assistant turn). Never a system message: Anthropic-style adapters hoist system messages to the front, which would break the cache.

### Section order (by position):

| Order | ID | Label | Placement | Contents |
|---|---|---|---|---|
| 0 | `system` | A. System Shell | prefix | Fixed system prompt + turn scope contract + all active `narrationRules` components |
| 1 | `aiInstructions` | B. AI Instructions | prefix | All active `aiInstructions` components |
| 2 | `plotEssentials` | C. Plot Essentials | prefix | `plotEssentials`, `activePressure` components |
| 2.5 | `currentArc` | C2. Current Story Arc | prefix | `currentArc` components (phase direction withheld on out-of-character turns) |
| 3 | `components` | E. Components | prefix | Always-on or pinned non-special-typed components |
| 3.5 | `pinnedStoryCards` | F0. Pinned Story Cards | prefix | Pinned or `always` story cards |
| 4 | `recentMessages` | K. Recent Messages | history | Last N messages within token budget, chunk-aligned |
| 5 | `storyState` | S. Story State | turn context | The Story State component (authoritative current truth) |
| 6 | `storyCards` | F. Story Cards | turn context | Triggered and force-included story cards, up to 2 recalled event memories |
| 7 | `brains` | G. Brains | turn context | Triggered or pinned brains: thoughts + knowledge boundary |
| 8 | `authorNote` | D. Author's Note | turn context | `authorNote` components (closest to the newest turn) |
| 10 | `nextTurnNote` | J. Next Output Bias | turn context | Active next-turn note |
| 10.5 | `challengeMode` | M. Continuity Challenge | turn context | When `challengeMode` is active or the turn is out of character |

### Also injected as inspectable system-section items:
- `Turn Scope Contract` - soft target from `responseLengthHint`

No memory bookkeeping instructions are ever sent to the narrator.

### Token budget management:
When total exceeds `maxContextTokens`, items are dropped in priority order:
1. Oldest recent messages (up to recency limit)
2. Unpinned triggered story cards (if `allowSystemToDropUnpinnedTriggeredCards`)
3. Lowest-priority unprotected items across all sections
4. Protected items are never dropped

`memoryPriorityMode`: `userLocked` (strict priority order), `systemSuggested` (system can reorder), `hybrid`.

---

## 3. Component Types (World Blocks)

**Files:** `pages/ComponentsPage.tsx`, `contextBuilder/contextBuilder.ts`, `triggers/semanticEngine.ts`

| Type | Singleton | Context Position | AI-Updates | Notes |
|---|---|---|---|---|
| `narrationRules` | Yes | System shell (A) | No | Primary per-adventure behavior contract. POV, agency, continuity, tone, format. Protected. One per adventure. |
| `aiInstructions` | Yes | B | No | Optional separately inspectable scenario-specific contract. Not required when Narration Rules already contain the stable rules. Protected. One per adventure. |
| `plotEssentials` | Yes | C | Yes (append) | Overarching premise, long-term conflict, and persistent story-wide constraints. One-pass replacements always require review. |
| `currentArc` | Yes | C2 | Yes (append) | Running arc log. Requires `arcPremise` for auto-update. Graduate → Story Card when done. |
| `activePressure` | No* | C | Yes (replace) | One-sentence current external threat or obligation. Auto-updated, auto-approved by default. |
| `immediateMomentum` | No | — | No | Disabled legacy type. Not generated, auto-updated, or assembled into context. |
| `authorNote` | Yes | D (near-context) | No | Immediate narrative correction. One per adventure. Most powerful short-term tool. |
| `storyState` | Yes | S (turn context) | Yes (replace) | Authoritative current truth: day/time, location, relationships, arrangements, who has met whom, open threads. Protected, always included when non-empty. Rewritten in full by the background memory pass (`storyStateUpdate`, auto-approved by default); turn off Auto-update to freeze it. Added empty to older saves on load. |
| `memory` | No | — | No | **Legacy.** Migrate content to Story Cards (type: Lore). |
| `custom` | No | E (if always-on/pinned) | No | General purpose. Configure inclusion policy, priority, protection manually. |

*`activePressure` is treated as a singleton by defaults/normalization. `immediateMomentum` remains in the type system only for old-save compatibility.

### Current Story Arc — interaction notes:
- Requires `arcPremise` text — this is the LLM filter condition. No premise = no auto-updates fire.
- Auto-approval: `memoryAutoApprove.currentArcUpdate` (default `true`)
- "Complete Arc → Story Card" button: creates a `plot` type Story Card from the log, clears content and arcPremise
- Cooldown: 4 turns default (coarser than Active Pressure's 3)
- Difference from Plot Essentials: PE = overarching premise, long-term conflict, and persistent story-wide constraints. Arc = the active conflict's running log (accumulates as story unfolds, then gets retired)
- Difference from Quests: Arc tracks narrative shape, not task completion. No objective states. Graduated arc becomes referenced backstory via Story Card, not a "quest completed" flag.

### Arc Director (deterministic story pacing)

**Files:** `state/adventureReducer.ts`, `contextBuilder/contextBuilder.ts`, `state/turnPipeline.ts`, `pages/ComponentsPage.tsx` (`ArcDirector`). Concept: `docs/adventure-design.md`.

Optional pacing layer on a `currentArc` component that makes an antagonist's arc climb and *break* on its own. Configured via the Arc Director panel; all state lives on the component.

- **Config fields** (on `ComponentEntry`): `arcThreadKeys` (Story Card / Brain ids that are this arc's "baddie"), `arcPace` (`short`/`medium`/`long`/`epic`), `arcTriggerMode` (`auto` fires the break itself / `ask` surfaces a one-click prompt — the leash), `arcSimmerInstruction`, `arcBreakInstruction` (the cost policy).
- **Runtime state** (`arcState: ArcPacingState`): `phase` (`simmer → escalate → break → aftermath`), `tier` (0–5), `threadEngagement` (per-thread counts), `pendingBreak`, `brokeAtTurn`.
- **The gate:** `simmer`/`escalate` inject `arcSimmerInstruction`; `break` injects `arcBreakInstruction`. The break (cost) instruction is **withheld from context entirely until `phase === "break"`** — the model cannot land the climax early on something it never sees.
- **Driver:** after each turn, `turnPipeline` dispatches `ADVANCE_ARC_PACING` with the ids that triggered in-scene; the reducer increments `threadEngagement` for ids in `arcThreadKeys`, derives the tier, and advances the phase against the pace thresholds (`short` 4/8, `medium` 8/16, `long` 16/32, `epic` 30/60 for escalate/break). **Counted engagement only — never an LLM verdict.**
- **Break trigger:** at the break threshold, `auto` mode sets `phase = "break"`; `ask` mode sets `pendingBreak` and holds at `escalate` until a `SET_ARC_PHASE` confirm. Break settles to `aftermath` after `ARC_BREAK_DURATION` (6) turns. `SET_ARC_PHASE` also powers the manual "Spring it now" / "Resolve arc" / "Reset to simmer" buttons.
- **Principle:** code owns *timing*, the break card's text owns *outcome*, and a capable model (V3.2-class) owns whether the cost lands. See `AGENTS.md` → "Arc Director" for the invariants.

---

## 4. Story Cards

**Files:** `pages/StoryCardsPage.tsx`, `contextBuilder/contextBuilder.ts`, `triggers/semanticEngine.ts`, `memory/storyCardAudit.ts`

Types: `character`, `location`, `lore`, `plot`, `custom`

### Triggering:
- Card title is always added to its own key list
- Match types: `keyword` (anywhere in text), `phrase` (whole-word), `regex`
- Trigger text = recent N messages + current input + latest assistant output; the opening scene is also considered on turn 0
- Inclusion policies: `always`, `triggered`, `manual`, `systemSuggested`
- `forceIncludeNextTurn` overrides trigger matching for one turn

### AI-assisted creation:
- The Story Cards page accepts a freeform description of a character, place, faction, relationship, object, secret, or durable rule.
- The AI compares the description with existing Story Cards and character entries.
- The result is one or more pending `storyCard` Memory Proposals, never an immediate active-memory write.
- Native DeepSeek requests use JSON output with thinking disabled for this schema-driven call.
- **Related generators** (`ai/generators.ts`, user-initiated ✨ buttons): fresh content for Narration Rules / AI Instructions / Author's Note (preview → Apply), a full Arc Director setup from a one-line concept (premise + simmer + break + pace + trigger mode), and a character Brain from just a name (behavioral voice contract, not trait lists). All are grounded in a compact adventure snapshot. See `AGENTS.md` → "AI Generation Buttons".

### Auto-update:
- `autoUpdate: boolean` per card
- One card per evaluation cycle (first eligible)
- Per-card cooldown: `autoUpdateCooldownTurns`
- Global cooldown: `semanticEvaluationSettings.storyCardCooldownTurns`
- Condition: "when the story has established new details... about `{title}`"

### Audit (`runStoryCardAudit`):
Two passes:
1. **Deterministic**: redundancy (>50% word overlap), no keys, very short content, keys never appearing in recent context
2. **LLM pass**: semantic accuracy and gap detection on eligible cards

### Voice Contracts (best practice for character cards):
When writing character story cards, use this structure instead of trait lists:
```
Rhythm: [how they speak — pace, sentence structure]
Default move: [what they do under pressure]
Emotional defense: [how they deflect or armor up]
Never sounds like: [what to avoid — generic helpful, etc.]
Example lines: [2–3 direct quotes showing the voice]
```
This produces consistent character voice across all turns. Trait lists ("is sarcastic, loyal, brave") describe but don't demonstrate — the model flattens them.

---

## 5. Brain System

**Files:** `pages/BrainsPage.tsx`, `triggers/semanticEngine.ts`, `contextBuilder/contextBuilder.ts`

Brains track named character inner state as a keyed thought record. Primary update path is now **inline capture** (model emits `<thought>` tags during story generation — zero extra API calls).

### Key fields:
- `thoughts` — `Record<string, string>` — active thought log. Keys = `turnN_label`. Values = first-person thought text. Injected into context.
- `archivedThoughts` — thoughts set to `null` via patch (preserved, not shown in context)
- `linkedStoryCardId` — if set, brain LLM updates can include `storyCardNote` to propose card updates
- `updateCondition` — LLM condition string for semantic engine trigger
- `updateMode` — `replace` or `append`
- `condenseThreshold` — if total thoughts text exceeds this (default 1600 chars), auto-condense pass runs
- `printThoughts` — if true, extracted thoughts are appended visibly to story output in `[thought: ...]` format
- `anchorText` (character anchor) — immutable voice/behavioral defaults injected into brain update prompts to prevent personality drift

### Triggering for context inclusion:
Triggered by `characterName` or any string in `triggers`, matched against recent text (phrase match). Also respects `inclusionPolicy`, `pinned`, `protected`.

### Update paths:
1. **Background memory pass** — one evidenced thought per eligible character who took part in the recent turns, plus a knowledge boundary (`knowledge`: "Knows: … / Does not know: …", always replaced, never appended). Existing eligible Brains only, honoring `brainUpdate` auto-approval and cooldowns
2. **Semantic engine** (`updateBrain`/`appendBrain` actions) — still available via explicitly configured trigger rules
3. **Manual** — "Update Now" button in BrainsPage

---

## 6. Memory / Proposal System

**Files:** `pages/MemoryInboxPage.tsx`, `memory/memoryDetection.ts`, `memory/applyAIMemoryUpdate.ts`, `state/adventureReducer.ts`

All AI-generated content suggestions pass through Memory Proposals before becoming live canon (except auto-approved types).

### Proposal types:
| Type | Source | Auto-Approve Default | Apply Behavior |
|---|---|---|---|
| `storyCard` | Background memory pass, story card audit, "Remember This" | Off | Upsert story card; a living-card update with `replaces` supersedes that fact |
| `brainUpdate` | Background memory pass, semantic engine | Off | Apply BrainPatch (thoughts appended, `knowledge` replaced) |
| `storyStateUpdate` | Background memory pass | **On** | Replace Story State content (not kept in proposal history when auto-approved) |
| `plotEssentialsUpdate` | Semantic engine, "Suggest Updates" | Off | Append to PE component |
| `currentArcUpdate` | Semantic engine (updateComponentArc) | **On** | Append to arc component |
| `plotPressureUpdate` | Semantic engine (updateComponentPressure) | **On** | Replace activePressure content |
| `plotMomentumUpdate` | Legacy/disabled | Off | No-op |
| `summaryUpdate` | Semantic engine (summaryConditions) — deprecated | Off | Append to rollingSummary |
| `ignore` | Classification fallback | — | No-op |

Auto-approve settings: `adventure.memoryAutoApprove` — all togglable per adventure.

### Background memory pass validation and approval

One call returns up to 12 updates as JSON. Empty updates are normal. Local checks verify shape, length, evidence quoted from the pass window (every message since roughly the previous pass), target existence/eligibility, and duplicates. Existing cards receive additive facts; on living cards an update may name the fact it `replaces`, which is superseded in place (VOICE CONTRACT lines and static cards are never rewritten). At most one new recurring subject is proposed, and its triggers must be names or nouns — first-person recall phrases are dropped. New event recap cards are not generated. Arc updates append evidenced developments without changing authored pacing.

`ADD_MEMORY_PROPOSAL` honors the matching auto-approval flag unless `requiresReview` is true. Plot Essentials changes, plot cards, and protected-card updates always require review. The pass rules are fixed text placed before per-turn data so providers can cache them.

These checks prove local routing and call counts, not model accuracy or literary quality. Memory evidence matching cannot establish every inference. Actual dollar savings depend on provider usage and optional exceptional calls.

---

## 7. Semantic Evaluation Engine

**File:** `triggers/semanticEngine.ts`

Runs in background after each turn (async, doesn't block story).

### `runSemanticPostTurnEvaluation`:
- Evaluates all enabled `semantic` mode trigger rules
- Asks LLM: "which of these condition IDs are currently true?"
- Returns array of fired IDs
- Applies non-generated actions immediately (activate/deactivate/pin/force-include)
- Queues generated actions (brain/card/component updates) — run in parallel up to `maxParallelUpdateCalls`

### Legacy `runMemoryCycle` (not scheduled by normal play):
- Plot conditions are evaluated independently: Plot Essentials, Active Pressure, and Current Arc may all fire in one cycle. Pressure cannot consume the Plot Essentials slot.
- At most one eligible Story Card and one Brain update are selected per cycle; discovery separately proposes missing durable subjects.
- Generated output routes through Memory Inbox and honors per-type auto-approval settings.
- Plot Essentials and Active Pressure replacements and targeted Story Card rewrites pass size/format checks and a separate model-based evidence review before a proposal or direct write. Unchanged output is skipped. Invalid output leaves memory unchanged and records an evaluation error. Review calls use the background provider and count toward background token usage; they add one call per nonempty, changed candidate that passes format checks. This review is a model judgment, not a guarantee of factual accuracy.
- Plot Essentials replacements retain valid constraints, remove stale current state, and distinguish knowledge from belief, claims from facts, and plans from completed events. Removed text remains in component update history; removal alone never creates historical Story Cards.
- Story Card routing uses explicit target IDs, exact titles, or exact non-character trigger aliases. Shared vocabulary in content or source scenes does not establish identity. Character trigger keys are activation cues, not implicit identity aliases. Approval preserves the resolved destination. Cross-subject similarity deduplication excludes character cards.
- Existing saved content is not migrated or silently cleaned by these safeguards.

### Condition builders:
- Plot conditions: active Plot Essentials with auto-update enabled (or an unset legacy flag when memory detection is enabled), Current Arc with a premise, and Active Pressure.
- Story Card conditions: all eligible auto-update cards, respecting cooldowns; select only a meaningful durable change, not a scene recap or private interpretation.
- Brain conditions: existing active Brains matching the scene, respecting cooldowns.

### Cooldown tracking:
- Per-component: `lastAutoUpdateTurn` + `autoUpdateCooldownTurns`
- Per-card: `lastAutoUpdateTurn` + `autoUpdateCooldownTurns`
- Per-brain: `lastUpdatedTurn` + `autoUpdateCooldownTurns`
- Global story card: `storyCardCooldownTurns` (gap since any card was updated)

---

## 8. Trigger Rules

**Files:** `pages/TriggersPage.tsx`, `triggers/triggerEngine.ts`, `triggers/semanticEngine.ts`, `triggers/matching.ts`

Three evaluation modes on the same rule schema:

| Mode | When | Cost | How |
|---|---|---|---|
| `keyword` | Synchronous, every turn | Zero | Pattern list matched against input/output text |
| `regex` | Synchronous, every turn | Zero | Regex list matched against input/output text |
| `semantic` | Async, post-turn | LLM call | Natural-language `condition` string evaluated by LLM |

### Available trigger actions:
- Activate/deactivate/pin/unpin: component, story card, brain
- Update: component (patch), story card (patch), brain (replace/append), brain state (field + text)
- `updateComponentPressure`, `updateComponentArc` — generate new content via LLM
- `updateComponentMomentum` — disabled legacy action; no runtime effect
- `updateSummary` — generate rolling summary addition via LLM
- `forceIncludeNextTurn` — force component/card/brain into next context regardless of triggers

### State flags:
Runtime `stateFlags: Record<string, string | number | boolean>` — set/read via `SET_STATE_FLAG` action. Trigger conditions can check `stateFlag` field. Editable in Automations page.

---

## 9. Continuity Systems

### Continuity Challenge
**Files:** `hooks/useAdventureRuntime.ts`, `contextBuilder/contextBuilder.ts`

When player input matches any challenge phrase ("I don't remember that", "that didn't happen", "you're making that up", etc.), `SET_CHALLENGE_MODE` is dispatched. On the very next turn, a protected `[CONTINUITY CHALLENGE]` instruction is injected at section M, telling the model to verify and retract unsupported claims. Clears automatically on `INCREMENT_TURN`.

### Continuity Lint
**File:** `continuityLint.ts`

Post-generation correction. `scanForRiskyClaims()` checks every assistant response for risky patterns (promises, quotes, relationship changes, deadlines, presence claims). If any match, `runContinuityCheck()` sends last 8 messages + response to the background LLM and asks it to rewrite only the unsupported sentences. Result replaces `response.content` before it's stored. Runs every turn in non-comms mode if a background provider is available.

---

## 10. System Triggers (Inline Memory Tagging)

**Files:** `contextBuilder/contextBuilder.ts`, `state/turnPipeline.ts`, `pages/TriggersPage.tsx`

Per-adventure toggle system (`adventure.systemTriggers`). When enabled, the context builder injects a `[MEMORY TAGGING]` instruction into the system prompt asking the model to emit one `<memory>` self-closing XML tag per turn for any new subjects. Five opt-out categories: `relationship`, `world_fact`, `character_reveal`, `plot_beat`, `status_change`.

Tags are extracted from the response by `extractInlineThoughts()` and turned into `MemoryProposal` objects (type: `storyCard`) in the turn pipeline. Zero extra API calls — piggybacks on story generation.

---

## 11. Next Turn Note

**Field:** `adventure.activeState.nextTurnNote`

A single-turn directive injected at section J (just before recent messages). Settings: `active`, `pinned`, `protected`, `priority`, `expiresAfterUse`. When `expiresAfterUse: true`, consumed by `CONSUME_NEXT_TURN_NOTE` after the turn runs. Editable in Play page quick-access panel and in Settings.

Best use: steering the next response without polluting the Author's Note permanently. "End this scene at the threshold — don't narrate the arrival."

---

## 12. "Remember This"

**Files:** `hooks/useAdventureRuntime.ts`, `triggers/semanticEngine.ts` (`runRememberThis`)

Play page shortcut. Player types a fact → LLM routes it to the most appropriate memory destination (new story card, update existing card, etc.) → result goes to Memory Inbox as a pending proposal. Does not auto-approve. Useful for capturing things the AI said that should become permanent canon.

---

## 13. Force-Include Next Turn

**Type:** `ForceIncludeEntry` in `activeState.forceIncludeNextTurn`

Stores `targetType` (component/storyCard/brain), `targetId`, `expiresTurn`. Context builder checks this list — forced items are included regardless of trigger matching or inclusion policy. `INCREMENT_TURN` prunes expired entries. Set via trigger rule action `forceIncludeNextTurn`. Used for "make sure this card loads on the next turn regardless."

---

## 14. Provider Presets and Background Config

**Files:** `pages/SettingsPage.tsx`, `hooks/useAdventureRuntime.ts`

### Provider Presets:
Multiple named presets stored in localStorage. Each: label, base URL, API key (localStorage only, never in adventure JSON), model, temperature, max output tokens, prompt caching/sticky-session preference, optional OpenRouter routing sort, and optional request throttle (enabled, min seconds between requests, max per minute).

### Background Provider Config:
`SemanticEvaluationSettings.backgroundProviderConfig` — when set, separate background LLM calls (custom semantic rules, manual memory updates, continuity lint) route through this provider. Primary pattern: fast/cheap model (e.g., Groq llama) for background, powerful model for story generation.

---

## 15. GitHub Saves and Cloud Sync

### GitHub Save Slots (`sync/githubSaves.ts`):
Per-adventure named snapshots stored as individual JSON files in a GitHub repo. Auto-save per adventure (every N turns and/or every N minutes). Save slots show: title, type (manual/auto), turn count, timestamp. Load creates conflict dialog if local adventure is newer.

### Cloud Sync (`sync/githubSync.ts`):
Syncs all local adventures as a single JSON blob to a GitHub repo (owner/repo/branch/path configurable). Push/pull operations with merge-by-updatedAt. Conflict dialog on load if versions diverge. Separate from save slots — this is a sync mechanism, save slots are snapshots.

---

## 16. Story Undo/Redo

**Field:** `activeState.storyUndoStack`, `activeState.storyRedoStack`

`StoryEditHistoryEntry` stores undo/redo patches for: `insertMessage`, `deleteMessage`, `updateMessage`, `updateOpeningScene`. Stack maintained by reducer on message mutations. Play page exposes Undo/Redo buttons. 100-entry limit.

---

## 17. Context Preview and Dedup Tools

**Files:** `pages/ContextPreviewPage.tsx`, `ai/contextAI.ts`

### Context Preview:
Shows every section, item, token estimate, inclusion reason, protection/pin status, excluded items, pending proposals, raw provider payload JSON, and decision log. "Condense" button calls `runCondenseContent` (LLM shortens a single item with a budget target). Duplicate warning badge (>50% word overlap between two items).

### Auto Dedup (`runContextDedup`):
LLM-based pass over all context items. Identifies overlapping content, proposes trimmed versions. Shows diff-like preview per item with Approve/Reject. Applies approved trims as `UPDATE_COMPONENT`, `UPDATE_STORY_CARD`, or `UPDATE_BRAIN` actions.

---

## 18. Rolling Summary and Scene State (Deprecated as Context Sections)

**File:** `state/rollingSummary.ts`

Data fields (`rollingSummary`, `sceneState`) preserved on the Adventure object for backwards-compatible save loading. As of current version, **neither section is injected into context**. The Summary tab has been removed from the editor UI. The LLM calls that generated these (`buildRollingSummaryPayload`, `buildSceneStatePayload`) are no longer invoked.

If you have legacy adventures with summary content, that content remains in the save file but is no longer sent to the model. The Current Story Arc component is the replacement for active narrative tracking.

---

## 19. Removed / Deprecated Systems

| System | Status | Notes |
|---|---|---|
| Quest system | **Removed** | Types kept for save compat (`questDefinitionUpdate` stub in applyAIMemoryUpdate). `quests/questEngine.ts` is an empty stub. No UI. |
| Auto-cards | **Removed** | `autoCards/autoCardEngine.ts` empty stub. Entity detection stub present but unused. |
| `memory` component type | **Legacy** | Still creatable; labeled "Lore Block (legacy)". No special behavior. Content should be migrated to triggered Story Cards. |
| Rolling Summary context injection | **Removed** | Data preserved in saves. No longer in context. `summaryEnabled` setting has no effect. |
| Scene State context injection | **Removed** | Data preserved in saves. No longer in context. `sceneStateEnabled` setting has no effect. |
| Summary editor tab | **Removed** | Page file exists (`SummaryPage.tsx`) but is no longer imported or accessible. |

---

## 20. Implementation Status Summary

| Feature | Status |
|---|---|
| Turn pipeline | ✅ Complete |
| Context builder (all sections) | ✅ Complete |
| Adventure reducer (all actions) | ✅ Complete |
| Story undo/redo | ✅ Complete |
| Provider presets + throttle | ✅ Complete |
| Background provider config | ✅ Complete |
| Semantic evaluation engine | ✅ Complete |
| Memory cycle (periodic) | ✅ Complete |
| Brain system (inline capture, condense, anchor) | ✅ Complete |
| Story cards (trigger, auto-update, audit) | ✅ Complete |
| Voice Contracts (documentation/convention) | ✅ Complete |
| All 9 component types | ✅ Complete |
| Current Story Arc + graduation | ✅ Complete |
| Active Pressure | ✅ Complete |
| Immediate Momentum | ⚠️ Disabled legacy type |
| Memory proposals / inbox | ✅ Complete |
| Memory detection (post-turn background) | ✅ Complete |
| Inline memory tagging (systemTriggers) | ✅ Complete |
| Apply AI memory update | ✅ Complete |
| Story card audit | ✅ Complete |
| Continuity Challenge | ✅ Complete |
| Continuity Lint | ✅ Complete |
| Trigger rules (keyword/regex/semantic) | ✅ Complete |
| All trigger actions | ✅ Complete |
| Force-include next turn | ✅ Complete |
| Next Turn Note | ✅ Complete |
| Remember This | ✅ Complete |
| Context condense + dedup | ✅ Complete |
| State flags (runtime KV store) | ✅ Complete |
| Response length hint (slider) | ✅ Complete |
| Background token usage tracking | ✅ Complete |
| AI adventure generation (from premise) | ✅ Complete |
| AID import | ✅ Complete |
| Cloud Sync (GitHub blob) | ✅ Complete |
| GitHub Save Slots | ✅ Complete |
| Rolling Summary (data field) | ⚠️ Preserved for save compat — not in context |
| Scene State (data field) | ⚠️ Preserved for save compat — not in context |
| Quest engine | ❌ Removed (empty stub) |
| Auto-cards | ❌ Removed (empty stub) |
| `memory` component type | ⚠️ Legacy — still functional, no special behavior |

---

## 21. Key Interactions Between Systems

```
Player input
    → challengeMode detection (useAdventureRuntime)
    → keyword/regex triggers (synchronous, turnPipeline)
    → contextBuilder (assembles sections A–M)
        ← narrationRules, aiInstructions, plotEssentials
        ← currentArc (with arcPremise header)
        ← activePressure
        ← triggered story cards (phrase/keyword/regex match)
        ← triggered brains (character name match)
        ← authorNote
        ← nextTurnNote (if active)
        ← challengeMode instruction (if SET_CHALLENGE_MODE was dispatched)
        ← [ONE-PASS MEMORY] instruction (if automatic memory enabled)
    → LLM call (story provider)
    → parseOnePassMemory (strip tail, preserve visible story)
        → local evidence/target/dedup checks
        → approved thoughts and typed MemoryProposal candidates
    → continuityLint (scanForRiskyClaims → runContinuityCheck if matched)
    → ADD_MESSAGE (cleaned response)
    → keyword/regex triggers (output event)
    → INCREMENT_TURN
    → [BACKGROUND, async]
        → runSemanticPostTurnEvaluation
            ← semantic trigger rules (condition strings)
            → generatedActionsFor
                → brain updates → ADD_MEMORY_PROPOSAL (brainUpdate)
                → card updates → ADD_MEMORY_PROPOSAL (storyCard)
                → PE updates → ADD_MEMORY_PROPOSAL (plotEssentialsUpdate)
                → arc updates → ADD_MEMORY_PROPOSAL (currentArcUpdate) [auto-approved]
                → pressure updates → ADD_MEMORY_PROPOSAL [auto-approved]
        → arc continuation after aftermath (exceptional)

ADD_MEMORY_PROPOSAL
    → if memoryAutoApprove[proposedType] === true and !requiresReview
        → applyApprovedMemoryProposal immediately (never enters inbox)
    → else → enters memoryProposals[] as pending
        → user approves → applyApprovedMemoryProposal
```

### Graduate Arc flow:
```
currentArc component (arcLog + arcPremise)
    → "Complete Arc → Story Card" button
    → UPSERT_STORY_CARD (type: plot, content: arcLog, title: arcPremise)
    → UPDATE_COMPONENT (clear content + arcPremise)
    → Story Card enters triggered pool (referenced when keywords match)
```

---

*Last updated: 2026-06-04*


## Event Memory Story Cards

Event Memory (`type: event`) is a historical Story Card category for notable completed experiences: first meetings, commitments, revelations, consequential choices, and distinctive shared experiences. Background discovery proposes them even when the participants already have cards or Brains. Suggestions retain exact Chronicle message IDs, participant names, recall cues, and a reason for keeping the event. Event suggestions always await approval; historical records are not rewritten by automated updates. Users can edit, deactivate, pin, or delete them in Story Cards. Existing historical cards keep their original categories.

Recall uses phrase matches and participant-assisted cue word overlap, with up to three automatically recalled Event Memories per context build, subject to existing context budgets. A participant name alone does not trigger their history. Pinned, always-on, and manually forced cards retain their explicit inclusion controls. Context Preview shows each included card and its recall reason. This is bounded cue retrieval, not embedding-based semantic search.

Memory Suggestions offers “Find event memories in earlier play”: an explicit background-model scan of the Chronicle in overlapping 24-message excerpts, stepping by 20 messages. It displays progress, preserves completed suggestions on failure/cancellation, and stops after the current request when cancelled. Each excerpt uses one provider request. No scan runs automatically on import. Source evidence can be inspected on approved Event Memory cards; unavailable source messages are identified rather than fabricated.
