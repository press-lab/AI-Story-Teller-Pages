# Play loading feedback regression

The request handlers queued `setLoading(true)` but did not yield for a browser paint before synchronous preparation/context work. `prepareNarration()` being async did not fix this: with no running memory worker, its already-resolved promise continued through microtasks before paint. React could commit the dots to the DOM while the screen still showed the previous frame.

The recent one-hop pass (2dd2527) increased this pre-paint work. It loops over surviving context sources, selects event memories for each source, and matches remaining cards. On the real large save, this pass took 67-82 ms of a 103-139 ms context build. The six-card output cap does not cap matching work. This exposed an existing scheduling defect; neither the provider nor a delayed call to `setLoading(true)` caused the pause.

## Measurements

Local headless Chrome, Vite development modules, real PlayPage + useAdventureRuntime, with a fake pending provider. No paid requests or save-data writes. The real fixture contained 1,504 messages, 41 Story Cards, 7 Brains, and 981 proposals. A second fixture retained the history and substituted 1,000 cards, 100 Brains, and 2,000 proposals. It is intentionally synthetic, not a claim that card count alone predicts runtime: source selection and body size matter.

Times below are milliseconds from the actual button click. "Paint" means an animation-frame callback followed by a task checkpoint after observing the dots in the DOM. This measures a browser paint opportunity, not physical display latency. These are individual diagnostic samples, not statistical benchmarks or mobile-device timings. Raw events and payload fingerprints are in [play-loading-profile.json](../codex-artifacts/play-loading-profile.json).

| Fixture | Button | setLoading before / after | Dots DOM before / after | Paint before / after | Provider start before / after |
| --- | --- | ---: | ---: | ---: | ---: |
| Real | Action | 0.5 / 1.2 | 19.7 / 24.6 | 148.6 / 26.2 | 128.7 / 146.6 |
| Real | Continue | 0.5 / 0.6 | 23.8 / 32.1 | 184.2 / 34.5 | 164.6 / 166.9 |
| Real | Retry | 0.5 / 0.4 | 17.8 / 27.0 | 141.0 / 28.7 | 123.5 / 133.3 |
| Stress | Action | 0.5 / 0.3 | 24.1 / 26.7 | 100.1 / 28.0 | 84.5 / 90.8 |
| Stress | Continue | 0.4 / 0.3 | 16.4 / 25.8 | 97.3 / 27.2 | 82.0 / 89.1 |
| Stress | Retry | 0.4 / 0.3 | 16.5 / 24.7 | 95.6 / 26.2 | 79.5 / 90.0 |

Real-save context starts were 20.3/23.9/18.9 ms before the change and 28.3/34.7/30.0 ms after it (Action/Continue/Retry). The baseline prepare span includes React rendering while its wrapper awaited completion; with the explicit render separated, preparation completed in 0-1.6 ms. Rendering the loading state itself took roughly 17-31 ms. Full Chronicle rendering was already bounded to the latest 100 entries. No context build occurs merely because loading changes.

The fixed paint checkpoint precedes preparation and context assembly for every path and both fixtures. Matching costs remain; loading feedback no longer waits for them. The provider starts a little later in some samples because a frame is deliberately allowed first. Provider message fingerprints matched before/after in all six cases.

## Change and verification

All three narration paths share a loading transition: cancel the memory idle deadline immediately, synchronously commit loading/error feedback, and cross two animation-frame callbacks before preparation. Resolving in the first frame would resume microtasks before that frame paints. Hidden tabs use a task instead; a visibility-change listener releases the wait if the tab becomes hidden during the transition. Background tabs cannot display feedback, but their authorized requests continue.

Context assembly, Story Card matching, narration payload construction, reducers, memory evaluation, and saved data semantics are unchanged. There are no extra context builds, memory calls, full-history renders, or persisted profiling hooks. Retry preparation is now inside its existing try/finally so preparation failures also release the submission lock.

Regression tests exercise Action, Continue, and Retry through the actual PlayPage and runtime. They assert that dots are committed while pending-update flushing, context building, and provider calls have not started; that the first animation frame still does no preparation; and that the second releases exactly one request. They also cover repeated clicks, successful completion, errors, hidden tabs, frames suspended by a visibility change, and switching adventures before paint. Preparation checks the originating adventure ID so a delayed action cannot target the newly selected adventure. The existing memory-worker suite verifies worker-before-context ordering and memory commits. Its sequential-turn fixture now uses separate React acts for the two completed user interactions, allowing each loading reset to commit.
