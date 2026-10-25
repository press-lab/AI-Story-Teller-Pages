import { expect, it } from "vitest";
import { discoveryEvidenceError, parseDiscoveryCandidate } from "./discoveryEvidence";
import type { MemoryDiscoveryCandidate, Message } from "../types/adventure";
const messages: Message[] = [
  { id: "player", role: "user", content: "I offer to share the key.", createdAt: "2026-01-01" },
  { id: "source", role: "assistant", content: "Mira accepts the offer.", createdAt: "2026-01-01" },
];
const candidate: MemoryDiscoveryCandidate = { title: "Acceptance", content: "Mira accepted the offer.", storyCardType: "lore", memoryMode: "historical", eventStatus: "completed",
  evidenceMessageIds: ["player", "source"], evidenceQuotes: [{ messageId: "source", quote: "Mira accepts the offer." }] };
it.each([
  [{ evidenceMessageIds: [] }, "discovery_missing_evidence_ids"],
  [{ evidenceMessageIds: ["foreign"] }, "discovery_foreign_evidence_ids"],
  [{ evidenceMessageIds: ["player"] }, "discovery_missing_establishing_source"],
  [{ evidenceQuotes: [{ messageId: "source", quote: "Mira signed a contract." }] }, "discovery_invalid_evidence_quote"],
  [{ evidenceQuotes: [{ messageId: "player", quote: "I offer to share the key." }] }, "discovery_missing_establishing_quote"],
])("classifies evidence failures without inventing or repairing quotes", (patch, code) => {
  expect(discoveryEvidenceError({ ...candidate, ...patch }, messages, "source")?.code).toBe(code);
});
it("accepts exact original attribution and drops unknown provider fields before checkpointing", () => {
  const parsed = parseDiscoveryCandidate({ ...candidate, arbitraryResponseBody: "never-persist", evidenceQuotes: [{ ...candidate.evidenceQuotes![0], secret: "never-persist" }] });
  expect(parsed.error).toBeUndefined();
  expect(discoveryEvidenceError(parsed.candidate, messages, "source")).toBeUndefined();
  expect(JSON.stringify(parsed.candidate)).not.toContain("never-persist");
});
