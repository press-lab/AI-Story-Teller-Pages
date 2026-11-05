import { AUTHORING_SECTIONS, AUTHORING_WORKFLOW_SECTIONS, AUTHORING_STANDARDS, CHATGPT_AUTHORING_INSTRUCTIONS } from "./authoringPolicy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import type { ProviderConfig } from "../types/adventure";
import { runAdventureGen } from "./adventureGen";

vi.mock("../providers/openAICompatible", () => ({
  isNativeDeepSeekProvider: vi.fn((config: ProviderConfig) => config.baseUrl.includes("deepseek.com")),
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));

const config: ProviderConfig = {
  name: "test",
  baseUrl: "https://example.test",
  model: "test-model",
  temperature: 1,
  maxOutputTokens: 1000,
};

describe("runAdventureGen", () => {
  beforeEach(() => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  });
  it("fills missing and blank generated card keys with reusable content phrases", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ raw: {}, content: JSON.stringify({ storyCards: [
      { title: "Mira Vale", type: "character", content: "A scout." },
      { title: "Ward research", type: "lore", keys: [], content: "Aperture gating supports ward design and runic arrays." },
    ] }) });
    const result = await runAdventureGen("Research", config);
    expect(result.storyCards[0].keys).toContain("Mira Vale");
    expect(result.storyCards[1].keys.map(key => key.toLowerCase())).toEqual(expect.arrayContaining(["ward research", "aperture gating", "ward design", "runic arrays"]));
  });

  it("drops generated records with unsupported types or malformed fields", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({
      content: JSON.stringify({
        title: "Validated",
        openingScene: "Begin.",
        components: [
          { title: "Premise", type: "plotEssentials", content: "A valid premise." },
          { title: "Pressure", type: "activePressure", content: "The ward is collapsing." },
          { title: "Momentum", type: "immediateMomentum", content: "The old next beat should be ignored." },
          { title: "Rules", type: "narrationRules", content: "Not allowed from generation." },
          { title: "Bad priority", type: "custom", content: "No.", priority: "high" },
        ],
        storyCards: [
          { title: "Margo", type: "character", memoryMode: "living", content: "Valid.", keys: ["Margo"] },
          { title: "Treaty", type: "lore", memoryMode: "historical", content: "The treaty was signed.", keys: ["treaty"] },
          { title: "Unknown", type: "faction", content: "Invalid type." },
          { title: "Bad keys", type: "lore", content: "Invalid keys.", keys: "ward" },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });

    const result = await runAdventureGen("A premise", config);

    expect(result.components.map((component) => component.title)).toEqual(["Premise"]);
    expect(result.storyCards.map((card) => card.title)).toEqual(["Margo", "Treaty"]);
    expect(result.storyCards.map(card => card.memoryMode)).toEqual(["living", "historical"]);
  });

  it("parses generated setup JSON wrapped in a markdown code fence", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({
      content: [
        "```json {",
        '  "title": "The Unfettered Isle",',
        '  "openingScene": "The white sand is still warm.",',
        '  "components": [],',
        '  "storyCards": []',
        "}",
        "",
        "Trailing note: this setup includes {one private cove}.",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });

    const result = await runAdventureGen("private island premise", config);

    expect(result.title).toBe("The Unfettered Isle");
    expect(result.openingScene).toBe("The white sand is still warm.");
  });

  it("repairs unescaped quotes inside generated prose", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({
      content: [
        "```json",
        "{",
        '  "title": "The Enchanted Getaway",',
        '  "openingScene": "Riley calls the view "exquisite" and leans against the balcony.",',
        '  "components": [],',
        '  "storyCards": []',
        "}",
        "```",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });

    const result = await runAdventureGen("private island premise", config);

    expect(result.title).toBe("The Enchanted Getaway");
    expect(result.openingScene).toBe('Riley calls the view "exquisite" and leans against the balcony.');
  });

  it("uses native DeepSeek structured output controls and memory-specific component guidance", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({
      content: JSON.stringify({ title: "Structured", openingScene: "", components: [], storyCards: [] }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });

    await runAdventureGen("A premise", {
      ...config,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });

    const request = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0];
    expect(request.responseFormat).toBe("json_object");
    expect(request.thinking).toBe("disabled");
    const prompt = request.messages[0].content;
    expect(prompt).toContain(AUTHORING_STANDARDS);
    for (const section of AUTHORING_SECTIONS) expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain(section.text);
    expect(prompt).not.toMatch(/HOW THEY ENGAGE THE PLAYER|Current Arc|Active Pressure|living.*evolving/);
    expect(prompt).toContain('Use "historical" for historical Lore');
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("exactly two operations: CREATE and EDIT");
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("Auditing is part of EDIT");
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("supporting evidence");
    for (const section of AUTHORING_WORKFLOW_SECTIONS) expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain(section.text);
    for (const section of AUTHORING_WORKFLOW_SECTIONS) expect(prompt).not.toContain(section.text);
    expect(CHATGPT_AUTHORING_INSTRUCTIONS).toContain("is an EDIT of the source followed by a CREATE");
    expect(prompt).toContain("Every newly generated Character card must include a useful, recognizable physical description");
    for (const field of ["Rhythm:", "Default move:", "Emotional defense:", "Never sounds like:", "Example lines:"]) expect(prompt).toContain(field);
    expect(prompt).toContain("Three representative lines");
    expect(prompt).toContain("Only the user may authorize a non-durable continuity anchor");
    expect(prompt).toContain("The AI must not create exceptions itself");
    expect(prompt).toContain("Not every character needs family details");
    expect(prompt).toContain("only when the user explicitly supplies or requests it");
    expect(prompt).toContain("Lore cards preserve events");
    expect(request.messages[0].content).not.toContain('"activePressure"');
    expect(request.messages[0].content).not.toContain('"immediateMomentum"');
    expect(request.messages[0].content).toContain('"authorNote"');
    expect(request.messages[0].content).toContain("Do not create cards for current scene position");
  });

  it("passes setup preferences into the generation prompt", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({
      content: JSON.stringify({ title: "Preferences", openingScene: "", components: [], storyCards: [] }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });

    await runAdventureGen("A messy crew romance premise", config, {
      storyShape: "romanceDrama",
      proseMode: "cinematic",
      playerControl: "minorActions",
      adultContent: "explicitAdult",
      boundaries: "No fade to black.",
    });

    const request = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0];
    const userPrompt = request.messages[1].content;
    expect(userPrompt).toContain("Story shape: Romance drama");
    expect(userPrompt).toContain("Prose mode: Cinematic prose");
    expect(userPrompt).toContain("bridge tiny implied motions");
    expect(userPrompt).toContain("explicit opt-in adult layer");
    expect(userPrompt).toContain("Boundaries and limits to respect: No fade to black.");
  });
});
