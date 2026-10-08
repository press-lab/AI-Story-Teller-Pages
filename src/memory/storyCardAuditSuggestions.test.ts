import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { getAdventure, saveAdventure } from "../db/adventureDb";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import type { Adventure, MemoryProposal } from "../types/adventure";
import type { AuditRecommendation } from "./storyCardAudit";
import { cardAuditReviewError, storyCardAuditSuggestions } from "./storyCardAuditSuggestions";

function fixture() {
  const a = createDefaultAdventure("Card approval routing");
  a.memoryAutoApprove.storyCard = true;
  a.storyCards = [makeStoryCard({ id: "edit", title: "Existing Lore", content: "Original lore.", type: "lore", keys: ["old alias"], pinned: true, updatedAt: "2000-01-01T00:00:00.000Z" }), makeStoryCard({ id: "delete", title: "Duplicate Lore", content: "Redundant lore.", type: "lore", keys: ["duplicate"], updatedAt: "2000-01-01T00:00:00.000Z" })];
  return a;
}
function rec(action: AuditRecommendation["action"]): AuditRecommendation {
  return { id: action, action, source: "deterministic", cardId: action === "create" ? undefined : action,
    title: action === "create" ? "New Lore" : action === "edit" ? "Existing Lore" : "Duplicate Lore", rationale: "Clean up this subject",
    suggestedContent: "Revised lore.", editedContent: action === "delete" ? "" : "Revised lore.", suggestedKeys: ["new subject"], editedKeys: "new subject",
    suggestedType: "lore", suggestedMemoryMode: "static", decision: "pending" };
}
function queue(a: Adventure, recommendations = [rec("edit"), rec("create"), rec("delete")]) {
  return storyCardAuditSuggestions(a, recommendations).reduce((state, proposal) => adventureReducer(state, { type: "ADD_MEMORY_PROPOSAL", proposal }), a);
}
function approve(a: Adventure, p: MemoryProposal) { return adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id }); }

describe("card cleanup in Suggestions", () => {
  it("persists edit/create/delete as pending Suggestions and applies only explicit approvals through card actions", async () => {
    const original = fixture(); let a = queue(original);
    expect(a.storyCards).toEqual(original.storyCards);
    expect(a.activeState.memoryProposals).toHaveLength(3);
    expect(a.activeState.memoryProposals.every(p => p.status === "pending" && p.requiresReview)).toBe(true);
    await saveAdventure(a); a = importAdventureJson(exportAdventureJson((await getAdventure(a.id))!));
    for (const p of a.activeState.memoryProposals) a = approve(a, p);
    await saveAdventure(a); a = (await getAdventure(a.id))!;
    expect(a.storyCards.find(c => c.id === "edit")).toMatchObject({ content: "Revised lore.", keys: ["new subject"] });
    expect(a.storyCards.some(c => c.id === "delete")).toBe(false);
    expect(a.storyCards.find(c => c.title === "New Lore")).toMatchObject({ content: "Revised lore.", memoryMode: "static" });
    expect(a.activeState.memoryProposals.every(p => p.status === "approved")).toBe(true);
    const context = buildContext(a, { currentInput: "new subject" }).messages.map(m => m.content).join("\n");
    expect(context).toContain("Revised lore."); expect(context).not.toContain("Redundant lore.");
  });
  it("blocks stale edit/delete approval and keeps operation/target revision fixed while suggestions are edited", () => {
    let a = queue(fixture());
    for (const action of ["edit", "delete"] as const) {
      const p = a.activeState.memoryProposals.find(p => p.cardAudit?.action === action)!;
      a = adventureReducer(a, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { content: "User-edited cleanup.", cardAudit: { action: "create", expectedRevision: null }, targetId: "other" } });
      const edited = a.activeState.memoryProposals.find(q => q.id === p.id)!;
      expect(edited.cardAudit).toEqual(p.cardAudit); expect(edited.targetId).toBe(p.targetId);
      a = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: action, patch: { content: "Later manual edit." } });
      expect(cardAuditReviewError(a, edited)).toContain("changed");
      expect(approve(a, edited)).toBe(a);
    }
  });
  it("supports rejection, edited approvals, duplicate detection and protects create targets from title collisions", () => {
    let a = fixture(); a = queue(a, [rec("edit"), rec("edit")]);
    expect(a.activeState.memoryProposals).toHaveLength(1);
    const p = a.activeState.memoryProposals[0];
    a = adventureReducer(a, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: p.id, patch: { content: "Reviewed lore." } });
    a = approve(a, a.activeState.memoryProposals[0]);
    expect(a.storyCards[0].content).toBe("Reviewed lore.");
    expect(approve(a, a.activeState.memoryProposals[0])).toBe(a);
    a = queue(a, [rec("delete")]);
    const deletion = a.activeState.memoryProposals[0];
    a = adventureReducer(a, { type: "REJECT_MEMORY_PROPOSAL", proposalId: deletion.id });
    expect(approve(a, a.activeState.memoryProposals[0])).toBe(a);
    expect(a.storyCards.some(c => c.id === "delete")).toBe(true);
    a = queue(a, [{ ...rec("create"), title: "Existing Lore" }]);
    const collision = a.activeState.memoryProposals[0];
    expect(cardAuditReviewError(a, collision)).toContain("already exists");
    expect(approve(a, collision)).toBe(a);
  });
});
