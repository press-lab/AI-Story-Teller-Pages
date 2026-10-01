import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { runTurnPipeline } from "../state/turnPipeline";
import { evaluateStoryResponseGuard } from "../state/storyResponseGuard";
import type { Adventure } from "../types/adventure";
import { memoryPassRules, memoryUpdateActions, parseOnePassMemory, supersedeCardFact, type MemoryPassScope } from "./onePassMemory";

function fixture() {
  const adventure = createDefaultAdventure("Memory pass quality checks");
  adventure.memoryDetectionSettings = { ...adventure.memoryDetectionSettings, enabled: true };
  adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, storyCard: true, brainUpdate: true, plotEssentialsUpdate: true };
  adventure.brains = [makeBrain({ id: "mira-brain", characterName: "Mira", active: true, thoughts: { old: "I distrust the duke." } })];
  adventure.storyCards = [makeStoryCard({ id: "mira-card", title: "Mira", content: "Mira is a scout.", active: true, protected: false, pinned: true })];
  adventure.components = [
    makeComponent({ id: "essentials", title: "Foundations", type: "plotEssentials", content: "The exiles seek a safe home.", active: true }),
    makeComponent({ id: "pressure", title: "Pressure", type: "activePressure", content: "The duke demands tribute.", active: true }),
    makeComponent({ id: "state", title: "Story State", type: "storyState", content: "", active: true, alwaysOn: true, protected: true, inclusionPolicy: "always", autoUpdate: true }),
  ];
  return adventure;
}

const story = "Mira lowers the letter. The duke has ended the tribute demand. Silver burns her skin.";
const update = { kind: "card", target: "Mira", content: "Silver burns Mira's skin.", evidence: "Silver burns her skin.", reason: "Lasting vulnerability" };

function scopeFor(adventure: Adventure): MemoryPassScope {
  const context = buildContext(adventure, { currentInput: "Mira listens." });
  const visibleIds = new Set(context.sections.flatMap(s => s.items.map(i => i.id)));
  adventure.components.filter(c => c.type === "storyState").forEach(c => visibleIds.add(c.id));
  return { visibleIds, eligibleThoughtTargets: adventure.brains.map(b => b.characterName) };
}

function apply(adventure: Adventure, updates: unknown[], evidence = [story]) {
  return memoryUpdateActions(adventure, scopeFor(adventure), updates, evidence, "story-id", "Background memory pass: one API call");
}

describe("narrator output", () => {
  it("keeps memory instructions out of the narrator prompt", () => {
    const context = buildContext(fixture(), { currentInput: "Mira listens." });
    const payload = context.messages.map(m => m.content).join("\n");
    expect(payload).not.toContain("<memory_updates>");
    expect(payload).not.toContain("MEMORY PASS");
    expect(payload).not.toContain("Eligible existing targets");
  });

  it.each([
    ["truncated", `${story}<memory_updates>{"updates":[`],
    ["truncated opening tag", `${story}<memory_up`],
    ["invalid JSON", `${story}<memory_updates>{oops}</memory_updates>`],
    ["valid but unsolicited", `${story}\n<memory_updates>${JSON.stringify({ updates: [update] })}</memory_updates>`],
  ])("strips a stray %s envelope and never applies it", async (_label, content) => {
    const adventure = fixture();
    const provider = vi.fn(async () => ({ content }));
    const result = await runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: provider });
    expect(result.responseContent).toBe(story);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.adventure.storyCards).toEqual(adventure.storyCards);
    expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
  });

  it("excludes hidden output from length/agency correction", () => {
    const longTail = `${story}\n<memory_updates>${JSON.stringify({ updates: [{ ...update, reason: "you agree ".repeat(1000) }] })}</memory_updates>`;
    expect(parseOnePassMemory(longTail).story).toBe(story);
    expect(evaluateStoryResponseGuard(longTail, 50, "Mira listens.").needsCorrection).toBe(false);
  });

  it("fails an empty story before incrementing the turn", async () => {
    const adventure = fixture();
    await expect(runTurnPipeline({ adventure, text: "Mira listens.", sendChatCompletion: async () => ({ content: '<memory_updates>{"updates":[]}</memory_updates>' }) })).rejects.toThrow("no visible story");
    expect(adventure.activeState.turn).toBe(0);
  });
});

describe("background memory pass updates", () => {
  it("applies cards, thoughts, pressure and an auto-approved Story State grounded in the recent turns", () => {
    const adventure = fixture();
    adventure.memoryAutoApprove.storyStateUpdate = true;
    const state = "Day/Time: Monday night.\nLocation: Mira's tent.\nRelationships: Mira distrusts the duke.\nArrangements: none.\nHas met: the duke.\nOpen threads: the silver curse.";
    const next = apply(adventure, [
      update,
      { kind: "thought", target: "Mira", content: "I can finally stop fearing the next tribute demand.", evidence: "The duke has ended the tribute demand.", reason: "Changed belief" },
      { kind: "pressure", target: "Pressure", content: "The tribute obligation has ended.", evidence: "The duke has ended the tribute demand.", reason: "Resolved external obligation" },
      { kind: "state", target: "Story State", content: state, evidence: "The duke has ended the tribute demand.", reason: "Current truth" },
    ]).reduce(adventureReducer, adventure);
    expect(next.storyCards[0].content).toContain("scout");
    expect(next.storyCards[0].content).toContain("Silver");
    expect(Object.values(next.brains[0].thoughts)).toEqual(expect.arrayContaining(["I distrust the duke.", expect.stringContaining("stop fearing")]));
    expect(next.components.find(c => c.id === "pressure")?.content).toBe("The tribute obligation has ended.");
    // A full rewrite is stored with list lines as bullets and stable thread ids.
    expect(next.components.find(c => c.id === "state")?.content).toBe(state.replace("\nOpen threads: the silver curse.", ""));
    // Open threads are their own data; a full rewrite never carries them into the text.
    expect(next.components.find(c => c.id === "essentials")?.content).toBe(adventure.components[0].content);
    expect(next.activeState.memoryProposals.find(p => p.proposedType === "storyStateUpdate")?.status).toBe("approved");
  });

  it("routes Story State through Memory Suggestions by default and keeps only the newest pending rewrite", () => {
    const adventure = fixture();
    expect(adventure.memoryAutoApprove.storyStateUpdate).toBe(false);
    const stateUpdate = (content: string) => ({ kind: "state", target: "Story State", content, evidence: "The duke has ended the tribute demand.", reason: "Current truth" });
    let next = apply(adventure, [stateUpdate("Day/Time: Monday night.")]).reduce(adventureReducer, adventure);
    expect(next.components.find(c => c.id === "state")?.content).toBe("");
    expect(next.activeState.memoryProposals.filter(p => p.proposedType === "storyStateUpdate" && p.status === "pending")).toHaveLength(1);

    next = apply(next, [stateUpdate("Day/Time: Tuesday morning.")]).reduce(adventureReducer, next);
    const stateProposals = next.activeState.memoryProposals.filter(p => p.proposedType === "storyStateUpdate");
    expect(stateProposals.filter(p => p.status === "pending").map(p => p.content)).toEqual(["Day/Time: Tuesday morning."]);
    expect(stateProposals.find(p => p.content === "Day/Time: Monday night.")?.status).toBe("ignored");

    const pending = stateProposals.find(p => p.status === "pending")!;
    const approved = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: pending.id });
    expect(approved.components.find(c => c.id === "state")?.content).toBe("Day/Time: Tuesday morning.");
  });

  it("accepts evidence from any message in the pass window, not just the latest reply", () => {
    const adventure = fixture();
    const earlier = "Mira admits that the duke frightened her last winter.";
    const actions = apply(adventure, [
      { kind: "thought", target: "Mira", content: "I hated admitting the duke still frightens me.", evidence: "the duke frightened her last winter", reason: "Private admission" },
    ], [earlier, story]);
    expect(actions.map(a => a.type)).toContain("APPLY_BRAIN_UPDATE");
  });

  it("records a knowledge boundary as a replacement, never appended", () => {
    const adventure = fixture();
    adventure.brains[0].knowledge = "Knows: the duke demands tribute.\nDoes not know: the letter's contents.";
    const knows = { kind: "knows", target: "Mira", content: "Knows: the duke ended the tribute.\nDoes not know: who sent the silver.", evidence: "The duke has ended the tribute demand.", reason: "Learned from the letter" };
    const next = apply(adventure, [knows]).reduce(adventureReducer, adventure);
    expect(next.brains[0].knowledge).toBe(knows.content);
    expect(Object.keys(next.brains[0].thoughts)).toEqual(["old"]);
  });

  it("routes a knowledge boundary through review when brain auto-approval is off, and replaces it on approval", () => {
    const adventure = fixture();
    adventure.memoryAutoApprove.brainUpdate = false;
    adventure.brains[0].knowledge = "Knows: old.";
    const knows = { kind: "knows", target: "Mira", content: "Knows: the duke ended the tribute.\nDoes not know: who sent the silver.", evidence: "The duke has ended the tribute demand.", reason: "Learned" };
    const pending = apply(adventure, [knows]).reduce(adventureReducer, adventure);
    const proposal = pending.activeState.memoryProposals[0];
    expect(proposal).toMatchObject({ proposedType: "brainUpdate", status: "pending" });
    const approved = adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.brains[0].knowledge).toBe(knows.content);
  });

  it("supersedes an outdated fact on a living card instead of keeping both", () => {
    const adventure = fixture();
    adventure.storyCards.push(makeStoryCard({
      id: "bond", title: "Mira and the Duke", type: "custom", memoryMode: "living", pinned: true,
      content: "• Mira sleeps in the guest tent.\n• Mira owes the duke tribute.\n\nVOICE CONTRACT\nRhythm: clipped.",
    }));
    const supersede = { kind: "card", target: "Mira and the Duke", content: "Mira no longer owes the duke tribute.", replaces: "Mira owes the duke tribute.", evidence: "The duke has ended the tribute demand.", reason: "Obligation ended" };
    const next = apply(adventure, [supersede]).reduce(adventureReducer, adventure);
    const card = next.storyCards.find(c => c.id === "bond")!;
    expect(card.content).toContain("Mira no longer owes the duke tribute.");
    expect(card.content).not.toContain("• Mira owes the duke tribute.");
    expect(card.content).toContain("Mira sleeps in the guest tent.");
    expect(card.content).toContain("VOICE CONTRACT");
  });

  it("refuses to supersede voice-contract lines, missing facts, or static cards", () => {
    const card = { content: "• Fact one is here.\nVOICE CONTRACT\nRhythm: clipped and dry." };
    expect(supersedeCardFact(card, "Rhythm: clipped and dry.", "Rhythm: warm.")).toBeUndefined();
    expect(supersedeCardFact(card, "A fact that is not present", "x")).toBeUndefined();
    const adventure = fixture();
    const actions = apply(adventure, [{ ...update, replaces: "Mira is a scout." }]);
    expect(actions.map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
  });

  it.each([
    { ...update, evidence: "Mira is immortal and rules the world." },
    { ...update, target: "Missing person" },
    { ...update, kind: "currentArc" },
    { ...update, kind: "providerConfig" },
    { ...update, kind: "thought", target: "Absent NPC" },
    { ...update, content: "fact ".repeat(71) },
    { ...update, kind: "knows", target: "Mira", content: "Mira knows about silver." },
    { ...update, kind: "state", target: "Not the state", content: "Day/Time: now." },
  ])("rejects ungrounded, oversized or unauthorized updates: $kind / $target", u => {
    const adventure = fixture();
    const actions = apply(adventure, [u]);
    expect(actions.map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
  });

  it("does not accept updates to a card the pass was not shown", () => {
    const adventure = fixture();
    adventure.storyCards[0].pinned = false;
    adventure.storyCards[0].inclusionPolicy = "manual";
    expect(apply(adventure, [update]).map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
  });

  it("does not write Story State when the player turned its auto-update off", () => {
    const adventure = fixture();
    adventure.components[2].autoUpdate = false;
    const actions = apply(adventure, [{ kind: "state", target: "Story State", content: "Day/Time: now.", evidence: "The duke has ended the tribute demand.", reason: "x" }]);
    expect(actions.map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
  });

  it("requires review of Plot Essentials even with auto-approve enabled", () => {
    const adventure = fixture();
    const next = apply(adventure, [
      { ...update, kind: "essentials", target: "Foundations", content: "The exiles now defend their permanent home." },
    ]).reduce(adventureReducer, adventure);
    expect(next.components).toEqual(adventure.components);
    expect(next.activeState.memoryProposals).toHaveLength(1);
    expect(next.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true });
  });

  it("lets the Story Cards toggle govern plot and protected cards", () => {
    const adventure = fixture();
    adventure.storyCards[0].protected = true;
    const newPlot = { ...update, kind: "newCard", target: "Silver Curse", content: "The silver curse threatens every exile.", cardType: "plot", category: "plot_beat", triggers: ["silver curse"], memoryMode: "living" };
    const on = apply(adventure, [update, newPlot]).reduce(adventureReducer, adventure);
    expect(on.activeState.memoryProposals.every(p => !p.requiresReview && p.status === "approved")).toBe(true);
    expect(on.storyCards.some(c => c.title === "Silver Curse")).toBe(true);
    expect(on.storyCards[0].content).not.toEqual(adventure.storyCards[0].content);

    const off = { ...adventure, memoryAutoApprove: { ...adventure.memoryAutoApprove, storyCard: false } };
    const held = apply(off, [update, newPlot]).reduce(adventureReducer, off);
    expect(held.storyCards).toEqual(off.storyCards);
    expect(held.activeState.memoryProposals.every(p => p.status === "pending")).toBe(true);
  });

  it("drops first-person recall triggers from new cards", () => {
    const adventure = fixture();
    const recallOnly = { ...update, kind: "newCard", target: "Silver Burns", cardType: "lore", category: "world_fact", triggers: ["the night I found the silver", "when she touched silver"] };
    expect(apply(adventure, [recallOnly]).map(a => a.type)).toEqual(["LOG_EVALUATION_RESULT"]);
    const mixed = { ...recallOnly, triggers: ["the night I found the silver", "silver burn"] };
    const next = apply(adventure, [mixed]).reduce(adventureReducer, adventure);
    const proposalOrCard = next.activeState.memoryProposals.find(p => p.title === "Silver Burns");
    expect(proposalOrCard?.suggestedTriggers).toEqual(["silver burn"]);
  });

  it("does not create more than one new recurring subject per pass", () => {
    const adventure = fixture();
    const newCard = { ...update, kind: "newCard", target: "Silver", cardType: "lore", category: "world_fact", triggers: ["silver burn"] };
    const actions = apply(adventure, [newCard, { ...newCard, target: "Metal" }, { ...newCard, target: "Letter arrival", cardType: "event" }]);
    expect(actions.filter(a => a.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(1);
  });

  it("honors component opt-out, Story Cards auto-approve off, and brain cooldowns", () => {
    const adventure = fixture();
    adventure.components[1].autoUpdate = false;
    adventure.memoryAutoApprove = { ...adventure.memoryAutoApprove, storyCard: false };
    adventure.brains[0].lastUpdatedTurn = 0;
    adventure.brains[0].autoUpdateCooldownTurns = 3;
    const next = apply(adventure, [
      update,
      { ...update, kind: "thought", content: "I fear silver." },
      { ...update, kind: "pressure", target: "Pressure", content: "The tribute obligation has ended." },
    ]).reduce(adventureReducer, adventure);
    expect(next.brains).toEqual(adventure.brains);
    expect(next.components).toEqual(adventure.components);
    expect(next.storyCards).toEqual(adventure.storyCards);
    expect(next.activeState.memoryProposals).toHaveLength(1);
    expect(next.activeState.memoryProposals[0]).toMatchObject({ status: "pending" });
  });

  it("keeps the pass rules free of per-turn data so providers can cache them", () => {
    expect(memoryPassRules(["world_fact"])).toBe(memoryPassRules(["world_fact"]));
    expect(memoryPassRules(["world_fact"])).not.toMatch(/Mira|turn \d/);
  });
});
