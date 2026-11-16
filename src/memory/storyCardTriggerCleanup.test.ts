import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { parseTriggerCleanup, planTriggerCleanup, runTriggerCleanup, triggerCleanupConfig, TRIGGER_CLEANUP_POLICY } from "./storyCardTriggerCleanup";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import type { ProviderConfig } from "../types/adventure";
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
const config: ProviderConfig = { name: "test", baseUrl: "https://example.com", model: "test", temperature: 0.5, maxOutputTokens: 4096, contextWindowTokens: 16000 };
const card = makeStoryCard({ id: "thanks", title: "Thanksgiving 2018", type: "lore", content: "Aunt Marge dropped her stuffing at Thanksgiving dinner.", keys: ["dinner"] });
const answer = (id: string, keys = ["2018 Thanksgiving", "Aunt Marge's stuffing"]) => ({ cardId: id, keys, reason: "Natural occasion and distinctive incident references." });
beforeEach(() => vi.resetAllMocks());
describe("trigger cleanup", () => {
  it("maps by ID, preserves useful spacing, removes title duplicates and fails missing/duplicate results independently", () => {
    const other = makeStoryCard({ id: "other", title: "Other", content: "Another event." });
    const results = parseTriggerCleanup(JSON.stringify([answer("thanks", [card.title, "2018 Thanksgiving", " Aunt Marge's stuffing "]), answer("foreign")]), [card, other]);
    expect(results[0].keys).toEqual(["2018 Thanksgiving", " Aunt Marge's stuffing "]);
    expect(results[1].error).toMatch(/Missing/);
    expect(parseTriggerCleanup(JSON.stringify([answer("thanks"), answer("thanks")]), [card])[0].error).toMatch(/duplicate/);
  });
  it("accepts title-only recall, rejects malformed responses and overly broad keys", () => {
    expect(parseTriggerCleanup(JSON.stringify([answer("thanks", [])]), [card])[0].keys).toEqual([]);
    for (const raw of ["not json", "{}", JSON.stringify([answer("thanks", ["she"])]), JSON.stringify([answer("thanks", Array(9).fill("valid event"))])]) {
      expect(parseTriggerCleanup(raw, [card])[0].error).toBeTruthy();
    }
  });
  it("bounds by input and output budgets and skips oversized/regex cards without truncation", () => {
    const cards = Array.from({ length: 19 }, (_, i) => ({ ...card, id: `card${i}` }));
    const plan = planTriggerCleanup(cards, config);
    expect(plan.batches.map(batch => batch.length)).toEqual([8, 8, 3]);
    expect(planTriggerCleanup(cards, { ...config, maxOutputTokens: 900 }).batches[0]).toHaveLength(2);
    const huge = { ...card, id: "huge", content: "x".repeat(100000) };
    const regex = { ...card, id: "regex", matchType: "regex" as const };
    const bounded = planTriggerCleanup([card, huge, regex], config);
    expect(bounded.batches.flat()).toEqual([card]);
    expect(bounded.skipped.map(result => result.cardId)).toEqual(["huge", "regex"]);
    expect(planTriggerCleanup([card], { ...config, maxOutputTokens: 100 }).batches).toEqual([]);
  });
  it("sends full content and existing keys, makes sequential requests, retains valid siblings and does not retry", async () => {
    const second = { ...card, id: "second" };
    const plan = { batches: [[card, second], [{ ...card, id: "third" }]], skipped: [], estimatedInputTokens: 1 };
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: JSON.stringify([answer("thanks")]) } as never).mockRejectedValueOnce(new Error("failure"));
    const batches: string[][] = [];
    await runTriggerCleanup(plan, config, results => batches.push(results.map(result => result.error ?? result.cardId)));
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(2);
    const request = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0];
    expect(request.messages[1].content).toContain(card.content);
    expect(request.messages[1].content).toContain('"keys":["dinner"]');
    expect(batches[0][0]).toBe("thanks");
    expect(batches[0][1]).toMatch(/Missing/);
    expect(batches[1][0]).toMatch(/request failed/);
  });
  it("finishes the current batch when stopped and prevents subsequent requests", async () => {
    let keepGoing = true;
    vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementationOnce(async () => { keepGoing = false; return { content: JSON.stringify([answer("thanks")]) } as never; });
    const result = vi.fn();
    await runTriggerCleanup({ batches: [[card], [card]], skipped: [], estimatedInputTokens: 1 }, config, result, () => keepGoing);
    expect(result).toHaveBeenCalledOnce();
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledOnce();
  });
  it("uses configured background provider and includes event-aware shared guidance", () => {
    const adventure = createDefaultAdventure();
    adventure.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://background.example.com", model: "reviewer", maxOutputTokens: 2000 };
    expect(triggerCleanupConfig(adventure, config)).toMatchObject({ baseUrl: "https://background.example.com", model: "reviewer", maxOutputTokens: 2000 });
    expect(TRIGGER_CLEANUP_POLICY).toContain("title ALREADY triggers");
    expect(TRIGGER_CLEANUP_POLICY).toContain("Aunt Marge");
  });
});
