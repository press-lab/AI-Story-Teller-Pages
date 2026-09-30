import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeBrain } from "../state/defaults";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runBrainAudit } from "./brainAudit";

vi.mock("../providers/openAICompatible", () => ({
  sendOpenAICompatibleChatCompletion: vi.fn(async () => ({ content: "[]", raw: {} })),
}));

describe("runBrainAudit", () => {
  const mockProvider = vi.mocked(sendOpenAICompatibleChatCompletion);

  beforeEach(() => {
    mockProvider.mockClear();
  });

  it("flags duplicate thoughts and broad aliases", async () => {
    const adventure = {
      ...createDefaultAdventure("Brain Audit"),
      brains: [
        makeBrain({
          id: "brain-margo",
          characterName: "Margo",
          triggers: ["Margo", "she", "ward engineer"],
          thoughts: {
            first_read: "4 -> Seth jokes when he is cornered.",
            second_read: "5 -> Seth jokes when he is cornered.",
          },
        }),
      ],
    };

    const recommendations = await runBrainAudit(adventure, adventure.modelConfig, 20);

    expect(mockProvider).not.toHaveBeenCalled();
    expect(recommendations.some((rec) => rec.id === "det-broad-aliases-brain-margo")).toBe(true);
    const duplicateThoughts = recommendations.find((rec) => rec.id === "det-duplicate-thoughts-brain-margo");
    expect(duplicateThoughts?.editedThoughts).toContain("second_read");
    expect(duplicateThoughts?.editedThoughts).not.toContain("first_read");
  });

  it("sends the selected turn window and matching thought window to the LLM", async () => {
    mockProvider.mockResolvedValueOnce({
      content: "[]",
      raw: {},
    });
    const adventure = {
      ...createDefaultAdventure("Brain Audit"),
      activeState: { ...createDefaultAdventure("Brain Audit").activeState, turn: 10 },
      messages: [
        { id: "u1", role: "user" as const, content: "Turn one input.", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "a1", role: "assistant" as const, content: "Turn one output.", createdAt: "2026-01-01T00:01:00.000Z" },
        { id: "u2", role: "user" as const, content: "Turn two input.", createdAt: "2026-01-01T00:02:00.000Z" },
        { id: "a2", role: "assistant" as const, content: "Turn two output.", createdAt: "2026-01-01T00:03:00.000Z" },
        { id: "u3", role: "user" as const, content: "Turn three input.", createdAt: "2026-01-01T00:04:00.000Z" },
        { id: "a3", role: "assistant" as const, content: "Turn three output.", createdAt: "2026-01-01T00:05:00.000Z" },
      ],
      brains: [
        makeBrain({
          id: "brain-margo",
          characterName: "Margo",
          lastUpdatedTurn: 10,
          thoughts: {
            turn1_read: "1 -> I am still calibrating the ward.",
            turn2_read: "2 -> I saw the prince flinch before he hid it.",
            turn3_bad_perspective: "3 -> You feel cornered by the machine.",
          },
          archivedThoughts: {
            turn0_old: "0 -> I used to trust the old map.",
          },
        }),
      ],
    };

    await runBrainAudit(adventure, adventure.modelConfig, 2, { includeAI: true });

    const prompt = mockProvider.mock.calls.at(-1)?.[0].messages[0].content ?? "";
    expect(prompt).not.toContain("Turn one input.");
    expect(prompt).toContain("Turn two input.");
    expect(prompt).toContain("Turn three output.");
    expect(prompt).toContain("thoughts under review (last 2 current/archived entries)");
    expect(prompt).toContain("turn3_bad_perspective");
    expect(prompt).toContain("turn2_read");
    expect(prompt).not.toContain("turn1_read");
    expect(prompt).toContain("Rewrite or remove thoughts that are in narrator voice, second person, player perspective");
  });
});
