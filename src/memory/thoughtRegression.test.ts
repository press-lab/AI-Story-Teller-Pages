import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runCompactMemoryFallback } from "./compactMemoryFallback";
import { MEMORY_OUTPUT_RESERVE, ONE_PASS_MEMORY_ID, onePassMemoryActions, onePassMemoryInstruction, parseOnePassMemory } from "./onePassMemory";

const names = ["Mira", "Mandy", "Nix", "Margo", "Eliot"];
const story = names.map(name => `${name} reads the verified report.`).join(" ");
const thoughts = names.map(name => ({ kind: "thought", target: name, content: `I need to investigate the report's new lead myself, ${name}.`, evidence: `${name} reads the verified report.`, reason: "A new investigative lead" }));
const wrap = (updates: unknown[]) => `${story}\n<memory_updates>${JSON.stringify({ updates })}</memory_updates>`;
const config = { ...defaultModelConfig, apiKey: "test", baseUrl: "https://example.com/anthropic", model: "test" };

function fixture() {
  const a = structuredClone(createDefaultAdventure("Brain thought regression"));
  a.memoryDetectionSettings.enabled = true;
  a.memoryAutoApprove.brainUpdate = true;
  a.brains = names.map(characterName => makeBrain({ id: characterName, characterName, active: true, thoughts: { before: "I am waiting for news." } }));
  return a;
}
afterEach(() => vi.restoreAllMocks());

describe("ordinary Brain thoughts alongside optional relationships", () => {
  it("keeps the no-relationship memory instruction byte-identical to pre-feature commit 5049262", () => {
    const text = onePassMemoryInstruction([makeBrain({ characterName: "Mira" })], ["world_fact"]);
    // SHA-256 of the same call using the original pre-feature instruction.
    expect(createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex"))
      .toBe("b729bd1b6e393ad8885b5d35f75ae88be63d7cc3e52d8ae568c0f5c67f0a6686");
    expect(MEMORY_OUTPUT_RESERVE).toBe(1400);
    const a = fixture();
    const context = buildContext(a, { currentInput: names.join(" and ") });
    expect(context.sections.flatMap(s => s.items).find(i => i.id === ONE_PASS_MEMORY_ID)?.content).not.toContain("relationshipChange");
    expect(context.messages.map(m => m.content).join("\n")).not.toContain("Eligible relationship targets");
  });

  it("keeps four valid thoughts when the provider returns extra malformed or non-thought candidates", async () => {
    const a = fixture();
    const updates = [{ kind: "relationshipChange", target: "unenrolled" }, {}, { ...thoughts[0], evidence: "invented unsupported evidence" }, ...thoughts];
    const provider = vi.fn(async () => ({ content: wrap(updates) }));
    const parsed = parseOnePassMemory(wrap(updates));
    expect(parsed.error).toBeUndefined();
    const result = await runTurnPipeline({ adventure: a, text: names.join(" and "), assistantMessageId: "source", sendChatCompletion: provider });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.responseContent).toBe(story);
    expect(result.adventure.brains.slice(0, 4).every(b => Object.values(b.thoughts).some(t => t.includes("investigate")))).toBe(true);
    expect(result.adventure.brains[4].thoughts).toEqual(a.brains[4].thoughts);
    expect(result.adventure.activeState.evaluationLog[0].errors.join(" ")).toContain("update limit reached");
    expect(result.adventure.activeState.evaluationLog[0].errors.join(" ")).not.toContain("Invalid memory JSON");
  });

  it("preserves separate Anthropic text blocks and a split memory envelope without another call", async () => {
    const envelope = wrap(thoughts.slice(0, 4));
    const cut = envelope.indexOf("updates\":") + 5;
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: story },
      { type: "text", text: envelope.slice(story.length, cut) },
      { type: "text", text: envelope.slice(cut) },
    ] }), { status: 200 }));
    const result = await runTurnPipeline({ adventure: fixture(), text: names.join(" and "),
      sendChatCompletion: messages => sendOpenAICompatibleChatCompletion({ messages, config }) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.responseContent).toBe(story);
    expect(result.adventure.brains.slice(0, 4).every(b => Object.values(b.thoughts).some(t => t.includes("investigate")))).toBe(true);
    expect(result.adventure.activeState.evaluationLog[0].errors).toEqual([]);
  });

  it("recovers the same valid thoughts from an oversized fallback batch and excludes historical write targets", async () => {
    let a = fixture();
    a.storyCards = [makeStoryCard({ title: "Sealed historical record", content: "A completed event.", type: "lore", memoryMode: "historical" })];
    a = adventureReducer(a, { type: "ADD_MESSAGE", role: "user", content: names.join(" and "), id: "player" });
    a = adventureReducer(a, { type: "ADD_MESSAGE", role: "assistant", content: story, id: "story" });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [
      { type: "text", text: JSON.stringify({ updates: [{}, ...thoughts] }) },
    ], usage: { input_tokens: 250, output_tokens: 130 } }), { status: 200 }));
    const result = await runCompactMemoryFallback(a, config);
    expect(result.valid).toBe(true);
    expect(result.tokenUsage).toMatchObject({ promptTokens: 250, completionTokens: 130 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    const inventory = request.messages.find((m: { content: string }) => m.content.startsWith("Existing lore, location"));
    expect(inventory.content).not.toContain("Sealed historical record");
    const next = result.actions.reduce(adventureReducer, a);
    expect(next.brains.slice(0, 4).every(b => Object.values(b.thoughts).some(t => t.includes("investigate")))).toBe(true);
  });

  it("applies a thought while keeping an enrolled relationship proposal independently pending", () => {
    let a = fixture();
    a.storyCards = [makeStoryCard({ id: "seth", title: "Seth", type: "character", content: "A teammate." })];
    const initial = { bond: "friends", status: "close", dimensions: { trust: "guarded" } };
    a = adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "Mira", focusStoryCardId: "seth", state: initial });
    const r = a.brains[0].relationships[0];
    const text = "Mira watches Seth return her keepsake.";
    const context = buildContext(a, { currentInput: "Mira meets Seth." });
    const next = onePassMemoryActions(a, context, [
      { kind: "relationshipChange", target: "Mira", relationshipId: r.id, focusStoryCardId: "seth", focus: "Seth", revision: 0,
        proposed: { ...initial, dimensions: { trust: "growing" } }, evidence: text, knowledgeEvidence: text, reason: "An observed promise kept" },
      { ...thoughts[0], evidence: text },
    ], text, "source").reduce(adventureReducer, a);
    expect(Object.values(next.brains[0].thoughts).some(t => t.includes("investigate"))).toBe(true);
    expect(next.brains[0].relationships[0].current).toEqual(initial);
    expect(next.activeState.memoryProposals[0]).toMatchObject({ proposedType: "relationshipUpdate", status: "pending" });
    const unrelated = buildContext(a, { currentInput: "Mira waits alone." });
    expect(unrelated.sections.flatMap(s => s.items).find(i => i.id === ONE_PASS_MEMORY_ID)?.content).not.toContain("relationshipChange");
  });
});
