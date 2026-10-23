import { makeStoryCardSuggestion, scanStoryCardExchange, relevantStoryCardInventory, STORY_CARD_MEMORY_CHECK } from "./storyCardSuggestions";
import { isHistoricalLore, primaryStoryCardType } from "./storyCardArchitecture";
import { sameEventMemory } from "./eventMemory";
import { resolveBackgroundProviderConfig } from "../providers/backgroundProvider";
import type { Adventure, AdventureAction, MemoryProposal, ProviderConfig } from "../types/adventure";
import { memoryCanonMessages } from "./memoryCanon";
import { storyCardContextContent } from "./storyCardPolicy";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import {
  PLOT_ESSENTIALS_BEST_PRACTICES,
  STORY_CARD_BEST_PRACTICES,
  TRIGGER_BEST_PRACTICES,
  storyCardCreationGuidance,
} from "../ai/authoringBestPractices";

function resolvedProviderConfig(adventure: Adventure, providerConfig: ProviderConfig): ProviderConfig {
  const bg = adventure.semanticEvaluationSettings.backgroundProviderConfig;
  if (bg?.baseUrl) {
    return {
      ...providerConfig,
      baseUrl: bg.baseUrl,
      apiKey: bg.apiKey ?? providerConfig.apiKey,
      model: bg.model || providerConfig.model,
      promptCaching: bg.baseUrl === providerConfig.baseUrl ? providerConfig.promptCaching : undefined,
    };
  }
  return { ...providerConfig, model: adventure.semanticEvaluationSettings.evaluationModel || providerConfig.model };
}

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
    config: resolvedProviderConfig(adventure, providerConfig),
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
export async function detectStoryCardProposals(adventure: Adventure, providerConfig: ProviderConfig, options: { messages?: Adventure["messages"]; eventsOnly?: boolean } = {}) {
  const result = {
    actions: [] as AdventureAction[], errors: [] as string[], evaluated: false,
    tokenUsage: { promptTokens: 0, completionTokens: 0 },
  };
  if (!options.eventsOnly && !adventure.memoryDetectionSettings.enabled) return result;
  const messages = (options.messages ?? adventure.messages.filter(m => m.role === "user" || m.role === "assistant")
    .slice(-Math.max(8, adventure.semanticEvaluationSettings.messagesIncluded,
      2 * adventure.memoryDetectionSettings.everyNTurns))).filter(m => m.role === "user" || m.role === "assistant");
  if (!messages.some(m => m.role === "assistant" && m.content.trim())) return result;
  result.evaluated = true;
  const excerpt = messages.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n");
  // Older catch-up tools retain their response envelope, but use the same local
  // scanner, matcher and review records as normal play and Chronicle evaluation.
  for (const source of messages.filter(message => message.role === "assistant" && message.inputMode !== "comms").slice(-12)) {
    for (const proposal of scanStoryCardExchange(adventure, source)) {
      if (options.eventsOnly && proposal.storyCardType !== "lore") continue;
      result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
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
  try {
    const response = await sendOpenAICompatibleChatCompletion({
      config: resolveBackgroundProviderConfig(adventure, providerConfig),
      messages: [
        { role: "system", content: `${STORY_CARD_MEMORY_CHECK}
${options.eventsOnly ? "Evaluate completed history as Lore only." : "Evaluate the supplied completed exchanges."}
Return ONLY a JSON array, [] when nothing qualifies. Each item: {"title":"subject or existing title","targetId":"existing ID for an update, otherwise omit","content":"NEW fact only; max 70 words","storyCardType":"lore|character|location|custom","suggestedTriggers":["1-3 specific phrases"],"rationale":"why durable","evidenceMessageIds":["supplied source IDs"]}. Routine hospitality and scene filler do not qualify. Do not repeat dismissed or already captured facts. This legacy catch-up response is adapted into the shared Story Card pipeline.` },
        ...memoryCanonMessages(adventure, excerpt, "Discover missing Story Cards", true),
        { role: "user", content: "Relevant existing cards: " + JSON.stringify(cardInventory) },
        { role: "user", content: "Previously considered Story Card proposals (including dismissed; omit duplicates): " + JSON.stringify(proposalInventory) },
        { role: "user", content: "Recent story evidence:\n" + excerpt },
      ],
    });
    result.tokenUsage.promptTokens += response.usage?.promptTokens ?? 0;
    result.tokenUsage.completionTokens += response.usage?.completionTokens ?? 0;
    const raw = response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Discovery response was not an array.");
    for (const item of parsed) {
      if (!item || typeof item !== "object" || typeof item.title !== "string" || !item.title.trim()
        || typeof item.content !== "string" || !item.content.trim()) continue;
      const title = item.title.trim();
      // Event records are independent of character/current-state coverage.
      // Their occurrence-aware dedupe below also preserves distinct occasions.
      if (item.storyCardType !== "event" && alreadyCaptured(item.content, capturedContent)) continue;
      const evidence = messages.filter(m => Array.isArray(item.evidenceMessageIds) && item.evidenceMessageIds.includes(m.id));
      if (evidence.length === 0) continue;
      if (item.evidenceMessageIds.some((id: unknown) => !messages.some(m => m.id === id))) continue;
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
      const source = (isEvent ? evidence.find(message => message.role === "assistant") : evidence.filter(message => message.role === "assistant").at(-1))
        ?? messages.find((message, index) => message.role === "assistant" && evidence.some(item => messages[index - 1]?.id === item.id));
      if (!source) continue;
      const proposal = makeStoryCardSuggestion(adventure, source.id, source.content, {
        title, content: item.content.trim(), evidence: evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n"),
        reason: typeof item.rationale === "string" ? item.rationale : "Grounded catch-up finding; review before applying.",
        type: isEvent ? "lore" : primaryStoryCardType(item.storyCardType),
        targetId: typeof item.targetId === "string" ? item.targetId : undefined,
        triggers: Array.isArray(item.suggestedTriggers) ? item.suggestedTriggers.filter((trigger: unknown): trigger is string => typeof trigger === "string") : eventMemory?.recallCues,
        participants: eventMemory?.participants,
      });
      if (item.targetId && !adventure.storyCards.some(card => card.id === item.targetId)) continue;
      proposal.storyCardReview = { ...proposal.storyCardReview!, additionalSources: evidence.filter(message => message.id !== source.id).map(({ id, content }) => ({ id, content })) };
      if (proposal.lore) proposal.lore.sourceMessageIds = [...new Set([...proposal.lore.sourceMessageIds, ...evidence.map(message => message.id)])];
      if (eventMemory) { proposal.eventMemory = eventMemory; proposal.memoryMode = "historical"; proposal.requiresReview = true; }
      if (!options.eventsOnly && !adventure.memoryDetectionSettings.generateContent) { proposal.content = ""; proposal.requiresReview = true; }
      result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal });
      capturedContent.push(item.content);
      if (parsed.indexOf(item) >= 2) break;
    }
  } catch (error) {
    result.errors.push(`Story Card discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}
