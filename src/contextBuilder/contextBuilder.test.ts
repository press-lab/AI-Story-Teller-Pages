import { describe, expect, it } from "vitest";
import type { Adventure, MemoryPriorityMode, TokenBudgetSettings } from "../types/adventure";
import { createDefaultAdventure, defaultNarrationRulesContent, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import { goldenAdventure, makeMemoryProposal } from "../test/goldenAdventure";
import { buildContext, extractInlineThoughts, TURN_CONTEXT_CLOSE, TURN_CONTEXT_OPEN, TURN_CONTEXT_SECTIONS } from "./contextBuilder";

function adventureForContext(): Adventure {
  const always = makeComponent({ title: "Always", content: "Always component", alwaysOn: true, active: true, priority: 100 });
  const pinned = makeComponent({ title: "Pinned", content: "Pinned component", pinned: true, active: true, priority: 90 });
  const story = makeStoryCard({ title: "Keyed Story", content: "Story content", keys: ["lantern"], active: true, priority: 80 });
  const brain = makeBrain({ characterName: "Mira", triggers: ["lantern"], thoughts: { turn1_state: "1 → The lantern means they're close. I keep my voice level." }, active: true, priority: 70 });

  return {
    ...createDefaultAdventure("Context Test"),
    components: [always, pinned],
    storyCards: [story],
    brains: [brain],
    rollingSummary: { content: "Old summary events. Recent summary events.", updatedAt: "2026-01-01T00:00:00.000Z" },
    messages: [
      { id: "old-msg", role: "user", content: "Old message about the road.", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "new-msg", role: "assistant", content: "New message about the lantern.", createdAt: "2026-01-01T00:01:00.000Z" },
    ],
    tokenBudgetSettings: budget({
      maxContextTokens: 10000,
      maxRecentMessages: 8,
      recentMessageWindow: 8,
      sectionBudgets: {},
    }),
  };
}

function itemTitles(adventure: Adventure, sectionId: string): string[] {
  return buildContext(adventure, { currentInput: "lantern" }).sections.find((section) => section.id === sectionId)?.items.map((item) => item.title) ?? [];
}

function budget(overrides: Partial<TokenBudgetSettings>): TokenBudgetSettings {
  return { ...createDefaultAdventure("Budget").tokenBudgetSettings, ...overrides };
}

function expectPreviewMatchesPayload(adventure: Adventure, mode: MemoryPriorityMode) {
  const configured = {
    ...adventure,
    tokenBudgetSettings: budget({
      ...adventure.tokenBudgetSettings,
      memoryPriorityMode: mode,
      allowSystemToPrioritizeMemory: mode !== "userLocked",
    }),
  } satisfies Adventure;
  const result = buildContext(configured, { currentInput: "signal" });
  const payloadText = result.messages.map((message) => message.content).join("\n");
  for (const section of result.sections.filter((entry) => entry.id !== "recentMessages" && entry.content.length > 0)) {
    const target = TURN_CONTEXT_SECTIONS.has(section.id) ? payloadText : result.messages[0].content;
    expect(target).toContain(section.content);
  }
  const includedRecent = [...(result.sections.find((section) => section.id === "recentMessages")?.items ?? [])]
    .reverse()
    .map((item) => item.content);
  const recentPayload = result.messages.slice(1, 1 + includedRecent.length).map((message) => message.content);
  recentPayload.forEach((content, index) => expect(content.endsWith(includedRecent[index])).toBe(true));
}

function expectExactPayloadFromPreview(adventure: Adventure, mode: MemoryPriorityMode) {
  const configured = {
    ...adventure,
    tokenBudgetSettings: budget({
      ...adventure.tokenBudgetSettings,
      memoryPriorityMode: mode,
      allowSystemToPrioritizeMemory: mode !== "userLocked",
    }),
  } satisfies Adventure;
  const result = buildContext(configured, {
    currentInput: "Margo repeats hedge prince to Seth.",
    latestModelOutput: "The Beast howls at the ward.",
  });
  const render = (filter: (id: string) => boolean) => result.sections
    .filter((entry) => entry.id !== "recentMessages" && entry.content.length > 0 && filter(entry.id))
    .sort((a, b) => a.order - b.order)
    .map((entry) => `# ${entry.label}\n${entry.content}`)
    .join("\n\n");
  const expectedSystem = render((id) => !TURN_CONTEXT_SECTIONS.has(id as never));
  const turnText = render((id) => TURN_CONTEXT_SECTIONS.has(id as never));
  const recentItems = [...(result.sections.find((section) => section.id === "recentMessages")?.items ?? [])].reverse();
  const expectedRecent = recentItems.flatMap((item) => {
    if (item.id === "opening-scene") return [{ role: "assistant" as const, content: configured.openingScene }];
    const message = configured.messages.find((entry) => entry.id === item.id);
    return message ? [{ role: message.role, content: message.content }] : [];
  });
  if (turnText) {
    const block = `${TURN_CONTEXT_OPEN}\n${turnText}\n${TURN_CONTEXT_CLOSE}`;
    const last = expectedRecent.at(-1);
    if (last?.role === "user") expectedRecent[expectedRecent.length - 1] = { ...last, content: `${block}\n\n${last.content}` };
    else expectedRecent.push({ role: "user" as const, content: block });
  }

  expect(result.messages[0].role).toBe("system");
  expect(result.messages[0].content).toBe(expectedSystem);
  expect(result.messages.slice(1)).toEqual(expectedRecent);
}

describe("buildContext", () => {
  describe("current-truth, knowledge and cache invariants", () => {
    function storyStateAdventure(content: string): Adventure {
      const base = createDefaultAdventure("Current truth");
      const state = base.components.find((component) => component.type === "storyState")!;
      return {
        ...base,
        components: base.components.map((component) => component.id === state.id ? { ...component, content } : component),
        messages: [{ id: "m1", role: "user", content: "I head upstairs.", createdAt: "2026-01-01T00:00:00.000Z" }],
      };
    }

    it("always includes a filled Story State in the turn context, never in the cached prefix", () => {
      const result = buildContext(storyStateAdventure("Relationships: Seth and Edythe are together.\nArrangements: Seth sleeps in Edythe's room."), { currentInput: "Nothing that triggers anything." });
      expect(result.sections.find((section) => section.id === "storyState")?.items).toHaveLength(1);
      expect(result.messages[0].content).not.toContain("sleeps in Edythe's room");
      expect(result.messages.at(-1)?.content).toContain("sleeps in Edythe's room");
      expect(result.messages.at(-1)?.content.startsWith(TURN_CONTEXT_OPEN)).toBe(true);
      expect(result.messages.at(-1)?.content.endsWith("I head upstairs.")).toBe(true);
    });

    it("omits an empty Story State and protects a filled one from budget cuts", () => {
      expect(buildContext(storyStateAdventure(""), {}).sections.find((section) => section.id === "storyState")?.items).toHaveLength(0);
      const tight = { ...storyStateAdventure("Day/Time: Monday night."), tokenBudgetSettings: budget({ maxContextTokens: 10 }) };
      expect(buildContext(tight, {}).sections.find((section) => section.id === "storyState")?.items).toHaveLength(1);
    });

    it("injects each triggered character's knowledge boundary with their thoughts", () => {
      const brain = makeBrain({ characterName: "Edythe", thoughts: { t1: "1 → I watched the street." }, knowledge: "Knows: Seth's office address.\nDoes not know: whether Marcus drives.", active: true });
      const adventure = { ...createDefaultAdventure("Knowledge"), brains: [brain] } satisfies Adventure;
      const content = buildContext(adventure, { currentInput: "Edythe waits by the car." }).sections.find((section) => section.id === "brains")?.items[0]?.content ?? "";
      expect(content).toContain("I watched the street.");
      expect(content).toContain("Does not know: whether Marcus drives.");
    });

    it("keeps the system prefix and the start of the history byte-identical from one turn to the next", () => {
      const messages = Array.from({ length: 40 }, (_, i) => ({
        id: `m${i}`,
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Turn ${i}: ${"words ".repeat(20)}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      }));
      const card = makeStoryCard({ id: "card-lantern", title: "Lantern", content: "The lantern is cursed.", keys: ["lantern"], active: true });
      const pinned = makeStoryCard({ id: "card-core", title: "Core", content: "Core identity.", pinned: true, active: true });
      const base = {
        ...createDefaultAdventure("Cache"),
        storyCards: [card, pinned],
        messages,
        tokenBudgetSettings: budget({ maxContextTokens: 50000, maxRecentMessages: 80, recentMessageWindow: 12, sectionBudgets: { recentMessages: 800 } }),
      } satisfies Adventure;
      const turnA = buildContext(base, { currentInput: "I light the lantern." });
      const next = {
        ...base,
        messages: [
          ...messages,
          { id: "m40", role: "user" as const, content: "I set it down.", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "m41", role: "assistant" as const, content: "The flame gutters.", createdAt: "2026-01-01T00:00:00.000Z" },
        ],
      };
      const turnB = buildContext(next, { currentInput: "Something unrelated." });
      // The triggered card changed between turns, yet the prefix did not.
      expect(turnA.sections.find((section) => section.id === "storyCards")?.items).toHaveLength(1);
      expect(turnB.sections.find((section) => section.id === "storyCards")?.items).toHaveLength(0);
      expect(turnB.messages[0]).toEqual(turnA.messages[0]);
      expect(turnB.messages[1]).toEqual(turnA.messages[1]);
      expect(turnA.messages[0].content).toContain("Core identity.");
    });

    it("withholds arc direction and injects the continuity check on an out-of-character turn", () => {
      const arc = {
        ...makeComponent({ title: "Current Story Arc", type: "currentArc", content: "The hunter circles.", active: true }),
        arcSimmerInstruction: "Keep the hunter off-screen and simmering.",
        arcState: { phase: "simmer" as const, tier: 0, threadEngagement: {}, pendingBreak: false },
      };
      const adventure = { ...createDefaultAdventure("OOC"), components: [arc] } satisfies Adventure;
      const inCharacter = buildContext(adventure, { currentInput: "I wait." });
      const outOfCharacter = buildContext(adventure, { currentInput: "[Out of Character: complete the arc already]", outOfCharacter: true });
      expect(inCharacter.messages[0].content).toContain("Keep the hunter off-screen");
      expect(outOfCharacter.messages.map((message) => message.content).join("\n")).not.toContain("Keep the hunter off-screen");
      expect(outOfCharacter.messages.at(-1)?.content).toContain("[CONTINUITY CHALLENGE]");
      expect(outOfCharacter.messages[0].content).toContain("OUT-OF-CHARACTER MESSAGES");
    });
  });

  it("uses Narration Rules as a complete system contract without requiring AI Instructions", () => {
    const narrationRules = makeComponent({
      id: "narration-only",
      title: "Narration Rules",
      type: "narrationRules",
      content: "Keep player agency intact and end on action.",
      active: true,
      alwaysOn: true,
      protected: true,
    });
    const adventure = {
      ...createDefaultAdventure("Narration Only"),
      components: [narrationRules],
    } satisfies Adventure;

    const result = buildContext(adventure);

    expect(result.messages[0].content).toContain("Keep player agency intact and end on action.");
    expect(result.sections.find((section) => section.id === "aiInstructions")?.items).toHaveLength(0);
    expect(result.sections.find((section) => section.id === "system")?.items.map((item) => item.id)).toContain("narration-only");
  });

  it("warns models not to import fandom canon when familiar names appear", () => {
    const jinx = makeStoryCard({
      id: "card-jinx",
      title: "Jinx",
      content: "Jinx is a quiet Piltover archivist in this adventure, not a chaos bomber.",
      keys: ["Jinx", "Powder"],
      type: "character",
      priority: 90,
    });
    const adventure = {
      ...createDefaultAdventure("Arcane AU"),
      storyCards: [jinx],
      messages: [{ id: "msg-1", role: "user" as const, content: "I ask Jinx what she found in the archive.", createdAt: "2026-01-01T00:00:00.000Z" }],
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "Jinx waits beside the archive desk." });
    const payload = result.messages.map((message) => message.content).join("\n");

    expect(payload).toContain("Treat this adventure's context as the only canon");
    expect(payload).toContain("Do not import biography, relationships, motives, powers, locations, or events from model training data.");
    expect(payload).toContain("Jinx is a quiet Piltover archivist in this adventure");
    expect(defaultNarrationRulesContent).toContain("the adventure context is the only canon");
    expect(defaultNarrationRulesContent).toContain("treat those missing details as unknown");
    expect(defaultNarrationRulesContent).not.toContain("End each response");
    expect(defaultNarrationRulesContent).not.toContain("the player decides what happens next");
  });

  it("assembles sections in the required deterministic order: stable prefix, history, then turn context", () => {
    const result = buildContext(adventureForContext(), { currentInput: "lantern" });
    // Stable sections form the cached system prefix; per-turn sections follow the history so the
    // prefix stays byte-identical across turns. Author's Note stays closest to the newest turn.
    expect(result.sections.map((section) => section.id)).toEqual([
      "system",
      "aiInstructions",
      "plotEssentials",
      "currentArc",
      "components",
      "pinnedStoryCards",
      "recentMessages",
      "storyState",
      "storyCards",
      "brains",
      "authorNote",
      "nextTurnNote",
      "challengeMode",
    ]);
    expect(result.messages[0].role).toBe("system");
    // adventureForContext uses generic custom-type components (always + pinned), so they land in "components"
    expect(itemTitles(adventureForContext(), "aiInstructions")).toEqual([]);
    expect(itemTitles(adventureForContext(), "plotEssentials")).toEqual([]);
    expect(itemTitles(adventureForContext(), "authorNote")).toEqual([]);
    expect(itemTitles(adventureForContext(), "components")).toEqual(["Always", "Pinned"]);
    expect(itemTitles(adventureForContext(), "storyCards")).toEqual(["Keyed Story"]);
    expect(itemTitles(adventureForContext(), "brains")).toEqual(["Mira"]);
    expect(itemTitles(adventureForContext(), "currentArc")).toEqual([]);
    expect(itemTitles(adventureForContext(), "nextTurnNote")).toEqual([]);
    expect(itemTitles(adventureForContext(), "recentMessages")).toEqual(["assistant message 1", "user message 2"]);
  });

  it("routes aiInstructions, plotEssentials, and authorNote each into their own section before general components", () => {
    const ai = makeComponent({ id: "c-ai", title: "AI", type: "aiInstructions", content: "AI", alwaysOn: true, priority: 50 });
    const plotHigh = makeComponent({ id: "c-plot-high", title: "Plot High", type: "plotEssentials", content: "Plot high", priority: 90 });
    const plotLow = makeComponent({ id: "c-plot-low", title: "Plot Low", type: "plotEssentials", content: "Plot low", priority: 10 });
    const pinned = makeComponent({ id: "c-pinned", title: "Pinned", type: "memory", content: "Pinned", pinned: true, priority: 100 });
    const inactive = makeComponent({ id: "c-inactive", title: "Inactive", type: "memory", content: "Inactive", active: false, priority: 500 });
    const adventure = { ...createDefaultAdventure("Components"), components: [ai, plotLow, pinned, inactive, plotHigh] };

    const result = buildContext(adventure);
    expect(result.sections.find((section) => section.id === "system")?.items.map((item) => item.id)).toEqual([
      "system-shell",
      "turn-scope-contract",
    ]);
    // Each type has its own section
    expect(result.sections.find((section) => section.id === "aiInstructions")?.items.map((item) => item.id)).toEqual(["c-ai"]);
    expect(result.sections.find((section) => section.id === "plotEssentials")?.items.map((item) => item.id)).toEqual(["c-plot-high", "c-plot-low"]);
    expect(result.sections.find((section) => section.id === "authorNote")?.items).toHaveLength(0);
    // Pinned custom component lands in E. Components
    expect(result.sections.find((section) => section.id === "components")?.items.map((item) => item.id)).toEqual(["c-pinned"]);
    expect(result.excludedItems).toContainEqual(expect.objectContaining({ id: "c-inactive", reason: "inactive" }));
  });

  it("does not assemble disabled Immediate Momentum legacy components", () => {
    const plot = makeComponent({ id: "c-plot", title: "Plot", type: "plotEssentials", content: "Plot still loads.", priority: 90 });
    const momentum = makeComponent({
      id: "c-momentum",
      title: "Immediate Momentum",
      type: "immediateMomentum",
      content: "Momentum should not load.",
      active: true,
      priority: 240,
    });
    const adventure = { ...createDefaultAdventure("Legacy Momentum"), components: [plot, momentum] };

    const result = buildContext(adventure);

    expect(result.sections.find((section) => section.id === "plotEssentials")?.items.map((item) => item.id)).toEqual(["c-plot"]);
    expect(result.messages[0].content).not.toContain("Momentum should not load.");
  });

  it("triggers story cards from input, output, recent history, pins, and regex-only match mode", () => {
    const inputCard = makeStoryCard({ id: "card-input", title: "Input", content: "input", keys: ["silver key"], active: true, priority: 50 });
    const outputCard = makeStoryCard({ id: "card-output", title: "Output", content: "output", keys: ["moon bell"], active: true, priority: 40 });
    const historyCard = makeStoryCard({ id: "card-history", title: "History", content: "history", keys: ["old vow"], active: true, priority: 30 });
    const pinnedCard = makeStoryCard({ id: "card-pinned", title: "Pinned", content: "pinned", keys: ["missing"], active: true, pinned: true, priority: 20 });
    const inactiveCard = makeStoryCard({ id: "card-inactive", title: "Inactive", content: "inactive", keys: ["silver key"], active: false });
    const unmatchedCard = makeStoryCard({ id: "card-unmatched", title: "Unmatched", content: "no", keys: ["nope"], active: true });
    const regexCard = makeStoryCard({
      id: "card-regex",
      title: "Regex",
      content: "regex",
      keys: ["chapter\\s+\\d+"],
      matchType: "regex",
      active: true,
      priority: 10,
    });
    const phraseRegexText = makeStoryCard({
      id: "card-phrase-regex",
      title: "Phrase Regex Text",
      content: "phrase",
      keys: ["chapter\\s+\\d+"],
      matchType: "phrase",
      active: true,
    });
    const adventure = {
      ...createDefaultAdventure("Cards"),
      storyCards: [inputCard, outputCard, historyCard, pinnedCard, inactiveCard, unmatchedCard, regexCard, phraseRegexText],
      messages: [{ id: "m1", role: "assistant", content: "They remembered the old vow.", createdAt: "2026-01-01T00:00:00.000Z" }],
      tokenBudgetSettings: budget({ maxContextTokens: 5000, maxRecentMessages: 4, recentMessageWindow: 4, sectionBudgets: {} }),
    } satisfies Adventure;

    const result = buildContext(adventure, {
      currentInput: "I lift the SILVER KEY and read chapter 42.",
      latestModelOutput: "The moon bell rings.",
    });
    const triggeredIds = result.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id);
    expect(triggeredIds).toEqual(["card-input", "card-output", "card-history", "card-regex"]);
    // Pinned cards do not depend on this turn's text, so they live in the cached prefix.
    expect(result.sections.find((section) => section.id === "pinnedStoryCards")?.items.map((item) => item.id)).toEqual(["card-pinned"]);
    expect(result.triggeredThreadIds).toEqual(["card-input", "card-output", "card-history", "card-regex"]);
    expect(result.excludedItems).toContainEqual(expect.objectContaining({ id: "card-inactive", reason: "inactive" }));
    expect(result.excludedItems).toContainEqual(expect.objectContaining({ id: "card-unmatched", reason: "not_triggered" }));
    expect(result.excludedItems).toContainEqual(expect.objectContaining({ id: "card-phrase-regex", reason: "not_triggered" }));
  });

  it("uses the opening scene to trigger cards only on the first turn", () => {
    const card = makeStoryCard({
      id: "card-opening",
      title: "Margo",
      content: "Margo guards the ward.",
      keys: ["Margo"],
      active: true,
    });
    const firstTurn = {
      ...createDefaultAdventure("Opening Triggers"),
      openingScene: "Margo waits beside the failing ward.",
      storyCards: [card],
    } satisfies Adventure;

    const initialContext = buildContext(firstTurn, { currentInput: "I approach her." });
    expect(initialContext.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id)).toContain("card-opening");

    const laterContext = buildContext(
      { ...firstTurn, activeState: { ...firstTurn.activeState, turn: 1 } },
      { currentInput: "I approach her." },
    );
    expect(laterContext.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id)).not.toContain("card-opening");
  });

  it("renders structured compact story-card facts into context", () => {
    const pact = makeStoryCard({
      id: "card-pact",
      title: "Seth's Pact with Jinx",
      content: "",
      compactKind: "pact",
      compactStatus: "active",
      coreFacts: ["Jinx stops killing except in self-protection."],
      currentFacts: ["Mel keeps Seth on the Council under an official cover story."],
      recentDevelopments: ["Jinx is repairing the Sump air filter."],
      pinned: true,
    });
    const adventure = { ...createDefaultAdventure("Compact Context"), storyCards: [pact] };

    const result = buildContext(adventure);
    const content = result.sections.find((section) => section.id === "pinnedStoryCards")?.items[0]?.content ?? "";

    expect(content).toContain("Compact: pact (active)");
    expect(content).toContain("Core facts:");
    expect(content).toContain("Jinx stops killing except in self-protection.");
    expect(content).toContain("Current facts:");
    expect(content).toContain("official cover story");
    expect(content).toContain("Recent developments:");
    expect(content).toContain("Sump air filter");
  });

  it("drops oldest recent messages before cutting other sections", () => {
    const adventure = {
      ...adventureForContext(),
      components: [],
      storyCards: [],

      brains: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      messages: [
        { id: "old", role: "user", content: "old ".repeat(80), createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "middle", role: "assistant", content: "middle ".repeat(80), createdAt: "2026-01-01T00:01:00.000Z" },
        { id: "new", role: "user", content: "new ".repeat(80), createdAt: "2026-01-01T00:02:00.000Z" },
      ],
      // Budget sized to fit system-shell + exactly 1 message (newest), dropping the 2 older ones
      tokenBudgetSettings: budget({ maxContextTokens: 400, maxRecentMessages: 3, recentMessageWindow: 3, sectionBudgets: {} }),
    } satisfies Adventure;

    const result = buildContext(adventure);
    const recentIds = result.sections.find((section) => section.id === "recentMessages")?.items.map((item) => item.id);
    expect(recentIds).toEqual(["new"]);
    expect(result.excludedItems.filter((item) => item.reason === "budget_exceeded").map((item) => item.id)).toEqual(["old", "middle"]);
  });

  it("rolling summary is not injected into context (deprecated)", () => {
    const adventure = {
      ...adventureForContext(),
      rollingSummary: {
        content: "This is old rolling summary content that should not appear.",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    } satisfies Adventure;

    const result = buildContext(adventure);
    // rollingSummary section no longer exists in the sections array
    expect(result.sections.find((s) => s.id === "rollingSummary")).toBeUndefined();
    // Summary content does not appear in the provider payload
    expect(result.messages[0].content).not.toContain("rolling summary content");
  });

  it("drops lowest-priority triggered cards after message and summary cuts", () => {
    const low = makeStoryCard({ title: "Low Priority", content: "low ".repeat(100), keys: ["signal"], active: true, priority: 1 });
    const high = makeStoryCard({ title: "High Priority", content: "high ".repeat(100), keys: ["signal"], active: true, priority: 10 });
    const adventure = {
      ...adventureForContext(),
      components: [],
      storyCards: [low, high],

      brains: [],
      messages: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      tokenBudgetSettings: budget({ maxContextTokens: 100000, maxRecentMessages: 0, recentMessageWindow: 0, sectionBudgets: {} }),
    } satisfies Adventure;
    // Budget sized to fit system rows + the high-priority card only.
    const unbounded = buildContext(adventure, { currentInput: "signal" });
    const lowTokens = unbounded.sections.flatMap((section) => section.items).find((entry) => entry.id === low.id)?.tokenEstimate ?? 0;
    adventure.tokenBudgetSettings = budget({ ...adventure.tokenBudgetSettings, maxContextTokens: unbounded.totalEstimatedTokens - lowTokens });

    const result = buildContext(adventure, { currentInput: "signal" });
    const remainingTitles = result.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.title);
    expect(remainingTitles).toEqual(["High Priority"]);
    expect(result.excludedItems).toContainEqual(
      expect.objectContaining({ id: low.id, title: "Low Priority", reason: "budget_exceeded" }),
    );
  });

  it("distinguishes protected from pinned when enforcing token budget", () => {
    const adventure = {
      ...adventureForContext(),
      components: [
        makeComponent({ id: "protected-huge", title: "Protected Huge", content: "protected ".repeat(80), alwaysOn: true, active: true, priority: 100, protected: true }),
        makeComponent({ id: "pinned-huge", title: "Pinned Huge", content: "pinned ".repeat(80), pinned: true, active: true, priority: 90, protected: false }),
      ],
      storyCards: [],

      brains: [],
      messages: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      tokenBudgetSettings: budget({ maxContextTokens: 10, maxRecentMessages: 0, recentMessageWindow: 0, sectionBudgets: {} }),
    } satisfies Adventure;

    const result = buildContext(adventure, {});
    // Total will exceed budget because protected items can't be dropped
    expect(result.totalEstimatedTokens).toBeGreaterThan(10);
    // System shell always present
    expect(result.sections.find((section) => section.id === "system")?.items.map((item) => item.id)).toEqual([
      "system-shell",
      "turn-scope-contract",
    ]);
    // Protected Huge survives in E. Components; Pinned Huge is dropped
    const componentItems = result.sections.find((section) => section.id === "components")?.items ?? [];
    expect(componentItems[0].title).toBe("Protected Huge");
    expect(componentItems).toHaveLength(1);
    expect(result.excludedItems).toContainEqual(expect.objectContaining({ id: "pinned-huge", reason: "budget_exceeded" }));
  });

  it("applies userLocked, systemSuggested, and hybrid priority modes predictably", () => {
    const lowSystemSuggested = makeStoryCard({
      id: "low-system-suggested",
      title: "Low Suggested",
      content: "suggested ".repeat(80),
      keys: ["signal"],
      priority: -200,
      inclusionPolicy: "systemSuggested",
    });
    const highUserCard = makeStoryCard({
      id: "high-user-card",
      title: "High User",
      content: "user ".repeat(80),
      keys: ["signal"],
      priority: 200,
      inclusionPolicy: "triggered",
    });
    const base = {
      ...adventureForContext(),
      components: [],
      storyCards: [lowSystemSuggested, highUserCard],

      brains: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      messages: [
        { id: "old", role: "user", content: "old ".repeat(80), createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "new", role: "assistant", content: "new ".repeat(80), createdAt: "2026-01-01T00:01:00.000Z" },
      ],
      tokenBudgetSettings: budget({ maxContextTokens: 260, maxRecentMessages: 2, recentMessageWindow: 2 }),
    } satisfies Adventure;

    const userLocked = buildContext({ ...base, tokenBudgetSettings: budget({ ...base.tokenBudgetSettings, memoryPriorityMode: "userLocked" }) }, { currentInput: "signal" });
    expect(userLocked.excludedItems[0]).toMatchObject({ id: "old", reason: "budget_exceeded" });

    const systemSuggested = buildContext(
      {
        ...base,
        tokenBudgetSettings: budget({
          ...base.tokenBudgetSettings,
          memoryPriorityMode: "systemSuggested",
          allowSystemToPrioritizeMemory: true,
        }),
      },
      { currentInput: "signal" },
    );
    expect(systemSuggested.excludedItems[0]).toMatchObject({ id: "low-system-suggested", reason: "budget_exceeded" });

    const hybrid = buildContext(
      {
        ...base,
        tokenBudgetSettings: budget({
          ...base.tokenBudgetSettings,
          memoryPriorityMode: "hybrid",
          allowSystemToPrioritizeMemory: true,
        }),
      },
      { currentInput: "signal" },
    );
    expect(hybrid.excludedItems[0]).toMatchObject({ id: "low-system-suggested", reason: "budget_exceeded" });
  });

  it("uses user priority changes for ordering and keeps preview payload matched by priority mode", () => {
    const low = makeStoryCard({ id: "low-priority", title: "Low", content: "low", keys: ["signal"], priority: 1 });
    const high = makeStoryCard({ id: "high-priority", title: "High", content: "high", keys: ["signal"], priority: 99 });
    const adventure = {
      ...adventureForContext(),
      components: [],
      storyCards: [low, high],

      brains: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      messages: [{ id: "m1", role: "user", content: "signal", createdAt: "2026-01-01T00:00:00.000Z" }],
      tokenBudgetSettings: budget({ maxContextTokens: 3000, maxRecentMessages: 1, recentMessageWindow: 1 }),
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "signal" });
    expect(result.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id)).toEqual(["high-priority", "low-priority"]);
    expectPreviewMatchesPayload(adventure, "userLocked");
    expectPreviewMatchesPayload(adventure, "systemSuggested");
    expectPreviewMatchesPayload(adventure, "hybrid");
  });

  it("reconstructs the exact provider payload from Context Preview data under each priority mode", () => {
    for (const mode of ["userLocked", "systemSuggested", "hybrid"] as const) {
      expectExactPayloadFromPreview(goldenAdventure(), mode);
    }
  });

  it("logs inactive exclusions", () => {
    const inactive = makeStoryCard({ title: "Inactive", content: "hidden", keys: ["lantern"], active: false });
    const adventure = {
      ...adventureForContext(),
      activeState: { ...adventureForContext().activeState, turn: 3 },
      storyCards: [inactive],
      brains: [],
      messages: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "lantern" });
    expect(result.excludedItems).toContainEqual(expect.objectContaining({ id: inactive.id, reason: "inactive" }));
  });

  it("sets generatedBy correctly for system and AI items", () => {
    const aiBrain = makeBrain({ id: "ai-brain", characterName: "npc", triggers: ["npc"], thoughts: { turn1_seen: "1 → I watch and say nothing." }, source: "generated", active: true });
    const adventure = {
      ...adventureForContext(),
      components: [],
      storyCards: [],
      brains: [aiBrain],
      messages: [{ id: "msg-user", role: "user", content: "npc appears.", createdAt: "2026-01-01T00:00:00.000Z" }],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      tokenBudgetSettings: budget({ maxContextTokens: 5000, maxRecentMessages: 2, recentMessageWindow: 2 }),
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "npc" });

    // System shell is "system"
    expect(result.sections.find((s) => s.id === "system")?.items[0].generatedBy).toBe("system");

    // AI-generated brain
    expect(result.sections.find((s) => s.id === "brains")?.items.find((i) => i.id === "ai-brain")?.generatedBy).toBe("ai");

    // Recent user message
    const msgItem = result.sections.find((s) => s.id === "recentMessages")?.items.find((i) => i.id === "msg-user");
    expect(msgItem?.generatedBy).toBe("user");
  });

  it("includes Next Output Bias as an inspectable, token-counted section before recent messages", () => {
    const adventure = {
      ...adventureForContext(),
      activeState: {
        ...adventureForContext().activeState,
        nextTurnNote: {
          content: "Keep the next output focused on the oath's consequences.",
          active: true,
          pinned: true,
          protected: false,
          priority: 85,
          expiresAfterUse: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "lantern" });
    const noteSection = result.sections.find((section) => section.id === "nextTurnNote");

    expect(result.sections.map((section) => section.id).slice(-3)).toEqual(["authorNote", "nextTurnNote", "challengeMode"]);
    expect(noteSection?.label).toBe("J. Next Output Bias");
    expect(noteSection?.items).toHaveLength(1);
    expect(noteSection?.items[0]).toMatchObject({
      id: "next-turn-note",
      sourceType: "nextTurnNote",
      title: "Next Output Bias",
      pinned: true,
      protected: false,
      priority: 85,
      generatedBy: "user",
    });
    expect(noteSection?.tokenEstimate).toBe(approximateTokenCount(noteSection?.content ?? ""));
    // Next Output Bias is per-turn context: it rides in the [TURN CONTEXT] block of the newest user message.
    const turnMessage = result.messages.at(-1)?.content ?? "";
    expect(result.messages[0].content).not.toContain("# J. Next Output Bias");
    expect(turnMessage).toContain("# J. Next Output Bias");
    expect(turnMessage).toContain("Keep the next output focused on the oath's consequences.");
  });

  it("can budget-drop unprotected Next Output Bias but preserves it when protected", () => {
    const makeAdventure = (protectedNote: boolean) =>
      ({
        ...adventureForContext(),
        components: [],
        storyCards: [],
  
        brains: [],
        rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
        messages: [],
        activeState: {
          ...adventureForContext().activeState,
          nextTurnNote: {
            content: "bias ".repeat(120),
            active: true,
            pinned: false,
            protected: protectedNote,
            priority: -100,
            expiresAfterUse: true,
          },
        },
        tokenBudgetSettings: budget({ maxContextTokens: 10, maxRecentMessages: 0, recentMessageWindow: 0 }),
      }) satisfies Adventure;

    const droppable = buildContext(makeAdventure(false));
    expect(droppable.sections.find((section) => section.id === "nextTurnNote")?.items).toHaveLength(0);
    expect(droppable.excludedItems).toContainEqual(
      expect.objectContaining({ id: "next-turn-note", sourceType: "nextTurnNote", reason: "budget_exceeded" }),
    );

    const protectedResult = buildContext(makeAdventure(true));
    expect(protectedResult.sections.find((section) => section.id === "nextTurnNote")?.items).toHaveLength(1);
    expect(protectedResult.totalEstimatedTokens).toBeGreaterThan(10);
  });

  it("logs inactive Next Output Bias as an explicit exclusion", () => {
    const adventure = {
      ...adventureForContext(),
      activeState: {
        ...adventureForContext().activeState,
        nextTurnNote: {
          content: "Hold the reveal.",
          active: false,
          pinned: true,
          protected: false,
          priority: 85,
          expiresAfterUse: true,
        },
      },
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "lantern" });

    expect(result.sections.find((section) => section.id === "nextTurnNote")?.items).toHaveLength(0);
    expect(result.excludedItems).toContainEqual(
      expect.objectContaining({ id: "next-turn-note", sourceType: "nextTurnNote", reason: "inactive" }),
    );
  });

  it("exposes pending Memory Proposals in pendingProposals without including them in model context", () => {
    const proposal = makeMemoryProposal({ id: "proposal-test", status: "pending" });
    const approved = makeMemoryProposal({ id: "proposal-approved", status: "approved" });
    const adventure = {
      ...adventureForContext(),
      activeState: {
        ...adventureForContext().activeState,
        memoryProposals: [proposal, approved],
      },
    } satisfies Adventure;

    const result = buildContext(adventure, { currentInput: "lantern" });

    // Only pending proposals surfaced
    expect(result.pendingProposals).toHaveLength(1);
    expect(result.pendingProposals[0].id).toBe("proposal-test");

    // Nothing from proposals appears in model payload
    const payloadText = result.messages.map((m) => m.content).join(" ");
    expect(payloadText).not.toContain(proposal.content);
  });

  it("Adventure Chronicle (adventure.messages) is never automatically dumped into context — only maxRecentMessages appears", () => {
    // 50-message chronicle; only 5 should reach the model
    const chronicle = Array.from({ length: 50 }, (_, i) => ({
      id: `msg-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Turn ${i} content.`,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    const adventure = {
      ...createDefaultAdventure("Chronicle"),
      components: [],
      storyCards: [],

      brains: [],
      rollingSummary: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      messages: chronicle,
      tokenBudgetSettings: budget({ maxContextTokens: 50000, maxRecentMessages: 5, recentMessageWindow: 5, sectionBudgets: {} }),
    } satisfies Adventure;

    const result = buildContext(adventure);

    // K. Recent Messages holds at most maxRecentMessages items (newest first). The oldest kept
    // message is chunk-aligned (window of 5 → chunks of 2) so the prompt prefix stays stable.
    const recentSection = result.sections.find((s) => s.id === "recentMessages");
    expect(recentSection?.items).toHaveLength(4);
    expect(recentSection?.items[0].id).toBe("msg-49"); // newest
    expect(recentSection?.items[3].id).toBe("msg-46"); // oldest of the aligned window

    // Provider payload: 1 system message + 4 recent messages in chronological order.
    expect(result.messages.length).toBeGreaterThanOrEqual(5);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].content).toBe("Turn 46 content.");
    expect(result.messages[4].content).toContain("Turn 49 content.");

    // System payload does NOT contain the older 45 messages
    const systemText = result.messages[0].content;
    expect(systemText).not.toContain("Turn 0 content.");
    expect(systemText).not.toContain("Turn 44 content.");

    // The full 50-message chronicle is preserved in adventure state
    expect(adventure.messages).toHaveLength(50);
  });

  it("opening scene appears as first assistant message in payload and is treated as ordinary droppable content", () => {
    const opening = "The storm broke at midnight. Rain lashed the glass.";
    const adventure = {
      ...adventureForContext(),
      openingScene: opening,
      messages: [
        { id: "m1", role: "user" as const, content: "I look around.", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "m2", role: "assistant" as const, content: "Shadows gather.", createdAt: "2026-01-01T00:01:00.000Z" },
      ],
      tokenBudgetSettings: budget({ maxContextTokens: 50000, maxRecentMessages: 4, recentMessageWindow: 4, sectionBudgets: {} }),
    } satisfies Adventure;

    const result = buildContext(adventure);

    // Opening scene is first message after system, before recent transcript
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1]).toEqual({ role: "assistant", content: opening });
    expect(result.messages[2].content).toBe("I look around.");
    expect(result.messages[3].content).toBe("Shadows gather.");

    // Opening scene is not protected — it's ordinary oldest assistant output
    const recentSection = result.sections.find((s) => s.id === "recentMessages");
    const openingItem = recentSection?.items.find((i) => i.id === "opening-scene");
    expect(openingItem).toBeDefined();
    expect(openingItem?.protected).toBe(false);
    expect(openingItem?.content).toBe(opening);

    // Opening scene is dropped first under a tight budget (oldest, lowest recency priority, unprotected)
    const tightAdventure = { ...adventure, tokenBudgetSettings: budget({ maxContextTokens: 1, maxRecentMessages: 4, recentMessageWindow: 4, sectionBudgets: {} }) };
    const tightResult = buildContext(tightAdventure);
    expect(tightResult.sections.find((s) => s.id === "recentMessages")?.items.find((i) => i.id === "opening-scene")).toBeUndefined();
  });

  it("empty sections are omitted from the provider payload but still present in result.sections", () => {
    // adventureForContext has no aiInstructions/plotEssentials/authorNote/sceneState content
    const result = buildContext(adventureForContext(), { currentInput: "lantern" });
    // All section IDs always present in result.sections
    expect(result.sections.map((s) => s.id)).toHaveLength(13);
    // Empty typed sections do not appear in the payload
    const payload = result.messages.map((message) => message.content).join("\n");
    expect(payload).not.toContain("# B. AI Instructions");
    expect(payload).not.toContain("# C. Plot Essentials");
    expect(payload).not.toContain("# D. Author's Note");
    // Non-empty sections do appear
    expect(payload).toContain("# E. Components");
    expect(payload).toContain("# F. Story Cards");
  });

  it("golden adventure context matches the preview and provider payload contract", () => {
    const result = buildContext(goldenAdventure(), {
      currentInput: "Margo repeats hedge prince to Seth.",
      latestModelOutput: "The Beast howls at the ward.",
    });

    expect(result.sections.map((section) => section.id)).toEqual([
      "system",
      "aiInstructions",
      "plotEssentials",
      "currentArc",
      "components",
      "pinnedStoryCards",
      "recentMessages",
      "storyState",
      "storyCards",
      "brains",
      "authorNote",
      "nextTurnNote",
      "challengeMode",
    ]);
    expect(result.sections.find((section) => section.id === "aiInstructions")?.items.map((item) => item.id)).toEqual(["component-ai"]);
    expect(result.sections.find((section) => section.id === "plotEssentials")?.items.map((item) => item.id)).toEqual(["component-plot"]);
    expect(result.sections.find((section) => section.id === "authorNote")?.items.map((item) => item.id)).toEqual(["component-author"]);
    expect(result.sections.find((section) => section.id === "components")?.items.map((item) => item.id)).toEqual(["component-pinned"]);
    expect(result.sections.find((section) => section.id === "storyCards")?.items.map((item) => item.id)).toEqual(["card-joke", "card-beast"]);
    expect(result.sections.find((section) => section.id === "brains")?.items.map((item) => item.id)).toEqual(["brain-margo", "brain-seth"]);
    expect(result.sections.find((section) => section.id === "nextTurnNote")?.items).toEqual([]);
    expect(result.sections.find((section) => section.id === "recentMessages")?.items.map((item) => item.id)).toEqual([
      "msg-6",
      "msg-5",
      "msg-4",
      "msg-3",
      "msg-2",
      "msg-1",
    ]);
    expect(result.excludedItems).toEqual([
      expect.objectContaining({ id: "component-inactive", reason: "inactive" }),
      expect.objectContaining({ id: "card-inactive", reason: "inactive" }),
    ]);
    for (const section of result.sections) {
      expect(section.tokenEstimate).toBe(approximateTokenCount(section.content));
    }
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("# A. System Shell / Global Generation Rules");
    expect(result.messages[0].content).toContain("# B. AI Instructions");
    const turnContext = result.messages.at(-1)?.content ?? "";
    expect(turnContext.startsWith("[TURN CONTEXT")).toBe(true);
    expect(turnContext).toContain("# F. Story Cards");
    expect(turnContext).toContain("## Hedge Prince Joke");
    expect(result.messages[0].content).not.toContain("# I. Rolling Summary");
    const expectedRecent = [
      "Rain tapped against the glass.",
      "I ask Margo about the ward.",
      "Margo glances toward Seth.",
      "I repeat the hedge prince joke.",
      "The Beast howls somewhere below.",
      "We hurry toward the threshold.",
    ];
    // Runtime instructions are part of the system section; recent messages still follow in order,
    // with the per-turn context block leading the newest user message (or trailing as its own user turn).
    const stripTurnContext = (content: string) => content.includes(TURN_CONTEXT_CLOSE) ? content.slice(content.indexOf(TURN_CONTEXT_CLOSE) + TURN_CONTEXT_CLOSE.length).trim() : content;
    expect(result.messages.slice(1, 1 + expectedRecent.length).map((message) => stripTurnContext(message.content))).toEqual(expectedRecent);

    // E. Components is present because the golden adventure has a pinned weather component
    // Single-item sections render content directly under the section header (no ## sub-header)
    expect(result.messages[0].content).toContain("# E. Components");
    expect(result.messages[0].content).toContain("Rain makes the city smell like iron.");
  });

  it("withholds the arc break instruction from context until the phase reaches break", () => {
    const arc = {
      ...makeComponent({ title: "Current Story Arc", type: "currentArc", content: "The Red Ring tightens its grip.", active: true, priority: 50 }),
      arcThreadKeys: ["baddie"],
      arcSimmerInstruction: "Shroud stays off-screen, glimpses only.",
      arcBreakInstruction: "Shroud forces the confrontation; allies can die.",
      arcState: { phase: "simmer" as const, tier: 0, threadEngagement: {}, pendingBreak: false },
    };
    const adventure: Adventure = { ...createDefaultAdventure("Arc Gate"), components: [arc] };
    const arcText = (a: Adventure) =>
      buildContext(a, {}).sections.find((section) => section.id === "currentArc")?.items.map((item) => item.content).join("\n") ?? "";

    // Simmering: the simmer instruction is present and the break (cost) instruction is absent.
    const simmering = arcText(adventure);
    expect(simmering).toContain("stays off-screen");
    expect(simmering).not.toContain("forces the confrontation");

    // Broken: the break instruction is now injected; the simmer instruction is gone.
    const broken = arcText({ ...adventure, components: [{ ...arc, arcState: { ...arc.arcState, phase: "break" } }] });
    expect(broken).toContain("forces the confrontation");
    expect(broken).not.toContain("stays off-screen");
  });

  it("injects a brain's thought log only — never the legacy unbounded state fields", () => {
    const brain = makeBrain({
      characterName: "Mira",
      triggers: ["lantern"],
      thoughts: { turn3_betrayal: "3 → The ward was a trap. I'm done protecting the prince." },
      // Legacy fields exist in the data but must NOT reach context (no editor field, append unbounded).
      currentState: "Cornered and calculating a betrayal.",
      recentDevelopments: "Just learned the ward was a trap.",
      relationshipPressure: "Done protecting the prince.",
      active: true,
      inclusionPolicy: "always",
    });
    const adventure: Adventure = { ...createDefaultAdventure("Brain State"), brains: [brain] };
    const brainText = buildContext(adventure, {}).sections.find((section) => section.id === "brains")?.items.map((item) => item.content).join("\n") ?? "";
    expect(brainText).toContain("turn3_betrayal: 3 → The ward was a trap. I'm done protecting the prince.");
    expect(brainText).not.toContain("State: Cornered and calculating a betrayal.");
    expect(brainText).not.toContain("Recent:");
    expect(brainText).not.toContain("Relationships:");
  });

  it("deduplicates equivalent brain thoughts before context assembly", () => {
    const repeated = "She held the line. I need to know whether she can hold this one too.";
    const brain = makeBrain({
      characterName: "Mira",
      active: true,
      inclusionPolicy: "always",
      thoughts: {
        turn9_old: `9 \u2192 ${repeated}`,
        turn10_repeat: `10 \u2192 ${repeated}`,
        turn11_new: "11 \u2192 The ward answered Seth first. That changes the math.",
      },
    });
    const adventure: Adventure = { ...createDefaultAdventure("Brain State"), brains: [brain] };
    const brainText = buildContext(adventure, {}).sections.find((section) => section.id === "brains")?.items.map((item) => item.content).join("\n") ?? "";
    expect(brainText).not.toContain("turn9_old");
    expect(brainText).toContain("turn10_repeat");
    expect(brainText).toContain("turn11_new");
    expect((brainText.match(/She held the line/g) ?? [])).toHaveLength(1);
  });

  it("excludes a triggered brain that has no thoughts yet", () => {
    const brain = makeBrain({
      characterName: "Mira",
      triggers: ["lantern"],
      currentState: "Cornered and calculating a betrayal.",
      active: true,
      inclusionPolicy: "always",
    });
    const adventure: Adventure = { ...createDefaultAdventure("Brain State"), brains: [brain] };
    const brains = buildContext(adventure, {}).sections.find((section) => section.id === "brains");
    expect(brains?.items.length ?? 0).toBe(0);
  });

  it("hides a memory tag when the provider truncates it mid-attribute", () => {
    const result = extractInlineThoughts(`You don't say anything as you travel. The silence is comfortable.\n\n<memory category="world_fact" memoryMode="historical" title="Chimera Containment" content="• Shroud's Chimera bio-weapon was activated at the old rail yards and successfully destroyed by Z-Team.\n• The team used a combined strategy: Titan absorbed its novel attacks, Nix's concussive charges scrambled its systems`);

    expect(result.cleanContent).toBe("You don't say anything as you travel. The silence is comfortable.");
    expect(result.memoryTags).toEqual([]);
  });
});
