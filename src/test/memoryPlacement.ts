import type { Adventure, MemoryProposal } from "../types/adventure";
import { bindPlacement } from "../memory/storyCardPlacement";

/** Explicit synthetic semantic review for offline transport tests, not a production classifier. */
export function mockPlacementVerdict(body: { title: string; proposed: string; targetInfo?: { id?: string; type?: string; memoryMode?: string }; latestTurnMessageIds: string[]; recentEvidence: string }) {
  return { kind: body.targetInfo?.id ? "append" : "create", targetId: body.targetInfo?.id,
    title: body.title, content: body.proposed, newFact: body.proposed, reason: "Explicit synthetic placement verdict." };
}
export function reviewedProposal(a: Adventure, p: MemoryProposal): MemoryProposal {
  const target = a.storyCards.find(c => c.id === p.targetId);
  const source = a.messages.find(m => m.id === p.sourceTurnId) ?? a.messages.at(-1)!;
  const next: MemoryProposal = { ...p, storyCardType: target?.type ?? p.storyCardType ?? "lore", userInitiated: false,
    cardOperation: target ? "append" : "create", appendContent: target ? true : undefined,
    memoryMode: p.memoryMode ?? target?.memoryMode ?? "historical" };
  return bindPlacement(a, next, { kind: target ? "append" : "create", newFact: p.content, reason: "Explicit synthetic semantic review." }, [source.id]);
}
export function offlinePlacementReview(request: { messages: Array<{ content: string }> }) {
  if (!request.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) return undefined;
  const body = JSON.parse(request.messages.at(-1)!.content);
  return { content: JSON.stringify({ accepted: true, meaningfulChange: true, reason: "Synthetic supported memory.", identityMatchesTarget: true,
    evidenceMessageIds: body.latestTurnMessageIds, placement: mockPlacementVerdict(body) }), raw: {} };
}
