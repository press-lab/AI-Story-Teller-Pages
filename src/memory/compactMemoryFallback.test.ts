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
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, brainUpdate: true, storyCard: true };
  adventure.storyCards = [makeStoryCard({ id: "lucian", title: "Lucian", type: "character", content: "Lucian runs a private club.", pinned: true })];
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
        { kind: "pressure", target: "Active Pressure", content: "The intruder's silver-cup mark puts pressure on Seth and Edythe to identify them.", evidence: "Lucian says he knows the intruder's mark: a silver cup.", reason: "The immediate external mystery has changed" },
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
    expect(next.storyCards[0].content).toContain("silver-cup mark");
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("holding back");
    expect(next.components[0].content).toContain("silver-cup mark");
    expect(next.activeState.evaluationLog[0].actionsExecuted).toContain("Compact memory fallback: one API call");
  });

  it("grounds a historical lore proposal in an earlier exchange from the recent scene", async () => {
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
    expect(next.activeState.memoryProposals[0]).toMatchObject({
      title: "The Returning Tower Working",
      storyCardType: "lore",
      memoryMode: "historical",
      requiresReview: true,
      status: "pending",
    });
  });

  it("rejects invalid recovery without a second call", async () => {
    provider.mockResolvedValue({ content: "not JSON", raw: {}, usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 } });
    const result = await runCompactMemoryFallback(adventureWithMissingEnvelope(), config);
    expect(result).toEqual({ actions: [], tokenUsage: { promptTokens: 90, completionTokens: 10 }, valid: false });
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
  expect(prompt).not.toContain("UNRELATED_SCENARIO_RULES");
  expect(prompt).not.toContain("UNRELATED_ISLAND_CANON");
  expect(prompt).toContain("Lucian runs a private club.");
  expect(provider.mock.calls[0][0].config.maxOutputTokens).toBe(config.maxOutputTokens * 5);
  const next = result.actions.reduce(adventureReducer, adventure);
  expect(next.storyCards[0].content).toContain("lifelong protection");
  expect(next.storyCards[0].content).toContain("ancient silver language");
  expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("trust Lucian");
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({
    title: "The First Battle at the Silver Gate", sourceTurnId: "batch-3", memoryMode: "historical", requiresReview: true,
  }));
});

it("retains a batch when the response omits a source, and rejects evidence from another source", async () => {
  provider.mockReset();
  let adventure = adventureWithMissingEnvelope();
  adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "later", role: "assistant", content: "The room falls silent." });
  const batch = adventure.messages.filter(m => m.role === "assistant");
  provider.mockResolvedValueOnce({ content: '{"turns":[{"sourceTurnId":"later","updates":[]}]}', raw: {} });
  expect((await runCompactMemoryFallback(adventure, config, batch)).valid).toBe(false);
  provider.mockResolvedValueOnce({ content: JSON.stringify({ turns: [
    { sourceTurnId: "story", updates: [] },
    { sourceTurnId: "later", updates: [{ kind: "card", target: "Lucian", content: "Lucian knows the secret mark.", evidence: "Lucian says he knows the intruder's mark: a silver cup.", reason: "Durable knowledge" }] },
  ] }), raw: {} });
  const recovered = await runCompactMemoryFallback(adventure, config, batch);
  const next = recovered.actions.reduce(adventureReducer, adventure);
  expect(next.storyCards[0].content).toBe(adventure.storyCards[0].content);
  expect(next.activeState.evaluationLog[0].errors.join(" ")).toContain("evidence is not in this turn");
});
