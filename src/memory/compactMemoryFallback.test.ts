import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runCompactMemoryFallback } from "./compactMemoryFallback";

vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));

const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { ...defaultModelConfig, baseUrl: "https://example.com/v1", model: "test", apiKey: "test" };

function adventureWithMissingEnvelope() {
  let adventure = createDefaultAdventure("Fallback memory");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true };
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, brainUpdate: true, storyCard: false };
  adventure.storyCards = [makeStoryCard({ id: "lucian", title: "Lucian", type: "lore", content: "Lucian runs a private club.", pinned: true })];
  adventure.brains = [makeBrain({ id: "edythe", characterName: "Edythe", active: true, thoughts: { old: "I distrust Lucian." } })];
  adventure.components = [makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "The hangar intruder is unidentified." })];
  adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "player", role: "user", content: "I ask Lucian what he knows about the cup." });
  return adventureReducer(adventure, { type: "ADD_MESSAGE", id: "story", role: "assistant", content: "Lucian says he knows the intruder's mark: a silver cup. Edythe realizes he knows more than he admits." });
}

describe("compact memory fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers durable card and brain changes in one grounded call", async () => {
    provider.mockResolvedValue({
      content: JSON.stringify({ updates: [
        { kind: "card", target: "Lucian", content: "Lucian knows the intruder's silver-cup mark.", evidence: "Lucian says he knows the intruder's mark: a silver cup.", reason: "This knowledge matters to the unresolved intruder" },
        { kind: "thought", target: "Edythe", content: "I suspect Lucian is holding back what he knows about the cup.", evidence: "Edythe realizes he knows more than he admits.", reason: "Changed private suspicion" },
      ] }), raw: {}, usage: { promptTokens: 800, completionTokens: 100, totalTokens: 900 },
    });
    const adventure = adventureWithMissingEnvelope();
    const result = await runCompactMemoryFallback(adventure, config);
    expect(result.valid).toBe(true);
    expect(result.tokenUsage).toEqual({ promptTokens: 800, completionTokens: 100 });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0].messages.map(message => message.content).join("\n")).toContain("Lucian runs a private club");
    expect(provider.mock.calls[0][0].messages.map(message => message.content).join("\n")).not.toContain("Write the requested narrative first");
    const next = result.actions.reduce(adventureReducer, adventure);
    expect(next.storyCards).toEqual(adventure.storyCards);
    expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ content: expect.stringContaining("silver-cup mark"), requiresReview: false }));
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("holding back");
    expect(next.components).toEqual(adventure.components);
    expect(next.activeState.evaluationLog[0].actionsExecuted).toContain("Compact memory fallback: one API call");
  });

  it("rejects a Story Card quote attributed to the wrong completed exchange", async () => {
    let adventure = adventureWithMissingEnvelope();
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "player-2", role: "user", content: "I wait for the mechanism to finish." });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "story-2", role: "assistant", content: "The tower settles safely back onto its foundation." });
    provider.mockResolvedValue({
      content: JSON.stringify({ updates: [{
        kind: "lore",
        target: "The Returning Tower Working",
        content: "An ancient underground working returned the severed tower to its foundation after preserving it in place.",
        evidence: "Lucian says he knows the intruder's mark: a silver cup.",
        reason: "The completed discovery establishes reusable magical history.",
        triggers: ["returning tower", "ancient working"],
        category: "plot_beat",
      }] }),
      raw: {},
    });
    const result = await runCompactMemoryFallback(adventure, config);
    const next = result.actions.reduce(adventureReducer, adventure);
    expect(next.activeState.memoryProposals.some(p => p.title === "The Returning Tower Working")).toBe(false);
    expect(next.activeState.evaluationLog[0].errors.join(" ")).toMatch(/evidence is not in this turn|quote must come from this completed exchange/);
  });

  it("rejects invalid recovery without a second call", async () => {
    provider.mockResolvedValue({ content: "not JSON", raw: {}, usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 } });
    const result = await runCompactMemoryFallback(adventureWithMissingEnvelope(), config);
    expect(result).toMatchObject({ actions: [], tokenUsage: { promptTokens: 90, completionTokens: 10 }, valid: false, error: expect.stringContaining("provider_invalid_json") });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("retains failure when the provider cannot use JSON response mode", async () => {
    provider.mockRejectedValue(new Error("response_format unsupported"));
    const result = await runCompactMemoryFallback(adventureWithMissingEnvelope(), config);
    expect(result.valid).toBe(false);
    expect(result.actions).toEqual([]);
  });
});


it("recovers character, relationship, Brain and historical memories across a batch, with per-turn limits", async () => {
  provider.mockReset();
  let adventure = adventureWithMissingEnvelope();
  adventure.components.push(makeComponent({ type: "aiInstructions", title: "Scenario instructions", content: "UNRELATED_SCENARIO_RULES ".repeat(1000), pinned: true }));
  adventure.storyCards.push(makeStoryCard({ title: "Distant Island", content: "UNRELATED_ISLAND_CANON", pinned: true }));
  const lines = [
    "Lucian knows the silver-cup mark.",
    "Lucian promised to protect Edythe for the rest of his life.",
    "Edythe realizes Lucian kept his promise and trusts him with her secret.",
    "Lucian and Edythe defeated the Glass King at the silver gate in their first battle together.",
    "Lucian can read the ancient language carved into silver.",
  ];
  for (let i = 0; i < lines.length; i++) adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: `batch-${i}`, role: "assistant", content: lines[i] });
  const updates = [
    { kind: "card", target: "Lucian", content: "Lucian knows the silver-cup mark.", evidence: lines[0], reason: "Enduring knowledge" },
    { kind: "card", target: "Lucian", content: "Lucian promised lifelong protection to Edythe.", evidence: lines[1], reason: "Durable relationship obligation" },
    { kind: "thought", target: "Edythe", content: "I trust Lucian with my secret because he kept his promise.", evidence: lines[2], reason: "Changed private trust" },
    { kind: "lore", target: "The First Battle at the Silver Gate", content: lines[3], evidence: lines[3], reason: "Distinct completed shared history", category: "plot_beat", triggers: ["Glass King", "first silver gate battle"] },
    { kind: "card", target: "Lucian", content: "Lucian can read the ancient silver language.", evidence: lines[4], reason: "Enduring ability" },
  ];
  provider.mockResolvedValue({ content: JSON.stringify({ turns: updates.map((update, i) => ({ sourceTurnId: `batch-${i}`, updates: [update] })) }), raw: {} });
  const result = await runCompactMemoryFallback(adventure, config, adventure.messages.slice(-5));
  expect(result.valid).toBe(true);
  expect(provider).toHaveBeenCalledTimes(1);
  const prompt = provider.mock.calls[0][0].messages.map(m => m.content).join("\n");
  expect(prompt).not.toContain("<memory_updates>");
  expect(prompt).not.toContain("envelope is mandatory");
  expect(prompt).not.toContain("UNRELATED_SCENARIO_RULES");
  expect(prompt).not.toContain("UNRELATED_ISLAND_CANON");
  expect(prompt).toContain("Lucian runs a private club.");
  expect(provider.mock.calls[0][0].config.maxOutputTokens).toBe(config.maxOutputTokens * 5);
  const next = result.actions.reduce(adventureReducer, adventure);
  expect(next.storyCards).toEqual(adventure.storyCards);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ content: expect.stringContaining("lifelong protection"), requiresReview: false }));
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ content: expect.stringContaining("ancient silver language"), requiresReview: false }));
  expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("trust Lucian");
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({
    title: "The First Battle at the Silver Gate", sourceTurnId: "batch-3", memoryMode: "historical", requiresReview: false,
  }));
});

it("retains a batch when the response omits a source, and rejects evidence from another source", async () => {
  provider.mockReset();
  let adventure = adventureWithMissingEnvelope();
  adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "later", role: "assistant", content: "The room falls silent." });
  const batch = adventure.messages.filter(m => m.role === "assistant");
  provider.mockResolvedValueOnce({ content: '{"turns":[{"sourceTurnId":"later","updates":[]}]}', raw: {} });
  expect((await runCompactMemoryFallback(adventure, config, batch)).processedSources).toEqual([{ id: "later", content: "The room falls silent." }]);
  provider.mockResolvedValueOnce({ content: JSON.stringify({ turns: [
    { sourceTurnId: "story", updates: [] },
    { sourceTurnId: "later", updates: [{ kind: "card", target: "Lucian", content: "Lucian knows the secret mark.", evidence: "Lucian says he knows the intruder's mark: a silver cup.", reason: "Durable knowledge" }] },
  ] }), raw: {} });
  const recovered = await runCompactMemoryFallback(adventure, config, batch);
  const next = recovered.actions.reduce(adventureReducer, adventure);
  expect(next.storyCards[0].content).toBe(adventure.storyCards[0].content);
  expect(next.activeState.evaluationLog.flatMap(log => log.errors).join(" ")).toContain("evidence is not in this turn");
});


describe("independent recovery source validation", () => {
  beforeEach(() => provider.mockReset());

  it.each([
    [0, "evidence"], [1, "evidence"], [-1, "evidence"], [0, "update"], [0, "attribution"],
  ] as const)("retains rejected sources without poisoning independent results (bad index %s, %s)", async (badIndex, failure) => {
    let adventure = adventureWithMissingEnvelope();
    const lines = [
      "Lucian and Edythe defeated the Glass King at the silver gate in their first battle together.",
      "Lucian and Edythe discovered the ancient silver language beneath the tower.",
      "The room falls silent.",
    ];
    for (let i = 0; i < lines.length; i++) adventure = adventureReducer(adventure, {
      type: "ADD_MESSAGE", id: `independent-${i}`, role: "assistant", content: lines[i],
    });
    const batch = adventure.messages.slice(-3);
    const turns = batch.map((source, i) => ({ sourceTurnId: source.id, updates: i === 2 ? [] : [{
      kind: "lore", target: i === 0 ? "The First Battle at the Silver Gate" : "The Silver Language Discovery",
      content: lines[i], evidence: lines[i], reason: "Distinct completed shared history", category: "plot_beat",
      triggers: [i === 0 ? "Glass King" : "silver language"],
    }] }));
    for (let i = 0; i < turns.length; i++) if (badIndex === -1 || badIndex === i) {
      // A supported candidate in the same rejected source must also be discarded.
      turns[i].updates.push({ kind: "lore", target: "Unsupported history", content: "Harry defeated Voldemort.",
        evidence: "Harry defeated Voldemort.", reason: "Historical event", category: "plot_beat", triggers: ["Voldemort"] });
    }
    if (failure === "update") turns[0].updates.at(-1)!.kind = "unsupported-kind";
    if (failure === "attribution") Object.assign(turns[0].updates.at(-1)!, { sourceMessageIds: [batch[0].id, "foreign"] });
    provider.mockResolvedValue({ content: JSON.stringify({ turns }), raw: {}, finishReason: "stop" });
    const result = await runCompactMemoryFallback(adventure, config, batch);
    expect(result.request).toMatchObject({ transport: "succeeded", parsed: true });
    const accepted = batch.filter((_, i) => badIndex !== -1 && i !== badIndex);
    expect(result.processedSources ?? []).toEqual(accepted.map(({ id, content }) => ({ id, content })));
    expect(result.valid).toBe(accepted.length > 0);
    const next = result.actions.reduce(adventureReducer, adventure);
    expect(next.activeState.memoryProposals).toHaveLength(badIndex === -1 ? 0 : 1);
    if (badIndex !== -1) expect(next.activeState.memoryProposals[0]).toMatchObject({
      sourceTurnId: batch[badIndex === 0 ? 1 : 0].id, status: "pending", proposedType: "storyCard", memoryMode: "historical",
    });
    for (const source of batch.filter(source => !accepted.includes(source))) {
      expect(next.activeState.evaluationLog.some(log => log.actionsExecuted.includes(`Memory source: ${source.id}`) && log.errors.length)).toBe(true);
      expect(next.activeState.memoryDiagnostics?.some(entry => entry.sourceId === source.id && entry.outcome === "validation_rejected")).toBe(true);
    }
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0].retry).toBe(false);
  });

  it.each(["foreign", "duplicate"])("fails closed for %s source IDs", async kind => {
    const adventure = adventureWithMissingEnvelope();
    const source = adventure.messages.at(-1)!;
    const turns = [{ sourceTurnId: source.id, updates: [] }, { sourceTurnId: kind === "foreign" ? "foreign" : source.id, updates: [] }];
    provider.mockResolvedValue({ content: JSON.stringify({ turns }), raw: {} });
    const result = await runCompactMemoryFallback(adventure, config, [source]);
    expect(result.valid).toBe(false);
    expect(result.actions).toEqual([]);
    expect(result.processedSources).toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(1);
  });
});


it.each([0, 1])("isolates malformed source schemas at index %s", async bad => {
  provider.mockReset();
  let a = adventureWithMissingEnvelope();
  a = adventureReducer(a, { type: "ADD_MESSAGE", id: "later", role: "assistant", content: "The room falls silent." });
  const batch = a.messages.filter(message => message.role === "assistant");
  provider.mockResolvedValue({ content: JSON.stringify({ turns: batch.map((source, index) => ({
    sourceTurnId: source.id, updates: index === bad ? [{ kind: "lore" }] : [],
  })) }), raw: {} });
  const result = await runCompactMemoryFallback(a, config, batch);
  expect(result.valid).toBe(true);
  expect(result.processedSources).toEqual(batch.filter((_, index) => index !== bad).map(({ id, content }) => ({ id, content })));
  expect(result.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider.mock.calls[0][0].retry).toBe(false);
});
