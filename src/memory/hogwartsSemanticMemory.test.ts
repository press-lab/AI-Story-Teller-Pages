import { afterEach, expect, it, vi } from "vitest";
import opening from "./fixtures/hogwarts-opening.json";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard, makeBrain } from "../state/defaults";
import type { Message, StoryClock, StoryCard } from "../types/adventure";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { runCompactMemoryFallback } from "./compactMemoryFallback";
import { memoryRecoveryBatch } from "./memoryRecoveryBatch";
import { suggestionSourceValid } from "./storyCardSuggestions";
const config = { ...defaultModelConfig, apiKey: "test" };
function fixture() {
  const a = createDefaultAdventure("Hogwarts original opening");
  a.storyClock = opening.storyClock as StoryClock;
  a.messages = structuredClone(opening.messages) as Message[];
  a.storyCards = [opening.harryCard, opening.sethCard].map(card => makeStoryCard({ ...(card as StoryCard), type: "character" }));
  a.memoryAutoApprove.storyCard = false;
  a.memoryDetectionSettings = { enabled: true, evaluator: "dedicated", everyNTurns: 5, generateContent: true };
  a.semanticEvaluationSettings.memoryEvaluationApi = "openaiResponses";
  a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://api.openai.com/v1", model: "gpt-6-sol", memoryReasoningControl: "none" };
  return a;
}
function mockUpdates(sourceId: string, updates: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ status: "completed",
    output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ turns: [{ sourceTurnId: sourceId, updates }] }) }] }],
    usage: { input_tokens: 600, output_tokens: 120, total_tokens: 720 } }) } as Response);
}
const harrySource = "message_mvlv82g3_1qjeu8mt";
const playerSource = "msg_mvlv80s1_wshg2dzn";
const priorSource = "message_mvlv5vz4_917rdh4g";
function recognitionUpdate() {
  return { kind: "lore", cardType: "lore", operation: "create", targetId: null,
    target: "1 September 2001 — Seth Did Not Recognize Harry Potter",
    content: "At the Gryffindor opening feast, Seth offered Harry sympathy over his parents' deaths without recognizing him as the Boy Who Lived. Ron was astonished; Harry laughed, introduced himself and said being treated without fame was a nice change. This was their first meeting, not an established friendship.",
    evidence: "Don't worry, it's honestly a nice change.", reason: "A distinctive first impression that can shape later interactions without establishing friendship.",
    sourceMessageIds: [priorSource, playerSource, harrySource], eventDate: "2001-09-01", triggers: ["Seth Press", "Harry Potter"], participants: ["Seth Press", "Harry Potter"] };
}
afterEach(() => vi.restoreAllMocks());
it("routes the actual Harry non-recognition exchange to reviewed Lore, preserving existing Harry identity", async () => {
  const a = fixture();
  const spy = mockUpdates(harrySource, [recognitionUpdate()]);
  const source = a.messages.find(m => m.id === harrySource)!;
  const result = await runCompactMemoryFallback(a, config, [source]);
  expect(result.valid).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
  const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
  expect(body.model).toBe("gpt-6-sol");
  expect(JSON.stringify(body.input)).toContain("story_hu2_12");
  expect(JSON.stringify(body.input)).toContain("21-year-old fourth-year Gryffindor");
  const next = adventureReducer(a, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources!, dependencies: result.sourceSnapshots, actions: result.actions });
  const proposal = next.activeState.memoryProposals.find(p => p.title.includes("Did Not Recognize"))!;
  expect(proposal).toMatchObject({ status: "pending", storyCardType: "lore", sourceTurnId: harrySource, lore: { occurredAt: { date: "2001-09-01" } } });
  expect(proposal.lore?.sourceMessageIds).toEqual(expect.arrayContaining([priorSource, playerSource, harrySource]));
  expect(proposal.content).toContain("not an established friendship");
  expect(next.storyCards).toEqual(a.storyCards);
  expect(suggestionSourceValid(next, proposal)).toBe(true);
  expect(suggestionSourceValid({ ...next, messages: next.messages.map(m => m.id === priorSource ? { ...m, content: "Edited disclosure" } : m) }, proposal)).toBe(false);
  const changed = { ...a, messages: a.messages.map(m => m.id === playerSource ? { ...m, content: "Changed player input" } : m) };
  expect(adventureReducer(changed, { type: "COMPLETE_MEMORY_RECOVERY", sources: result.processedSources!, dependencies: result.sourceSnapshots, actions: result.actions })).toBe(changed);
});
it.each([
  ["message_mvlticbp_e1un3cjq", "Seth's Gryffindor Sorting", "Seth was Sorted into Gryffindor on arrival as a fourth-year transfer.", "GRYFFINDOR!"],
  ["message_mvlu92rm_fxxl1c4j", "Harry Recognizes Rebecca Press", "Harry recognized Rebecca Press's name from the Prophet at the opening feast.", "that name was in the Prophet"],
  ["message_mvluhvfk_stfz13f9", "Hermione's Interest in Executable Arrays", "Hermione expressed interest in Seth's executable runic arrays and called the work advanced.", "that's genuinely advanced work"],
])("accepts a semantic finding without deterministic event nomination: %s", async (id, title, content, evidence) => {
  let a = fixture();
  a = adventureReducer(a, { type: "QUEUE_MEMORY_RECOVERY", messageId: id, turn: 0 });
  mockUpdates(id, [{ ...recognitionUpdate(), target: title, content, evidence, sourceMessageIds: [id], participants: [], eventDate: "2001-09-01" }]);
  const result = await runCompactMemoryFallback(a, config, [a.messages.find(m => m.id === id)!]);
  expect(result.valid).toBe(true);
  const complete = { type: "COMPLETE_MEMORY_RECOVERY" as const, sources: result.processedSources!, dependencies: result.sourceSnapshots, actions: result.actions };
  const next = adventureReducer(a, complete);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ title, content: expect.stringContaining(content), storyCardType: "lore" }));
  expect(adventureReducer(next, complete)).toBe(next);
});
it("does not turn prank conversation into a completed prank or partnership", async () => {
  const a = fixture(), id = "message_mvluzope_nss3yby5";
  mockUpdates(id, []);
  const result = await runCompactMemoryFallback(a, config, [a.messages.find(m => m.id === id)!]);
  expect(result.valid).toBe(true);
  expect(result.actions.filter(action => action.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(0);
});
it("rejects a fabricated source reference without applying any updates", async () => {
  const a = fixture();
  mockUpdates(harrySource, [{ ...recognitionUpdate(), sourceMessageIds: [harrySource, "invented-id"] }]);
  const result = await runCompactMemoryFallback(a, config, [a.messages.at(-1)!]);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("source_attribution_invalid");
  expect(result.actions).toHaveLength(0);
});
it("retains inline Brain behavior, defers Story Cards, and respects manual and per-turn cadence", async () => {
  let a = fixture();
  a.messages = []; a.brains = [makeBrain({ id: "Harry", characterName: "Harry", active: true, autoUpdateCooldownTurns: 0 })];
  a.memoryAutoApprove.brainUpdate = true;
  a.memoryDetectionSettings.everyNTurns = 0;
  const story = "Harry learns the northern door is trapped.";
  const send = vi.fn(async () => ({ content: story + '<memory_updates>' + JSON.stringify({ updates: [{ kind: "thought", target: "Harry", content: "I must avoid the northern door.", evidence: story, reason: "New private knowledge" }] }) + '</memory_updates>' }));
  const result = await runTurnPipeline({ adventure: a, text: "I warn Harry.", sendChatCompletion: send });
  expect(send).toHaveBeenCalledTimes(1);
  expect(Object.values(result.adventure.brains[0].thoughts).join(" ")).toContain("northern door");
  expect(memoryRecoveryBatch(result.adventure)).toHaveLength(0);
  const scheduled = { ...result.adventure, memoryDetectionSettings: { ...a.memoryDetectionSettings, everyNTurns: 1 } };
  expect(memoryRecoveryBatch(scheduled)).toHaveLength(1);
  scheduled.memoryDetectionSettings.everyNTurns = 5;
  expect(memoryRecoveryBatch(scheduled)).toHaveLength(0);
  scheduled.activeState.memoryRecoveryStoryTurn = 5;
  expect(memoryRecoveryBatch(scheduled)).toHaveLength(1);
});
it("does not let a background provider error damage narration or clear pending work", async () => {
  const a = fixture();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const result = await runCompactMemoryFallback(a, config, [a.messages.at(-1)!]);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("provider_request_failed_network");
  expect(a.messages.at(-1)?.memoryRecovery?.status).toBe("pending");
  expect(a.messages.at(-1)?.content).toBe(opening.messages.at(-1)!.content);
});

it("provides the already-documented Rebecca recognition as canon and accepts deliberate zero updates", async () => {
  const a = fixture(), id = "message_mvlu92rm_fxxl1c4j";
  a.storyCards.push(makeStoryCard({ ...(opening.documentedRecognition as StoryCard), type: "lore" }));
  const spy = mockUpdates(id, []);
  const result = await runCompactMemoryFallback(a, config, [a.messages.find(m => m.id === id)!]);
  expect(result.valid).toBe(true);
  const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
  expect(JSON.stringify(body.input)).toContain(opening.documentedRecognition.content);
  expect(result.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
});
