# Memory Reconcile Automation Context

Authoring reference: [Fact ownership and overlap audit](./fact-ownership.md).

This note captures the July 2026 update prompted by the Arcane play save where resolved plot threads, especially Ambessa and broad Jinx-collaboration pressure, kept reappearing because active memory surfaces still described them as live.

## Problem

The save audit showed that auto-approval was not the core issue. The issue was stale active context:

- Plot Essentials, Story Cards, and Brains could still contain resolved facts as current concerns.
- Existing "Clean Up Cards" and "Clean Up Components" could fall back to deterministic recommendations when the AI pass failed, which made provider/config problems too easy to miss.
- Background provider settings could include a malformed base URL and an API-key value in exported/persisted adventure JSON.
- Manual AI update tools updated broad surfaces, but they did not provide a targeted "these recent entries changed the status of X; update everything related to X" workflow.

## Implemented Behavior

The Memory page now includes **Check Recent Entries**:

- The user supplies an entry count and may optionally add a directive.
- Code deterministically scans the selected recent entries, plus the optional directive when present, for related Plot Essentials, Current Arc, Story Cards, and optionally Brains.
- The deterministic target list is fixed before the AI call. The AI may generate replacement/update content only for those targets.
- Resolved/removal wording applies deterministic patches such as unpinning, unprotecting, changing compact status to `resolved` or `superseded`, or deactivating removal targets.
- The generated changes become normal Memory Suggestions. They are applied only through reducer approval/auto-approval behavior.

This keeps targeting deterministic while using AI for proposed content. It does not search every possible duplicate or enforce unique ownership. Current Story Arc proposals still append developments; they are not replacement rewrites. Review the final live state and use existing editing controls to retire misleading assertions while preserving useful history. Enrolled relationships are not reconciled by this tool; edit/review their designated state separately. Durable psychology remains on cards, event-specific responses in Brains. Apply the ownership reference's reconciliation steps and overlap audit.

## Safety And Persistence Fixes

- `sanitizeAdventureForPersistence` strips runtime API keys from both the main provider config and semantic background provider config before IndexedDB saves and JSON exports.
- Background provider resolution ignores invalid base URLs and logs a visible warning; background tasks fall back to the active provider instead of trying to call `baseUrl: "1"`.
- Story Card and Component cleanup tools now surface AI-pass failures instead of silently hiding them behind deterministic fallback results.
- Memory proposals can now carry reviewable `storyCardPatch` and `componentPatch` metadata so cleanup can change active/pinned/protected/status fields through the same proposal path as content.

## Important Files

- `src/triggers/semanticEngine.ts`: `runMemoryReconcile`, deterministic target discovery, AI content generation, and provider warning handling.
- `src/pages/MemoryInboxPage.tsx`: Check Recent Entries UI and patch visibility/editing.
- `src/hooks/useAdventureRuntime.ts`: runtime wiring for reconcile requests.
- `src/state/adventureReducer.ts`: proposal patch application and duplicate filtering that preserves cleanup-only patches.
- `src/providers/backgroundProvider.ts`: background provider validation and fallback.
- `src/state/defaults.ts`, `src/db/adventureDb.ts`, `src/utils/json.ts`: persistence/export sanitization.
- `src/memory/storyCardAudit.ts`, `src/memory/componentAudit.ts`: cleanup failure surfacing.
- `src/triggers/semanticEngine.test.ts`, `src/security/apiKeyLeak.test.ts`: regression coverage.

## Usage Notes

Use this when the player says something like:

> Ambessa is defeated and no longer a threat. The Council accepts my work with Jinx on the filter. Caitlyn can still be angry personally about Jinx.

Set the entry count to the relevant recent window, usually 10-30 entries, and run Check Recent Entries. The "What changed?" field is optional; leave it blank to infer updates from the selected recent entries alone, or use it to steer cleanup toward a specific resolved/removed thread. Review the Memory Suggestions that appear. If Story Card or Plot auto-approval is enabled, those proposal types may apply immediately, with normal proposal recording for durable memory.
