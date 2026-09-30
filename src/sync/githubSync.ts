import { normalizeAdventure } from "../state/defaults";
import type { Adventure, CloudSyncSettings } from "../types/adventure";

export interface CloudSyncBundle {
  app: "ai-story-teller";
  version: 1;
  exportedAt: string;
  adventures: Adventure[];
}

export interface CloudSyncResult {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  adventures: Adventure[];
  remoteAdventureCount: number;
  uploaded: boolean;
}

interface GitHubUserResponse {
  login: string;
}

interface GitHubContentResponse {
  sha: string;
  content: string;
}

export const defaultCloudSyncSettings: CloudSyncSettings = {
  token: "",
  owner: "",
  repo: "ai-story-teller-sync",
  branch: "main",
  path: "sync/adventures.json",
  createPrivateRepoIfMissing: false,
};

function assertSettings(settings: CloudSyncSettings): void {
  if (!settings.token.trim()) throw new Error("Cloud sync needs a GitHub token.");
  if (!settings.repo.trim()) throw new Error("Cloud sync needs a GitHub repository name.");
  if (!settings.branch.trim()) throw new Error("Cloud sync needs a branch name.");
  if (!settings.path.trim()) throw new Error("Cloud sync needs a backup file path.");
}

function sanitizeAdventure(adventure: Adventure): Adventure {
  const { apiKey: _apiKey, ...modelConfig } = adventure.modelConfig;
  return normalizeAdventure({ ...adventure, modelConfig });
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(text: string): string {
  const binary = atob(text.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

// GitHub Contents API returns content:"" for files > 1 MB.
// Fall back to the Git blobs API which reliably returns raw content for any size.
export async function fetchGitHubFileContent(settings: CloudSyncSettings, apiPath: string): Promise<{ text: string; sha: string }> {
  const remote = await githubRequest<{ sha: string; content: string }>(settings, apiPath);
  if (remote.content) {
    return { text: decodeBase64Utf8(remote.content), sha: remote.sha };
  }
  // apiPath is /repos/{owner}/{repo}/contents/... — extract the repo root
  const repoBase = apiPath.split("/contents/")[0];
  const blobResp = await fetch(`https://api.github.com${repoBase}/git/blobs/${remote.sha}`, {
    headers: {
      Accept: "application/vnd.github.raw",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${settings.token}`,
    },
  });
  if (!blobResp.ok) throw new Error(`Failed to fetch save file from GitHub (HTTP ${blobResp.status}).`);
  return { text: await blobResp.text(), sha: remote.sha };
}

export async function githubRequest<T>(settings: CloudSyncSettings, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${settings.token}`,
      ...(init.headers ?? {}),
    },
  });

  let raw: { message?: string };
  try {
    raw = (await response.json()) as { message?: string };
  } catch {
    if (!response.ok) throw new Error(`GitHub sync failed with HTTP ${response.status}.`);
    throw new Error(`GitHub returned an empty or unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(raw.message || `GitHub sync failed with HTTP ${response.status}.`);
  }
  return raw as T;
}

export async function resolveOwner(settings: CloudSyncSettings): Promise<string> {
  if (settings.owner.trim()) return settings.owner.trim();
  const user = await githubRequest<GitHubUserResponse>(settings, "/user");
  return user.login;
}

export async function ensureRepo(settings: CloudSyncSettings, owner: string): Promise<void> {
  try {
    await githubRequest(settings, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(settings.repo)}`);
  } catch (error) {
    if (!settings.createPrivateRepoIfMissing) throw error;
    await githubRequest(settings, "/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: settings.repo,
        private: true,
        auto_init: true,
      }),
    });
  }
}

function contentPath(settings: CloudSyncSettings, owner: string): string {
  const repo = encodeURIComponent(settings.repo.trim());
  const path = settings.path.split("/").map(encodeURIComponent).join("/");
  return `/repos/${encodeURIComponent(owner)}/${repo}/contents/${path}`;
}

async function fetchBundle(
  settings: CloudSyncSettings,
  owner: string,
): Promise<{ bundle?: CloudSyncBundle; sha?: string }> {
  try {
    const { text, sha } = await fetchGitHubFileContent(
      settings,
      `${contentPath(settings, owner)}?ref=${encodeURIComponent(settings.branch.trim())}`,
    );
    const parsed = JSON.parse(text) as CloudSyncBundle;
    if (parsed.app !== "ai-story-teller" || !Array.isArray(parsed.adventures)) {
      throw new Error("GitHub sync file is not an AI Story Teller sync bundle.");
    }
    return {
      sha,
      bundle: {
        ...parsed,
        adventures: parsed.adventures.map(sanitizeAdventure),
      },
    };
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return {};
    throw error;
  }
}

function mergeByNewest(localAdventures: Adventure[], remoteAdventures: Adventure[]): Adventure[] {
  const byId = new Map<string, Adventure>();
  for (const adventure of [...remoteAdventures, ...localAdventures]) {
    const normalized = sanitizeAdventure(adventure);
    const existing = byId.get(normalized.id);
    if (!existing || normalized.updatedAt.localeCompare(existing.updatedAt) > 0) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function uploadBundle(
  settings: CloudSyncSettings,
  owner: string,
  adventures: Adventure[],
  sha?: string,
): Promise<void> {
  const bundle: CloudSyncBundle = {
    app: "ai-story-teller",
    version: 1,
    exportedAt: new Date().toISOString(),
    adventures: adventures.map(sanitizeAdventure),
  };
  await githubRequest(settings, contentPath(settings, owner), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Sync AI Story Teller adventures (${adventures.length})`,
      branch: settings.branch.trim(),
      content: encodeBase64Utf8(JSON.stringify(bundle, null, 2)),
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function pushGitHubCloudSync(
  settings: CloudSyncSettings,
  localAdventures: Adventure[],
): Promise<CloudSyncResult> {
  assertSettings(settings);
  const owner = await resolveOwner(settings);
  await ensureRepo(settings, owner);
  const remote = await fetchBundle(settings, owner);
  const remoteAdventures = remote.bundle?.adventures ?? [];
  const adventures = mergeByNewest(localAdventures, remoteAdventures);
  await uploadBundle(settings, owner, adventures, remote.sha);
  return {
    owner,
    repo: settings.repo.trim(),
    path: settings.path.trim(),
    branch: settings.branch.trim(),
    adventures,
    remoteAdventureCount: remoteAdventures.length,
    uploaded: true,
  };
}

export async function pullGitHubCloudSync(
  settings: CloudSyncSettings,
  localAdventures: Adventure[],
): Promise<CloudSyncResult> {
  assertSettings(settings);
  const owner = await resolveOwner(settings);
  await ensureRepo(settings, owner);
  const remote = await fetchBundle(settings, owner);
  const remoteAdventures = remote.bundle?.adventures ?? [];
  const adventures = mergeByNewest(localAdventures, remoteAdventures);
  return {
    owner,
    repo: settings.repo.trim(),
    path: settings.path.trim(),
    branch: settings.branch.trim(),
    adventures,
    remoteAdventureCount: remoteAdventures.length,
    uploaded: false,
  };
}
