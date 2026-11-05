# Local Qwen GPU performance checkpoint

On 2026-11-05, changed the local configuration from `gpuLayers: 0` (CPU only) to `gpuLayers: "auto"` with `gpuMemoryMarginMiB: 1024`. The launcher now accepts auto or numeric layer counts and sets `--fit on --fit-target 1024 --fit-ctx 32768` for the current configuration. No model, quantization, context order, or network-binding change was made.

Hardware: Intel i7-11700F (8 cores / 16 logical processors), approximately 64 GB system RAM, AMD Radeon RX 6800 XT (16368 MiB VRAM). The pinned runtime is llama.cpp build 12121, commit e56f006ed, with Vulkan available.

Model: `D:\Models\llama-cache\Qwen-Turbo-Q4_K_M.gguf`, approximately 18 GB on disk. Runtime context remains 32768 tokens, one slot, loopback-only `127.0.0.1:8080`. The fit utility first estimated 53 layers; actual server startup selected 57 of 65 layers. Actual choice depends on available memory. Startup reported a 12204.36 MiB Vulkan model buffer, 1792 MiB Vulkan KV buffer, 130.92 MiB Vulkan recurrent-state buffer and 257.75 MiB Vulkan compute buffer; some model/context state remains on the CPU.

Single synthetic observations, not a statistical speed guarantee:

| Workload | CPU-only | GPU auto |
| --- | ---: | ---: |
| Cache-disabled 1825-token prompt | 21.35 s | 11.23 s |
| Identical warm short prompt | 1.06 s | 0.40 s |
| Cache-disabled 20027-token prompt | Not measured | 202.99 s (98.66 tokens/s) |
| Warm repeat of that 20K prompt | Not measured | 0.52 s; 20023 cached, 4 processed |

The requested 20K fresh tokens in 30 seconds (about 667 tokens/s) is not achieved. Warm-cache results are not fresh-token throughput. The exact same model and quantization were retained. No smaller model, re-quantization, or alternative tensor placement was tested.

Reproduce on an idle server:

```powershell
npm.cmd run bench:local-cache
npm.cmd run bench:local-throughput
```

The throughput test sends about 20K synthetic input tokens with caching disabled and then repeats with caching enabled. It generates one output token to isolate prompt processing. Results do not measure normal story-output generation speed. No adventure data is read.

The current ignored configuration is `scripts/local-model.local.json`. Raw data from this run is in `.local-model/cache-benchmark-gpu-auto.local` and `.local-model/throughput-gpu-auto.local`; these local artifacts are intentionally not tracked. Keep the current GPU configuration as requested. Further tuning should isolate long-context CPU fallback, batch settings, and backend behavior without silently changing the model/quantization or reducing the context window.
