// Explicit synthetic input-throughput test; no adventure data or server configuration changes.
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8080/v1/');
if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw new Error('A loopback-only HTTP(S) endpoint is required.');
const messages = [{ role: 'user', content: 'Synthetic throughput test. Read the following input and reply only OK.\n' + ' test'.repeat(20000) }];
for (const cache of [false, true]) {
  const started = performance.now();
  const response = await fetch(base.toString().replace(/\/+$/, '') + '/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300000),
    headers: { 'Content-Type': 'application/json', ...(process.env.AIST_LOCAL_API_KEY ? { Authorization: `Bearer ${process.env.AIST_LOCAL_API_KEY}` } : {}) },
    body: JSON.stringify({ model: process.argv[3] ?? 'aist-qwen', messages, cache_prompt: cache, max_tokens: 1, temperature: 0, chat_template_kwargs: { enable_thinking: false } }) });
  if (!response.ok) throw new Error(`Synthetic throughput test failed: HTTP ${response.status}.`);
  const body = await response.json(), t = body.timings ?? {};
  console.log(JSON.stringify({ test: cache ? 'warm repeat' : 'uncached input', cachedTokens: t.cache_n, processedTokens: t.prompt_n, promptMs: t.prompt_ms,
    promptTokensPerSecond: t.prompt_per_second, elapsedMs: Math.round(performance.now() - started), caveat: 'Synthetic input; actual counts and timings are server-reported. New output generation is a separate workload.' }));
}
