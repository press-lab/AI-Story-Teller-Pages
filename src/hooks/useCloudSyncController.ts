import { useState } from "react";
import { pullGitHubCloudSync, pushGitHubCloudSync } from "../sync/githubSync";
import type { Adventure, CloudSyncSettings } from "../types/adventure";

export function useCloudSyncController(
  cloudSyncSettings: CloudSyncSettings,
  allSavedAdventures: () => Promise<Adventure[]>,
  saveSyncedAdventures: (adventures: Adventure[]) => Promise<void>,
) {
  const [cloudSyncStatus, setCloudSyncStatus] = useState("");

  async function pushCloudSync() {
    setCloudSyncStatus("Pushing to GitHub...");
    try {
      const local = await allSavedAdventures();
      const result = await pushGitHubCloudSync(cloudSyncSettings, local);
      await saveSyncedAdventures(result.adventures);
      setCloudSyncStatus(
        `Pushed ${result.adventures.length} adventure(s) to ${result.owner}/${result.repo}:${result.path}.`,
      );
    } catch (err) {
      setCloudSyncStatus(err instanceof Error ? err.message : "Cloud push failed.");
    }
  }

  async function pullCloudSync() {
    setCloudSyncStatus("Pulling from GitHub...");
    try {
      const local = await allSavedAdventures();
      const result = await pullGitHubCloudSync(cloudSyncSettings, local);
      await saveSyncedAdventures(result.adventures);
      setCloudSyncStatus(
        `Pulled ${result.remoteAdventureCount} remote adventure(s); local library now has ${result.adventures.length}.`,
      );
    } catch (err) {
      setCloudSyncStatus(err instanceof Error ? err.message : "Cloud pull failed.");
    }
  }

  return { cloudSyncStatus, pushCloudSync, pullCloudSync };
}
