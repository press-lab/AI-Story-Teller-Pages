# Memory Automation Playthrough Context

This note captures the Arcane playthrough audit from the `Arcane-After-the-Rocket(2).json` export and the deterministic memory changes made afterward.

## Playthrough Diagnosis

The memory automation was detecting important beats, but it was not reliably keeping the right facts active in prompt context.

The clearest failure involved Seth's private pact with Jinx and Mel's political shield:

- Seth and Jinx made a conditional pact: Jinx stops killing except for self-protection, rebuilds from the shadows, avoids Caitlyn and Piltover authorities, and tries to repent.
- Seth gives Jinx protection, visits, mentorship, a safe outlet, and a rune-etched coin to summon him.
- Mel gives Seth an official cover story for time spent in Zaun, redirects Caitlyn where possible, and keeps Seth on the Council because his presence is part of the shield around the Jinx situation.

The save did contain these facts. The problem was active-context retention:

- The foundational pact and Mel shield facts were pushed into `archivedFacts`.
- `archivedFacts` are saved for provenance but are not sent to the model.
- Later updates on the same living card focused on newer device/filter/political-pressure facts.
- Some related facts were routed into awkward cards such as event/location cards before a proper compact card existed.
- A duplicate pact card appeared later with a thinner, less accurate summary.
- The main pact card was triggered/low-priority instead of pinned/protected, so ordinary Jinx scenes could miss it.

The result was a good saved audit trail but weak playable continuity.

## Design Rule

The AI may notice and phrase memory, but code owns memory shape.

Deterministic code should manage:

- whether a proposal updates an existing card instead of creating a duplicate;
- whether an update is a living current-state update, historical event, or static reference;
- whether a card is pinned/protected/priority-raised;
- which facts can be archived out of active context;
- whether old saved-but-inactive facts should be restored to active content during migration.

The AI should only assist with semantic judgment and prose:

- identifying that a beat is durable;
- summarizing messy story turns;
- suggesting a likely target;
- phrasing the update.

## Implemented Solution

The implementation adds deterministic compact Story Card policy for compact-style memory: pacts, deals, promises, oaths, truce terms, secret alliances, official cover stories, political shields, debts, obligations, accomplice/fugitive arrangements, and similar ongoing constraints.

Compact cards now get these protections when created or updated through memory automation:

- pinned;
- priority raised to at least 80;
- token budget raised to 450 tokens if the user has not set an explicit card budget;
- state tagged with `guardedMemory`;
- `compactKind` and `compactStatus` fields;
- `coreFacts`, `currentFacts`, `recentDevelopments`, and `sourceTurnIds`;
- guarded archived facts restored into structured compact fields during old-save normalization;
- compact context rendered from structured fields instead of raw card text.

`protected` is not set automatically. Protected remains a user control for truly non-droppable context.

The reducer still allows ordinary living cards to behave like bounded event feeds. Only compact/promise/cover-style memory gets the stronger treatment.

## Important Files

- `src/memory/storyCardPolicy.ts`: deterministic compact-memory detection, field promotion, and context rendering.
- `src/memory/resolveMemoryTarget.ts`: exact-title compact routing even when the AI drifts on memory mode.
- `src/state/adventureReducer.ts`: compact append/replace behavior and memory proposal application.
- `src/state/defaults.ts`: old-save normalization and one-time compact field migration.
- `src/contextBuilder/contextBuilder.ts`: compact Story Card context rendering.
- `src/pages/StoryCardsPage.tsx`: visible compact kind/status/core/current/recent/source fields.
- `src/state/adventureReducer.test.ts`: reducer coverage for compact cards and ordinary living-card pruning.
- `src/memory/resolveMemoryTarget.test.ts`: routing coverage for exact-title compact updates.
- `src/state/defaults.test.ts`: old-save migration coverage.

## Future Guidance

When reviewing memory automation, check both persistence and prompt availability. A fact can be saved and still functionally forgotten if it lives only in `archivedFacts`, stale Brain thoughts, rejected proposals, or a triggered card that does not fire.

For relationship contracts and political compacts, do not rely on "oldest fact archives first." The oldest facts are often the foundation.
