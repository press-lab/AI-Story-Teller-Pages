// Explicit synthetic inference benchmark. Never reads adventure data or edits the server configuration.
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8080/v1/');
if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw new Error('Benchmark requires a loopback-only HTTP(S) server.');
const model = process.argv[3] ?? 'aist-qwen';
const endpoint = base.toString().replace(/\/+$/, '') + '/chat/completions';
const headers = { 'Content-Type': 'application/json', ...(process.env.AIST_LOCAL_API_KEY ? { Authorization: `Bearer ${process.env.AIST_LOCAL_API_KEY}` } : {}) };
const rules = Array.from({ length: 96 }, (_, i) => `Rule ${i + 1}: retain established facts and preserve the exact order of supplied evidence.`).join('\n');
function prompt({ clock = '2001-01-01', arc = 'Find the bridge.', card = 'The gate is blue.', history = ['I arrive.', 'The guard waits.'] } = {}) {
  return [{ role: 'system', content: `Synthetic cache benchmark. Current story date: ${clock}.\n# AI Instructions\n${rules}\n# Plot Essentials\nExplore the town.\n# Current Arc\n${arc}\n# Story Cards\n${card}\n# Author Note\nReply with only OK.` },
    ...history.map((content, index) => ({ role: index % 2 ? 'assistant' : 'user', content })), { role: 'user', content: 'Reply with only OK.' }];
}
const rows = [];
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(new URL('/health', base), { redirect: 'error', headers, signal: AbortSignal.timeout(2000) });
    if (response.ok) { ready = true; break; }
  } catch { /* Wait briefly for an already-starting server. */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('Local inference server is not ready. Start it before benchmarking.');
async function run(name, messages, cache) {
  const started = performance.now();
  const response = await fetch(endpoint, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ model, messages, cache_prompt: cache, max_tokens: 1, temperature: 0, chat_template_kwargs: { enable_thinking: false } }) });
  if (!response.ok) throw new Error(`Synthetic benchmark failed: HTTP ${response.status}.`);
  const body = await response.json(); const t = body.timings ?? {};
  const metric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  const row = { name, cache, cachedTokens: metric(t.cache_n), processedTokens: metric(t.prompt_n), promptMs: metric(t.prompt_ms), generationMs: metric(t.predicted_ms), elapsedMs: Math.round(performance.now() - started) };
  rows.push(row); console.log(JSON.stringify(row));
}
await run('cache disabled', prompt(), false);
await run('warm seed', prompt(), true);
await run('identical prompt', prompt(), true);
const history = ['I arrive.', 'The guard waits.', 'I ask about the bridge.', 'The guard points east.'];
await run('appended exchange', prompt({ history }), true);
await run('oldest exchange removed', prompt({ history: history.slice(2) }), true);
await run('card changed', prompt({ history: history.slice(2), card: 'The gate is green.' }), true);
await run('arc changed', prompt({ history: history.slice(2), arc: 'Cross the bridge.', card: 'The gate is green.' }), true);
const final = prompt({ clock: '2001-01-02', history: history.slice(2), arc: 'Cross the bridge.', card: 'The gate is green.' });
await run('clock changed', final, true);
await run('background task', [{ role: 'system', content: 'Synthetic memory test. No facts. Reply OK.' }, { role: 'user', content: 'Reply OK.' }], true);
await run('narration after background', final, true);
console.log(JSON.stringify({ summary: rows, caveat: 'Synthetic prompts on one running server; not a prediction of adventure latency or model quality.' }));
