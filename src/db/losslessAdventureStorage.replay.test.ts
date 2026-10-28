import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { defaultModelConfig, normalizeAdventure, sanitizeAdventureForPersistence } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { runTurnPipeline } from "../state/turnPipeline";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { subscribeApiCalls } from "../providers/apiCallAccounting";
import { singlePassFixture, groundedFinding } from "../test/singlePassMemory";
import { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch, singlePassReferenceState, parseSinglePassMemoryResponse } from "../memory/singlePassMemory";
import { singlePassSourceError } from "../memory/singlePassMemoryValidation";
import { memoryTargetMatches, memoryTargetSnapshot, singlePassCycleSources } from "../memory/memoryCycleState";
import { placementValidationError } from "../memory/storyCardPlacement";
import { suggestionSourceValid } from "../memory/storyCardSuggestions";
import type { Adventure, AdventureAction, ApiCallRecord, ProviderConfig } from "../types/adventure";
import { decodeAdventureStorage, encodeAdventureStorage } from "./losslessAdventureStorage";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function resetDeterminism() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T01:05:00.000Z"));
  let index = 0;
  vi.spyOn(Math, "random").mockImplementation(() => (++index * 0.61803398875) % 1);
}

function difference(a: unknown, b: unknown, path = "root"): string | undefined {
  if (Object.is(a, b)) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return path;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return path + " (prototype)";
  const left = Object.keys(a), right = Object.keys(b as object);
  if (JSON.stringify(left) !== JSON.stringify(right)) return path + " (keys)";
  for (const key of left) {
    const found = difference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path + "." + key);
    if (found) return found;
  }
}
function equal(actual: unknown, expected: unknown) {
  // Paths only: never print private save contents on failure.
  expect(isDeepStrictEqual(actual, expected), `Values differ at ${difference(actual, expected) ?? "unknown"}`).toBe(true);
}

function comparableBatch(batch: Awaited<ReturnType<typeof prepareSinglePassMemoryBatch>>) {
  // Conditions contain fresh actionFactory closures. Compare their actual wire serialization;
  // reducer/approval outcomes below exercise the behavior, rather than function identity.
  return { ...batch, payload: JSON.stringify(batch.payload) };
}

function decisions(a: Adventure) {
  return a.activeState.memoryProposals.map(p => ({ id: p.id, sourceValid: suggestionSourceValid(a, p), placement: placementValidationError(a, p) }));
}

async function replay(a: Adventure, config: ProviderConfig) {
  resetDeterminism();
  const records: ApiCallRecord[] = [];
  const requests: unknown[] = [];
  const stop = subscribeApiCalls(record => records.push(record));
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const ordinal = requests.length;
    requests.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)), headers: init?.headers });
    if (ordinal > 1) throw new Error("Unexpected extra request in offline replay");
    const content = ordinal === 0 ? "A brass bell rings in the quiet courtyard." : "S1\nNONE";
    return new Response(JSON.stringify({ model: config.model, choices: [{ finish_reason: "stop", message: { content } }],
      content: [{ type: "text", text: content }], stop_reason: "end_turn",
      usage: { prompt_tokens: 321, completion_tokens: 47, total_tokens: 368, input_tokens: 321, output_tokens: 47,
        cost: 0.00123, cache_read_input_tokens: 11, prompt_tokens_details: { cached_tokens: 11 } } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const turn = await runTurnPipeline({ adventure: a, text: "[continue]", mode: "story", recordUserInput: false, providerCue: "[continue]",
      providerConfig: config, sendChatCompletion: messages => sendOpenAICompatibleChatCompletion({ messages, config, purpose: "narration" }) });
    let state = records.reduce((state, record) => reduce(state, { type: "RECORD_API_CALL", record }), turn.adventure);
    const sourceId = state.messages.at(-1)!.id;
    const batch = await prepareSinglePassMemoryBatch(state, [sourceId]);
    state = reduce(state, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    const result = await runSinglePassMemoryBatch(state, config, batch);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].failureReason).toBeUndefined();
    state = reduce(state, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId,
      sources: result.sources.map(result => ({ result, checkpoint: batch.checkpoints.find(c => c.sourceId === result.sourceId)!.checkpoint })) });
    if (result.usage) state = reduce(state, { type: "ACCUMULATE_BACKGROUND_TOKENS", ...result.usage });
    state = records.reduce((state, record) => reduce(state, { type: "RECORD_API_CALL", record }), state);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(records.map(r => [r.purpose, r.status])).toEqual([
      ["narration", "started"], ["narration", "succeeded"], ["memoryEvaluation", "started"], ["memoryEvaluation", "succeeded"],
    ]);
    expect(state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
    expect(records.at(-1)?.usage?.reportedCostUsd).toBe(0.00123);
    return { state, requests, records, batch: comparableBatch(batch), result, providerPayload: turn.providerPayload };
  } finally { stop(); }
}

const configs: ProviderConfig[] = [
  { ...defaultModelConfig, apiKey: "offline-replay-only", sessionId: "offline-replay", memoryReasoningControl: "thinkingDisabled" },
  { ...defaultModelConfig, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash", apiKey: "offline-replay-only",
    sessionId: "offline-replay", memoryReasoningControl: "openRouterDisabled" },
];

it("keeps synthetic approvals, rejections, source/target/control stale checks and parser results identical", async () => {
  const { a, ids } = singlePassFixture();
  const original = sanitizeAdventureForPersistence(a);
  const restored = await decodeAdventureStorage(await encodeAdventureStorage(a));
  equal(restored, original);
  resetDeterminism(); const batch = await prepareSinglePassMemoryBatch(original, ids);
  resetDeterminism(); equal(comparableBatch(await prepareSinglePassMemoryBatch(restored, ids)), comparableBatch(batch));
  const checkpoint = batch.checkpoints.at(-1)!;
  const sourceId = checkpoint.sourceId;
  const claim: AdventureAction = { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints };
  const commit: AdventureAction = { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId,
    sources: [{ checkpoint: checkpoint.checkpoint, result: { sourceId, findings: [groundedFinding()], rejected: [] } }] };
  async function scenario(input: Adventure, edit?: "source" | "target" | "controls" | "undo") {
    resetDeterminism();
    let state = reduce(input, claim);
    if (edit === "source" || edit === "undo") state = reduce(state, { type: "UPDATE_MESSAGE", messageId: sourceId, content: "Edited evidence." });
    if (edit === "undo") state = reduce(state, { type: "UNDO_STORY_EDIT" });
    if (edit === "target") state = reduce(state, { type: "UPDATE_STORY_CARD", storyCardId: state.storyCards[0].id, patch: { content: "Edited destination." } });
    if (edit === "controls") state = reduce(state, { type: "UPDATE_COMPONENT", componentId: state.components[0].id, patch: { content: "Edited author controls." } });
    state = reduce(state, commit);
    const proposal = state.activeState.memoryProposals.at(-1);
    if (!edit) expect(proposal?.status).toBe("pending");
    if (["source", "target", "controls"].includes(edit ?? "")) expect(state.messages.find(m => m.id === sourceId)?.memoryEvaluation?.status).toBe("failed");
    const outcomes: unknown[] = [state];
    if (proposal) for (const type of ["APPROVE_MEMORY_PROPOSAL", "REJECT_MEMORY_PROPOSAL", "IGNORE_MEMORY_PROPOSAL"] as const) {
      outcomes.push(reduce(state, { type, proposalId: proposal.id }));
    }
    return outcomes;
  }
  for (const edit of [undefined, "source", "target", "controls", "undo"] as const) equal(await scenario(restored, edit), await scenario(original, edit));
  for (const content of ["S1\nNONE\nS2\nNONE\nS3\nNONE", "{malformed", "MEM S3 storyCard NEW\nTEXT\nunfinished",
    `S1\nNONE\nS2\nNONE\nS3\n(storyCard.lore: Workshop collaboration agreement = ${groundedFinding().content})`] ) {
    resetDeterminism(); const first = parseSinglePassMemoryResponse(content, ids, original, batch.outputAliases, batch);
    resetDeterminism(); equal(parseSinglePassMemoryResponse(content, ids, restored, batch.outputAliases, batch), first);
    if (content.includes("(storyCard.lore:")) expect(first.sources.some(s => s.findings.length > 0)).toBe(true);
  }
});

it.each(configs)("replays the same requests and accounting after a round trip: $model", async config => {
  const { a } = singlePassFixture();
  const original = sanitizeAdventureForPersistence(a);
  const restored = await decodeAdventureStorage(await encodeAdventureStorage(a));
  equal(await replay(restored, config), await replay(original, config));
});

const fixturePath = process.env.STORY_TELLER_SAVE_FIXTURE;
it.skipIf(!fixturePath)("round-trips and deterministically replays the supplied private save offline", async () => {
  const fetchGuard = vi.fn(() => { throw new Error("No network allowed during storage validation"); });
  vi.stubGlobal("fetch", fetchGuard);
  const raw = readFileSync(fixturePath!, "utf8");
  const parsed = JSON.parse(raw) as Adventure;
  const original = sanitizeAdventureForPersistence(parsed);
  const started = performance.now();
  const envelope = await encodeAdventureStorage(parsed);
  const encoded = performance.now();
  const restored = await decodeAdventureStorage(structuredClone(envelope));
  const decoded = performance.now();
  equal(restored, original);
  expect(JSON.stringify(restored) === JSON.stringify(original), "Serialization or property order changed").toBe(true);
  expect(fetchGuard).not.toHaveBeenCalled();
  let checkedSnapshots = 0;
  for (let i = 0; i < original.messages.length; i++) {
    const reference = original.messages[i].memoryEvaluation?.singlePass?.referenceState;
    if (reference !== undefined) { expect(restored.messages[i].memoryEvaluation?.singlePass?.referenceState === reference).toBe(true); checkedSnapshots++; }
  }
  for (let i = 0; i < original.activeState.memoryProposals.length; i++) {
    const p = original.activeState.memoryProposals[i];
    const q = restored.activeState.memoryProposals[i];
    for (const key of ["evaluationSource", "placementValidation"] as const) {
      if (p[key]?.target) { expect(q[key]?.target?.value === p[key]?.target?.value).toBe(true); checkedSnapshots++; }
    }
  }
  equal(decisions(restored), decisions(original));
  equal(singlePassCycleSources(restored), singlePassCycleSources(original));
  equal(buildContext(restored), buildContext(original));
  resetDeterminism(); const normalizedOriginal = normalizeAdventure(original);
  resetDeterminism(); const normalizedRestored = normalizeAdventure(restored);
  equal(normalizedRestored, normalizedOriginal);
  const source = [...normalizedOriginal.messages].reverse().find(m => m.memoryEvaluation?.pipeline === "singlePass" && m.memoryEvaluation.status === "pending")!;
  expect(source).toBeDefined();
  resetDeterminism(); const batch = await prepareSinglePassMemoryBatch(normalizedOriginal, [source.id]);
  resetDeterminism(); equal(comparableBatch(await prepareSinglePassMemoryBatch(normalizedRestored, [source.id])), comparableBatch(batch));
  expect(singlePassSourceError(normalizedRestored, source.id, batch.checkpoints[0].checkpoint)).toBeUndefined();
  expect(singlePassReferenceState(normalizedRestored, source.id) === batch.checkpoints[0].checkpoint.referenceState).toBe(true);
  const target = memoryTargetSnapshot(normalizedOriginal, "storyCard", normalizedOriginal.storyCards[0].id)!;
  expect(memoryTargetMatches(normalizedRestored, target)).toBe(true);
  const edited = reduce(normalizedRestored, { type: "UPDATE_STORY_CARD", storyCardId: target.id, patch: { content: "Offline stale-target probe." } });
  expect(memoryTargetMatches(edited, target)).toBe(false);
  const fixtureConfigs: ProviderConfig[] = [...configs, { ...normalizedOriginal.modelConfig,
    apiKey: "offline-replay-only", sessionId: "offline-replay", memoryReasoningControl: "thinkingDisabled",
    requestThrottle: { enabled: false, minSecondsBetweenRequests: 0, maxRequestsPerMinute: 0 } }];
  for (const config of fixtureConfigs) equal(await replay(normalizedRestored, config), await replay(normalizedOriginal, config));
  expect(readFileSync(fixturePath!, "utf8") === raw, "Input fixture changed").toBe(true);
  const report = { format: envelope.format, version: envelope.version, enabledInApp: false, offlineOnly: true,
    sourceSha256: createHash("sha256").update(raw).digest("hex"), sourceBytes: Buffer.byteLength(raw),
    encodedPayloadBytes: envelope.data.byteLength, typedDecodedBytes: envelope.decodedBytes,
    encodeMs: encoded - started, decodeMs: decoded - encoded,
    entries: restored.messages.length, storyCards: restored.storyCards.length, brains: restored.brains.length,
    proposals: restored.activeState.memoryProposals.length, checkedSnapshots,
    sourceUnchanged: true, exactRoundTrip: true, exactPropertyOrder: true, sameContext: true, sameProposalDecisions: true, sameNormalization: true,
    replayModels: fixtureConfigs.map(c => c.model), requestsPerReplay: 2, sameRequestBodiesAndAccounting: true,
    note: "Offline Node measurements; not a phone/browser UI performance test. Synthetic tests cover stale controls, approvals and malformed outputs." };
  if (process.env.STORY_TELLER_VALIDATION_REPORT) writeFileSync(process.env.STORY_TELLER_VALIDATION_REPORT, JSON.stringify(report, null, 2));
}, 120_000);
