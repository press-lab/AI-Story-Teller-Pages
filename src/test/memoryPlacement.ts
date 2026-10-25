import type { Adventure, MemoryProposal } from "../types/adventure";
import { bindPlacement } from "../memory/storyCardPlacement";

/** Explicit synthetic semantic review for offline tests. This is not a production classifier. */
export function mockPlacementVerdict(body: { title: string; proposed: string; targetInfo?: { id?: string; type?: string; memoryMode?: string }; latestTurnMessageIds: string[]; recentEvidence: string }) {
  const identity = ["character", "location", "custom"].includes(body.targetInfo?.type ?? "");
  const quote = body.recentEvidence.split(`[${body.latestTurnMessageIds.at(-1)}] assistant: `)[1]?.split("\n\n[")[0] ?? body.proposed;
  return { kind: identity ? "identity" : body.targetInfo?.memoryMode === "living" ? "ongoingLore" : body.targetInfo?.memoryMode === "static" ? "referenceLore" : "historicalLore",
    title: body.title, content: body.proposed, newFact: body.proposed, reason: "Explicit synthetic placement verdict.",
    ...(identity && body.targetInfo?.id ? { identityChange: { targetId: body.targetInfo.id, kind: "transformation", fact: body.proposed,
      evidenceQuotes: [{ messageId: body.latestTurnMessageIds.at(-1)!, quote }], supportingLore: body.proposed } } : {}) };
}

/** Simulate a completed semantic review, bound to this exact synthetic draft. */
export function reviewedProposal(a: Adventure, p: MemoryProposal): MemoryProposal {
  const target = a.storyCards.find(c => c.id === p.targetId);
  const identity = ["character", "location", "custom"].includes(p.storyCardType ?? target?.type ?? "");
  const source = a.messages.find(m => m.id === p.sourceTurnId) ?? a.messages.at(-1)!;
  const next: MemoryProposal = { ...p, storyCardType: p.storyCardType ?? target?.type ?? "lore", userInitiated: false,
    memoryMode: p.memoryMode ?? target?.memoryMode ?? "historical" };
  return bindPlacement(a, next, { kind: identity ? "identity" : next.memoryMode === "living" ? "ongoingLore" : next.memoryMode === "static" ? "referenceLore" : "historicalLore",
    newFact: p.content, reason: "Explicit synthetic semantic review.",
    ...(identity && target ? { identityChange: { targetId: target.id, kind: "transformation", fact: p.content,
      evidenceQuotes: [{ messageId: source.id, quote: source.content }], supportingLore: p.content } } : {}) }, [source.id]);
}

export function offlinePlacementReview(request: { messages: Array<{ content: string }> }) {
  if (!request.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) return undefined;
  const body = JSON.parse(request.messages.at(-1)!.content);
  return { content: JSON.stringify({ accepted: true, meaningfulChange: true, reason: "Synthetic supported memory.", identityMatchesTarget: true,
    evidenceMessageIds: body.latestTurnMessageIds, placement: mockPlacementVerdict(body) }), raw: {} };
}
