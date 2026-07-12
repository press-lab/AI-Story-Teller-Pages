import { normalizeAdventure } from "../state/defaults";
import type { Adventure, CloudSyncSettings, GitHubSaveSettings, GitHubSaveSlot, ISODateString } from "../types/adventure";
import { encodeBase64Utf8, ensureRepo, fetchGitHubFileContent, githubRequest, resolveOwner } from "./githubSync";

export const defaultGitHubSaveSettings: GitHubSaveSettings = {
  savesBasePath: "sync/saves",
};

interface GitHubSaveFile {
  app: "ai-story-teller";
  version: 1;
  savedAt: ISODateString;
  saveType: "manual" | "auto";
  adventure: Adventure;
}

interface GitHubSaveIndex {
  app: "ai-story-teller";
  version: 1;
  updatedAt: ISODateString;
  slots: GitHubSaveSlot[];
}

function assertSettings(settings: CloudSyncSettings): void {
  if (!settings.token.trim()) throw new Error("GitHub save slots require a GitHub token.");
  if (!settings.repo.trim()) throw new Error("GitHub save slots require a repository name.");
  if (!settings.branch.trim()) throw new Error("GitHub save slots require a branch name.");
}

function sanitizeSave(adventure: Adventure): Adventure {
  const { apiKey: _apiKey, ...modelConfig } = adventure.modelConfig;
  return normalizeAdventure({ ...adventure, modelConfig });
}

function repoBase(cloudSettings: CloudSyncSettings, owner: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(cloudSettings.repo.trim())}/contents`;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

function indexFilePath(cloudSettings: CloudSyncSettings, saveSettings: GitHubSaveSettings, owner: string): string {
  return `${repoBase(cloudSettings, owner)}/${encodePath(saveSettings.savesBasePath)}/index.json`;
}

function saveFilePath(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  owner: string,
  adventureId: string,
  saveId: string,
): string {
  return `${repoBase(cloudSettings, owner)}/${encodePath(saveSettings.savesBasePath)}/${encodeURIComponent(adventureId)}/${encodeURIComponent(saveId)}.json`;
}

async function fetchIndex(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  owner: string,
): Promise<{ index: GitHubSaveIndex; sha?: string }> {
  const path = `${indexFilePath(cloudSettings, saveSettings, owner)}?ref=${encodeURIComponent(cloudSettings.branch.trim())}`;
  try {
    const { text, sha } = await fetchGitHubFileContent(cloudSettings, path);
    const parsed = JSON.parse(text) as GitHubSaveIndex;
    if (parsed.app !== "ai-story-teller") throw new Error("Not a valid AI Story Teller save index.");
    return { index: parsed, sha };
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return { index: { app: "ai-story-teller", version: 1, updatedAt: new Date().toISOString(), slots: [] } };
    }
    throw error;
  }
}

async function writeIndex(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  owner: string,
  index: GitHubSaveIndex,
  sha?: string,
): Promise<void> {
  await githubRequest(cloudSettings, indexFilePath(cloudSettings, saveSettings, owner), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Update AI Story Teller save index (${index.slots.length} saves)`,
      branch: cloudSettings.branch.trim(),
      content: encodeBase64Utf8(JSON.stringify(index, null, 2)),
      ...(sha ? { sha } : {}),
    }),
  });
}

export function shouldAutoSave(
  adventure: Adventure,
  _saveSettings: GitHubSaveSettings,
  lastAutoSavedTurn: number,
): boolean {
  if (!adventure.autoSaveEnabled) return false;
  const everyNTurns = adventure.autoSaveEveryNTurns ?? 3;
  if (everyNTurns <= 0) return false;
  const currentTurn = adventure.activeState.turn;
  return currentTurn > lastAutoSavedTurn && currentTurn - lastAutoSavedTurn >= everyNTurns;
}

export async function listGitHubSaves(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
): Promise<GitHubSaveSlot[]> {
  assertSettings(cloudSettings);
  const owner = await resolveOwner(cloudSettings);
  await ensureRepo(cloudSettings, owner);
  const { index } = await fetchIndex(cloudSettings, saveSettings, owner);
  return [...index.slots].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

const MAX_SAVES_PER_ADVENTURE = 3;

async function pruneSavesForAdventure(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  owner: string,
  adventureId: string,
  slots: GitHubSaveSlot[],
): Promise<GitHubSaveSlot[]> {
  const forThis = slots
    .filter((s) => s.adventureId === adventureId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const toDelete = forThis.slice(MAX_SAVES_PER_ADVENTURE);
  if (toDelete.length === 0) return slots;

  for (const slot of toDelete) {
    try {
      const path = saveFilePath(cloudSettings, saveSettings, owner, slot.adventureId, slot.saveId);
      const meta = await githubRequest<{ sha: string }>(cloudSettings, `${path}?ref=${encodeURIComponent(cloudSettings.branch.trim())}`);
      await githubRequest(cloudSettings, path, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Prune old save "${slot.title}" (turn ${slot.turnCount})`,
          sha: meta.sha,
          branch: cloudSettings.branch.trim(),
        }),
      });
    } catch {
      // prune failure is non-fatal — old file stays, index will still be updated
    }
  }

  const deleteIds = new Set(toDelete.map((s) => s.saveId));
  return slots.filter((s) => !deleteIds.has(s.saveId));
}

export async function saveToGitHub(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  adventure: Adventure,
  saveType: "manual" | "auto",
): Promise<GitHubSaveSlot> {
  assertSettings(cloudSettings);
  const owner = await resolveOwner(cloudSettings);
  await ensureRepo(cloudSettings, owner);

  const savedAt = new Date().toISOString();
  const saveId = `${savedAt.replace(/[:.]/g, "-")}-${saveType}`;
  const sanitized = sanitizeSave(adventure);
  const saveFile: GitHubSaveFile = { app: "ai-story-teller", version: 1, savedAt, saveType, adventure: sanitized };

  await githubRequest(cloudSettings, saveFilePath(cloudSettings, saveSettings, owner, adventure.id, saveId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Save "${adventure.title}" (${saveType}, turn ${adventure.activeState.turn})`,
      branch: cloudSettings.branch.trim(),
      content: encodeBase64Utf8(JSON.stringify(saveFile, null, 2)),
    }),
  });

  const slot: GitHubSaveSlot = {
    saveId,
    adventureId: adventure.id,
    title: adventure.title,
    savedAt,
    turnCount: adventure.activeState.turn,
    saveType,
  };

  const { index, sha } = await fetchIndex(cloudSettings, saveSettings, owner);
  const allSlots = [slot, ...index.slots.filter((s) => s.saveId !== slot.saveId)];
  const prunedSlots = await pruneSavesForAdventure(cloudSettings, saveSettings, owner, adventure.id, allSlots);
  await writeIndex(cloudSettings, saveSettings, owner, { ...index, updatedAt: savedAt, slots: prunedSlots }, sha);

  return slot;
}

export async function deleteGitHubSave(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  slot: GitHubSaveSlot,
): Promise<void> {
  assertSettings(cloudSettings);
  const owner = await resolveOwner(cloudSettings);
  const path = saveFilePath(cloudSettings, saveSettings, owner, slot.adventureId, slot.saveId);

  // Delete the save file if it still exists. Tolerate a missing file (404): a
  // slot can outlive its file when auto-save pruning removed the file, or when a
  // previous delete partially failed. Without this, fetching the file SHA throws
  // and the slot is stuck in the list, permanently undeletable. Cleaning the
  // index below is what actually removes it from the UI.
  try {
    const meta = await githubRequest<{ sha: string }>(cloudSettings, `${path}?ref=${encodeURIComponent(cloudSettings.branch.trim())}`);
    await githubRequest(cloudSettings, path, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Delete save "${slot.title}" (${slot.saveType}, turn ${slot.turnCount})`,
        sha: meta.sha,
        branch: cloudSettings.branch.trim(),
      }),
    });
  } catch (error) {
    if (!(error instanceof Error && /not found/i.test(error.message))) throw error;
    // File already gone — fall through and clean the index entry.
  }

  // Always drop the slot from the index so the deletion is reflected in the UI.
  const { index, sha } = await fetchIndex(cloudSettings, saveSettings, owner);
  await writeIndex(cloudSettings, saveSettings, owner, {
    ...index,
    updatedAt: new Date().toISOString() as typeof index.updatedAt,
    slots: index.slots.filter((s) => s.saveId !== slot.saveId),
  }, sha);
}

export async function loadGitHubSave(
  cloudSettings: CloudSyncSettings,
  saveSettings: GitHubSaveSettings,
  slot: GitHubSaveSlot,
): Promise<Adventure> {
  assertSettings(cloudSettings);
  const owner = await resolveOwner(cloudSettings);
  const path = `${saveFilePath(cloudSettings, saveSettings, owner, slot.adventureId, slot.saveId)}?ref=${encodeURIComponent(cloudSettings.branch.trim())}`;
  const { text } = await fetchGitHubFileContent(cloudSettings, path);
  const parsed = JSON.parse(text) as GitHubSaveFile;
  if (parsed.app !== "ai-story-teller" || !parsed.adventure) {
    throw new Error("Not a valid AI Story Teller save file.");
  }
  return normalizeAdventure(parsed.adventure);
}
