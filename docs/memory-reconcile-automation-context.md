# Memory Reconcile Automation Context

> **Status:** History (July 2026) · **Audience:** contributors · **Verified against:** `e768262`
>
> Check Recent Entries still exists on the Memory page. Automatic memory is now the background memory pass (see `FEATURES.md` §1); this note predates it.

This note captures the July 2026 update prompted by the Arcane play save where resolved plot threads, especially Ambessa and broad Jinx-collaboration pressure, kept reappearing because active memory surfaces still described them as live.

## Problem

The save audit showed that auto-approval was not the core issue. The issue was stale active context:

- Plot Essentials, Active Pressure, Story Cards, and Brains could still contain resolved facts as active pressure.
- Existing "Clean Up Cards" and "Clean Up Components" could fall back to deterministic recommendations when the AI pass failed, which made provider/config problems too easy to miss.
- Background provider settings could include a malformed base URL and an API-key value in exported/persisted adventure JSON.
- Manual AI update tools updated broad surfaces, but they did not provide a targeted "these recent entries changed the status of X; update everything related to X" workflow.

## Implemented Behavior

The Memory page now includes **Check Recent Entries**:

- The user supplies an entry count and may optionally add a directive.
- Code deterministically scans the selected recent entries, plus the optional directive when present, for related Plot Essentials, Active Pressure, Current Arc, Story Cards, and optionally Brains.
- The deterministic target list is fixed before the AI call. The AI may generate replacement/update content only for those targets.
- Resolved/removal wording applies deterministic patches such as unpinning, unprotecting, changing compact status to `resolved` or `superseded`, or deactivating removal targets.
- The generated changes become normal Memory Suggestions. They are applied only through reducer approval/auto-approval behavior.

This keeps the targeting deterministic while still using the AI for the part it is useful for: rewriting the memory content.

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

> Ambessa is defeated and no longer an active pressure. The Council accepts my work with Jinx on the filter. Caitlyn can still be angry personally about Jinx.

Set the entry count to the relevant recent window, usually 10-30 entries, and run Check Recent Entries. The "What changed?" field is optional; leave it blank to infer updates from the selected recent entries alone, or use it to steer cleanup toward a specific resolved/removed thread. Review the Memory Suggestions that appear. If Story Card or Plot auto-approval is enabled, those proposal types may apply immediately, but the reducer still records the approved proposal unless it is an ephemeral Active Pressure update.
