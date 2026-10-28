import { compressHistory, decompressHistory } from "./historyCodec";
import type { HistoryWorkerRequest } from "./memoryHistoryWorker";
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<HistoryWorkerRequest>) => void; postMessage: (value: unknown) => void };
scope.onmessage = async ({ data }) => {
  try {
    const value = data.operation === "compress" ? await compressHistory(data.record) : await decompressHistory(data.block);
    scope.postMessage({ id: data.id, value });
  } catch (error) { scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Memory history worker failed." }); }
};
