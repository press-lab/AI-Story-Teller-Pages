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

  it("catches up three missing characters and a thought in the same bounded request", async () => {
    let adventure = adventureWithMissingEnvelope();
    const evidence = [
      "Kikono introduces himself as Frieza's envoy and arranges an inspection.",
      "Brann is the trader who brings his haulage ship to SDN.",
      "Tolo is Brann's companion and operates the ship's lifters.",
    ];
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", role: "user", content: "I greet the visitors." });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", role: "assistant", content: evidence.join(" ") });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", role: "user", content: "I ask Edythe to wait." });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", role: "assistant", content: "Edythe realizes he knows more than he admits." });
    provider.mockResolvedValue({ content: JSON.stringify({ updates: [
      // An invalid entry must not consume one of the discovery slots.
      { kind: "newCard", target: "Invented visitor", content: "An invented visitor.", evidence: "No such visitor was here.", reason: "Unsupported", cardType: "character", category: "character_reveal", triggers: ["visitor"] },
      ...["Kikono", "Brann", "Tolo"].map((target, index) => ({
        kind: "newCard", target, content: evidence[index], evidence: evidence[index],
        reason: "Named participant with an established ongoing role", cardType: "character",
        memoryMode: "static", category: "character_reveal", triggers: [target],
      })),
      { kind: "thought", target: "Edythe", content: "I suspect he is holding something back.", evidence: "Edythe realizes he knows more than he admits.", reason: "Changed suspicion" },
    ] }), raw: {} });
    const result = await runCompactMemoryFallback(adventure, config);
    const next = result.actions.reduce(adventureReducer, adventure);
    expect(next.activeState.memoryProposals.map(proposal => proposal.title).sort()).toEqual(["Brann", "Kikono", "Tolo"]);
    expect(next.activeState.memoryProposals.every(proposal => proposal.status === "pending" && proposal.requiresReview)).toBe(true);
    expect(next.storyCards).toEqual(adventure.storyCards);
    expect(next.brains).toHaveLength(1);
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("holding something back");
    expect(provider).toHaveBeenCalledTimes(1);
    const request = provider.mock.calls[0][0];
    expect(request.config.maxOutputTokens).toBeLessThanOrEqual(1400);
    const prompt = request.messages.map(message => message.content).join("\n");
    expect(prompt).toContain("at most THREE new cards");
    expect(prompt).toContain("independently check the entire recent excerpt");
    expect(next.activeState.evaluationLog[0].errors.join(" ")).toContain("evidence is not in this turn");
    // A repeated scan must not duplicate already pending proposals.
    const repeated = await runCompactMemoryFallback(next, config);
    expect(repeated.actions.reduce(adventureReducer, next).activeState.memoryProposals).toHaveLength(3);
    // Discovery still honors the user's category opt-out.
    const disabled = structuredClone(adventure);
    disabled.systemTriggers.categories.character_reveal = false;
    const disabledResult = await runCompactMemoryFallback(disabled, config);
    expect(disabledResult.actions.reduce(adventureReducer, disabled).activeState.memoryProposals).toHaveLength(0);
  });

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
