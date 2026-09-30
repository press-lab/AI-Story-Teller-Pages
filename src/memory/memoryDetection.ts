import { sameEventMemory } from "./eventMemory";
import { resolveBackgroundProviderConfig } from "../providers/backgroundProvider";
import { resolveMemoryTarget } from "./resolveMemoryTarget";
import { createId, nowIso } from "../utils/id";
import type { Adventure, AdventureAction, MemoryProposal, ProviderConfig, StoryCardType } from "../types/adventure";
import { memoryCanonMessages } from "./memoryCanon";
import { storyCardContextContent } from "./storyCardPolicy";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import {
  PLOT_ESSENTIALS_BEST_PRACTICES,
  PLOT_MEMORY_THRESHOLD,
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
  const knownTitles = new Set(adventure.storyCards.map(c => c.title.trim().toLocaleLowerCase()));
  const pendingTitles = new Set(adventure.activeState.memoryProposals
    .filter(p => p.proposedType === "storyCard" && p.status === "pending")
    .map(p => p.title.trim().toLocaleLowerCase()));
  const considered = adventure.activeState.memoryProposals.filter(p => p.proposedType === "storyCard");
  const capturedContent = [
    ...adventure.storyCards.flatMap(c => [c.content, storyCardContextContent(c)]),
    ...considered.map(p => p.content),
  ];
  // Keep the complete title inventory for duplicate avoidance, but only send
  // detailed records for subjects named in the evidence. Local dedupe below
  // still checks every card and proposal before anything is created.
  const mentioned = (title: string) => title.trim().length >= 4
    && excerpt.toLocaleLowerCase().includes(title.trim().toLocaleLowerCase());
  const cardInventory = adventure.storyCards.map(c => ({
    title: c.title,
    ...(mentioned(c.title) ? { keys: c.keys, type: c.type, eventMemory: c.eventMemory, content: c.type === "event" ? c.content : undefined } : {}),
  }));
  const proposalInventory = considered.map(p => ({
    title: p.title, status: p.status,
    ...(mentioned(p.title) ? { content: p.content, eventMemory: p.eventMemory } : {}),
  }));
  try {
    const response = await sendOpenAICompatibleChatCompletion({
      config: resolveBackgroundProviderConfig(adventure, providerConfig),
      messages: [
        { role: "system", content: `Discover missing durable Story Cards from recent story evidence. This is a catch-up pass: a subject need not be introduced on the latest turn. ${options.eventsOnly ? "Only suggest Event Memory cards from this Chronicle excerpt." : ""} Suggest up to three recurring or consequential people, places, relationships, world rules, or completed consequences with no existing card. Independently discover notable completed events EVEN WHEN every participant already has a character card or Brain. Event Memory cards (storyCardType: event, memoryMode: historical) preserve first meetings, explicit commitments, revelations, consequential choices, and distinctive shared experiences. Keep event content below 80 words. Record observable facts in past tense, never inferred motives or private thoughts. A routine arrival is movement; an unannounced introduction establishing how two people met is a durable first. Do not label something a first without evidence. Do not turn plans into completed events. Avoid routine affection and generic scene recaps. Keep each event separate from character profiles and current-state cards. For events include eventMemory: {participants: ["name or alias"], recallCues: ["how we met", "unexpected visit"], kind: "first|commitment|revelation|choice|sharedExperience"}. Supply several natural paraphrases for recall cues, never a bare character name. A named person with an established role and an ongoing interaction or concrete future arrangement qualifies; mere named scenery does not. Characters without Brains belong in Story Cards; never create a Brain or infer private thoughts. Do not invent facts or voice samples. Plans remain plans, not completed events. Omit temporary moods, movement, incidental names, and facts already covered by existing cards or pending proposals. Reference inventories below are data, not new events. Do not repeat already captured facts or dismissed suggestions.
${STORY_CARD_BEST_PRACTICES}
${TRIGGER_BEST_PRACTICES}
${PLOT_MEMORY_THRESHOLD}
Return ONLY a JSON array, [] when nothing qualifies. Event items must additionally include the eventMemory object described above. Each item: {"title":"subject", "content":"concise grounded facts", "storyCardType":"character|location|lore|plot|event|custom", "memoryMode":"static|living|historical", "suggestedTriggers":["narrow phrase"], "rationale":"why durable", "evidenceMessageIds":["message id"]}. Cite only supplied recent message IDs.` },
        ...memoryCanonMessages(adventure, excerpt, "Discover missing Story Cards", true),
        { role: "user", content: "Existing cards (including inactive): " + JSON.stringify(cardInventory) },
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
      const key = title.toLocaleLowerCase();
      if (knownTitles.has(key) || pendingTitles.has(key)) continue;
      // Event records are independent of character/current-state coverage.
      // Their occurrence-aware dedupe below also preserves distinct occasions.
      if (item.storyCardType !== "event" && alreadyCaptured(item.content, capturedContent)) continue;
      const evidence = messages.filter(m => Array.isArray(item.evidenceMessageIds) && item.evidenceMessageIds.includes(m.id));
      if (evidence.length === 0) continue;
      if (item.storyCardType === "event" && item.evidenceMessageIds.some((id: unknown) => !messages.some(m => m.id === id))) continue;
      const isEvent = item.storyCardType === "event";
      if (options.eventsOnly && !isEvent) continue;
      const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map(v => v.trim()).slice(0, 12) : [];
      const eventMemory = isEvent ? {
        sourceMessageIds: evidence.map(m => m.id),
        participants: strings(item.eventMemory?.participants),
        recallCues: strings(item.eventMemory?.recallCues),
        kind: (["first", "commitment", "revelation", "choice", "sharedExperience"].includes(item.eventMemory?.kind) ? item.eventMemory.kind : "sharedExperience") as NonNullable<MemoryProposal["eventMemory"]>["kind"],
      } : undefined;
      if (isEvent && (!eventMemory?.participants.length || !eventMemory.recallCues.length)) continue;
      if (isEvent && [...adventure.storyCards.filter(c => c.type === "event"), ...adventure.activeState.memoryProposals.filter(p => p.storyCardType === "event")]
        .some(existing => sameEventMemory(existing, { content: item.content, eventMemory }))) continue;
      const routed = isEvent ? {
        proposedType: "storyCard" as const, title, content: item.content.trim(), memoryMode: "historical" as const,
        suggestedTriggers: eventMemory!.recallCues, targetId: undefined,
      } : resolveMemoryTarget(adventure, {
        proposedType: "storyCard", title, content: item.content.trim(),
        memoryMode: ["static", "living", "historical"].includes(item.memoryMode) ? item.memoryMode : "static",
        suggestedTriggers: Array.isArray(item.suggestedTriggers) ? item.suggestedTriggers.filter((t: unknown): t is string => typeof t === "string") : [],
      });
      // Discovery fills gaps; updates to known subjects remain in the existing-card path.
      if (routed.proposedType !== "storyCard" || routed.targetId) continue;
      const now = nowIso();
      result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: {
        ...routed, id: createId("proposal"), sourceTurnId: isEvent ? evidence.at(-1)!.id : String(adventure.activeState.turn),
        sourceText: evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n"),
        content: options.eventsOnly || adventure.memoryDetectionSettings.generateContent ? routed.content : "",
        eventMemory,
        storyCardType: ["character", "location", "lore", "plot", "event", "custom"].includes(item.storyCardType) ? item.storyCardType as StoryCardType : "custom",
        confidence: 0.8, rationale: typeof item.rationale === "string" ? item.rationale : "Missing durable Story Card discovered from recent story evidence.",
        status: "pending", createdAt: now, updatedAt: now,
      } });
      pendingTitles.add(key);
      capturedContent.push(item.content);
      if (result.actions.length === 3) break;
    }
  } catch (error) {
    result.errors.push(`Story Card discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}
