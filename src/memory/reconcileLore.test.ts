import { beforeEach, expect, it, vi } from "vitest";
import { runMemoryReconcile } from "../triggers/semanticEngine";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import type { AdventureAction, MessageRole } from "../types/adventure";
import corridor from "./fixtures/draco-corridor-placement.json";

vi.mock("../providers/openAICompatible", () => ({
  isNativeDeepSeekProvider: vi.fn(() => false),
  sendOpenAICompatibleChatCompletion: vi.fn(),
}));
vi.mock("../providers/memoryCompletion", () => ({ sendMemoryCompletion: vi.fn() }));
const generate = vi.mocked(sendOpenAICompatibleChatCompletion);
const review = vi.mocked(sendMemoryCompletion);
const config = { ...defaultModelConfig, apiKey: "offline" };
const request = { entryCount: 4, includeBrains: false };
const sourceId = corridor.messages.at(-1)!.id;
const response = (value: unknown) => ({ content: JSON.stringify(value), raw: {} });
function seed() {
  const a = createDefaultAdventure();
  a.components = []; a.brains = [];
  a.storyCards = corridor.cards.map(card => makeStoryCard({ ...card, type: "character", memoryMode: "static" }));
  a.messages = corridor.messages.map(message => ({ ...message, role: message.role as MessageRole }));
  a.memoryAutoApprove.storyCard = false;
  return a;
}
function proposals(actions: AdventureAction[]) {
  return actions.filter((action): action is Extract<AdventureAction, { type: "ADD_MEMORY_PROPOSAL" }> => action.type === "ADD_MEMORY_PROPOSAL");
}
beforeEach(() => {
  vi.resetAllMocks();
  generate.mockResolvedValue(response({ updates: corridor.drafts }));
});

it("keeps Character drafts as separate Lore candidates for explicit review without a paid judge", async () => {
  const a = seed(), result = await runMemoryReconcile(a, config, request);
  const added = proposals(result.actions);
  expect(added).toHaveLength(2); expect(review).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce();
  expect(added.map(action => action.proposal.content)).toEqual(corridor.drafts.map(d => d.content));
  expect(added.every(action => action.proposal.storyCardType === "lore" && action.proposal.requiresReview && !action.proposal.targetId && !action.proposal.storyCardPatch)).toBe(true);
  const saved = result.actions.reduce(adventureReducer, a);
  expect(saved.storyCards).toEqual(a.storyCards);
  expect(saved.activeState.memoryProposals.every(p => p.status === "pending")).toBe(true);
  expect(generate.mock.calls[0][0].messages[0].content).toContain("append a factual delta");
});
it("does not use an unrelated validator response to establish semantic certainty", async () => {
  review.mockResolvedValue(response({ accepted: false, reason: "Unsupported claim." }));
  const a = seed(), result = await runMemoryReconcile(a, config, request);
  expect(review).not.toHaveBeenCalled();
  expect(result.actions.reduce(adventureReducer, a).storyCards).toEqual(a.storyCards);
  expect(proposals(result.actions).every(action => action.proposal.requiresReview)).toBe(true);
});
it("uses a listed Character as a reference for direct Lore without inheriting its destination or controls", async () => {
  generate.mockResolvedValue(response({ updates: [{ ...corridor.drafts[0], storyCardType: "lore", memoryMode: "historical",
    title: corridor.loreTitle, content: corridor.lore, storyCardPatch: { pinned: true, protected: true, active: false } }] }));
  const result = await runMemoryReconcile(seed(), config, request);
  expect(review).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce();
  expect(proposals(result.actions)[0].proposal).toMatchObject({ storyCardType: "lore", targetId: undefined,
    requiresReview: true, storyCardPatch: undefined, memoryMode: "historical", content: corridor.lore });
});
it("rejects local placement when no establishing narrator source exists", async () => {
  const a = seed(); a.messages = a.messages.filter(m => m.role === "user");
  const result = await runMemoryReconcile(a, config, { ...request, directive: a.storyCards.map(c => c.title).join(" ") });
  expect(proposals(result.actions)).toHaveLength(0); expect(review).not.toHaveBeenCalled();
  expect(result.actions.some(action => action.type === "RECORD_MEMORY_DIAGNOSTIC" && action.entry.reason?.includes("narrator source"))).toBe(true);
});
