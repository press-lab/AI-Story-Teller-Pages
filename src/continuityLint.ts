import type { Adventure, ProviderConfig } from "./types/adventure";
import { sendOpenAICompatibleChatCompletion } from "./providers/openAICompatible";

interface RiskyPattern {
  re: RegExp;
  category: string;
}

const RISKY_PATTERNS: RiskyPattern[] = [
  { re: /\byou (promised|swore|vowed|agreed to)\b/i, category: "promise" },
  { re: /\byou said\b/i, category: "quote" },
  { re: /\bis now your (friend|enemy|ally|lover)\b/i, category: "relationship" },
  { re: /\b(has become|have become|are now)\b/i, category: "status-change" },
  { re: /\b(deadline|by (tomorrow|tonight|dawn|morning))\b/i, category: "deadline" },
  { re: /\b(currently aboard|now present|has arrived|just arrived)\b/i, category: "presence" },
  { re: /\byou (ordered|commanded|instructed|told) (me|us|them)\b/i, category: "order" },
];

export function scanForRiskyClaims(text: string): boolean {
  return RISKY_PATTERNS.some(({ re }) => re.test(text));
}

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

export async function runContinuityCheck(
  adventure: Adventure,
  providerConfig: ProviderConfig,
  responseText: string,
  accum?: { promptTokens: number; completionTokens: number },
): Promise<{ correctedText?: string }> {
  const recentMessages = adventure.messages.slice(-8);
  const transcriptText = recentMessages
    .map((m) => `${m.role === "assistant" ? "Story" : "Player"}: ${m.content}`)
    .join("\n\n");

  const systemPrompt =
    "You are a continuity checker for an interactive fiction story. " +
    "Your job is to verify whether the AI-generated story response makes any claims not explicitly established in the recent transcript.\n\n" +
    "Risky claim types to check: promises or agreements attributed to the player, direct quotes attributed to the player, " +
    "relationship or status changes, orders or deadlines, and claims about who is currently present.\n\n" +
    "If the response contains an unsupported claim, rewrite only the problematic sentence(s) to remove or soften the assertion — " +
    "do not change anything else. Return the full corrected response as plain text.\n" +
    "If there are no unsupported claims, respond with the single word: null";

  const userContent =
    `## Recent Transcript (last 8 messages)\n${transcriptText || "(none)"}\n\n` +
    `## AI Response to Check\n${responseText}`;

  try {
    const response = await sendOpenAICompatibleChatCompletion({
      config: resolvedProviderConfig(adventure, providerConfig),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    if (accum && response.usage) {
      accum.promptTokens += response.usage.promptTokens ?? 0;
      accum.completionTokens += response.usage.completionTokens ?? 0;
    }
    const raw = response.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (!raw || raw === "null") return {};
    return { correctedText: raw };
  } catch {
    return {};
  }
}
