import { makeComponent } from "../state/defaults";
import type { ComponentEntry, ComponentType, ContextInclusionPolicy } from "../types/adventure";

export interface ParsedComponent {
  sourceIndex: number;
  component: ComponentEntry;
  raw: unknown;
}

export interface SkippedComponent {
  sourceIndex: number;
  reason: string;
  raw: unknown;
}

export interface ComponentParseResult {
  components: ParsedComponent[];
  skipped: SkippedComponent[];
  warnings: string[];
  openingScene?: string;
  error?: string;
}

const componentTypes = new Set<ComponentType>([
  "narrationRules",
  "aiInstructions",
  "plotEssentials",
  "currentArc",
  "activePressure",
  "authorNote",
  "memory",
  "custom",
]);

const inclusionPolicies = new Set<ContextInclusionPolicy>([
  "always",
  "triggered",
  "manual",
  "systemSuggested",
]);

const componentTypeLabels: Record<ComponentType, string> = {
  narrationRules: "Narration Rules",
  aiInstructions: "AI Instructions",
  plotEssentials: "Plot Essentials",
  currentArc: "Current Story Arc",
  activePressure: "Active Pressure",
  immediateMomentum: "Immediate Momentum",
  authorNote: "Author's Note",
  memory: "Lore Block",
  custom: "Custom Component",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isComponentType(value: unknown): value is ComponentType {
  return typeof value === "string" && componentTypes.has(value as ComponentType);
}

function isInclusionPolicy(value: unknown): value is ContextInclusionPolicy {
  return typeof value === "string" && inclusionPolicies.has(value as ContextInclusionPolicy);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function defaultPriority(type: ComponentType): number {
  if (type === "narrationRules") return 100;
  if (type === "aiInstructions") return 90;
  if (type === "plotEssentials") return 80;
  if (type === "activePressure") return 245;
  if (type === "immediateMomentum") return 240;
  if (type === "authorNote") return 70;
  return 0;
}

function isFixedContextType(type: ComponentType): boolean {
  return type === "narrationRules"
    || type === "aiInstructions"
    || type === "plotEssentials"
    || type === "authorNote";
}

function collectComponents(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.components)) return value.components;
  if (isRecord(value.state) && Array.isArray(value.state.components)) return value.state.components;
  if ("type" in value || "content" in value || "title" in value) return [value];
  return [];
}

function parseComponent(raw: unknown, sourceIndex: number): ParsedComponent | SkippedComponent {
  if (!isRecord(raw)) {
    return { sourceIndex, reason: "Component was not an object.", raw };
  }
  if (raw.type === "immediateMomentum") {
    return {
      sourceIndex,
      reason: "Immediate Momentum is disabled.",
      raw,
    };
  }
  if (!isComponentType(raw.type)) {
    return {
      sourceIndex,
      reason: `Unknown component type "${String(raw.type ?? "")}".`,
      raw,
    };
  }

  const type = raw.type;
  const content = stringField(raw, "content")?.trim() ?? "";
  if (!content) {
    return { sourceIndex, reason: "Component content was empty.", raw };
  }

  const fixed = isFixedContextType(type);
  const alwaysOn = booleanField(raw, "alwaysOn") ?? fixed;
  const title = stringField(raw, "title")?.trim() || componentTypeLabels[type];
  const component = makeComponent({
    id: stringField(raw, "id")?.trim() || undefined,
    title,
    type,
    content,
    arcPremise: stringField(raw, "arcPremise"),
    priority: numberField(raw, "priority") ?? defaultPriority(type),
    alwaysOn,
    active: booleanField(raw, "active") ?? true,
    pinned: booleanField(raw, "pinned") ?? fixed,
    protected: booleanField(raw, "protected"),
    inclusionPolicy: isInclusionPolicy(raw.inclusionPolicy)
      ? raw.inclusionPolicy
      : alwaysOn || fixed
        ? "always"
        : "manual",
    state: stringField(raw, "state") ?? "",
    tokenBudget: numberField(raw, "tokenBudget"),
    autoUpdate: booleanField(raw, "autoUpdate"),
    lastAutoUpdateTurn: numberField(raw, "lastAutoUpdateTurn"),
    autoUpdateCooldownTurns: numberField(raw, "autoUpdateCooldownTurns"),
    createdAt: stringField(raw, "createdAt"),
    updatedAt: stringField(raw, "updatedAt"),
  });

  return { sourceIndex, component, raw };
}

function parseJsonValue(value: unknown): ComponentParseResult {
  const openingScene = isRecord(value)
    ? stringField(value, "openingScene")?.trim() || undefined
    : undefined;
  const rawComponents = collectComponents(value);
  if (rawComponents.length === 0) {
    return {
      components: [],
      skipped: [],
      warnings: [
        openingScene
          ? "Opening scene found; no plot components were included."
          : "Valid JSON was found, but it did not contain plot components.",
      ],
      openingScene,
    };
  }

  const components: ParsedComponent[] = [];
  const skipped: SkippedComponent[] = [];
  rawComponents.forEach((raw, index) => {
    const parsed = parseComponent(raw, index);
    if ("component" in parsed) components.push(parsed);
    else skipped.push(parsed);
  });

  return {
    components,
    skipped,
    warnings: skipped.length > 0
      ? [`Skipped ${skipped.length} component(s). Review reasons before importing.`]
      : [],
    openingScene,
  };
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
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

function tryParseMultipleDocuments(text: string): ComponentParseResult | undefined {
  const documents = extractTopLevelJsonDocuments(text);
  if (documents.length <= 1) return undefined;
  const results: ComponentParseResult[] = [];
  for (const document of documents) {
    try {
      results.push(parseJsonValue(JSON.parse(document)));
    } catch {
      return undefined;
    }
  }
  return mergeComponentParseResults(results);
}

export function mergeComponentParseResults(results: ComponentParseResult[]): ComponentParseResult {
  const openingScene = results.reduce<string | undefined>(
    (current, result) => result.openingScene ?? current,
    undefined,
  );
  return {
    components: results.flatMap((result) => result.components),
    skipped: results.flatMap((result) => result.skipped),
    warnings: results.flatMap((result) => result.warnings),
    openingScene,
    error: results.find((result) => result.error)?.error,
  };
}

export function parseComponentsJson(rawText: string): ComponentParseResult {
  const text = rawText.trim();
  if (!text) {
    return {
      components: [],
      skipped: [],
      warnings: ["Plot component JSON is empty."],
    };
  }

  try {
    return parseJsonValue(JSON.parse(text));
  } catch (error) {
    const multiDocumentResult = tryParseMultipleDocuments(text);
    if (multiDocumentResult) return multiDocumentResult;
    return {
      components: [],
      skipped: [],
      warnings: [],
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}
