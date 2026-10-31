# Adventure-only approval and retired memory compatibility


Auto-approval belongs to each adventure. New adventures start with all seven switches OFF: Plot Essentials, Active Pressure, Current Arc, Arc Proposals, Character Self, Story Cards — Lore, and Story Cards — Everything Else. The permanent panel appears at the top of Memory Suggestions, including when its queue is empty. Settings has no approval controls, and global localStorage approval properties are discarded.

The shared policy reads only `adventure.memoryAutoApprove`. Existing cards use their stored type. Lore uses `loreStoryCard`; character, location, legacy plot, and custom use `otherStoryCard`. Unknown new card types wait for classification. Missing-Brain card fallbacks use the card category. Existing pending proposals are never replayed when a switch changes. Evidence, duplicate, destination, protection, chronology, and companion-proposal checks remain in the reducer pipeline.

Migration preserves boolean active settings. Lore falls back to the old broad Story Card preference only when its own preference is absent. Both split Character and Other preferences must be true to enable the combined category; an isolated split preference is ambiguous and leaves it OFF. A saved broad Story Card preference covers all cards. Invalid and missing preferences are false.

Older adventure JSON files containing Rolling Summary or Scene State are supported for import. These fields are ignored and are not saved in the current format.

## Implementation

| File | Changed functions / contract |
| --- | --- |
| `src/types/adventure.ts` | Seven-category `MemoryAutoApproveSettings`; remove retired adventure, action, context, budget, scheduling and proposal members. |
| `src/state/defaults.ts` | `defaultMemoryAutoApproveSettings`, `normalizeMemoryAutoApproveSettings`, `createDefaultAdventure`, `normalizeAdventure`, `sanitizeAdventureForPersistence`, active token presets and default Narration Rules. |
| `src/state/legacyAdventureInput.ts` | Input-only `LegacyAdventureInput`, `stripRetiredAdventureFields`, token-setting and queued-action cleaning. |
| `src/memory/approvalPolicy.ts` | `storyCardApprovalCategory`, `getApprovalCategory`, `shouldAutoApprove`. |
| `src/state/adventureReducer.ts` | `touchAdventure`, proposal sanitization/routing/application, companion approval, insertion/merge/scan/final automatic approval; remove retired actions and reset behavior. Preserve story-clock reconciliation. |
| `src/pages/MemoryInboxPage.tsx` | Permanent seven-switch panel; `setAutoApprove`; active proposal destinations. |
| `src/pages/pageTypes.ts`, `src/App.tsx`, `src/hooks/useLocalStorage.ts`, `src/pages/SettingsPage.tsx` | Normalize global settings without approval preferences; remove duplicate/global approval and retired feature controls; preserve background provider configuration. |
| `src/utils/json.ts`, `src/sync/githubSaves.ts`, `src/sync/githubSync.ts` | Import/export and GitHub saves use the shared sanitizer. IndexedDB and copy paths already call it. |
| `src/triggers/semanticEngine.ts`, `src/memory/onePassMemory.ts` | Generated Brain changes become proposals and use the same approval policy, preserving append/replace mode. No retired generation. |
| `src/memory/brainAudit.ts`, `src/memory/componentAudit.ts`, `src/memory/storyCardAudit.ts`, `src/memory/compactMemoryFallback.ts` | Remove retired feature text from all provider prompts. |
| `src/pages/ContextPreviewPage.tsx`, `src/pages/PlayPage.tsx`, `src/pages/TriggersPage.tsx` | Remove retired context labels, editing/truncation behavior and trigger references. |
| `src/state/rollingSummary.ts`, `src/state/rollingSummary.test.ts`, `src/pages/SummaryPage.tsx` | Deleted retired modules and feature-only tests after caller audit. |

## Validation and deployment

Production frontend verified before changes: `press-lab/AI-Story-Teller-Pages`, `main`, revision `862d7145258c8c5c29d55c67da81da19cfa1e116`, served at `https://press-lab.github.io/AI-Story-Teller-Pages/`. This is the browser-local app and has no hosted backend runtime. The separate hosted repository is `press-lab/AI-Story-Teller`; its documented backend branch is `backend-local-implementation`. Its documented public API returned Cloudflare 1033 during this work. Deployment verification results are recorded after validation; source changes alone are not evidence of a live release.

## Verified validation

- Pages full suite: 114 files passed; 1,870 tests passed, 2 skipped.
- TypeScript, frontend build, and production bundle smoke passed.
- No paid provider calls were run.
- Reference audit: remaining identifiers occur only in the input compatibility cleaner, preference migration, and historical test fixtures.

## Exact changed files

- `AGENTS.md`
- `FEATURES.md`
- `README.md`
- `docs/advanced-settings.md`
- `docs/memory-approval-implementation.md`
- `src/App.tsx`
- `src/contextBuilder/contextBuilder.test.ts`
- `src/db/adventureDb.test.ts`
- `src/dev/arcaneAfterRocketAdventure.ts`
- `src/dev/developmentAdventure.ts`
- `src/dev/dispatchAdventure.ts`
- `src/dev/premadeAdventures.ts`
- `src/dev/rookeryAdventure.ts`
- `src/hooks/useAdventureRuntime.memoryWorker.test.tsx`
- `src/hooks/useAdventureRuntime.singlePass.test.tsx`
- `src/hooks/useLocalStorage.ts`
- `src/live/groqProvider.live.ts`
- `src/memory/approvalPolicy.test.ts`
- `src/memory/approvalPolicy.ts`
- `src/memory/assessmentCost.test.ts`
- `src/memory/brainAudit.ts`
- `src/memory/compactMemoryFallback.test.ts`
- `src/memory/compactMemoryFallback.ts`
- `src/memory/componentAudit.ts`
- `src/memory/eventMemory.test.ts`
- `src/memory/fixtures/syntheticMemoryAdventure.ts`
- `src/memory/hogwartsReliability.test.ts`
- `src/memory/hogwartsSemanticMemory.test.ts`
- `src/memory/hogwartsTattooAppend.test.ts`
- `src/memory/looseMemoryRouter.test.ts`
- `src/memory/memoryArchitecture.integration.test.ts`
- `src/memory/memoryAssessment.ts`
- `src/memory/memoryPipeline.regression.test.ts`
- `src/memory/memoryQuality.integration.test.ts`
- `src/memory/onePassMemory.test.ts`
- `src/memory/onePassMemory.ts`
- `src/memory/originalFoundation.test.ts`
- `src/memory/reconcileLore.test.ts`
- `src/memory/semanticGoldenFixture.ts`
- `src/memory/sharedAssessment.test.ts`
- `src/memory/singlePassMemory.comparison.test.ts`
- `src/memory/singlePassMemoryValidation.test.ts`
- `src/memory/singlePassMemoryValidation.ts`
- `src/memory/storyCardArchitecture.test.ts`
- `src/memory/storyCardAudit.ts`
- `src/memory/storyCardAutoApproval.ts`
- `src/memory/storyCardPlacement.test.ts`
- `src/memory/storyCardResponsibilities.test.ts`
- `src/memory/storyCardSkill.test.ts`
- `src/memory/storyCardSuggestions.test.ts`
- `src/pages/BrainsPage.preview.test.tsx`
- `src/pages/ContextPreviewPage.tsx`
- `src/pages/HelpPage.tsx`
- `src/pages/MemoryApproval.ui.test.tsx`
- `src/pages/MemoryControls.ui.test.tsx`
- `src/pages/MemoryDecisionsPage.test.tsx`
- `src/pages/MemoryInboxPage.tsx`
- `src/pages/PlayPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/SettingsPage.ui.test.tsx`
- `src/pages/SideMenuPages.ui.test.tsx`
- `src/pages/StoryCardSuggestions.ui.test.tsx`
- `src/pages/SummaryPage.tsx`
- `src/pages/TriggersPage.tsx`
- `src/pages/pageTypes.ts`
- `src/state/adventureReducer.test.ts`
- `src/state/adventureReducer.ts`
- `src/state/defaults.ts`
- `src/state/legacyAdventureInput.ts`
- `src/state/rollingSummary.test.ts`
- `src/state/rollingSummary.ts`
- `src/sync/githubSaves.ts`
- `src/sync/githubSync.ts`
- `src/test/goldenAdventure.ts`
- `src/test/hogwartsAssessment.ts`
- `src/test/legacyAdventure.ts`
- `src/test/looseMemory.ts`
- `src/test/looseMemoryAssertions.ts`
- `src/test/memoryApproval.ts`
- `src/test/memoryQuality.ts`
- `src/triggers/semanticEngine.test.ts`
- `src/triggers/semanticEngine.ts`
- `src/triggers/triggerEngine.ts`
- `src/types/adventure.ts`
- `src/utils/json.ts`
- `src/utils/legacyAdventure.test.ts`
