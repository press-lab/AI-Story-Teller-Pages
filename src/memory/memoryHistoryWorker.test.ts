import { afterEach, expect, it, vi } from "vitest";
import type { HistoryWorkerRequest } from "./memoryHistoryWorker";
import { makeMemoryProposal } from "../test/goldenAdventure";
import type { CompressedMemoryHistoryBlock } from "../types/adventure";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("runs one actual worker job at a time and prioritizes explicit reads over queued maintenance", async () => {
  const posted: HistoryWorkerRequest[] = [];
  let instance: FakeWorker;
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    constructor() { instance = this; }
    postMessage(data: HistoryWorkerRequest) { posted.push(data); }
    terminate = vi.fn();
  }
  vi.stubGlobal("Worker", FakeWorker);
  const { compressHistoryInWorker, readHistoryInWorker } = await import("./memoryHistoryWorker");
  const p = makeMemoryProposal(), record = { kind: "proposal" as const, id: p.id, value: p };
  const a = compressHistoryInWorker(record), b = compressHistoryInWorker(record);
  const c = readHistoryInWorker({ id: "block" } as CompressedMemoryHistoryBlock);
  expect(posted).toHaveLength(1);
  expect(posted[0].operation).toBe("compress");
  instance!.onmessage!({ data: { id: posted[0].id, value: "first" } });
  await expect(a).resolves.toBe("first");
  expect(posted[1].operation).toBe("decompress");
  instance!.onmessage!({ data: { id: posted[1].id, error: "corrupt" } });
  await expect(c).rejects.toThrow("corrupt");
  expect(posted[2].operation).toBe("compress");
  instance!.onmessage!({ data: { id: posted[2].id, value: "last" } });
  await expect(b).resolves.toBe("last");
});
it("reports worker crashes, retains originals, recovers the queue and skips cancelled queued jobs", async () => {
  const instances: FakeWorker[] = [], posted: HistoryWorkerRequest[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    constructor() { instances.push(this); }
    postMessage(data: HistoryWorkerRequest) { posted.push(data); }
    terminate = vi.fn();
  }
  vi.stubGlobal("Worker", FakeWorker);
  const { compressHistoryInWorker } = await import("./memoryHistoryWorker");
  const p = makeMemoryProposal(), record = { kind: "proposal" as const, id: p.id, value: p };
  const a = compressHistoryInWorker(record);
  const controller = new AbortController();
  const b = compressHistoryInWorker(record, controller.signal); controller.abort();
  instances[0].onerror!();
  await expect(a).rejects.toThrow("Original history retained");
  await expect(b).rejects.toThrow("cancelled");
  expect(instances[0].terminate).toHaveBeenCalledOnce();
  expect(posted).toHaveLength(1);
  const c = compressHistoryInWorker(record);
  expect(instances).toHaveLength(2);
  instances[1].onmessage!({ data: { id: posted[1].id, value: "recovered" } });
  await expect(c).resolves.toBe("recovered");
  expect(record.value).toBe(p);
});
