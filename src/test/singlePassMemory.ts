import { syntheticMemoryAdventure, confirmationQuote, partnershipSourceId } from "../memory/fixtures/syntheticMemoryAdventure";
import type { SinglePassMemoryFinding } from "../types/adventure";
export function singlePassFixture(count = 3) {
  const a = syntheticMemoryAdventure();
  a.memoryDetectionSettings.pipeline = "singlePass";
  a.memoryDetectionSettings.everyNTurns = 1;
  const sources = a.messages.filter(m => m.role === "assistant").slice(-count);
  for (const m of sources) m.memoryEvaluation = { pipeline: "singlePass", status: "pending", attempts: 0, turn: 45, revision: m.id, completedGroups: [] };
  return { a, ids: sources.map(m => m.id) };
}
export function groundedFinding(): SinglePassMemoryFinding {
  return { kind: "storyCard", targetId: null, title: "Workshop collaboration agreement", content: confirmationQuote,
    reason: "The exchange confirms the collaboration agreement.", evidenceQuotes: [{ messageId: partnershipSourceId, quote: confirmationQuote }], candidateOnly: false,
    storyCardType: "lore", operation: "create", memoryMode: "historical", eventStatus: "completed", suggestedTriggers: ["workshop collaboration", "custom designs", "Casey and Avery agreement"], participants: ["Casey Vale", "Avery Stone"] };
}
