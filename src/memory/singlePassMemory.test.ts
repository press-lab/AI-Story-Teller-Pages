import { describe, it, expect, vi, afterEach } from "vitest";
import { syntheticMemoryAdventure, partnershipSourceId, confirmationQuote } from "./fixtures/syntheticMemoryAdventure";
import { defaultModelConfig, normalizeAdventure, createDefaultAdventure, makeBrain } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { singlePassCycleSources } from "./memoryCycleState";
import { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch, parseSinglePassMemoryResponse, normalizeSinglePassFinding, parseSinglePassMemoryCommands, buildSinglePassMemoryMessages } from "./singlePassMemory";
import * as transport from "../providers/memoryCompletion";
import type { SinglePassMemoryFinding } from "../types/adventure";

import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
afterEach(() => vi.restoreAllMocks());
describe("single-pass extraction request bound", () => {
  it.each([1, 2, 3])("uses one provider request for %i independently empty sources", async count => {
    const { a, ids } = singlePassFixture(count);
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content: JSON.stringify({ sources: ids.map(sourceId => ({ sourceId, findings: [] })) }), usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    const result = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][3]).toBe("singlePass");
    expect(result.sources.every(s => !s.failureReason && !s.findings.length)).toBe(true);
    expect(result.usage?.promptTokens).toBe(100);
  });
  it.each(["multiple", "malformed", "missing", "invalidJson", "timeout", "uncertain"])("never fans out after %s", async mode => {
    const { a, ids } = singlePassFixture();
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    const sources = ids.map(sourceId => ({ sourceId, findings: sourceId === partnershipSourceId ? [groundedFinding(), { ...groundedFinding(), title: "Separate agreement", content: "Blair Reed will arrange a workshop tour later." }] : [] }));
    if (mode === "malformed") sources[0].findings.push({ kind: "storyCard" } as SinglePassMemoryFinding);
    if (mode === "missing") sources.shift();
    if (mode === "uncertain") sources.at(-1)!.findings[0].candidateOnly = true;
    const send = vi.spyOn(transport, "sendMemoryCompletion");
    if (mode === "timeout") send.mockRejectedValue(new Error("timeout"));
    else send.mockResolvedValue({ raw: {}, content: mode === "invalidJson" ? "{" : JSON.stringify({ sources }) });
    try { await runSinglePassMemoryBatch(a, defaultModelConfig, batch); } catch { expect(mode).toBe("timeout"); }
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("preserves valid findings and source siblings", () => {
    const result = parseSinglePassMemoryResponse(JSON.stringify({ sources: [{ sourceId: "a", findings: [groundedFinding(), {}] }, { sourceId: "b", findings: [] }] }), ["a", "b", "c"]);
    expect(result.sources[0].findings).toHaveLength(1);
    expect(result.sources[0].rejected).toHaveLength(1);
    expect(result.sources[1].failureReason).toBeUndefined();
    expect(result.sources[2].failureReason).toBeTruthy();
  });
  it("does not replay old, completed, failed, running or quarantined sources", () => {
    const { a, ids } = singlePassFixture();
    expect(singlePassCycleSources(a).map(m => m.id)).toEqual(ids);
    for (const status of ["complete", "failed", "running", "quarantined"] as const) {
      a.messages.find(m => m.id === ids[0])!.memoryEvaluation!.status = status;
      expect(singlePassCycleSources(a).some(m => m.id === ids[0])).toBe(false);
    }
    const restored = normalizeAdventure(JSON.parse(JSON.stringify(a)));
    expect(singlePassCycleSources(restored).some(m => !ids.includes(m.id))).toBe(false);
  });
  it("commits valid siblings once and preserves the failed source across reload", async () => {
    let { a, ids } = singlePassFixture();
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    const parsed = parseSinglePassMemoryResponse(JSON.stringify({ sources: ids.slice(1).map(sourceId => ({ sourceId, findings: sourceId === partnershipSourceId ? [groundedFinding()] : [] })) }), ids);
    const commit = { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH" as const, batchId: batch.batchId, sources: parsed.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) };
    a = reduce(a, commit);
    expect(a.messages.find(m => m.id === ids[0])!.memoryEvaluation?.status).toBe("failed");
    expect(a.messages.find(m => m.id === ids[1])!.memoryEvaluation?.status).toBe("complete");
    expect(a.activeState.memoryProposals.some(p => p.sourceTurnId === partnershipSourceId)).toBe(true);
    expect(reduce(a, commit)).toBe(a);
    expect(normalizeAdventure(JSON.parse(JSON.stringify(a))).messages.find(m => m.id === ids[0])!.memoryEvaluation?.singlePass?.status).toBe("failed");
  });
});

it.each([
  (s: string) => s,
  (s: string) => "\uFEFF" + s,
  (s: string) => "```json\n" + s + "\n```",
  (s: string) => "<think>Internal reasoning.</think>\n" + s,
  (s: string) => "```json\n<think>Internal reasoning.</think>\n" + s + "\n```",
])("parses complete response wrappers locally", wrap => {
  const result = parseSinglePassMemoryResponse(wrap(JSON.stringify({ sources: [{ sourceId: "a", findings: [groundedFinding()] }] })), ["a"]);
  expect(result.sources[0].findings).toHaveLength(1);
});
it.each(["title", "reason", "candidateOnly", "suggestedTriggers", "participants", "eventStatus", "operation", "memoryMode", "storyCardType"])("recovers missing %s conservatively", field => {
  const { a } = singlePassFixture();
  const raw = { ...groundedFinding() } as Record<string, unknown>;
  delete raw[field];
  const finding = normalizeSinglePassFinding(raw, "a", a);
  expect(finding).toBeDefined(); expect(finding?.candidateOnly).toBe(true);
  if (field === "eventStatus") expect(finding?.eventStatus).toBe("unresolved");
});
it("recovers the minimum factual contract without inventing metadata facts", () => {
  const { a } = singlePassFixture(); const full = groundedFinding();
  const result = parseSinglePassMemoryResponse(JSON.stringify({ sources: [{ sourceId: "a", findings: [{ kind: "storyCard", targetId: null, content: full.content, evidenceQuotes: full.evidenceQuotes, extra: "ignored" }] }] }), ["a"], a);
  expect(result.sources[0].findings[0]).toMatchObject({ title: full.content!.split(/\s+/).slice(0, 8).join(" "), reason: "Extracted from narrator source a.", candidateOnly: true, operation: "create", storyCardType: "lore", memoryMode: "static", eventStatus: "unresolved", participants: [] });
  expect(result.sources[0].diagnostics).toContainEqual({ index: 0, reason: "Ignored unknown finding field: extra." });
});
it.each(["content", "evidenceQuotes", "kind", "targetId"])("does not recover missing factual field %s", field => {
  const raw = { ...groundedFinding() } as Record<string, unknown>; delete raw[field];
  expect(normalizeSinglePassFinding(raw, "a")).toBeUndefined();
});
it("uses existing target metadata and retains valid explicit metadata", () => {
  const { a } = singlePassFixture(); const target = a.storyCards[0];
  const f = normalizeSinglePassFinding({ ...groundedFinding(), title: undefined, operation: undefined, memoryMode: undefined, storyCardType: undefined, targetId: target.id }, "a", a);
  expect(f).toMatchObject({ title: target.title, storyCardType: target.type, memoryMode: target.memoryMode, operation: "append" });
  expect(normalizeSinglePassFinding(groundedFinding(), "a", a)).toEqual(groundedFinding());
});
it("recovers balanced sibling sources from truncated JSON without reconstructing the last object", () => {
  const finding = { ...groundedFinding(), content: 'Literal braces { } and escaped "quotes".' };
  const first = JSON.stringify({ sourceId: "a", findings: [finding] });
  const result = parseSinglePassMemoryResponse('{"sources":[' + first + ',{"sourceId":"b","findings":[{"content":"cut', ["a", "b"]);
  expect(result.sources[0].findings[0].content).toBe(finding.content);
  expect(result.sources[0].findingIndexes).toEqual([0]); expect(result.sources[1].failureReason).toBeTruthy();
});
it("rejects duplicate and unknown source records without guessing attribution", () => {
  const result = parseSinglePassMemoryResponse('{"sources":[{"sourceId":"a","findings":[]},{"sourceId":"a","findings":[]},{"sourceId":"unknown","findings":[]},{"sourceId":"b","findings":[]}', ["a", "b", "c"]);
  expect(result.sources[0].failureReason).toBeTruthy(); expect(result.sources[1].failureReason).toBeUndefined(); expect(result.sources[2].failureReason).toBeTruthy();
  expect(result.sources[1].diagnostics?.some(d => d.reason.includes("unknown source"))).toBe(true);
});
it("does not remove unmatched thought tags or recover objects outside sources", () => {
  expect(parseSinglePassMemoryResponse('<think>{"sourceId":"a","findings":[]}', ["a"]).sources[0].failureReason).toBeTruthy();
  expect(parseSinglePassMemoryResponse('{"other":[{"sourceId":"a","findings":[]}', ["a"]).sources[0].failureReason).toBeTruthy();
});

it("does not strip unmatched thought tags to recover a source from private reasoning", () => {
  expect(parseSinglePassMemoryResponse('<think>{"sources":[{"sourceId":"a","findings":[]}]}', ["a"]).sources[0].failureReason).toBeTruthy();
});
it("does not identify a later array from an earlier sources string", () => {
  expect(parseSinglePassMemoryResponse('{"sources":"invalid","other":[{"sourceId":"a","findings":[]}', ["a"]).sources[0].failureReason).toBeTruthy();
});


const commandAliases = {
  S1: { sourceId: "Narrator-One", sourceTurn: 12, evidence: { E1: { id: "player", reference: 0 }, E2: { id: "Narrator-One", reference: 1 } },
    cards: { C1: { id: "lore", type: "lore", memoryMode: "historical" as const, reference: 2 }, C2: { id: "person", type: "character", memoryMode: "static" as const, reference: 3 } },
    brains: { B1: { id: "brain", type: "brain" as const, reference: 4 } },
    plot: { P1: { id: "premise", type: "plotEssentials", reference: 5 }, P2: { id: "pressure", type: "activePressure", reference: 6 }, P3: { id: "arc", type: "currentArc", reference: 7 } } },
  S2: { sourceId: "two", sourceTurn: 13, evidence: { E2: { id: "two", reference: 8 } }, cards: {}, brains: {}, plot: {} },
  S3: { sourceId: "three", sourceTurn: 14, evidence: { E2: { id: "three", reference: 9 } }, cards: {}, brains: {}, plot: {} },
};
const memoryCommand = (header = "S1 storyCard NEW", meta = "", content = "The spell held.", evidence = 'E E2 | "The spell held."') =>
  `MEM ${header}\n${meta ? meta + "\n" : ""}${evidence}\nTEXT\n${content}\nEND`;
const commandAdventure = createDefaultAdventure("Command evidence");
commandAdventure.messages = ["Narrator-One", "two", "three", "player"].map(id => ({
  id, role: id === "player" ? "user" as const : "assistant" as const, createdAt: "2026-10-27T00:00:00Z",
  content: id === "player" ? "player words" : '\"The spell held.\" \"a | b\": {}',
}));
const commands = (text: string) => parseSinglePassMemoryCommands(text, commandAliases, commandAdventure);
const complete = (text: string) => commands(text + "\nDONE S1\nDONE S2\nDONE S3");
describe("simple memory command protocol", () => {
  it("constructs the exact normalized new Lore finding", () => {
    expect(complete(memoryCommand()).sources[0].findings).toEqual([{
      kind: "storyCard", targetId: null, title: "The spell", content: "The spell held.", reason: "Extracted from narrator source Narrator-One.",
      evidenceQuotes: [{ messageId: "Narrator-One", quote: '\"The spell held.\"' }], candidateOnly: true,
      operation: "create", storyCardType: "lore", memoryMode: "static", eventStatus: "unresolved", participants: [], suggestedTriggers: ["spell", "spell held"],
    }]);
  });
  it("appends using the existing type and mode", () => {
    expect(complete(memoryCommand("S1 storyCard C1")).sources[0].findings[0]).toMatchObject({ targetId: "lore", operation: "append", storyCardType: "lore", memoryMode: "historical" });
  });
  it.each(["thought", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"])("constructs Brain FIELD %s locally", field => {
    const result = complete(memoryCommand("S1 brain B1", `TITLE Suspicion\nFIELD ${field}`, "I suspect a secret."));
    expect(result.sources[0].findings).toEqual([{ kind: "brain", targetId: "brain", title: "Suspicion", reason: "Extracted from narrator source Narrator-One.", candidateOnly: true,
      evidenceQuotes: [{ messageId: "Narrator-One", quote: '\"The spell held.\"' }], brainPatch: field === "thought" ? { thoughts: { memory_narrator_one_1: "12 \u2192 I suspect a secret." } } : { [field]: "I suspect a secret." } }]);
  });
  it.each([["plotEssentials", "P1", "premise"], ["activePressure", "P2", "pressure"], ["currentArc", "P3", "arc"]])("constructs %s content", (kind, target, id) => {
    expect(complete(memoryCommand(`S1 ${kind} ${target}`)).sources[0].findings[0]).toEqual({ kind, targetId: id, title: "The spell", content: "The spell held.", reason: "Extracted from narrator source Narrator-One.", candidateOnly: true, evidenceQuotes: [{ messageId: "Narrator-One", quote: '\"The spell held.\"' }] });
  });
  it("retains two independent memories and source-scoped evidence", () => {
    const r = complete([memoryCommand(), memoryCommand("S1 storyCard NEW", "", "A separate fact."), memoryCommand("S2 storyCard NEW"), memoryCommand("S3 storyCard NEW")].join("\n"));
    expect(r.sources.map(s => s.findings.length)).toEqual([2, 1, 1]);
    expect(r.sources[0].findingIndexes).toEqual([0, 1]);
    expect(r.sources.map(s => s.findings[0].evidenceQuotes[0].messageId)).toEqual(["Narrator-One", "two", "three"]);
    expect(r.sources.every(s => !s.failureReason)).toBe(true);
  });
  it("records valid empty DONE evaluations", () => {
    expect(commands("DONE S1\nDONE S2\nDONE S3").sources).toEqual(["Narrator-One", "two", "three"].map(sourceId => ({ sourceId, findings: [], findingIndexes: [], rejected: [], diagnostics: [] })));
  });
  it.each(["TITLE", "MODE", "STATUS"])("recovers omitted %s conservatively", field => {
    const metadata = ["TITLE Research", "MODE historical", "STATUS completed"].filter(l => !l.startsWith(field)).join("\n");
    const f = complete(memoryCommand("S1 storyCard NEW", metadata)).sources[0].findings[0];
    expect(f).toBeDefined(); expect(f.candidateOnly).toBe(true);
    if (field === "TITLE") expect(f.title).toBe("The spell");
    if (field === "MODE") expect(f.memoryMode).toBe("static");
    if (field === "STATUS") expect(f.eventStatus).toBe("unresolved");
  });
  it.each([
    [memoryCommand("S1 storyCard NEW", "", "Fact.", ""), "Missing evidence"],
    [memoryCommand("S1 storyCard NEW", "", "Fact.", "E E99 | fact"), "Invalid evidence alias"],
    [memoryCommand("S1 storyCard C99"), "Invalid target alias"],
    [memoryCommand("S1 storyCard toString"), "Invalid target alias"],
    [memoryCommand("S1 wrong NEW"), "Unknown memory kind"],
    [memoryCommand("S1 brain B1", "FIELD delete"), "Brain FIELD"],
    [memoryCommand("S1 storyCard NEW", "", ""), "Missing usable factual content"],
    [memoryCommand("S1 storyCard NEW", "INVALID data"), "Invalid command syntax"],
    [memoryCommand("S1 storyCard C2", "PROFILE transformation"), "Invalid PROFILE"],
  ])("isolates invalid command: %s", (invalid, reason) => {
    const r = complete(memoryCommand() + "\n" + invalid + "\n" + memoryCommand()).sources[0];
    expect(r.findings).toHaveLength(2); expect(r.findingIndexes).toEqual([0, 2]); expect(r.rejected).toEqual([{ index: 1, reason: expect.stringContaining(reason) }]); expect(r.failureReason).toBeUndefined();
  });
  it("rejects unknown sources without guessing attribution", () => {
    const r = complete(memoryCommand("S99 storyCard NEW"));
    expect(r.sources.every(s => !s.findings.length && !s.failureReason)).toBe(true);
    expect(r.sources[0].diagnostics).toContainEqual({ index: -1, reason: expect.stringContaining("Unknown source") });
  });
  it("preserves completed siblings before truncation and requires DONE", () => {
    const r = commands(memoryCommand() + "\nMEM S1 storyCard NEW\nE E2 | fact\nTEXT\ncut").sources[0];
    expect(r.findings).toHaveLength(1); expect(r.findingIndexes).toEqual([0]); expect(r.rejected).toEqual([{ index: 1, reason: expect.stringContaining("missing END") }]); expect(r.failureReason).toContain("Missing DONE");
    expect(commands(memoryCommand()).sources[0].failureReason).toContain("Missing DONE");
  });
  it("rejects duplicate DONE and commands after DONE", () => {
    expect(complete("DONE S1").sources[0].failureReason).toContain("Duplicate DONE");
    const r = commands("DONE S1\n" + memoryCommand()).sources[0];
    expect(r.findings).toEqual([]); expect(r.rejected[0]).toEqual({ index: 0, reason: "Command after DONE." });
  });
  it("preserves multiline content, pipes, quotes, braces, colons and evidence after the first pipe", () => {
    const content = 'Fact: {"text": "a | b"}\n  Second line.\nMEM is literal prose here.';
    const f = complete(memoryCommand("S1 storyCard NEW", "", content, 'E E2 |  "a | b": {}  \nE E1 | player words')).sources[0].findings[0];
    expect(f.content).toBe(content); expect(f.evidenceQuotes).toEqual([{ messageId: "Narrator-One", quote: '\"a | b\": {}' }, { messageId: "player", quote: "player words" }]);
  });
  it.each([(s: string) => `\`\`\`\n${s}\n\`\`\``, (s: string) => `\`\`\`text\n${s}\n\`\`\``, (s: string) => `<think>reason</think>\n${s}`])("accepts complete wrappers", wrap => {
    expect(commands(wrap(memoryCommand() + "\nDONE S1")).sources[0].findings).toHaveLength(1);
  });
  it("does not parse unfinished thinking", () => {
    const r = commands("<think>\n" + memoryCommand() + "\nDONE S1").sources[0];
    expect(r.findings).toEqual([]); expect(r.failureReason).toContain("Missing DONE");
  });
  it("accepts case-insensitive keywords and manifest aliases", () => {
    expect(complete(memoryCommand().replace("MEM", "mem").replace("TEXT", "text").replace("END", "end")).sources[0].findings).toHaveLength(1);
    expect(complete(memoryCommand("s1 storyCard NEW")).sources[0].findings).toHaveLength(1);
  });
  it("dispatches legacy root sources JSON and never extracts JSON from command content", () => {
    const legacy = JSON.stringify({ sources: [{ sourceId: "Narrator-One", findings: [groundedFinding()] }] });
    expect(parseSinglePassMemoryResponse(legacy, ["Narrator-One"], commandAdventure, commandAliases).sources[0].findings).toEqual([groundedFinding()]);
    const text = memoryCommand("S1 storyCard NEW", "", legacy) + "\nDONE S1";
    expect(parseSinglePassMemoryResponse(text, ["Narrator-One"], commandAdventure, commandAliases).sources[0].findings[0].content).toBe(legacy);
  });
  it("pools aliases without text copies or persisted aliases", async () => {
    const { a, ids } = singlePassFixture(); const before = JSON.stringify(a);
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    expect(JSON.stringify(a)).toBe(before);
    expect(Object.values(batch.outputAliases).map(s => s.sourceId)).toEqual(ids);
    const payload = JSON.parse(buildSinglePassMemoryMessages(batch)[1].content);
    expect(payload.outputAliases).toEqual(batch.outputAliases);
    for (const [i, source] of Object.values(batch.outputAliases).entries()) {
      expect(Object.values(source.evidence).every(e => ids.slice(i + 1).every(id => id !== e.id))).toBe(true);
      for (const e of Object.values(source.evidence)) expect(payload.references[e.reference].id).toBe(e.id);
    }
    const policy = buildSinglePassMemoryMessages(batch)[0].content;
    expect(policy).toContain("Do not write JSON."); expect(policy).not.toContain("return identityChange:");
  });
});

it("parsing and validation make zero provider requests", async () => {
  const { validateSinglePassSource } = await import("./singlePassMemoryValidation");
  const { a, ids } = singlePassFixture(1); const batch = await prepareSinglePassMemoryBatch(a, ids);
  const send = vi.spyOn(transport, "sendMemoryCompletion");
  const e = Object.entries(batch.outputAliases.S1.evidence).find(([, v]) => v.id === ids[0])![0];
  const result = parseSinglePassMemoryCommands(memoryCommand("S1 storyCard NEW", "", confirmationQuote, `E ${e} | ${confirmationQuote}`) + "\nDONE S1", batch.outputAliases, a);
  expect(validateSinglePassSource(a, result.sources[0], batch.checkpoints[0].checkpoint).proposals).toHaveLength(1);
  expect(send).not.toHaveBeenCalled();
});
it("rejects malformed MEM headers at an identifiable source/index", () => {
  const r = complete(memoryCommand() + "\nMEM S1 storyCard\nTEXT\nFact.\nEND\n" + memoryCommand()).sources[0];
  expect(r.findingIndexes).toEqual([0, 2]); expect(r.rejected[0]).toMatchObject({ index: 1, reason: expect.stringContaining("Invalid MEM syntax") });
});
it("generates stable thought ordinals and safely recovers an omitted Brain title", () => {
  const input = memoryCommand() + "\n" + memoryCommand("S1 brain B1", "FIELD thought", "I suspect a secret.");
  const first = complete(input).sources[0].findings[1];
  expect(first.brainPatch).toEqual({ thoughts: { memory_narrator_one_2: "12 \u2192 I suspect a secret." } });
  expect(complete(input).sources[0].findings[1]).toEqual(first);
  expect(first.title).toBe("I suspect a"); expect(first.candidateOnly).toBe(true);
});
it.each(["character", "location", "custom"])("creates exceptional new %s cards only with explicit TYPE", type => {
  expect(complete(memoryCommand("S1 storyCard NEW", `TYPE ${type}`)).sources[0].findings[0].storyCardType).toBe(type);
  expect(complete(memoryCommand("S1 storyCard NEW", "TITLE Draconia")).sources[0].findings[0].storyCardType).toBe("lore");
});
it("does not honor REVIEW no when metadata needs recovery", () => {
  expect(complete(memoryCommand("S1 storyCard NEW", "REVIEW no")).sources[0].findings[0].candidateOnly).toBe(true);
});
it("does not resolve cross-kind Plot aliases or recover malformed PROFILE", () => {
  expect(complete(memoryCommand("S1 activePressure P1")).sources[0].rejected[0].reason).toContain("Invalid target alias");
  expect(complete(memoryCommand("S1 storyCard C2", "PROFILE transformation")).sources[0].rejected[0].reason).toContain("Invalid PROFILE");
});


describe("command header compatibility", () => {
  it.each(["storyCard", "storycard", "STORYCARD", "story card", "StOrY   CaRd", "lore", "LORE"])("normalizes %s for new and existing cards", kind => {
    for (const target of ["NEW", "C1", "c1"]) {
      expect(complete(memoryCommand(`s1   ${kind}   ${target}`)).sources[0].findings[0]).toMatchObject({
        kind: "storyCard", targetId: target === "NEW" ? null : "lore", operation: target === "NEW" ? "create" : "append",
      });
    }
  });
  it.each([["BRAIN", "b1", "brain"], ["PLOTESSENTIALS", "p1", "plotEssentials"], ["ACTIVEPRESSURE", "p2", "activePressure"], ["CURRENTARC", "p3", "currentArc"]])("normalizes %s and manifest target case", (label, target, kind) => {
    expect(complete(memoryCommand(`s1\t${label}\t${target}`, kind === "brain" ? "FIELD thought" : "")).sources[0].findings[0].kind).toBe(kind);
  });
  it("normalizes lowercase DONE source aliases", () => {
    expect(commands("done  s1\nDONE\ts2\nDONE s3").sources.every(s => !s.failureReason)).toBe(true);
  });
  it.each(["S1 unknown NEW", "S1 lore B1", "S1 lore C99", "S1 brain NEW", "S1 brain b99", "S1 plotEssentials P99", "S1 activePressure p1", "S1 story card", "S1 storyCard NEW extra"])("rejects %s while retaining siblings", header => {
    const result = complete(memoryCommand(header) + "\n" + memoryCommand()).sources[0];
    expect(result.rejected).toHaveLength(1);
    expect(result.findings).toHaveLength(1);
    expect(result.diagnostics?.some(d => d.reason.includes("Rejected MEM header:") && d.reason.includes("source=") && d.reason.includes("kind=") && d.reason.includes("target="))).toBe(true);
  });
  it("bounds original header diagnostics and excludes response bodies from persistence", async () => {
    const { a, ids } = singlePassFixture(1);
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    const header = "MEM s1 unknown " + "X".repeat(250);
    const response = header + "\nE E2 | PRIVATE_EVIDENCE_SENTINEL\nTEXT\nPRIVATE_BODY_SENTINEL\nEND\nDONE s1";
    const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: { secret: "PROVIDER_SENTINEL" }, content: response });
    const parsed = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
    expect(send).toHaveBeenCalledTimes(1);
    const detail = parsed.sources[0].diagnostics!.find(d => d.reason.includes("Rejected MEM header:"))!.reason;
    const savedHeader = /header=("(?:[^"\\]|\\.)*"); kind=/.exec(detail)!;
    expect(JSON.parse(savedHeader[1])).toBe(header.slice(0, 160));
    expect(detail).toContain("Unknown memory kind.");
    const claimed = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    const committed = reduce(claimed, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId,
      sources: [{ result: parsed.sources[0], checkpoint: batch.checkpoints[0].checkpoint }] });
    const persisted = JSON.stringify(committed);
    for (const sentinel of ["PRIVATE_EVIDENCE_SENTINEL", "PRIVATE_BODY_SENTINEL", "PROVIDER_SENTINEL"]) expect(persisted).not.toContain(sentinel);
    expect(persisted).toContain("Rejected MEM header:");
  });
  it("does not recover invalid evidence through header normalization", () => {
    const result = complete(memoryCommand("s1 STORY CARD c1", "", "PRIVATE_BODY", "E E99 | PRIVATE_QUOTE")).sources[0];
    expect(result.findings).toHaveLength(0);
    expect(result.rejected[0].reason).toContain("Invalid evidence alias");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BODY");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_QUOTE");
  });
});


describe("source alias evidence recovery", () => {
  it.each(["E E2", "E E2 | paraphrased spell", 'E E2 | The spell ... {}'])("attaches complete original evidence for %s", evidence => {
    const result = complete(memoryCommand("S1 storyCard NEW", "REVIEW no", "The spell held.", evidence)).sources[0];
    expect(result.rejected).toEqual([]);
    expect(result.findings[0].evidenceQuotes).toEqual([{ messageId: "Narrator-One", quote: commandAdventure.messages[0].content }]);
    expect(result.findings[0].candidateOnly).toBe(true);
    expect(result.diagnostics?.some(d => d.reason.includes("review required"))).toBe(true);
  });
  it("keeps exact spans and two original IDs", () => {
    const f = complete(memoryCommand("S1 storyCard NEW", "", "The spell held.", 'E E2 | "The spell held."\nE E1')).sources[0].findings[0];
    expect(f.evidenceQuotes).toEqual([{ messageId: "Narrator-One", quote: '"The spell held."' }, { messageId: "player", quote: "player words" }]);
  });
  it.each(["unknown", "other-source", "empty", "missing"])("rejects %s evidence without inventing IDs", mode => {
    const a = structuredClone(commandAdventure);
    const aliases = structuredClone(commandAliases);
    let evidence = "E E2";
    if (mode === "unknown") evidence = "E E99";
    if (mode === "other-source") { aliases.S2.evidence = { E9: { id: "two", reference: 8 } } as never; evidence = "E E9"; }
    if (mode === "empty") a.messages[0].content = " ";
    if (mode === "missing") a.messages.shift();
    const r = parseSinglePassMemoryCommands(memoryCommand("S1 storyCard NEW", "", "The spell held.", evidence) + "\nDONE S1", aliases, a).sources[0];
    expect(r.findings).toEqual([]); expect(r.rejected).toHaveLength(1);
  });
});

import { qualityFixture } from "../test/memoryQuality";
import { singlePassCharacterCard, singlePassPersonality, singlePassReferenceState } from "./singlePassMemory";
import { makeStoryCard } from "../state/defaults";
it("supplies an explicit pooled personality reference for every matched Brain without duplicating the profile", async () => {
  const { a, ids } = qualityFixture(3);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const manifest = batch.outputAliases.S1;
  for (const b of Object.values(manifest.brains)) {
    const reference = batch.payload.references[b.reference] as { personalityReference: { cardId: string; reference?: number; personality?: string } };
    expect(reference.personalityReference).toBeDefined();
    if (reference.personalityReference.reference !== undefined) expect(batch.payload.references[reference.personalityReference.reference]).toMatchObject({ type: "character" });
    else expect(reference.personalityReference.personality!.length).toBeLessThanOrEqual(500);
  }
  expect(buildSinglePassMemoryMessages(batch)[0].content).toContain("consider EVERY eligible existing Brain");
  expect(buildSinglePassMemoryMessages(batch)[0].content).toContain("One ongoing conversation is one development");
  expect(singlePassPersonality("Biography. ".repeat(200) + "Personality: proud and pragmatic.")).toMatch(/^Personality: proud and pragmatic/);
});
it("uses linked profiles first, unique normalized name/alias fallback, and never ambiguous profiles", () => {
  const { a } = qualityFixture(); const brain = a.brains[2];
  a.storyCards.push(makeStoryCard({ id: "other", type: "character", title: "Other identity", keys: ["  DRACONIA  "], content: "Other." }));
  expect(singlePassCharacterCard(a, brain)?.id).toBe("profile-Draconia");
  brain.linkedStoryCardId = "missing";
  expect(singlePassCharacterCard(a, brain)).toBeUndefined();
  a.storyCards = a.storyCards.filter(c => c.id !== "profile-Draconia");
  expect(singlePassCharacterCard(a, brain)?.id).toBe("other");
});
it("invalidates extraction when a newly supplied linked Character profile changes outside ordinary inventory", async () => {
  const { a, ids } = qualityFixture();
  a.storyCards.find(c => c.id === "profile-Draconia")!.title = "Vesper";
  a.storyCards.find(c => c.id === "profile-Draconia")!.keys = ["vesper"];
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const brain = batch.payload.references[batch.outputAliases.S1.brains.B3.reference] as { personalityReference: { personality?: string; reference?: number } };
  expect(brain.personalityReference).toBeDefined();
  const personality = brain.personalityReference.personality ?? JSON.stringify(batch.payload.references[brain.personalityReference.reference!]);
  expect(personality).toContain("proud");
  a.storyCards.find(c => c.id === "profile-Draconia")!.content = "Personality: open and warm.";
  expect(singlePassReferenceState(a, ids[0])).not.toBe(batch.checkpoints[0].checkpoint.referenceState);
});

it("recognizes incremental private changes while preserving authored Brain conditions", async () => {
  const { a } = qualityFixture();
  const { buildMemoryAssessmentConditions } = await import("../triggers/semanticEngine");
  a.brains[1].updateCondition = "";
  expect(buildMemoryAssessmentConditions(a).brains.find(c => c.id === "brain:brain-George")?.condition).toContain("meaningful new private observation");
  a.brains[1].updateCondition = "Only when George makes a private business decision.";
  expect(buildMemoryAssessmentConditions(a).brains.find(c => c.id === "brain:brain-George")?.condition).toBe(a.brains[1].updateCondition);
});

it("describes local validation and saved approval rules without changing the quality policy", async () => {
  const { a, ids } = singlePassFixture(1);
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const policy = buildSinglePassMemoryMessages(batch)[0].content;
  expect(policy).toContain("All extracted findings undergo local validation. Valid findings follow the user's configured auto-approval rules.");
  expect(policy).toContain("Protected, uncertain, recovered, and explicitly review-required findings remain subject to manual approval. Never invent certainty to bypass review.");
  expect(policy).not.toContain("All extracted candidates await the user's review.");
  expect(policy).toContain("Private interpretation examples");
});

it.each(["title", "reason", "candidateOnly"])("keeps a Brain with recovered %s review-required", field => {
  const raw: Record<string, unknown> = { kind: "brain", targetId: "brain", title: "George", reason: "A private interpretation.",
    candidateOnly: false, brainPatch: { thoughts: { new_thought: "I trust her judgment." } }, evidenceQuotes: [{ messageId: "source", quote: "A warning." }] };
  delete raw[field];
  const diagnostics: string[] = [];
  expect(normalizeSinglePassFinding(raw, "source", { ...createDefaultAdventure(), brains: [makeBrain({ id: "brain", characterName: "George" })] }, diagnostics)?.candidateOnly).toBe(true);
  expect(diagnostics).toContain("Recovered " + field + " locally.");
});

it.each(["yes", "no"])("preserves explicit Brain REVIEW %s when no recovery is necessary", flag => {
  const f = complete(memoryCommand("S1 brain B1", "TITLE George\nREASON Supported private interpretation.\nREVIEW " + flag + "\nFIELD thought", "I trust her judgment.")).sources[0].findings[0];
  expect(f.candidateOnly).toBe(flag === "yes");
});

it("overrides Brain REVIEW no when evidence needs local recovery", () => {
  const r = complete(memoryCommand("S1 brain B1", "TITLE George\nREASON A private interpretation.\nREVIEW no\nFIELD thought", "I trust her judgment.", "E E2 | paraphrased spell")).sources[0];
  expect(r.findings[0].candidateOnly).toBe(true);
  expect(r.diagnostics?.some(d => d.reason.includes("review required"))).toBe(true);
});
