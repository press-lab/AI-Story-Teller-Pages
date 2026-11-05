import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceEvents } from './local-inference-events.mjs';
const line = (message, task = 7, slot = 0) => `0.00.000.000 I slot   operator(): id ${slot} | task ${task} | ${message}`;
function fixture() {
  let now = 0; const output = [];
  const events = new InferenceEvents(text => output.push(text), { now: () => now, timestamp: () => '2026-11-05 14:00:00' });
  return { events, output, time: value => { now = value; } };
}
test('startup emits wall-clock timestamps and elapsed updates while native output is silent', () => {
  const f = fixture(); f.time(5000); f.events.tick(); f.time(7000); f.events.line('I srv server_on_li: listening on http://127.0.0.1:8080');
  assert.match(f.output[0], /^\[2026-11-05 14:00:00\] LOADING MODEL/);
  assert.match(f.output[1], /elapsed 5.0s/); assert.match(f.output[2], /READY.*startup 7.0s/);
});
test('request heartbeats include only observed counters and completion uses measured timings', () => {
  const f = fixture(); f.events.line('listening on http://127.0.0.1:8080'); f.events.line(line('processing task, is_child = 0'));
  f.time(5000); f.events.tick(); assert.match(f.output.at(-1), /PROCESSING.*#7.*elapsed 5.0s/);
  assert.doesNotMatch(f.output.at(-1), /cached|generated/);
  f.events.slots([{ id: 0, id_task: 7, is_processing: true, n_prompt_tokens: 300, n_prompt_tokens_processed: 100, n_prompt_tokens_cache: 200, next_token: [{ n_decoded: 4 }] }]);
  assert.match(f.output.at(-1), /GENERATING.*cached 200.*generated 4/);
  f.events.line(line('prompt eval time = 1200.00 ms / 100 tokens'));
  f.events.line(line('eval time = 800.00 ms / 4 tokens (200 ms per token, 3.75 tokens per second)'));
  f.events.line(line('total time = 2000.00 ms / 104 tokens'));
  f.events.line(line('stop processing: n_tokens = 304, truncated = 0'));
  assert.equal(f.output.filter(text => /COMPLETE/.test(text)).length, 1);
  assert.match(f.output.at(-1), /COMPLETE.*prompt 1.20s.*generation 0.80s.*runtime total 2.00s/);
  assert.match(f.output.at(-1), /3.75 tokens\/s/);
  assert.equal(f.events.tasks.size, 0);
});
test('a release without completion evidence is interrupted, not a successful request', () => {
  const f = fixture(); f.events.line(line('processing task, is_child = 0')); f.events.line(line('stop processing: n_tokens = 200, truncated = 0'));
  assert.match(f.output.at(-1), /INTERRUPTED/); assert.ok(!f.output.some(text => /COMPLETE/.test(text)));
});
test('observed cancellation and errors have separate terminal statuses', () => {
  const f = fixture(); f.events.line(line('processing task, is_child = 0')); f.events.line(line('cancelled by client'));
  assert.match(f.output.at(-1), /CANCELLED/);
  f.events.line(line('processing task, is_child = 0', 8)); f.events.line(line('context exhausted', 8).replace(' I slot', ' E slot'));
  assert.match(f.output.at(-1), /FAILED/);
});
test('slot/task correlation ignores stale counters and never mixes concurrent requests', () => {
  const f = fixture(); f.events.line(line('processing task, is_child = 0', 1, 0)); f.events.line(line('processing task, is_child = 0', 2, 1));
  f.events.slots([{ id: 0, id_task: 99, is_processing: true, next_token: { n_decoded: 999 } }]);
  f.events.line(line('total time = 25.00 ms / 5 tokens', 2, 1));
  assert.match(f.output.at(-1), /COMPLETE.*#2 slot 1/); assert.equal(f.events.tasks.size, 1);
  f.events.close(1, null); assert.match(f.output.at(-2), /FAILED.*#1 slot 0/);
});
test('cache misses/restores are reported without copying native text or prompt contents', () => {
  const f = fixture(); f.events.line(line('processing task, is_child = 0'));
  f.events.line(line('forcing full prompt re-processing due to lack of cache data PRIVATE_TEXT'));
  assert.match(f.output.at(-1), /CACHE MISS/); assert.doesNotMatch(f.output.at(-1), /PRIVATE_TEXT/);
  f.events.line(line('restoring checkpoint PRIVATE_TEXT')); assert.match(f.output.at(-1), /CACHE RESTORE/);
  assert.ok(f.output.every(text => !text.includes('PRIVATE_TEXT')));
});
test('an HTTP rejection is reported without exposing the provider error body or misattributing an active task', () => {
  const f = fixture(); f.events.line(line('processing task, is_child = 0'));
  f.events.line('0.00.001 W srv operator(): got exception: {"error":{"code":400,"message":"PRIVATE_TEXT"}}');
  assert.match(f.output.at(-1), /FAILED.*HTTP 400.*task ID unavailable/);
  assert.doesNotMatch(f.output.at(-1), /PRIVATE_TEXT/); assert.equal(f.events.tasks.size, 1);
});
