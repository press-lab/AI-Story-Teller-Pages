import type { Adventure, MemoryProposal, ProviderConfig } from "../types/adventure";
import { validateMemoryUpdate, type MemoryValidationResult } from "./validateMemoryUpdate";
import { bindPlacement, placementCardType, placementMode, placementValidationError } from "./storyCardPlacement";
import { makeStoryCardSuggestion } from "./storyCardSuggestions";

/** At most one repair/review. Content extracted by a reviewer is never approved unreviewed. */
export async function validateStoryCardProposal(a: Adventure, config: ProviderConfig, draft: MemoryProposal,
  accum?: { promptTokens: number; completionTokens: number }): Promise<MemoryValidationResult & { proposal?: MemoryProposal }> {
  const sourceIndex = a.messages.findIndex(m => m.id === draft.sourceTurnId && m.role === "assistant");
  if (sourceIndex < 0) return { changed: false, error: "Placement requires an existing narrator source.", failureCode: "memory_placement_source_invalid" };
  const snapshot = { ...a, messages: a.messages.slice(0, sourceIndex + 1) };
  let current: MemoryProposal = { ...draft, userInitiated: undefined, placementValidation: undefined };
  for (let pass = 0; pass < 2; pass++) {
    const target = snapshot.storyCards.find(c => c.id === current.targetId);
    const verdict = await validateMemoryUpdate(snapshot, config, "storyCard", current.title, target?.content ?? "", current.content,
      accum, current.appendContent ?? true, current.storyCardReview?.candidateOnly ?? false,
      { id: target?.id, type: target?.type ?? current.storyCardType ?? "lore", memoryMode: current.memoryMode });
    const repairAttribution = verdict.failureCode === "memory_identity_rejected" && target && target.type !== "lore"
      && ["historicalLore", "ongoingLore", "referenceLore"].includes(verdict.placement?.kind ?? "");
    if ((!verdict.changed && !repairAttribution) || !verdict.placement) return verdict;
    if (!verdict.evidenceMessageIds?.includes(draft.sourceTurnId)) return { changed: false, retryable: true,
      failureCode: "memory_placement_source_invalid", error: "Placement lacks the establishing narrator source." };
    const p = verdict.placement;
    const type = placementCardType(p.kind, target?.type ?? current.storyCardType);
    const keepTarget = target?.type === type ? target : undefined;
    const mode = p.kind === "identity" ? keepTarget?.memoryMode ?? "static" : placementMode(p.kind);
    const suggestion = makeStoryCardSuggestion(snapshot, current.sourceTurnId, snapshot.messages.at(-1)!.content, {
      title: keepTarget?.title ?? p.title, content: p.content, type, targetId: keepTarget?.id,
      evidence: current.sourceText, reason: current.rationale, evidenceReviewed: true,
      triggers: current.suggestedTriggers, participants: current.storyCardReview?.participants,
      candidateOnly: current.storyCardReview?.candidateOnly,
    });
    let next: MemoryProposal = { ...current, ...suggestion, id: draft.id, createdAt: draft.createdAt,
      storyCardPatch: keepTarget && suggestion.targetId === current.targetId ? current.storyCardPatch : undefined,
      memoryMode: mode, appendContent: suggestion.targetId ? (type === "lore" ? true : current.appendContent ?? false) : undefined,
      storyCardReview: { ...suggestion.storyCardReview!, additionalSources: current.storyCardReview?.additionalSources,
        evidenceQuotes: current.storyCardReview?.evidenceQuotes },
      lore: type === "lore" ? { ...suggestion.lore!, status: p.kind === "historicalLore" ? current.lore?.status ?? "completed" : p.kind === "ongoingLore" ? current.lore?.status ?? "ongoing" : "unresolved",
        sourceMessageIds: [...new Set([...(current.lore?.sourceMessageIds ?? []), ...verdict.evidenceMessageIds!])] } : undefined,
      requiresReview: current.requiresReview || suggestion.requiresReview || p.kind === "identity",
      eventMemory: type === "lore" ? current.eventMemory : undefined,
      evaluationSource: current.evaluationSource ? { ...current.evaluationSource, target: undefined } : undefined,
    };
    const changedDraft = next.content !== current.content || next.storyCardType !== (current.storyCardType ?? target?.type ?? "lore")
      || next.targetId !== current.targetId || next.title !== current.title;
    if (changedDraft) {
      if (pass === 1) return { changed: false, retryable: true, failureCode: "memory_placement_unstable", error: "memory_model_output_invalid: Placement repair changed again during final review." };
      current = next;
      continue;
    }
    if (p.identityChange?.supportingLore && p.identityChange.supportingLore !== current.content) {
      const history = await validateMemoryUpdate(snapshot, config, "storyCard", `${next.title}: Identity change`, "", p.identityChange.supportingLore,
        accum, true, false, { type: "lore", memoryMode: "historical" });
      if (!history.changed || !history.placement) return history;
      if (history.placement.kind !== "historicalLore" || history.placement.content !== p.identityChange.supportingLore) return {
        changed: false, retryable: true, failureCode: "memory_placement_unstable", error: "Supporting identity history did not pass its final Lore review." };
    }
    next = bindPlacement(snapshot, next, { kind: p.kind, newFact: p.newFact, reason: p.reason, identityChange: p.identityChange }, verdict.evidenceMessageIds!);
    const error = placementValidationError(snapshot, next);
    if (error) return { changed: false, retryable: true, failureCode: "memory_placement_invalid", error };
    return { ...verdict, proposal: next };
  }
  return { changed: false };
}
