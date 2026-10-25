import { reviewedProposal } from "./memoryPlacement";
import { makeStoryCardSuggestion } from "../memory/storyCardSuggestions";
/** Compatibility tests for the payload adapter still used by explicit compact catch-up.
 * This helper is never part of normal play: tests feed legacy findings explicitly.
 */
import type { Adventure } from "../types/adventure";
import { buildContext } from "../contextBuilder/contextBuilder";
import { ONE_PASS_MEMORY_ID, onePassMemoryInstruction, onePassMemoryActions, parseOnePassMemory } from "../memory/onePassMemory";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline, type RunTurnPipelineOptions } from "../state/turnPipeline";

export function legacyMemoryContext(adventure: Adventure, options: Parameters<typeof buildContext>[1] = {}) {
  const context = buildContext(adventure, options);
  context.sections.find(section => section.id === "system")!.items.push({
    id: ONE_PASS_MEMORY_ID, title: "Explicit legacy adapter test", sourceType: "system", generatedBy: "system",
    content: onePassMemoryInstruction(adventure.brains.filter(brain => brain.active), []),
    priority: 0, protected: false, pinned: false, active: true, inclusionPolicy: "always", tokenEstimate: 0,
  });
  return context;
}

export async function runLegacyCandidateFixture(options: RunTurnPipelineOptions) {
  let raw = "";
  const result = await runTurnPipeline({ ...options, sendChatCompletion: async (...args) => {
    const response = await options.sendChatCompletion(...args);
    raw = response.content;
    return response;
  } });
  if (!options.adventure.memoryDetectionSettings.enabled || options.mode === "comms") return result;
  const source = result.adventure.messages.at(-1)!;
  const parsed = parseOnePassMemory(raw);
  const context = legacyMemoryContext(result.adventure, { currentInput: options.text, latestModelOutput: source.content });
  const actions = onePassMemoryActions(result.adventure, context, parsed.updates, source.content, source.id, parsed.error,
    "Explicit legacy candidate adapter test", options.text);
  const reviewedActions = actions.flatMap(action => {
    if (action.type !== "ADD_MEMORY_PROPOSAL" || action.proposal.proposedType !== "storyCard") return [action];
    const p = action.proposal, target = result.adventure.storyCards.find(c => c.id === p.targetId);
    // Synthetic reviewer answers for the old adapter's fixed fixtures. Real review
    // is exercised through validateStoryCardProposal in placement/pipeline tests.
    const identity = target && /\b(died|dies|dead|killed|destroyed)\b/i.test(p.content)
      && !/\b(kin|parents|relatives|years|1997)\b/i.test(p.content);
    const profile = identity || p.content === "Silver burns Mira's skin.";
    const routed = target && ["character", "location"].includes(target.type) && !profile
      ? makeStoryCardSuggestion(result.adventure, source.id, source.content, { title: p.title, content: p.content, type: "lore", evidence: p.sourceText,
        reason: p.rationale, candidateOnly: p.storyCardReview?.candidateOnly, triggers: p.suggestedTriggers }) : p;
    const reviewed = reviewedProposal(result.adventure, routed);
    const companion = identity ? makeStoryCardSuggestion(result.adventure, source.id, source.content, { title: `${p.title}: Status change`, content: p.content,
      evidence: p.sourceText, type: "lore", reason: "Synthetic supporting history", candidateOnly: true }) : undefined;
    return [{ type: "ADD_MEMORY_PROPOSAL" as const, proposal: reviewed }, ...(companion ? [{ type: "ADD_MEMORY_PROPOSAL" as const, proposal: reviewedProposal(result.adventure, companion) }] : [])];
  });
  result.adventure = reviewedActions.reduce(adventureReducer, result.adventure);
  result.adventure = adventureReducer(result.adventure, { type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: source.id, manual: true });
  return result;
}
