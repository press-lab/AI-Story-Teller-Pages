import { beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/hogwarts-tattoo-append.json";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { detectStoryCardProposals } from "./memoryDetection";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import type { Adventure, StoryCardType } from "../types/adventure";
vi.mock("../providers/memoryCompletion", () => ({ sendMemoryCompletion: vi.fn() }));
const provider = vi.mocked(sendMemoryCompletion);
const config = { ...defaultModelConfig, apiKey: "offline" };
const cases = [
  { source: "message_mvnfsy47_vfmy62t1", title: "Temporary Rune Tattoo Venture", targetId: undefined,
    content: "Seth agreed to join Fred and George's temporary tattoo venture, supplying runic designs. They discussed one-galleon pricing and a possible profit split; no sales occurred." },
  { source: "message_mvnfyjx2_2cmdjj4a", title: "Rune Engineering", targetId: "story_hu2_10",
    content: "Seth described enchanting paper transfers applied with water for thirty seconds, lasting three to five days. Fred and George recognized potential batch production; no production run was demonstrated." },
  { source: "message_mvng5dq7_j2cdlwcc", title: "Magical Products", targetId: "lore_hu_played_20010901_weasley_products",
    content: "Seth applied a temporary lie-detecting rune to Ron's forearm. The rune visibly flashed blue when Ron lied during the group's test; Hermione noted its immediate response." },
  { source: "message_mvngd9do_qy6e8g7v", title: "Tattoo venture", targetId: "venture",
    content: "Seth proposed the Press Sigils Tattoos collaboration name. Fred planned sheets by the weekend and asked Seth to bring his design list to the workshop after dinner; Harry's labour terms remained pending." },
];
function seed() {
  const a = createDefaultAdventure(); a.components = []; a.brains = [];
  a.messages = fixture.messages as Adventure["messages"];
  a.storyCards = fixture.cards.map(card => makeStoryCard({ ...card, type: card.type as StoryCardType, memoryMode: card.memoryMode as "static", autoUpdate: false }));
  a.storyCards.push(makeStoryCard({ id: "venture", title: "Tattoo venture", type: "lore", memoryMode: "historical", autoUpdate: false,
    content: "Seth agreed to work with Fred and George on rune tattoos.", keys: ["tattoo venture"] }));
  a.memoryAutoApprove.storyCard = false;
  return a;
}
function candidate(a: Adventure, test = cases[0]) {
  const messages = memoryEvidenceWindow(a, test.source);
  return { title: test.title, content: test.content, targetId: test.targetId,
    storyCardType: test.targetId ? a.storyCards.find(c => c.id === test.targetId)!.type : "lore",
    eventStatus: "completed", candidateOnly: false, rationale: "A supported durable development, with plans distinguished from results.",
    evidenceMessageIds: messages.map(m => m.id), evidenceQuotes: messages.map(m => ({ messageId: m.id, quote: m.content })),
    suggestedTriggers: ["rune tattoos", "paper transfers", "tattoo venture"] };
}
function response(value: unknown) { return { content: JSON.stringify(value), raw: {} }; }
beforeEach(() => { provider.mockReset(); });
it.each(cases)("retains the supported tattoo development from $source", async test => {
  const a = seed(), finding = candidate(a, test);
  provider.mockImplementation(async (_a, _config, messages) => {
    if (messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) {
      const body = JSON.parse(messages.at(-1)!.content);
      return response({ accepted: true, meaningfulChange: true, identityMatchesTarget: true, evidenceMessageIds: finding.evidenceMessageIds,
        reason: "Supported original exchange.", placement: { kind: test.targetId ? "append" : "create", targetId: test.targetId,
          title: body.title, content: body.proposed, newFact: body.proposed, reason: "Same durable subject." } });
    }
    return response([finding]);
  });
  const result = await detectStoryCardProposals(a, config, { sourceId: test.source });
  expect(result.errors).toEqual([]);
  const adds = result.actions.filter(action => action.type === "ADD_MEMORY_PROPOSAL" && action.proposal.storyCardReview?.origin === "model"); expect(adds).toHaveLength(1);
  const add = adds[0];
  if (add.type !== "ADD_MEMORY_PROPOSAL") throw new Error("Expected memory proposal");
  const p = add.proposal;
  expect(p).toMatchObject({ targetId: test.targetId, cardOperation: test.targetId ? "append" : "create", content: test.content });
  expect(p.storyCardReview?.evidenceQuotes).toEqual(finding.evidenceQuotes);
  let next = result.actions.reduce(reduce, a);
  expect(next.activeState.memoryProposals[0].status).toBe("pending"); expect(next.storyCards).toEqual(a.storyCards);
  next = reduce(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
  const saved = next.storyCards.find(c => test.targetId ? c.id === test.targetId : c.title === test.title)!;
  expect(saved.content).toContain(test.content);
  if (test.targetId) { expect(saved.content).toContain(a.storyCards.find(c => c.id === test.targetId)!.content); expect(saved.autoUpdate).toBe(false); }
  expect(reduce(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(next);
  expect(result.actions).toContainEqual(expect.objectContaining({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: expect.objectContaining({
    outcome: "validation_accepted", targetId: test.targetId, cardOperation: test.targetId ? "append" : "create" }) }));
});
it("repairs a foreign ID against original evidence once and still requires semantic review", async () => {
  const a = seed(), good = candidate(a);
  provider.mockResolvedValueOnce(response([{ ...good, evidenceMessageIds: ["invented"] }]))
    .mockResolvedValueOnce(response(good)).mockResolvedValueOnce(response({ accepted: true, meaningfulChange: true,
      identityMatchesTarget: true, evidenceMessageIds: good.evidenceMessageIds, reason: "Grounded agreement.",
      placement: { kind: "create", title: good.title, content: good.content, newFact: good.content, reason: "New business subject." } }));
  const result = await detectStoryCardProposals(a, config, { sourceId: cases[0].source });
  expect(result.errors).toEqual([]); expect(provider).toHaveBeenCalledTimes(3);
  expect(result.actions.filter(action => action.type === "ADD_MEMORY_PROPOSAL" && action.proposal.storyCardReview?.origin === "model")).toHaveLength(1);
});
it("never accepts fabricated quotes when the bounded repair is also invalid", async () => {
  const a = seed(), bad = { ...candidate(a), evidenceQuotes: [{ messageId: cases[0].source, quote: "Seth completed an industrial factory." }] };
  provider.mockResolvedValueOnce(response([bad])).mockResolvedValueOnce(response(bad));
  const result = await detectStoryCardProposals(a, config, { sourceId: cases[0].source });
  expect(provider).toHaveBeenCalledTimes(2); expect(result.actions.filter(action => action.type === "ADD_MEMORY_PROPOSAL" && action.proposal.storyCardReview?.origin === "model")).toHaveLength(0);
  expect(result.actions).toContainEqual(expect.objectContaining({ type: "RECORD_MEMORY_DIAGNOSTIC", entry: expect.objectContaining({ failureCode: "discovery_invalid_evidence_quote" }) }));
});
