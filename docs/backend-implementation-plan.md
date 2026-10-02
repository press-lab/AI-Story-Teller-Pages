# Backend Implementation Plan

This is the implementation plan for adding a locally hosted backend, accounts, invite-only signup, Google login, email/password login, scenario/adventure sharing, subscriptions, deterministic content policy, account safety restrictions, and prompt-injection defenses without breaking the current local setup.

The companion architecture document is `docs/backend-architecture.md`.

## Implementation Principles

- Keep the current app usable at every phase.
- Add backend mode beside local mode before replacing any local behavior.
- Prefer adapters and shared packages over rewrites.
- Keep reducer and context-builder parity measurable.
- Treat policy, account safety, prompt-injection defense, usage, and billing as backend concerns.
- Make public sharing opt-in, versioned, and policy-gated.
- Keep all backend hosting local for the first implementation pass.
- Treat the first deployable policy pack and account-restriction thresholds as a manual product/security review item, not an automatic implementation detail.

## Manual Review Gate

Before backend generation, imports, public sharing, or account restrictions are enabled for real users, manually review and approve:

- blocked category ids and their plain-language definitions
- severity levels and which categories create account safety events
- restriction transitions from `watched` to `restricted` to `generation_hold` to `banned`
- whether each gate blocks, redacts, quarantines, or escalates
- sanitized fixture coverage for allowed consensual adult content and barred harmful content
- user-facing refusal language
- admin/support visibility and raw-text retention rules
- appeal/export behavior for restricted or banned users

No implementation task may silently decide these thresholds on its own. The backend can implement the engine and test harness first, but the first active ruleset must be explicitly reviewed before it is enabled outside local owner testing.

## Parallel Setup Preservation

The current setup must survive during backend implementation.

Current local workflow to preserve:

- IndexedDB local adventures.
- BYO API key in localStorage.
- Browser-to-provider generation.
- JSON backup and restore.
- GitHub save slots.
- GitHub cloud sync in the existing local workflow.
- Local development with `npm.cmd run dev`.
- Existing validation commands.

Do not remove or degrade these while backend features are being added.

Add these abstractions first:

```ts
type RuntimeMode = "local" | "backendLocal" | "hostedBackend";

interface RuntimeConfig {
  mode: RuntimeMode;
  apiBaseUrl?: string;
}

interface AdventureStore {
  list(): Promise<AdventureSummary[]>;
  get(id: string): Promise<Adventure | undefined>;
  save(adventure: Adventure): Promise<void>;
  delete(id: string): Promise<void>;
}

interface TurnRunner {
  runTurn(adventureId: string, input: string): Promise<TurnResult>;
}

interface ContextPreviewSource {
  build(adventureId: string): Promise<ContextBuildResult>;
}
```

Local adapters wrap existing code. Backend adapters call local or hosted backend endpoints.

Acceptance criteria:

- Local mode is default until backend mode is deliberately selected.
- Existing local saves load without migration.
- GitHub saves remain visible and functional in local mode.
- Backend import uses copies, not in-place conversion.
- A failed backend request cannot corrupt local IndexedDB state.

## Phase 0: Repository Preparation

Goal: make backend work possible without changing runtime behavior.

Tasks:

- Add workspace structure for `apps/web`, `apps/api`, and `packages/story-engine`, or use a transitional package layout if a full move is too large.
- Move shared pure code into `packages/story-engine`.
- Re-export types and functions so the web app imports from the package.
- Keep the public behavior of local mode unchanged.
- Add parity tests for imported reducer/context/default behavior.

Files likely involved:

- `package.json`
- `tsconfig*.json`
- `vite.config.ts`
- `src/types`
- `src/state`
- `src/contextBuilder`
- `src/memory`
- `src/triggers`
- `src/tokenizer`
- `src/importers`

Validation:

- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run smoke:prod`

Exit criteria:

- No UI or save behavior changes.
- Existing tests pass.
- Shared engine can be imported from web and backend test stubs.

## Phase 1: Runtime Adapters

Goal: make local/backend switching explicit.

Tasks:

- Add local `AdventureStore` adapter around IndexedDB.
- Add local `TurnRunner` adapter around the current provider flow.
- Add runtime mode setting, defaulting to `local`.
- Add no-op backend adapter shell that reports "backend mode unavailable" until backend exists.
- Add tests proving local mode still hits IndexedDB and browser provider flow.

Acceptance tests:

- Existing local adventure list renders.
- Existing play flow still works in local mode.
- Export/import still works.
- GitHub saves are still reachable from local mode.

Exit criteria:

- The app has an explicit seam for backend work.
- No production backend dependency exists yet.

## Phase 2: Backend Skeleton

Goal: create the local API service without moving generation.

Tasks:

- Add `apps/api`.
- Add Fastify or Hono server.
- Add health endpoint.
- Add typed environment validation.
- Add structured logger.
- Add local Postgres connection, or a simpler local database only if Postgres setup blocks early development.
- Add migration runner.
- Add local dev script for API.
- Add API test setup.
- Add CORS configuration that allows the GitHub Pages frontend origin and local Vite origin during development.
- Add `.env.example` placeholders for backend-owned provider configuration.
- Add local-only startup documentation for API, database, and worker placeholders.

Initial endpoints:

```text
GET /health
GET /version
```

Initial database:

- migrations table, if not supplied by migration tool
- app metadata table

Exit criteria:

- API starts locally.
- API tests run.
- Web local mode is unaffected.
- GitHub Pages can be configured to call the local backend API for owner testing.
- No hosted backend dependency exists yet.

## Phase 3: Auth And Invite Gate

Goal: support invite-only accounts with Google login and email/password login.

Tasks:

- Choose auth provider.
- Configure Google OAuth.
- Add email/password credential flow.
- Add password hashing with Argon2id or bcrypt.
- Add email verification token flow.
- Add password reset token flow.
- Add invite table and signup intent table.
- Add admin invite creation endpoint.
- Add invite preview endpoint.
- Add invite acceptance endpoint.
- Add auth callback or auth hook integration.
- Add default user/profile/author-profile creation.
- Add tests for valid, expired, revoked, overused, and replayed invites.

Tables:

```text
users
auth_identities
password_credentials
invite_links
signup_intents
profiles
author_profiles
admin_actions
```

Security requirements:

- Store invite token hashes only.
- Use high-entropy random invite tokens.
- Expire signup intents quickly.
- Mark invite use in the same transaction that creates account state.
- Bind account creation to the invite redemption session plus Google provider identity or verified email/password credential.
- Do not store raw passwords.
- Rate-limit login, signup, invite preview, invite accept, and password reset.
- Lock or slow repeated failed login attempts.
- Use local mail capture or admin-visible verification links for local development only.
- Rate-limit invite preview and accept endpoints.
- Defer Apple integration until hosted HTTPS callback behavior is worth solving.

Exit criteria:

- No account can be activated without a valid invite.
- A user can sign up with Google after accepting an invite.
- A user can sign up with email/password after accepting an invite.
- Email/password users have verified email before normal account activation.
- Admin can create and revoke invites.
- Invite use is auditable.

## Phase 4: Backend Adventure Persistence

Goal: add backend saves without touching existing local saves or personal GitHub access.

Tasks:

- Add adventure tables.
- Add backend adventure CRUD endpoints.
- Add JSON import endpoint for current AIST local exports.
- Add GitHub save JSON import support by accepting uploaded/pasted save-slot JSON.
- Add backend export endpoint.
- Add version checks for writes.
- Add server-side normalization through shared engine.
- Add backend adventure list UI behind runtime mode.
- Add "copy local adventure to backend" flow.

Tables:

```text
adventures
adventure_snapshots
adventure_events
messages
components
story_cards
brains
memory_proposals
```

Rules:

- Import creates a new backend copy.
- Local IndexedDB record remains untouched.
- Runtime provider secrets are stripped on import.
- Imported text is marked as untrusted until policy and prompt-injection gates inspect it.
- Backend mode does not ask users for GitHub personal access tokens.
- Backend mode does not connect to the owner's existing GitHub save repo.
- Writes require ownership.
- Writes include base version.

Exit criteria:

- A local adventure can be copied to backend mode.
- A backend adventure can be exported back to current JSON format.
- AIST JSON and GitHub save JSON can be imported as copies.
- Local mode still works if the API is offline.

## Phase 5: Server Context Preview

Goal: make server context assembly visible and comparable before server generation.

Tasks:

- Add `GET /adventures/:id/context-preview`.
- Build context on the server with shared engine.
- Store context build metadata.
- Compare server payload with local payload for imported fixtures.
- Add UI indication for backend context preview.

Tables:

```text
context_build_events
```

Acceptance tests:

- Same adventure input produces same ordered context sections locally and on the server.
- Empty sections remain present in build result but absent from provider payload.
- `generatedBy` metadata remains correct.
- Arc Director break instruction remains hidden before break phase.

Exit criteria:

- Server context preview is trustworthy before server generation is enabled.

## Phase 6: Deterministic Policy Engine

Goal: implement hard policy gates and account safety events before public sharing and before server generation broadens.

Tasks:

- Add policy package or API module.
- Define `PolicyDecision`.
- Define versioned rulesets as data, not scattered TypeScript conditionals.
- Add input, context, output, memory-write, import, share, and profile gates.
- Add policy decision storage.
- Add account safety event storage.
- Add account restriction resolver.
- Add deterministic unit fixtures.
- Add adversarial fixtures for hard-block categories.
- Add safe user-facing blocked-turn messages.
- Add blocked assistant placeholder behavior.
- Add context item attribution for blocked context decisions.

Rule storage:

- Code defines category ids, decision shapes, severity handling, and gate wiring.
- Rule packs live in database records, deployment config, or admin-managed JSON loaded by the backend.
- Do not scatter graphic banned-content phrases through UI code, reducer code, or provider code.
- Tests should use sanitized category fixtures and minimal representative examples.
- Admin tooling shows rule ids, categories, actions, severity, and notes.

Hard-block categories:

- minor or minor-coded sexual content
- sexual exploitation, grooming, trafficking, or coercion
- non-consensual sexual content or sexualized violence
- sexual content involving animals
- sexual content involving corpses or unconscious/non-participating people
- eroticized torture, cruelty, mutilation, or suffering
- real-person sexual content without consent
- illegal sexual content by jurisdiction or provider contract
- instructions enabling abuse, evasion, exploitation, or harm
- doxxing/private data exposure
- self-harm instruction or encouragement
- malicious cyber instructions
- extremist recruitment or operational support

Allowed when profile permits and no hard block applies:

- consensual adult romance
- consensual adult sexual content
- adult flirting and innuendo
- fictional violence within content profile limits

Policy decision shape:

```ts
interface PolicyDecision {
  id: string;
  policyVersion: string;
  rulesetVersion: string;
  gate: "input" | "context" | "output" | "memoryWrite" | "import" | "share" | "profile";
  subjectType: "message" | "context" | "modelOutput" | "memoryProposal" | "adventure" | "scenario" | "attachment" | "profile";
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

Account safety tables:

```text
account_safety_events
account_restrictions
account_status_history
admin_actions
```

Account states:

```text
normal
watched
restricted
generation_hold
banned
```

Rules:

- No share/publish without share gate.
- No durable AI memory write without memory-write gate.
- No provider call without input and context gates.
- No assistant output persistence without output gate.
- Input gate blocks before provider call.
- Context gate blocks after context build but before provider call.
- Output gate blocks before text is shown or persisted.
- Import gate blocks or quarantines imported JSON before it becomes trusted backend adventure material.
- Share gate blocks public scenario publishing and share links before visibility.
- Ambiguous or low-confidence hits block content but do not automatically restrict the account.
- Deterministic severe hard-block matches create an `account_safety_event`.
- Severe hard-block matches immediately disable public sharing and scenario publishing.
- Repeated severe events can move an account to `generation_hold`.
- Critical illegal-content attempts can move directly to `generation_hold` or `banned`, depending on the deployed ruleset.
- Admin review can lift, extend, or convert restrictions.
- Classifier labels may be used, but deterministic rules decide outcomes.

Blocking behavior:

- Blocked input returns a neutral refusal and no provider request is made.
- Blocked context identifies the section/item when possible and no provider request is made.
- Blocked output is never displayed raw to the user.
- Blocked output stores a placeholder assistant event and a policy decision.
- Blocked memory writes do not create or update Story Cards, Brains, Plot Essentials, or Active Pressure.
- Blocked imports remain quarantined or rejected.
- Blocked shares remain private and unpublished.
- Severe blocked attempts create account safety events for restriction evaluation.

Exit criteria:

- Hard-block fixtures fail closed.
- Allowed consensual adult fixtures pass when profile permits.
- Policy decisions are stored and inspectable.
- Account safety events are stored and inspectable.
- Restricted accounts lose sensitive capabilities through entitlement/access checks.
- Provider-call tests prove blocked input/context does not call the model.
- Output tests prove blocked output is not persisted as visible assistant text.

## Phase 7: Prompt-Injection Defense

Goal: make untrusted text unable to override app, policy, billing, provider, or tool behavior.

Tasks:

- Add trust-level metadata to context items.
- Add provenance metadata for imports, scenario text, previous model output, user-authored instructions, and system instructions.
- Add prompt-injection detector rules.
- Add context gate checks for instruction override attempts.
- Add import/share gate checks for malicious scenario text.
- Add tests for common injection patterns.
- Update system shell to clarify instruction precedence.

Trust levels:

```text
system: app/server generated instruction
policy: server policy or entitlement instruction
userInstruction: user-authored AI Instructions or Author's Note
currentUserInput: current user message
adventureData: Story Cards, Brains, components, transcript
externalData: imported/shared/scenario text
modelOutput: previous assistant text
```

Blocked or flagged injection patterns:

- attempts to override system/developer/policy instructions
- attempts to reveal hidden prompts or policy text
- attempts to disable safety, billing, logging, or moderation
- attempts to make imported scenario text act as higher-priority instruction
- attempts to exfiltrate provider keys, session tokens, or internal IDs
- attempts to induce hidden tool use or backend actions from story prose

Implementation rules:

- The model never receives provider credentials.
- The backend never executes commands from model prose.
- Public scenario text is always data.
- Imported text is always data.
- Previous model output is always data.
- Context Preview exposes section provenance and trust level.

Exit criteria:

- Prompt-injection fixtures are blocked or downgraded to inert story data.
- Context Preview shows enough provenance to inspect suspicious items.
- No hidden tool or provider secret is reachable through model output.

## Phase 8: Server-Side Turn Execution

Goal: move backend-mode generation behind the locally hosted API.

Tasks:

- Add `POST /adventures/:id/turn`.
- Load user, subscription, profile, and adventure.
- Run entitlement check.
- Run input policy gate.
- Apply user-message reducer action.
- Build context server-side.
- Run context and prompt-injection gates.
- Select provider/model server-side.
- Call provider with server-owned credentials.
- Strip control tags.
- Run output policy gate.
- Persist allowed assistant response.
- Persist blocked-turn placeholder for blocked outputs.
- Append model-call and usage records.
- Enqueue background jobs.

Tables:

```text
model_call_events
usage_ledger
policy_decisions
context_build_events
worker_jobs
```

Blocked output behavior:

- Do not show blocked raw output.
- Persist user message and blocked assistant placeholder.
- Do not increment successful generation counters.
- Log provider cost internally.
- Make user-facing quota behavior explicit in plan terms.

Provider configuration:

- Provider base URL, API key, model, sampler defaults, token caps, and routing live in backend configuration.
- Users do not see or edit backend-mode provider settings in this phase.
- Local mode keeps its existing BYO provider settings for the owner's/dev workflow.
- Backend mode can later expose model tiers or runtime profiles only after entitlement and abuse controls exist.

Exit criteria:

- Backend mode can complete a turn without browser provider keys.
- Usage and policy decisions are recorded.
- Local mode still runs browser-to-provider generation.

## Phase 9: Scenario Publishing And Adventure Sharing

Goal: add sharing after policy and injection gates exist.

Tasks:

- Add scenario tables.
- Add scenario draft UI/API.
- Add scenario revision API.
- Add publish endpoint.
- Add share/fork endpoint.
- Add private adventure snapshot share links.
- Add report endpoint.
- Add moderation/admin views.

Tables:

```text
scenarios
scenario_revisions
scenario_assets
scenario_publications
scenario_forks
scenario_share_links
adventure_share_links
scenario_reports
```

Rules:

- Public scenario revisions are immutable.
- Publishing runs share policy and prompt-injection gates.
- Private adventure transcript is excluded from scenario export unless explicitly selected.
- Share links are revocable.
- Forking copies content into the recipient account.
- Reported public content can be hidden by admin action.

Exit criteria:

- A user can publish a policy-cleared scenario revision.
- Another user can fork it.
- A user can revoke a share link.
- Unsafe or injection-bearing scenario text cannot be published publicly.

## Phase 10: Subscriptions And Usage

Goal: gate expensive features and context usage server-side.

Tasks:

- Add plan definitions.
- Add subscriptions table.
- Add effective entitlement resolver.
- Add Stripe checkout endpoint.
- Add Stripe customer portal endpoint.
- Add idempotent webhook endpoint.
- Add usage ledger display API.
- Gate model tier, context tokens, output tokens, backend adventure count, background jobs, and publishing.

Tables:

```text
plans
subscriptions
entitlement_grants
usage_ledger
billing_webhook_events
subscription_events
```

Entitlement resolver:

```ts
interface EffectiveEntitlements {
  planCode: string;
  status: "trialing" | "active" | "past_due" | "grace" | "canceled" | "unpaid" | "comped";
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

Rules:

- Never trust the client for subscription state.
- Checkout success does not grant access until webhook or provider verification confirms state.
- Webhooks are idempotent.
- Usage ledger is append-only.
- Provider cost and user-visible credits are separate fields.

Exit criteria:

- Plan limits affect generation before provider calls.
- Usage is visible to users.
- Admin can grant credits or comp accounts.
- Billing webhook replay is safe.

## Phase 11: Workers And Background Jobs

Goal: move background AI work out of browser tabs for backend adventures.

Tasks:

- Add Redis and BullMQ.
- Add worker app/process.
- Move semantic evaluation to worker for backend adventures.
- Move memory detection/cycle to worker for backend adventures.
- Add retry and dead-letter handling.
- Add job usage accounting.
- Add user-visible background job status where useful.

Worker jobs:

- semantic evaluation
- memory detection
- memory cycle
- Story Card audit
- Brain audit
- import processing
- export packaging
- thumbnail generation
- report processing

Exit criteria:

- Backend background jobs continue after browser close.
- Worker jobs use same shared engine and same policy engine.
- Failed jobs are inspectable.

## Phase 12: Admin And Support Console

Goal: make the production system operable.

Tasks:

- Add admin roles.
- Add user lookup.
- Add adventure diagnostics.
- Add model-call view.
- Add context build event view.
- Add policy decision view.
- Add subscription view.
- Add invite management.
- Add report queue.
- Add admin action audit log.

Admin rules:

- Every admin action is audit-logged.
- Raw text visibility follows retention and permission rules.
- Support can diagnose without reading private content by default.
- Account holds and credits are explicit actions.

Exit criteria:

- A failed turn can be diagnosed from logs.
- A blocked policy decision can be inspected.
- Invite abuse can be traced.
- Subscription problems can be resolved without database spelunking.

## Test Matrix

Keep existing validation:

```sh
npm.cmd test
npm.cmd run build
npm.cmd run smoke:prod
```

Add backend validation:

```sh
npm.cmd run test:api
npm.cmd run test:engine
npm.cmd run test:policy
npm.cmd run test:integration
```

Required test groups:

- reducer parity
- context payload golden tests
- import/export round trip
- local mode adapter tests
- backend mode adapter tests
- invite gate tests
- OAuth callback/auth hook tests
- policy hard-block fixtures
- consensual adult allowed fixtures
- prompt-injection fixtures
- server turn orchestration integration
- usage ledger accounting
- billing webhook idempotency
- scenario publish/fork/share tests
- data deletion tests

## Rollout Order

Use feature flags:

```text
backendModeEnabled
backendGenerationEnabled
scenarioPublishingEnabled
subscriptionsEnabled
policyStrictModeEnabled
workerJobsEnabled
adminConsoleEnabled
```

Recommended rollout:

1. Internal local mode only.
2. Internal backend save import/export.
3. Internal server context preview.
4. Internal server generation.
5. Invite-only alpha with no public sharing.
6. Invite-only alpha with private sharing.
7. Scenario publishing for trusted users.
8. Subscriptions in test mode.
9. Subscriptions in production mode.
10. Wider invite batches.

## Done Definition

The backend migration is not done when the API exists. It is done when:

- local mode still works
- backend mode works without browser provider keys
- invite-only account creation is enforced
- generation is entitlement-gated
- hard policy gates run on input/context/output/memory/share/import
- prompt-injection fixtures fail safely
- scenario publishing is revisioned and policy-gated
- adventure sharing is revocable
- subscriptions update through idempotent webhooks
- usage is ledgered and visible
- support/admin can diagnose failed, blocked, or expensive turns
- current JSON import/export remains compatible
