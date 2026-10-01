import { selectEventMemories } from "../memory/eventMemory";
import type {
  Adventure,
  BrainEntry,
  ContextBuildResult,
  ContextBuildDecision,
  ContextInclusionPolicy,
  ContextItem,
  ContextSection,
  ContextSectionKind,
  ExcludedContextItem,
  MemoryProposal,
  Message,
} from "../types/adventure";
import { storyCardContextContent } from "../memory/storyCardPolicy";
import { dedupeThoughtRecord } from "../memory/thoughtDedupe";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
import { matchPatterns } from "../triggers/matching";

const SYSTEM_SHELL = `You are the story engine for AI Story Teller. The context is assembled for you each turn in two parts.

STABLE CONTEXT (this system message — changes rarely):
  B. AI Instructions — narrative rules and style for this adventure.
  C. Plot Essentials — overarching premise, long-term conflict, and persistent story-wide constraints.
  C2. Current Story Arc — the arc premise and any gated Arc Director phase instruction.
  E. Components — general world-building context (always-on or pinned entries).
  F0. Pinned Story Cards — core identity and relationship records that always apply.

Then the recent story turns follow in chronological order.

TURN CONTEXT (a block at the start of the newest user message, marked [TURN CONTEXT] … [END TURN CONTEXT]; it is narrator reference, never player speech):
  S. Story State — the authoritative CURRENT facts: day/date/time, location, relationship status, living and sleeping arrangements, who has met whom, open threads.
  P. Active Pressure — the immediate external threat or obligation pressing on the player character.
  C3. Arc Progress — completed developments in the current arc so far.
  F. Story Cards — World Info entries injected when their trigger keywords appear in recent text, plus pinned living records whose facts change during play.
  G. Brains — private thoughts and knowledge boundaries of named characters. Private to the narrator; never quote directly.
  D. Author's Note — immediate narrative direction for this turn. Highest-priority steering.
  J. Next Output Bias — one-turn instruction. Apply it, then disregard it.
  M. Continuity Challenge — one-turn verification instruction when active.

CURRENT TRUTH:
  Story State and the recent story turns are the most current truth. If an older Story Card, arc log, or event memory disagrees with them, follow Story State and the recent turns.
  Never re-introduce characters the player has already met, never reset an established relationship or arrangement, and keep the day, date, and time consistent with Story State.

KNOWLEDGE BOUNDARIES:
  A character knows only what they witnessed, were told on-page, can learn through an ability established in canon, or what their Brain lists under Knows. Anything under "Does not know" stays unknown to them until the story shows them learning it.
  Never let a character state facts, names, or motives they have no way of knowing. When unsure, have them guess, ask, or stay silent.

OUT-OF-CHARACTER MESSAGES:
  Text wrapped as [Out of Character: …] is the player speaking to you as the narrator. Treat it as a correction or instruction that overrides cards, arc direction, and your previous output. Fix or retcon exactly what was asked, briefly acknowledge it only if needed, then continue the scene.

CANON GROUNDING:
  Treat this adventure's context as the only canon, even when names, places, factions, or concepts resemble a published setting, fandom, or prior playthrough.
  Story Cards are binding identity records for named characters, locations, factions, relationships, and lore. If a Story Card is present, follow it over any outside knowledge.
  If a famous or familiar name appears but no matching Story Card, Plot Essential, Brain, or Recent Message establishes the detail, treat the detail as unknown. Do not import biography, relationships, motives, powers, locations, or events from model training data.

Honour every section. Continue the scene in prose. Keep the player able to act.`;

interface BuildOptions {
  currentInput?: string;
  latestModelOutput?: string;
  /**
   * The player is speaking out of character (comms mode). The arc phase direction is withheld and the
   * continuity-challenge instruction is injected so the correction wins over authored pacing.
   */
  outOfCharacter?: boolean;
}

/** Sections sent in the per-turn [TURN CONTEXT] block after the history (never in the cached prefix). */
export const TURN_CONTEXT_SECTIONS: ReadonlySet<ContextSectionKind> = new Set<ContextSectionKind>([
  "storyState",
  "activePressure",
  "arcProgress",
  "storyCards",
  "brains",
  "authorNote",
  "nextTurnNote",
  "challengeMode",
]);

/** Recent history is trimmed from the front in blocks of this many messages so the prompt prefix stays identical across turns. */
export const RECENT_MESSAGE_CHUNK = 10;
/** Default for tokenBudgetSettings.minRecentMessages: three exchanges kept ahead of unprotected memory. */
export const DEFAULT_MIN_RECENT_DIALOGUE = 6;
/** The newest messages always kept, even if chunk alignment would trim them. */
const MIN_RECENT_MESSAGES = 4;

function prioritySort<T extends { priority: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function item(
  id: string,
  sourceType: ContextItem["sourceType"],
  title: string,
  content: string,
  priority = 0,
  protectedItem = false,
  pinned = false,
  active = true,
  inclusionPolicy: ContextInclusionPolicy = "triggered",
  generatedBy: ContextItem["generatedBy"] = "user",
): ContextItem {
  return {
    id,
    sourceType,
    title,
    content,
    priority,
    protected: protectedItem,
    pinned,
    active,
    inclusionPolicy,
    generatedBy,
    tokenEstimate: approximateTokenCount(content),
  };
}

function section(id: ContextSectionKind, label: string, order: number, items: ContextItem[]): ContextSection {
  const content = items.length === 1
    ? items[0].content
    : items.map((entry) => `## ${entry.title}\n${entry.content}`).join("\n\n");
  return {
    id,
    label,
    order,
    items,
    content,
    tokenEstimate: approximateTokenCount(content),
  };
}

function excluded(
  sourceType: ExcludedContextItem["sourceType"],
  id: string,
  title: string,
  reason: ExcludedContextItem["reason"],
  detail?: string,
): ExcludedContextItem {
  return { sourceType, id, title, reason, detail };
}

function decision(
  entry: Pick<ContextItem, "id" | "sourceType" | "title">,
  action: ContextBuildDecision["action"],
  reason: string,
  detail: string,
): ContextBuildDecision {
  return { itemId: entry.id, sourceType: entry.sourceType, title: entry.title, action, reason, detail };
}

function sourceDecision(
  sourceType: ContextItem["sourceType"],
  id: string,
  title: string,
  action: ContextBuildDecision["action"],
  reason: string,
  detail: string,
): ContextBuildDecision {
  return { itemId: id, sourceType, title, action, reason, detail };
}

function recentText(adventure: Adventure, options: BuildOptions): string {
  const windowSize = adventure.tokenBudgetSettings.recentMessageWindow;
  const recent = adventure.messages
    .slice(-windowSize)
    .map((message) => message.content)
    .join("\n");
  const openingScene = adventure.activeState.turn === 0 ? adventure.openingScene : "";
  return [options.currentInput, options.latestModelOutput, recent, openingScene].filter(Boolean).join("\n");
}

function isForced(adventure: Adventure, sourceType: ContextItem["sourceType"], id: string): boolean {
  const turn = adventure.activeState.turn;
  return adventure.activeState.forceIncludeNextTurn.some(
    (entry) =>
      entry.targetId === id &&
      entry.expiresTurn >= turn &&
      ((entry.targetType === "storyCard" && sourceType === "storyCard") ||
        (entry.targetType === "brain" && sourceType === "brain") ||
        (entry.targetType === "component" && sourceType === "component")),
  );
}

function selectedRecentMessages(adventure: Adventure, seedMessage?: Message): Message[] {
  const tokenCap = adventure.tokenBudgetSettings.sectionBudgets.recentMessages;
  const countCap = adventure.tokenBudgetSettings.maxRecentMessages;
  const messages = adventure.messages;
  const result: Message[] = [];
  let tokens = 0;
  // Walk newest-first; token cap is the primary constraint, count cap is a safety ceiling
  for (let i = messages.length - 1; i >= 0; i--) {
    if (result.length >= countCap) break;
    const msg = messages[i];
    const cost = approximateTokenCount(msg.content);
    if (tokenCap && tokens + cost > tokenCap) break;
    tokens += cost;
    result.push(msg);
  }
  // Chunk-align the oldest kept message to an absolute index boundary. Without this, the window
  // slides by one message every turn and the provider's prefix cache never matches past the system
  // message. Aligned, the same oldest message leads the history for several turns.
  const firstIndex = messages.length - result.length;
  if (firstIndex > 0) {
    // Small windows use a smaller chunk so alignment never discards more than half the window.
    const chunk = Math.max(1, Math.min(RECENT_MESSAGE_CHUNK, Math.floor(result.length / 2)));
    const aligned = Math.ceil(firstIndex / chunk) * chunk;
    const keep = Math.max(Math.min(result.length, MIN_RECENT_MESSAGES), messages.length - aligned);
    result.length = Math.min(result.length, keep);
    return result; // the opening scene only leads the window while nothing has been trimmed
  }
  // Append seed (opening scene) as oldest entry if it fits
  if (seedMessage && result.length < countCap) {
    const cost = approximateTokenCount(seedMessage.content);
    if (!tokenCap || tokens + cost <= tokenCap) {
      result.push(seedMessage);
    }
  }
  return result; // newest-first; seed is last (oldest)
}

function recalculate(sections: ContextSection[]): ContextSection[] {
  return sections.map((entry) => section(entry.id, entry.label, entry.order, entry.items));
}

function totalTokens(sections: ContextSection[]): number {
  return sections.reduce((sum, entry) => sum + entry.tokenEstimate, 0);
}

function truncateFromFront(text: string, targetTokens: number): string {
  if (targetTokens <= 0) return "";
  const words = text.split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < words.length && approximateTokenCount(words.slice(start).join(" ")) > targetTokens) {
    start += 1;
  }
  return words.slice(start).join(" ");
}

// ---------------------------------------------------------------------------
// Inline thought capture — zero-cost brain updates piggybacked on story gen
// ---------------------------------------------------------------------------

/** Returns brains eligible for an inline thought capture this turn. */
export function eligibleBrainsForCapture(adventure: Adventure, triggerText: string): BrainEntry[] {
  const turn = adventure.activeState.turn;
  return adventure.brains.filter((brain) => {
    if (!brain.active) return false;
    if (brain.autoUpdateCooldownTurns && brain.lastUpdatedTurn !== undefined) {
      if (turn - brain.lastUpdatedTurn < brain.autoUpdateCooldownTurns) return false;
    }
    const patterns = [brain.characterName, ...brain.triggers].filter(Boolean);
    return patterns.length === 0 || matchPatterns(triggerText, patterns, "phrase").matched;
  });
}

/** Extracts <thought> and <memory> tags from model output. Returns clean text and parsed data. */
export function extractInlineThoughts(content: string): {
  cleanContent: string;
  thoughts: Array<{ name: string; key: string; value: string }>;
  memoryTags: Array<{ category: string; title: string; content: string; triggers: string[]; memoryMode?: "static" | "living" | "historical" }>;
} {
  const thoughts: Array<{ name: string; key: string; value: string }> = [];
  // Standard format: <thought name="..." key="...">...</thought>
  const thoughtRegex = /<thought\s+name="([^"]+)"\s+key="([^"]+)">([^<]+)<\/thought>/gi;
  let match: RegExpExecArray | null;
  while ((match = thoughtRegex.exec(content)) !== null) {
    thoughts.push({ name: match[1].trim(), key: match[2].trim(), value: match[3].trim() });
  }
  // Variant format the model sometimes emits: <other name="..." thought="...">...</other>
  // Map thought= attribute to key for compatibility with the standard thought pipeline.
  const otherRegex = /<other\s+name="([^"]+)"\s+thought="([^"]+)">([^<]+)<\/other>/gi;
  while ((match = otherRegex.exec(content)) !== null) {
    thoughts.push({ name: match[1].trim(), key: match[2].trim(), value: match[3].trim() });
  }

  // Extract <memory> tags — deterministic validation: require category + title + non-trivial content
  const VALID_CATEGORIES = new Set(["relationship", "world_fact", "character_reveal", "plot_beat", "status_change"]);
  const memoryTags: Array<{ category: string; title: string; content: string; triggers: string[]; memoryMode?: "static" | "living" | "historical" }> = [];
  // Match self-closing tags with optional triggers attribute (order-independent)
  const selfClosingMemory = /<memory\b([^/]*)\/?>/gi;
  function attr(attrs: string, name: string): string {
    const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attrs);
    return m ? m[1].trim() : "";
  }
  while ((match = selfClosingMemory.exec(content)) !== null) {
    const attrs = match[1];
    const category = attr(attrs, "category");
    const title = attr(attrs, "title");
    const body = attr(attrs, "content");
    const triggersRaw = attr(attrs, "triggers");
    const memoryModeRaw = attr(attrs, "memoryMode");
    const memoryMode = memoryModeRaw === "static" || memoryModeRaw === "living" || memoryModeRaw === "historical" ? memoryModeRaw : undefined;
    const triggers = triggersRaw ? triggersRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
    if (VALID_CATEGORIES.has(category) && title.length > 0 && body.length > 20) {
      memoryTags.push({ category, title, content: body, triggers, memoryMode });
    }
  }

  // Strip the tags AND the [CHARACTER THOUGHT CAPTURE] header if the model echoed it.
  // Also handle unclosed <thought tags (model omitted closing tag) by stripping to end of string.
  const cleanContent = content
    .replace(/<thought[^>]*>[\s\S]*?<\/thought>/gi, "")   // well-formed <thought> tags
    .replace(/<other[^>]*>[\s\S]*?<\/other>/gi, "")       // variant <other> tags
    .replace(/\[CHARACTER THOUGHT CAPTURE\][\s\S]*$/i, "") // echoed header + everything after
    .replace(/<thought[\s\S]*$/i, "")                      // unclosed <thought> tag to end of string
    .replace(/<other[\s\S]*$/i, "")                        // unclosed <other> tag to end of string
    .replace(/<memory\b[^>]*>/gi, "")                       // self-closing or malformed-but-complete memory tags
    .replace(/<memory\b[\s\S]*$/i, "")                    // truncated memory tag to end of string
    .replace(/\[MEMORY TAGGING\][\s\S]*$/i, "")            // echoed memory header
    .replace(/\*\*end of response\.?\*\*/gi, "")           // model-generated closing markers
    .replace(/---\s*end\s*---/gi, "")                      // variant: --- end ---
    .trimEnd();

  // Strip bilingual duplicates: if the response starts in a Latin-script language but then
  // a CJK block appears (Chinese/Japanese/Korean translation appended by some models), cut there.
  // Only fires when the first ~200 chars contain no CJK — avoids stripping genuinely multilingual stories.
  const cjkRange = /[一-鿿぀-ヿ가-힯]/;
  const firstChunk = cleanContent.slice(0, 200);
  if (!cjkRange.test(firstChunk)) {
    const cjkParagraph = /\n\n(?=[一-鿿぀-ヿ가-힯])/;
    const cjkIdx = cleanContent.search(cjkParagraph);
    if (cjkIdx > 0) {
      return { cleanContent: cleanContent.slice(0, cjkIdx).trimEnd(), thoughts, memoryTags };
    }
  }
  return { cleanContent, thoughts, memoryTags };
}

/** Returns the enabled inline memory categories for an adventure. */
export function enabledMemoryCategories(adventure: Adventure): string[] {
  const st = adventure.systemTriggers;
  if (!st || st.enabled === false) return [];
  return Object.entries(st.categories)
    .filter(([, enabled]) => enabled)
    .map(([cat]) => cat);
}

function buildTurnScopeContract(responseLengthHint: number | undefined): string {
  const wordTarget = typeof responseLengthHint === "number"
    ? Math.max(50, Math.min(500, responseLengthHint))
    : 250;
  const minWords = Math.floor(wordTarget * 0.55);
  return `TURN SCOPE CONTRACT: The player's selected visible limit is ${wordTarget} words. Aim for ${minWords}-${wordTarget} visible words; shorter is acceptable when the next playable beat is clear. Do not mention word counts or pad prose. This is a scope ceiling, not a quota. If any other instruction asks for a fuller, substantial, complete, or cinematic scene, obey this turn scope contract first. Write only the next immediate exchange or consequence. Do not advance through multiple beats, tour multiple locations, wrap up the scene, or resolve a major outcome the player has not earned. Never narrate the player's unspoken actions, reactions, dialogue, consent, movement, commitments, or decisions. Stop as soon as the player could reasonably act, answer, interrupt, refuse, choose, or redirect. End on a live in-scene moment, not an option menu or summary.`;
}

export const TURN_CONTEXT_OPEN = "[TURN CONTEXT — narrator reference for this turn; not player speech]";
export const TURN_CONTEXT_CLOSE = "[END TURN CONTEXT]";

function renderSections(sections: ContextSection[]): string {
  return sections
    .filter((entry) => entry.content.length > 0)
    .sort((a, b) => a.order - b.order)
    .map((entry) => `# ${entry.label}\n${entry.content}`)
    .join("\n\n");
}

/**
 * Payload layout, ordered for provider prefix caching:
 *   1. system: stable sections (shell, rules, instructions, plot, arc, components, pinned cards)
 *   2. recent history, chronological, chunk-aligned
 *   3. the per-turn sections, wrapped as [TURN CONTEXT] at the start of the newest user message
 *      (or as a trailing user message when the history ends on an assistant turn).
 * Per-turn content must not be a system message: Anthropic-style adapters hoist every system
 * message to the front, which would put it back ahead of the history and break the cache.
 */
function buildPayload(sections: ContextSection[], recentMessagesNewestFirst: Message[], openingScene?: string) {
  const stableText = renderSections(sections.filter((entry) => entry.id !== "recentMessages" && !TURN_CONTEXT_SECTIONS.has(entry.id)));
  const turnText = renderSections(sections.filter((entry) => TURN_CONTEXT_SECTIONS.has(entry.id)));
  const turnBlock = turnText ? `${TURN_CONTEXT_OPEN}\n${turnText}\n${TURN_CONTEXT_CLOSE}` : "";

  const chronologicalRecent = [...recentMessagesNewestFirst].reverse();
  const history = [
    ...(openingScene ? [{ role: "assistant" as const, content: openingScene }] : []),
    ...chronologicalRecent.map((message) => ({ role: message.role, content: message.content })),
  ];
  const last = history.at(-1);
  if (turnBlock) {
    if (last && last.role === "user") {
      history[history.length - 1] = { ...last, content: `${turnBlock}\n\n${last.content}` };
    } else {
      history.push({ role: "user" as const, content: turnBlock });
    }
  }
  return [{ role: "system" as const, content: stableText }, ...history];
}

function sourceToGeneratedBy(source: "manual" | "imported" | "generated" | undefined): ContextItem["generatedBy"] {
  return source === "generated" ? "ai" : "user";
}

export function buildContext(adventure: Adventure, options: BuildOptions = {}): ContextBuildResult {
  const excludedItems: ExcludedContextItem[] = [];
  const decisions: ContextBuildDecision[] = [];
  const triggerText = recentText(adventure, options);
  const triggeredThreadIds = new Set<string>();
  const budgetSettings = adventure.tokenBudgetSettings;
  const turnScopeText = buildTurnScopeContract(adventure.activeState.responseLengthHint);
  function pushExcluded(
    sourceType: ExcludedContextItem["sourceType"],
    id: string,
    title: string,
    reason: ExcludedContextItem["reason"],
    detail?: string,
  ) {
    excludedItems.push(excluded(sourceType, id, title, reason, detail));
    decisions.push(sourceDecision(sourceType, id, title, reason === "budget_exceeded" ? "dropped" : "excluded", reason, detail ?? reason));
  }

  function pushIncluded(entry: ContextItem, detail: string) {
    decisions.push(decision(entry, "included", "included", detail));
  }

  // A. System Shell
  const systemItem = item("system-shell", "system", "System Shell", SYSTEM_SHELL, 1000, true, false, true, "always", "system");
  pushIncluded(systemItem, "System shell is always included and protected.");
  const turnScopeItem = item("turn-scope-contract", "system", "Turn Scope Contract", turnScopeText, 1000, true, false, true, "always", "system");
  pushIncluded(turnScopeItem, "Turn scope contract is always included and protected.");

  // Track which component IDs have already been logged as excluded to avoid double-logging
  const loggedExcluded = new Set<string>();

  function logExcludedOnce(id: string, title: string, reason: ExcludedContextItem["reason"], detail?: string) {
    if (!loggedExcluded.has(id)) {
      loggedExcluded.add(id);
      pushExcluded("component", id, title, reason, detail);
    }
  }

  // B. Narration Rules — components with type === "narrationRules" (loaded first, before AI Instructions)
  const narrationRulesItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "narrationRules") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `Narration Rules loaded; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });
  // Memory bookkeeping never rides along in the narrator prompt; the background memory pass owns it.
  const runtimeSystemItems = [turnScopeItem];
  const systemSection = section("system", "A. System Shell / Global Generation Rules", 0, [systemItem, ...runtimeSystemItems, ...narrationRulesItems]);

  // B2. AI Instructions — all active components with type === "aiInstructions"
  const aiInstructionItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "aiInstructions") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `AI Instructions loaded; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });

  // C. Plot Essentials — the stable story foundation (cached prefix).
  const plotEssentialItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "plotEssentials") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `Plot Essentials loaded; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });

  // P. Active Pressure — changes as stakes change, so it rides in the per-turn block, not the cached prefix.
  const activePressureItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "activePressure") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    if (!component.content.trim()) return [];
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `Active Pressure loaded in the turn context; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });

  // C2. Current Story Arc — premise and gated phase direction (cached prefix; changes only at phase changes).
  // C3. Arc Progress — the growing development log, sent per turn so log appends do not break the cache.
  const arcProgressItems: ContextItem[] = [];
  const currentArcItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "currentArc") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    // Arc Director phase gate: the simmer instruction is injected while building;
    // the break (cost) instruction is withheld from context entirely until the phase
    // reaches "break", so the model cannot land the climax early on something it never sees.
    const phase = component.arcState?.phase ?? "simmer";
    // An out-of-character correction outranks authored pacing for that turn.
    const phaseDirection = options.outOfCharacter ? undefined :
      phase === "break"
        ? component.arcBreakInstruction?.trim()
        : phase === "simmer" || phase === "escalate"
          ? component.arcSimmerInstruction?.trim()
          : undefined;
    if (component.content.trim()) {
      const progress = item(`${component.id}:progress`, "component", `${component.title} — progress`, component.content.trim(), component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
      arcProgressItems.push(progress);
      pushIncluded(progress, `Arc progress log loaded in the turn context; priority=${component.priority}.`);
    }
    if (!component.arcPremise?.trim() && !phaseDirection) return [];
    const premiseHeader = component.arcPremise?.trim() ? `[Arc Premise: ${component.arcPremise.trim()}]` : "";
    const directionBlock = phaseDirection ? `[ARC DIRECTION — ${phase.toUpperCase()}]\n${phaseDirection}` : "";
    const arcContent = [premiseHeader, directionBlock].filter(Boolean).join("\n\n");
    const next = item(component.id, "component", component.title, arcContent, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `Current Story Arc loaded; priority=${component.priority}; arcPhase=${phase}.`);
    return [next];
  });

  // D. Author's Note — all active components with type === "authorNote"
  const authorNoteItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "authorNote") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `Author's Note loaded; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });

  // S. Story State — authoritative current facts. Always included when it has content; sent in the turn context.
  const storyStateItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type !== "storyState") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    if (!component.content.trim()) return [];
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, "always", "ai");
    pushIncluded(next, `Story State loaded; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });

  // E. Components — general always-on or pinned components (not a special typed section above)
  const generalComponentItems = prioritySort(adventure.components).flatMap((component) => {
    if (component.type === "narrationRules" || component.type === "aiInstructions" || component.type === "plotEssentials" || component.type === "currentArc" || component.type === "activePressure" || component.type === "immediateMomentum" || component.type === "authorNote" || component.type === "storyState") return [];
    if (!component.active) {
      logExcludedOnce(component.id, component.title, "inactive");
      return [];
    }
    if (component.inclusionPolicy !== "always" && !component.alwaysOn && !component.pinned) return [];
    const next = item(component.id, "component", component.title, component.content, component.priority, component.protected, component.pinned, component.active, component.inclusionPolicy, "user");
    pushIncluded(next, `Component loaded by ${component.pinned ? "pin" : `alwaysOn/inclusionPolicy=${component.inclusionPolicy}`}; priority=${component.priority}; protected=${component.protected}.`);
    return [next];
  });

  // F. Story Cards + Auto-Cards
  const storyCardItems: ContextItem[] = [];
  // Pinned / always cards never depend on this turn's text, so they belong in the cached prefix.
  const pinnedStoryCardItems: ContextItem[] = [];
  const recalledEvents = selectEventMemories(adventure.storyCards, triggerText);
  for (const card of prioritySort(adventure.storyCards)) {
    const forced = isForced(adventure, "storyCard", card.id);
    if (!card.active && !forced) {
      pushExcluded("storyCard", card.id, card.title, "inactive");
      continue;
    }
    const keysWithTitle = card.keys.includes(card.title) ? card.keys : [card.title, ...card.keys];
    const match = card.type === "event"
      ? { matched: recalledEvents.has(card.id), pattern: recalledEvents.get(card.id) }
      : matchPatterns(triggerText, keysWithTitle, card.matchType ?? "phrase");
    if (match.matched) triggeredThreadIds.add(card.id);
    const matched = card.inclusionPolicy === "always" || card.pinned || forced || (card.inclusionPolicy !== "manual" && match.matched);
    if (matched) {
      const next = item(card.id, "storyCard", card.title, (card.type === "event" ? "Historical reference; use only when relevant, do not force a callback.\n" : "") + storyCardContextContent(card), card.priority, card.protected, card.pinned, card.active, card.inclusionPolicy, "user");
      pushIncluded(next, `Story card included by ${card.pinned ? "pin" : forced ? "manual force" : card.inclusionPolicy === "always" ? "always policy" : `trigger ${match.pattern}`}; priority=${card.priority}; protected=${card.protected}.`);
      // Living cards change during play, so even pinned ones ride in the per-turn block to keep the prefix stable.
      if ((card.pinned || card.inclusionPolicy === "always") && !forced && card.memoryMode !== "living") pinnedStoryCardItems.push(next);
      else storyCardItems.push(next);
    } else {
      pushExcluded("storyCard", card.id, card.title, "not_triggered", "No story card trigger matched current input, output, or recent history.");
    }
  }

  // G. Brains
  const brainItems = prioritySort(adventure.brains).flatMap((brain) => {
    const forced = isForced(adventure, "brain", brain.id);
    if (!brain.active && !forced) {
      pushExcluded("brain", brain.id, brain.characterName, "inactive");
      return [];
    }
    const patterns = [brain.characterName, ...brain.triggers].filter(Boolean);
    const match = matchPatterns(triggerText, patterns, "phrase");
    if (match.matched) triggeredThreadIds.add(brain.id);
    const matched = brain.inclusionPolicy === "always" || brain.pinned || forced || (brain.inclusionPolicy !== "manual" && match.matched);
    if (!matched) {
      pushExcluded("brain", brain.id, brain.characterName, "not_triggered", "No brain trigger matched current input, output, or recent history.");
      return [];
    }
    // A brain is its thought log (thoughts-only, per the Brains UI). The semantic engine records
    // one new thought per update and pruneThoughtsToBudget bounds + archives the rest, so the live
    // thoughts are always the current, size-capped snapshot. The legacy currentState /
    // relationshipPressure / recentDevelopments fields are NOT injected: they have no editor field,
    // append unbounded, and ballooned context (a high-frequency character hit ~9KB). History lives
    // in the thought archive and in arc-graduated story cards, not in an ever-growing state blob.
    const thoughtsForContext = dedupeThoughtRecord(brain.thoughts);
    const knowledge = brain.knowledge?.trim();
    if (Object.keys(thoughtsForContext).length === 0 && !knowledge) {
      pushExcluded("brain", brain.id, brain.characterName, "not_triggered", "Brain triggered but has no thoughts yet — nothing to inject.");
      return [];
    }
    const content = [
      ...Object.entries(thoughtsForContext).map(([k, v]) => `${k}: ${v}`),
      ...(knowledge ? [`Knowledge boundary:\n${knowledge}`] : []),
    ].join("\n");
    const next = item(brain.id, "brain", brain.characterName, content, brain.priority, brain.protected, brain.pinned, brain.active, brain.inclusionPolicy, sourceToGeneratedBy(brain.source));
    pushIncluded(next, `Brain included by ${brain.pinned ? "pin" : forced ? "manual force" : brain.inclusionPolicy === "always" ? "always policy" : `trigger ${match.pattern}`}; priority=${brain.priority}; protected=${brain.protected}.`);
    return [next];
  });

  // J. Next Output Bias
  const nextTurnNote = adventure.activeState.nextTurnNote;
  if (nextTurnNote?.content.trim() && !nextTurnNote.active) {
    pushExcluded("nextTurnNote", "next-turn-note", "Next Output Bias", "inactive", "Next Output Bias has content but is not active.");
  }
  const nextTurnNoteItems =
    nextTurnNote?.active && nextTurnNote.content.trim()
      ? [
          item(
            "next-turn-note",
            "nextTurnNote",
            "Next Output Bias",
            nextTurnNote.content.trim(),
            nextTurnNote.priority,
            nextTurnNote.protected,
            nextTurnNote.pinned,
            nextTurnNote.active,
            "always",
            "user",
          ),
        ]
      : [];
  nextTurnNoteItems.forEach((entry) =>
    pushIncluded(
      entry,
      `Next Output Bias included for immediate next generation; priority=${entry.priority}; pinned=${entry.pinned}; protected=${entry.protected}; expiresAfterUse=${nextTurnNote.expiresAfterUse}.`,
    ),
  );

  // M. Continuity Challenge — one-turn verification instruction, protected, consumes no budget when inactive
  const CHALLENGE_INSTRUCTION =
    "[CONTINUITY CHALLENGE]\n" +
    "The player has disputed a recent claim. Before continuing the story, verify the disputed claim against the recent transcript. " +
    "If the claim is not explicitly supported by the story text, retract or soften it in your response. " +
    "Do not fabricate supporting quotes or paraphrase past dialogue to support it. " +
    "Acknowledge the inconsistency naturally within the narrative.";
  const challengeItems: ContextItem[] = adventure.activeState.challengeMode || options.outOfCharacter
    ? [item("challenge-mode", "system", "Continuity Challenge", CHALLENGE_INSTRUCTION, 1000, true, false, true, "always", "system")]
    : [];
  challengeItems.forEach((entry) => pushIncluded(entry, options.outOfCharacter
    ? "Out-of-character turn; verification instruction injected."
    : "Continuity challenge mode active; verification instruction injected."));

  // K. Recent Messages — opening scene is a virtual oldest message, subject to normal budget management
  const openingSeed: Message | undefined = adventure.openingScene
    ? { id: "opening-scene", role: "assistant" as const, content: adventure.openingScene, createdAt: adventure.createdAt }
    : undefined;
  const recentMessages = selectedRecentMessages(adventure, openingSeed);

  // Protect only the newest message (index 0 — current player input or last scene).
  // Opening scene is treated as ordinary oldest assistant output and can be dropped under budget pressure.
  const recentMessageItems = recentMessages.map((message, index) =>
    item(
      message.id,
      "message",
      message.id === "opening-scene" ? "Opening Scene" : `${message.role} message ${index + 1}`,
      message.content,
      recentMessages.length - index,
      index === 0,
      false,
      true,
      "always",
      message.role === "assistant" ? "ai" : message.role === "system" ? "system" : "user",
    ),
  );
  recentMessageItems.forEach((entry, index) =>
    pushIncluded(
      entry,
      `Recent message included newest-first; recencyPriority=${recentMessages.length - index}${index === 0 ? "; protected=newest" : ""}.`,
    ),
  );

  let sections = recalculate([
    systemSection,
    section("aiInstructions", "B. AI Instructions", 1, aiInstructionItems),
    section("plotEssentials", "C. Plot Essentials", 2, plotEssentialItems),
    section("currentArc", "C2. Current Story Arc", 2.5, currentArcItems),
    section("components", "E. Components", 3, generalComponentItems),
    section("pinnedStoryCards", "F0. Pinned Story Cards", 3.5, pinnedStoryCardItems),
    section("recentMessages", "K. Recent Messages", 4, recentMessageItems),
    // Per-turn context follows the history (see buildPayload) so the stable prefix stays cacheable.
    section("storyState", "S. Story State", 5, storyStateItems),
    section("activePressure", "P. Active Pressure", 5.2, activePressureItems),
    section("arcProgress", "C3. Arc Progress", 5.4, arcProgressItems),
    section("storyCards", "F. Story Cards", 6, storyCardItems),
    section("brains", "G. Brains", 7, brainItems),
    // D. Author's Note sits closest to the newest turn (AID-style) for maximum recency influence
    section("authorNote", "D. Author's Note", 8, authorNoteItems),
    section("nextTurnNote", "J. Next Output Bias", 10, nextTurnNoteItems),
    section("challengeMode", "M. Continuity Challenge", 10.5, challengeItems),
  ]);

  const budget = budgetSettings.maxContextTokens;

  // Minimum recent dialogue: the newest N messages outrank unprotected memory under budget pressure.
  // They are trimmed (oldest first) only when protected and pinned context alone cannot fit beside them.
  const minRecent = Math.max(0, Math.round(budgetSettings.minRecentMessages ?? DEFAULT_MIN_RECENT_DIALOGUE));
  const recentFloorIds = new Set(recentMessageItems.slice(0, minRecent).map((entry) => entry.id));
  let recentFloorReleased = false;

  const isDroppable = (sectionId: ContextSectionKind, entry: ContextItem): boolean => {
    if (entry.protected || entry.id === "system-shell") return false;
    if (!recentFloorReleased && sectionId === "recentMessages" && recentFloorIds.has(entry.id)) return false;
    if (
      sectionId === "storyCards" &&
      !entry.pinned &&
      entry.sourceType === "storyCard" &&
      !budgetSettings.allowSystemToDropUnpinnedTriggeredCards
    ) {
      return false;
    }
    return true;
  };

  const dropItem = (sectionId: ContextSectionKind, dropped: ContextItem, detail: string): boolean => {
    const target = sections.find((entry) => entry.id === sectionId);
    if (!target) return false;
    target.items = target.items.filter((entry) => entry.id !== dropped.id);
    pushExcluded(dropped.sourceType, dropped.id, dropped.title, "budget_exceeded", detail);
    sections = recalculate(sections);
    return true;
  };

  const dropOldestRecent = (): boolean => {
    const recentSection = sections.find((entry) => entry.id === "recentMessages");
    if (!recentSection) return false;
    const dropped = [...recentSection.items].reverse().find((entry) => isDroppable("recentMessages", entry));
    return dropped ? dropItem("recentMessages", dropped, "Dropped oldest recent message according to userLocked/hybrid priority behavior.") : false;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const truncateSummaryIfPossible = (): boolean => false;

  const candidateScore = (sectionId: ContextSectionKind, entry: ContextItem): number => {
    const pinnedBonus = entry.pinned ? 1000 : 0;
    const policyPenalty = entry.inclusionPolicy === "systemSuggested" ? -100 : 0;
    const sectionBonus = sectionId === "recentMessages" ? 0 : 10;
    return entry.priority + pinnedBonus + policyPenalty + sectionBonus;
  };

  const dropLowestAny = (filter: (sectionId: ContextSectionKind, entry: ContextItem) => boolean = () => true, detail = "Dropped lowest-priority unprotected context item."): boolean => {
    const candidates = sections.flatMap((sectionEntry) =>
      sectionEntry.items
        .filter((entry) => isDroppable(sectionEntry.id, entry) && filter(sectionEntry.id, entry))
        .map((entry) => ({ sectionId: sectionEntry.id, entry, score: candidateScore(sectionEntry.id, entry) })),
    );
    candidates.sort((a, b) => a.score - b.score || a.entry.priority - b.entry.priority || a.entry.id.localeCompare(b.entry.id));
    const candidate = candidates[0];
    return candidate ? dropItem(candidate.sectionId, candidate.entry, detail) : false;
  };

  const dropLowestTriggered = (): boolean =>
    dropLowestAny(
      (sectionId, entry) => sectionId === "storyCards" && !entry.pinned,
      "Dropped lowest-priority unpinned triggered memory after recent messages and summary cuts.",
    );

  const dropSystemSuggested = (): boolean =>
    dropLowestAny(
      (_sectionId, entry) => entry.inclusionPolicy === "systemSuggested",
      "Hybrid mode dropped system-suggested context before user-locked context.",
    );

  const applyUserLockedBudget = (): boolean => {
    if (dropOldestRecent()) return true;
    if (truncateSummaryIfPossible()) return true;
    if (budgetSettings.allowSystemToDropUnpinnedTriggeredCards && dropLowestTriggered()) return true;
    if (dropLowestAny((_sectionId, entry) => !entry.pinned, "Dropped lowest-priority unprotected, unpinned context item.")) return true;
    return dropLowestAny(() => true, "Dropped pinned but unprotected context item because protected context alone exceeded the budget.");
  };

  const applySystemSuggestedBudget = (): boolean => {
    if (budgetSettings.allowSystemToPrioritizeMemory && dropLowestAny(() => true, "System-suggested priority mode dropped the lowest scored unprotected item.")) {
      return true;
    }
    if (dropOldestRecent()) return true;
    if (truncateSummaryIfPossible()) return true;
    return dropLowestAny();
  };

  const applyHybridBudget = (): boolean => {
    if (budgetSettings.allowSystemToPrioritizeMemory && dropSystemSuggested()) return true;
    return applyUserLockedBudget();
  };

  while (totalTokens(sections) > budget) {
    const changed =
      budgetSettings.memoryPriorityMode === "systemSuggested"
        ? applySystemSuggestedBudget()
        : budgetSettings.memoryPriorityMode === "hybrid"
          ? applyHybridBudget()
          : applyUserLockedBudget();
    if (!changed && !recentFloorReleased && recentFloorIds.size > 0) {
      recentFloorReleased = true;
      decisions.push(sourceDecision("message", "recent-dialogue-floor", "Minimum recent dialogue", "truncated", "budget_exceeded",
        `The newest ${minRecent} messages could not all fit beside protected context; trimming them oldest first.`));
      continue;
    }
    if (!changed) break;
  }

  sections.forEach((contextSection) => {
    contextSection.items.forEach((entry, index) => {
      decisions.push(
        decision(
          entry,
          "ordered",
          "priority_order",
          `${contextSection.label}: position ${index + 1}; priority=${entry.priority}; pinned=${entry.pinned}; protected=${entry.protected}; inclusionPolicy=${entry.inclusionPolicy}; generatedBy=${entry.generatedBy}.`,
        ),
      );
    });
  });

  const recentSection = sections.find((entry) => entry.id === "recentMessages");
  const finalRecentMessageIds = new Set(recentSection?.items.map((entry) => entry.id) ?? []);
  const finalRecentMessages = recentMessages.filter((message) => finalRecentMessageIds.has(message.id));

  const pendingProposals: MemoryProposal[] = adventure.activeState.memoryProposals.filter(
    (proposal) => proposal.status === "pending",
  );

  return {
    messages: buildPayload(sections, finalRecentMessages),
    sections: sections.sort((a, b) => a.order - b.order),
    totalEstimatedTokens: totalTokens(sections),
    excludedItems,
    decisions,
    triggeredThreadIds: [...triggeredThreadIds],
    pendingProposals,
  };
}
