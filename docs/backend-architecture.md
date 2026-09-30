# Backend Architecture

> **Status:** Proposal — nothing here is implemented; the app has no backend · **Audience:** architects and contributors · **Verified against:** `e768262`
>
> This is the canonical backend design. Where `production-architecture-context.md` disagrees, this document wins; see "Known Gaps And Open Issues" at the end.

This is the target architecture for adding accounts, invite-gated signup, Google login, email/password login, scenario/adventure sharing, subscriptions, deterministic content policy, account safety restrictions, and prompt-injection defenses to AI Story Teller.

The core product rule remains unchanged: the story engine is the product. The backend exists to make the existing engine durable, account-backed, billable, shareable, and enforceable without turning the model context into hidden server magic.

## Current App To Preserve

AI Story Teller currently works as a browser-only local app:

- React, TypeScript, Vite.
- IndexedDB adventure persistence through `src/db/adventureDb.ts`.
- Small runtime settings and BYO provider API key in localStorage.
- Browser-to-provider generation through `src/providers/openAICompatible.ts`.
- Optional GitHub saves and GitHub sync.
- Reducer-driven adventure mutation through `adventureReducer`.
- Deterministic context assembly through `buildContext`.
- Inspectable Context Preview that must match the provider payload.
- Cache-ordered payload: stable system prefix, chunk-aligned recent history, per-turn `[TURN CONTEXT]` block in the newest user message. Server-side context building must keep this layout or prompt-cache savings disappear.
- A narrator that only narrates, plus one background memory pass every N story turns (`src/memory/compactMemoryFallback.ts`) that suggests Story State, Brain, Story Card, and plot updates through Memory Suggestions.
- Story State as the reviewed current-truth surface (suggestions reviewed by default; a newer pending suggestion supersedes an older one).

Do not break this setup while the backend is added. Local play remains a supported mode during migration. Backend mode is additive until it is proven stable.

## Architecture North Star

Production AI Story Teller should become a server-authoritative story platform:

- The browser remains the rich editor and play UI.
- The backend owns identity, invite gating, persistence, provider credentials, model routing, usage, billing, policy gates, account safety restrictions, public sharing, and audit logs.
- The current deterministic engine is extracted into a shared TypeScript package used by both browser and backend.
- Server mode and local mode coexist behind explicit runtime adapters.
- Public sharing and subscriptions are built on explicit domain models, not flags sprinkled through the UI.

## Recommended Stack

- Web: existing React/Vite app.
- API: TypeScript Node service using Fastify or Hono.
- Shared engine: workspace package containing reducer, types, defaults, context builder, tokenizer, trigger logic, memory boundaries, import/export sanitizers, and response guard.
- Database: Postgres.
- Queue/cache/rate limit: Redis plus BullMQ.
- Object storage: S3-compatible storage for thumbnails, exports, scenario assets, and support replay bundles.
- Auth: Google OAuth and email/password first, plus a server-side invite check. Supabase Auth, Clerk, Auth0, or a custom auth stack can work, but all first implementation hosting is local. Apple auth is explicitly deferred.
- Billing: Stripe Billing by default, with our own entitlement and usage ledger.
- Observability: structured logs, model-call events, policy decision records, metrics, and error tracking.

Start as a modular monolith. Split services only after one module has a clear independent scaling or release need.

## Initial Hosting Target

The first backend implementation is local-only.

- GitHub Pages can continue to host the static frontend.
- The API runs locally, for example `http://127.0.0.1:8787`.
- The database runs locally.
- Redis/worker infrastructure runs locally when introduced.
- Provider credentials live only in local backend environment/configuration.
- Hosted backend deployment is a later target after local mode proves the architecture.

Because the backend is local, external users will not be able to use the owner's local API from GitHub Pages unless they run their own backend, use a temporary tunnel, or a hosted backend is added later.

## Hard Boundary: Local Mode vs Backend Mode

Introduce an explicit runtime mode, not a hidden half-migration.

```ts
type RuntimeMode = "local" | "backendLocal" | "hostedBackend";
```

Local mode:

- Uses IndexedDB for saves.
- Uses localStorage for BYO provider settings.
- Calls OpenAI-compatible providers from the browser.
- Keeps current GitHub save and sync features.
- Requires no account.
- Is allowed in development and during migration.

Backend local mode:

- Keeps the frontend on GitHub Pages or local Vite.
- Calls a backend running on the user's machine, for example `http://127.0.0.1:8787`.
- Requires an authenticated backend account once auth is enabled.
- Stores backend-mode adventures in local Postgres or the chosen local database.
- Calls model providers only through the local backend.
- Uses backend-owned provider credentials from local server configuration.
- Enforces invite/account/subscription/policy/usage server-side.
- Uses server-side context preview and turn execution.
- Treats AIST JSON and GitHub save JSON as import formats.
- Does not require the user's personal GitHub token or current GitHub save access.

Hosted backend mode, later:

- Requires authenticated account.
- Stores adventures in Postgres.
- Calls model providers only through the backend.
- Uses server-owned provider credentials.
- Enforces invite/account/subscription/policy/usage server-side.
- Uses server-side context preview and turn execution.
- Treats AIST JSON and GitHub save JSON as import formats, not production persistence.

GitHub Pages can continue to host the static frontend during backend-local development. The important limitation is that `127.0.0.1` always means the viewer's own machine. This is fine for owner/local testing. External users need either their own local backend, a temporary tunnel, or a later hosted backend.

The frontend should route persistence and generation through interfaces:

```ts
interface AdventureStore {
  list(): Promise<AdventureSummary[]>;
  get(id: string): Promise<Adventure | undefined>;
  save(adventure: Adventure): Promise<void>;
  delete(id: string): Promise<void>;
}

interface TurnRunner {
  runTurn(adventureId: string, input: string): Promise<TurnResult>;
}
```

Local adapters use the current code. Backend adapters call either the local backend or a later hosted backend. This keeps the current workflow alive while backend features are built.

## Shared Story Engine

The backend must reuse the real story engine rather than reimplementing behavior.

Package contents:

- `src/types`
- `src/state`
- `src/contextBuilder`
- `src/triggers`
- `src/memory`
- `src/tokenizer`
- `src/importers`
- `src/utils/json`
- response sanitization and control-tag stripping

Invariants:

- All adventure changes still go through reducer actions.
- Context sections remain named and inspectable.
- Context Preview is produced from the same build result as the provider payload.
- AI-generated memory writes stay inside approved mutation paths.
- Pending proposals never become hidden prompt context.
- Arc Director break instructions remain gated until the deterministic phase reaches `break`.

## Auth And Invite-Gated Signup

Account creation is invitation-only.

Domain tables:

```text
users
auth_identities
password_credentials
invite_links
signup_intents
profiles
author_profiles
```

`invite_links`:

- `id`
- `token_hash`
- `created_by_user_id`
- `target_email`, optional
- `max_uses`
- `used_count`
- `expires_at`
- `revoked_at`
- `created_at`

Flow:

1. Admin or trusted user creates an invite.
2. Backend generates a high-entropy random token.
3. Only the token hash is stored.
4. User opens `/join?invite=...`.
5. Backend validates the invite and creates a short-lived signup intent.
6. User completes Google OAuth or creates an email/password credential.
7. Auth callback or auth hook verifies the signup intent before account activation.
8. Backend marks invite use transactionally and creates user, default profile, author profile, and starter entitlements.

Do not trust email alone for invite redemption. Bind account creation to the invite redemption session plus the Google provider identity or verified email/password credential. If Apple is added later, revisit relay-email behavior and callback requirements then.

Email/password requirements:

- Passwords are never stored directly.
- Use Argon2id or bcrypt with strong cost settings.
- Require email verification before account activation for real users.
- Support password reset through signed, short-lived reset tokens.
- Rate-limit login, signup, reset, and invite checks by IP and account.
- Lock or slow repeated failed login attempts.
- Store password credential metadata separately from user profile data.
- Local development may use a local mail catcher or admin-visible verification links, but production-like user testing must verify email.

Existing signed-in users can be invited to features or private betas without creating another account.

## Import And Migration Formats

Backend mode should support imports without touching the owner's personal local setup.

Supported import sources:

- AI Story Teller full adventure JSON.
- AI Story Teller partial component/story-card JSON where applicable.
- GitHub save-slot JSON files exported or downloaded from the existing save repo.

Explicitly out of scope for the first backend:

- Asking users for GitHub personal access tokens.
- Connecting directly to the owner's current GitHub save repo.
- Migrating the owner's IndexedDB records automatically.
- Using GitHub as production persistence for backend-mode adventures.

Import rules:

- Imports create copies.
- Imports never mutate source local IndexedDB data.
- Runtime provider secrets are stripped.
- Imported text is untrusted until policy and prompt-injection gates inspect it.
- Import provenance is stored on the adventure, scenario draft, or raw import record.
- GitHub save compatibility means "accept the JSON shape," not "reuse personal GitHub credentials."

## Adventures

An adventure is a private mutable save.

Production persistence should keep the current serialized adventure object as the canonical snapshot while adding normalized projections for querying, support, and sharing.

Core tables:

- `adventures`
- `adventure_snapshots`
- `adventure_events`
- `messages`
- `components`
- `story_cards`
- `brains`
- `memory_proposals`

Rules:

- `adventures.latest_snapshot_id` points at the current full JSON snapshot.
- Writes include a base version to prevent silent overwrite.
- Reducer events are logged with action type, actor, before version, after version, and payload hash.
- Runtime provider secrets are never stored in adventure JSON.
- AIST JSON import remains supported.
- GitHub save JSON import remains supported.

## Scenarios

A scenario is a reusable template, not a live save.

Do not publish full private adventures by accident. Public scenario publishing must create an explicit scenario revision.

Core tables:

- `scenarios`
- `scenario_revisions`
- `scenario_assets`
- `scenario_publications`
- `scenario_forks`
- `scenario_reports`

Scenario revision contents:

- title
- summary
- tags
- visibility
- opening scene
- components
- story cards
- optional brains intentionally included by author
- author profile
- thumbnail asset
- content policy decision
- source adventure id, if created from an adventure

Publishing rules:

- Public scenario revisions are immutable.
- Editing a public scenario creates a new revision.
- Public publish runs import/share policy gates.
- Private/unlisted share links are revocable.
- Forking copies a scenario revision into a user's own adventure or draft scenario.
- Adventure transcript and private runtime memory are excluded unless the author explicitly exports them into the scenario package.

## Adventure Sharing

Adventure sharing is separate from scenario publishing.

Initial sharing modes:

- Private snapshot link.
- Unlisted view-only link.
- Copy/fork into my account.
- Revocable share token.

Avoid live collaboration in the first backend version. It requires permission scopes, conflict semantics, moderation, and real-time state management that would distract from account-backed generation and scenario publishing.

## Subscriptions And Entitlements

Subscriptions control access to expensive and advanced features. They are not just payment state.

Domain tables:

- `plans`
- `subscriptions`
- `entitlement_grants`
- `usage_ledger`
- `model_call_events`
- `billing_webhook_events`

Plans should control:

- max backend adventures
- max backend saves or snapshots
- max context tokens
- allowed model tiers
- monthly included credits
- background memory jobs
- advanced context tools
- scenario publishing
- priority queue
- support tier

Every generation endpoint checks effective entitlements before provider calls.

Usage accounting is append-only:

- `story_turn`
- `memory_pass`
- `continuity_lint`
- `semantic_eval`
- `memory_detection`
- `memory_cycle`
- `audit`
- `generation_button`
- `import_processing`
- `thumbnail_generation`

Internal credits should be separate from provider cost. Provider cost is operational accounting. Internal credits are product entitlement accounting.

## Deterministic Content Policy

The product may allow consensual adult content when enabled by the user profile. The global safety floor cannot be disabled.

Hard-block categories:

- sexual content involving minors or minor-coded participants
- sexual exploitation, trafficking, grooming, or coercion
- non-consensual sexual content or sexualized violence
- sexual content involving animals
- sexual content involving corpses or unconscious/non-participating people
- eroticized torture, cruelty, mutilation, or suffering
- real-person sexual content without consent
- illegal sexual content by jurisdiction or provider contract
- instructions that enable abuse, exploitation, evasion, or harm
- doxxing/private-data exposure
- self-harm instruction or encouragement
- malicious cyber instructions
- extremist recruitment or operational support

Allowed by profile, subject to the global floor:

- consensual adult romance
- consensual adult sexual content
- non-graphic adult flirting or innuendo
- fictional violence within user profile limits

### Rule Storage

The policy engine should be generic code. Do not scatter graphic banned-content phrases through application logic.

Recommended structure:

- Code defines the policy engine, decision types, category ids, severity handling, and gate wiring.
- Rulesets are versioned data loaded from the database, deployment config, or an admin-managed policy pack.
- Tests use sanitized category names and minimal fixtures rather than a catalog of explicit abusive prompts.
- Admin UI exposes rule ids, categories, actions, severity, and notes without requiring graphic strings in source files.

The codebase will still name the safety categories because the product has to know what it forbids. The difference is that operational matching data and escalation thresholds are policy configuration, not hidden prompt text or ad hoc string checks spread across the app.

The policy engine is deterministic:

- Rules are versioned.
- Decisions are structured.
- Same text plus same metadata plus same ruleset produces the same decision.
- LLM/ML classifiers may provide labels, but rules decide what those labels mean.
- Policy decisions are logged without requiring long-term raw text retention.

Policy gates:

- input gate
- context gate
- output gate
- memory-write gate
- import gate
- share/publish gate
- profile gate

The context gate matters because unsafe material can enter from Story Cards, Brains, Plot Essentials, imported scenarios, old transcript, or memory proposals.

### Blocking Flow

Content is blocked through server gates, not through model preference or frontend warnings.

Input blocking:

1. User submits a turn, import, memory action, profile change, or publish request.
2. Backend normalizes text and metadata into a policy subject.
3. Backend runs the relevant deterministic ruleset before the subject can reach the model or become public.
4. If the decision is `block`, the backend stores a `policy_decision`, returns a neutral user-facing refusal, and does not call the provider for that subject.
5. If the block is a severe hard-floor category, the backend also creates an `account_safety_event`.

Context blocking:

1. Backend builds inspectable context sections.
2. Backend scans the assembled context before the provider call.
3. If Story Cards, Brains, imports, transcript, or scenario text pull in blocked material, the provider call is stopped.
4. The unsafe context item is identified by section/item id where possible so support can diagnose it without a blind prompt dump.

Output blocking:

1. Backend strips hidden/control tags from the provider response.
2. Backend runs output policy before showing or persisting the response.
3. If blocked, the raw output is not shown.
4. Backend stores a blocked assistant placeholder and a `policy_decision`.
5. Backend may attempt one regeneration with stricter instruction only when the ruleset allows it.

Memory/import/share blocking:

- AI-generated memory proposals and direct updates pass through the memory-write gate before durability.
- AIST and GitHub save JSON imports pass through import and prompt-injection gates before becoming trusted backend adventure material.
- Public scenario publishing and adventure share links pass through stricter share gates before visibility.

The result is explicit: blocked content cannot reach the model at input/context gates, cannot be shown at output gates, cannot become durable memory at memory gates, and cannot be published at share gates.

## Account Safety Restrictions

Users who attempt hard-barred illegal or cruel sexual content should be blocked and safety-flagged. The model does not decide this. The server policy engine returns a structured decision, and the account safety module applies a deterministic restriction policy.

Domain tables:

- `account_safety_events`
- `account_restrictions`
- `account_status_history`
- `policy_decisions`
- `admin_actions`

Account states:

- `normal`: no active restriction.
- `watched`: elevated logging and lower abuse thresholds after concerning attempts.
- `restricted`: public sharing, scenario publishing, invites, and advanced features disabled.
- `generation_hold`: generation disabled pending admin review.
- `banned`: account access disabled except export/appeal flows if those are allowed.

Restriction policy:

- Ambiguous or low-confidence policy hits block the content but do not automatically punish the account.
- Deterministic hard-block matches create an `account_safety_event`.
- Severe hard-block matches immediately disable public sharing and scenario publishing.
- Repeated severe events can move the account to `generation_hold`.
- Admin review can lift, extend, or convert restrictions.
- Critical illegal-content attempts can move directly to `generation_hold` or `banned`, depending on the deployed ruleset.

Effective entitlement checks must include account safety:

```ts
interface EffectiveAccountAccess {
  accountStatus: "normal" | "watched" | "restricted" | "generation_hold" | "banned";
  canGenerate: boolean;
  canPublishScenarios: boolean;
  canCreateInvites: boolean;
  canUseAdvancedModels: boolean;
  canUseBackgroundJobs: boolean;
  reason?: string;
}
```

This is the restriction mechanism: a user can keep an account record for audit/support, but sensitive capabilities are removed when the account is no longer trusted.

### Manual Review Required

The first active policy pack and account-restriction thresholds require manual product/security review before they are enabled for real users.

Review must cover:

- blocked category ids and definitions
- severity thresholds
- when a block creates an account safety event
- when safety events restrict sharing, publishing, invites, advanced models, background jobs, generation, or account access
- sanitized fixture coverage for allowed and barred content
- user-facing refusal language
- admin/support visibility
- raw-text retention and appeal/export behavior

The engine can be implemented before this review, but the active ruleset cannot be treated as trusted until this review is complete.

## Prompt-Injection Defense

Prompt injection is a product and architecture issue, not just a prompt wording issue.

Trust levels:

1. System instructions generated by the app.
2. Server policy and entitlement instructions.
3. User-authored AI Instructions and Author's Note.
4. Current user turn.
5. Adventure content: components, Story Cards, Brains, summaries, imports.
6. Public scenario text and shared adventure text.
7. Model output from previous turns.

Rules:

- Untrusted content is always data, never instructions.
- Imported/public/shared scenario text is untrusted until inspected and accepted.
- Previous model output is untrusted for instruction purposes.
- Story content cannot override system, policy, billing, provider, or tool rules.
- Context sections carry provenance and trust metadata.
- Prompt-injection attempts are logged as policy/security decisions.
- Backend routes must never execute instructions found inside adventure text, scenario text, imports, or model output.

Required defenses:

- sectioned context assembly with explicit labels
- instruction hierarchy in the system shell
- quoted or delimited untrusted content blocks
- provenance metadata on context items
- context policy scan before provider call
- output scan before persistence
- memory-write scan before durable memory updates
- share/import scan before public publishing
- provider/tool credentials unavailable to the model
- no hidden tool execution from model prose

The existing "no opaque mega-buckets" rule is part of the injection defense. If each context item is named, typed, and inspectable, malicious content has fewer places to hide.

## Production Turn Flow

Backend turn execution:

1. Authenticate request.
2. Load user, profile, subscription, and adventure.
3. Check invite/account safety/subscription status and generation entitlement.
4. Validate input shape and size.
5. Run input policy gate.
6. Apply reducer action for the user message.
7. Build context server-side.
8. Run prompt-injection and content policy context gates.
9. Select model/provider through server routing.
10. Call provider with server-owned credentials.
11. Parse provider response.
12. Strip control tags.
13. Run output policy gate.
14. If blocked, persist a blocked-turn event and return a neutral response.
15. If allowed, apply assistant message through the reducer.
16. Consume next-turn note and advance turn state.
17. Persist snapshot and normalized events transactionally.
18. Record model usage and cost estimate.
19. Append usage ledger entries.
20. Enqueue background semantic and memory jobs.
21. Return assistant text, usage summary, policy-visible status, and updated adventure version.

## API Surface

Representative endpoints:

```text
GET  /auth/session
POST /auth/logout
GET  /invites/:token/preview
POST /invites/:token/accept
POST /admin/invites

GET  /adventures
POST /adventures/import
POST /adventures
GET  /adventures/:id
PATCH /adventures/:id
DELETE /adventures/:id
POST /adventures/:id/turn
GET  /adventures/:id/context-preview

GET  /scenarios
POST /scenarios
GET  /scenarios/:id
POST /scenarios/:id/revisions
POST /scenarios/:id/publish
POST /scenario-revisions/:id/fork
POST /scenario-revisions/:id/report

GET  /billing/plan
GET  /billing/usage
POST /billing/checkout-session
POST /billing/customer-portal
POST /billing/webhook

GET  /admin/users/:id
GET  /admin/adventures/:id/diagnostics
GET  /admin/model-calls/:id
GET  /admin/policy-decisions
GET  /admin/account-safety-events
POST /admin/users/:id/restrict
POST /admin/users/:id/hold
POST /admin/users/:id/credit
```

## Migration Strategy

Migration must be boring and reversible.

Phase 1:

- Extract shared engine package.
- Keep local mode as default.
- Add adapter interfaces.
- Prove current tests still pass.

Phase 2:

- Add local backend skeleton, auth, invites, and backend-mode account shell.
- Do not move generation yet.
- Add import/export to backend-mode adventures.

Phase 3:

- Add backend adventure CRUD and server context preview.
- Keep local adventures untouched.
- Add "copy local adventure to backend" instead of automatic migration.

Phase 4:

- Add server-side turn execution behind a backend-mode toggle.
- Compare server context payload to local context payload with golden tests.

Phase 5:

- Add deterministic policy gates, account safety restrictions, and prompt-injection gates.
- Block public sharing until share policy passes.

Phase 6:

- Add subscriptions and usage enforcement.
- Enforce model tier and context limits server-side.

Phase 7:

- Add scenario publishing, forks, and share links.
- Keep publishing opt-in and revisioned.

Phase 8:

- Move background memory/audit jobs to workers.
- Add admin/support console.

## Non-Negotiables

- Current local play must keep working while backend mode is built.
- GitHub Pages static hosting must continue to work while backend-local mode is built.
- No backend feature may bypass reducer-driven mutation.
- No context surface may become an opaque hidden prompt bucket.
- No public sharing before deterministic share policy exists.
- No subscription enforcement in the browser only.
- No provider keys in browser storage for backend mode.
- No account creation without a valid invite until the product owner intentionally disables invite gating.
- No user-facing model/provider settings in backend mode until the product owner intentionally exposes them.
- No backend import path may require the owner's personal GitHub access.
- No AI-generated memory write without memory-write policy.
- No imported or shared text treated as trusted instructions.

## Known Gaps And Open Issues

Found in review on 2026-09-30. These need decisions before implementation, not just edits.

### Conflicts with `production-architecture-context.md`

- **Phase order.** This doc builds server-side turns (Phase 4) before policy gates (Phase 5); the other puts turns in Phase 2 and policy in Phase 3. Either way backend generation exists before any gate. Acceptable for owner-only local testing; say so explicitly or reorder.
- **Model settings.** "No user-facing model/provider settings in backend mode" contradicts the other doc's user-editable Runtime Profile (temperature, topP, model tier). Pick one.
- **Two access objects.** `EffectiveEntitlements` (billing) and `EffectiveAccountAccess` (safety) both carry `canGenerate`, `canPublishScenarios`, `canUseAdvancedModels`. Define one composed decision (logical AND) that every endpoint checks.
- **Stack and gates.** Fastify/Hono vs NestJS, Stripe vs Paddle, BullMQ vs Temporal; `profile` gate here vs `attachment` gate there. Settle once.

### Robustness gaps

1. **Local backend behind GitHub Pages.** A github.io page calling `127.0.0.1` is cross-site: third-party-cookie blocking drops cookie sessions, and Chrome prompts for local-network access. Choose bearer tokens held in memory, or have the local backend serve the frontend in `backendLocal` mode.
2. **Turn failure semantics.** The user message is applied (step 6) before the provider call (step 10), with no defined rollback for timeouts or 5xx. The turn endpoint takes no base version or idempotency key, so a double submit bills twice and loses one result. Add a per-adventure lock and an idempotency key.
3. **Check-then-spend credits.** Entitlement is checked at step 3 and the ledger written at step 19; parallel requests can overspend. Reserve credits up front, settle after, and define handling for timed-out calls with unknown usage.
4. **Context gate cost.** Rescanning the whole assembled context every turn is a paid classifier call over mostly unchanged text. Cache item decisions by (content hash, ruleset version); that also makes the determinism claim true.
5. **Bricked adventures.** A Story Card or Brain that trips the context gate fails every later turn. Define quarantine: exclude the item, continue, and show the user what to fix.
6. **Background job races.** Memory jobs enqueued at version N land after later turns. Pin job output to a version and reject or rebase stale results.
7. **Trust by field, not author.** A forked scenario's AI Instructions sit at trust level 3 even though another user wrote them. Trust must follow authorship and provenance.
8. **Snapshot growth.** A full adventure snapshot per turn grows without bound. Define cadence, compaction, and retention.
9. **Local database operations.** No backup, migration-tooling, or rollback plan for the owner-machine Postgres.
10. **Smaller items.** Strip the `?invite=` token from the URL after exchange; define provider timeout, retry, and fallback policy; reconcile account deletion with safety-record retention.
