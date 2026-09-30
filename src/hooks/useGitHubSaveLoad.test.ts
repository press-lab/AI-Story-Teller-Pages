/**
 * @vitest-environment jsdom
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { saveAdventure } from "../db/adventureDb";
import type { GitHubSaveSlot } from "../types/adventure";
import { useGitHubSaveLoad } from "./useGitHubSaveLoad";

const DB_NAME = "ai-story-teller";

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function makeSlot(adventureId: string): GitHubSaveSlot {
  return {
    saveId: "test-save-id",
    adventureId,
    title: "Test Adventure",
    savedAt: "2026-01-02T00:00:00.000Z",
    turnCount: 5,
    saveType: "manual",
  };
}

describe("useGitHubSaveLoad", () => {
  beforeEach(async () => {
    Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
    Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true });
    await deleteDb();
  });

  it("loads a new adventure with no local conflict — calls onApply without prompting", async () => {
    const loaded = createDefaultAdventure("Remote Adventure");
    const loadSave = vi.fn().mockResolvedValue(loaded);
    const onApply = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useGitHubSaveLoad(loadSave, onApply));

    await act(async () => {
      await result.current.initiateLoad(makeSlot(loaded.id));
    });

    expect(result.current.pendingConflict).toBeUndefined();
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(loaded);
  });

  it("sets pendingConflict and does not call onApply when a local adventure already exists", async () => {
    const local = createDefaultAdventure("Local Adventure");
    local.updatedAt = "2026-01-01T00:00:00.000Z";
    await saveAdventure(local);

    const loaded = { ...createDefaultAdventure("Remote Adventure"), id: local.id };
    loaded.updatedAt = "2026-01-02T00:00:00.000Z";
    const loadSave = vi.fn().mockResolvedValue(loaded);
    const onApply = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useGitHubSaveLoad(loadSave, onApply));

    await act(async () => {
      await result.current.initiateLoad(makeSlot(local.id));
    });

    expect(result.current.pendingConflict).toBeDefined();
    expect(result.current.pendingConflict!.local.id).toBe(local.id);
    expect(result.current.pendingConflict!.local.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.current.pendingConflict!.loaded).toBe(loaded);
    expect(result.current.pendingConflict!.slot.savedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("confirmOverwrite calls onApply with the loaded adventure and clears the conflict", async () => {
    const local = createDefaultAdventure("Local");
    await saveAdventure(local);

    const loaded = { ...createDefaultAdventure("Remote"), id: local.id };
    const loadSave = vi.fn().mockResolvedValue(loaded);
    const onApply = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useGitHubSaveLoad(loadSave, onApply));

    await act(async () => {
      await result.current.initiateLoad(makeSlot(local.id));
    });
    expect(result.current.pendingConflict).toBeDefined();

    await act(async () => {
      await result.current.confirmOverwrite();
    });

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(loaded);
    expect(result.current.pendingConflict).toBeUndefined();
  });

  it("cancelOverwrite clears the conflict without calling onApply, preserving the local adventure", async () => {
    const local = createDefaultAdventure("Local");
    await saveAdventure(local);

    const loaded = { ...createDefaultAdventure("Remote"), id: local.id };
    const loadSave = vi.fn().mockResolvedValue(loaded);
    const onApply = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useGitHubSaveLoad(loadSave, onApply));

    await act(async () => {
      await result.current.initiateLoad(makeSlot(local.id));
    });
    expect(result.current.pendingConflict).toBeDefined();

    act(() => {
      result.current.cancelOverwrite();
    });

    expect(result.current.pendingConflict).toBeUndefined();
    expect(onApply).not.toHaveBeenCalled();
  });
});
