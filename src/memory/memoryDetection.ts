import { resolveBackgroundProviderConfig } from "../providers/backgroundProvider";
import { resolveMemoryTarget } from "./resolveMemoryTarget";
import { createId, nowIso } from "../utils/id";
import type { Adventure, AdventureAction, MemoryProposal, ProviderConfig, StoryCardType } from "../types/adventure";
import { memoryCanonMessages } from "./memoryCanon";
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
Write improved content for the suggestion titled "${proposal.title}" (type: ${proposal.proposedType}).
Source text from the story: ${proposal.sourceText}
${proposalFormatInstruction(proposal)}
Respond with ONLY the content: no JSON, no preamble, no labels.`;

  const response = await sendOpenAICompatibleChatCompletion({
    config: resolvedProviderConfig(adventure, providerConfig),
    messages: [...memoryCanonMessages(adventure, proposal.sourceText, proposal.title), { role: "user", content: systemPrompt }],
  });

  return response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}


/** Independent of inline tags and existing-card auto-update eligibility. */
export async function detectStoryCardProposals(adventure: Adventure, providerConfig: ProviderConfig) {
  const result = {
    actions: [] as AdventureAction[], errors: [] as string[], evaluated: false,
    tokenUsage: { promptTokens: 0, completionTokens: 0 },
  };
  if (!adventure.memoryDetectionSettings.enabled) return result;
  const messages = adventure.messages.filter(m => m.role === "user" || m.role === "assistant")
    .slice(-Math.max(8, adventure.semanticEvaluationSettings.messagesIncluded));
  if (!messages.some(m => m.role === "assistant" && m.content.trim())) return result;
  result.evaluated = true;
  const excerpt = messages.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n");
  const knownTitles = new Set(adventure.storyCards.map(c => c.title.trim().toLocaleLowerCase()));
  const pendingTitles = new Set(adventure.activeState.memoryProposals
    .filter(p => p.proposedType === "storyCard" && p.status === "pending")
    .map(p => p.title.trim().toLocaleLowerCase()));
  try {
    const response = await sendOpenAICompatibleChatCompletion({
      config: resolveBackgroundProviderConfig(adventure, providerConfig),
      messages: [
        { role: "system", content: `Discover missing durable Story Cards from recent story evidence. This is a catch-up pass: a subject need not be introduced on the latest turn. Suggest up to three recurring or consequential people, places, relationships, world rules, or completed consequences with no existing card. A named person with an established role and an ongoing interaction or concrete future arrangement qualifies; mere named scenery does not. Characters without Brains belong in Story Cards; never create a Brain or infer private thoughts. Do not invent facts or voice samples. Plans remain plans, not completed events. Omit temporary moods, movement, incidental names, and facts already covered by existing cards or pending proposals. Existing cards (including inactive): ${JSON.stringify(adventure.storyCards.map(c => ({ title: c.title, keys: c.keys })))}. Pending titles: ${JSON.stringify([...pendingTitles])}.
${STORY_CARD_BEST_PRACTICES}
${TRIGGER_BEST_PRACTICES}
Return ONLY a JSON array, [] when nothing qualifies. Each item: {"title":"subject", "content":"concise grounded facts", "storyCardType":"character|location|lore|plot|custom", "memoryMode":"static|living|historical", "suggestedTriggers":["narrow phrase"], "rationale":"why durable", "evidenceMessageIds":["message id"]}. Cite only supplied recent message IDs.` },
        ...memoryCanonMessages(adventure, excerpt, "Discover missing Story Cards"),
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
      const evidence = messages.filter(m => Array.isArray(item.evidenceMessageIds) && item.evidenceMessageIds.includes(m.id));
      if (evidence.length === 0) continue;
      const routed = resolveMemoryTarget(adventure, {
        proposedType: "storyCard", title, content: item.content.trim(),
        memoryMode: ["static", "living", "historical"].includes(item.memoryMode) ? item.memoryMode : "static",
        suggestedTriggers: Array.isArray(item.suggestedTriggers) ? item.suggestedTriggers.filter((t: unknown): t is string => typeof t === "string") : [],
      });
      // Discovery fills gaps; updates to known subjects remain in the existing-card path.
      if (routed.proposedType !== "storyCard" || routed.targetId) continue;
      const now = nowIso();
      result.actions.push({ type: "ADD_MEMORY_PROPOSAL", proposal: {
        ...routed, id: createId("proposal"), sourceTurnId: String(adventure.activeState.turn),
        sourceText: evidence.map(m => `[${m.id}] ${m.role}: ${m.content}`).join("\n\n"),
        content: adventure.memoryDetectionSettings.generateContent ? routed.content : "",
        storyCardType: ["character", "location", "lore", "plot", "custom"].includes(item.storyCardType) ? item.storyCardType as StoryCardType : "custom",
        confidence: 0.8, rationale: typeof item.rationale === "string" ? item.rationale : "Missing durable Story Card discovered from recent story evidence.",
        status: "pending", createdAt: now, updatedAt: now,
      } });
      pendingTitles.add(key);
      if (result.actions.length === 3) break;
    }
  } catch (error) {
    result.errors.push(`Story Card discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}
