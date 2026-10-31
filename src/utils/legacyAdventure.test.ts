import { describe, expect, it, vi } from "vitest";
import { legacyAdventure, retiredKeys } from "../test/legacyAdventure";
import { exportAdventureJson, importAdventureJson } from "./json";
import { createDefaultAdventure, makeComponent, normalizeAdventure, normalizeMemoryAutoApproveSettings, sanitizeAdventureForPersistence } from "../state/defaults";
import { buildContext } from "../contextBuilder/contextBuilder";
import { runTurnPipeline } from "../state/turnPipeline";
import { adventureReducer } from "../state/adventureReducer";
import type { MemoryProposal } from "../types/adventure";

describe("retired memory compatibility boundary", () => {
  it.each([importAdventureJson, (text: string) => normalizeAdventure(JSON.parse(text)), (text: string) => sanitizeAdventureForPersistence(JSON.parse(text))])("preserves story and live memory through input or direct persistence", load => {
    const old = legacyAdventure();
    const a = load(JSON.stringify(old));
    expect(a.messages).toEqual(old.messages);
    expect(a.components[0].content).toEqual(old.components[0].content);
    expect(a.storyCards[0].content).toEqual(old.storyCards[0].content);
    expect(a.brains[0].currentState).toEqual(old.brains[0].currentState);
    expect(a.activeState.memoryProposals.map(p => p.id)).toEqual(["valid-proposal"]);
    expect(a.activeState.pendingUpdates).toHaveLength(1);
    expect(a.activeState.pendingUpdates[0].actions).toEqual([{ type: "UPDATE_MESSAGE", messageId: "reply", content: "I carefully enter the observatory." }]);
    expect(a.tokenBudgetSettings.sectionBudgets.storyCards).toBe(500);
    const exported = exportAdventureJson(a);
    expect(exported).not.toMatch(retiredKeys);
    expect(importAdventureJson(exported).messages).toEqual(old.messages);
    expect(exportAdventureJson(old)).not.toMatch(retiredKeys);
    const context = buildContext(a);
    expect(JSON.stringify(context)).not.toContain("RETIRED SUMMARY SENTINEL");
    expect(JSON.stringify(context)).not.toContain("RETIRED SCENE SENTINEL");
    expect(context.sections.map(s => s.id)).not.toEqual(expect.arrayContaining(["rollingSummary", "sceneState"]));
  });

  it("copies old input into the new format and leaves the original object untouched", () => {
    const old = legacyAdventure(), original = JSON.stringify(old);
    const copy = importAdventureJson(original, true);
    expect(copy.id).not.toBe(old.id);
    expect(copy.messages).toEqual(old.messages);
    expect(JSON.stringify(old)).toBe(original);
    expect(exportAdventureJson(copy)).not.toMatch(retiredKeys);
  });

  it("also sanitizes obsolete settings and proposals inside mixed and nested queued actions", () => {
    const old = legacyAdventure();
    const queue = old.activeState.pendingUpdates[2];
    queue.actions.push(
      { type: "SET_TOKEN_BUDGET_SETTINGS", settings: old.tokenBudgetSettings },
      { type: "SET_MEMORY_AUTO_APPROVE", settings: old.memoryAutoApprove },
      { type: "QUEUE_PENDING_UPDATE", update: old.activeState.pendingUpdates[0] },
      { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "old-summary" },
    );
    const clean = sanitizeAdventureForPersistence(old);
    expect(exportAdventureJson(clean)).not.toMatch(retiredKeys);
    expect(clean.activeState.pendingUpdates[0].actions).toHaveLength(3);
    expect(clean.messages).toEqual(old.messages);
  });

  it("rejects retired proposals instead of applying them as another memory type", () => {
    const a = createDefaultAdventure();
    const p = { ...legacyAdventure().activeState.memoryProposals[0] } as unknown as MemoryProposal;
    expect(adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p })).toBe(a);
  });

  it("removes the retired section from new default rules and preserves custom Narration Rules verbatim", () => {
    const a = createDefaultAdventure();
    expect(a.components.find(c => c.type === "narrationRules")?.content).not.toMatch(/rolling summary|scene state/i);
    const custom = "My custom narration instructions mention Rolling Summary as a historical term. Keep this wording.";
    a.components = [makeComponent({ type: "narrationRules", title: "Narration Rules", content: custom })];
    expect(importAdventureJson(exportAdventureJson(a)).components.find(c => c.type === "narrationRules")?.content).toBe(custom);
  });

  it("creates only active context and makes no retired background requests on an ordinary turn", async () => {
    const a = createDefaultAdventure();
    a.memoryDetectionSettings.enabled = false;
    a.semanticEvaluationSettings.enabled = false;
    const send = vi.fn(async () => ({ content: "The gate opens.", raw: {} }));
    const result = await runTurnPipeline({ adventure: a, text: "I open the gate.", sendChatCompletion: send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(exportAdventureJson(result.adventure)).not.toMatch(retiredKeys);
    expect(result.adventure.activeState.pendingUpdates).toEqual([]);
  });
});

describe("adventure approval settings", () => {
  it("starts each adventure with an independent copy of seven OFF settings", () => {
    const a = createDefaultAdventure(), b = createDefaultAdventure();
    expect(Object.values(a.memoryAutoApprove)).toEqual(Array(7).fill(false));
    expect(a.memoryAutoApprove).not.toBe(b.memoryAutoApprove);
    a.memoryAutoApprove.otherStoryCard = true;
    expect(b.memoryAutoApprove.otherStoryCard).toBe(false);
    expect(importAdventureJson(exportAdventureJson(a)).memoryAutoApprove).toEqual(a.memoryAutoApprove);
  });
  it.each([
    [{ characterStoryCard: true, otherStoryCard: true }, true],
    [{ characterStoryCard: false, otherStoryCard: true }, false],
    [{ characterStoryCard: true, otherStoryCard: false }, false],
    [{ characterStoryCard: true }, false], [{ otherStoryCard: true }, false],
    [{ storyCard: true }, true], [{ storyCard: false }, false],
  ])("conservatively merges legacy card coverage %j", (old, enabled) => {
    expect(normalizeMemoryAutoApproveSettings(old).otherStoryCard).toBe(enabled);
  });
  it("preserves valid saved values, ignores retired ones, and rejects invalid values", () => {
    const old = { plotEssentialsUpdate: true, plotPressureUpdate: false, currentArcUpdate: true, arcProposal: true, brainUpdate: "yes", loreStoryCard: false, storyCard: true, summaryUpdate: true, plotMomentumUpdate: true };
    const migrated = normalizeMemoryAutoApproveSettings(old);
    expect(migrated).toEqual({ plotEssentialsUpdate: true, plotPressureUpdate: false, currentArcUpdate: true, arcProposal: true, brainUpdate: false, loreStoryCard: false, otherStoryCard: true });
    expect(Object.values(normalizeMemoryAutoApproveSettings(null))).toEqual(Array(7).fill(false));
    expect(normalizeMemoryAutoApproveSettings({ ...createDefaultAdventure().memoryAutoApprove, otherStoryCard: true, brainUpdate: "invalid" })).toMatchObject({ otherStoryCard: true, brainUpdate: false });
  });
});
