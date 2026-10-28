import { expect } from "vitest";

export function expectSixLooseProposals(a: import("../types/adventure").Adventure, sourceIds: string[]) {
  const proposals = a.activeState.memoryProposals;
  expect(proposals).toHaveLength(6);
  expect(proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ proposedType: "storyCard", storyCardType: "lore", targetId: "business", cardOperation: "append",
      content: "Fred and George agreed to produce 96 rune tattoos tomorrow.", sourceTurnId: sourceIds[0] }),
    expect.objectContaining({ proposedType: "brainUpdate", targetId: "brain-george", sourceTurnId: sourceIds[0] }),
    expect.objectContaining({ proposedType: "storyCard", storyCardType: "character", cardOperation: "create",
      title: "Eleanor Vale", sourceTurnId: sourceIds[1] }),
    expect.objectContaining({ proposedType: "storyCard", storyCardType: "location", cardOperation: "create",
      title: "Observatory Annex", sourceTurnId: sourceIds[1] }),
    expect.objectContaining({ proposedType: "storyCard", storyCardType: "lore", cardOperation: "create",
      title: "Draconia Research Meeting", content: "Draconia agreed to meet Seth tomorrow at six. The meeting has not occurred.", sourceTurnId: sourceIds[2] }),
    expect.objectContaining({ proposedType: "plotPressureUpdate", targetId: "pressure", sourceTurnId: sourceIds[2] }),
  ]));
  const brain = proposals.find(p => p.proposedType === "brainUpdate")!;
  expect(Object.values(JSON.parse(brain.content).thoughts)).toEqual([expect.stringMatching(/^\d+ \u2192 I believe the business can grow beyond individual customers\.$/)]);
  expect(brain).toMatchObject({ status: a.memoryAutoApprove.brainUpdate ? "approved" : "pending", requiresReview: false });
  expect(proposals.filter(p => p.proposedType !== "brainUpdate").every(p => p.status === "pending" && p.requiresReview)).toBe(true);
  expect(proposals.filter(p => p.cardOperation === "create").every(p => !p.targetId)).toBe(true);
  expect(a.messages.filter(m => sourceIds.includes(m.id)).map(m => m.memoryEvaluation?.status)).toEqual(["complete", "complete", "complete"]);
  for (const m of a.messages.filter(m => sourceIds.includes(m.id))) {
    expect(m.memoryEvaluation?.singlePass).toMatchObject({ parsedCount: 2, routedCount: 2, proposedCount: 2, reviewCount: m.id === sourceIds[0] && a.memoryAutoApprove.brainUpdate ? 1 : 2, acceptedCount: m.id === sourceIds[0] && a.memoryAutoApprove.brainUpdate ? 1 : 0, rejectedCount: 0, suppressedCount: 0 });
    expect(proposals.filter(p => p.sourceTurnId === m.id).every(p => p.sourceText === m.content)).toBe(true);
  }
}
