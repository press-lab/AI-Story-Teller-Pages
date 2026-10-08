import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { getAdventure, saveAdventure } from "../db/adventureDb";
import { worldPresetName, worldPresets } from "../memory/worldPresets";
import { selectedWorldTargets, worldEvolutionInstruction } from "../memory/worldEvolution";
import { relationshipItemId } from "../memory/relationships";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import type { Adventure, WorldChange } from "../types/adventure";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { adventureReducer } from "./adventureReducer";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, normalizeAdventure } from "./defaults";
import { runTurnPipeline } from "./turnPipeline";

const initial = { bond: "friends", status: "friendly", dimensions: { trust: "guarded" } };
const proposed = { ...initial, dimensions: { trust: "growing" } };
const story = "Marcus watches Seth return the stolen keepsake. Marcus thanks Seth for keeping his promise.";
function fixture() {
  let a = createDefaultAdventure("Separate systems");
  a.storyCards = [makeStoryCard({ id: "marcus", title: "Marcus", type: "character", content: "Marcus is loyal to the king.", keys: ["Marcus"], pinned: true }), makeStoryCard({ id: "seth", title: "Seth", type: "character", content: "Seth is the player.", keys: ["Seth"], pinned: true })];
  a.brains = [makeBrain({ id: "brain", characterName: "Marcus", linkedStoryCardId: "marcus", pinned: true, thoughts: { old: "I await news." } })];
  a.components.push(makeComponent({ id: "pe", type: "plotEssentials", title: "Kingdom", content: "The king rules the kingdom." }));
  a.memoryAutoApprove.brainUpdate = true;
  a = adventureReducer(a, { type: "ENROLL_RELATIONSHIP", brainId: "brain", focusStoryCardId: "seth", state: initial });
  return a;
}
function relationship(a: Adventure) {
  return { kind: "relationshipChange", effects: [], target: "brain", relationshipId: a.brains[0].relationships[0].id, focus: "Seth", focusStoryCardId: "seth", revision: a.brains[0].relationships[0].revision, proposed, evidence: "Marcus thanks Seth for keeping his promise.", knowledgeEvidence: "Marcus watches Seth return the stolen keepsake.", reason: "Observed promise keeping" };
}
const thought = { kind: "thought", target: "Marcus", content: "I am grateful that Seth kept his promise.", evidence: "Marcus thanks Seth for keeping his promise.", reason: "Private reaction", effects: [] };
async function turn(a: Adventure, text: string, records: Record<string, unknown> = {}) {
  const send = vi.fn(async () => ({ content: text + "\n<memory_updates>" + JSON.stringify({ updates: [], ...records }) + "</memory_updates>" }));
  const result = await runTurnPipeline({ adventure: a, text: "Marcus and Seth discuss the conspiracy.", sendChatCompletion: send });
  expect(send).toHaveBeenCalledTimes(1);
  await saveAdventure(result.adventure);
  return (await getAdventure(a.id))!;
}
function approve(a: Adventure, type: string) {
  const p = a.activeState.memoryProposals.find(p => p.status === "pending" && p.proposedType === type);
  expect(p).toBeDefined();
  return adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p!.id });
}
function canon(a: Adventure, overrides: Partial<WorldChange> = {}): WorldChange {
  return { owner: "storyCard", targetId: "marcus", expectedRevision: a.storyCards[0].updatedAt, previous: "Marcus is loyal to the king.", operation: "supersede", content: "Marcus supports the rebellion.", evidence: "Marcus publicly betrays the king and joins the rebellion.", reason: "Established allegiance", certainty: "confirmed", requiresReview: true, effects: ["betrayal"], autonomous: true, offscreen: false, ...overrides };
}
describe("scenario permissions with independent owners", () => {
  it("persists two independent scenarios, exports/imports and duplicates their actual settings", async () => {
    const a = adventureReducer(fixture(), { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: worldPresets["Quiet Sandbox"] });
    const b = adventureReducer(fixture(), { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: worldPresets["Unpredictable World"] });
    await saveAdventure(a); await saveAdventure(b);
    const loadedA = (await getAdventure(a.id))!, loadedB = (await getAdventure(b.id))!;
    expect(worldPresetName(loadedA.worldEvolutionSettings!)).toBe("Quiet Sandbox");
    expect(worldPresetName(loadedB.worldEvolutionSettings!)).toBe("Unpredictable World");
    const copy = importAdventureJson(exportAdventureJson(loadedB), true);
    expect(copy.id).not.toBe(b.id);
    expect(copy.worldEvolutionSettings).toEqual(b.worldEvolutionSettings);
    const edited = adventureReducer(copy, { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: { redemption: "off" } });
    await saveAdventure(edited);
    expect(worldPresetName(edited.worldEvolutionSettings!)).toBe("Custom");
    expect((await getAdventure(b.id))!.worldEvolutionSettings).toEqual(b.worldEvolutionSettings);
    expect(importAdventureJson(exportAdventureJson(a)).worldEvolutionSettings).toEqual(a.worldEvolutionSettings);
  });
  it("keeps old saves disabled and never enables the master switch through an individual edit", () => {
    const old = fixture(); delete old.worldEvolutionSettings;
    const a = normalizeAdventure(old);
    expect(a.worldEvolutionSettings!.enabled).toBe(false);
    const edited = adventureReducer(a, { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: worldPresets["Living World"] });
    expect(edited.worldEvolutionSettings!.enabled).toBe(false);
    expect(worldEvolutionInstruction(edited, new Set(["marcus"]))).toBe("");
    expect(worldPresetName(createDefaultAdventure("New").worldEvolutionSettings!)).toBe("Living World");
  });
  it.each(Object.keys(worldPresets))("%s uses one routine request and bounded context/output", async preset => {
    let a = adventureReducer(fixture(), { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: worldPresets[preset] });
    a = await turn(a, story, { updates: [thought, relationship(a)] });
    expect(Object.values(a.brains[0].thoughts).join(" ")).toContain("grateful");
    expect(a.activeState.memoryProposals.some(p => p.proposedType === "relationshipUpdate")).toBe(preset !== "Quiet Sandbox");
    const context = buildContext(a, { currentInput: "Marcus and Seth" });
    expect(context.totalEstimatedTokens).toBeLessThanOrEqual(a.tokenBudgetSettings.maxContextTokens);
    expect(approximateTokenCount(worldEvolutionInstruction(a, new Set(["brain", "marcus", "seth"])))).toBeLessThan(1000);
  });
  it("relationship Off blocks automatic capture and pending approval but leaves manual state/history and thoughts", async () => {
    let a = fixture(); a = await turn(a, story, { updates: [relationship(a)] });
    const p = a.activeState.memoryProposals.find(p => p.proposedType === "relationshipUpdate")!;
    expect(p).toBeDefined();
    a = adventureReducer(a, { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: { relationshipEvolution: false } });
    expect(adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id }).brains[0].relationships[0].current).toEqual(initial);
    a = await turn(a, story, { updates: [relationship(a), thought] });
    expect(a.activeState.memoryProposals.filter(p => p.proposedType === "relationshipUpdate")).toHaveLength(1);
    expect(Object.values(a.brains[0].thoughts).join(" ")).toContain("grateful");
    a = adventureReducer(a, { type: "EDIT_RELATIONSHIP", brainId: "brain", relationshipId: a.brains[0].relationships[0].id, state: proposed });
    await saveAdventure(a); a = (await getAdventure(a.id))!;
    expect(a.brains[0].relationships[0].current).toEqual(proposed);
    expect(a.brains[0].relationships[0].history).toHaveLength(2);
    expect(a.storyCards[0].content).toBe("Marcus is loyal to the king.");
  });
  it("development Off allows relationship review and temporary thoughts through independent Brain routes", async () => {
    let a = fixture(); a.worldEvolutionSettings!.characterDevelopment = false;
    a = await turn(a, story, { updates: [relationship(a), thought] });
    a = approve(a, "relationshipUpdate");
    expect(a.brains[0].relationships[0].current).toEqual(proposed);
    expect(Object.values(a.brains[0].thoughts).join(" ")).toContain("grateful");
    expect(a.storyCards[0].content).not.toContain("trust");
    expect(a.worldEvolutionState!.history).toEqual([]);
    const context = buildContext(a, { currentInput: "Marcus and Seth" });
    expect(context.sections.flatMap(s => s.items).find(i => i.id === relationshipItemId("brain", a.brains[0].relationships[0].id))!.content).toContain("growing");
    expect(context.sections.flatMap(s => s.items).find(i => i.id === "brain")!.content).toContain("grateful");
  });
  it("development Off rejects autonomous durable changes while preserving evidenced reactive canon capture", async () => {
    let a = fixture(); a.worldEvolutionSettings!.characterDevelopment = false;
    const text = "Marcus promises to protect the village for the rest of his life.";
    const c = canon(a, { operation: "append", previous: "", content: "Marcus has a lasting promise to protect the village.", evidence: text, effects: ["development"] });
    expect((await turn(a, text, { worldChanges: [c] })).activeState.memoryProposals).toEqual([]);
    a = approve(await turn(a, text, { worldChanges: [{ ...c, autonomous: false }] }), "storyCard");
    expect(a.storyCards[0].content).toContain("lasting promise");
    expect(a.storyCards[0].content).toContain("loyal to the king");
  });
  it("negative trust uses the relationship route without becoming betrayal or a card fact", async () => {
    let a = fixture();
    const text = "Marcus heard Seth admit he broke his promise.";
    a = await turn(a, text, { updates: [{ ...relationship(a), proposed: { ...initial, dimensions: { trust: "distrustful" } }, evidence: text, knowledgeEvidence: text }] });
    a = approve(a, "relationshipUpdate");
    expect(a.brains[0].relationships[0].current.dimensions.trust).toBe("distrustful");
    expect(a.storyCards[0].content).toBe("Marcus is loyal to the king.");
    expect(a.worldEvolutionState!.history).toEqual([]);
  });
  it("Off preserves legacy relationship functionality and existing world history", async () => {
    let a = fixture(); a.worldEvolutionSettings!.betrayal = "unrestricted";
    a = approve(await turn(a, "Marcus publicly betrays the king and joins the rebellion.", { worldChanges: [canon(a)] }), "storyCard");
    expect(a.worldEvolutionState!.history).toHaveLength(1);
    a.worldEvolutionSettings!.enabled = false;
    a.worldEvolutionSettings!.relationshipEvolution = false;
    const world = structuredClone(a.worldEvolutionState);
    a = await turn(a, story, { updates: [relationship(a), thought] });
    a = approve(a, "relationshipUpdate");
    expect(a.brains[0].relationships[0].current).toEqual(proposed);
    expect(a.worldEvolutionState).toEqual(world);
  });
  it("canon stays in reviewed cards, blocks betrayal Off and character protections override Unpredictable", async () => {
    const text = "Marcus publicly betrays the king and joins the rebellion.";
    let a = fixture();
    expect((await turn(a, text, { worldChanges: [canon(a)] })).activeState.memoryProposals).toEqual([]);
    a = adventureReducer(a, { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: worldPresets["Unpredictable World"] });
    a.storyCards[0].evolutionProtection = { betrayal: true, identity: false };
    expect((await turn(a, text, { worldChanges: [canon(a)] })).activeState.memoryProposals).toEqual([]);
    a.storyCards[0].evolutionProtection = { betrayal: false, identity: false };
    a = await turn(a, text, { worldChanges: [canon(a)] });
    expect(a.storyCards[0].content).toContain("loyal");
    a = approve(a, "storyCard");
    expect(a.storyCards[0].content).toContain("rebellion");
    expect(a.brains[0].relationships[0].current).toEqual(initial);
    await saveAdventure(a);
    const context = buildContext((await getAdventure(a.id))!, { currentInput: "Marcus" });
    expect(context.sections.flatMap(s => s.items).find(i => i.id === "marcus")!.content).not.toContain("Marcus is loyal to the king.");
  });
  it("selects relevant owners despite many earlier cards and excludes budget-omitted targets", () => {
    const a = fixture();
    a.storyCards.unshift(...Array.from({ length: 8 }, (_, i) => makeStoryCard({ id: `unrelated${i}`, title: `Unrelated ${i}`, content: "Unrelated desert geography", pinned: true })));
    const context = buildContext(a, { currentInput: "Marcus and Seth discuss the king." });
    const ids = new Set(context.sections.flatMap(s => s.items).map(i => i.id));
    const selected = selectedWorldTargets(a, ids, "Marcus and Seth discuss the king.");
    expect(selected.map(t => t.id)).toContain("marcus");
    expect(selected.map(t => t.id)).toContain("brain");
    expect(selected.some(t => t.owner === "plotEssentials")).toBe(true);
    expect(selected).toHaveLength(4);
    const excluded = new Set([...ids].filter(id => id !== "brain"));
    expect(selectedWorldTargets(a, excluded, "Marcus").map(t => t.id)).not.toContain("brain");
    expect(selected.some(t => t.id.startsWith("relationship:"))).toBe(false);
  });
  it("confirmed plot closure survives invalid/duplicate ordinary competition, archives and stays closed", async () => {
    let a = fixture();
    a.brains.push(makeBrain({ id: "mira-brain", characterName: "Mira", pinned: true, thoughts: { old: "I await news." } }), makeBrain({ id: "nora-brain", characterName: "Nora", pinned: true, thoughts: { old: "I await news." } }));
    const origin = "Marcus discovers a conspiracy against the king and investigates it. Mira and Nora wait for news.";
    a = await turn(a, origin, { newPlots: [{ id: "conspiracy", title: "Conspiracy", objective: "Expose the conspiracy against the king.", participants: ["marcus"], evidence: origin, autonomous: true, offscreen: false }] });
    expect(a.worldEvolutionState!.threads).toHaveLength(1);
    const closure = "Marcus exposed the entire conspiracy and permanently ended its threat.";
    const witnesses = "Mira and Nora witness the conspiracy's end and thank Marcus.";
    const text = story + " " + closure + " " + witnesses;
    const ordinary = [thought, relationship(a), { ...thought, target: "Mira", content: "I can finally rest.", evidence: witnesses }, { ...thought, target: "Nora", content: "I hope peace lasts.", evidence: witnesses }, { ...thought, content: "I appreciate his promise." }, { kind: "thought", target: "Absent", content: "I know everything.", evidence: closure, reason: "Bad target" }];
    const terminal = { targetId: "conspiracy", objective: a.worldEvolutionState!.threads[0].objective, expectedRevision: 0, kind: "resolved", certainty: "confirmed", evidence: closure, outcome: closure, autonomous: false, offscreen: false, resolution: { verdict: "victory", centralObjective: true, remainingObstacles: [], closureEvidence: closure } };
    a = await turn(a, text, { updates: ordinary, plotEvents: [{ ...terminal, expectedRevision: 99 }, terminal] });
    expect(a.worldEvolutionState!.threads).toEqual([]);
    expect(a.worldEvolutionState!.archivedThreads![0].outcome).toBe(closure);
    expect(Object.values(a.brains[0].thoughts).join(" ")).toContain("grateful");
    expect(a.worldEvolutionState!.issues.at(-1)!.droppedRecords?.some(d => d.record.target === "Nora")).toBe(true);
    expect(Object.values(a.brains.find(b => b.id === "nora-brain")!.thoughts).join(" ")).not.toContain("peace lasts");
    a = approve(a, "relationshipUpdate");
    a = await turn(a, "Marcus recalls the conspiracy and drinks tea.");
    expect(a.worldEvolutionState!.threads).toEqual([]);
    expect(buildContext(a, { currentInput: "Recall the conspiracy" }).sections.flatMap(s => s.items).map(i => i.content).join(" ")).toContain("Concluded");
    expect(a.worldEvolutionState!.issues.some(i => /Duplicate|absent|eligible/.test(i.reason))).toBe(true);
  });
  it("new plot Off permits existing progression, and progression Off does not disable separately permitted emerging plots", async () => {
    const origin = "Marcus discovers a conspiracy against the king and investigates it.";
    const p = { id: "conspiracy", title: "Conspiracy", objective: "Expose the conspiracy against the king.", participants: ["marcus"], evidence: origin, autonomous: true, offscreen: false };
    let a = fixture(); a.worldEvolutionSettings!.plotProgression = "off";
    a = await turn(a, origin, { newPlots: [p] });
    expect(a.worldEvolutionState!.threads).toHaveLength(1);
    a = adventureReducer(a, { type: "SET_WORLD_EVOLUTION_SETTINGS", patch: { newPlotGeneration: "off", plotProgression: "natural" } });
    const progress = "Marcus uncovers a conspiracy letter identifying its leader.";
    a = await turn(a, progress, { newPlots: [{ ...p, id: "other", objective: "Another plot" }], plotEvents: [{ targetId: p.id, objective: p.objective, expectedRevision: 0, kind: "revelation", certainty: "confirmed", evidence: progress, outcome: progress, autonomous: false, offscreen: false }] });
    expect(a.worldEvolutionState!.threads).toHaveLength(1);
    expect(a.worldEvolutionState!.threads[0]).toMatchObject({ phase: "break", revision: 1 });
  });
  it("significant canon survives capacity competition without replacing relationship or thought ownership", async () => {
    let a = fixture(); a.worldEvolutionSettings!.betrayal = "unrestricted";
    a.openingScene = "Marcus and Seth meet Mira and Nora.";
    a.brains.push(makeBrain({ id: "mira", characterName: "Mira", pinned: true, thoughts: { old: "I await news." } }), makeBrain({ id: "nora", characterName: "Nora", pinned: true, thoughts: { old: "I await news." } }));
    const witnesses = "Mira and Nora witness the change and reconsider their plans.";
    const text = story + " Marcus publicly betrays the king and joins the rebellion. " + witnesses;
    const c = canon(a);
    a = await turn(a, text, { updates: [thought, relationship(a), { ...thought, target: "Mira", content: "I need time to reflect.", evidence: witnesses }, { ...thought, target: "Nora", content: "I should choose my next step.", evidence: witnesses }], worldChanges: [{ ...c, expectedRevision: "stale" }, c] });
    expect(a.activeState.memoryProposals.find(p => p.worldChange)?.worldChange).toEqual(c);
    expect(a.worldEvolutionState!.issues.at(-1)!.droppedRecords?.some(d => d.record.target === "Nora")).toBe(true);
    a = approve(a, "storyCard"); a = approve(a, "relationshipUpdate");
    await saveAdventure(a); a = (await getAdventure(a.id))!;
    expect(a.storyCards[0].content).toBe("Marcus supports the rebellion.");
    expect(a.brains[0].relationships[0].current).toEqual(proposed);
    expect(Object.values(a.brains[0].thoughts).join(" ")).toContain("grateful");
    expect(a.worldEvolutionState!.history).toHaveLength(1);
  });
});
