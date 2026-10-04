import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { runTurnPipeline } from "../state/turnPipeline";
import { evaluateStoryResponseGuard } from "../state/storyResponseGuard";
import {
  INLINE_MEMORY_PAUSE_AFTER,
  INLINE_MEMORY_RETRY_TURNS,
  ONE_PASS_MEMORY_ID,
  ONE_PASS_PAUSED_LABEL,
  ONE_PASS_REMINDER_ID,
  inlineMemoryPaused,
  onePassMemoryActions,
  parseOnePassMemory,
} from "./onePassMemory";
import { selectEventMemories } from "./eventMemory";

function fixture() {
  const adventure = createDefaultAdventure("One-pass quality checks");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true };
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, storyCard: true, brainUpdate: true, plotEssentialsUpdate: true };
  adventure.brains = [makeBrain({ id: "mira-brain", characterName: "Mira", active: true, thoughts: { old: "I distrust the duke." } })];
  adventure.storyCards = [makeStoryCard({ id: "mira-card", title: "Mira", content: "Mira is a scout.", active: true, protected: false, pinned: true })];
  adventure.components = [
    makeComponent({ id: "essentials", title: "Foundations", type: "plotEssentials", content: "The exiles seek a safe home.", active: true }),
    makeComponent({ id: "pressure", title: "Pressure", type: "activePressure", content: "The duke demands tribute.", active: true }),
  ];
  return adventure;
}

const story = "Mira lowers the letter. The duke has ended the tribute demand. Silver burns her skin.";
const update = { kind: "card", target: "Mira", content: "Silver burns Mira's skin.", evidence: "Silver burns her skin.", reason: "Lasting vulnerability" };
const envelope = (updates: unknown[]) => `${story}\n<memory_updates>${JSON.stringify({ updates })}</memory_updates>`;
const event = { kind: "newCard", target: "The Duke's Tribute Letter", cardType: "event", category: "plot_beat", participants: ["Mira"], eventKind: "revelation", triggers: ["tribute letter"], content: "Mira read the duke's letter ending the tribute demand.", evidence: "The duke has ended the tribute demand.", reason: "The exiles will remember when the tribute ended" };

describe("one-pass memory quality boundary", () => {
  it("narrates and remembers with one provider call, preserving old facts and citing the saved story", async () => {
    const adventure = fixture();
    const provider = vi.fn(async () => ({ content: envelope([
      update,
      { kind: "thought", target: "Mira", content: "I can finally stop fearing the next tribute demand.", evidence: "The duke has ended the tribute demand.", reason: "Changed belief" },
      { kind: "pressure", target: "Pressure", content: "The tribute obligation has ended.", evidence: "The duke has ended the tribute demand.", reason: "Resolved external obligation" },
    ]) }));
    const result = await runTurnPipeline({ adventure, text: "Mira reads the letter.", assistantMessageId: "new-story", sendChatCompletion: provider });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.responseContent).toBe(story);
    expect(result.adventure.storyCards).toHaveLength(1);
    expect(result.adventure.storyCards[0].content).toContain("scout");
    expect(result.adventure.storyCards[0].content).toContain("Silver");
    expect(result.adventure.activeState.memoryProposals[0]).toMatchObject({ sourceTurnId: "new-story", sourceText: update.evidence });
    expect(Object.values(result.adventure.brains[0].thoughts)).toEqual(expect.arrayContaining(["I distrust the duke.", expect.stringContaining("stop fearing")]));
    expect(result.adventure.components.find(c => c.id === "pressure")?.content).toBe("The tribute obligation has ended.");
    expect(result.adventure.components.find(c => c.id === "essentials")?.content).toBe(adventure.components[0].content);
  });

  it.each([
    ["missing", story],
    ["truncated", `${story}<memory_updates>{"updates":[`],
    ["truncated opening tag", `${story}<memory_up`],
    ["invalid JSON", `${story}<memory_updates>{oops}</memory_updates>`],
    ["multiple tails", `${envelope([])}<memory_updates>{"updates":[]}</memory_updates>`],
    ["too many updates", envelope(Array(5).fill(update))],
  ])("preserves good story after %s memory output without a retry", async (_label, content) => {
    const adventure = fixture();
    const provider = vi.fn(async () => ({ content }));
    const result = await runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: provider });
    expect(result.responseContent).toBe(story);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.adventure.storyCards).toEqual(adventure.storyCards);
    expect(result.adventure.activeState.evaluationLog[0].errors.length).toBeGreaterThan(0);
  });

  it("treats no change as normal and excludes hidden output from length/agency correction", () => {
    const text = envelope([]);
    expect(parseOnePassMemory(text)).toEqual({ story, updates: [] });
    const longTail = envelope([{ ...update, reason: "you agree ".repeat(1000) }]);
    expect(evaluateStoryResponseGuard(longTail, 50, "Mira listens.").needsCorrection).toBe(false);
  });

  it.each([
    { ...update, evidence: "Mira is immortal and rules the world." },
    { ...update, target: "Missing person" },
    { ...update, kind: "currentArc" },
    { ...update, kind: "providerConfig" },
    { ...update, kind: "thought", target: "Absent NPC" },
    { ...update, content: "fact ".repeat(71) },
  ])("rejects ungrounded, oversized or unauthorized updates: $kind / $target", u => {
    const adventure = fixture();
    const context = buildContext(adventure, { currentInput: "Mira listens." });
    const actions = onePassMemoryActions(adventure, context, [u], story, "story-id");
    expect(actions.map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
  });

  it("does not accept updates to a card excluded by context selection", () => {
    const adventure = fixture();
    adventure.storyCards[0].pinned = false;
    adventure.storyCards[0].inclusionPolicy = "manual";
    const actions = onePassMemoryActions(adventure, buildContext(adventure), [update], story, "story-id");
    expect(actions.map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
  });

  it("requires review of foundational and new plot changes even with auto-approve enabled", () => {
    const adventure = fixture();
    const updates = [
      { ...update, kind: "essentials", target: "Foundations", content: "The exiles now defend their permanent home." },
      { ...update, kind: "newCard", target: "Silver Curse", content: "The silver curse threatens every exile.", cardType: "plot", category: "plot_beat", triggers: ["silver curse"], memoryMode: "living" },
    ];
    const next = onePassMemoryActions(adventure, buildContext(adventure), updates, story, "story-id").reduce(adventureReducer, adventure);
    expect(next.components).toEqual(adventure.components);
    expect(next.storyCards).toEqual(adventure.storyCards);
    expect(next.activeState.memoryProposals).toHaveLength(2);
    expect(next.activeState.memoryProposals.every(p => p.requiresReview && p.status === "pending")).toBe(true);
    const proposal = next.activeState.memoryProposals.find(p => p.proposedType === "plotEssentialsUpdate")!;
    const approved = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.components.find(c => c.id === "essentials")?.content).toBe(proposal.content);
  });

  it("deduplicates repeated evidence and reuses an existing subject instead of creating a sibling", async () => {
    const adventure = fixture();
    const provider = vi.fn(async () => ({ content: envelope([{ ...update, kind: "newCard", cardType: "character", category: "character_reveal", triggers: ["Mira"] }]) }));
    const first = await runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: provider });
    const second = await runTurnPipeline({ adventure: first.adventure, text: "Mira waits.", sendChatCompletion: provider });
    expect(second.adventure.storyCards).toHaveLength(1);
    expect(second.adventure.storyCards[0].content).toBe(first.adventure.storyCards[0].content);
    expect(second.adventure.activeState.memoryProposals).toHaveLength(1);
  });

  it("does not create more than one new card per turn, events included", () => {
    const adventure = fixture();
    const newCard = { ...update, kind: "newCard", target: "Silver", cardType: "lore", category: "world_fact", triggers: ["silver burn"] };
    const actions = onePassMemoryActions(adventure, buildContext(adventure), [newCard, { ...newCard, target: "Metal" }, { ...event, target: "Letter arrival" }], story, "story-id");
    expect(actions.filter(a => a.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(1);
  });

  it("records a completed occurrence as its own event card instead of appending it to the character profile", async () => {
    const adventure = fixture();
    const result = await runTurnPipeline({ adventure, text: "Mira reads the letter.", assistantMessageId: "letter-story", sendChatCompletion: async () => ({ content: envelope([event]) }) });
    const mira = result.adventure.storyCards.find(c => c.id === "mira-card")!;
    expect(mira.content).toBe("Mira is a scout.");
    const card = result.adventure.storyCards.find(c => c.type === "event")!;
    expect(card).toMatchObject({ title: event.target, memoryMode: "historical", autoUpdate: false, keys: ["tribute letter"] });
    expect(card.eventMemory).toEqual({ sourceMessageIds: ["letter-story"], participants: ["Mira"], recallCues: ["tribute letter"], kind: "revelation" });
    // A short anchor recalls the event only alongside a participant.
    expect(selectEventMemories(result.adventure.storyCards, "Mira folds the tribute letter away.").has(card.id)).toBe(true);
    expect(selectEventMemories(result.adventure.storyCards, "The tribute letter lies on the table.").has(card.id)).toBe(false);
  });

  it.each([
    ["participant absent from the turn", { participants: ["Absent NPC"] }],
    ["only a participant name as trigger", { triggers: ["Mira"] }],
    ["only sentence-length triggers", { triggers: ["the night Mira read the letter from the duke"] }],
    ["title of an existing card", { target: "Mira" }],
  ])("rejects an event with %s and leaves the profile untouched", (_label, patch) => {
    const adventure = fixture();
    const next = onePassMemoryActions(adventure, buildContext(adventure), [{ ...event, ...patch }], story, "story-id").reduce(adventureReducer, adventure);
    expect(next.storyCards).toEqual(adventure.storyCards);
    expect(next.activeState.memoryProposals).toHaveLength(0);
  });

  it("pauses inline memory after consecutive missing envelopes, logs it, and retries later", async () => {
    let adventure = fixture();
    const missing = vi.fn(async () => ({ content: story }));
    for (let i = 0; i < INLINE_MEMORY_PAUSE_AFTER; i++) {
      expect(inlineMemoryPaused(adventure)).toBe(false);
      adventure = (await runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: missing })).adventure;
    }
    expect(inlineMemoryPaused(adventure)).toBe(true);

    const paused = await runTurnPipeline({ adventure, text: "Mira waits.", sendChatCompletion: missing });
    const sent = paused.providerPayload.map(m => m.content).join("\n");
    expect(sent).not.toContain("ONE-PASS MEMORY");
    expect(paused.preProviderContext.sections.find(s => s.id === "memoryReminder")?.items).toEqual([]);
    expect(paused.preProviderContext.decisions).toContainEqual(expect.objectContaining({ itemId: ONE_PASS_MEMORY_ID, action: "excluded", detail: expect.stringContaining("Paused") }));
    expect(paused.adventure.activeState.evaluationLog[0].actionsExecuted).toEqual([ONE_PASS_PAUSED_LABEL]);
    // The memory-only fallback can still build the full instruction while paused.
    expect(buildContext(paused.adventure, { forceMemoryInstruction: true }).sections.flatMap(s => s.items).map(i => i.id)).toEqual(expect.arrayContaining([ONE_PASS_MEMORY_ID, ONE_PASS_REMINDER_ID]));

    const later = { ...paused.adventure, activeState: { ...paused.adventure.activeState, turn: paused.adventure.activeState.turn + INLINE_MEMORY_RETRY_TURNS } };
    expect(inlineMemoryPaused(later)).toBe(false);
  });

  it("does not pause when an envelope arrives between misses", async () => {
    let adventure = fixture();
    const replies = [story, envelope([]), story, story];
    for (const content of replies) adventure = (await runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: async () => ({ content }) })).adventure;
    expect(inlineMemoryPaused(adventure)).toBe(false);
  });

  it("keeps the changing memory lists out of the cached system prompt", () => {
    const adventure = adventureReducer(fixture(), { type: "ADD_MESSAGE", role: "user", content: "Mira listens." });
    const result = buildContext(adventure, { currentInput: "Mira listens." });
    expect(result.messages[0].content).toContain("[ONE-PASS MEMORY]");
    expect(result.messages[0].content).not.toContain("Eligible existing targets");
    expect(result.messages[0].content).not.toContain('Eligible thought targets: "Mira"');
    // Joined to the player's turn (Anthropic-format providers would hoist a system message to the top).
    const last = result.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content.startsWith("Mira listens.\n\n[ONE-PASS MEMORY")).toBe(true);
    expect(result.messages.filter(m => m.role === "user")).toHaveLength(1);
    expect(last.content).toContain('Eligible thought targets: "Mira"');
    expect(last.content).toContain('"cards":["Mira"]');
  });

  it("strips a character's repeated stock line from a new thought and skips pure repeats", () => {
    const adventure = fixture();
    adventure.brains[0].thoughts = { old: "3 → I keep saying yes and meaning it, whatever the duke wants." };
    const thought = (content: string) => ({ kind: "thought", target: "Mira", content, evidence: "The duke has ended the tribute demand.", reason: "Changed belief" });
    const fresh = onePassMemoryActions(adventure, buildContext(adventure, { currentInput: "Mira listens." }),
      [thought("I keep saying yes and meaning it. With the tribute gone, the exiles finally owe the duke nothing.")], story, "story-id")
      .reduce(adventureReducer, adventure);
    const added = Object.values(fresh.brains[0].thoughts).find(t => t.includes("tribute gone"));
    expect(added).toBeDefined();
    expect(added).not.toContain("I keep saying yes");
    const repeat = onePassMemoryActions(adventure, buildContext(adventure, { currentInput: "Mira listens." }),
      [thought("I keep saying yes and meaning it.")], story, "story-id").reduce(adventureReducer, adventure);
    expect(repeat.brains[0].thoughts).toEqual(adventure.brains[0].thoughts);
  });

  it.each(["disabled", "comms"])("strips but never applies unsolicited memory when %s", async condition => {
    const adventure = fixture();
    if (condition === "disabled") adventure.memoryDetectionSettings.enabled = false;
    const result = await runTurnPipeline({ adventure, text: "Mira listens.", mode: condition === "comms" ? "comms" : "story", sendChatCompletion: async () => ({ content: envelope([update]) }) });
    expect(result.adventure.storyCards).toEqual(adventure.storyCards);
    expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
    expect(result.preProviderContext.sections.flatMap(s => s.items.map(i => i.id))).not.toContain(ONE_PASS_MEMORY_ID);
  });

  it("fails an empty story before applying memory or incrementing the turn", async () => {
    const adventure = fixture();
    await expect(runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: async () => ({ content: '<memory_updates>{"updates":[]}</memory_updates>' }) })).rejects.toThrow("no visible story");
    expect(adventure.activeState.turn).toBe(0);
  });

  it("logs an arc development without changing the authored premise or phase", async () => {
    const adventure = fixture();
    adventure.memoryAutoApprove.currentArcUpdate = true;
    const arc = makeComponent({ id: "arc", title: "Tribute", type: "currentArc", active: true, arcPremise: "End the duke's tribute.", arcSimmerInstruction: "Let the tax dispute develop.", arcBreakInstruction: "SECRET CLIMAX", content: "The duke sent a demand." });
    adventure.components.push(arc);
    const arcUpdate = { kind: "arc", target: "Tribute", content: "The duke ended the tribute demand.", evidence: "The duke has ended the tribute demand.", reason: "Completed development of this arc", arcState: { phase: "break" } };
    const result = await runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: async () => ({ content: envelope([arcUpdate]) }) });
    expect(result.adventure.activeState.evaluationLog[0].errors).toEqual([]);
    const nextArc = result.adventure.components.find(c => c.id === "arc")!;
    expect(nextArc.content).toContain(arc.content);
    expect(nextArc.content).toContain(arcUpdate.content);
    expect(nextArc.arcPremise).toBe(arc.arcPremise);
    expect(nextArc.arcState).toEqual(arc.arcState);
    expect(result.preProviderContext.messages.map(m => m.content).join("\n")).not.toContain("SECRET CLIMAX");
  });

  it("honors component opt-out, protected-card review, and brain cooldowns", () => {
    const adventure = fixture();
    adventure.components[1].autoUpdate = false;
    adventure.storyCards[0].protected = true;
    adventure.brains[0].lastUpdatedTurn = 0;
    adventure.brains[0].autoUpdateCooldownTurns = 3;
    const actions = onePassMemoryActions(adventure, buildContext(adventure, { currentInput: "Mira listens." }), [
      update,
      { ...update, kind: "thought", content: "I fear silver." },
      { ...update, kind: "pressure", target: "Pressure", content: "The tribute obligation has ended." },
    ], story, "story-id");
    const next = actions.reduce(adventureReducer, adventure);
    expect(next.brains).toEqual(adventure.brains);
    expect(next.components).toEqual(adventure.components);
    expect(next.storyCards).toEqual(adventure.storyCards);
    expect(next.activeState.memoryProposals).toHaveLength(1);
    expect(next.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true });
  });
});
