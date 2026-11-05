/** Reads pinned llama.cpp diagnostics only. Never retains prompts or generated text. */
export class InferenceEvents {
  constructor(emit, { now = () => performance.now(), timestamp = () => new Date().toISOString(), intervalMs = 5000 } = {}) {
    this.emit = emit; this.now = now; this.timestamp = timestamp; this.intervalMs = intervalMs;
    this.started = now(); this.lastLoading = this.started; this.ready = false; this.tasks = new Map();
    this.write('LOADING MODEL', `elapsed 0.0s`);
  }
  write(event, detail) { this.emit(`[${this.timestamp()}] ${event.padEnd(14)} ${detail}`); }
  elapsed(start) { return `${((this.now() - start) / 1000).toFixed(1)}s`; }
  describe(task) {
    const parts = [`#${task.id} slot ${task.slot}`, `elapsed ${this.elapsed(task.started)}`];
    if (task.processed !== undefined) parts.push(`prompt processed ${task.processed}${task.promptTotal !== undefined ? ` / ${task.promptTotal}` : ''}`);
    if (task.cached !== undefined) parts.push(`cached ${task.cached}`);
    if (task.generated !== undefined) parts.push(`generated ${task.generated} tokens`);
    if (task.generationTps !== undefined) parts.push(`${task.generationTps.toFixed(2)} tokens/s`);
    if (task.promptMs !== undefined) parts.push(`prompt ${(task.promptMs / 1000).toFixed(2)}s`);
    if (task.generationMs !== undefined) parts.push(`generation ${(task.generationMs / 1000).toFixed(2)}s`);
    if (task.nativeTotalMs !== undefined) parts.push(`runtime total ${(task.nativeTotalMs / 1000).toFixed(2)}s`);
    return parts.join(' | ');
  }
  finish(task, status) {
    this.write(status, this.describe(task)); this.tasks.delete(task.slot);
  }
  line(line) {
    const exception = /got exception:\s*(\{.*\})/.exec(line);
    if (exception) {
      try {
        const code = JSON.parse(exception[1])?.error?.code;
        if (Number.isInteger(code) && code >= 400 && code <= 599) this.write('FAILED', `HTTP ${code} | request rejected; task ID unavailable`);
      } catch { /* Native diagnostics can be incomplete; never copy their bodies into event logs. */ }
    }
    if (/listening on http/.test(line) && !this.ready) {
      this.ready = true; this.write('READY', `model loaded | startup ${this.elapsed(this.started)}`);
    }
    const match = /^\d+\.\d+\.\d+\.\d+\s+[IWE]\s+slot\s+\S+: id\s+(\d+)\s*\| task\s+(-?\d+)\s*\|\s*(.*)/.exec(line);
    if (match) {
      const slot = Number(match[1]), id = Number(match[2]), message = match[3];
      if (/processing task,/.test(message) && id >= 0) {
        const previous = this.tasks.get(slot);
        if (previous && previous.id !== id) this.finish(previous, 'INTERRUPTED');
        if (!this.tasks.has(slot)) {
          const task = { slot, id, started: this.now(), last: this.now(), phase: 'PROCESSING' };
          this.tasks.set(slot, task); this.write('NEW REQUEST', this.describe(task));
        }
      }
      const task = this.tasks.get(slot);
      if (!task || task.id !== id) {
        if (/\sE\s/.test(line)) this.write('FAILED', `slot ${slot} | request error; see raw log`);
        return;
      }
      let value;
      if ((value = /task\.n_tokens = (\d+)/.exec(message))) task.promptTotal = Number(value[1]);
      if ((value = /prompt processing, n_tokens =\s*(\d+)/.exec(message))) task.processed = Number(value[1]);
      if ((value = /n_gen =\s*(\d+), tg =\s*([\d.]+)/.exec(message))) { task.generated = Number(value[1]); task.generationTps = Number(value[2]); task.phase = 'GENERATING'; }
      if ((value = /prompt eval time =\s*([\d.]+) ms \/\s*(\d+) tokens/.exec(message))) {
        task.promptMs = Number(value[1]); task.processed = Number(value[2]);
      } else if ((value = /\beval time =\s*([\d.]+) ms \/\s*(\d+) tokens/.exec(message))) {
        task.generationMs = Number(value[1]); task.generated = Number(value[2]);
        const speed = /([\d.]+) tokens per second/.exec(message);
        if (speed) task.generationTps = Number(speed[1]);
      }
      if (/\bcancel(?:led|ed|ling)?\b/i.test(message)) { this.finish(task, 'CANCELLED'); return; }
      if (/\sE\s/.test(line)) { this.finish(task, 'FAILED'); return; }
      if ((value = /total time =\s*([\d.]+) ms/.exec(message))) {
        task.nativeTotalMs = Number(value[1]); this.finish(task, 'COMPLETE'); return;
      }
      // Release alone also happens after a client disconnect. Never claim success without timing completion.
      if (/stop processing:/.test(message)) { this.finish(task, 'INTERRUPTED'); return; }
      if (/forcing full prompt re-processing/.test(message)) this.write('CACHE MISS', `#${id} | compatible checkpoint unavailable; full prompt processing`);
      if (/restor.*checkpoint|restor.*prompt/i.test(message)) this.write('CACHE RESTORE', `#${id} | runtime restoring cached state`);
    } else if (/\sE\s/.test(line)) {
      this.write('ERROR', 'Native server reported an error; see the raw log for details.');
    }
  }
  slots(slots) {
    if (!Array.isArray(slots)) return;
    for (const slot of slots) {
      const task = this.tasks.get(slot.id);
      if (!task || slot.id_task !== task.id || !slot.is_processing) continue;
      const count = value => Number.isInteger(value) && value >= 0;
      if (count(slot.n_prompt_tokens) && task.promptTotal === undefined) task.promptTotal = slot.n_prompt_tokens;
      if (count(slot.n_prompt_tokens_processed)) task.processed = slot.n_prompt_tokens_processed;
      if (count(slot.n_prompt_tokens_cache)) task.cached = slot.n_prompt_tokens_cache;
      const nextToken = Array.isArray(slot.next_token) ? slot.next_token[0] : slot.next_token;
      if (count(nextToken?.n_decoded) && nextToken.n_decoded > 0) {
        task.generated = nextToken.n_decoded;
        if (task.phase !== 'GENERATING') {
          task.phase = 'GENERATING'; this.write(task.phase, this.describe(task)); task.last = this.now();
        }
      }
    }
  }
  tick() {
    if (!this.ready && this.now() - this.lastLoading >= this.intervalMs) {
      this.write('LOADING MODEL', `elapsed ${this.elapsed(this.started)}`); this.lastLoading = this.now();
    }
    for (const task of this.tasks.values()) {
      if (this.now() - task.last >= this.intervalMs) { this.write(task.phase, this.describe(task)); task.last = this.now(); }
    }
  }
  close(code, signal) {
    for (const task of [...this.tasks.values()]) this.finish(task, signal === 'SIGINT' ? 'CANCELLED' : 'FAILED');
    this.write('SERVER STOPPED', `elapsed ${this.elapsed(this.started)} | exit ${code ?? signal ?? 'unknown'}`);
  }
}
