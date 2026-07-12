import type { Adventure, MemoryProposal, ProviderConfig } from "../types/adventure";
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
    messages: [{ role: "user", content: systemPrompt }],
  });

  return response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
