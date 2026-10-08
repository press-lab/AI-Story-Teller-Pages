import type { Adventure, MemoryProposal } from "../types/adventure";
import type { AuditRecommendation } from "./storyCardAudit";
import { createId, nowIso } from "../utils/id";

export function storyCardAuditSuggestions(a: Adventure, recommendations: AuditRecommendation[]): MemoryProposal[] {
  return recommendations.flatMap(rec => {
    const target = a.storyCards.find(c => c.id === rec.cardId);
    if (rec.action !== "create" && !target) return [];
    const timestamp = nowIso();
    return [{ id: createId("proposal"), proposedType: "storyCard" as const, title: rec.title,
      content: rec.editedContent, suggestedTriggers: rec.editedKeys.split(",").map(key => key.trim()).filter(Boolean),
      storyCardType: rec.suggestedType, memoryMode: rec.suggestedMemoryMode, targetId: rec.action === "create" ? undefined : target!.id,
      sourceTurnId: a.messages.at(-1)?.id ?? "card-audit", sourceText: target?.content ?? "",
      rationale: `Story Card Cleanup (${rec.source}): ${rec.rationale}`, confidence: rec.source === "deterministic" ? 1 : 0.75,
      requiresReview: true, status: "pending" as const, createdAt: timestamp, updatedAt: timestamp,
      cardAudit: { action: rec.action, expectedRevision: rec.action === "create" ? null : target!.updatedAt } }];
  });
}

/** Cleanup is explicit authoring, using the same card actions as the manual editor. */
export function cardAuditReviewError(a: Adventure, p: MemoryProposal): string | undefined {
  const audit = p.cardAudit;
  if (!audit || p.proposedType !== "storyCard" || !["edit", "delete", "create"].includes(audit.action)) return "Invalid card cleanup suggestion.";
  if (audit.action === "create") {
    if (audit.expectedRevision !== null || p.targetId || a.storyCards.some(c => c.title.trim().toLowerCase() === p.title.trim().toLowerCase())) return "A card with this title already exists.";
  } else if (!p.targetId || typeof audit.expectedRevision !== "string" || !a.storyCards.some(c => c.id === p.targetId && c.updatedAt === audit.expectedRevision)) return "The target card changed or was deleted after this cleanup. Run cleanup again.";
  if (audit.action !== "delete" && (!p.title.trim() || !p.content.trim()
    || !["character", "location", "lore", "plot", "event", "custom"].includes(p.storyCardType ?? "")
    || !["static", "living", "historical"].includes(p.memoryMode ?? ""))) return "Complete the card title, content, type and memory mode before approval.";
}
