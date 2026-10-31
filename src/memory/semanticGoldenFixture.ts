import type { Adventure } from "../types/adventure";
import type { GoldenMemoryCase } from "./semanticGoldenCases";

/** Build input using only selected sources and declared current canon. Expected
 * concepts, forbidden claims and acceptance answers are deliberately not read. */
export function semanticGoldenAdventure(selection: Pick<GoldenMemoryCase, "sourceIds" | "canon">, imported: Adventure): Adventure {
  const a = structuredClone(imported);
  const end = Math.max(...selection.sourceIds.map(id => a.messages.findIndex(message => message.id === id)));
  if (end < 0 || selection.sourceIds.some(id => !a.messages.some(message => message.id === id && message.role === "assistant"))) throw new Error("Golden source missing from local export");
  a.messages = a.messages.slice(0, end + 1);
  a.activeState.memoryProposals = [];
  a.activeState.evaluationLog = [];
  const removed = new Set(selection.canon?.removeCardIds ?? []);
  a.storyCards = a.storyCards.filter(card => !removed.has(card.id)).map(card => {
    const content = selection.canon?.cardContents?.[card.id];
    return content === undefined ? card : { ...card, content };
  });
  if (selection.canon?.clearSummary) {
  }
  a.brains = []; // This public-Lore benchmark does not expose private Brains.
  a.memoryAutoApprove.loreStoryCard = false; a.memoryAutoApprove.otherStoryCard = false;
  a.memoryDetectionSettings = { enabled: true, generateContent: true, evaluator: "dedicated", everyNTurns: 0 };
  return a;
}
