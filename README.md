# AI Story Teller

A browser-only app for building and playing long-running AI adventures. It uses React, TypeScript, Vite, IndexedDB persistence, and OpenAI-compatible provider calls made directly from the browser. Users supply their own API key in Settings. There is no backend.

Live app: GitHub Pages, deployed from `main`. Saves can optionally sync to a separate GitHub repo (see [GitHub saves](#github-saves)).

## Setup

```sh
npm.cmd install
npm.cmd run dev        # Vite dev server on port 5173
npm.cmd run build      # TypeScript check + static bundle in dist/
npm.cmd run preview    # serve the production build locally
```

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`, which builds `dist/` and publishes it to GitHub Pages. `.github/workflows/ci.yml` runs the tests on pushes and pull requests. `vite.config.ts` uses `base: "./"` so the bundle works from a Pages project path. No server configuration is needed.

## How it works (short version)

- **State:** every adventure change goes through `adventureReducer(state, action)` in `src/state/adventureReducer.ts`. Nothing mutates adventure objects directly.
- **Persistence:** adventures live in IndexedDB (`src/db/adventureDb.ts`). localStorage holds small runtime settings, including the provider API key. API keys are stripped from exports and saves.
- **Context:** `src/contextBuilder/contextBuilder.ts` builds the exact provider payload that Context Preview shows. Every token belongs to a named, inspectable section. There is no opaque memory bucket. The payload is ordered for provider prefix caching: a stable system prefix, then chunk-aligned recent history, then a per-turn `[TURN CONTEXT]` block (Story State, triggered Story Cards, Brains, Author's Note, Next Output Bias, Continuity Challenge) inside the newest user message.
- **Turn loop:** `src/state/turnPipeline.ts` and `src/hooks/useAdventureRuntime.ts`. The narrator only narrates. It is never asked for memory output.
- **Memory:** one background memory pass (`src/memory/compactMemoryFallback.ts`) runs every N story turns (Settings → Automatic memory; default 3) and suggests Story State, character thought/knowledge, Story Card, and plot updates. Suggestions follow per-type auto-approve toggles; everything else waits in Memory Suggestions. Story State rewrites are reviewed by default.

The full section order, memory surfaces, and system behavior are in [`FEATURES.md`](./FEATURES.md). The rules contributors and agents must follow are in [`AGENTS.md`](./AGENTS.md). All other docs are indexed in [`docs/README.md`](./docs/README.md).

## GitHub saves

Optional. With a GitHub token (stored only in localStorage), the app writes save slots and a sync bundle into a separate repository, `press-lab/AI-Stoyer-Teller-Saves` (the spelling is intentional). Code lives in `src/sync/`. The save layout and repair rules are documented in `.claude/agents/aist-workspace.md`.

## Testing

```sh
npm.cmd test
npm.cmd run build
npm.cmd run smoke:prod
```

The deterministic suite covers context order and inclusion, trigger matching, reducer actions, AI memory-write boundaries, memory classification, Memory Suggestions approval, backup/restore, and a multi-turn play smoke path. It uses mocked providers, so it proves routing and call counts, not model quality.

Live provider checks are opt-in and read `.env.test.local` (git-ignored; use throwaway keys only):

```sh
npm.cmd run test:live
```

## Known limitations

- Token counts are approximate by design (`src/tokenizer/approximateTokenCount.ts`).
- Provider support is OpenAI-compatible chat completions. DeepSeek works with the default base URL and model; other compatible providers are configured in Settings.
- Trigger actions are edited as JSON for inspectability.
- `src/autoCards/*` and `src/quests/questEngine.ts` are empty legacy stubs kept so old imports still load.
