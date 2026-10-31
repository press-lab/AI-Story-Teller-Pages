import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { snapshotFingerprint } from "./snapshotFingerprint";
it.each(["", "abc", "a".repeat(31), "b".repeat(32), "c".repeat(100000), "\u4f60\u597d \ud83d\ude00", "\ud800", "\udc00", "\ufffd"])("matches independent SHA-256 for UTF-16 input %#", text => {
  const bytes = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) bytes.writeUInt16BE(text.charCodeAt(i), i * 2);
  expect(snapshotFingerprint(text)).toBe("sha256-u16-v1:" + createHash("sha256").update(bytes).digest("hex"));
  expect(snapshotFingerprint(snapshotFingerprint(text))).toBe(snapshotFingerprint(text));
});
it("does not merge distinct unpaired surrogates", () => {
  expect(snapshotFingerprint("\ud800")).not.toBe(snapshotFingerprint("\udc00"));
  expect(snapshotFingerprint("\ud800")).not.toBe(snapshotFingerprint("\ufffd"));
});
