import { makeStoryCardSuggestion, scanStoryCardExchange, relevantStoryCardInventory, STORY_CARD_MEMORY_CHECK } from "./storyCardSuggestions";
import { isHistoricalLore, primaryStoryCardType } from "./storyCardArchitecture";
import { sameEventMemory } from "./eventMemory";
import { resolveMemoryEvaluationProviderConfig, safeMemoryFailure } from "../providers/backgroundProvider";
import type { Adventure, AdventureAction, MemoryDiagnostic, MemoryProposal, MemoryDiscoveryCheckpoint, ProviderConfig } from "../types/adventure";
import { memoryCanonMessages } from "./memoryCanon";
import { storyCardContextContent } from "./storyCardPolicy";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import { memoryEvidenceWindow, storyMemoryMessages } from "./memoryEvidenceWindow";
import { validateStoryCardProposal } from "./validateStoryCardProposal";
import { PLACEMENT_VERSION, STORY_CARD_PLACEMENT_POLICY, placementFingerprint } from "./storyCardPlacement";
import { parseDiscoveryCandidate, discoveryEvidenceError } from "./discoveryEvidence";
import { createId, nowIso } from "../utils/id";
import {
  PLOT_ESSENTIALS_BEST_PRACTICES,
  STORY_CARD_BEST_PRACTICES,
  TRIGGER_BEST_PRACTICES,
  storyCardCreationGuidance,
} from "../ai/authoringBestPractices";

function proposalFormatInstruction(proposal: MemoryProposal): string {
  if (proposal.proposedType === "storyCard") {
    const mode = proposal.memoryMode ?? "static";
    const tense =
      mode === "historical"
        ? "Write completed past events in past tense. Do not make resolved events sound current."
        : mode === "living"
          ? "Write the current state of an evolving subject in present tense. Remove or rewrite obsolete current-state facts."
          : "Write always-true facts in present tense.";
    return `Format: bullet points, one per line, no title in the body. This is a ${mode} Story Card. ${tense}
${storyCardCreationGuidance(mode)}
${STORY_CARD_BEST_PRACTICES}
${TRIGGER_BEST_PRACTICES}
If this card has category event, preserve the completed occurrence and its concrete details; do not rewrite it as current relationship state or add a voice contract.
If this card is a character (a person the story will voice), append a VOICE CONTRACT block after the bullets, written in their actual voice:
VOICE CONTRACT
Rhythm: <pace, sentence structure>
Default move: <what they reach for under pressure>
Emotional defense: <how they deflect or armor up>
Never sounds like: <what to avoid: generic, "I feel...", offering choices>
Example lines: "<line>" / "<line>"`;
  }
  if (proposal.proposedType === "plotEssentialsUpdate") {
    return `Format: rewrite the FULL Plot Essentials replacement block as the story's current operating truth. Keep it compact, current, and non-redundant. Remove resolved or stale facts. Do not append a small update note.
${PLOT_ESSENTIALS_BEST_PRACTICES}`;
  }
  if (proposal.proposedType === "plotPressureUpdate") {
    return "Format: exactly one sentence naming the current external threat, obligation, or pressure. Replace the old pressure entirely.";
  }
  if (proposal.proposedType === "currentArcUpdate") {
    return "Format: 1-3 concrete past-tense sentences recording the new completed arc development. Do not summarize the whole arc.";
  }
  return "Format: 1-2 tight bullet points capturing only the durable new constraint or development.";
}

export async function regenerateProposalContent(
  proposal: MemoryProposal,
  adventure: Adventure,
  providerConfig: ProviderConfig,
  convertToLore = false,
): Promise<Partial<MemoryProposal>> {
  if (proposal.proposedType === "storyCard") {
    const source = adventure.messages.find(m => m.id === proposal.sourceTurnId && m.role === "assistant");
    if (!source) throw new Error("This suggestion has no saved narrator source to revalidate.");
    const evidence = memoryEvidenceWindow(adventure, source.id);
    proposal = { ...proposal, sourceText: evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n"),
      evaluationSource: { messages: evidence.map(({ id, content }) => ({ id, content })) },
      storyCardReview: proposal.storyCardReview ? { ...proposal.storyCardReview, sourceContent: source.content,
        playerContent: adventure.messages.find(m => m.id === proposal.storyCardReview?.playerMessageId)?.content,
        additionalSources: evidence.filter(m => m.id !== source.id).map(({ id, content }) => ({ id, content })), evidenceQuotes: undefined } : undefined };
    const response = await sendMemoryCompletion(adventure, providerConfig, [
      ...memoryCanonMessages(adventure, proposal.sourceText, proposal.title),
      { role: "system", content: `${STORY_CARD_PLACEMENT_POLICY}
Regenerate a focused suggestion from evidence. Return ONLY JSON {title,content,storyCardType,memoryMode}. ${convertToLore ? "Extract significant observable history as Lore only. Omit biography, voice and private interpretations." : "Choose the correct placement for the new facts."}` },
      { role: "user", content: JSON.stringify({ title: proposal.title, previousDraft: proposal.content, source: proposal.sourceText,
        evidence: proposal.storyCardReview, target: adventure.storyCards.find(c => c.id === proposal.targetId) }) },
    ]);
    const raw = JSON.parse(response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!raw || typeof raw.title !== "string" || typeof raw.content !== "string" || !["character", "location", "lore", "custom"].includes(raw.storyCardType)
      || !["static", "living", "historical"].includes(raw.memoryMode) || (convertToLore && raw.storyCardType !== "lore")) throw new Error("Invalid regenerated placement draft.");
    const result = await validateStoryCardProposal(adventure, providerConfig, { ...proposal, title: raw.title, content: raw.content,
      storyCardType: raw.storyCardType, memoryMode: raw.memoryMode, targetId: raw.storyCardType === proposal.storyCardType ? proposal.targetId : undefined,
      appendContent: raw.storyCardType === proposal.storyCardType ? proposal.appendContent : undefined });
    if (!result.proposal) throw new Error(result.error ?? "No supported new memory was found.");
    if (convertToLore && result.proposal.storyCardType !== "lore") throw new Error("The evidence does not support this conversion to Lore.");
    return result.proposal;
  }
  const systemPrompt = `You are a world-memory assistant for an interactive fiction game.
The user has a memory suggestion they want better content for.
Write improved content for the suggestion titled "${proposal.title}" (type: ${proposal.proposedType}, card category: ${proposal.storyCardType ?? "unspecified"}).
Source text from the story: ${proposal.sourceText}
${proposalFormatInstruction(proposal)}
Respond with ONLY the content: no JSON, no preamble, no labels.`;

  const response = await sendOpenAICompatibleChatCompletion({
    config: resolveMemoryEvaluationProviderConfig(adventure, providerConfig),
    memoryEvaluation: true, thinking: "disabled", retry: false,
    messages: [...memoryCanonMessages(adventure, proposal.sourceText, proposal.title), { role: "user", content: systemPrompt }],
  });

  return { content: response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() };
}


function normalizedFacts(content: string): string[] {
  return content.split(/\n+/).map(line => line.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Exact fact coverage only: similar subjects can still have distinct new facts. */
function alreadyCaptured(content: string, existing: string[]): boolean {
  const facts = normalizedFacts(content);
  const known = new Set(existing.flatMap(normalizedFacts));
  return facts.length > 0 && facts.every(fact => known.has(fact));
}

/** Catch up across the configured interval without replacing existing-card updates. */
export async function detectStoryCardProposals(adventure: Adventure, providerConfig: ProviderConfig, options: { messages?: Adventure["messages"]; eventsOnly?: boolean; sourceId?: string } = {}) {
  const result = {
    actions: [] as AdventureAction[], errors: [] as string[], evaluated: false,
    checkpoint: undefined as MemoryDiscoveryCheckpoint | undefined,
    tokenUsage: { promptTokens: 0, completionTokens: 0 },
  };
  if (!options.eventsOnly && !adventure.memoryDetectionSettings.enabled) return result;
  const storyIds = new Set(storyMemoryMessages(adventure).map(message => message.id));
  const messages = (options.messages ?? (options.sourceId ? memoryEvidenceWindow(adventure, options.sourceId) : storyMemoryMessages(adventure)
    .slice(-Math.max(8, adventure.semanticEvaluationSettings.messagesIncluded,
      2 * adventure.memoryDetectionSettings.everyNTurns)))).filter(m => storyIds.has(m.id));
  if (!messages.some(m => m.role === "assistant" && m.content.trim())) return result;
  result.evaluated = true;
  const diagnostic = (outcome: MemoryDiagnostic["outcome"], reason: string, kind = "semanticLore") => {
    const sourceId = options.sourceId ?? messages.filter(message => message.role === "assistant").at(-1)!.id;
    result.actions.push({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: createId("decision"), sourceId, createdAt: nowIso(),
      stage: "candidate", outcome, candidateKinds: [kind], reason } });
  };
  const excerpt = messages.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n");
  // Older catch-up tools retain their response envelope, but use the same local
  // scanner, matcher and review records as normal play and Chronicle evaluation.
  for (const source of messages.filter(message => message.role === "assistant" && message.inputMode !== "comms" && (!options.sourceId || message.id === options.sourceId)).slice(-12)) {
    for (const proposal of scanStoryCardExchange(adventure, source)) {
      if (options.eventsOnly && proposal.storyCardType !== "lore") continue;
      result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      diagnostic("candidates_produced", "Deterministic identity nomination; not a semantic Lore finding.", "deterministicIdentity");
    }
  }
  const considered = adventure.activeState.memoryProposals.filter(p => p.proposedType === "storyCard");
  const capturedContent = [
    ...adventure.storyCards.flatMap(c => [c.content, storyCardContextContent(c)]),
    ...considered.flatMap(p => [p.content, p.title + " " + p.content]),
  ];
  // All duplicate checks stay local. Only bounded relevant targets reach the model.
  const cardInventory = relevantStoryCardInventory(adventure, excerpt);
  const proposalInventory = considered.filter(p => excerpt.toLowerCase().includes(p.title.toLowerCase())).slice(-8)
    .map(p => ({ title: p.title, status: p.status }));
  const sourceId = options.sourceId ?? messages.filter(message => message.role === "assistant").at(-1)!.id;
  const attempt = adventure.messages.find(message => message.id === sourceId)?.memoryEvaluation?.attempts ?? 0;
  let activeIndex: number | undefined;
  const record = (outcome: MemoryDiagnostic["outcome"], reason: string, extra: Partial<MemoryDiagnostic> = {}) => {
    result.actions.push({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: createId("decision"), sourceId,
      createdAt: nowIso(), stage: "candidate", group: "discovery", candidateKinds: ["semanticLore"],
      evaluationAttempt: attempt, candidateIndex: activeIndex, outcome, reason, ...extra } });
  };
  const dependencies = messages.map(({ id, content }) => ({ id, content }));
  let received = false;
  try {
    // The digest protects cached reviews from changes to canon, target controls and
    // author corrections, without duplicating the whole card archive in each save.
    const references = JSON.stringify({ placementVersion: PLACEMENT_VERSION, cards: adventure.storyCards, components: adventure.components,
      corrections: adventure.messages.filter(message => message.role === "user" && message.inputMode === "comms").slice(-4),
      settings: adventure.memoryDetectionSettings });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(references));
    const referenceFingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    const prior = options.sourceId ? adventure.messages.find(message => message.id === sourceId)?.memoryEvaluation?.discoveryCheckpoint : undefined;
    const reusable = prior?.version === 1 && prior.candidates.length <= 3 && prior.referenceFingerprint === referenceFingerprint
      && JSON.stringify(prior.dependencies) === JSON.stringify(dependencies);
    if (prior && !reusable) record("checkpoint_invalidated", "Evidence, canon or destination controls changed; cached discovery reviews were discarded.");
    let candidates: MemoryDiscoveryCheckpoint["candidates"];
    if (reusable) {
      candidates = prior.candidates.map(draft => ({ ...draft }));
    } else {
      const response = await sendMemoryCompletion(adventure, providerConfig, [
          { role: "system", content: `${STORY_CARD_MEMORY_CHECK}
  ${options.eventsOnly ? "Evaluate completed history as Lore only." : "Evaluate the supplied completed exchanges."}
  ${options.sourceId ? `The latest establishing exchange ends at narrator source ${options.sourceId}; the immediately preceding player action belongs to that exchange. Earlier exchanges are supporting context. Every finding must include the literal ID ${options.sourceId} in evidenceMessageIds and an exact quote from that message. Cite the player action too when needed to establish who acted. Do not substitute a numeric turn, card ID or invented ID. Only propose developments established in source ${options.sourceId}. Earlier exchanges supply attribution and continuity, not events happening again now. Cite that establishing source and all necessary earlier evidence. Include evidenceQuotes:[{messageId,quote}] with exact unmodified quotes from the supplied original messages. Also provide memoryMode: historical|living|static and eventStatus: completed|ongoing|unresolved. A confirmed agreement is completed history even when the agreed future work remains unfinished. A discovery can have separate historical Lore and character-private Brain reactions; do not put private thoughts into this public record. Propose at most three findings.` : ""}
  Return ONLY a JSON array, [] when nothing qualifies. Each item: {"title":"subject or existing title","targetId":"existing ID for an update, otherwise omit","content":"NEW fact only; max 70 words","storyCardType":"lore|character|location|custom","suggestedTriggers":["3-6 short reusable topic phrases covering the card content; use ordinary future wording, not exact scene sentences or just the full title; never empty"],"rationale":"why durable","evidenceMessageIds":["supplied source IDs"],"evidenceQuotes":[{"messageId":"supplied source ID","quote":"exact unmodified supporting quote"}],"memoryMode":"historical|living|static","eventStatus":"completed|ongoing|unresolved","candidateOnly":false}. Set candidateOnly=true for uncertain interpretations and explicit attempts requiring review. An uncertain interpretation must use eventStatus=unresolved. A completed attempt can use memoryMode=historical,eventStatus=completed while its intended outcome remains uncompleted. Never assert a confirmed kiss attempt from an ambiguous lean. Routine hospitality and scene filler do not qualify. Do not repeat dismissed or already captured facts. This legacy catch-up response is adapted into the shared Story Card pipeline.` },
          ...memoryCanonMessages(adventure, excerpt, "Discover missing Story Cards", true),
          { role: "user", content: "Relevant existing cards: " + JSON.stringify(cardInventory) },
          { role: "user", content: "Previously considered Story Card proposals (including dismissed; omit duplicates): " + JSON.stringify(proposalInventory) },
          { role: "user", content: (options.sourceId ? `Establishing narrator ID: ${options.sourceId}\nAllowed evidence message IDs: ${messages.map(message => message.id).join(", ")}\n` : "") + "Recent story evidence:\n" + excerpt },
        ]);

      result.tokenUsage.promptTokens += response.usage?.promptTokens ?? 0;
      result.tokenUsage.completionTokens += response.usage?.completionTokens ?? 0;
      received = true;
      const raw = response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
        .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Discovery response was not an array.");
      if (options.sourceId && parsed.length > 3) throw new Error("Discovery exceeded its three-finding limit.");
      record(parsed.length ? "candidates_produced" : "zero_candidates", `Semantic discovery returned ${parsed.length} candidates (before validation).`);
      candidates = parsed.slice(0, options.sourceId ? 3 : 12).map((raw, index) => {
        activeIndex = index;
        const parsed = parseDiscoveryCandidate(raw);
        if (parsed.error) {
          record("validation_rejected", parsed.error.reason, { failureCode: parsed.error.code, failureCategory: "invalid_model_output" });
          return { candidate: parsed.candidate, status: "rejected" as const, reason: parsed.error.reason, failureCode: parsed.error.code };
        }
        return { candidate: parsed.candidate, status: "awaiting_retry" as const };
      });
    }
    for (const [index, draft] of candidates.entries()) {
      activeIndex = index;
      if (draft.status !== "awaiting_retry") continue;
      const item = draft.candidate, title = item.title;
      const reject = (reason: string, code: string) => {
        draft.status = "rejected"; draft.reason = reason; draft.failureCode = code;
        record("validation_rejected", reason, { failureCode: code, failureCategory: "invalid_model_output" });
      };
      const suppress = (reason: string) => {
        draft.status = "suppressed"; draft.reason = reason;
        record("candidate_suppressed", reason);
      };
      const error = discoveryEvidenceError(item, messages, options.sourceId);
      if (error) { reject(error.reason, error.code); continue; }
      const evidence = messages.filter(message => item.evidenceMessageIds.includes(message.id));
      if (item.storyCardType !== "event" && alreadyCaptured(item.content, capturedContent)) {
        suppress("Semantic candidate duplicates already captured facts."); continue;
      }
      const isEvent = item.storyCardType === "event" || Boolean(item.eventMemory);
      if (options.eventsOnly && !isEvent) { suppress("Only historical event findings were requested."); continue; }
      const eventMemory = isEvent ? {
        sourceMessageIds: evidence.map(message => message.id),
        participants: item.eventMemory?.participants ?? [], recallCues: item.eventMemory?.recallCues ?? [],
        kind: (["first", "commitment", "revelation", "choice", "sharedExperience"].includes(item.eventMemory?.kind ?? "")
          ? item.eventMemory!.kind : "sharedExperience") as NonNullable<MemoryProposal["eventMemory"]>["kind"],
      } : undefined;
      if (isEvent && (!eventMemory?.participants.length || !eventMemory.recallCues.length)) {
        reject("Event discovery requires participants and recall cues.", "discovery_event_schema_invalid"); continue;
      }
      if (isEvent && [...adventure.storyCards.filter(isHistoricalLore), ...considered.filter(proposal => Boolean(proposal.eventMemory))]
        .some(existing => sameEventMemory(existing, { content: item.content, eventMemory }))) {
        suppress("Historical event is already recorded."); continue;
      }
      const source = (options.sourceId ? messages.find(message => message.id === sourceId)
        : isEvent ? evidence.find(message => message.role === "assistant") : evidence.filter(message => message.role === "assistant").at(-1))
        ?? messages.find((message, index) => message.role === "assistant" && evidence.some(item => messages[index - 1]?.id === item.id));
      if (!source) { reject("Discovery has no establishing narrator.", "discovery_missing_establishing_source"); continue; }
      if (item.targetId && !adventure.storyCards.some(card => card.id === item.targetId)) {
        suppress("Unknown existing-card target."); continue;
      }
      let proposal = makeStoryCardSuggestion(adventure, source.id, source.content, {
        title, content: item.content, evidence: evidence.map(message => `[${message.id}] ${message.role}: ${message.content}`).join("\n\n"),
        reason: item.rationale ?? "Grounded catch-up finding; review before applying.",
        type: isEvent ? "lore" : primaryStoryCardType(item.storyCardType), targetId: item.targetId,
        triggers: item.suggestedTriggers ?? eventMemory?.recallCues, participants: eventMemory?.participants,
        evidenceReviewed: Boolean(options.sourceId), candidateOnly: item.candidateOnly === true || item.eventStatus === "unresolved",
      });
      if (item.memoryMode) proposal.memoryMode = item.memoryMode;
      if (item.eventStatus && proposal.lore) proposal.lore.status = item.eventStatus;
      {
        const validation = await validateStoryCardProposal(adventure, providerConfig, proposal, result.tokenUsage);
        if (!validation.changed) {
          draft.status = validation.retryable ? "awaiting_retry" : "rejected";
          draft.reason = validation.error ?? "No new durable change.";
          draft.failureCode = validation.failureCode;
          record(validation.retryable ? "candidate_awaiting_retry" : "validation_rejected", draft.reason, {
            failureCode: validation.failureCode, providerCode: validation.providerCode, httpStatus: validation.httpStatus,
            failureCategory: validation.retryable ? validation.failureCode === "memory_provider_request_failed" ? "transport_api" : "invalid_model_output" : undefined,
            candidate: { kind: "storyCard", title, content: item.content, evidence: evidence.map(message => `[${message.id}] ${message.content}`).join("\n"), rationale: item.rationale ?? "" },
          });
          if (validation.retryable) result.errors.push(draft.reason);
          continue;
        }
        proposal = validation.proposal!;
      }
      const destination = adventure.storyCards.find(card => card.id === proposal.targetId);
      if (destination?.autoUpdate === false) {
        suppress("Existing-card autoUpdate=false; independent new Lore remains eligible."); continue;
      }
      proposal.storyCardReview = { ...proposal.storyCardReview!, additionalSources: evidence.filter(message => message.id !== source.id).map(({ id, content }) => ({ id, content })) };
      if (options.sourceId) proposal.storyCardReview.evidenceQuotes = item.evidenceQuotes;
      if (item.eventStatus === "unresolved") proposal.requiresReview = true;
      if (proposal.lore) proposal.lore.sourceMessageIds = [...new Set([...proposal.lore.sourceMessageIds, ...evidence.map(message => message.id)])];
      if (eventMemory) { proposal.eventMemory = eventMemory; proposal.memoryMode = "historical"; proposal.requiresReview = true; }
      if (!options.eventsOnly && !adventure.memoryDetectionSettings.generateContent) { proposal.content = ""; proposal.requiresReview = true; }
      if (proposal.placementValidation) proposal.placementValidation.fingerprint = placementFingerprint(proposal);
      draft.status = "accepted"; draft.proposal = proposal; draft.reason = undefined; draft.failureCode = undefined;
      capturedContent.push(item.content);
      record("validation_accepted", `Placement: ${proposal.placementValidation?.kind}; destination: ${proposal.storyCardType} ${proposal.targetId ?? "CREATE"}. ${proposal.placementValidation?.reason ?? "Candidate passed evidence validation."}`);
    }
    activeIndex = undefined;
    const counts = { returned: candidates.length, accepted: 0, rejected: 0, suppressed: 0, retryPending: 0 };
    for (const draft of candidates) {
      if (draft.status === "awaiting_retry") counts.retryPending++;
      else counts[draft.status]++;
    }
    record("discovery_summary", reusable ? "Resumed discovery validation from saved drafts; no discovery generation request was sent." : "Discovery candidate outcomes for this attempt.", { counts });
    if (counts.retryPending && options.sourceId) {
      result.checkpoint = { version: 1, dependencies, referenceFingerprint, candidates };
    } else if (candidates.length && candidates.every(draft => draft.status === "rejected" && draft.failureCode?.startsWith("discovery_"))) {
      result.errors.push("memory_model_output_invalid: All discovery candidates failed source/schema validation.");
    }
    // Proposals leave the checkpoint only when the whole group can commit. In
    // particular, a failed validator never publishes its successful siblings early.
    if (!result.errors.length) for (const draft of candidates) {
      if (draft.status === "accepted" && draft.proposal) result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: draft.proposal });
    }
  } catch (error) {
    const failure = safeMemoryFailure(error, received);
    const reason = error instanceof Error && /^(Discovery |Invalid discovery)/.test(error.message) ? error.message : failure.message;
    record("evaluation_failed", reason, { failureCategory: failure.category, failureCode: failure.code,
      providerCode: failure.providerCode, httpStatus: failure.httpStatus });
    result.errors.push(`Story Card discovery failed: ${reason}`);
  }
  return result;
}
