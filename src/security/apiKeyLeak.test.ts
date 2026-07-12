/**
 * @vitest-environment jsdom
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveAdventure, getAdventure } from "../db/adventureDb";
import { createDefaultAdventure } from "../state/defaults";
import { pushGitHubCloudSync } from "../sync/githubSync";
import type { CloudSyncSettings } from "../types/adventure";
import { exportAdventureJson } from "../utils/json";

const DB_NAME = "ai-story-teller";
const SECRET = "secret-leak-token-xyz";

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function decodeUploadedBundle(uploadBody: string): string {
  const parsed = JSON.parse(uploadBody) as { content: string };
  return atob(parsed.content);
}

describe("API key leak regression", () => {
  beforeEach(async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: new IDBFactory(),
      configurable: true,
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: IDBKeyRange,
      configurable: true,
    });
    await deleteDb();
    vi.restoreAllMocks();
  });

  it("strips provider API keys from IndexedDB, export JSON, and GitHub cloud sync payloads", async () => {
    const adventure = createDefaultAdventure("Secret Safety");
    adventure.modelConfig = { ...adventure.modelConfig, apiKey: SECRET };
    adventure.semanticEvaluationSettings = {
      ...adventure.semanticEvaluationSettings,
      backgroundProviderConfig: {
        baseUrl: "https://background.example.com/v1",
        apiKey: SECRET,
        model: "background-model",
      },
    };

    await saveAdventure(adventure);
    const loaded = await getAdventure(adventure.id);
    expect(JSON.stringify(loaded)).not.toContain(SECRET);
    expect(loaded?.modelConfig.apiKey).toBeUndefined();
    expect(loaded?.semanticEvaluationSettings.backgroundProviderConfig?.apiKey).toBeUndefined();

    const exported = exportAdventureJson(adventure);
    expect(exported).not.toContain(SECRET);

    let uploadedBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/repos/fieldnote11/ai-story-teller-sync")) return response(200, {});
      if (requestUrl.includes("/contents/") && init?.method !== "PUT") return response(404, { message: "Not Found" });
      if (init?.method === "PUT") {
        uploadedBody = String(init.body);
        return response(200, { content: { sha: "new-sha" } });
      }
      return response(200, {});
    });

    const settings: CloudSyncSettings = {
      token: "github-test-token",
      owner: "fieldnote11",
      repo: "ai-story-teller-sync",
      branch: "main",
      path: "sync/adventures.json",
      createPrivateRepoIfMissing: false,
    };
    const result = await pushGitHubCloudSync(settings, [adventure]);

    expect(JSON.stringify(result.adventures)).not.toContain(SECRET);
    expect(uploadedBody).toBeTruthy();
    expect(uploadedBody).not.toContain(SECRET);
    expect(decodeUploadedBundle(uploadedBody)).not.toContain(SECRET);
  });
});
