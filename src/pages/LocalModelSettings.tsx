import { useEffect, useRef, useState } from "react";
import type { ProviderPreset } from "./pageTypes";
import { Field, NumberInput } from "./shared";
import { discoverLocalModels } from "../providers/localProvider";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";

export function LocalModelSettings({ preset, onChange }: { preset: ProviderPreset; onChange: (patch: Partial<ProviderPreset>) => void }) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("Not tested. Start your local inference server, then test the connection.");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const configKey = JSON.stringify(preset);
  // Editing, deleting, collapsing or switching a preset invalidates an old result.
  useEffect(() => {
    setModels([]);
    setStatus("Not tested. Start your local inference server, then test the connection.");
    setBusy(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [configKey]);

  async function test(kind: "connection" | "generation") {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setStatus(kind === "connection" ? "Connecting to the local server…" : "Generating a short local test response…");
    const started = performance.now();
    try {
      if (kind === "connection") {
        const found = await discoverLocalModels(preset, controller.signal);
        if (controller.signal.aborted) return;
        setModels(found);
        setStatus(found.length ? `Connection ready. Found ${found.length} model(s). Generation has not been tested.` : "Connected. No models were listed. Load a model on the server or enter its ID manually.");
      } else {
        const result = await sendOpenAICompatibleChatCompletion({ config: { ...preset, maxOutputTokens: Math.min(preset.maxOutputTokens, 32) },
          messages: [{ role: "user", content: "Reply with only: Local model ready." }], signal: controller.signal, retry: false, purpose: "otherBackground" });
        if (controller.signal.aborted) return;
        if (!result.content.trim()) throw new Error("Local server returned an empty completion.");
        setStatus(`Generation ready (${((performance.now() - started) / 1000).toFixed(1)} s): ${result.content.slice(0, 300)}`);
      }
    } catch (error) {
      if (!controller.signal.aborted) setStatus(`${kind === "connection" ? "Connection" : "Generation"} failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <>
    <Field label="Local runtime profile">
      <select value={preset.localRuntime ?? "compatible"} onChange={event => onChange({ localRuntime: event.target.value as "llamaCpp" | "compatible" })}>
        <option value="llamaCpp">llama.cpp / Qwen (thinking disabled)</option>
        <option value="compatible">Other OpenAI-compatible server (no runtime-specific fields)</option>
      </select>
    </Field>
    <div className="grid two">
      <Field label="Server context capacity (tokens)"><NumberInput min={1024} value={preset.contextWindowTokens ?? 8192} onChange={contextWindowTokens => onChange({ contextWindowTokens })} /></Field>
      <Field label="Request timeout (seconds)"><NumberInput min={1} max={3600} value={(preset.requestTimeoutMs ?? 600_000) / 1000} onChange={seconds => onChange({ requestTimeoutMs: seconds * 1000 })} /></Field>
    </div>
    <p className="muted">Context capacity must match the server. AIST reserves the output limit plus a 512-token margin. Local endpoints are restricted to this device: 127.0.0.1, localhost, or [::1]. No online fallback is used.</p>
    {models.length > 0 && <Field label="Discovered models"><select value={models.includes(preset.model) ? preset.model : ""} onChange={event => { if (event.target.value) onChange({ model: event.target.value }); }}>
      <option value="">Choose a model (manual entry above remains available)</option>
      {models.map(model => <option key={model} value={model}>{model}</option>)}
    </select></Field>}
    <div className="button-row">
      <button type="button" disabled={busy} onClick={() => void test("connection")}>Test Connection / Refresh Models</button>
      <button type="button" disabled={busy} onClick={() => void test("generation")}>Test Generation</button>
      {busy && <button type="button" onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); setStatus("Test cancelled."); }}>Cancel Test</button>}
    </div>
    <p role="status" aria-live="polite">{status}</p>
    <details><summary>Set up a local Qwen server</summary>
      <p>AIST cannot start Windows programs or load a model file directly. Run llama-server on this PC, then keep it running while using AIST.</p>
      <ol>
        <li>In the AIST source checkout, copy <code>scripts/local-model.example.json</code> to <code>scripts/local-model.local.json</code>.</li>
        <li>Set the llama-server executable and model path (for example, <code>D:\Models\llama-cache\Qwen-Turbo-Q4_K_M.gguf</code>). Set the allowed origin to <code>{window.location.origin}</code>.</li>
        <li>Run <code>scripts\start-local-model.cmd</code>. It finds PowerShell 7 and binds the server only to <code>127.0.0.1</code>.</li>
        <li>Use the same port, model alias and context capacity here. Allow this site’s local network permission if your browser asks, then test the connection and generation.</li>
      </ol>
      <p>These requests go directly from your browser to your PC. GitHub Pages serves the app. Other devices cannot connect to this loopback server. Model paths are configured in the launcher, not adventure saves.</p>
      <a href="https://github.com/press-lab/AI-Story-Teller-Pages/blob/main/docs/local-models.md" target="_blank" rel="noreferrer">Full local setup instructions</a>
    </details>
  </>;
}
