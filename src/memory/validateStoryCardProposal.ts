import { proposalCoverage } from "./factCoverage";
import { primaryStoryCardType } from "./storyCardArchitecture";
import type { Adventure, MemoryProposal, ProviderConfig } from "../types/adventure";
import { validateMemoryUpdate, type MemoryValidationResult } from "./validateMemoryUpdate";
import { bindPlacement, placementValidationError } from "./storyCardPlacement";
import { makeStoryCardSuggestion } from "./storyCardSuggestions";

/** One correction and a final review of a frozen factual delta. */
export async function validateStoryCardProposal(a: Adventure, config: ProviderConfig, draft: MemoryProposal,
  accum?: { promptTokens: number; completionTokens: number }, cache?: Record<string, string>): Promise<MemoryValidationResult & { proposal?: MemoryProposal }> {
  if (proposalCoverage(a, draft)) return { changed: false, failureCode: "memory_fact_covered", error: "Factual delta already recorded or considered." };
  const sourceIndex = a.messages.findIndex(m => m.id === draft.sourceTurnId && m.role === "assistant");
  if (sourceIndex < 0) return { changed: false, error: "Placement requires an existing narrator source.", failureCode: "memory_placement_source_invalid" };
  const snapshot = { ...a, messages: a.messages.slice(0, sourceIndex + 1) };
  let current: MemoryProposal = { ...draft, userInitiated: undefined, placementValidation: undefined };
  if (current.targetId && !a.storyCards.some(c => c.id === current.targetId)) return { changed: false,
    error: "Unknown Story Card destination.", failureCode: "memory_placement_target_invalid" };
  for (let pass = 0; pass < 2; pass++) {
    const target = snapshot.storyCards.find(c => c.id === current.targetId);
    const verdict = await validateMemoryUpdate(snapshot, config, "storyCard", current.title, target?.content ?? "", current.content,
      accum, true, current.storyCardReview?.candidateOnly ?? false,
      { id: target?.id, type: target?.type ?? current.storyCardType ?? "lore", finalReview: pass === 1 }, cache);
    const p = verdict.placement;
    if (!p || (!verdict.changed && pass === 1)) return verdict;
    if (!verdict.evidenceMessageIds?.includes(draft.sourceTurnId)) return { changed: false, retryable: true,
      failureCode: "memory_placement_source_invalid", error: "Placement lacks the establishing narrator source." };
    if (p.kind === "brain" || p.kind === "none") return verdict;
    const correctedTarget = p.targetId ? snapshot.storyCards.find(c => c.id === p.targetId) : undefined;
    if (p.targetId && !correctedTarget) return { changed: false, error: "Unknown reviewed destination.", failureCode: "memory_placement_target_invalid" };
    const legacyLoreRepair = ["historicalLore", "ongoingLore", "referenceLore"].includes(p.kind);
    const nextTarget = legacyLoreRepair || p.kind === "create" ? undefined : correctedTarget ?? target;
    const type = nextTarget?.type ?? (legacyLoreRepair ? "lore" : p.kind === "create" ? p.cardType ?? "lore" : primaryStoryCardType(current.storyCardType ?? "lore"));
    const suggestion = makeStoryCardSuggestion(snapshot, current.sourceTurnId, snapshot.messages.at(-1)!.content, {
      title: nextTarget?.title ?? p.title, content: pass === 1 ? current.content : p.content, type,
      targetId: nextTarget?.id, evidence: current.sourceText, reason: current.rationale, evidenceReviewed: true,
      triggers: current.suggestedTriggers, participants: current.storyCardReview?.participants,
      candidateOnly: current.storyCardReview?.candidateOnly,
    });
    const chosen = legacyLoreRepair || p.kind === "create" ? undefined : suggestion.targetId;
    let next: MemoryProposal = { ...current, ...suggestion, id: draft.id, createdAt: draft.createdAt,
      targetId: chosen, storyCardType: chosen ? snapshot.storyCards.find(c => c.id === chosen)!.type : type,
      cardOperation: chosen ? "append" : "create", appendContent: chosen ? true : undefined,
      storyCardPatch: undefined,
      memoryMode: current.memoryMode ?? nextTarget?.memoryMode ?? "static",
      storyCardReview: { ...suggestion.storyCardReview!, operation: chosen ? "update" : "create",
        additionalSources: current.storyCardReview?.additionalSources, evidenceQuotes: current.storyCardReview?.evidenceQuotes },
      lore: type === "lore" ? { ...suggestion.lore!, ...current.lore,
        sourceMessageIds: [...new Set([...(current.lore?.sourceMessageIds ?? []), ...verdict.evidenceMessageIds])] } : undefined,
      requiresReview: Boolean(current.requiresReview || suggestion.requiresReview || nextTarget?.protected),
      evaluationSource: current.evaluationSource ? { ...current.evaluationSource, target: undefined } : undefined,
    };
    const changedDraft = next.content !== current.content || next.targetId !== current.targetId || next.storyCardType !== (current.storyCardType ?? target?.type ?? "lore");
    if (!verdict.changed && !changedDraft) return verdict;
    if (changedDraft || !verdict.changed) {
      if (pass === 1) return { changed: false, retryable: true, failureCode: "memory_placement_unstable", error: "Final review changed the destination; retry required." };
      current = next;
      continue;
    }
    next = bindPlacement(snapshot, next, { kind: chosen ? "append" : "create", newFact: p.newFact, reason: p.reason, identityChange: p.identityChange }, verdict.evidenceMessageIds);
    const error = placementValidationError(snapshot, next);
    if (error) return { changed: false, retryable: true, failureCode: "memory_placement_invalid", error };
    return { ...verdict, proposal: next };
  }
  return { changed: false };
}
