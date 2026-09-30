import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import type { ProviderConfig } from "../types/adventure";
import { runStoryCardAudit } from "./storyCardAudit";

vi.mock("../providers/openAICompatible", () => ({
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));

import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";

const mockProvider = vi.mocked(sendOpenAICompatibleChatCompletion);

const providerConfig: ProviderConfig = {
  name: "test",
  baseUrl: "https://api.example.com",
  apiKey: "sk-test",
  model: "test-model",
  temperature: 0.4,
  maxOutputTokens: 512,
};

beforeEach(() => {
  mockProvider.mockReset();
});

describe("runStoryCardAudit", () => {
  it("returns deterministic trigger cleanup plus AI mode-aware split suggestions", async () => {
    const adventure = {
      ...createDefaultAdventure("Audit"),
      storyCards: [
        makeStoryCard({
          id: "card-seth",
          title: "Seth Valis",
          type: "character",
          memoryMode: "static",
          content:
            "- Player character and adult Council mage with active warding discipline.\n" +
            "- Appearance: tall, controlled, and dressed in practical magical leathers.\n" +
            "- Never write Seth's dialogue, thoughts, feelings, choices, or consequential actions.\n" +
            "• Seth is currently managing Viktor's notification protocol while Mel handles the Council.",
          keys: ["Seth", "The", "His", "Council mandate"],
        }),
      ],
      messages: [
        { id: "m1", role: "user" as const, content: "Seth reviews the Council mandate and Viktor protocol.", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "m2", role: "assistant" as const, content: "The Council waits while Mel handles the room.", createdAt: "2026-01-01T00:01:00.000Z" },
      ],
    };

    mockProvider.mockResolvedValueOnce({
      content: JSON.stringify([
        {
          action: "edit",
          cardId: "card-seth",
          title: "Seth Valis",
          rationale: "The static profile contains a current protocol-management bullet.",
          suggestedContent:
            "- Player character and adult Council mage with active warding discipline.\n" +
            "- Appearance: tall, controlled, and dressed in practical magical leathers.\n" +
            "- Never write Seth's dialogue, thoughts, feelings, choices, or consequential actions.",
          suggestedKeys: ["Council mage", "active warding"],
          suggestedType: "character",
          suggestedMemoryMode: "static",
        },
        {
          action: "create",
          title: "Seth and Viktor Protocol",
          rationale: "The protocol is an ongoing arrangement rather than a permanent identity fact.",
          suggestedContent: "• Seth is currently managing Viktor's notification protocol while Mel handles the Council.",
          suggestedKeys: ["Viktor protocol", "notification protocol"],
          suggestedType: "plot",
          suggestedMemoryMode: "living",
        },
      ]),
      raw: {},
    });

    const recommendations = await runStoryCardAudit(adventure, providerConfig, 20, { includeAI: true });

    expect(mockProvider).toHaveBeenCalledTimes(1);
    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "edit",
          source: "deterministic",
          cardId: "card-seth",
          editedKeys: "Seth, Council mandate",
        }),
        expect.objectContaining({
          action: "create",
          title: "Seth and Viktor Protocol",
          suggestedType: "plot",
          suggestedMemoryMode: "living",
          editedKeys: "Viktor protocol, notification protocol",
        }),
      ]),
    );
  });

  it("runs deterministic cleanup without calling the provider by default", async () => {
    const adventure = {
      ...createDefaultAdventure("Audit"),
      storyCards: [
        makeStoryCard({
          id: "card-duplicate-lines",
          title: "Duplicate Lines",
          content: "- Seth keeps the red key.\n- Seth keeps the red key.\n- Margo watches the door.",
          keys: ["red key", "red key", "The"],
        }),
      ],
    };

    const recommendations = await runStoryCardAudit(adventure, providerConfig, 20);

    expect(mockProvider).not.toHaveBeenCalled();
    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "det-duplicate-lines-card-duplicate-lines",
          source: "deterministic",
          editedContent: "- Seth keeps the red key.\n- Margo watches the door.",
        }),
        expect.objectContaining({
          id: "det-trigger-keys-card-duplicate-lines",
          editedKeys: "red key",
        }),
      ]),
    );
  });
});
