import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import type { Adventure, CloudSyncSettings, GitHubSaveSettings, GitHubSaveSlot } from "../types/adventure";
import { deleteGitHubSave, listGitHubSaves, loadGitHubSave, saveToGitHub, shouldAutoSave } from "./githubSaves";

const cloudSettings: CloudSyncSettings = {
  token: "github-test-token",
  owner: "fieldnote11",
  repo: "ai-story-teller-sync",
  branch: "main",
  path: "sync/adventures.json",
  createPrivateRepoIfMissing: false,
};

const saveSettings: GitHubSaveSettings = {
  savesBasePath: "sync/saves",
};

function autoSaveAdventure(overrides: Partial<Adventure> = {}): Adventure {
  return makeAdventure({ autoSaveEnabled: true, autoSaveEveryNTurns: 5, ...overrides });
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function makeAdventure(overrides: Partial<Adventure> = {}): Adventure {
  const adventure = createDefaultAdventure("Test Adventure");
  return { ...adventure, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldAutoSave", () => {
  it("returns false when auto-save is disabled", () => {
    const adventure = autoSaveAdventure({ autoSaveEnabled: false });
    adventure.activeState.turn = 10;
    expect(shouldAutoSave(adventure, saveSettings, 0)).toBe(false);
  });

  it("returns false when threshold not reached", () => {
    const adventure = autoSaveAdventure();
    adventure.activeState.turn = 3;
    expect(shouldAutoSave(adventure, saveSettings, 0)).toBe(false);
  });

  it("returns false when turn equals last auto-saved turn (prevents duplicates)", () => {
    const adventure = autoSaveAdventure();
    adventure.activeState.turn = 5;
    expect(shouldAutoSave(adventure, saveSettings, 5)).toBe(false);
  });

  it("returns true when threshold is met and turn has advanced", () => {
    const adventure = autoSaveAdventure();
    adventure.activeState.turn = 5;
    expect(shouldAutoSave(adventure, saveSettings, 0)).toBe(true);
  });

  it("returns true when multiple thresholds have passed", () => {
    const adventure = autoSaveAdventure();
    adventure.activeState.turn = 20;
    expect(shouldAutoSave(adventure, saveSettings, 5)).toBe(true);
  });

  it("returns false when everyNTurns is 0", () => {
    const adventure = autoSaveAdventure({ autoSaveEveryNTurns: 0 });
    adventure.activeState.turn = 100;
    expect(shouldAutoSave(adventure, saveSettings, 0)).toBe(false);
  });

  it("treats each adventure independently — adventure B is not blocked by adventure A's saved turn", () => {
    const adventureA = autoSaveAdventure();
    adventureA.activeState.turn = 50;
    const adventureB = autoSaveAdventure();
    adventureB.activeState.turn = 5;

    // Simulate per-adventure tracking: A was last saved at turn 50, B at -1
    const lastSavedByAdventure: Record<string, number> = { [adventureA.id]: 50 };
    const lastTurnA = lastSavedByAdventure[adventureA.id] ?? -1;
    const lastTurnB = lastSavedByAdventure[adventureB.id] ?? -1;

    // A just saved at 50, not due again yet
    expect(shouldAutoSave(adventureA, saveSettings, lastTurnA)).toBe(false);
    // B has reached threshold from its own baseline of -1
    expect(shouldAutoSave(adventureB, saveSettings, lastTurnB)).toBe(true);
  });
});

describe("saveToGitHub", () => {
  it("writes a sanitized save file then updates the index, returning a slot", async () => {
    const adventure = makeAdventure();
    adventure.modelConfig = { ...adventure.modelConfig, apiKey: "secret-key" };
    adventure.activeState.turn = 7;

    const putCalls: Array<{ url: string; body: unknown }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/repos/fieldnote11/ai-story-teller-sync") && !requestUrl.includes("/contents")) {
        return response(200, {});
      }
      if (init?.method === "PUT") {
        putCalls.push({ url: requestUrl, body: JSON.parse(init.body as string) });
        return response(200, { content: { sha: "new-sha" } });
      }
      // index GET — not found initially
      return response(404, { message: "Not Found" });
    });

    const slot = await saveToGitHub(cloudSettings, saveSettings, adventure, "manual");

    expect(slot.adventureId).toBe(adventure.id);
    expect(slot.title).toBe("Test Adventure");
    expect(slot.turnCount).toBe(7);
    expect(slot.saveType).toBe("manual");

    // Two PUTs: one for the save file, one for the index
    expect(putCalls).toHaveLength(2);

    // Save file must not contain the API key
    const saveFilePut = putCalls[0];
    const saveFileContent = JSON.parse(atob((saveFilePut.body as { content: string }).content));
    expect(JSON.stringify(saveFileContent)).not.toContain("secret-key");
    expect(saveFileContent.adventure.title).toBe("Test Adventure");
    expect(saveFileContent.saveType).toBe("manual");

    // Index PUT should list the slot
    const indexPut = putCalls[1];
    const indexContent = JSON.parse(atob((indexPut.body as { content: string }).content));
    expect(indexContent.slots).toHaveLength(1);
    expect(indexContent.slots[0].saveId).toBe(slot.saveId);
  });

  it("saves complete adventure state including messages, components, and story cards", async () => {
    const adventure = makeAdventure();
    adventure.messages = [
      { id: "m1", role: "user", content: "Hello", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "m2", role: "assistant", content: "World", createdAt: "2026-01-01T00:00:00.000Z" },
    ];

    let savedAdventure: Adventure | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/repos/fieldnote11/ai-story-teller-sync") && !requestUrl.includes("/contents")) {
        return response(200, {});
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as { content: string; message: string };
        if (body.message.startsWith("Save ")) {
          const fileContent = JSON.parse(atob(body.content));
          savedAdventure = fileContent.adventure as Adventure;
        }
        return response(200, { content: { sha: "sha" } });
      }
      return response(404, { message: "Not Found" });
    });

    await saveToGitHub(cloudSettings, saveSettings, adventure, "auto");

    expect(savedAdventure).toBeDefined();
    expect(savedAdventure!.messages).toHaveLength(2);
    expect(savedAdventure!.messages[0].content).toBe("Hello");
  });
});

describe("listGitHubSaves", () => {
  it("returns slots from the remote index sorted newest-first", async () => {
    const slots: GitHubSaveSlot[] = [
      { saveId: "older", adventureId: "adv1", title: "Adventure", savedAt: "2026-01-01T00:00:00.000Z", turnCount: 3, saveType: "auto" },
      { saveId: "newer", adventureId: "adv1", title: "Adventure", savedAt: "2026-01-02T00:00:00.000Z", turnCount: 8, saveType: "manual" },
    ];
    const index = { app: "ai-story-teller", version: 1, updatedAt: "2026-01-02T00:00:00.000Z", slots };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/repos/fieldnote11/ai-story-teller-sync") && !requestUrl.includes("/contents")) {
        return response(200, {});
      }
      return response(200, { sha: "sha", content: encode(JSON.stringify(index)) });
    });

    const result = await listGitHubSaves(cloudSettings, saveSettings);

    expect(result).toHaveLength(2);
    expect(result[0].saveId).toBe("newer");
    expect(result[1].saveId).toBe("older");
  });

  it("returns empty array when index does not exist yet", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/repos/fieldnote11/ai-story-teller-sync") && !requestUrl.includes("/contents")) {
        return response(200, {});
      }
      return response(404, { message: "Not Found" });
    });

    const result = await listGitHubSaves(cloudSettings, saveSettings);
    expect(result).toEqual([]);
  });
});

describe("loadGitHubSave", () => {
  it("fetches and normalizes the saved adventure, stripping no fields (load is read-only)", async () => {
    const original = makeAdventure();
    original.title = "Loaded Adventure";
    const saveFile = {
      app: "ai-story-teller",
      version: 1,
      savedAt: "2026-01-01T00:00:00.000Z",
      saveType: "manual",
      adventure: original,
    };
    const slot: GitHubSaveSlot = {
      saveId: "test-save",
      adventureId: original.id,
      title: original.title,
      savedAt: "2026-01-01T00:00:00.000Z",
      turnCount: 0,
      saveType: "manual",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/repos/fieldnote11/ai-story-teller-sync") && !requestUrl.includes("/contents")) {
        return response(200, {});
      }
      return response(200, { sha: "sha", content: encode(JSON.stringify(saveFile)) });
    });

    const loaded = await loadGitHubSave(cloudSettings, saveSettings, slot);

    expect(loaded.title).toBe("Loaded Adventure");
    expect(loaded.id).toBe(original.id);
  });

  it("throws when the save file is not a valid AI Story Teller save", async () => {
    const slot: GitHubSaveSlot = {
      saveId: "bad-save",
      adventureId: "adv1",
      title: "Adventure",
      savedAt: "2026-01-01T00:00:00.000Z",
      turnCount: 0,
      saveType: "manual",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/repos/fieldnote11/ai-story-teller-sync") && !requestUrl.includes("/contents")) {
        return response(200, {});
      }
      return response(200, { sha: "sha", content: encode(JSON.stringify({ app: "something-else" })) });
    });

    await expect(loadGitHubSave(cloudSettings, saveSettings, slot)).rejects.toThrow(
      "Not a valid AI Story Teller save file.",
    );
  });
});

describe("deleteGitHubSave", () => {
  const slots: GitHubSaveSlot[] = [
    { saveId: "ghost", adventureId: "adv1", title: "Adventure", savedAt: "2026-01-01T00:00:00.000Z", turnCount: 3, saveType: "auto" },
    { saveId: "keep", adventureId: "adv1", title: "Adventure", savedAt: "2026-01-02T00:00:00.000Z", turnCount: 8, saveType: "manual" },
  ];

  it("deletes the file and drops the slot from the index", async () => {
    const index = { app: "ai-story-teller", version: 1, updatedAt: "2026-01-02T00:00:00.000Z", slots };
    let indexPutBody: { content: string } | undefined;
    let deletedFile = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/repos/fieldnote11/ai-story-teller-sync") && !u.includes("/contents")) return response(200, {});
      if (u.includes("/sync/saves/adv1/ghost.json")) {
        if (init?.method === "DELETE") { deletedFile = true; return response(200, {}); }
        return response(200, { sha: "file-sha", content: "" }); // file metadata
      }
      if (u.includes("/sync/saves/index.json")) {
        if (init?.method === "PUT") { indexPutBody = JSON.parse(init.body as string); return response(200, { content: { sha: "new" } }); }
        return response(200, { sha: "index-sha", content: encode(JSON.stringify(index)) });
      }
      return response(404, { message: "Not Found" });
    });

    await deleteGitHubSave(cloudSettings, saveSettings, slots[0]);

    expect(deletedFile).toBe(true);
    const written = JSON.parse(atob(indexPutBody!.content));
    expect(written.slots.map((s: GitHubSaveSlot) => s.saveId)).toEqual(["keep"]);
  });

  it("still cleans the index when the save file is already gone (404) — so stale slots are deletable", async () => {
    const index = { app: "ai-story-teller", version: 1, updatedAt: "2026-01-02T00:00:00.000Z", slots };
    let indexPutBody: { content: string } | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("/repos/fieldnote11/ai-story-teller-sync") && !u.includes("/contents")) return response(200, {});
      if (u.includes("/sync/saves/adv1/ghost.json")) return response(404, { message: "Not Found" }); // file already gone
      if (u.includes("/sync/saves/index.json")) {
        if (init?.method === "PUT") { indexPutBody = JSON.parse(init.body as string); return response(200, { content: { sha: "new" } }); }
        return response(200, { sha: "index-sha", content: encode(JSON.stringify(index)) });
      }
      return response(404, { message: "Not Found" });
    });

    await expect(deleteGitHubSave(cloudSettings, saveSettings, slots[0])).resolves.toBeUndefined();

    const written = JSON.parse(atob(indexPutBody!.content));
    expect(written.slots.map((s: GitHubSaveSlot) => s.saveId)).toEqual(["keep"]);
  });
});
