import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryPassActions } from "../hooks/useAdventureRuntime";
import { sendOpenAICompatibleChatCompletion, type SendChatCompletionOptions } from "../providers/openAICompatible";
import { adventureReducer } from "../state/adventureReducer";
import { normalizeAdventure } from "../state/defaults";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { Adventure, AdventureAction } from "../types/adventure";
import { MEMORY_PASS_CHUNK_MAX_MESSAGES, memoryPassConfig, memoryPassPlan, runBackgroundMemoryPass } from "./compactMemoryFallback";
import { MEMORY_OUTPUT_RESERVE } from "./onePassMemory";
import { storyStateLineValue } from "./storyStateLines";

/**
 * Regression replay of the "Seattle Hunger: Restoration" save, whose memory pass failed on 16 straight
 * turns. The save is private story content and is not committed: point AIST_SEATTLE_SAVE at the exported
 * JSON to run this (skipped otherwise).
 *
 * The provider is SCRIPTED, not a live model: each reply is a small, evidence-grounded update copied from
 * the chunk it was sent, and chosen requests are cut off at the token ceiling, the way the save's GLM 5.3
 * route failed. Everything else (the planner, prompt assembly over the save's real canon, parsing,
 * validation, reducer, and acknowledgement) is the production code. Live model behavior is compared
 * by src/live/memoryPass.live.ts.
 */
const SAVE = process.env.AIST_SEATTLE_SAVE;
const available = Boolean(SAVE && existsSync(SAVE));

vi.mock("../providers/openAICompatible", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/openAICompatible")>()),
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const reduce = (state: Adventure, actions: AdventureAction[]) => actions.reduce(adventureReducer, state);

function loadSave(): Adventure {
  return normalizeAdventure(JSON.parse(readFileSync(SAVE!, "utf8"))) as Adventure;
}

/** The newest STORY paragraph in the request's NEW TURNS, and its first full sentence. */
function newestStorySentence(options: SendChatCompletionOptions): string {
  const last = options.messages.at(-1)!.content;
  const turns = last.slice(last.indexOf("NEW TURNS"));
  const story = turns.split("\n\n").filter(block => block.startsWith("STORY: ")).at(-1) ?? "";
  const sentence = story.slice(7).split(/(?<=[.!?])\s+/).find(s => s.split(/\s+/).length >= 6) ?? story.slice(7, 160);
  return sentence.replace(/[<>]/g, "").split(/\s+/).slice(0, 40).join(" ");
}

describe.skipIf(!available)("Seattle Hunger: Restoration memory regression (scripted provider)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts from the failed state the export captured", () => {
    const adventure = loadSave();
    const marker = adventure.messages.findIndex(m => m.id === adventure.activeState.lastMemoryPassMessageId);
    expect(adventure.messages).toHaveLength(32);
    expect(marker).toBe(23);
    // The 16 failed passes never advanced Story State past the opening scene.
    expect(storyStateLineValue(adventure.components.find(c => c.type === "storyState")!.content, "Location")).toMatch(/Cullen house/);
    // The old window re-read every message since the marker and grew with each failed turn; the new
    // plan for this exact state is the oldest bounded chunk.
    const plan = memoryPassPlan(adventure);
    expect(plan.chunk[0].id).toBe(adventure.messages[24].id);
    expect(plan.chunk.length).toBeLessThanOrEqual(MEMORY_PASS_CHUNK_MAX_MESSAGES);
  });

  it("replays all 16 turns: failures retry in smaller chunks, the backlog drains, and Story State advances", async () => {
    const save = loadSave();
    // Replay from the first turn with the save's memory as canon. Settings are the save's own (pass every
    // turn, Story State auto-approved); nothing in its story content is changed.
    let adventure: Adventure = { ...save, messages: save.messages.slice(0, 2), activeState: { ...save.activeState, lastMemoryPassMessageId: undefined, memoryPassFailures: 0, memoryProposals: [], evaluationLog: [] } };
    const requests: Array<{ chunk: number; inputTokens: number; replyTokens: number; status: string; from: number }> = [];
    let call = 0;
    // Requests 3 and 4 are cut off at the ceiling, as on the save's GLM route; the rest reply normally.
    const cutOff = new Set([3, 4]);
    provider.mockImplementation(async (options) => {
      call += 1;
      const evidence = newestStorySentence(options);
      const body = JSON.stringify({ updates: [{ kind: "stateLine", target: "Location", op: "set", content: `Now: ${evidence}`, evidence, claim: "fact" }] });
      const content = cutOff.has(call) ? body.slice(0, 40) : body;
      const promptTokens = options.messages.reduce((sum, m) => sum + approximateTokenCount(m.content), 0);
      const completionTokens = cutOff.has(call) ? options.config.maxOutputTokens : approximateTokenCount(content);
      return { content, raw: {}, finishReason: cutOff.has(call) ? "length" : "stop", usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } };
    });

    // One scheduled run per completed story turn, exactly as the runtime does (up to 3 chunks per run).
    for (let end = 2; end <= save.messages.length; end += 2) {
      adventure = { ...adventure, messages: save.messages.slice(0, end) };
      for (let chunk = 0; chunk < 3; chunk += 1) {
        const plan = memoryPassPlan(adventure);
        const result = await runBackgroundMemoryPass(adventure, { ...save.modelConfig, apiKey: "test" });
        if (result.status === "skipped") break;
        requests.push({ chunk: plan.chunk.length, inputTokens: result.tokenUsage.promptTokens, replyTokens: result.tokenUsage.completionTokens, status: result.status, from: plan.fromIndex });
        adventure = reduce(adventure, memoryPassActions(adventure, result));
        if (!result.valid || result.remainingMessages === 0) break;
      }
    }

    const failed = requests.filter(r => r.status !== "ok");
    expect(failed).toHaveLength(2);
    // A failed chunk is retried from the same message, never larger, however many turns arrived meanwhile.
    const firstFailure = requests.findIndex(r => r.status !== "ok");
    expect(requests[firstFailure + 1].from).toBe(requests[firstFailure].from);
    expect(requests[firstFailure + 1].chunk).toBeLessThanOrEqual(requests[firstFailure].chunk);
    expect(requests[firstFailure + 2].from).toBe(requests[firstFailure].from);
    expect(Math.max(...requests.map(r => r.chunk))).toBeLessThanOrEqual(MEMORY_PASS_CHUNK_MAX_MESSAGES);
    // Every message is acknowledged by the end: no backlog survives the replay, and failures reset.
    expect(adventure.activeState.lastMemoryPassMessageId).toBe(save.messages.at(-1)!.id);
    expect(adventure.activeState.memoryPassFailures).toBe(0);
    expect(memoryPassPlan(adventure).chunk).toHaveLength(0);
    // Story State advanced to the final scene instead of staying at the opening.
    const location = storyStateLineValue(adventure.components.find(c => c.type === "storyState")!.content, "Location") ?? "";
    expect(location).not.toMatch(/Cullen house east of Seattle; the whole family is home/);
    expect(save.messages.at(-1)!.content).toContain(location.replace(/^Now: /, "").split(/\s+/).slice(0, 6).join(" "));
    // Successful replies are far below the reply ceiling; each request's input stays bounded.
    const okReplies = requests.filter(r => r.status === "ok").map(r => r.replyTokens);
    expect(Math.max(...okReplies)).toBeLessThan(MEMORY_OUTPUT_RESERVE / 4);
    const inputs = requests.map(r => r.inputTokens);
    expect(Math.max(...inputs) - Math.min(...inputs)).toBeLessThan(4000);
    console.info(`SEATTLE_REPLAY ${JSON.stringify({ requests: requests.length, failed: failed.length, maxChunk: Math.max(...requests.map(r => r.chunk)), inputTokens: [Math.min(...inputs), Math.max(...inputs)], maxOkReplyTokens: Math.max(...okReplies), finalLocation: location.slice(0, 120) })}`);
  });

  it("gives the save's GLM 5.3 route a reasoning reserve and keeps the DeepSeek route at the reply budget", () => {
    const save = loadSave();
    expect(memoryPassConfig({ ...save.modelConfig, baseUrl: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3" }).maxOutputTokens).toBeGreaterThan(MEMORY_OUTPUT_RESERVE);
    expect(memoryPassConfig(save.modelConfig).maxOutputTokens).toBe(MEMORY_OUTPUT_RESERVE);
  });
});
