import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import type { Adventure, CloudSyncSettings } from "../types/adventure";
import { pullGitHubCloudSync, pushGitHubCloudSync } from "./githubSync";

const settings: CloudSyncSettings = {
  token: "github-test-token",
  owner: "fieldnote11",
  repo: "ai-story-teller-sync",
  branch: "main",
  path: "sync/adventures.json",
  createPrivateRepoIfMissing: false,
};

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function encode(text: string): string {
  // btoa only handles Latin-1; encodeURIComponent + unescape handles full UTF-8
  return btoa(unescape(encodeURIComponent(text)));
}

function bundle(adventures: Adventure[]) {
  return {
    app: "ai-story-teller",
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    adventures,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHub cloud sync", () => {
  it("pushes a sanitized merged adventure bundle to GitHub contents", async () => {
    const local = createDefaultAdventure("Local");
    local.updatedAt = "2026-01-02T00:00:00.000Z";
    local.modelConfig = { ...local.modelConfig, apiKey: "must-not-sync" };
    const remote = createDefaultAdventure("Remote");
    remote.updatedAt = "2026-01-01T00:00:00.000Z";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/repos/fieldnote11/ai-story-teller-sync")) return response(200, {});
      if (init?.method === "PUT") return response(200, { content: { sha: "new-sha" } });
      return response(200, {
        sha: "old-sha",
        content: encode(JSON.stringify(bundle([remote]))),
      });
    });

    const result = await pushGitHubCloudSync(settings, [local]);

    expect(result.adventures.map((adventure) => adventure.title)).toEqual(["Local", "Remote"]);
    const putCall = fetchSpy.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall?.[1]?.body as string);
    expect(body.sha).toBe("old-sha");
    const uploaded = JSON.parse(atob(body.content));
    expect(JSON.stringify(uploaded)).not.toContain("must-not-sync");
  });

  it("pulls remote adventures and keeps newer local copies when ids conflict", async () => {
    const local = createDefaultAdventure("Local Newer");
    local.id = "same-id";
    local.updatedAt = "2026-01-03T00:00:00.000Z";
    const remote = createDefaultAdventure("Remote Older");
    remote.id = "same-id";
    remote.updatedAt = "2026-01-02T00:00:00.000Z";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/repos/fieldnote11/ai-story-teller-sync")) return response(200, {});
      return response(200, {
        sha: "remote-sha",
        content: encode(JSON.stringify(bundle([remote]))),
      });
    });

    const result = await pullGitHubCloudSync(settings, [local]);

    expect(result.uploaded).toBe(false);
    expect(result.remoteAdventureCount).toBe(1);
    expect(result.adventures).toHaveLength(1);
    expect(result.adventures[0].title).toBe("Local Newer");
  });
});
