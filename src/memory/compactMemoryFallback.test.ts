import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { MEMORY_PASS_LABEL, MEMORY_PASS_MAX_MESSAGES, memoryPassWindow, runBackgroundMemoryPass } from "./compactMemoryFallback";

vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));

const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { ...defaultModelConfig, baseUrl: "https://example.com/v1", model: "test", apiKey: "test" };

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

describe("background memory pass", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes Story State, cards, thoughts and knowledge in one grounded call", async () => {
    provider.mockResolvedValue({
      content: JSON.stringify({ updates: [
        { kind: "state", target: "Story State", content: "Day/Time: Monday night.\nLocation: Lucian's club with Edythe.\nHas met: Lucian, Edythe.", evidence: "it is Monday night when they reach the club", reason: "Current truth" },
        { kind: "card", target: "Lucian", content: "Lucian identifies the cup as a calling card.", evidence: "Lucian says the cup was a calling card.", reason: "His interpretation matters to the unresolved intruder" },
        { kind: "thought", target: "Edythe", content: "I suspect Lucian is holding back what he knows about the cup.", evidence: "Edythe realizes he knows more than he admits.", reason: "Changed private suspicion" },
        { kind: "knows", target: "Edythe", content: "Knows: Lucian called the cup a calling card.\nDoes not know: who left the cup.", evidence: "Lucian says the cup was a calling card.", reason: "Knowledge boundary" },
      ] }), raw: {}, usage: { promptTokens: 800, completionTokens: 100, totalTokens: 900 },
    });
    const adventure = adventureAfterTurns();
    const result = await runBackgroundMemoryPass(adventure, config);
    expect(result.valid).toBe(true);
    expect(result.tokenUsage).toEqual({ promptTokens: 800, completionTokens: 100 });
    expect(provider).toHaveBeenCalledTimes(1);
    const sent = provider.mock.calls[0][0].messages.map(message => message.content).join("\n");
    expect(sent).toContain("Lucian runs a private club");
    expect(sent).toContain("currently EMPTY");
    // Only related card titles are listed, never the whole inventory.
    expect(sent).not.toContain("Unrelated Card 7");
    const next = result.actions.reduce(adventureReducer, adventure);
    expect(next.components.find(c => c.id === "state")?.content).toContain("Monday night");
    expect(next.storyCards[0].content).toContain("calling card");
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("holding back");
    expect(next.brains[0].knowledge).toContain("Does not know: who left the cup.");
    expect(next.activeState.evaluationLog[0].actionsExecuted).toContain(MEMORY_PASS_LABEL);
  });

  it("keeps the fixed rules ahead of per-turn data so the prefix can be cached", async () => {
    provider.mockResolvedValue({ content: '{"updates":[]}', raw: {} });
    await runBackgroundMemoryPass(adventureAfterTurns(), config);
    const messages = provider.mock.calls[0][0].messages;
    expect(messages[1].content).toContain("[BACKGROUND MEMORY PASS]");
    expect(messages.at(-1)?.content).toContain("RECENT TURNS");
  });

  it("reads a window covering every turn since the previous pass", () => {
    const adventure = adventureAfterTurns();
    expect(memoryPassWindow(adventure).map(m => m.id)).toEqual(["p1", "s1", "p2", "s2"]);
  });

  function adventureWithMessages(count: number, everyNTurns: number, markerIndex?: number) {
    let adventure = createDefaultAdventure("Window");
    adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true, everyNTurns };
    for (let i = 0; i < count; i += 1) {
      adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` });
    }
    if (markerIndex !== undefined) {
      adventure = adventureReducer(adventure, { type: "SET_LAST_MEMORY_CYCLE_TURN", turn: 1, messageId: `m${markerIndex}` });
    }
    return adventure;
  }

  it("reads every message since the previous pass even when N is above 7", () => {
    // N = 10: the previous pass saw m9; 20 new messages follow. The old 16-message cap dropped the oldest.
    const window = memoryPassWindow(adventureWithMessages(30, 10, 9));
    expect(window[0].id).toBe("m8");
    expect(window.at(-1)?.id).toBe("m29");
    expect(window).toHaveLength(22);
  });

  it("falls back to 2N + 2 messages without a marker, with no 16-message cap", () => {
    expect(memoryPassWindow(adventureWithMessages(40, 10))).toHaveLength(22);
  });

  it("caps a catch-up pass after a long pause so one call cannot overflow context", () => {
    expect(memoryPassWindow(adventureWithMessages(200, 3, 1))).toHaveLength(MEMORY_PASS_MAX_MESSAGES);
  });

  it("records the marker the next pass reads from", () => {
    const adventure = adventureWithMessages(4, 3, 3);
    expect(adventure.activeState.lastMemoryPassMessageId).toBe("m3");
  });

  it("reports an invalid response without falling back to the multi-call cycle", async () => {
    provider.mockResolvedValue({ content: "not JSON", raw: {}, usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 } });
    const result = await runBackgroundMemoryPass(adventureAfterTurns(), config);
    expect(result).toEqual({ actions: [], tokenUsage: { promptTokens: 90, completionTokens: 10 }, valid: false, uncoveredMessages: 0, correctionIds: [] });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("returns an empty result when the provider call fails", async () => {
    provider.mockRejectedValue(new Error("response_format unsupported"));
    const result = await runBackgroundMemoryPass(adventureAfterTurns(), config);
    expect(result.valid).toBe(false);
    expect(result.actions).toEqual([]);
  });
});
