# Production Architecture Context

This document is an architect-facing handoff for taking AI Story Teller from a browser-only local tool to a production service with accounts, subscriptions, server-side model calls, hard deterministic content regulation, profiles, logging, and support operations.

It is intentionally full-stack. It describes what should exist, what must remain true from the current app, and where the production boundaries should be drawn.

Companion docs:

- `docs/backend-architecture.md`: target backend architecture, including parallel local/backend modes, invite-gated Google and email/password auth, JSON import compatibility, local backend hosting, sharing, deterministic content policy, account safety restrictions, and prompt-injection defenses.
- `docs/backend-implementation-plan.md`: phased implementation plan with validation gates and current-local-workflow preservation.

## Current State

AI Story Teller is currently a browser-only React + TypeScript + Vite app.

- There is no backend.
- Adventure data is stored in IndexedDB through `src/db/adventureDb.ts`.
- Small runtime settings and provider API keys are stored in localStorage.
- The browser calls OpenAI-compatible providers directly through `src/providers/openAICompatible.ts`.
- Adventure mutation is centralized through `adventureReducer(state, action)`.
- Context assembly is deterministic through `buildContext`.
- The Context Preview is expected to match the provider payload.
- Memory mutation is reducer-driven and mostly proposal-mediated.
- The current product strength is the story engine, not the infrastructure.

The production goal is not to rewrite the engine. The production goal is to make the existing engine authoritative, governable, observable, billable, and safe to operate.

## Production North Star

Production AI Story Teller should be:

- Account-backed: users can sign in, keep profiles, and recover saves.
- Subscription-aware: access, limits, model routing, and usage are plan-controlled.
- Server-authoritative: model calls, policy gates, usage accounting, and saves are enforced server-side.
- Inspectable: the existing sectioned-context philosophy remains visible to users and support staff.
- Deterministically governed: the same input under the same policy version produces the same allow/block/escalate decision.
- Local-friendly where useful: export/import and optional local draft storage remain valuable, but production truth lives server-side.
- Operationally supportable: blocked turns, failed provider calls, billing problems, sync conflicts, and user reports can be diagnosed without guessing.

## Core Constraint

No production enforcement can depend on browser-only code.

The browser can preview, validate, and warn. It cannot be the authority for:

- Content policy.
- Subscription limits.
- Provider credentials.
- Usage accounting.
- Abuse controls.
- Save durability.
- Audit logs.
- Admin actions.

All authoritative production flows must pass through the backend.

## Keep These Product Invariants

The following current app invariants should survive the backend migration.

- Adventure state changes go through typed reducer actions.
- Provider payloads are assembled from named inspectable context sections.
- Do not add opaque mega-buckets of context.
- Context Preview should be reconstructable from the same server-side build result that feeds the model.
- AI-generated memory writes must remain bounded by explicit mutation paths.
- Pending Memory Proposals are reviewable state, not hidden context.
- API keys and runtime provider secrets are never written into adventure saves.
- The Arc Director cost/break instruction remains gated until the deterministic phase reaches `break`.
- The server may own policy and persistence, but it should not turn inspectable story surfaces into hidden prompt magic.

## Recommended Stack

Because the app is already TypeScript-heavy, the simplest production path is a TypeScript backend.

Recommended baseline:

- Web: current React/Vite app.
- API: Node.js TypeScript service using Fastify, Hono, or NestJS.
- Shared engine package: TypeScript package extracted from current `src/state`, `src/contextBuilder`, `src/memory`, `src/triggers`, `src/tokenizer`, and provider request shaping.
- Database: Postgres.
- Cache/rate limit/queue state: Redis.
- Background jobs: BullMQ for a straightforward start, Temporal if workflows become complex.
- Object storage: S3-compatible storage for exports, attachments, thumbnails, and replay bundles.
- Billing: Stripe Billing or Paddle.
- Observability: OpenTelemetry traces, structured logs, metrics, error tracking.
- Admin/support: internal web console backed by explicit permissions and audit logging.

Do not introduce microservices at the start. Use a modular monolith with clean internal boundaries. Split services only after the domain boundaries prove they need separate scaling or release cycles.

## Service Boundaries

### Web App

Responsibilities:

- Play UI.
- Editor UI.
- Context Preview UI.
- Memory Inbox UI.
- Account/profile/settings UI.
- Subscription and usage UI.
- Import/export UI.
- Client-side draft recovery.

The web app should not:

- Store production provider API keys.
- Call external model providers directly in production mode.
- Decide final content policy.
- Decide final plan entitlement.
- Mutate server adventures except through typed API actions.

### API Service

Responsibilities:

- Authentication and session handling.
- User and profile APIs.
- Adventure CRUD.
- Turn execution endpoint.
- Server-side context building.
- Policy gate execution.
- Subscription entitlement checks.
- Usage accounting.
- Provider routing.
- Audit logging.
- Admin/support APIs.

### Shared Story Engine Package

This package should contain the existing deterministic product logic.

Likely contents:

- Adventure types.
- Reducer and action types.
- Default factories and normalization.
- Context builder.
- Token estimator.
- Trigger matching and action mapping.
- Memory classification policy.
- AI memory update application helpers.
- Import/export sanitization.
- Story response guard and control-tag stripping.

The browser and backend can both import this package, but the backend is authoritative in production.

### Turn Orchestrator

The turn orchestrator is the production replacement for client-owned generation.

It owns:

- Loading the adventure.
- Checking ownership and subscription.
- Applying user input.
- Running policy gates.
- Building context.
- Calling the selected provider.
- Sanitizing output.
- Persisting messages and reducer results.
- Emitting logs and usage events.
- Enqueueing background jobs.

This can initially live inside the API service as a module.

### Worker Service

Background work should move out of the browser tab.

Jobs:

- Semantic evaluation.
- Memory detection.
- Memory cycle.
- Story card audits.
- Brain audits.
- Context dedup suggestions.
- Long import parsing.
- Export packaging.
- Thumbnail generation.
- Provider retry workflows.
- Abuse review and report processing.

The worker must use the same shared engine package and the same policy engine as the API.

### Policy Engine

The policy engine is a deterministic rules engine with versioned rulesets.

It should be a library first, not a separate network service. Keeping it in-process makes it easier to test and harder to bypass accidentally.

It owns:

- Input policy.
- Context policy.
- Output policy.
- Memory-write policy.
- Share/publish policy.
- Attachment/import policy.
- Profile policy floor.

It should return structured decisions, not prose.

### Billing And Entitlements Module

Billing is not just a checkout page. It is an entitlement system.

It owns:

- Subscription state.
- Plan limits.
- Feature gates.
- Usage counters.
- Trial state.
- Grace periods.
- Webhook reconciliation.
- Provider-cost protection.
- Downgrade behavior.

Billing decisions must be server-side and must be logged.

### Admin And Support Console

Required production tool, not a later nice-to-have.

It should support:

- User lookup.
- Subscription status lookup.
- Adventure metadata lookup.
- Recent model call inspection.
- Policy block inspection.
- Support replay bundles.
- Refund/credit notes.
- Manual account holds.
- Content report review.
- Admin action history.

Admin access must be role-gated and audit-logged.

## Production Turn Flow

The production `POST /adventures/:id/turn` path should be:

1. Authenticate request.
2. Load user, profile, subscription, and adventure.
3. Check entitlement for play turn.
4. Validate input shape and size.
5. Run input policy gate.
6. Apply reducer action for user message.
7. Build context server-side.
8. Run context policy gate.
9. Select model/provider through server-side routing.
10. Call provider with server-owned credentials.
11. Parse provider response.
12. Strip hidden control tags.
13. Run output policy gate.
14. If blocked, persist a blocked-turn event and return a safe response.
15. If allowed, apply assistant message through the reducer.
16. Consume next-turn note and advance turn state.
17. Persist adventure snapshot and normalized events transactionally.
18. Record model call usage and cost estimate.
19. Update subscription usage ledger.
20. Enqueue background semantic and memory jobs.
21. Return assistant text, usage summary, policy-visible status, and updated adventure version.

The frontend should never need provider raw responses to render normal play.

## Hard Deterministic Content Regulation

The product can allow adult consensual sexual content while still blocking harmful or illegal categories. The important architectural point is that enforcement must be deterministic and versioned.

### What "Hard Deterministic" Means

It does not mean the system perfectly understands all prose.

It means:

- Policy is encoded in explicit rules.
- Rules are versioned.
- Rules produce structured decisions.
- The same text and metadata under the same ruleset produce the same decision.
- Any fuzzy classifier is advisory unless the ruleset explicitly treats its label as a deterministic input.
- Block, allow, warn, redact, and escalate outcomes are repeatable.

### Policy Decision Shape

Every policy gate should return:

```ts
interface PolicyDecision {
  id: string;
  policyVersion: string;
  rulesetVersion: string;
  gate: "input" | "context" | "output" | "memoryWrite" | "share" | "import";
  subjectType: "message" | "context" | "modelOutput" | "memoryProposal" | "adventure" | "attachment";
  subjectId?: string;
  decision: "allow" | "warn" | "block" | "redact" | "escalate";
  severity: "none" | "low" | "medium" | "high" | "critical";
  matchedRules: Array<{
    ruleId: string;
    category: string;
    action: "warn" | "block" | "redact" | "escalate";
    spans?: Array<{ start: number; end: number; hash?: string }>;
  }>;
  createdAt: string;
}
```

Raw text retention is a separate logging policy. The policy decision should be useful even when raw text is not retained long term.

### Policy Gates

Input gate:

- Runs before user input enters the model context.
- Blocks or warns on disallowed requests.
- Applies per-profile content settings and global safety floor.

Context gate:

- Runs after `buildContext`.
- Catches disallowed material pulled in from Story Cards, Brains, Plot Essentials, imports, or previous messages.
- Prevents hidden memory from bypassing policy.

Output gate:

- Runs before assistant text is persisted or shown.
- Can block, redact, or regenerate with stricter constraints.
- Must treat hidden tags and tool/control markup as non-user-visible data and strip them first.

Memory-write gate:

- Runs before any AI-generated memory proposal or direct memory update becomes durable.
- Blocks disallowed durable memory even if the visible output passed.
- Prevents policy-unsafe data from being smuggled into future context.

Share/publish gate:

- Runs before public scenario publishing, shared adventure links, marketplace entries, or exported public templates.
- Applies stricter policy than private play if needed.

Import gate:

- Runs on uploaded/imported files.
- Can quarantine imports until scanned.

### Rule Categories

The exact categories are product decisions, but the architecture should support at least:

- Adult consensual sexual content: allowed if profile permits and all participants are eligible.
- Minor sexual content: hard block.
- Sexualized coercion or exploitation: hard block.
- Real-person sexual content without consent: hard block.
- Self-harm instruction or encouragement: block or escalate.
- Graphic self-harm: profile-sensitive with hard floor.
- Illegal instruction: block by category.
- Doxxing or private data exposure: block/redact.
- Targeted harassment: block/warn depending on severity.
- Hate or extremist recruitment: block/escalate depending on severity.
- Malicious cyber instructions: block.
- Provider-prohibited content: block before provider call to avoid account risk.

The system should not collapse these into one generic "unsafe" label. Production support needs to know which rule fired.

### Fuzzy Classifiers

LLM or ML classifiers can be useful, but they should not be treated as magic.

Safe pattern:

- Deterministic lexical/structural rules catch hard cases.
- Classifiers add labels with model name, version, prompt hash, and confidence.
- Rules decide what to do with those classifier labels.
- Ambiguous high-risk cases escalate or block by configured threshold.

Example:

```ts
if (classifier.label === "minor_sexual_content" && classifier.confidence >= 0.70) {
  return block("policy.minorSexual.classifierHighConfidence");
}
```

That is deterministic if the classifier result is stored as an input and the ruleset version is fixed.

### Regeneration Policy

When output is blocked:

- Do not silently show unsafe content.
- Log the blocked output decision.
- Optionally attempt one server-side regeneration with an explicit correction instruction.
- If regeneration fails, return a neutral failure message and preserve the user's turn state according to a clear rollback policy.

Recommended rollback policy:

- Persist the user message and a blocked assistant placeholder event.
- Do not increment successful generation counters.
- Do count provider cost against internal cost tracking.
- For user-facing usage, decide whether blocked turns consume quota; if they do, say so in the plan terms.

## Profiles

Profiles should be explicit domain objects.

### User Account

Fields:

- `id`
- `email`
- `authProvider`
- `createdAt`
- `lastLoginAt`
- `status`
- `defaultProfileId`
- `subscriptionCustomerId`
- `deletedAt`

### Player Profile

A user can have one or more player profiles.

Fields:

- `id`
- `userId`
- `displayName`
- `pronouns`
- `defaultTone`
- `defaultResponseLength`
- `accessibilitySettings`
- `defaultContentProfileId`
- `defaultModelTier`
- `createdAt`
- `updatedAt`

### Content Profile

This is the user-editable layer for preferences, bounded by the global policy floor.

Fields:

- `id`
- `userId`
- `name`
- `adultContentEnabled`
- `allowedIntensity`
- `blockedThemes`
- `requiredAvoidances`
- `romancePreference`
- `violencePreference`
- `privateNotes`
- `policyFloorVersion`
- `createdAt`
- `updatedAt`

The global floor cannot be disabled. For example, a user can allow adult consensual content, but cannot allow minor sexual content.

### Author Profile

Used for public or shared scenario work.

Fields:

- `id`
- `userId`
- `displayName`
- `bio`
- `avatarAssetId`
- `publicScenarioCount`
- `trustTier`
- `createdAt`
- `updatedAt`

### Runtime Profile

This captures model and generation preferences without exposing provider secrets.

Fields:

- `id`
- `userId`
- `name`
- `preferredModelTier`
- `temperature`
- `topP`
- `presencePenalty`
- `frequencyPenalty`
- `maxOutputTokens`
- `backgroundModelTier`
- `createdAt`
- `updatedAt`

The server maps model tiers to concrete provider/model configurations.

## Subscriptions And Billing

Subscriptions are required for production because model calls create real variable cost. The architecture needs both billing state and usage enforcement.

### Billing Provider

Use a hosted billing provider rather than building payment processing directly.

Reasonable options:

- Stripe Billing: strongest default for SaaS subscriptions, metered usage, invoices, coupons, trials, customer portal.
- Paddle: useful if merchant-of-record handling is desired.

The rest of this document assumes Stripe-like concepts, but the domain model should not hard-code Stripe everywhere.

### Plan Model

Plans should control entitlements, not just labels.

Example plan fields:

- `id`
- `code`
- `name`
- `monthlyPriceCents`
- `includedMonthlyCredits`
- `maxAdventures`
- `maxCloudSaves`
- `maxContextTokens`
- `allowedModelTiers`
- `backgroundJobsEnabled`
- `semanticMemoryEnabled`
- `advancedContextToolsEnabled`
- `scenarioPublishingEnabled`
- `priorityQueue`
- `supportTier`

Do not tie the product directly to "turns" only. Different models have different costs. Use an internal credit ledger that can be displayed as approximate turns if that is friendlier.

### Subscription State

Fields:

- `id`
- `userId`
- `billingProvider`
- `providerCustomerId`
- `providerSubscriptionId`
- `planId`
- `status`
- `currentPeriodStart`
- `currentPeriodEnd`
- `cancelAtPeriodEnd`
- `trialEndsAt`
- `graceEndsAt`
- `createdAt`
- `updatedAt`

Statuses:

- `trialing`
- `active`
- `past_due`
- `grace`
- `canceled`
- `unpaid`
- `comped`

### Entitlements

The backend should derive entitlements from subscription, plan, account flags, and admin grants.

Example:

```ts
interface EffectiveEntitlements {
  planCode: string;
  status: "trialing" | "active" | "past_due" | "grace" | "canceled" | "comped";
  canGenerate: boolean;
  canUseAdvancedModels: boolean;
  canRunBackgroundMemory: boolean;
  canPublishScenarios: boolean;
  maxContextTokens: number;
  monthlyCreditLimit: number;
  remainingCredits: number;
  allowedModelTiers: string[];
  reason?: string;
}
```

Every generation endpoint should check effective entitlements before calling a provider.

### Usage Ledger

Use an append-only ledger, not a mutable counter alone.

Ledger entry fields:

- `id`
- `userId`
- `adventureId`
- `modelCallEventId`
- `subscriptionId`
- `period`
- `usageType`
- `promptTokens`
- `completionTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `internalCredits`
- `estimatedCostCents`
- `billable`
- `createdAt`

Usage types:

- `story_turn`
- `continuity_lint`
- `semantic_eval`
- `memory_detection`
- `memory_cycle`
- `audit`
- `generation_button`
- `import_processing`

The app already tracks foreground and background token usage locally. Production should preserve that visibility but make the ledger server-authoritative.

### Credit Accounting

Recommended internal accounting:

- Convert provider token usage to internal credits based on model tier and call type.
- Charge story turns and background work differently if needed.
- Let plans include monthly credits.
- Allow hard caps and soft warnings.
- Keep provider cost separate from user-visible credits.

Example:

- Cheap background model: low credit multiplier.
- Premium story model: high credit multiplier.
- Cached prompt reads: reduced internal multiplier.
- Failed provider call: internal non-billable, still logged for cost.
- Policy-blocked output: configurable billable behavior, but transparent.

### Subscription UX

Required surfaces:

- Current plan.
- Renewal date.
- Remaining credits or usage band.
- Model tier access.
- Billing portal link.
- Upgrade/downgrade.
- Cancellation state.
- Payment failure state.
- Grace-period messaging.

Avoid surprising users with background usage. If semantic evaluation and memory jobs consume credits, show that clearly or include them as part of the plan.

### Webhook Handling

Billing webhooks must be idempotent.

Store:

- `billing_webhook_events.id`
- `provider`
- `providerEventId`
- `eventType`
- `payloadHash`
- `processedAt`
- `status`
- `error`

Never trust the client for subscription state. Checkout success should show "syncing" until webhook or provider verification confirms the subscription.

### Cost Controls

Required:

- Per-user daily spend guard.
- Per-account monthly credit cap.
- Provider timeout.
- Max output tokens by plan.
- Max context tokens by plan.
- Background job throttles.
- Abuse-rate limits.
- Emergency provider disable switch.
- Model-tier routing controls.

## Persistence Model

Use Postgres as source of truth.

### Core Tables

`users`

- Account identity and status.

`profiles`

- Player profiles.

`content_profiles`

- User content preferences bounded by policy floor.

`author_profiles`

- Publishing identity.

`runtime_profiles`

- Model and generation preferences.

`adventures`

- Durable adventure metadata and latest snapshot pointer.

`adventure_snapshots`

- Versioned adventure JSON snapshots after meaningful reducer transactions.

`messages`

- Normalized chronicle entries.

`components`

- Optional normalized projection of component entries if query/edit support needs it.

`story_cards`

- Optional normalized projection of Story Cards.

`brains`

- Optional normalized projection of Brain entries.

`memory_proposals`

- Pending/approved/rejected/ignored proposals.

`model_call_events`

- Every provider call and outcome.

`policy_decisions`

- Every policy gate result.

`usage_ledger`

- Append-only usage and cost accounting.

`subscriptions`

- Effective subscription state.

`plans`

- Plan definitions.

`billing_webhook_events`

- Idempotent billing webhook processing.

`admin_actions`

- Audit log for support and moderation actions.

`user_reports`

- User-submitted content/support reports.

### Snapshot Strategy

The current adventure object is rich and can remain the canonical serialized shape. Use snapshots for durability and recovery.

Recommended:

- Store complete adventure JSON in `adventure_snapshots`.
- Store latest snapshot id on `adventures`.
- Store normalized messages and important event logs separately for search, support, and usage.
- Store memory surfaces as projections if product queries need them.

Do not make every query deserialize every full adventure snapshot.

### Adventure Versioning

Each adventure should have:

- `version`
- `updatedAt`
- `lastActionId`
- `latestSnapshotId`

Every write from the client includes the base version. The server rejects or merges stale writes explicitly.

## Logging And Observability

Production logging has three audiences:

- User-facing diagnostics.
- Support/admin diagnosis.
- Engineering operations.

Do not use one giant log stream for all three.

### Model Call Event

Fields:

- `id`
- `userId`
- `adventureId`
- `turnId`
- `callType`
- `provider`
- `model`
- `modelTier`
- `requestHash`
- `contextBuildId`
- `promptTokens`
- `completionTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `latencyMs`
- `status`
- `finishReason`
- `errorClass`
- `errorMessageRedacted`
- `createdAt`

Raw prompts and outputs should be retained only according to a clear retention policy.

### Context Build Event

Fields:

- `id`
- `adventureId`
- `turnId`
- `builderVersion`
- `sectionOrder`
- `includedItems`
- `excludedItems`
- `tokenEstimate`
- `decisionLog`
- `payloadHash`
- `createdAt`

This preserves the current Context Preview contract in a server-debuggable way.

### Reducer Event

Fields:

- `id`
- `adventureId`
- `actorType`
- `actorId`
- `actionType`
- `actionHash`
- `beforeVersion`
- `afterVersion`
- `createdAt`

For sensitive payloads, store payload hashes plus selected safe metadata.

### Policy Decision Event

As described above, one row per gate.

### Subscription Event

Fields:

- `id`
- `userId`
- `subscriptionId`
- `eventType`
- `source`
- `oldState`
- `newState`
- `createdAt`

### Retention

Recommended defaults:

- Full raw model payloads: short retention, opt-in for support/debug.
- Hashes and metadata: long retention.
- Billing events: long retention.
- Policy decisions: long retention with sensitive spans hashed or redacted.
- User-deleted adventure content: delete or anonymize according to deletion policy.

## API Surface

Representative endpoints:

### Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `POST /auth/oauth/callback`

### Profiles

- `GET /profiles`
- `POST /profiles`
- `PATCH /profiles/:id`
- `GET /content-profiles`
- `POST /content-profiles`
- `PATCH /content-profiles/:id`
- `GET /runtime-profiles`
- `POST /runtime-profiles`
- `PATCH /runtime-profiles/:id`

### Adventures

- `GET /adventures`
- `POST /adventures`
- `GET /adventures/:id`
- `PATCH /adventures/:id`
- `DELETE /adventures/:id`
- `POST /adventures/:id/import`
- `GET /adventures/:id/export`

### Turns

- `POST /adventures/:id/turn`
- `POST /adventures/:id/regenerate`
- `POST /adventures/:id/undo`
- `POST /adventures/:id/redo`

### Memory

- `GET /adventures/:id/memory-proposals`
- `POST /adventures/:id/memory-proposals/:proposalId/approve`
- `POST /adventures/:id/memory-proposals/:proposalId/reject`
- `POST /adventures/:id/memory-proposals/:proposalId/ignore`
- `POST /adventures/:id/remember-this`
- `POST /adventures/:id/memory-audit`

### Context

- `GET /adventures/:id/context-preview`
- `POST /adventures/:id/context-dedup`
- `POST /adventures/:id/context-condense`

### Billing

- `GET /billing/plan`
- `GET /billing/usage`
- `POST /billing/checkout-session`
- `POST /billing/customer-portal`
- `POST /billing/webhook`

### Admin

- `GET /admin/users/:id`
- `GET /admin/adventures/:id/diagnostics`
- `GET /admin/model-calls/:id`
- `GET /admin/policy-decisions`
- `POST /admin/users/:id/hold`
- `POST /admin/users/:id/credit`

## Provider Routing

The server should own model routing.

Client sends:

- Desired model tier or runtime profile id.
- Generation purpose.
- Adventure id.

Server resolves:

- Concrete provider.
- Concrete model.
- API key.
- Max context.
- Max output.
- Prompt caching setting.
- Retry policy.
- Fallback policy.

This lets subscriptions control access to premium models and lets operations move traffic without client releases.

## Migration From Local App

Migration should not break existing users.

### Phase 1: Export/Import Compatibility

- Keep current JSON export.
- Add server import that accepts current adventure JSON.
- Normalize with existing `normalizeAdventure`.
- Strip runtime secrets.
- Attach imported adventure to user account.

### Phase 2: Optional Cloud Account

- Users can keep using local mode.
- Signed-in users can migrate selected adventures.
- Cloud adventures show clear "cloud saved" status.

### Phase 3: Production Mode

- Hosted production uses server-side generation only.
- BYO provider keys can remain a local/dev mode if desired, but not the default hosted production path.

### Phase 4: GitHub Save Compatibility

- Existing GitHub save slots can be imported.
- Do not make GitHub the production persistence layer.
- Treat GitHub saves as legacy/export interoperability.

## Security Requirements

Required:

- Server-owned provider keys.
- Secrets manager for provider/billing credentials.
- HTTPS only.
- HttpOnly secure cookies or equivalent strong session handling.
- CSRF protection if cookie-based auth.
- Rate limits on auth, turn generation, imports, and billing endpoints.
- Per-user and per-IP abuse throttles.
- Strict CORS.
- Audit log for admin access.
- Encryption at rest through managed database/storage.
- Soft-delete plus account deletion workflow.
- Dependency scanning and lockfile hygiene.

## Support And Moderation Workflows

Support needs enough information to diagnose without reading everything by default.

A support view for a failed or blocked turn should show:

- User id.
- Adventure id.
- Turn id.
- Subscription state.
- Entitlement decision.
- Policy decisions.
- Provider/model.
- Token usage.
- Error class.
- Context section list and hashes.
- User-visible text if retention/permission allows.
- Replay bundle if explicitly captured.

Moderation needs:

- Report queue.
- Policy decision filters.
- Repeat offender signals.
- Account hold controls.
- Appeal notes.
- Admin action audit trail.

## Testing Strategy

Keep the current validation set for the frontend, then add backend tests.

Existing frontend validation:

- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run smoke:prod`

New backend validation should include:

- Reducer parity tests between browser and server package.
- Context payload golden tests.
- Policy ruleset tests.
- Subscription entitlement matrix tests.
- Billing webhook idempotency tests.
- Usage ledger accounting tests.
- Turn orchestration integration tests.
- Provider failure and retry tests.
- Import/export round-trip tests.
- Data deletion tests.

Hard policy needs adversarial fixtures. Do not rely only on happy-path tests.

## Implementation Phases

### Phase 0: Package The Engine

- Extract shared TypeScript engine package.
- Keep current app behavior unchanged.
- Prove browser and server tests can import the same reducer/context code.

### Phase 1: Backend Skeleton

- Add auth.
- Add Postgres schema.
- Add adventure import/export.
- Add server-side adventure CRUD.
- Add server-side context preview.

### Phase 2: Server-Side Turn Execution

- Move provider calls behind backend.
- Add model call logging.
- Add usage accounting.
- Preserve current play behavior.
- Keep local mode for development.

### Phase 3: Policy Engine

- Add input/output/context/memory/share gates.
- Add ruleset versioning.
- Add policy decision logs.
- Add blocked-turn UX.
- Add admin visibility.

### Phase 4: Profiles

- Add player/content/runtime profiles.
- Bind adventures to profile snapshots.
- Add profile-aware defaults.
- Add content setting UI.

### Phase 5: Subscriptions

- Add plans.
- Add checkout/customer portal.
- Add webhooks.
- Add effective entitlements.
- Add credit ledger.
- Gate model tiers and usage.

### Phase 6: Workers

- Move semantic evaluation and memory jobs to workers.
- Add job logs.
- Add retry/dead-letter handling.
- Add background usage accounting.

### Phase 7: Admin And Operations

- Add support console.
- Add moderation queue.
- Add replay bundles.
- Add metrics and alerts.
- Add provider failover controls.

## Open Product Decisions

These should be decided before implementation because they affect schema and policy.

- Are subscriptions credit-based, turn-based, or hybrid?
- Do blocked outputs consume user-facing quota?
- Are background memory jobs included in plans or metered separately?
- Is BYO API key allowed in hosted production, local-only, or not at all?
- What adult content is allowed by default, and what requires explicit opt-in?
- What content categories are private-play allowed but public-share blocked?
- How long can raw model text be retained for support?
- Can users collaborate on adventures?
- Can scenarios be published publicly?
- Are there organization/team accounts?
- What is the minimum age/account eligibility policy?

## Architect Summary

The correct production shape is a server-authoritative, subscription-aware, policy-gated story platform that reuses the current deterministic engine.

The backend should not replace the app's strongest ideas. It should enforce them:

- Typed reducer actions.
- Inspectable context sections.
- Memory proposal boundaries.
- Deterministic Arc Director pacing.
- Explicit provenance.
- Provider payload transparency.

The biggest architecture mistake would be adding a backend that becomes a hidden prompt bucket. The second biggest mistake would be leaving provider calls and policy enforcement in the browser.

The production backend exists to own trust: identity, money, safety, logs, persistence, and model access.
