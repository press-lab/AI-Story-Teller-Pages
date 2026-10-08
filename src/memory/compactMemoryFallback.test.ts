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
        { kind: "card", effects: [], target: "Lucian", content: "Lucian knows the intruder's silver-cup mark.", evidence: "Lucian says he knows the intruder's mark: a silver cup.", reason: "This knowledge matters to the unresolved intruder" },
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

  it("rejects an invalid recovery response so the caller can use the legacy cycle", async () => {
    provider.mockResolvedValue({ content: "not JSON", raw: {}, usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 } });
    const result = await runCompactMemoryFallback(adventureWithMissingEnvelope(), config);
    expect(result).toEqual({ actions: [], tokenUsage: { promptTokens: 90, completionTokens: 10 }, valid: false });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("falls through when the provider cannot use JSON response mode", async () => {
    provider.mockRejectedValue(new Error("response_format unsupported"));
    const result = await runCompactMemoryFallback(adventureWithMissingEnvelope(), config);
    expect(result.valid).toBe(false);
    expect(result.actions).toEqual([]);
  });
});
