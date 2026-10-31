import { describe, expect, it } from "vitest";
import { getApprovalCategory, shouldAutoApprove, storyCardApprovalCategory } from "./approvalPolicy";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { approvalAdventure, approvalCategories, approvalProposal, existingApprovalCard, memoryData } from "../test/memoryApproval";
import { reviewedProposal } from "../test/memoryPlacement";
import type { StoryCardType } from "../types/adventure";

describe("seven adventure approval categories", () => {
  it.each(approvalCategories.flatMap(category => [false, true].map(enabled => ({ category, enabled }))))("$category ON=$enabled controls valid new proposals", ({ category, enabled }) => {
    const a = approvalAdventure();
    a.memoryAutoApprove[category] = enabled;
    let p = approvalProposal(category);
    a.messages = [{ id: "source", role: "assistant", content: p.content, createdAt: a.createdAt }];
    if (p.proposedType === "storyCard") p = reviewedProposal(a, p);
    expect(getApprovalCategory(a, p)).toBe(category);
    expect(shouldAutoApprove(a, p)).toBe(enabled);
    const next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
    expect(next.activeState.memoryProposals.find(entry => entry.id === p.id)?.status).toBe(enabled ? "approved" : "pending");
    if (enabled) expect(memoryData(next)).not.toEqual(memoryData(a));
    else expect(memoryData(next)).toEqual(memoryData(a));
  });
  it.each(["character", "location", "lore", "custom"] as StoryCardType[])("uses stored %s type instead of the proposed replacement type", type => {
    const a = approvalAdventure(); a.storyCards = [existingApprovalCard(type)];
    const category = type === "lore" ? "loreStoryCard" : "otherStoryCard";
    a.memoryAutoApprove[category] = true;
    const p = approvalProposal("loreStoryCard", { title: "Mira", targetId: "card", storyCardType: type === "lore" ? "character" : "lore" });
    expect(getApprovalCategory(a, p)).toBe(category);
    expect(shouldAutoApprove(a, p)).toBe(true);
  });
  it.each(["character", "location", "plot", "custom"])("routes %s to Everything Else", type => {
    expect(storyCardApprovalCategory(type)).toBe("otherStoryCard");
  });
  it.each([undefined, "unknown"])("leaves unknown new card type %s pending", type => {
    const a = approvalAdventure(); for (const category of approvalCategories) a.memoryAutoApprove[category] = true;
    const p = approvalProposal("loreStoryCard", { storyCardType: type as StoryCardType });
    expect(getApprovalCategory(a, p)).toBeUndefined();
    const next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
    expect(next.storyCards).toEqual([]);
    expect(next.activeState.memoryProposals.find(entry => entry.id === p.id)?.status).toBe("pending");
  });
  it.each([false, true])("missing-Brain Character card fallback uses Everything Else=%s", enabled => {
    const a = approvalAdventure(); a.brains = [];
    a.memoryAutoApprove.brainUpdate = !enabled; a.memoryAutoApprove.otherStoryCard = enabled;
    const p = approvalProposal("brainUpdate", { content: "Mira swore a lasting oath to guard the observatory." });
    expect(getApprovalCategory(a, p)).toBe("otherStoryCard");
    const next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
    expect(next.storyCards.length).toBe(enabled ? 1 : 0); expect(next.brains).toEqual([]);
  });
  it("changing a preference does not apply existing pending proposals", () => {
    const a = approvalAdventure(), p = approvalProposal("brainUpdate");
    const pending = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
    const next = reduce(pending, { type: "SET_MEMORY_AUTO_APPROVE", settings: { ...a.memoryAutoApprove, brainUpdate: true } });
    expect(next.activeState.memoryProposals).toEqual(pending.activeState.memoryProposals);
    expect(memoryData(next)).toEqual(memoryData(pending));
  });
});
