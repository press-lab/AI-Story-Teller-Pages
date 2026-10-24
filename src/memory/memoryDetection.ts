import { makeStoryCardSuggestion, scanStoryCardExchange, relevantStoryCardInventory, STORY_CARD_MEMORY_CHECK } from "./storyCardSuggestions";
import { isHistoricalLore, primaryStoryCardType } from "./storyCardArchitecture";
import { sameEventMemory } from "./eventMemory";
import { resolveMemoryEvaluationProviderConfig, safeMemoryFailure } from "../providers/backgroundProvider";
import type { Adventure, AdventureAction, MemoryDiagnostic, MemoryProposal, ProviderConfig } from "../types/adventure";
import { memoryCanonMessages } from "./memoryCanon";
import { storyCardContextContent } from "./storyCardPolicy";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import { memoryEvidenceWindow, storyMemoryMessages } from "./memoryEvidenceWindow";
import { validateMemoryUpdate } from "./validateMemoryUpdate";
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
): Promise<string> {
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

  return response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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
  let received = false;
  try {
    const response = await sendMemoryCompletion(adventure, providerConfig, [
        { role: "system", content: `${STORY_CARD_MEMORY_CHECK}
${options.eventsOnly ? "Evaluate completed history as Lore only." : "Evaluate the supplied completed exchanges."}
${options.sourceId ? `Only propose developments established in source ${options.sourceId}. Earlier exchanges supply attribution and continuity, not events happening again now. Cite that establishing source and all necessary earlier evidence. Include evidenceQuotes:[{messageId,quote}] with exact unmodified quotes from the supplied original messages. Also provide memoryMode: historical|living|static and eventStatus: completed|ongoing|unresolved. A confirmed agreement is completed history even when the agreed future work remains unfinished. A discovery can have separate historical Lore and character-private Brain reactions; do not put private thoughts into this public record. Propose at most three findings.` : ""}
Return ONLY a JSON array, [] when nothing qualifies. Each item: {"title":"subject or existing title","targetId":"existing ID for an update, otherwise omit","content":"NEW fact only; max 70 words","storyCardType":"lore|character|location|custom","suggestedTriggers":["3-6 short reusable topic phrases covering the card content; use ordinary future wording, not exact scene sentences or just the full title; never empty"],"rationale":"why durable","evidenceMessageIds":["supplied source IDs"],"evidenceQuotes":[{"messageId":"supplied source ID","quote":"exact unmodified supporting quote"}],"memoryMode":"historical|living|static","eventStatus":"completed|ongoing|unresolved","candidateOnly":false}. Set candidateOnly=true for uncertain interpretations and explicit attempts requiring review. An uncertain interpretation must use eventStatus=unresolved. A completed attempt can use memoryMode=historical,eventStatus=completed while its intended outcome remains uncompleted. Never assert a confirmed kiss attempt from an ambiguous lean. Routine hospitality and scene filler do not qualify. Do not repeat dismissed or already captured facts. This legacy catch-up response is adapted into the shared Story Card pipeline.` },
        ...memoryCanonMessages(adventure, excerpt, "Discover missing Story Cards", true),
        { role: "user", content: "Relevant existing cards: " + JSON.stringify(cardInventory) },
        { role: "user", content: "Previously considered Story Card proposals (including dismissed; omit duplicates): " + JSON.stringify(proposalInventory) },
        { role: "user", content: "Recent story evidence:\n" + excerpt },
      ]);
    result.tokenUsage.promptTokens += response.usage?.promptTokens ?? 0;
    result.tokenUsage.completionTokens += response.usage?.completionTokens ?? 0;
    received = true;
    const raw = response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Discovery response was not an array.");
    if (options.sourceId && parsed.length > 3) throw new Error("Discovery exceeded its three-finding limit.");
    diagnostic(parsed.length ? "candidates_produced" : "zero_candidates", `Semantic discovery returned ${parsed.length} candidates (before validation).`);
    for (const item of parsed) {
      if (!item || typeof item !== "object" || typeof item.title !== "string" || !item.title.trim()
        || typeof item.content !== "string" || !item.content.trim()) throw new Error("Discovery candidate has invalid title/content.");
      const title = item.title.trim();
      // Event records are independent of character/current-state coverage.
      // Their occurrence-aware dedupe below also preserves distinct occasions.
      if (item.storyCardType !== "event" && alreadyCaptured(item.content, capturedContent)) { diagnostic("candidate_suppressed", "Semantic candidate duplicates already captured facts."); continue; }
      const evidence = messages.filter(m => Array.isArray(item.evidenceMessageIds) && item.evidenceMessageIds.includes(m.id));
      if (options.sourceId && (!evidence.length || !evidence.some(message => message.id === options.sourceId)
        || item.evidenceMessageIds.some((id: unknown) => !messages.some(message => message.id === id)))) throw new Error("Discovery lacks valid establishing source evidence.");
      if (evidence.length === 0) continue;
      if (item.evidenceMessageIds.some((id: unknown) => !messages.some(m => m.id === id))) continue;
      if (options.sourceId) {
        if (!["historical", "living", "static"].includes(item.memoryMode) || !["completed", "ongoing", "unresolved"].includes(item.eventStatus)
          || (item.candidateOnly !== undefined && typeof item.candidateOnly !== "boolean")) throw new Error("Discovery has invalid or missing memory mode/event status.");
        if (!Array.isArray(item.evidenceQuotes) || !item.evidenceQuotes.length || item.evidenceQuotes.some((quote: { messageId?: unknown; quote?: unknown }) => !quote
          || typeof quote.quote !== "string" || !quote.quote.trim() || !evidence.some(message => message.id === quote.messageId && message.content.includes(quote.quote as string)))) {
          throw new Error("Discovery lacks exact supporting quotes from its referenced sources.");
        }
        if (!item.evidenceQuotes.some((quote: { messageId: string }) => quote.messageId === options.sourceId)) throw new Error("Discovery lacks a quote from the establishing source.");
        const target = typeof item.targetId === "string" ? adventure.storyCards.find(card => card.id === item.targetId) : undefined;
        const validation = await validateMemoryUpdate(adventure, providerConfig, "storyCard", title, target?.content ?? "", item.content, result.tokenUsage, true, item.candidateOnly === true || item.eventStatus === "unresolved");
        if (!validation.changed) {
          result.actions.push({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: createId("decision"), sourceId: options.sourceId, createdAt: nowIso(),
            stage: "candidate", outcome: "validation_rejected", candidateKinds: ["semanticLore"], reason: validation.error ?? "No new durable change.",
            candidate: { kind: "storyCard", title, content: item.content, evidence: evidence.map(message => `[${message.id}] ${message.content}`).join("\n"), rationale: item.rationale ?? "" } } });
          if (validation.retryable) result.errors.push(validation.error ?? "Discovery validation failed.");
          continue;
        }
      }
      const isEvent = item.storyCardType === "event" || Boolean(item.eventMemory);
      if (options.eventsOnly && !isEvent) continue;
      const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map(v => v.trim()).slice(0, 12) : [];
      const eventMemory = isEvent ? {
        sourceMessageIds: evidence.map(m => m.id),
        participants: strings(item.eventMemory?.participants),
        recallCues: strings(item.eventMemory?.recallCues),
        kind: (["first", "commitment", "revelation", "choice", "sharedExperience"].includes(item.eventMemory?.kind) ? item.eventMemory.kind : "sharedExperience") as NonNullable<MemoryProposal["eventMemory"]>["kind"],
      } : undefined;
      if (isEvent && (!eventMemory?.participants.length || !eventMemory.recallCues.length)) continue;
      if (isEvent && [...adventure.storyCards.filter(c => isHistoricalLore(c)), ...adventure.activeState.memoryProposals.filter(p => Boolean(p.eventMemory))]
        .some(existing => sameEventMemory(existing, { content: item.content, eventMemory }))) continue;
      const source = (options.sourceId ? messages.find(message => message.id === options.sourceId) : isEvent ? evidence.find(message => message.role === "assistant") : evidence.filter(message => message.role === "assistant").at(-1))
        ?? messages.find((message, index) => message.role === "assistant" && evidence.some(item => messages[index - 1]?.id === item.id));
      if (!source) continue;
      const proposal = makeStoryCardSuggestion(adventure, source.id, source.content, {
        title, content: item.content.trim(), evidence: evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n"),
        reason: typeof item.rationale === "string" ? item.rationale : "Grounded catch-up finding; review before applying.",
        type: isEvent ? "lore" : primaryStoryCardType(item.storyCardType),
        targetId: typeof item.targetId === "string" ? item.targetId : undefined,
        triggers: Array.isArray(item.suggestedTriggers ?? item.triggers ?? item.keys)
          ? (item.suggestedTriggers ?? item.triggers ?? item.keys).filter((trigger: unknown): trigger is string => typeof trigger === "string") : eventMemory?.recallCues,
        participants: eventMemory?.participants, evidenceReviewed: Boolean(options.sourceId), candidateOnly: item.candidateOnly === true || item.eventStatus === "unresolved",
      });
      if (item.targetId && !adventure.storyCards.some(card => card.id === item.targetId)) { diagnostic("candidate_suppressed", "Unknown existing-card target."); continue; }
      const destination = adventure.storyCards.find(card => card.id === proposal.targetId);
      if (destination?.autoUpdate === false) { diagnostic("candidate_suppressed", "Existing-card autoUpdate=false; independent new Lore remains eligible."); continue; }
      proposal.storyCardReview = { ...proposal.storyCardReview!, additionalSources: evidence.filter(message => message.id !== source.id).map(({ id, content }) => ({ id, content })) };
      if (options.sourceId) proposal.storyCardReview.evidenceQuotes = item.evidenceQuotes;
      if (options.sourceId && proposal.storyCardType === "lore") {
        if (item.memoryMode !== undefined && !["historical", "living", "static"].includes(item.memoryMode)) throw new Error("Invalid discovery memory mode.");
        if (item.eventStatus !== undefined && !["completed", "ongoing", "unresolved"].includes(item.eventStatus)) throw new Error("Invalid discovery event status.");
        if (item.memoryMode) proposal.memoryMode = item.memoryMode;
        if (item.eventStatus && proposal.lore) proposal.lore.status = item.eventStatus;
      }
      if (item.eventStatus === "unresolved") proposal.requiresReview = true;
      if (proposal.lore) proposal.lore.sourceMessageIds = [...new Set([...proposal.lore.sourceMessageIds, ...evidence.map(message => message.id)])];
      if (eventMemory) { proposal.eventMemory = eventMemory; proposal.memoryMode = "historical"; proposal.requiresReview = true; }
      if (!options.eventsOnly && !adventure.memoryDetectionSettings.generateContent) { proposal.content = ""; proposal.requiresReview = true; }
      result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      capturedContent.push(item.content);
      if (parsed.indexOf(item) >= 2) break;
    }
  } catch (error) {
    // Provider exceptions may contain request data or credentials. Only expose our
    // structural errors; group failure still retains retry/quarantine semantics.
    const failure = safeMemoryFailure(error, received);
    const reason = error instanceof Error && /^(Discovery |Invalid discovery)/.test(error.message) ? error.message : failure.message;
    result.actions.push({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: createId("decision"), sourceId: options.sourceId ?? messages.at(-1)!.id,
      createdAt: nowIso(), stage: "candidate", outcome: "evaluation_failed", group: "discovery", candidateKinds: ["semanticLore"],
      failureCategory: failure.category, failureCode: failure.code, reason: failure.message } });
    if (received) diagnostic("validation_rejected", `Semantic discovery failed: ${reason}`);
    result.errors.push(`Story Card discovery failed: ${reason}`);
  }
  return result;
}
