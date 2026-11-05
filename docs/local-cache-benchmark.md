# Local cache measurements

Measured on 2026-11-05 with the installed Qwen GGUF, llama.cpp build 12121 (`e56f006ed`), CPU inference, one slot, 32768-token capacity, an 8192 MiB saved-state RAM cache, and at most 32 checkpoints. Both profiles ran the same synthetic sequence from `scripts/benchmark-local-cache.mjs`. No adventure data was read.

These requests reserve one output token to isolate input processing. Results are single observations on this PC, not a quality test, statistical performance guarantee, or prediction of full story-turn latency.

| Scenario | Cached tokens (1024 / 512 spacing) | Prompt seconds (1024 / 512 spacing) |
| --- | ---: | ---: |
| cache disabled | 0 / 0 | 21.35 / 21.14 |
| warm seed | 1821 / 1821 | 1.06 / 1.05 |
| identical prompt | 1821 / 1821 | 1.06 / 1.06 |
| appended exchange | 1808 / 1808 | 4.34 / 4.29 |
| oldest exchange removed | 1787 / 1787 | 4.30 / 4.31 |
| card changed | 1309 / 1309 | 7.96 / 7.92 |
| arc changed | 1313 / 1313 | 7.10 / 7.03 |
| clock changed | 0 / 0 | 21.04 / 21.62 |
| background task | 0 / 0 | 4.30 / 3.86 |
| narration after background | 1825 / 1825 | 1.38 / 1.18 |

Keep the 1024-token spacing as the initial profile: 512 produced the same cache reuse in these fixtures and no material improvement. This does not establish an optimum for every adventure. Cache reuse already survived the short background task with the saved-state RAM pool, so a second inference slot is not justified by this test.

An early story-clock edit lost the usable prefix and required full processing. Sections and authored context order were intentionally preserved. Later card/arc edits retained part of the prefix. The cache-disabled request still leaves processed state in the runtime; the following warm request measures reuse of that state.

Run the benchmark again after changing model, chat template, checkpoint limits, runtime build or hardware. If misses continue on real turns, use Context Preview's first-changed-section diagnostic and the raw checkpoint logs before changing prompt structure.
