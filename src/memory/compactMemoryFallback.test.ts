import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import type { Adventure, AdventureAction, EvaluationLogEntry } from "../types/adventure";
import { memoryPassActions } from "../hooks/useAdventureRuntime";
import {
  MEMORY_PASS_CHUNK_MAX_MESSAGES,
  MEMORY_PASS_LABEL,
  MEMORY_PASS_MAX_MESSAGES,
  MEMORY_REASONING_RESERVE,
  memoryPassConfig,
  memoryPassPlan,
  memoryPassWindow,
  runBackgroundMemoryPass,
} from "./compactMemoryFallback";
import { MEMORY_OUTPUT_RESERVE } from "./onePassMemory";

vi.mock("../providers/openAICompatible", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/openAICompatible")>()),
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));

const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { ...defaultModelConfig, baseUrl: "https://example.com/v1", model: "test", apiKey: "test" };
const reduce = (state: Adventure, actions: AdventureAction[]) => actions.reduce(adventureReducer, state);
const logOf = (actions: AdventureAction[]): EvaluationLogEntry | undefined =>
  actions.find((action): action is Extract<AdventureAction, { type: "LOG_EVALUATION_RESULT" }> => action.type === "LOG_EVALUATION_RESULT")?.entry;
const reply = (content: string, finishReason = "stop", usage = { promptTokens: 800, completionTokens: 100, totalTokens: 900 }) =>
  ({ content, raw: {}, usage, finishReason });

function adventureAfterTurns() {
  let adventure = createDefaultAdventure("Background memory");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true, everyNTurns: 3 };
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, brainUpdate: true, storyCard: true, storyStateUpdate: true };
  adventure.storyCards = [
    makeStoryCard({ id: "lucian", title: "Lucian", type: "character", content: "Lucian runs a private club.", pinned: true }),
    ...Array.from({ length: 40 }, (_, i) => makeStoryCard({ id: `noise-${i}`, title: `Unrelated Card ${i}`, content: "noise", keys: [`noise ${i}`] })),
  ];
  adventure.brains = [makeBrain({ id: "edythe", characterName: "Edythe", active: true, thoughts: { old: "I distrust Lucian." } })];
  adventure.components = [
    makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "The hangar intruder is unidentified." }),
    makeComponent({ id: "state", title: "Story State", type: "storyState", content: "", alwaysOn: true, protected: true, inclusionPolicy: "always", autoUpdate: true }),
  ];
  adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "p1", role: "user", content: "I ask Edythe whether we should visit Lucian tonight." });
  adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "s1", role: "assistant", content: "Edythe agrees, and it is Monday night when they reach the club." });
  adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "p2", role: "user", content: "I ask Lucian what he knows about the cup." });
  return adventureReducer(adventure, { type: "ADD_MESSAGE", id: "s2", role: "assistant", content: "Lucian says the cup was a calling card. Edythe realizes he knows more than he admits." });
}

function adventureWithMessages(count: number, everyNTurns: number, markerIndex?: number) {
  let adventure = createDefaultAdventure("Window");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true, everyNTurns };
  for (let i = 0; i < count; i += 1) {
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i} where the lantern flickers` });
  }
  if (markerIndex !== undefined) {
    adventure = adventureReducer(adventure, { type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 1, messageId: `m${markerIndex}` });
  }
  return adventure;
}

const STATE_UPDATE = { kind: "state", target: "Story State", content: "Day/Time: Monday night.\nLocation: Lucian's club with Edythe.\nHas met: Lucian, Edythe.", evidence: "it is Monday night when they reach the club", claim: "fact" };
const CARD_UPDATE = { kind: "card", target: "Lucian", content: "Lucian identifies the cup as a calling card.", evidence: "Lucian says the cup was a calling card.", claim: "fact" };

describe("background memory pass", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes Story State, cards, thoughts and knowledge in one grounded call", async () => {
    provider.mockResolvedValue(reply(JSON.stringify({ updates: [
      STATE_UPDATE,
      CARD_UPDATE,
      { kind: "thought", target: "Edythe", content: "I suspect Lucian is holding back what he knows about the cup.", evidence: "Edythe realizes he knows more than he admits.", reason: "Changed private suspicion" },
      { kind: "knows", target: "Edythe", content: "Knows: Lucian called the cup a calling card.\nDoes not know: who left the cup.", evidence: "Lucian says the cup was a calling card.", reason: "Knowledge boundary" },
    ] })));
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result).toMatchObject({ status: "ok", valid: true, processedThroughMessageId: "s2", remainingMessages: 0 });
    expect(result.tokenUsage).toEqual({ promptTokens: 800, completionTokens: 100 });
    expect(provider).toHaveBeenCalledTimes(1);
    const sent = provider.mock.calls[0][0].messages.map(message => message.content).join("\n");
    expect(sent).toContain("Lucian runs a private club");
    expect(sent).toContain("currently EMPTY");
    // Only related card titles are listed, never the whole inventory.
    expect(sent).not.toContain("Unrelated Card 7");
    const next = reduce(adventure, result.actions);
    expect(next.components.find(c => c.id === "state")?.content).toContain("Monday night");
    expect(next.storyCards[0].content).toContain("calling card");
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("holding back");
    expect(next.brains[0].knowledge).toContain("Does not know: who left the cup.");
    expect(next.activeState.evaluationLog[0].actionsExecuted).toContain(MEMORY_PASS_LABEL);
  });

  it("logs route, budget, finish reason, turn range, and parse result on every pass", async () => {
    provider.mockResolvedValue(reply(JSON.stringify({ updates: [CARD_UPDATE] })));
    const result = await runBackgroundMemoryPass(adventureAfterTurns(), config);
    const diagnostics = logOf(result.actions)?.diagnostics?.join("\n") ?? "";
    expect(diagnostics).toContain("Route: example.com · test");
    expect(diagnostics).toContain("response_format json_object");
    expect(diagnostics).toMatch(/Turns: messages 1–4 of 4 \(4 new, 0 context\)/);
    expect(diagnostics).toMatch(/output 100 of max 2000 tokens/);
    expect(diagnostics).toContain("finish reason: stop");
    expect(diagnostics).toContain("Parse: ok; 1 update(s) returned");
    expect(diagnostics).toContain("Applied 1 of 1 update(s)");
    expect(logOf(result.actions)?.rawCapture).toBeUndefined();
  });

  it("captures the raw request and reply only in debug mode", async () => {
    provider.mockResolvedValue(reply('{"updates":[]}'));
    const adventure = adventureAfterTurns();
    adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, debugCapture: true };
    const capture = logOf((await runBackgroundMemoryPass(adventure, config)).actions)?.rawCapture;
    expect(capture?.response).toBe('{"updates":[]}');
    expect(capture?.request).toContain("[BACKGROUND MEMORY PASS]");
  });

  it("treats zero updates as a completed pass that acknowledges its turns", async () => {
    provider.mockResolvedValue(reply('{"updates":[]}'));
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result).toMatchObject({ status: "ok", valid: true, processedThroughMessageId: "s2" });
    const next = reduce(adventure, memoryPassActions(adventure, result));
    expect(next.activeState.lastMemoryPassMessageId).toBe("s2");
    expect(next.activeState.memoryProposals).toHaveLength(0);
  });

  it("keeps the fixed rules ahead of per-turn data so the prefix can be cached", async () => {
    provider.mockResolvedValue(reply('{"updates":[]}'));
    await runBackgroundMemoryPass(adventureAfterTurns(), config);
    const messages = provider.mock.calls[0][0].messages;
    expect(messages[1].content).toContain("[BACKGROUND MEMORY PASS]");
    expect(messages.at(-1)?.content).toContain("NEW TURNS");
  });

  it("tells the model that zero updates is normal and forbids restating unchanged memory", async () => {
    provider.mockResolvedValue(reply('{"updates":[]}'));
    await runBackgroundMemoryPass(adventureAfterTurns(), config);
    const rules = provider.mock.calls[0][0].messages[1].content;
    expect(rules).toContain('{"updates":[]} is a normal, correct answer');
    expect(rules).toContain("Do not restate unchanged facts");
    expect(rules).toMatch(/under about 300 words/);
    expect(rules).not.toMatch(/Each update has: kind, target, content, evidence, reason, claim/);
  });

  it("reports malformed JSON as a logged failure that leaves the marker in place", async () => {
    provider.mockResolvedValue(reply("not JSON", "stop", { promptTokens: 90, completionTokens: 10, totalTokens: 100 }));
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result).toMatchObject({ status: "invalid", valid: false, tokenUsage: { promptTokens: 90, completionTokens: 10 } });
    expect(result.processedThroughMessageId).toBeUndefined();
    expect(logOf(result.actions)?.errors[0]).toMatch(/no usable JSON \(the reply contained no JSON object\)/);
    expect(provider).toHaveBeenCalledTimes(1);
    const next = reduce(adventure, memoryPassActions(adventure, result));
    expect(next.activeState.lastMemoryPassMessageId).toBeUndefined();
    expect(next.activeState.memoryPassFailures).toBe(1);
  });

  it("applies complete updates from a truncated reply, but does not acknowledge the turns", async () => {
    const full = JSON.stringify({ updates: [CARD_UPDATE, STATE_UPDATE] });
    provider.mockResolvedValue({ ...reply(full.slice(0, full.indexOf("Monday night.") + 5), "length", { promptTokens: 900, completionTokens: 2000, totalTokens: 2900 }), reasoningTokens: 1700 });
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result).toMatchObject({ status: "partial", valid: false });
    expect(result.failure).toMatch(/hit the 2000-token ceiling and was cut off after 1700 reasoning tokens/);
    const log = logOf(result.actions)!;
    expect(log.errors.join("\n")).toMatch(/reply was incomplete/);
    expect(log.diagnostics?.join("\n")).toMatch(/\(1700 reasoning\).*finish reason: length \(truncated\)/);
    const next = reduce(adventure, memoryPassActions(adventure, result));
    expect(next.storyCards[0].content).toContain("calling card");
    expect(next.activeState.lastMemoryPassMessageId).toBeUndefined();
    expect(next.activeState.memoryPassFailures).toBe(1);
  });

  it("reports a truncated reply with nothing complete as invalid, naming the ceiling", async () => {
    provider.mockResolvedValue(reply('{"updates":[{"kind":"state","target":"Story State","content":"Day/Time: Mon', "length"));
    const result = await runBackgroundMemoryPass(adventureAfterTurns(), config);
    expect(result.status).toBe("invalid");
    expect(logOf(result.actions)?.errors[0]).toMatch(/hit the 2000-token ceiling and was cut off/);
  });

  it("names the missing field and still applies the valid updates beside it", async () => {
    provider.mockResolvedValue(reply(JSON.stringify({ updates: [
      { type: "card", target: "Lucian", content: "Lucian owns the building.", evidence: ["Lucian says the cup was a calling card."] },
      CARD_UPDATE,
    ] })));
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result).toMatchObject({ status: "ok", valid: true });
    const log = logOf(result.actions)!;
    expect(log.errors[0]).toBe("Memory pass skipped: missing fields (kind, evidence is an array; got keys: type, target, content, evidence)");
    expect(log.diagnostics?.join("\n")).toContain("Applied 1 of 2 update(s)");
    expect(reduce(adventure, result.actions).storyCards[0].content).toContain("calling card");
  });

  it("reads a reply wrapped in reasoning, prose, and fences (OpenRouter-style)", async () => {
    provider.mockResolvedValue(reply(`<think>One card changed.</think>Sure! Here are the updates:\n\`\`\`json\n${JSON.stringify({ updates: [CARD_UPDATE] })}\n\`\`\``));
    const result = await runBackgroundMemoryPass(adventureAfterTurns(), config);
    expect(result).toMatchObject({ status: "ok", valid: true });
    expect(logOf(result.actions)?.diagnostics?.join("\n")).toContain("text around the JSON was stripped");
  });

  it("logs a provider failure instead of swallowing it, without shrinking the next chunk", async () => {
    provider.mockRejectedValue(new Error("Provider error 400: response_format unsupported"));
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result).toMatchObject({ status: "transport", valid: false });
    expect(logOf(result.actions)?.errors[0]).toMatch(/request failed: Provider error 400: response_format unsupported/);
    const next = reduce(adventure, memoryPassActions(adventure, result));
    expect(next.activeState.memoryPassFailures ?? 0).toBe(0);
  });
});

describe("structured output by provider capability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests json_object on OpenAI-format routes, including OpenRouter", async () => {
    provider.mockResolvedValue(reply('{"updates":[]}'));
    await runBackgroundMemoryPass(adventureAfterTurns(), { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "some/model" });
    expect(provider.mock.calls[0][0]).toMatchObject({ responseFormat: "json_object", thinking: "disabled" });
  });

  it("sends no response_format to an Anthropic-format endpoint, which has none, and still parses the reply", async () => {
    provider.mockResolvedValue(reply('Updates:\n{"updates":[]}'));
    const result = await runBackgroundMemoryPass(adventureAfterTurns(), { ...config, baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-flash" });
    expect(provider.mock.calls[0][0].responseFormat).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(logOf(result.actions)?.diagnostics?.join("\n")).toContain("prompt only (this endpoint format has no JSON mode)");
  });

  it("gives always-reasoning models a separate reasoning reserve, and keeps the reply budget unchanged", () => {
    expect(memoryPassConfig({ ...config, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3" }).maxOutputTokens).toBe(MEMORY_OUTPUT_RESERVE + MEMORY_REASONING_RESERVE);
    expect(memoryPassConfig({ ...config, baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-flash" }).maxOutputTokens).toBe(MEMORY_OUTPUT_RESERVE);
  });

  it("names an invalid background route in the diagnostics", async () => {
    provider.mockResolvedValue(reply('{"updates":[]}'));
    const adventure = adventureAfterTurns();
    adventure.semanticEvaluationSettings = { ...adventure.semanticEvaluationSettings, backgroundProviderConfig: { baseUrl: "1", model: "" } };
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(logOf(result.actions)?.diagnostics?.[0]).toMatch(/Background provider Base URL is invalid: "1"/);
  });
});

describe("bounded chunks and acknowledgement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the turns since the previous pass", () => {
    expect(memoryPassWindow(adventureAfterTurns()).map(m => m.id)).toEqual(["p1", "s1", "p2", "s2"]);
  });

  it("processes the oldest pending messages first, with two already-processed messages as context", () => {
    const plan = memoryPassPlan(adventureWithMessages(30, 3, 9));
    expect(plan.context.map(m => m.id)).toEqual(["m8", "m9"]);
    expect(plan.chunk.map(m => m.id)).toEqual(["m10", "m11", "m12", "m13", "m14", "m15"]);
    expect(plan.remainingMessages).toBe(14);
  });

  it("never sends more than six turns in one request, whatever N is", () => {
    const plan = memoryPassPlan(adventureWithMessages(30, 10, 9));
    expect(plan.chunk).toHaveLength(MEMORY_PASS_CHUNK_MAX_MESSAGES);
    expect(plan.chunk[0].id).toBe("m10");
  });

  it("falls back to the last 2N + 2 messages without a marker", () => {
    const plan = memoryPassPlan(adventureWithMessages(40, 3));
    expect(plan.chunk[0].id).toBe("m32");
    expect(plan.chunk.length + plan.remainingMessages).toBe(8);
  });

  it("reports pending messages beyond the backlog ceiling as a coverage gap", () => {
    const plan = memoryPassPlan(adventureWithMessages(200, 3, 1));
    expect(plan.fromIndex).toBe(200 - MEMORY_PASS_MAX_MESSAGES);
    expect(plan.uncoveredMessages).toBe(200 - MEMORY_PASS_MAX_MESSAGES - 2);
    expect(plan.chunk.length).toBeLessThanOrEqual(MEMORY_PASS_CHUNK_MAX_MESSAGES);
  });

  it("does not split a player message from its pending story reply", () => {
    const adventure = adventureWithMessages(30, 3, 9);
    adventure.activeState.memoryPassFailures = 1; // limit 3: m10 (user), m11, m12 (user) → ends on m11
    expect(memoryPassPlan(adventure).chunk.map(m => m.id)).toEqual(["m10", "m11"]);
  });

  it("after a failed batch, newer turns never enlarge the retry: it starts at the same place and shrinks", () => {
    let adventure = adventureWithMessages(14, 1, 3);
    const first = memoryPassPlan(adventure);
    expect(first.chunk.map(m => m.id)).toEqual(["m4", "m5", "m6", "m7", "m8", "m9"]);

    adventure = reduce(adventure, [{ type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 5, failed: true }]);
    for (let i = 14; i < 30; i += 1) {
      adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` });
    }
    const retry = memoryPassPlan(adventure);
    expect(retry.chunk[0].id).toBe("m4");
    expect(retry.chunk.length).toBeLessThan(first.chunk.length);

    adventure = reduce(adventure, [{ type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 6, failed: true }, { type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 7, failed: true }, { type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 8, failed: true }]);
    expect(memoryPassPlan(adventure).chunk.length).toBe(2);
  });

  it("a successful retry advances past exactly its chunk, resets the size, and drains the backlog in bounded steps", async () => {
    let adventure = adventureWithMessages(30, 1, 3);
    adventure = reduce(adventure, [{ type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 1, failed: true }]);
    provider.mockResolvedValue(reply('{"updates":[]}'));

    const sizes: number[] = [];
    let guard = 0;
    while (adventure.activeState.lastMemoryPassMessageId !== "m29" && guard++ < 20) {
      const result = await runBackgroundMemoryPass(adventure, config);
      expect(result.valid).toBe(true);
      sizes.push(memoryPassPlan(adventure).chunk.length);
      adventure = reduce(adventure, memoryPassActions(adventure, result));
      expect(adventure.activeState.lastMemoryPassMessageId).toBe(result.processedThroughMessageId);
    }
    expect(sizes[0]).toBe(3 - 1); // halved after the failure, aligned to end on a story message
    expect(Math.max(...sizes)).toBeLessThanOrEqual(6);
    expect(sizes.slice(1).every(size => size <= 6)).toBe(true);
    expect(adventure.activeState.memoryPassFailures).toBe(0);
    expect(adventure.activeState.lastMemoryPassMessageId).toBe("m29");
  });
});
