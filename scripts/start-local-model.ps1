param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'local-model.local.json'),
    [switch]$ValidateOnly,
    [switch]$Watch
)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$logDirectory = if ($config.logDirectory) { [string]$config.logDirectory } else { '.local-model/logs' }
if (-not [IO.Path]::IsPathRooted($logDirectory)) { $logDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) $logDirectory }
$logDirectory = [IO.Path]::GetFullPath($logDirectory)
if ($Watch) {
    if ($ValidateOnly) { throw 'Choose either -Watch or -ValidateOnly.' }
    $latestLog = Get-ChildItem -LiteralPath $logDirectory -Filter 'llama-server-*.events.log' -File -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $latestLog) { throw 'No server logs found. Start the inference server first.' }
    Write-Output "Watching $($latestLog.FullName). Ctrl+C stops this viewer, not the inference server."
    Get-Content -LiteralPath $latestLog.FullName -Tail 40 -Wait
    return
}
if ($config.host -ne '127.0.0.1') { throw 'Only host 127.0.0.1 is allowed. This launcher does not expose the server to other devices.' }
if ($config.port -isnot [long] -and $config.port -isnot [int]) { throw 'port must be an integer.' }
if ($config.port -lt 1024 -or $config.port -gt 65535) { throw 'port must be between 1024 and 65535.' }
if ($config.contextTokens -lt 1024 -or $config.contextTokens -ne [int]$config.contextTokens) { throw 'contextTokens must be an integer of at least 1024.' }
if ($config.gpuLayers -ne 'auto' -and (($config.gpuLayers -isnot [int] -and $config.gpuLayers -isnot [long]) -or $config.gpuLayers -lt 0)) { throw 'gpuLayers must be auto or a non-negative integer (0 = CPU).' }
$gpuMargin = if ($null -eq $config.gpuMemoryMarginMiB) { 1024 } else { $config.gpuMemoryMarginMiB }
if (($gpuMargin -isnot [int] -and $gpuMargin -isnot [long]) -or $gpuMargin -lt 256 -or $gpuMargin -gt 8192) { throw 'gpuMemoryMarginMiB must be an integer from 256 to 8192.' }
if ($config.modelAlias -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'Use letters, digits, dots, hyphens or underscores for modelAlias.' }
$origin = $null
if (-not [Uri]::TryCreate($config.allowedOrigin, [UriKind]::Absolute, [ref]$origin) -or
    $origin.Scheme -ne 'https' -or $origin.UserInfo -or $origin.Query -or $origin.Fragment -or
    $config.allowedOrigin -cne $origin.GetLeftPart([UriPartial]::Authority)) {
    throw 'allowedOrigin must be one HTTPS origin without a path or trailing slash, such as https://press-lab.github.io.'
}
if (-not (Test-Path -LiteralPath $config.modelPath -PathType Leaf) -or [IO.Path]::GetExtension($config.modelPath) -ne '.gguf') { throw 'modelPath must point to an existing GGUF file.' }
$serverPath = $config.serverExecutable
if ($serverPath -eq 'auto') {
    $command = Get-Command llama-server.exe -ErrorAction SilentlyContinue
    if ($command) { $serverPath = $command.Source }
    else {
        $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        $candidates = @(Get-ChildItem -LiteralPath $packages -Directory -Filter 'ggml.llamacpp_*' -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'llama-server.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
        if ($candidates.Count -ne 1) { throw 'Set serverExecutable to the full path of the pinned llama-server.exe build.' }
        $serverPath = $candidates[0]
    }
}
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) { throw 'serverExecutable was not found.' }
if (-not $config.requiredVersion) { throw 'Set requiredVersion to the tested llama.cpp build commit.' }
$logVerbosity = if ($null -eq $config.logVerbosity) { 4 } else { $config.logVerbosity }
if ($logVerbosity -lt 3 -or $logVerbosity -gt 5 -or $logVerbosity -ne [int]$logVerbosity) { throw 'Live progress requires logVerbosity from 3 to 5 (4 = trace, 5 = debug).' }
$logFile = Join-Path $logDirectory ("llama-server-{0}-{1}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), $PID)
$eventLog = $logFile -replace '\.log$', '.events.log'
$cachePrompt = if ($null -eq $config.promptCaching) { $true } else { $config.promptCaching }
if ($cachePrompt -isnot [bool]) { throw 'promptCaching must be true or false.' }
$cacheRam = if ($null -eq $config.cacheRamMiB) { 8192 } else { $config.cacheRamMiB }
$checkpoints = if ($null -eq $config.contextCheckpoints) { 32 } else { $config.contextCheckpoints }
$checkpointStep = if ($null -eq $config.checkpointMinTokens) { 1024 } else { $config.checkpointMinTokens }
foreach ($setting in @(@{Name='cacheRamMiB';Value=$cacheRam;Max=32768}, @{Name='contextCheckpoints';Value=$checkpoints;Max=64}, @{Name='checkpointMinTokens';Value=$checkpointStep;Max=32768})) {
    if (($setting.Value -isnot [int] -and $setting.Value -isnot [long]) -or $setting.Value -lt 0 -or $setting.Value -gt $setting.Max) { throw "$($setting.Name) must be an integer from 0 to $($setting.Max)." }
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 20 or newer is required for live inference progress. Install Node.js or add it to PATH.' }
$nodePath = $nodeCommand.Source
$nodeMajor = & $nodePath -p 'process.versions.node.split(".")[0]'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 20) { throw 'Node.js 20 or newer is required for live inference progress.' }
$timeZone = if ($config.timeZone) { [string]$config.timeZone } else { 'America/Phoenix' }
$versionText = (& $serverPath --version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or -not $versionText.Contains([string]$config.requiredVersion)) { throw 'llama-server version does not match requiredVersion. Use the pinned build or validate a replacement before updating the configuration.' }
$serverArgs = @('--model', $config.modelPath, '--alias', $config.modelAlias,
    '--host', '127.0.0.1', '--port', [string]$config.port,
    '--ctx-size', [string]$config.contextTokens, '--parallel', '1', '--n-gpu-layers', [string]$config.gpuLayers,
    '--fit', 'on', '--fit-target', [string]$gpuMargin, '--fit-ctx', [string]$config.contextTokens,
    '--cors-origins', $config.allowedOrigin, '--no-cors-credentials', '--reasoning', 'off', '--jinja', '--no-agent',
    '--log-verbosity', [string]$logVerbosity, '--log-prefix', '--log-timestamps', '--log-colors', 'off',
    '--log-file', $logFile, '--perf')
$serverArgs += @($(if ($cachePrompt) { '--cache-prompt' } else { '--no-cache-prompt' }), '--cache-ram', [string]$cacheRam,
    '--ctx-checkpoints', [string]$checkpoints, '--checkpoint-min-step', [string]$checkpointStep, '--cache-idle-slots')
if ($config.apiKeyFile) {
    if (-not (Test-Path -LiteralPath $config.apiKeyFile -PathType Leaf)) { throw 'apiKeyFile was not found.' }
    $serverArgs += @('--api-key-file', $config.apiKeyFile)
}
Write-Output "Verified runtime: $($versionText.Trim())"
Write-Output "Model: $($config.modelPath)"
Write-Output "Configured address: http://127.0.0.1:$($config.port)/v1 (this PC only; wait for the server's listening message)"
Write-Output "Allowed browser origin: $($config.allowedOrigin)"
Write-Output "Context: $($config.contextTokens) tokens; GPU layers: $($config.gpuLayers)"
Write-Output "GPU memory margin: $gpuMargin MiB; automatic fitting keeps the configured context capacity"
Write-Output "Logging: verbosity $logVerbosity; timestamps and performance timings enabled"
Write-Output "Log file: $logFile"
Write-Output "Live events: $eventLog (timestamps in $timeZone; updates every 5 seconds)"
Write-Output "Cache default: $cachePrompt; saved-state RAM limit: $cacheRam MiB; checkpoints: $checkpoints; minimum spacing: $checkpointStep tokens"
if ($ValidateOnly) { return }
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$config.port)
$portProbe.Server.ExclusiveAddressUse = $true
try { $portProbe.Start() }
catch { throw "127.0.0.1:$($config.port) is already in use. Stop the existing inference server before starting another copy." }
finally { $portProbe.Stop() }
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Write-Output "Startup begins: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
Write-Output 'Watch for model loading details, then the listening message. Requests print prompt processing progress, generation speed and total timings.'
$serverStopwatch = [Diagnostics.Stopwatch]::StartNew()
# Prevent inherited llama.cpp environment options from enabling unrelated services or tools.
$savedEnvironment = @(Get-ChildItem Env: | Where-Object { $_.Name -like 'LLAMA_*' })
try {
    foreach ($entry in $savedEnvironment) { Remove-Item -LiteralPath "Env:$($entry.Name)" }
    & $nodePath (Join-Path $PSScriptRoot 'local-inference-runner.mjs') $serverPath (ConvertTo-Json -InputObject @($serverArgs) -Compress) $eventLog $timeZone
    if ($LASTEXITCODE -ne 0) { throw "Local server exited with code $LASTEXITCODE." }
} finally {
    $serverStopwatch.Stop()
    Write-Output ("Server session ended after {0:N1} seconds. Log saved to {1}" -f $serverStopwatch.Elapsed.TotalSeconds, $logFile)
    foreach ($entry in $savedEnvironment) { Set-Item -LiteralPath "Env:$($entry.Name)" -Value $entry.Value }
}
