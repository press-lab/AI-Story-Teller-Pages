import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { InferenceEvents } from './local-inference-events.mjs';

const [executable, argumentsJson, eventLog, timeZone = 'America/Phoenix'] = process.argv.slice(2);
const args = JSON.parse(argumentsJson);
if (!executable || !Array.isArray(args) || args.some(arg => typeof arg !== 'string') || !eventLog) throw new Error('Invalid local inference runner arguments.');
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'medium' });
let logWriteFailed = false;
const observer = new InferenceEvents(line => {
  console.log(line);
  try { appendFileSync(eventLog, line + '\n'); }
  catch {
    if (!logWriteFailed) console.error('EVENT LOG WRITE FAILED: console progress remains active. Check the log directory and disk space.');
    logWriteFailed = true;
  }
}, { timestamp: () => formatter.format(new Date()) });
let authorization;
const keyIndex = args.indexOf('--api-key-file');
if (keyIndex >= 0) {
  const key = readFileSync(args[keyIndex + 1], 'utf8').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
  if (key) authorization = `Bearer ${key}`;
}
const port = Number(args[args.indexOf('--port') + 1]);
function readSlots() {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/slots', agent: false, headers: authorization ? { Authorization: authorization } : {} }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 1_048_576) req.destroy(new Error('Slot metrics too large.')); });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(response.statusCode === 200 ? JSON.parse(body) : undefined); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('Slot metrics timed out.'))); req.end();
  });
}
const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => observer.line(line));
let stopping = false, polling = false;
const timer = setInterval(async () => {
  observer.tick();
  if (!observer.ready || !observer.tasks.size || polling || stopping) return;
  polling = true;
  try {
    observer.slots(await readSlots());
  } catch { /* Elapsed heartbeats continue when progress counters cannot be read. */ }
  finally { polling = false; }
}, 1000);
let shutdownTimer, requestedSignal;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true; requestedSignal = signal; child.kill(signal);
  shutdownTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000);
});
child.on('error', () => { observer.write('FAILED', 'Could not launch the inference executable.'); });
child.on('close', (code, signal) => {
  stopping = true; clearInterval(timer); clearTimeout(shutdownTimer);
  observer.close(code, requestedSignal ?? signal); process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1);
});
