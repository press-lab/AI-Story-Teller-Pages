import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { getAdventure, saveAdventure } from "../db/adventureDb";
import { runCompactMemoryFallback } from "../memory/compactMemoryFallback";
import { applyAIMemoryUpdate } from "../memory/applyAIMemoryUpdate";
import { boundMemoryEnvelope } from "../memory/onePassMemory";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import { MAX_ACTIVE_PLOTS, selectedWorldPlots } from "../memory/worldEvolution";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import type { Adventure, PlotEvent, PlotThread, WorldChange } from "../types/adventure";
import { adventureReducer } from "./adventureReducer";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard, normalizeAdventure } from "./defaults";
import { reduceActions, runTurnPipeline } from "./turnPipeline";

vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));

function sandbox() {
  const a = createDefaultAdventure("Kingdom sandbox");
  a.storyCards = [makeStoryCard({ id: "marcus", title: "Marcus", type: "character", content: "Marcus is loyal to the king.", keys: ["Marcus"], pinned: true })];
  a.memoryAutoApprove.storyCard = true;
  a.worldEvolutionSettings!.betrayal = "unrestricted";
  return a;
}
const allegiance = "Marcus publicly renounces the king and joins the rebellion.";
function change(a: Adventure, overrides: Partial<WorldChange> = {}): WorldChange {
  return { owner: "storyCard", targetId: "marcus", operation: "supersede", expectedRevision: a.storyCards[0].updatedAt,
    previous: "Marcus is loyal to the king.", content: "Marcus supports the rebellion.", evidence: allegiance,
    reason: "Established change of allegiance", requiresReview: true, certainty: "confirmed", effects: ["betrayal"], autonomous: true, offscreen: false, ...overrides };
}
const premise = "Expose the conspiracy against the king.";
const origin = "Marcus discovers a conspiracy against the king and begins gathering evidence.";
function newPlot(id = "conspiracy") { return { id, title: "Royal conspiracy", objective: premise, participants: ["marcus"], evidence: origin, autonomous: true, offscreen: false }; }
function event(a: Adventure, story: string, overrides: Partial<PlotEvent> = {}): Partial<PlotEvent> {
  const t = a.worldEvolutionState!.threads[0];
  return { targetId: t?.id ?? "conspiracy", objective: t?.objective ?? premise, expectedRevision: t?.revision ?? 0,
    kind: "progress", evidence: story, outcome: story, certainty: "confirmed", autonomous: false, offscreen: false, ...overrides };
}
async function turn(a: Adventure, story: string, records: Record<string, unknown> = {}, tail?: string) {
  const send = vi.fn(async () => ({ content: story + (tail ?? "\n<memory_updates>" + JSON.stringify({ updates: [], ...records }) + "</memory_updates>") }));
  const result = await runTurnPipeline({ adventure: a, text: "Marcus considers what happened.", sendChatCompletion: send });
  expect(send).toHaveBeenCalledTimes(1);
  await saveAdventure(result.adventure);
  return (await getAdventure(a.id))!;
}
function approve(a: Adventure) {
  const p = a.activeState.memoryProposals.find(p => p.status === "pending")!;
  expect(p).toBeDefined();
  return adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
}

describe("world evolution through narration, persistence and next context", () => {
  it("preserves complete ordinary records from a malformed tail and keeps narration intact", async () => {
    const a = sandbox(); a.brains = [makeBrain({ id: "brain", characterName: "Marcus", thoughts: { old: "I await the news." }, pinned: true })];
    a.memoryAutoApprove.brainUpdate = true;
    const story = "Marcus reads the verified report and notices a new lead.";
    const u = { kind: "thought", target: "Marcus", content: "I need to investigate this lead myself.", evidence: story, reason: "New private plan", effects: [] };
    const next = await turn(a, story, {}, '\n<memory_updates>{"updates":[' + JSON.stringify(u) + '],"worldChanges":[{"content":"cut');
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("investigate this lead");
    expect(next.messages.at(-1)?.content).toBe(story);
    expect(next.worldEvolutionState!.issues.at(-1)?.status).toBe("unrecorded");
  });
  it("enforces shared serialized and estimated-token bounds while preserving complete candidates", () => {
    const a = sandbox();
    const records = Array.from({ length: 8 }, () => change(a, { content: "a ".repeat(380), previous: "a ".repeat(380), evidence: "a ".repeat(380) }));
    const result = boundMemoryEnvelope({ updates: [], worldChanges: records }, true);
    const { error, ...envelope } = result;
    expect(error).toContain("oversized");
    expect(JSON.stringify(envelope).length).toBeLessThanOrEqual(4800);
    expect(approximateTokenCount(JSON.stringify(envelope))).toBeLessThanOrEqual(1200);
    expect(result.worldChanges!.length).toBeLessThanOrEqual(4);
  });
  it("keeps quiet sandbox turns quiet and uses one request with or without World Evolution", async () => {
    for (const enabled of [false, true]) {
      let a = sandbox(); a.worldEvolutionSettings!.enabled = enabled;
      for (let i = 0; i < 3; i++) a = await turn(a, "Marcus drinks his tea and watches the peaceful garden.");
      expect(a.worldEvolutionState!.threads).toEqual([]);
      expect(a.worldEvolutionState!.history).toEqual([]);
      expect(a.storyCards[0].content).toBe("Marcus is loyal to the king.");
    }
  });
  it("bootstraps a consequential plot without an arc and persists it into the next turn", async () => {
    const a = await turn(sandbox(), origin, { newPlots: [newPlot()] });
    expect(a.components.some(c => c.type === "currentArc")).toBe(false);
    expect(a.worldEvolutionState!.threads[0].objective).toBe(premise);
    expect(buildContext(a).messages.map(m => m.content).join("\n")).toContain(premise);
  });
  it("respects New Plot Generation Off", async () => {
    const a = sandbox(); a.worldEvolutionSettings!.newPlotGeneration = "off";
    const next = await turn(a, origin, { newPlots: [newPlot()] });
    expect(next.worldEvolutionState!.threads).toEqual([]);
    expect(next.worldEvolutionState!.issues[0].status).toBe("unrecorded");
  });
  it("escalates only on established events and leaves partial victories unresolved", async () => {
    let a = await turn(sandbox(), origin, { newPlots: [newPlot()] });
    const story = "Marcus arrests one suspect; the conspiracy leaders remain unknown.";
    a = await turn(a, story, { plotEvents: [event(a, story, { resolution: { verdict: "partial", centralObjective: false, remainingObstacles: ["Unknown leaders"], closureEvidence: story } })] });
    expect(a.worldEvolutionState!.threads[0]).toMatchObject({ phase: "escalate", revision: 1 });
    a = await turn(a, story, { plotEvents: [event(a, story, { kind: "resolved", resolution: { verdict: "victory", centralObjective: true, remainingObstacles: [], closureEvidence: story } })] });
    expect(a.worldEvolutionState!.threads[0].outcome).toBeUndefined();
    expect(a.worldEvolutionState!.issues.at(-1)?.reason).toContain("closure");
  });
  it("never synthesizes missing terminal classification, objective, certainty or revision", async () => {
    const a = await turn(sandbox(), origin, { newPlots: [newPlot()] });
    const story = "Marcus exposed the entire conspiracy and permanently ended its threat.";
    for (const omitted of ["resolution", "objective", "expectedRevision", "certainty"]) {
      const e = event(a, story, { kind: "resolved", resolution: { verdict: "victory", centralObjective: true, remainingObstacles: [], closureEvidence: story } }) as Record<string, unknown>;
      delete e[omitted];
      const next = await turn(a, story, { plotEvents: [e] });
      expect(next.worldEvolutionState!.threads[0].outcome).toBeUndefined();
    }
  });
  it.each(["resolved", "failed", "abandoned"] as const)("persists %s as archived history and never reopens or creates a successor", async kind => {
    let a = await turn(sandbox(), origin, { newPlots: [newPlot()] });
    const story = kind === "resolved" ? "Marcus exposed the entire conspiracy and permanently ended its threat." : kind === "failed" ? "The conspiracy permanently destroyed the kingdom; its objective is definitively failed." : "Marcus permanently abandons the conspiracy investigation and renounces that objective.";
    a = await turn(a, story, { plotEvents: [event(a, story, { kind, resolution: { verdict: kind === "resolved" ? "victory" : kind === "failed" ? "failure" : "abandonment", centralObjective: true, remainingObstacles: [], closureEvidence: story } })] });
    expect(a.worldEvolutionState!.threads).toHaveLength(0);
    expect(a.worldEvolutionState!.archivedThreads![0].outcome).toBe(story);
    a = await turn(a, "Marcus recalls the conspiracy and enjoys a peaceful evening.");
    const context = buildContext(a, { currentInput: "Recall the conspiracy." });
    expect(context.sections.find(s => s.id === "currentArc")!.items.map(i => i.content).join("\n")).toContain("Concluded");
    expect(a.worldEvolutionState!.threads).toHaveLength(0);
  });
  it("approves betrayal as targeted current truth, archives loyalty and persists undo without erasing later edits", async () => {
    let a = sandbox(); a.storyCards[0].currentFacts = ["Marcus is loyal to the king.", "Marcus speaks French."];
    a.storyCards[0].recentDevelopments = ["Marcus bought a horse."];
    a = await turn(a, allegiance, { worldChanges: [change(a)] });
    expect(a.storyCards[0].content).toContain("loyal");
    a = approve(a); await saveAdventure(a); a = (await getAdventure(a.id))!;
    expect(a.storyCards[0].currentFacts).toContain("Marcus supports the rebellion.");
    expect(a.storyCards[0].recentDevelopments).toContain("Marcus bought a horse.");
    expect(a.storyCards[0].archivedFacts).toContain("loyal to the king");
    const current = buildContext(a, { currentInput: "Marcus" }).sections.find(s => s.id === "storyCards")!.items[0].content;
    expect(current).toContain("supports the rebellion");
    expect(current).not.toContain("Marcus is loyal to the king.");
    a = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: "marcus", patch: { content: a.storyCards[0].content + "\nMarcus owns a horse.", keys: ["Marcus", "horse"] } });
    a = adventureReducer(a, { type: "ROLLBACK_WORLD_CHANGE", historyId: a.worldEvolutionState!.history[0].id });
    await saveAdventure(a); a = (await getAdventure(a.id))!;
    expect(a.storyCards[0].content).toContain("Marcus is loyal to the king.");
    expect(a.storyCards[0].content).toContain("Marcus owns a horse.");
    expect(a.storyCards[0].keys).toContain("horse");
  });
  it("updates canon that exists only in structured currentFacts", async () => {
    let a = sandbox(); a.storyCards[0].content = "Marcus speaks French."; a.storyCards[0].currentFacts = ["Marcus is loyal to the king."];
    a = approve(await turn(a, allegiance, { worldChanges: [change(a)] }));
    expect(a.storyCards[0].content).toBe("Marcus speaks French.");
    expect(a.storyCards[0].currentFacts).toEqual(["Marcus supports the rebellion."]);
  });
  it.each(["scenario", "character", "identity"] as const)("blocks %s protection across world changes and legacy writes", async gate => {
    const a = sandbox();
    if (gate === "scenario") a.worldEvolutionSettings!.betrayal = "off";
    else a.storyCards[0].evolutionProtection = { betrayal: gate === "character", identity: gate === "identity" };
    let next = await turn(a, allegiance, { worldChanges: [change(a)] });
    expect(next.activeState.memoryProposals).toHaveLength(0);
    next = reduceActions(next, applyAIMemoryUpdate(next, [{ type: "storyCardUpdate", storyCardId: "marcus", content: "Marcus now supports the rebellion.", semanticEffects: [gate === "identity" ? "identity" : "betrayal"] }]).actions);
    expect(next.storyCards[0].content).toBe("Marcus is loyal to the king.");
  });
  it("requires motivation for earned betrayal and redemption, while anger alone is ordinary", async () => {
    let a = sandbox(); a.worldEvolutionSettings!.betrayal = "earned";
    a = await turn(a, allegiance, { worldChanges: [change(a)] });
    expect(a.activeState.memoryProposals).toHaveLength(0);
    a = await turn(a, "Marcus resents the king because the king imprisoned his family.");
    const motivation = "Marcus resents the king because the king imprisoned his family.";
    a = approve(await turn(a, allegiance, { worldChanges: [change(a, { motivationEvidence: motivation })] }));
    expect(a.storyCards[0].content).toContain("rebellion");
    const redemption = "Marcus renounces cruelty after realizing the suffering he caused.";
    a.worldEvolutionSettings!.redemption = "earned";
    a = approve(await turn(a, redemption, { worldChanges: [change(a, { operation: "supersede", previous: "Marcus supports the rebellion.", content: "Marcus supports the rebellion and commits to mercy.", evidence: redemption, effects: ["redemption"], motivationEvidence: redemption })] }));
    expect(a.storyCards[0].content).toContain("mercy");
    const boundary = applyAIMemoryUpdate(a, [{ type: "storyCardUpdate", storyCardId: "marcus", content: a.storyCards[0].content + " Marcus is angry today.", semanticEffects: [] }]);
    expect(boundary.rejectedUpdates).toEqual([]);
  });
  it("requires review of missing semantics and reinterpretation, revalidates stale approvals, and cannot spoof a protected owner", async () => {
    let a = sandbox();
    a = reduceActions(a, applyAIMemoryUpdate(a, [{ type: "storyCardUpdate", storyCardId: "marcus", content: "Marcus has switched sides." }]).actions);
    expect(a.activeState.memoryProposals[0].status).toBe("pending");
    expect(approve(a).storyCards[0].content).toContain("loyal");
    a = sandbox(); a.worldEvolutionSettings!.canonReinterpretation = "review";
    a = await turn(a, allegiance, { worldChanges: [change(a, { effects: ["reinterpretation"] })] });
    expect(a.storyCards[0].content).toContain("loyal");
    a = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: "marcus", patch: { content: "Marcus has retired." } });
    expect(approve(a).storyCards[0].content).toBe("Marcus has retired.");
    a = sandbox(); a.storyCards[0].evolutionProtection = { betrayal: true, identity: false };
    const next = await turn(a, allegiance, { worldChanges: [change(a, { characterId: "unprotected-npc" })] });
    expect(next.activeState.memoryProposals).toHaveLength(0);
  });
  it("keeps Brain perspective distinct from profiles and requires a knowledge path", async () => {
    let a = sandbox(); a.brains = [makeBrain({ id: "brain", characterName: "Marcus", linkedStoryCardId: "marcus", currentState: "Uneasy", pinned: true })];
    const story = "Marcus heard the king confess and realizes he is in danger.";
    const c = change(a, { owner: "brain", targetId: "brain", expectedRevision: a.brains[0].updatedAt, field: "currentState", previous: "Uneasy", operation: "replace", content: "Afraid of the king's reprisal", effects: [], evidence: story, knowledgeEvidence: story });
    a = approve(await turn(a, story, { worldChanges: [c] }));
    expect(a.brains[0].currentState).toContain("Afraid");
    expect(a.storyCards[0].content).toContain("loyal");
    expect(buildContext(a, { currentInput: "Marcus" }).sections.find(s => s.id === "brains")!.items[0].content).toContain("Afraid");
    const invalid = change(a, { owner: "brain", targetId: "brain", field: "notes", expectedRevision: a.brains[0].updatedAt, previous: "", operation: "append", content: "Marcus is loyal to the rebellion.", effects: ["development"], evidence: story, knowledgeEvidence: story });
    expect((await turn(a, story, { worldChanges: [invalid] })).activeState.memoryProposals.filter(p => p.status === "pending")).toHaveLength(0);
  });
  it("reviews Plot Essentials and preserves its change across export/import", async () => {
    let a = sandbox(); a.components = [makeComponent({ id: "pe", type: "plotEssentials", title: "Premise", content: "The kingdom is at peace." })];
    const story = "The rebellion declares war and the kingdom is now at war.";
    a = approve(await turn(a, story, { worldChanges: [change(a, { owner: "plotEssentials", targetId: "pe", expectedRevision: a.components[0].updatedAt, operation: "supersede", previous: "The kingdom is at peace.", content: "The kingdom is at war.", effects: [], evidence: story, autonomous: false })] }));
    a = normalizeAdventure(JSON.parse(JSON.stringify(a)) as Adventure);
    expect(buildContext(a).messages.map(m => m.content).join("\n")).toContain("The kingdom is at war.");
  });
  it("persists permitted offscreen consequences and rejects disabled ones", async () => {
    for (const enabled of [true, false]) {
      const a = sandbox(); a.worldEvolutionSettings!.offscreenEvents = enabled;
      const story = "Meanwhile, Marcus publicly renounces the king and joins the rebellion.";
      const next = await turn(a, story, { worldChanges: [change(a, { evidence: story, offscreen: true })] });
      if (enabled) expect(approve(next).storyCards[0].content).toContain("rebellion");
      else expect(next.activeState.memoryProposals).toHaveLength(0);
    }
  });
  it("does not revive superseded loyalty through legacy append memory", async () => {
    let a = sandbox();
    a = approve(await turn(a, allegiance, { worldChanges: [change(a)] }));
    a = await turn(a, "Marcus is loyal to the king.", { updates: [{ kind: "card", target: "Marcus", content: "Marcus is loyal to the king.", evidence: "Marcus is loyal to the king.", reason: "Allegiance", effects: [] }] });
    expect(a.storyCards[0].content).not.toContain("loyal to the king");
    expect(a.worldEvolutionState!.history[0].change.previous).toBe("Marcus is loyal to the king.");
    expect(a.activeState.memoryProposals.filter(p => p.status === "pending")).toEqual([]);
  });
  it("preserves complete truncated records, rejects cut-off ones, and recovers missing output with one compact call", async () => {
    let a = sandbox();
    a = await turn(a, origin, {}, '\n<memory_updates>{"updates":[],"newPlots":[' + JSON.stringify(newPlot()) + ',{"id":"cut');
    expect(a.worldEvolutionState!.threads).toHaveLength(1);
    expect(a.worldEvolutionState!.issues[0].status).toBe("unrecorded");
    a = await turn(sandbox(), origin, {}, "");
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: JSON.stringify({ updates: [], newPlots: [newPlot()] }), raw: {} });
    const recovered = await runCompactMemoryFallback(a, { ...defaultModelConfig, apiKey: "mock" });
    expect(recovered.valid).toBe(true);
    a = reduceActions(a, recovered.actions);
    expect(a.worldEvolutionState!.threads).toHaveLength(1);
    expect(a.worldEvolutionState!.issues[0].status).toBe("recovered");
    vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValueOnce({ content: "broken JSON", raw: {} });
    const failed = await runCompactMemoryFallback(a, { ...defaultModelConfig, apiKey: "mock" });
    expect(failed.valid).toBe(false);
    expect(failed.actions).toEqual([]);
  });
  it("never applies a discarded draft's ordinary or world records", async () => {
    const a = sandbox();
    const result = await runTurnPipeline({ adventure: a, text: "Marcus", sendChatCompletion: async () => ({ content: allegiance + '\n<memory_updates>' + JSON.stringify({ updates: [{ kind: "card", target: "Marcus", content: "Marcus has a secret alliance.", evidence: allegiance, reason: "Permanent", effects: ["betrayal"] }], worldChanges: [change(a)] }) + '</memory_updates>', memoryDiscardReason: "Draft discarded" }) });
    expect(result.adventure.storyCards[0].content).toBe(a.storyCards[0].content);
    expect(result.adventure.activeState.memoryProposals).toHaveLength(0);
    expect(result.adventure.worldEvolutionState!.issues[0].status).toBe("unrecorded");
  });
  it("bounds plot selection, retrieves relevant old history and enforces active capacity", async () => {
    const a = sandbox();
    const t = (id: string, outcome?: string): PlotThread => ({ id, title: id, objective: `Investigate ${id}`, participants: ["marcus"], originEvidence: origin, sourceTurnId: "origin", phase: outcome ? "aftermath" : "simmer", revision: 0, events: [], outcome });
    a.worldEvolutionState!.threads = Array.from({ length: MAX_ACTIVE_PLOTS }, (_, i) => t(`Conflict${i}`));
    a.worldEvolutionState!.archivedThreads = Array.from({ length: 200 }, (_, i) => t(`History${i}`, `History${i} ended.`));
    const selected = selectedWorldPlots(a, "Investigate Conflict11 and recall History199");
    expect(selected.some(p => p.id === "Conflict11")).toBe(true);
    expect(selected.some(p => p.id === "History199")).toBe(true);
    expect(selected.length).toBeLessThanOrEqual(6);
    const next = await turn(a, origin, { newPlots: [newPlot()] });
    expect(next.worldEvolutionState!.threads).toHaveLength(MAX_ACTIVE_PLOTS);
    expect(next.worldEvolutionState!.archivedThreads).toHaveLength(200);
  });
  it("normalizes old saves to legacy mode", async () => {
    let a = sandbox(); delete a.worldEvolutionSettings; a = normalizeAdventure(a);
    expect(a.worldEvolutionSettings!.enabled).toBe(false);
    const next = await turn(a, origin, { newPlots: [newPlot()] });
    expect(next.worldEvolutionState!.threads).toHaveLength(0);
  });
  it("blocks automatic relationship transitions when Off while preserving manual edits and history", async () => {
    let a = sandbox();
    a.brains = [makeBrain({ id: "brain", characterName: "Marcus", linkedStoryCardId: "marcus", pinned: true, thoughts: { old: "I value Alex's friendship." } })];
    a.storyCards.push(makeStoryCard({ id: "alex", title: "Alex", type: "character", content: "Alex is a friend.", pinned: true }));
    const initial = { bond: "friends", status: "close", dimensions: { trust: "guarded" } };
    a = adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "brain", focusStoryCardId: "alex", state: initial });
    const r = a.brains[0].relationships[0];
    a.worldEvolutionSettings!.relationshipEvolution = false;
    const story = "Marcus sees Alex return the keepsake and thanks Alex for keeping the promise.";
    a = await turn(a, story, { updates: [{ kind: "relationshipChange", effects: [], target: "brain", relationshipId: r.id, focus: "Alex", focusStoryCardId: "alex", revision: r.revision, proposed: { ...initial, dimensions: { trust: "growing" } }, evidence: story, knowledgeEvidence: story, reason: "Observed care" }] });
    expect(a.brains[0].relationships[0].current).toEqual(initial);
    a = adventureReducer(a, { type: "EDIT_RELATIONSHIP", brainId: "brain", relationshipId: r.id, state: { ...initial, dimensions: { trust: "growing" } } });
    await saveAdventure(a); a = (await getAdventure(a.id))!;
    expect(a.brains[0].relationships[0].revision).toBe(1);
    expect(a.brains[0].relationships[0].history).toHaveLength(2);
  });
});
