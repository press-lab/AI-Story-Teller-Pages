import type { CompressedMemoryHistoryBlock, MemoryHistoryRecord } from "../types/adventure";

// Only imported by the Web Worker in production. Typed JSON preserves optional
// undefined fields, string code units, sparse arrays and property order as well.
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 256;
type Packed = null | boolean | string | number | ["undefined"] | ["number", string]
  | ["object" | "nullObject", Array<[string, Packed]>] | ["array", number, Array<[string, Packed]>];

function invalid(detail: string): Error {
  return new Error(`memory_history_invalid: ${detail}`);
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


function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function compressHistory(record: MemoryHistoryRecord): Promise<CompressedMemoryHistoryBlock> {
  const text = JSON.stringify(pack(record));
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > DEFAULT_MAX_BYTES) throw invalid("Record exceeds the 32 MiB safety limit; original retained.");
  const block: CompressedMemoryHistoryBlock = { id: crypto.randomUUID(), version: 1,
    format: "aist-memory-history", encoding: "typed-json-gzip-base64", kind: record.kind, recordId: record.id,
    decodedBytes: bytes.length, sha256: await digest(bytes), data: base64(await transform(bytes, "encode", DEFAULT_MAX_BYTES)) };
  // Do not authorize removal until the exact encoded representation round-trips.
  if (JSON.stringify(pack(await decompressHistory(block))) !== text) throw invalid("Round-trip verification failed.");
  return block;
}
export async function decompressHistory(block: CompressedMemoryHistoryBlock): Promise<MemoryHistoryRecord> {
  try {
    if (block.version !== 1 || block.format !== "aist-memory-history" || block.encoding !== "typed-json-gzip-base64"
      || !Number.isSafeInteger(block.decodedBytes) || block.decodedBytes < 1 || block.decodedBytes > DEFAULT_MAX_BYTES
      || typeof block.data !== "string" || block.data.length > DEFAULT_MAX_BYTES * 2
      || !/^[a-f0-9]{64}$/.test(block.sha256)) throw invalid("Unsupported or malformed archive block.");
    const bytes = await transform(Uint8Array.from(atob(block.data), c => c.charCodeAt(0)), "decode", block.decodedBytes);
    if (bytes.length !== block.decodedBytes || await digest(bytes) !== block.sha256) throw invalid("Archive integrity check failed.");
    const record = unpack(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) as MemoryHistoryRecord;
    if (!record || record.kind !== block.kind || record.id !== block.recordId || !record.value
      || !["proposal", "evaluation"].includes(record.kind)) throw invalid("Archive record identity mismatch.");
    return record;
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : "Archive cannot be decoded.");
  }
}
