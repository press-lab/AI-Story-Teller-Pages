import { IDBFactory } from "fake-indexeddb";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, sanitizeAdventureForPersistence } from "../state/defaults";
import type { Adventure } from "../types/adventure";
import { decodeAdventureStorage, encodeAdventureStorage } from "./losslessAdventureStorage";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function envelopeFor(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { format: "ai-story-teller-lossless", version: 1, encoding: "typed-json-gzip", decodedBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), data: new Uint8Array(gzipSync(bytes)) };
}

describe("disabled lossless adventure codec", () => {
  it("preserves the entire sanitized adventure, exact strings, unknown fields and property order", async () => {
    const a = createDefaultAdventure("Exact round trip");
    const odd = Object.create(null);
    odd.__proto__ = "ordinary user content";
    const sparse = new Array(4);
    sparse[2] = undefined;
    Object.assign(a.metadata, { unknown: { $ref: "not a storage reference", format: "ai-story-teller-lossless", version: 1 },
      text: '\ud800\udfff\u0000 🎓 e\u0301\r\n  {"b":2, "a":1}  ', array: ["undefined", undefined, null, -0, NaN, Infinity, -Infinity],
      sparse, odd, explicitlyUndefined: undefined });
    (a as Adventure & { futureField: unknown }).futureField = { z: "last", a: "first", nested: { missing: undefined } };
    a.messages.push({ id: "source", role: "assistant", content: "Exact evidence.", createdAt: a.createdAt,
      memoryEvaluation: { pipeline: "singlePass", revision: "r", turn: 1, status: "pending", attempts: 0, completedGroups: [],
        singlePass: { batchId: "b", sourceContent: "Exact evidence.", referenceState: ' {"second":2, "first":1}\r\n ', status: "running",
          evidence: [], findings: [], dispositions: [], acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 } } });
    const before = sanitizeAdventureForPersistence(a);
    const first = await encodeAdventureStorage(a);
    const restored = await decodeAdventureStorage(first);
    expect(restored).toStrictEqual(before);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(before));
    expect(Object.hasOwn(restored.metadata, "explicitlyUndefined")).toBe(true);
    expect(Object.hasOwn(restored.metadata.sparse as object, "0")).toBe(false);
    expect(Object.hasOwn(restored.metadata.sparse as object, "2")).toBe(true);
    expect(Object.getPrototypeOf(restored.metadata.odd)).toBe(null);
    expect(Object.is((restored.metadata.array as unknown[])[3], -0)).toBe(true);
    // Independent decompressor checks this is a real, portable gzip stream.
    expect(gunzipSync(first.data).byteLength).toBe(first.decodedBytes);
    const second = await encodeAdventureStorage(a);
    expect(second.sha256).toBe(first.sha256);
    expect(second.data).toEqual(first.data);
  });

  it("uses existing credential sanitization and never requests a model", async () => {
    const fetch = vi.fn(() => { throw new Error("No network allowed"); });
    vi.stubGlobal("fetch", fetch);
    const a = createDefaultAdventure("Credentials");
    a.modelConfig.apiKey = "private-runtime-key";
    a.modelConfig.sessionId = "private-session";
    a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://example.invalid", model: "test", apiKey: "private-background-key" };
    const restored = await decodeAdventureStorage(await encodeAdventureStorage(a));
    expect(restored).toStrictEqual(sanitizeAdventureForPersistence(a));
    expect(JSON.stringify(restored)).not.toContain("private-");
    expect(a.modelConfig.apiKey).toBe("private-runtime-key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects damaged payloads, altered checksums, size mismatches and unknown formats", async () => {
    const e = await encodeAdventureStorage(createDefaultAdventure("Integrity"));
    const damaged = new Uint8Array(e.data);
    damaged[Math.floor(damaged.length / 2)] ^= 0xff;
    for (const bad of [null, { ...e, version: 99 }, { ...e, encoding: "other" }, { ...e, data: damaged },
      { ...e, data: e.data.slice(0, -8) }, { ...e, sha256: "0".repeat(64) }, { ...e, decodedBytes: e.decodedBytes + 1 },
      { ...e, decodedBytes: e.decodedBytes - 1 }]) {
      await expect(decodeAdventureStorage(bad)).rejects.toThrow("lossless_save_invalid:");
    }
    await expect(decodeAdventureStorage(e, e.decodedBytes - 1)).rejects.toThrow("lossless_save_invalid:");
    await expect(decodeAdventureStorage(e, 0)).rejects.toThrow("lossless_save_invalid:");
  });

  it.each([
    ["object", [["id", "a"], ["id", "b"]]],
    ["array", 1, [["1", "out of bounds"]]],
    ["array", 1, [["length", 3]]],
    ["number", "unexpected"],
    ["undefined", "unexpected"],
    ["object", [["__proto__", ["object", [["polluted", true]]]]]],
    ["object", [["id", "missing other adventure fields"]]],
  ])("rejects a well-compressed but malformed typed document %#", async (...value) => {
    await expect(decodeAdventureStorage(envelopeFor(value))).rejects.toThrow("lossless_save_invalid:");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects unsupported data rather than silently dropping it", async () => {
    for (const value of [new Date(), new Map(), () => "hidden", 1n]) {
      const a = createDefaultAdventure("Unsupported");
      Object.assign(a.metadata, { value });
      await expect(encodeAdventureStorage(a)).rejects.toThrow("lossless_save_invalid:");
    }
    const a = createDefaultAdventure("Cycle");
    a.metadata.cycle = a.metadata;
    await expect(encodeAdventureStorage(a)).rejects.toThrow("Cyclic");
  });

  it("survives an IndexedDB write/read without changing data or evaluation status", async () => {
    const factory = new IDBFactory();
    const a = createDefaultAdventure("Isolated storage");
    const envelope = await encodeAdventureStorage(a);
    const loaded = await new Promise<unknown>((resolve, reject) => {
      const request = factory.open("isolated-lossless-test", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("encoded");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const write = db.transaction("encoded", "readwrite");
        write.objectStore("encoded").put(envelope, a.id);
        write.onerror = () => { db.close(); reject(write.error); };
        write.oncomplete = () => {
          const read = db.transaction("encoded", "readonly");
          const get = read.objectStore("encoded").get(a.id);
          read.oncomplete = () => { db.close(); resolve(get.result); };
          read.onerror = () => { db.close(); reject(read.error); };
        };
      };
    });
    expect(await decodeAdventureStorage(loaded)).toStrictEqual(sanitizeAdventureForPersistence(a));
  });

  it("reports unavailable compression support without silently changing format", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    await expect(encodeAdventureStorage(createDefaultAdventure("Unavailable"))).rejects.toThrow("lossless_save_unavailable:");
  });
});
