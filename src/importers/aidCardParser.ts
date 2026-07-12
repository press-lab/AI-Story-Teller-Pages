import { makeBrain, makeStoryCard } from "../state/defaults";
import type { BrainEntry, StoryCard, StoryCardType } from "../types/adventure";

export type AidCardImportTarget = "storyCard" | "brain" | "skip";
export type AidCardSuggestion = "storyCard" | "brain" | "ambiguous";

export interface AidParsedCard {
  id: string;
  sourceIndex: number;
  title: string;
  keysText: string;
  content: string;
  originalType: string;
  suggestion: AidCardSuggestion;
  suggestionReason: string;
  storyCard: StoryCard;
  brainCandidate?: BrainEntry;
  raw: unknown;
}

export interface AidSkippedCard {
  sourceIndex: number;
  reason: string;
  raw: unknown;
}

export interface AidCardParseResult {
  cards: AidParsedCard[];
  skipped: AidSkippedCard[];
  warnings: string[];
  error?: string;
}

interface BrainKeyData {
  agent?: string;
  description?: string;
  notes?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value == null) return "";
  return String(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text.trim()) return text;
  }
  return "";
}

function parseBrainKeyData(keysText: string): BrainKeyData | undefined {
  if (!keysText.trim().startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(keysText) as unknown;
    if (!isRecord(parsed)) return undefined;
    const agent = typeof parsed.agent === "string" ? parsed.agent : undefined;
    const description = typeof parsed.description === "string" ? parsed.description : undefined;
    const notes = typeof parsed.notes === "string" ? parsed.notes : undefined;
    return { agent, description, notes };
  } catch {
    return undefined;
  }
}

function keysToArray(keysText: string, brainKeyData?: BrainKeyData): string[] {
  const agent = brainKeyData?.agent?.trim();
  if (agent) return Array.from(new Set([agent]));
  return keysText
    .split(",")
    .map((key) => key.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function mapStoryCardType(typeText: string): StoryCardType {
  const lower = typeText.toLowerCase();
  if (lower === "character") return "character";
  if (lower === "location" || lower === "place") return "location";
  if (lower === "plot") return "plot";
  if (lower === "lore" || lower === "concept" || lower === "class") return "lore";
  return "custom";
}

function collectCards(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    if (Array.isArray(value.storyCards)) return value.storyCards;
    if (isRecord(value.state) && Array.isArray(value.state.storyCards)) return value.state.storyCards;
    if ("title" in value || "keys" in value || "entry" in value || "value" in value || "content" in value) return [value];
  }
  return [];
}

function extractTopLevelJsonDocuments(text: string): string[] {
  const documents: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        documents.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return documents;
}

function parseCard(raw: unknown, sourceIndex: number): AidParsedCard | AidSkippedCard {
  if (!isRecord(raw)) {
    return { sourceIndex, reason: "Card was not an object.", raw };
  }

  const keysText = stringValue(raw.keys);
  const content = firstString(raw.entry, raw.value, raw.content);
  const originalType = firstString(raw.type) || "custom";
  const brainKeyData = parseBrainKeyData(keysText);
  const title = firstString(raw.title, brainKeyData?.agent, `Imported Card ${sourceIndex + 1}`);
  const description = firstString(raw.description, raw.notes, brainKeyData?.description, brainKeyData?.notes);

  if (!title.trim() && !content.trim()) {
    return { sourceIndex, reason: "Card had no title or content.", raw };
  }

  const isJsonBrain = Boolean(brainKeyData?.agent);
  const mentionsAgent = keysText.toLowerCase().includes("agent");
  const typedBrain = originalType.toLowerCase() === "brain";
  const isBrainCandidate = isJsonBrain || mentionsAgent || typedBrain;
  const suggestion: AidCardSuggestion = isJsonBrain || typedBrain ? "brain" : mentionsAgent ? "ambiguous" : "storyCard";
  const suggestionReason = isJsonBrain
    ? "keys field is JSON with an agent property."
    : typedBrain
      ? "Imported card type is Brain."
      : mentionsAgent
        ? "keys field mentions agent; review before importing as a Brain."
        : "Standard story card.";

  const keys = keysToArray(keysText, brainKeyData);
  const storyCard = makeStoryCard({
    title,
    keys,
    content,
    type: mapStoryCardType(originalType),
    active: true,
    pinned: false,
    priority: 0,
    state: JSON.stringify({
      source: "aiDungeon",
      originalType,
      description,
      originalKeys: keysText,
    }),
  });

  const brainState = description || content;
  const brainCandidate = isBrainCandidate
    ? makeBrain({
        characterName: brainKeyData?.agent || title,
        triggers: keys,
        source: "imported",
        currentState: brainState,
        recentDevelopments: content !== brainState ? content : "",
        active: true,
        pinned: false,
        priority: 0,
      })
    : undefined;

  return {
    id: storyCard.id,
    sourceIndex,
    title,
    keysText,
    content,
    originalType,
    suggestion,
    suggestionReason,
    storyCard,
    brainCandidate,
    raw,
  };
}

function parseJsonValue(value: unknown): AidCardParseResult {
  const rawCards = collectCards(value);
  if (rawCards.length === 0) {
    return {
      cards: [],
      skipped: [],
      warnings: ["Valid JSON was found, but it did not contain story cards."],
    };
  }

  const cards: AidParsedCard[] = [];
  const skipped: AidSkippedCard[] = [];
  rawCards.forEach((rawCard, index) => {
    const parsed = parseCard(rawCard, index);
    if ("storyCard" in parsed) {
      cards.push(parsed);
    } else {
      skipped.push(parsed);
    }
  });

  return {
    cards,
    skipped,
    warnings: skipped.length > 0 ? [`Skipped ${skipped.length} card(s). Review reasons before importing.`] : [],
  };
}

function tryParseMultipleDocuments(text: string): AidCardParseResult | undefined {
  const documents = extractTopLevelJsonDocuments(text);
  if (documents.length <= 1) return undefined;
  const results: AidCardParseResult[] = [];
  for (const document of documents) {
    try {
      results.push(parseJsonValue(JSON.parse(document)));
    } catch {
      return undefined;
    }
  }
  return mergeAidCardParseResults(results);
}

export function mergeAidCardParseResults(results: AidCardParseResult[]): AidCardParseResult {
  return {
    cards: results.flatMap((result) => result.cards),
    skipped: results.flatMap((result) => result.skipped),
    warnings: results.flatMap((result) => result.warnings),
    error: results.find((result) => result.error)?.error,
  };
}

export function parseAidStoryCards(rawText: string): AidCardParseResult {
  const text = rawText.trim();
  if (!text) {
    return {
      cards: [],
      skipped: [],
      warnings: ["Story card JSON is empty. You can still import message history only."],
    };
  }

  try {
    return parseJsonValue(JSON.parse(text));
  } catch (error) {
    const multiDocumentResult = tryParseMultipleDocuments(text);
    if (multiDocumentResult) return multiDocumentResult;
    return {
      cards: [],
      skipped: [],
      warnings: [],
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}
