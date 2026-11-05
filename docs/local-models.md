# Local models from GitHub Pages

AIST stays on GitHub Pages. Its browser frontend sends prompts directly to an inference server on the same PC. The server loads the model file and returns generated text. GitHub does not handle inference requests. GitHub save synchronization is separate.

## Scope

The Local option accepts only `127.0.0.1`, `localhost`, or `[::1]`. The supplied Windows launcher binds only to `127.0.0.1`. Other devices and the internet cannot connect directly to that listener. No router forwarding, network binding, cloud fallback, or desktop wrapper is needed.

Localhost refers to the device running the browser. Opening AIST on a phone does not reach the PC's model. This setup targets a desktop browser on the same Windows PC as the model. Browser compatibility must be checked from the deployed page.

## Configure and start Qwen

The supplied example targets the GGUF at `D:\Models\llama-cache\Qwen-Turbo-Q4_K_M.gguf`. A Safetensors directory is not interchangeable with a GGUF. The pinned llama.cpp runtime must support the model architecture and chat template.

The initial runtime is llama.cpp build 12121, commit `e56f006ed` (version reports `0.9.0-dev`), already installed on the development PC. Keep this build or explicitly validate a replacement and update `requiredVersion`. See the [official llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) and [server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). AIST does not install binaries or download weights automatically.

From the application repository in PowerShell 7 (`pwsh`, installed on the development PC):

```powershell
Copy-Item scripts/local-model.example.json scripts/local-model.local.json
notepad scripts/local-model.local.json
```

Set these fields:

| Field | Meaning |
| --- | --- |
| `serverExecutable` | Full path to `llama-server.exe`, or `auto` to discover an installed executable |
| `requiredVersion` | Tested runtime commit; startup fails on a different build |
| `modelPath` | Full GGUF path; any local model directory is allowed |
| `modelAlias` | Stable API model ID, initially `aist-qwen` |
| `host` | Must remain `127.0.0.1` |
| `port` | Initially `8080`; change if occupied |
| `contextTokens` | Initially `32768`; must match the AIST preset |
| `gpuLayers` | Initially `auto`; use available GPU memory automatically, or set a non-negative layer count (`0` = CPU) |
| `gpuMemoryMarginMiB` | Initially `1024`; reserve this GPU memory margin during fitting (256 to 8192 MiB) |
| `allowedOrigin` | Exact HTTPS origin, initially `https://press-lab.github.io`, without a repository path or trailing slash |
| `apiKeyFile` | Optional private file containing a local server key; leave empty for no authentication |

`auto` checks PATH and the user's WinGet llama.cpp installation. If detection is ambiguous, set the executable's full path. Keep model files and private configuration outside tracked files. `scripts/local-model.local.json` and `.local-model/` are ignored by Git.

Validate without starting, then run:

```powershell
.\scripts\start-local-model.cmd -ValidateOnly
.\scripts\start-local-model.cmd
```

Keep the terminal running. Ctrl+C stops the server. Changing the weights path or runtime configuration requires restarting it. The launcher checks whether the loopback port is occupied and refuses to start another copy on that port. It does not stop existing inference processes.

The `.cmd` entry point finds PowerShell 7 on PATH, in its normal installation directory, or in the existing Codex runtime. The legacy `powershell.exe` has script execution disabled on the development PC. No execution-policy or firewall changes are needed. You can also run `pwsh -NoProfile -File scripts/start-local-model.ps1` directly from a PowerShell 7 installation.

Automatic GPU fitting uses the installed backend and available VRAM while keeping the configured context capacity as the fitting minimum. Numeric layer counts remain supported, including 0 for CPU inference. A large model can require a CPU/GPU split. Disk file size is not a complete RAM/VRAM estimate. See [GPU performance measurements](local-gpu-performance.md).

## Configure AIST

1. Open the deployed GitHub Pages application on the same PC.
2. Open Settings, select **Add Model**, then **Local (this device)**.
3. Set Base URL to `http://127.0.0.1:8080/v1`, Model to `aist-qwen`, and context capacity to `32768` (or your server's values).
4. Select the llama.cpp/Qwen runtime profile. This sends `chat_template_kwargs.enable_thinking=false`. The launcher also starts with reasoning disabled. The model's template must honor these controls.
5. Use no authentication unless you configured `apiKeyFile`. If configured, select API key and enter that key. Never reuse a cloud provider key.
6. Select **Test Connection / Refresh Models**. Permit local network access if the browser asks. Select a discovered model or retain manual entry.
7. Select **Test Generation**. Connection success alone does not prove inference works.
8. Select **Use** for this preset.
9. Check the narration and background routing shown below the model list. To run all background tasks on the active local connection, choose **Use active connection and model**. Existing overrides are preserved until you change them.

Selecting or adding a model makes no test request automatically. Tests are cancellable and their status resets when the configuration changes. Settings and keys are stored in this browser's localStorage. API keys are excluded from adventure exports and IndexedDB. Model paths stay in the launcher configuration.

Existing presets keep their saved capacity. After increasing the server to 32768 tokens, update the saved Local preset's context capacity to 32768 too. With a 2048-token output limit, 30208 tokens remain for the prompt after the safety margin. To use that space, set the adventure's Context Budget â†’ Max Context Tokens to 30208; a smaller authored budget still takes precedence.

## Server logging and timings

The launcher uses Node.js 20 or newer to format native server events and sample slot counters. It prints wall-clock timestamps in `timeZone` (default `America/Phoenix`). `LOADING MODEL` includes elapsed startup time until `READY`. Each assigned inference task gets `NEW REQUEST` with its native task/slot ID, then approximately five-second `PROCESSING` or `GENERATING` updates even while native output is quiet. Available processed/cached/generated token counters are included. Missing counters are omitted.

`COMPLETE` is emitted only after native completion timings are observed. It includes observed elapsed time and reported prompt/generation/runtime timings. Elapsed server time starts when the task is assigned to a slot; AIST's HTTP elapsed time also includes client/network/queue overhead. Explicit native cancellation/errors produce `CANCELLED`/`FAILED`. A slot released without completion evidence is `INTERRUPTED`; the logger does not guess whether a disconnect, cancellation, or another interruption caused it. Inference completion does not imply AIST's story or memory validation succeeded.

Formatted events are printed to the terminal and saved to `.local-model/logs/llama-server-<timestamp>-<process>.events.log`. Full native diagnostics remain in the corresponding `.log` file. Both are ignored by Git. `logDirectory` accepts an absolute path or a path relative to the application repository. `logVerbosity` must be 3–5 so task events remain observable; default 4 adds trace/cache detail. Debug level 5 can include request text in the raw log. The formatted event log stores counters/status only, not prompts or generated text.

To follow the newest log in a second terminal:

```powershell
.\scripts\start-local-model.cmd -Watch
```

Ctrl+C stops the viewer without stopping inference. After restarting the server, run the viewer again to follow the new log file.

Restart the local server to apply logging changes. AIST does not need a frontend update for these launcher settings. The launcher still binds only to `127.0.0.1` and keeps the configured reasoning mode off.

## Local prompt caching

For the llama.cpp runtime profile, **Local prompt caching** sends `cache_prompt` explicitly (default on). This field is not sent to online providers or unspecified compatible servers. AIST still sends the complete current prompt; the runtime reuses only compatible cached state. Prompt content, section order, chronological message order, memory validators and approvals are unchanged.

Server configuration supports:

| Setting | Default | Meaning |
| --- | --- | --- |
| `promptCaching` | `true` | Server default; a request can explicitly override it |
| `cacheRamMiB` | `8192` | Bounded saved-state RAM cache; 0 disables that pool, not all active-slot state |
| `contextCheckpoints` | `32` | Maximum checkpoints per slot |
| `checkpointMinTokens` | `1024` | Minimum spacing between checkpoints |
| `timeZone` | `America/Phoenix` | Wall-clock timestamps in the formatted log |

The initial measured profile keeps one inference slot and an 8 GiB saved-state cache. Saved states allow narration to resume after background work when a compatible snapshot remains available. This cache is in memory and does not survive restarting the server. Do not enable KV shifting or rearrange context sections for this model without separate compatibility/quality testing.

Context Preview shows the first changed section and a common serialized-input prefix compared with the previous narration attempt in this session. This character comparison is a diagnostic, not a measured token-cache hit. Actual reported cached/processed tokens and prompt/generation/HTTP elapsed times appear with HTTP attempts. Missing metrics remain unknown. The comparison is transient and is not added to model prompts or adventure data.

To reproduce the synthetic measurements on an idle local server:

```powershell
npm.cmd run bench:local-cache
npm.cmd run test:local-server
```

The benchmark sends small synthetic inference requests (no adventure data) covering repeat, append, sliding history, card/arc/clock edits, and narration after a background request. It prints only timing/token measurements and never changes the server configuration. Use `AIST_LOCAL_API_KEY` only if your local server requires authentication. See [measured results](local-cache-benchmark.md). A clock or other early-prefix change can still force full processing. Faster input processing does not imply faster generation of each output token.

## Context and memory

For narration and Context Preview, the prompt budget is capped by the local context capacity minus the actual story output limit and a 512-token margin. The actual output limit uses the existing story-length cap, bounded by the preset maximum, with a hidden-envelope reserve when applicable. A large saved output maximum therefore does not reserve the entire window for a short story turn. Background tasks validate their own output limits. New Local presets start with a 2048-token output maximum rather than inheriting an online preset's value.

Context assembly keeps the existing section order and protected content rules. A final request check refuses oversized prompts; it does not silently delete protected content. Counts are estimates, and a server can still report an exact-token overflow. Configuration errors show the actual capacity, output limit, and remaining prompt space.

Background overrides never inherit a key from a different endpoint. A copied background preset is a snapshot: later preset edits do not automatically update it. Existing background settings remain available under Advanced settings.

Use the compatible Chat API for local memory evaluation. Strict Responses transport is not supported by this initial local integration. The llama.cpp profile supplies its documented thinking-off field. Other compatible runtimes must declare a documented memory reasoning control. Reported reasoning still causes memory evaluation to fail; hiding reasoning is not disabling it. Existing evidence checks, parsers, proposals, and approval rules remain authoritative.

## Browser access and troubleshooting

The server's CORS origin must match `window.location.origin` of the deployed app. For the standard deployment it is `https://press-lab.github.io`, not the URL including `/AI-Story-Teller-Pages/`.

Browsers can require local network permission before an HTTPS page contacts loopback. See [Chrome's Local Network Access documentation](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access). Browser behavior varies; do not disable browser security or add wildcard CORS as a workaround. A denied permission, CORS failure, unreachable port, or redirect may appear as the same browser network error. AIST lists the checks without claiming to identify which one occurred.

If discovery is unsupported, manually enter the model ID and test generation. If the server is loading, wait for its ready message. On HTTP 401, check authentication. On a context error, reduce the prompt/output budget or increase both the server capacity and preset capacity. On timeout, check model speed and increase the timeout if appropriate. AIST never switches to an online model automatically.

To inspect the listener on Windows:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8080 |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

It should show `127.0.0.1`, never `0.0.0.0` or a network address. CORS restricts browser origins; it is not authentication against other programs on this PC. Optional API-key authentication adds that separate control.

## Release verification

Automated tests cover loopback validation, authentication, payloads, endpoint isolation, discovery, failures, cancellation/timeouts, context limits, and memory safeguards. Run `npm.cmd test`, `npm.cmd run build`, `npm.cmd run smoke:prod`, and `git diff --check`.

Then test the actual deployed HTTPS page against the running model: discovery, generation, narration, and memory evaluation. Verify the listener address, saved preset after reload, explicit background routing, and clear failure with the server stopped. A local preview or direct API request does not establish deployed-browser support. Record automated, direct-runtime, and deployed-browser results separately.
