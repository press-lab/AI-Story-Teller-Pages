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
  result.adventure = actions.reduce(adventureReducer, result.adventure);
  result.adventure = adventureReducer(result.adventure, { type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: source.id, manual: true });
  return result;
}
