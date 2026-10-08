# Advanced Settings Reference

Settings → Advanced unlocks four panels. All settings are per-adventure and saved in the adventure JSON.

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

Controls the semantic engine — the background AI that reads your story after each turn and fires Automations such as brain updates, story card updates, Plot Essentials updates, Current Arc updates, and one-sentence Active Pressure updates.

### Evaluation Model Override

By default the semantic engine uses the same model as your main provider. Enter a model name here to use a different one for all background evaluation calls. Leave blank to inherit from the active preset.

### Messages Included In Evaluation

How many recent messages the evaluator reads. More messages = more context for accurate decisions, more tokens per background call. 5–10 is usually sufficient; the evaluator doesn't need the full history.

### Enable semantic triggers

Master switch for all Automations. Must be on for brain updates, story card updates, Plot Essentials tracking, Current Arc tracking, and Active Pressure updates to fire automatically after each turn.

### Show evaluation log on Automations page

Turns on a debug log showing what the evaluator saw and decided. Useful for diagnosing why an Automation isn't firing. Leave off in normal use.

### Max Parallel Update Calls

When multiple Automations trigger on the same turn, how many update LLM calls run simultaneously. Default 3. Higher is faster but increases peak API load.

### Require approval before applying auto-updates

When on, all AI-generated Automation updates (brain updates, plot essentials, etc.) go to Memory Suggestions for your review instead of applying directly. Recommended if you're protective of brain or plot essentials data.

### Background Provider

Route background tasks (evaluation, brain updates, story card updates, Plot Essentials/Current Arc/Active Pressure updates, and memory detection) through a separate provider endpoint. Leave blank to use your main preset for everything.

Useful if you have a fast/cheap API (e.g., Groq + Llama 3.3 70B) for background work and a better model for story generation. The model field here overrides the evaluation model override above.

---

## Auto-Cards

Auto-Cards are a removed legacy surface. Use Memory Detection or the Story Cards page to create new Story Card proposals instead.

### Enable Auto-Cards

Legacy setting if present in old saves. It has no active product behavior.

### Detection Condition

Legacy field retained only for old data.

Example: `"A new named character appears who doesn't have a story card yet."`

### Generation Prompt

Legacy field retained only for old data.

Example: `"Write a concise story card for the new character: appearance, role, and personality in 2–3 sentences."`

### Cooldown Between Generations (turns)

Legacy field retained only for old data.

---

## Memory Detection

After each turn, a separate AI call reads the assistant's response and asks: "Is there a new durable fact here worth storing?" If yes, it creates a proposal in Memory Suggestions.

A novelty pre-filter runs first — it checks for new proper nouns not already in your card keys or brain names, and skips the AI call if nothing novel is detected. The actual extra-call rate is lower than one-per-turn in practice.

### Enable AI memory detection

Master switch. Off by default. When on, costs one additional API call per turn (filtered by the novelty pre-filter). Uses the background provider if configured.

### Generate card content

When **on**: the AI writes the full proposal body (title + content + triggers) in the same detection call. More useful, costs more tokens.

When **off**: the AI only identifies *what* to store (title and type), leaving the body blank for you to fill in. Useful if you prefer to write card content yourself and just want the AI to flag *that* something is noteworthy.

### Auto-approve brain state updates

Brain state (Brains panel — character mental state) is typically lower-stakes than story cards. When on, brain update proposals skip your inbox and apply directly. Story cards and plot essentials still go to Memory Suggestions for review.
