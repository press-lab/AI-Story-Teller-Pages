import type { CompressedMemoryHistoryBlock, MemoryHistoryRecord } from "../types/adventure";
export type HistoryWorkerRequest = { id: number; operation: "compress"; record: MemoryHistoryRecord }
  | { id: number; operation: "decompress"; block: CompressedMemoryHistoryBlock };
type Job = { request: HistoryWorkerRequest; resolve: (value: unknown) => void; reject: (reason: Error) => void; signal?: AbortSignal };
let worker: Worker | undefined;
let serial = 0;
let running: Job | undefined;
const queue: Job[] = [];
function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  if (job.signal?.aborted) { job.reject(new Error("Memory history job cancelled.")); pump(); return; }
  running = job;
  try {
    if (!worker) {
      worker = new Worker(new URL("./memoryHistory.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (!running || data.id !== running.request.id) return;
        const done = running; running = undefined;
        if (data.error) done.reject(new Error(data.error)); else done.resolve(data.value);
        pump();
      };
      worker.onerror = () => {
        const failed = running; running = undefined;
        worker?.terminate(); worker = undefined;
        failed?.reject(new Error("Memory history worker unavailable. Original history retained."));
        pump();
      };
    }
    worker.postMessage(job.request);
  } catch (error) {
    running = undefined;
    job.reject(error instanceof Error ? error : new Error("Memory history worker unavailable."));
    pump();
  }
}
function request<T>(payload: Omit<Extract<HistoryWorkerRequest, { operation: "compress" }>, "id"> | Omit<Extract<HistoryWorkerRequest, { operation: "decompress" }>, "id">, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const job: Job = { request: { ...payload, id: ++serial } as HistoryWorkerRequest, resolve: value => resolve(value as T), reject, signal };
    // Requested details have priority over queued maintenance. One worker/job globally.
    if (payload.operation === "decompress") queue.unshift(job); else queue.push(job);
    pump();
  });
}
export const compressHistoryInWorker = (record: MemoryHistoryRecord, signal?: AbortSignal) => request<CompressedMemoryHistoryBlock>({ operation: "compress", record }, signal);
export const readHistoryInWorker = (block: CompressedMemoryHistoryBlock) => request<MemoryHistoryRecord>({ operation: "decompress", block });
