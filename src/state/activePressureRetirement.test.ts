import { describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule, normalizeAdventure, sanitizeAdventureForPersistence } from "./defaults";
import { adventureReducer as reduce } from "./adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { buildMemoryAssessmentConditions, runManualPEComponentUpdate, runPlotAIBuilder, runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { parseComponentsJson } from "../importers/componentParser";
import { looseMemoryFixture } from "../test/looseMemory";
import { prepareSinglePassMemoryBatch } from "../memory/singlePassMemory";
import { parseLooseMemoryOperations } from "../memory/looseMemoryParser";
import { routeLooseMemoryOperations } from "../memory/looseMemoryRouter";
import { createDispatchAdventure } from "../dev/dispatchAdventure";
import { createRookeryAdventure } from "../dev/rookeryAdventure";
import { createArcaneAfterRocketAdventure } from "../dev/arcaneAfterRocketAdventure";
import type { AdventureAction, MemoryProposal } from "../types/adventure";

vi.mock("../providers/openAICompatible", async original => {
  const actual = await original<typeof import("../providers/openAICompatible")>();
  return { ...actual, sendOpenAICompatibleChatCompletion: vi.fn() };
});
const pressure = () => makeComponent({ id: "retired", type: "activePressure", title: "Active Pressure", content: "UniquePressureRecall threatens the harbor.", active: true, autoUpdate: true, pinned: true, protected: true, alwaysOn: true });
const proposal = (): MemoryProposal => ({ id: "old-pressure", proposedType: "plotPressureUpdate", title: "Active Pressure", targetId: "retired", content: "A replacement threat.", sourceTurnId: "source", sourceText: "A replacement threat.", suggestedTriggers: [], confidence: 1, rationale: "Legacy update", status: "pending", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
function legacy() {
  const a = createDefaultAdventure("Legacy compatibility");
  a.components.push(pressure());
  a.brains = [makeBrain({ characterName: "Mira", relationshipPressure: "I distrust the captain." })];
  a.activeState.memoryProposals = [proposal()];
  a.memoryAutoApprove.plotPressureUpdate = true;
  return a;
}

describe("Active Pressure retirement", () => {
  it("never seeds or recreates the component and preserves dormant legacy text", () => {
    const empty = createDefaultAdventure();
    expect(empty.components.some(c => c.type === "activePressure")).toBe(false);
    expect(normalizeAdventure(empty).components.some(c => c.type === "activePressure")).toBe(false);
    const raw = legacy(), original = structuredClone(raw);
    const normalized = normalizeAdventure(raw);
    expect(normalized.components.find(c => c.id === "retired")).toEqual({ ...raw.components.find(c => c.id === "retired"), active: false, autoUpdate: false });
    expect(normalized.activeState.memoryProposals[0]).toEqual({ ...raw.activeState.memoryProposals[0], status: "ignored" });
    expect(normalized.memoryAutoApprove.plotPressureUpdate).toBe(false);
    expect(normalized.brains).toEqual(raw.brains);
    expect(raw).toEqual(original);
    expect(normalizeAdventure(normalized)).toEqual(normalized);
    const persisted = sanitizeAdventureForPersistence(raw);
    expect(persisted.components.find(c => c.id === "retired")).toMatchObject({ content: pressure().content, active: false, autoUpdate: false });
  });

  it("excludes even raw pinned legacy pressure from context and chained retrieval", () => {
    const a = legacy();
    a.storyCards = [makeStoryCard({ title: "UniquePressureRecall", content: "A recalled identity.", keys: ["UniquePressureRecall"] })];
    const context = buildContext(a);
    expect(context.sections.flatMap(s => s.items).some(i => i.id === "retired")).toBe(false);
    expect(context.sections.flatMap(s => s.items).some(i => i.sourceType === "storyCard")).toBe(false);
    expect(context.messages.map(m => m.content).join("\n")).not.toContain(pressure().content);
    expect(context.pendingProposals).toEqual([]);
    expect(buildMemoryAssessmentConditions(a).plot.some(c => c.id.startsWith("plotEssentialsPressure:"))).toBe(false);
  });

  it("blocks direct writes, reactivation, proposals and manual or automatic approvals", () => {
    const a = legacy();
    const actions: AdventureAction[] = [
      { type: "UPSERT_COMPONENT", component: pressure() },
      { type: "ACTIVATE_COMPONENT", componentId: "retired" },
      { type: "UPDATE_COMPONENT", componentId: "retired", patch: { active: true, content: "Changed" } },
      { type: "APPLY_COMPONENT_UPDATE", componentId: "retired", content: "Changed" },
      { type: "UPDATE_COMPONENT", componentId: a.components[0].id, patch: { type: "activePressure" } },
      { type: "ADD_MEMORY_PROPOSAL", proposal: proposal() },
      { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "old-pressure" },
      { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "old-pressure", automatic: true },
    ];
    for (const action of actions) expect(reduce(a, action)).toBe(a);
    const without = { ...a, components: a.components.filter(c => c.type !== "activePressure") };
    expect(reduce(without, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "old-pressure" })).toBe(without);
  });

  it("retains non-pressure siblings in queued updates and mixed trigger rules", () => {
    const a = legacy();
    const actions: AdventureAction[] = [{ type: "APPLY_COMPONENT_UPDATE", componentId: "retired", content: "Changed" }, { type: "SET_NEXT_TURN_NOTE", note: { content: "Keep this author direction." } }];
    a.activeState.pendingUpdates = [{ id: "mixed", createdAt: "2026-01-01", source: "manual", actions }];
    a.triggerRules = [
      makeTriggerRule({ name: "Retired", actions: [{ type: "updateComponentPressure", componentId: "retired" }] }),
      makeTriggerRule({ name: "Mixed", actions: [{ type: "updateComponentPressure", componentId: "retired" }, { type: "activateComponent", componentId: "keep" }] }),
    ];
    const next = normalizeAdventure(a);
    expect(next.activeState.pendingUpdates[0].actions).toEqual([actions[1]]);
    expect(next.triggerRules[0]).toMatchObject({ enabled: false, actions: [] });
    expect(next.triggerRules[1]).toMatchObject({ enabled: true, actions: [{ type: "activateComponent", componentId: "keep" }] });
    expect(reduce(next, { type: "FLUSH_PENDING_UPDATES" }).activeState.nextTurnNote.content).toBe("Keep this author direction.");
  });

  it("does no paid work for old manual pressure tools or pressure-only trigger rules", async () => {
    vi.mocked(sendOpenAICompatibleChatCompletion).mockClear();
    const a = legacy();
    const manual = await runManualPEComponentUpdate(a, a.modelConfig, "retired");
    expect(manual.actions.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
    await expect(runPlotAIBuilder(a, a.modelConfig, { target: "activePressure", description: "A new threat", useRecentStory: true })).rejects.toThrow("retired");
    a.components = [pressure()]; a.brains = []; a.storyCards = [];
    a.triggerRules = [makeTriggerRule({ name: "Retired", condition: "Always", actions: [{ type: "updateComponentPressure", componentId: "retired" }] })];
    await runSemanticPostTurnEvaluation(a, a.modelConfig);
    expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
  });

  it("suppresses a legacy pressure operation without losing its valid Lore sibling", async () => {
    const { a, ids } = looseMemoryFixture();
    const batch = await prepareSinglePassMemoryBatch(a, [ids[0]]);
    const parsed = parseLooseMemoryOperations("S1\n(component.activePressure: Old Pressure = A replacement threat.)\n(lore: Weasley Tattoo Business = Fred and George agreed to produce 96 rune tattoos tomorrow.)", ["S1"]);
    const result = routeLooseMemoryOperations(a, batch, parsed).sources[0];
    expect(result.suppressedIndexes).toContain(0);
    expect(result.rejected).toEqual([]);
    expect(result.failureReason).toBeUndefined();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ kind: "storyCard", targetId: "business" });
  });

  it("skips disabled component imports and keeps valid siblings", () => {
    const parsed = parseComponentsJson(JSON.stringify({ components: [pressure(), makeComponent({ type: "plotEssentials", title: "Premise", content: "The harbor is sealed." })] }));
    expect(parsed.components).toHaveLength(1);
    expect(parsed.components[0].component.type).toBe("plotEssentials");
    expect(parsed.skipped[0].reason).toContain("retired");
  });

  it.each([createDispatchAdventure, createRookeryAdventure, createArcaneAfterRocketAdventure])("does not seed pressure in %s", create => {
    expect(create().components.some(c => c.type === "activePressure")).toBe(false);
  });
});
