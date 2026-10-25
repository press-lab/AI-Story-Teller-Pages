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
function verdict(identityMatchesTarget: boolean) {
  return { accepted: true, meaningfulChange: true, identityMatchesTarget, evidenceMessageIds: [sourceId],
    reason: "The observable exchange is supported; it does not change either person's identity.",
    placement: { kind: "historicalLore", title: corridor.loreTitle, content: corridor.lore,
      newFact: corridor.lore, reason: "Completed confrontation belongs in Lore, without biography or private interpretations." } };
}
function proposals(actions: AdventureAction[]) {
  return actions.filter((action): action is Extract<AdventureAction, { type: "ADD_MEMORY_PROPOSAL" }> => action.type === "ADD_MEMORY_PROPOSAL");
}
beforeEach(() => {
  vi.resetAllMocks();
  generate.mockResolvedValue(response({ updates: corridor.drafts }));
});

it("extracts both saved profile rewrites into one revalidated Lore finding and preserves both Characters", async () => {
  review.mockImplementation(async (_a, _config, messages) => {
    const body = JSON.parse(messages.at(-1)!.content);
    return response(verdict(body.targetInfo.type === "lore"));
  });
  const a = seed(), result = await runMemoryReconcile(a, config, request);
  const added = proposals(result.actions);
  expect(added).toHaveLength(1);
  expect(review).toHaveBeenCalledTimes(4); // Each extraction gets its own final Lore attribution review.
  expect(added[0].proposal).toMatchObject({ title: corridor.loreTitle, content: corridor.lore,
    storyCardType: "lore", memoryMode: "historical", targetId: undefined, storyCardPatch: undefined,
    placementValidation: { kind: "historicalLore" }, storyCardReview: { sourceMessageId: sourceId } });
  expect(result.actions.some(action => action.type === "RECORD_MEMORY_DIAGNOSTIC" && action.entry.outcome === "candidate_merged")).toBe(true);
  let saved = result.actions.reduce(adventureReducer, a);
  saved = adventureReducer(saved, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: added[0].proposal.id });
  expect(saved.storyCards.filter(card => card.type === "character")).toEqual(a.storyCards);
  expect(saved.storyCards.filter(card => card.type === "lore").map(card => card.content)).toEqual([corridor.lore]);
  expect(generate.mock.calls[0][0].messages[0].content).toContain("near immutable");
  expect(review.mock.calls[0][2].some(message => message.content.includes("Even death belongs primarily in historicalLore"))).toBe(true);
});

it.each(["malformed placement", "unsupported facts", "failed final attribution"])("records %s in Decisions instead of publishing the original Character draft", async failure => {
  review.mockImplementation(async (_a, _config, messages) => {
    const body = JSON.parse(messages.at(-1)!.content);
    const v = verdict(false);
    if (failure === "malformed placement") return response({ ...v, placement: {} });
    if (failure === "unsupported facts") return response({ ...v, accepted: false, reason: "The alleged formal challenge is unsupported." });
    return response({ ...v, reason: body.targetInfo.type === "lore" ? "Participants are not verified." : v.reason });
  });
  const a = seed(), result = await runMemoryReconcile(a, config, request);
  expect(proposals(result.actions)).toHaveLength(0);
  const diagnostics = result.actions.filter(action => action.type === "RECORD_MEMORY_DIAGNOSTIC");
  expect(diagnostics).toHaveLength(2);
  expect(diagnostics.every(action => action.entry.outcome === "validation_rejected" && action.entry.candidate?.content)).toBe(true);
  const saved = result.actions.reduce(adventureReducer, a);
  expect(saved.storyCards).toEqual(a.storyCards);
  expect(saved.activeState.memoryProposals).toHaveLength(0);
  expect(saved.activeState.memoryDiagnostics).toHaveLength(2);
  expect(review.mock.calls.length).toBeLessThanOrEqual(4);
});

it("uses a listed Character as a reference for direct Lore without inheriting its destination or controls", async () => {
  generate.mockResolvedValue(response({ updates: [{ ...corridor.drafts[0], storyCardType: "lore", memoryMode: "historical",
    title: corridor.loreTitle, content: corridor.lore, storyCardPatch: { pinned: true, protected: true, active: false } }] }));
  review.mockResolvedValue(response(verdict(true)));
  const result = await runMemoryReconcile(seed(), config, request);
  expect(review).toHaveBeenCalledOnce();
  expect(proposals(result.actions)[0].proposal).toMatchObject({ storyCardType: "lore", targetId: undefined,
    storyCardPatch: undefined, memoryMode: "historical", content: corridor.lore });
  expect(JSON.parse(review.mock.calls[0][2].at(-1)!.content).targetInfo).toEqual({ type: "lore", memoryMode: "historical" });
});
