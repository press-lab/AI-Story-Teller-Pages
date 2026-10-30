import { MEMORY_HISTORY_COMPRESSION_ENABLED } from "../config/memoryHistoryCompression";
import { Blob as NodeBlob } from "node:buffer";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMemoryHistoryCompression } from "./useMemoryHistoryCompression";
import { createDefaultAdventure } from "../state/defaults";
import { compressHistoryInWorker } from "../memory/memoryHistoryWorker";
import { nextHistoryRecord } from "../memory/memoryHistory";
import { saveAdventure } from "../db/adventureDb";
import { withArchivedRecord } from "../test/archivedMemoryFixture";
import { makeMemoryProposal } from "../test/goldenAdventure";

const logging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: false }));
vi.mock("../config/debugLogging", () => logging);
vi.mock("../memory/memoryHistoryWorker", () => ({ compressHistoryInWorker: vi.fn() }));
vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([false, true])("disabled compression with logging %s performs no scans, timers, workers, state updates, warnings or saves", async enabled => {
  expect(MEMORY_HISTORY_COMPRESSION_ENABLED).toBe(false);
  logging.MEMORY_DEBUG_LOGGING = enabled;
  vi.stubGlobal("Blob", NodeBlob);
  const initial = createDefaultAdventure();
  const proposal = makeMemoryProposal({ status: "approved" });
  initial.activeState.memoryProposals = [proposal];
  const archived = await withArchivedRecord(initial, { kind: "proposal", id: proposal.id, value: proposal });
  const before = structuredClone(archived);
  vi.useFakeTimers();
  // Missing Worker must not even produce an availability warning.
  vi.stubGlobal("Worker", undefined);
  const timeout = vi.spyOn(globalThis, "setTimeout"), interval = vi.spyOn(globalThis, "setInterval");
  const set = vi.fn();
  const hook = renderHook(({ adventure }) => useMemoryHistoryCompression(adventure, set), { initialProps: { adventure: archived } });
  expect(timeout).not.toHaveBeenCalled();
  expect(interval).not.toHaveBeenCalled();
  const worker = vi.fn(); vi.stubGlobal("Worker", worker);
  hook.rerender({ adventure: { ...archived, title: "Ordinary edit", activeState: { ...archived.activeState, debugHistoryGeneration: 1 } } });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(timeout).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(worker).not.toHaveBeenCalled(); expect(compressHistoryInWorker).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled(); expect(saveAdventure).not.toHaveBeenCalled();
  expect(hook.result.current).toBeUndefined();
  expect(archived).toStrictEqual(before);
  // Throwing accessors prove selection returns before touching any history.
  expect(nextHistoryRecord({ ...archived,
    get messages(): typeof archived.messages { throw new Error("history scanned"); },
    get activeState(): typeof archived.activeState { throw new Error("proposals scanned"); }
  }, new WeakSet())).toBeUndefined();
});
