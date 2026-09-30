import { useCallback, useRef, useState } from "react";
import type { Adventure, CloudSyncSettings, GitHubSaveSettings, GitHubSaveSlot } from "../types/adventure";
import { deleteGitHubSave, listGitHubSaves, loadGitHubSave, saveToGitHub, shouldAutoSave } from "../sync/githubSaves";

const DEFAULT_TIMER_SAVE_MINUTES = 5;

export function useGitHubSaves(cloudSettings: CloudSyncSettings, saveSettings: GitHubSaveSettings) {
  const [saveSlots, setSaveSlots] = useState<GitHubSaveSlot[]>([]);
  const [savesStatus, setSavesStatus] = useState("");
  const lastAutoSavedTurnRef = useRef<Record<string, number>>({});
  const lastTimedSaveAtRef = useRef<Record<string, number>>({}); // timestamp ms per adventure id

  const listSaves = useCallback(async () => {
    setSavesStatus("Loading saves…");
    try {
      const slots = await listGitHubSaves(cloudSettings, saveSettings);
      setSaveSlots(slots);
      setSavesStatus(slots.length > 0 ? `${slots.length} saves` : "No saves found");
    } catch (error) {
      setSavesStatus(error instanceof Error ? error.message : "Failed to load saves.");
    }
  }, [cloudSettings, saveSettings]);

  const saveNow = useCallback(
    async (adventure: Adventure): Promise<GitHubSaveSlot | undefined> => {
      setSavesStatus("Saving…");
      try {
        const slot = await saveToGitHub(cloudSettings, saveSettings, adventure, "manual");
        setSaveSlots((current) => [slot, ...current.filter((s) => s.saveId !== slot.saveId)]);
        setSavesStatus("Saved to GitHub");
        return slot;
      } catch (error) {
        setSavesStatus(error instanceof Error ? error.message : "Save failed.");
        return undefined;
      }
    },
    [cloudSettings, saveSettings],
  );

  const loadSave = useCallback(
    async (slot: GitHubSaveSlot): Promise<Adventure> => {
      setSavesStatus("Loading save…");
      try {
        const adventure = await loadGitHubSave(cloudSettings, saveSettings, slot);
        setSavesStatus("Save loaded");
        return adventure;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Load failed.";
        setSavesStatus(msg);
        throw error;
      }
    },
    [cloudSettings, saveSettings],
  );

  const autoSaveIfDue = useCallback(
    async (adventure: Adventure): Promise<void> => {
      const lastTurn = lastAutoSavedTurnRef.current[adventure.id] ?? -1;
      if (!shouldAutoSave(adventure, saveSettings, lastTurn)) return;
      try {
        const slot = await saveToGitHub(cloudSettings, saveSettings, adventure, "auto");
        lastAutoSavedTurnRef.current = { ...lastAutoSavedTurnRef.current, [adventure.id]: adventure.activeState.turn };
        lastTimedSaveAtRef.current = { ...lastTimedSaveAtRef.current, [adventure.id]: Date.now() };
        setSaveSlots((current) => [slot, ...current.filter((s) => s.saveId !== slot.saveId)]);
      } catch {
        // auto-save failures are silent — don't surface transient GitHub errors to the user mid-session
      }
    },
    [cloudSettings, saveSettings],
  );

  const timedAutoSave = useCallback(
    async (adventure: Adventure): Promise<void> => {
      if (!adventure.autoSaveEnabled) return;
      if (adventure.activeState.turn <= 0) return;
      const minutes = adventure.autoSaveEveryNMinutes ?? DEFAULT_TIMER_SAVE_MINUTES;
      if (minutes <= 0) return;
      const lastAt = lastTimedSaveAtRef.current[adventure.id] ?? 0;
      if (Date.now() - lastAt < minutes * 60 * 1000) return;
      try {
        const slot = await saveToGitHub(cloudSettings, saveSettings, adventure, "auto");
        lastTimedSaveAtRef.current = { ...lastTimedSaveAtRef.current, [adventure.id]: Date.now() };
        lastAutoSavedTurnRef.current = { ...lastAutoSavedTurnRef.current, [adventure.id]: adventure.activeState.turn };
        setSaveSlots((current) => [slot, ...current.filter((s) => s.saveId !== slot.saveId)]);
      } catch {
        // timer save failures are silent
      }
    },
    [cloudSettings, saveSettings],
  );

  const deleteSave = useCallback(
    async (slot: GitHubSaveSlot): Promise<void> => {
      setSavesStatus("Deleting…");
      try {
        await deleteGitHubSave(cloudSettings, saveSettings, slot);
        setSaveSlots((current) => current.filter((s) => s.saveId !== slot.saveId));
        setSavesStatus("Save deleted");
      } catch (error) {
        setSavesStatus(error instanceof Error ? error.message : "Delete failed.");
      }
    },
    [cloudSettings, saveSettings],
  );

  const pullLatestForAdventure = useCallback(
    async (adventureId: string): Promise<Adventure | undefined> => {
      setSavesStatus("Checking for latest save…");
      try {
        const slots = await listGitHubSaves(cloudSettings, saveSettings);
        const latest = slots
          .filter((s) => s.adventureId === adventureId)
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
        if (!latest) {
          setSavesStatus("No saves found for this adventure.");
          return undefined;
        }
        const adventure = await loadGitHubSave(cloudSettings, saveSettings, latest);
        setSavesStatus("Pulled latest save");
        return adventure;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Pull failed.";
        setSavesStatus(msg);
        throw error;
      }
    },
    [cloudSettings, saveSettings],
  );

  return { saveSlots, savesStatus, listSaves, saveNow, loadSave, deleteSave, autoSaveIfDue, timedAutoSave, pullLatestForAdventure };
}
