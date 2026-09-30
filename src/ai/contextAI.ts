import type { ProviderConfig } from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";

export interface DedupInputItem {
  id: string;
  sourceType: string;
  title: string;
  content: string;
  priority: number;
  isStoryCard: boolean;
}

export interface DedupProposal {
  id: string;
  source: "deterministic" | "llm";
  description: string;
  keepItemId: string;
  keepItemTitle: string;
  trimItemId: string;
  trimItemTitle: string;
  trimItemSourceType: string;
  suggestedContent: string;
  isConflict: boolean;
}

function parseJsonFenced<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return JSON.parse(fenced ?? trimmed) as T;
}

export async function runCondenseContent(
  title: string,
  content: string,
  config: ProviderConfig,
): Promise<string> {
  const response = await sendOpenAICompatibleChatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You are a concise writing assistant. Condense the provided content while preserving every name, fact, relationship, and trigger keyword. Return only the condensed text — no headers, no commentary.",
      },
      {
        role: "user",
        content: `Condense to roughly 40–60% of original length. Keep all proper nouns, core facts, and key phrases.\n\nTitle: ${title}\n\nContent:\n${content}`,
      },
    ],
    config,
  });
  return response.content.trim();
}

export async function runContextDedup(
  items: DedupInputItem[],
  config: ProviderConfig,
): Promise<DedupProposal[]> {
  if (items.length < 2) return [];

  const itemList = items
    .map(
      (item) =>
        `[ID:${item.id}][Source:${item.sourceType}][Priority:${item.priority}]${item.isStoryCard ? "[StoryCard]" : ""} ${item.title}:\n${item.content.slice(0, 600)}`,
    )
    .join("\n\n---\n\n");

  const response = await sendOpenAICompatibleChatCompletion({
    messages: [
      {
        role: "system",
        content:
          'Analyze adventure story context for duplicate or overlapping information. Return ONLY valid JSON.\n\nRules:\n- Story Cards are canonical for characters/locations/lore; prefer trimming non-card items when they overlap with a Story Card.\n- Only flag genuine redundancy (>40% conceptual overlap).\n- suggestedContent: the trimItemId content after removing duplicated facts. Empty string if both need manual review.\n- isConflict: true if both items are Story Cards or are the same priority (user must decide which wins).',
      },
      {
        role: "user",
        content: `Analyze for duplicates:\n\n${itemList}\n\nReturn:\n{"proposals":[{"description":"...","keepItemId":"...","keepItemTitle":"...","trimItemId":"...","trimItemTitle":"...","trimItemSourceType":"...","suggestedContent":"...","isConflict":false}]}`,
      },
    ],
    config,
  });

  try {
    const parsed = parseJsonFenced<{ proposals: Omit<DedupProposal, "id" | "source">[] }>(response.content);
    return (parsed.proposals ?? []).map((p, i) => ({ ...p, id: `dedup-${i}`, source: "llm" as const }));
  } catch {
    return [];
  }
}
