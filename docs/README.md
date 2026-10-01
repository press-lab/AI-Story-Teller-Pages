# Documentation Index

> **Status:** Canonical (doc map) · **Verified against:** `e768262`

Start with the three root docs. Everything in `docs/` carries a status line at the top.

| Status | Meaning |
|---|---|
| **Canonical** | Describes current behavior or rules. Wins conflicts. |
| **Guide** | How to use or author with the app. Should match current behavior. |
| **History** | Why something changed, written at the time. Parts may be superseded; the status line says which. |
| **Proposal** | Designs that are not built. The app has no backend. |
| **Reference** | External or personal context (AI Dungeon, community guides, taste profile). Not app behavior. |

## Root

| File | Status | Audience | What it is |
|---|---|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Canonical | Contributors, agents | Rules, invariants, finish workflow. Wins any conflict. |
| [`../FEATURES.md`](../FEATURES.md) | Canonical | Contributors, agents | How every system behaves: turn loop, context order, memory, proposals. |
| [`../README.md`](../README.md) | Canonical | Everyone | Setup, deploy, short overview. |
| [`../.claude/agents/aist-workspace.md`](../.claude/agents/aist-workspace.md) | Canonical | Agents | Pages vs Saves repo routing and save-file mechanics. |
| `../src/pages/HelpPage.tsx` | Canonical | Players | In-app Documentation page. Must agree with `FEATURES.md`. |

## docs/

| File | Status | Audience | What it is |
|---|---|---|---|
| [`advanced-settings.md`](./advanced-settings.md) | Guide | Players | Every Settings panel, including Automatic memory and auto-approve. |
| [`building-a-scenario.md`](./building-a-scenario.md) | Guide | Scenario authors | Step-by-step recipe for a long-running adventure. |
| [`adventure-design.md`](./adventure-design.md) | Guide | Authors, contributors | Design theory behind arcs, Brains, and the Arc Director. |
| [`edit-surface-ui-treatment.md`](./edit-surface-ui-treatment.md) | Guide | Contributors | UI conventions for edit pages. |
| [`story-quality-continuity-strategy.md`](./story-quality-continuity-strategy.md) | Proposal | Seth, contributors | Revised quality-first design: narrative context, memory semantics, pacing, evaluation, and API cost. |
| [`memory-cost-quality.md`](./memory-cost-quality.md) | History | Contributors | The 2026-09-30 background-memory redesign (current), plus legacy memory-cycle notes. |
| [`memory-automation-playthrough-context.md`](./memory-automation-playthrough-context.md) | History | Contributors | July 2026 compact-card policy; auto-pinning superseded. |
| [`memory-reconcile-automation-context.md`](./memory-reconcile-automation-context.md) | History | Contributors | Check Recent Entries and persistence sanitization. |
| [`memory-update-quality.md`](./memory-update-quality.md) | History | Contributors | Legacy memory-cycle validation rules. |
| [`deepseek-provider-context.md`](./deepseek-provider-context.md) | History | Contributors | DeepSeek thinking-toggle incident; the wire-format rule still holds. |
| [`backend-architecture.md`](./backend-architecture.md) | Proposal | Architects | Canonical backend design, with known gaps and open issues. |
| [`backend-implementation-plan.md`](./backend-implementation-plan.md) | Proposal | Architects | Phased plan for the backend. |
| [`production-architecture-context.md`](./production-architecture-context.md) | Proposal | Architects | Companion to backend-architecture; that doc wins conflicts. |
| [`aid-best-practices.md`](./aid-best-practices.md) | Reference | Agents | Building AI Dungeon scenario packs. |
| [`better-repository-context.md`](./better-repository-context.md) | Reference | Authors, agents | Notes from BetterRepository community guides. |
| [`user-taste-profile.md`](./user-taste-profile.md) | Reference | Agents | Seth's scenario taste profile. |

## Glossary: UI label ↔ code name

The UI was renamed; much of the code and older docs still use the original names.

| UI label | Code / older docs |
|---|---|
| Plot (tab) | `components` tab, `ComponentsPage`, "World Blocks" |
| Characters | Brains, `BrainEntry`, `brains` |
| Memory, Memory Suggestions | Memory Inbox, `memoryInbox`, `activeState.memoryProposals` |
| Automation | Triggers, `TriggersPage`, `triggerRules` |
| Context | Context Preview, `ContextPreviewPage` |
| Saves | `cloudSaves`, GitHub save slots |
| Automatic memory | `memoryDetectionSettings`, background memory pass, `runBackgroundMemoryPass` |
| System memory triggers | `systemTriggers` (new-card categories for the memory pass) |
| Next Output Bias | `activeState.nextTurnNote`, Next Turn Note |
| Out-of-character / comms turn | `mode: "comms"`, `outOfCharacter: true` |
| Background memory pass suggests Story State updates | `storyState` component `autoUpdate` |

## Keeping docs current

- Behavior changes update `FEATURES.md`, `AGENTS.md`, `README.md`, and the Help page in the same commit (see the finish workflow in `AGENTS.md`).
- When a doc is re-checked against code, update its `Verified against` commit.
- New incident or design notes go in `docs/` with a status line. Mark superseded parts instead of silently rewriting history.
