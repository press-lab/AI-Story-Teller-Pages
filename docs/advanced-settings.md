# Advanced Settings Reference

> **Status:** Guide (user-facing reference) · **Audience:** players · **Verified against:** `e768262`

Settings has one always-visible memory panel, **Automatic memory**. Settings → Advanced adds three more: **Context Budget**, **LLM Evaluation**, and **Memory Detection**. Context budget and auto-approve choices are per adventure and saved in the adventure JSON. Automatic memory on/off and its cadence are app-wide.

---

## Automatic memory (always visible)

The narrator only writes the story. Every N story turns, one background call reads the turns since the last update and suggests updates to Story State, character thoughts and knowledge boundaries, Story Cards, and plot surfaces (Active Pressure, Current Arc, Plot Essentials). It uses the Background Provider when one is set. Out-of-character turns never trigger it.

### Automatic memory

Master switch for the background memory pass. On by default.

### Update memory every N story turns

How often the pass runs. The default is **3** (one background call every three story turns). 1 gives the freshest memory at one extra call per turn; higher values cost less but memory lags further behind. At any N, each pass reads every message since the previous one, plus two for continuity, so no turns are skipped. The only limit is a catch-up ceiling of 60 messages (or 2N + 2, if larger) after automatic memory has been off for a while. A value already saved in your browser is kept, including the old default of 1, so check this field if you want 3. A failed pass waits for the next scheduled turn instead of retrying.

---

## Context Budget

Controls how much information gets sent to the model each turn and what gets dropped when you're over the limit.

### Presets

| Preset | Max Tokens | Max Messages |
|--------|-----------|--------------|
| Light  | 8 000     | 15           |
| Normal | 16 000    | 40           |
| Heavy  | 32 000    | 80           |

Use Light if you're hitting the model's actual context window. Use Heavy for maximum history at the cost of per-turn latency and cost.

### Max Context Tokens

Hard ceiling on total tokens sent per turn. Set it ~1–2k below your model's actual window to leave room for the response. When the context builder exceeds this, it starts dropping items using the memory priority mode logic (see below).

### Max Recent Messages

How many recent chat turns to keep verbatim in the context. Beyond this cap, older turns are not sent verbatim; preserve important facts through Story Cards, Brains, Plot Essentials, Current Arc, or Active Pressure instead. 40 is the balanced default; if your turns are long, 20–25 avoids crowding out story cards and components.

### Memory Priority Mode

Controls the *order* things get dropped when the context is over budget.

**`userLocked` (default):** Drops oldest messages first, then drops lowest-priority unpinned story cards, then lowest-priority unpinned items overall. Your manually set priorities are fully respected.

**`systemSuggested`:** Scores every context item by priority + inclusion policy + section type. Drops the lowest-scoring item regardless of type. More aggressively optimized, less predictable.

**`hybrid`:** Tries to drop `systemSuggested`-tagged items first; falls back to `userLocked` behavior. Middle ground.

Recommendation: keep `userLocked` if you've hand-tuned card priorities.

### Trigger Recent Message Window

How many recent messages are scanned for story card trigger keywords. Widening it makes more cards fire more often; narrowing it restricts trigger matching to what's happening right now. If a location card keeps firing after you've left that location, reduce this number.

### Allow system to prioritize memory

Only has an effect in `systemSuggested` or `hybrid` modes.
- `systemSuggested`: enables dropping the lowest-scored item from anywhere in context (ignoring type boundaries).
- `hybrid`: enables dropping `systemSuggested`-policy items before `userLocked` ones.
- `userLocked`: **this checkbox does nothing**.

### Allow system to drop unpinned triggered cards

When over budget, lets the system drop triggered story cards that aren't pinned. Pinned cards are never dropped by this path. Safe to enable if you have many cards and regularly hit the budget.

### Allow system to truncate rolling summary

Legacy setting. Rolling Summary is retained in saves but is not assembled into the default model context, so this has no effect on the current provider payload.

### Auto-summarize in background

Legacy setting. Rolling Summary content can still be retained in adventure data, but it is not sent to the model by default and should not be relied on for active context.

### Auto-summarize every N turns

Legacy setting for old summary workflows.

### Section Budgets JSON

Per-section hard token caps. Expert setting. Lets you constrain a specific section (e.g., story cards) so it can never crowd out others. Touch only if you see a specific section dominating context at the expense of everything else.

---

## LLM Evaluation

Controls the **semantic engine**, which evaluates the natural-language conditions on trigger rules you configure yourself (Automation page). It does not run the automatic memory pass above. If you have no semantic trigger rules, it makes no calls.

### Evaluation Model Override

Model used for semantic evaluation calls. Leave blank to inherit from the active preset.

### Messages Included In Evaluation

How many recent messages the evaluator reads. 5–10 is usually enough.

### Semantic eval every N turns

0 disables semantic evaluation, 1 runs it every turn. Only matters when semantic trigger rules exist.

### Enable semantic triggers

Master switch for semantic trigger rules. Keyword and regex rules run regardless.

### Show evaluation log on Automations page

Debug log of what the evaluator saw and decided. Leave off in normal use.

### Max Parallel Update Calls

When several semantic rules fire on the same turn, how many generated-update calls run at once. Default 3.

### Review updates from custom semantic rules

When on, updates produced by your semantic rules go to Memory Suggestions instead of applying directly. The automatic memory pass ignores this switch and uses the per-type auto-approve toggles instead.

### Background Provider

Routes background work — the automatic memory pass, semantic evaluation, manual memory updates, and continuity checks — through a separate endpoint. Leave blank to use the active preset for everything. Typical pattern: a cheap, fast model for background work and a stronger model for the story. An invalid base URL is ignored with a visible warning and background calls fall back to the active provider.

---

## Memory Detection (auto-approve)

Repeats the Automatic memory switch and holds the per-type **auto-approve** toggles: Legacy Summary, Plot Essentials, Active Pressure, Current Arc, Arc Proposals, Story Cards, Characters, and Story State. The same toggles appear under Memory Suggestions → Rules & auto-approve.

- A type that is auto-approved applies as soon as it is suggested. Anything else waits in Memory Suggestions.
- **Story State** is off by default: each rewrite waits for review, and a newer suggestion replaces an older pending one, so there is at most one to review. To stop suggestions entirely, turn off "Background memory pass suggests Story State updates" on the Story State block (Plot page).
- Plot Essentials changes, plot cards, and protected-card changes always require review, whatever the toggles say.

---

## Removed: Auto-Cards

Auto-Cards were removed. Old saves may still carry Auto-Card fields; they have no effect. New Story Cards come from the automatic memory pass (only in the categories enabled under Automation → System triggers), the Story Cards page's AI-assisted creation, or Remember This.
