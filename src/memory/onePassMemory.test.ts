import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { runTurnPipeline } from "../state/turnPipeline";
import { evaluateStoryResponseGuard } from "../state/storyResponseGuard";
import { ONE_PASS_MEMORY_ID, onePassMemoryActions, parseOnePassMemory } from "./onePassMemory";

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
    expect(result.adventure.storyCards[0].memoryUpdateHistory?.[0]?.operation).toBe("replace");
    expect(result.adventure.activeState.memoryProposals[0]).toMatchObject({ sourceTurnId: "new-story", sourceText: update.evidence });
    expect(Object.values(result.adventure.brains[0].thoughts)).toEqual(expect.arrayContaining(["I distrust the duke.", expect.stringContaining("stop fearing")]));
    expect(result.adventure.components.find(c => c.id === "pressure")?.content).toBe("The tribute obligation has ended.");
    expect(result.adventure.components.find(c => c.id === "essentials")?.content).toBe(adventure.components[0].content);
  });

  it("appends a one-pass fact to a living card", () => {
    const adventure = fixture();
    adventure.storyCards[0].memoryMode = "living";
    const actions = onePassMemoryActions(adventure, buildContext(adventure), [update], story, "story-id");
    const result = actions.reduce(adventureReducer, adventure);
    expect(result.storyCards[0].content).toContain("Mira is a scout.");
    expect(result.storyCards[0].content).toContain("Silver burns Mira's skin.");
    expect(result.storyCards[0].memoryUpdateHistory?.[0]?.operation).toBe("append");
  });

  it("accepts a thought from a continuing exchange that uses a pronoun", () => {
    let adventure = fixture();
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "prior-user", role: "user", content: "I ask Mira about the letter." });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "prior-story", role: "assistant", content: "Mira says she will read it." });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "player", role: "user", content: "I ask her what she found." });
    adventure = adventureReducer(adventure, { type: "ADD_MESSAGE", id: "story", role: "assistant", content: "She realizes the duke lied about the tribute." });
    const context = buildContext(adventure, { latestModelOutput: adventure.messages.at(-1)?.content });
    const actions = onePassMemoryActions(adventure, context, [{
      kind: "thought", target: "Mira", content: "I need to confront the duke about his lie.",
      evidence: "She realizes the duke lied about the tribute.", reason: "New private plan",
    }], adventure.messages.at(-1)!.content, "story", undefined, "Fallback", "I ask her what she found.");
    expect(actions.map(action => action.type)).toContain("APPLY_BRAIN_UPDATE");
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

  it("does not create new events or more than one new recurring subject", () => {
    const adventure = fixture();
    const newCard = { ...update, kind: "newCard", target: "Silver", cardType: "lore", category: "world_fact", triggers: ["silver burn"] };
    const actions = onePassMemoryActions(adventure, buildContext(adventure), [newCard, { ...newCard, target: "Metal" }, { ...newCard, target: "Letter arrival", cardType: "event" }], story, "story-id");
    expect(actions.filter(a => a.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(1);
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
