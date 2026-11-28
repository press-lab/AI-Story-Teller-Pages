import { describe, expect, it } from "vitest";
import { getApprovalCategory, shouldAutoApprove, storyCardApprovalCategory } from "./approvalPolicy";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { approvalAdventure, approvalCategories, approvalProposal, existingApprovalCard, memoryData } from "../test/memoryApproval";
import { reviewedProposal } from "../test/memoryPlacement";
import { makeStoryCardSuggestion, mergeStoryCardSuggestions } from "./storyCardSuggestions";
import type { StoryCardType } from "../types/adventure";

describe("adventure approval categories", () => {
  it.each(approvalCategories.filter(category => category !== "plotPressureUpdate").flatMap(category => [false, true].map(enabled => ({ category, enabled }))))("$category ON=$enabled controls valid new proposals", ({ category, enabled }) => {
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
  it.each([false, true])("uses the Relationships switch for new and existing cards (%s)", enabled => {
    const a = approvalAdventure();
    a.storyCards = [existingApprovalCard("relationship")];
    a.memoryAutoApprove.loreStoryCard = !enabled;
    a.memoryAutoApprove.otherStoryCard = !enabled;
    a.memoryAutoApprove.relationshipStoryCard = enabled;
    const create = approvalProposal("otherStoryCard", { storyCardType: "relationship" });
    const append = { ...create, targetId: a.storyCards[0].id };
    for (const proposal of [create, append]) {
      expect(getApprovalCategory(a, proposal)).toBe("relationshipStoryCard");
      expect(shouldAutoApprove(a, proposal)).toBe(enabled);
    }
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


describe("uncertain Story Card approval", () => {
  it.each([false, true])("honors auto-approval=%s without changing confidence or uncertainty", enabled => {
    const a = approvalAdventure();
    a.memoryAutoApprove.loreStoryCard = enabled;
    const content = "The silver observatory was sealed after the northern tower collapsed.";
    a.messages = [{ id: "source", role: "assistant", content, createdAt: a.createdAt }];
    const draft = makeStoryCardSuggestion(a, "source", content, {
      title: "The Silver Observatory", content, evidence: content, reason: "Uncertain finding.",
      type: "lore", candidateOnly: true, evidenceReviewed: true, origin: "model",
    });
    expect(draft).toMatchObject({ confidence: 0.45, requiresReview: false, storyCardReview: { candidateOnly: true } });
    const merged = mergeStoryCardSuggestions(draft, draft);
    expect(merged.requiresReview).toBe(false);
    const proposal = reviewedProposal(a, merged);
    const next = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal });
    expect(next.activeState.memoryProposals.find(p => p.id === proposal.id)).toMatchObject({
      status: enabled ? "approved" : "pending", confidence: 0.45, storyCardReview: { candidateOnly: true },
    });
    expect(next.storyCards).toHaveLength(enabled ? 1 : 0);
  });
});

it.each([[false, false], [true, false], [false, true], [true, true]])(
  "isolates ordinary Lore (%s) and Autonomous Lore approval (%s)", async (ordinary, autonomous) => {
    const { a, proposal, sourceId } = await (await import("../test/autonomousLore")).autonomousLoreFixture();
    a.memoryAutoApprove = { ...a.memoryAutoApprove, loreStoryCard: ordinary, autonomousLoreStoryCard: autonomous };
    const normal = reviewedProposal(a, approvalProposal("loreStoryCard", {
      id: "ordinary-lore", sourceTurnId: sourceId, title: "Ministry report deadline", content: "The Ministry expects the research report tomorrow.",
    }));
    expect(getApprovalCategory(a, proposal)).toBe("autonomousLoreStoryCard");
    expect(shouldAutoApprove(a, normal)).toBe(ordinary);
    expect(shouldAutoApprove(a, proposal)).toBe(autonomous);
    const withOrdinary = reduce(a, { type: "ADD_MEMORY_PROPOSAL", proposal: normal });
    expect(withOrdinary.activeState.memoryProposals.find(entry => entry.id === normal.id)?.status).toBe(ordinary ? "approved" : "pending");
    const next = reduce(withOrdinary, { type: "ADD_MEMORY_PROPOSAL", proposal });
    expect(next.activeState.memoryProposals[0]?.status).toBe(autonomous ? "approved" : "pending");
    expect(next.storyCards.some(card => card.lore?.autonomous)).toBe(autonomous);
  },
);