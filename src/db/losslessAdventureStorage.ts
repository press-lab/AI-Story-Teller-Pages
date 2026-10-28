import type { Adventure } from "../types/adventure";
import { sanitizeAdventureForPersistence } from "../state/defaults";

/** Experimental codec only: deliberately not connected to database or export writers. */
export interface LosslessAdventureEnvelope {
  format: "ai-story-teller-lossless";
  version: 1;
  encoding: "typed-json-gzip";
  decodedBytes: number;
  sha256: string;
  data: Uint8Array;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const MAX_DEPTH = 256;
type Packed = null | boolean | string | number | ["undefined"] | ["number", string]
  | ["object" | "nullObject", Array<[string, Packed]>] | ["array", number, Array<[string, Packed]>];

function invalid(detail: string): Error {
  return new Error(`lossless_save_invalid: ${detail}`);
}

function pack(value: unknown, ancestors = new Set<object>(), depth = 0): Packed {
  if (depth > MAX_DEPTH) throw invalid("Data is nested too deeply.");
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0) ? value : ["number", String(Object.is(value, -0) ? "-0" : value)];
  }
  if (typeof value !== "object") throw invalid("Unsupported value type.");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid("Unsupported object type.");
  if (ancestors.has(value)) throw invalid("Cyclic data.");
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length + (array ? 1 : 0)) throw invalid("Unsupported hidden or symbol properties.");
  ancestors.add(value);
  try {
    const entries: Array<[string, Packed]> = keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw invalid("Accessor properties are unsupported.");
      return [key, pack(descriptor.value, ancestors, depth + 1)];
    });
    return array ? ["array", value.length, entries] : [prototype === null ? "nullObject" : "object", entries];
  } finally { ancestors.delete(value); }
}

function unpack(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw invalid("Data is nested too deeply.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value)) throw invalid("Malformed typed value.");
  if (value.length === 1 && value[0] === "undefined") return undefined;
  if (value.length === 2 && value[0] === "number") {
    switch (value[1]) {
      case "-0": return -0;
      case "NaN": return NaN;
      case "Infinity": return Infinity;
      case "-Infinity": return -Infinity;
      default: throw invalid("Malformed number.");
    }
  }
  const array = value[0] === "array";
  if (array ? value.length !== 3 || !Number.isSafeInteger(value[1]) || value[1] < 0 || value[1] > 0xffffffff
    : value.length !== 2 || !["object", "nullObject"].includes(value[0])) throw invalid("Malformed container.");
  const entries: unknown = array ? value[2] : value[1];
  if (!Array.isArray(entries)) throw invalid("Missing container entries.");
  const result = array ? new Array(value[1]) : value[0] === "nullObject" ? Object.create(null) : {};
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || keys.has(entry[0])) throw invalid("Malformed or duplicate property.");
    const key = entry[0];
    if (array && (key === "length" || /^(0|[1-9]\d*)$/.test(key) && Number(key) < 0xffffffff && Number(key) >= value[1])) throw invalid("Array entry exceeds its length.");
    keys.add(key);
    Object.defineProperty(result, key, { value: unpack(entry[1], depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function transform(bytes: Uint8Array, direction: "encode" | "decode", maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes).buffer]).stream();
  const reader = (direction === "encode" ? stream.pipeThrough(new CompressionStream("gzip"))
    : stream.pipeThrough(new DecompressionStream("gzip"))).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw invalid("Decoded data exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function requireCapabilities() {
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined" || !globalThis.crypto?.subtle) {
    throw new Error("lossless_save_unavailable: Compression and integrity support are required.");
  }
}

export async function encodeAdventureStorage(adventure: Adventure): Promise<LosslessAdventureEnvelope> {
  requireCapabilities();
  // Keep the existing credential policy. No normalization, evaluation or status changes.
  const bytes = new TextEncoder().encode(JSON.stringify(pack(sanitizeAdventureForPersistence(adventure))));
  if (bytes.byteLength > DEFAULT_MAX_BYTES) throw invalid("Data exceeds the size limit.");
  return { format: "ai-story-teller-lossless", version: 1, encoding: "typed-json-gzip", decodedBytes: bytes.byteLength,
    sha256: await digest(bytes), data: await transform(bytes, "encode", Infinity) };
}

export async function decodeAdventureStorage(envelope: unknown, maxDecodedBytes = DEFAULT_MAX_BYTES): Promise<Adventure> {
  requireCapabilities();
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 1) throw invalid("Invalid size limit.");
  if (!envelope || typeof envelope !== "object") throw invalid("Missing envelope.");
  const e = envelope as Partial<LosslessAdventureEnvelope>;
  if (e.format !== "ai-story-teller-lossless" || e.version !== 1 || e.encoding !== "typed-json-gzip"
    || !Number.isSafeInteger(e.decodedBytes) || e.decodedBytes! < 1 || e.decodedBytes! > maxDecodedBytes
    || typeof e.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.sha256) || !(e.data instanceof Uint8Array)) throw invalid("Unsupported or malformed envelope.");
  try {
    const bytes = await transform(e.data, "decode", e.decodedBytes!);
    if (bytes.byteLength !== e.decodedBytes || await digest(bytes) !== e.sha256) throw invalid("Integrity check failed.");
    const result = unpack(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) as Adventure;
    if (!result || typeof result !== "object" || typeof result.id !== "string" || typeof result.title !== "string"
      || !Array.isArray(result.messages) || !Array.isArray(result.storyCards) || !Array.isArray(result.brains)
      || !Array.isArray(result.components) || !result.activeState || typeof result.activeState !== "object") throw invalid("Missing adventure fields.");
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("lossless_save_invalid:")) throw error;
    throw invalid("Compressed data could not be read.");
  }
}
