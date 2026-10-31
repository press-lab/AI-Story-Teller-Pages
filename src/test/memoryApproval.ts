import type { Adventure, MemoryProposal, StoryCardType } from "../types/adventure";
import type { ApprovalCategory } from "../memory/approvalPolicy";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";

export const approvalCategories: ApprovalCategory[] = ["plotEssentialsUpdate", "plotPressureUpdate", "currentArcUpdate", "arcProposal", "loreStoryCard", "otherStoryCard", "brainUpdate"];
export function approvalAdventure(): Adventure {
  const a = createDefaultAdventure("Approval contract");
  for (const category of approvalCategories) a.memoryAutoApprove[category] = false;
  a.memoryDetectionSettings = { ...a.memoryDetectionSettings, enabled: false };
  a.storyCards = [];
  a.brains = [makeBrain({ id: "brain", characterName: "Mira", currentState: "Old state", thoughts: { old: "Old thought" }, active: true, inclusionPolicy: "always" })];
  a.components = [
    makeComponent({ id: "plot", title: "Plot Essentials", type: "plotEssentials", content: "Old premise", protected: false }),
    makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "Old pressure" }),
    makeComponent({ id: "arc", title: "Current Arc", type: "currentArc", content: "" }),
  ];
  return a;
}
export function approvalProposal(category: ApprovalCategory, patch: Partial<MemoryProposal> = {}): MemoryProposal {
  const storyCardType: StoryCardType | undefined = category === "loreStoryCard" ? "lore" : category === "otherStoryCard" ? "character" : undefined;
  return {
    id: `proposal-${category}`, proposedType: storyCardType ? "storyCard" : category as MemoryProposal["proposedType"],
    title: storyCardType ? "The Silver Observatory" : category === "brainUpdate" ? "Mira" : category,
    content: category === "brainUpdate" ? JSON.stringify({ currentState: "New state" }) : category === "arcProposal" ? JSON.stringify({ arcPremise: "Find the missing astronomer" }) : "The silver observatory was sealed after the northern tower collapsed.",
    storyCardType, targetId: category === "brainUpdate" ? "brain" : category === "plotEssentialsUpdate" ? "plot" : category === "plotPressureUpdate" ? "pressure" : ["currentArcUpdate", "arcProposal"].includes(category) ? "arc" : undefined,
    brainUpdateMode: category === "brainUpdate" ? "replace" : undefined,
    sourceTurnId: "source", sourceText: "The northern tower collapsed.", suggestedTriggers: ["silver observatory"], confidence: 0.9, rationale: "Durable development", status: "pending", createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z", ...patch,
  };
}
export function memoryData(a: Adventure) {
  return { cards: a.storyCards.map(c => ({ type: c.type, content: c.content })), brains: a.brains.map(b => ({ state: b.currentState, thoughts: b.thoughts })), components: a.components.map(c => ({ type: c.type, content: c.content, premise: c.arcPremise })) };
}
export function existingApprovalCard(type: StoryCardType) {
  return makeStoryCard({ id: "card", title: "Mira", type, content: "An enduring original fact.", keys: ["Mira"], memoryMode: "static" });
}
