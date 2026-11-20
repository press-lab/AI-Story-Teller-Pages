import { afterEach, expect, it, vi } from "vitest";
import { looseMemoryFixture } from "../test/looseMemory";
import * as transport from "../providers/memoryCompletion";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { defaultModelConfig, makeStoryCard } from "../state/defaults";
import { parseLooseMemoryOperations } from "./looseMemoryParser";
import { parseSinglePassMemoryResponse, prepareSinglePassMemoryBatch, runSinglePassMemoryBatch, singlePassReferenceState } from "./singlePassMemory";
import { routeLooseMemoryOperations } from "./looseMemoryRouter";
import { validateSinglePassSource } from "./singlePassMemoryValidation";

it("routes source-scoped aliases by exact set and preserves proposal links", async () => {
  const { a, ids } = looseMemoryFixture();
  a.storyCards.push(makeStoryCard({ id: "pair", title: "Partners", type: "relationship", content: "Fred and George were colleagues.",
    relationship: { characterIds: ["george", "fred"] }, active: false }));
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const parsed = parseLooseMemoryOperations([
    "S1", "(storyCard.relationship: George + Fred Weasley = Fred and George committed to share their workshop.)",
    "S2", "(relationship: Draconia + George + Fred = The three established a recurring workshop meeting.)",
    "S3", "(relationship: Fred + George = Fred and George agreed to split the costs.)",
  ].join("\n"), ["S1", "S2", "S3"]);
  const result = routeLooseMemoryOperations(a, batch, parsed);
  expect(result.sources.map(source => source.rejected)).toEqual([[], [], []]);
  expect(result.sources.map(source => source.findings[0]?.targetId)).toEqual(["pair", null, "pair"]);
  expect(result.sources.map(source => source.findings[0]?.evidenceQuotes[0].messageId)).toEqual(ids);
  expect(validateSinglePassSource(a, result.sources[0], batch.checkpoints[0].checkpoint).proposals[0].proposal)
    .toMatchObject({ storyCardType: "relationship", relationship: { characterIds: ["fred", "george"] }, suggestedTriggers: [] });
  const legacy = parseSinglePassMemoryResponse(JSON.stringify({ sources: [{ sourceId: ids[0], findings: result.sources[0].findings }] }), [ids[0]], a);
  expect(legacy.sources[0].rejected[0]?.reason).toContain("loose grammar");
});

it("rejects malformed grammar and ambiguous or missing identities without Lore fallback", async () => {
  const { a, ids } = looseMemoryFixture();
  a.storyCards.push(makeStoryCard({ id: "other", title: "Other", type: "character", keys: ["George"], content: "" }));
  const batch = await prepareSinglePassMemoryBatch(a, [ids[0]]);
  const result = routeLooseMemoryOperations(a, batch, parseLooseMemoryOperations([
    "(relationship: Fred+George = One.)",
    "(storyCard.relationship.create: Fred + George = Two.)",
    "(relationship: Fred + George = Three.)",
    "(relationship: Fred + Missing = Four.)",
  ].join("\n"), ["S1"])).sources[0];
  expect(result.findings).toEqual([]);
  expect(result.rejected).toHaveLength(4);
  expect(result.rejected.map(entry => entry.reason).join(" ")).toMatch(/Ambiguous participant: George.*Unknown participant: Missing/);
});

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("uses one request and honors independent Relationship Story Cards approval (%s)", async autoApprove => {
  let { a, ids } = looseMemoryFixture();
  a.memoryAutoApprove.relationshipStoryCard = autoApprove;
  a.memoryAutoApprove.otherStoryCard = !autoApprove;
  a.messages[0].content = "Fred and George agreed to be long-term business partners. Fred promised to keep George's private account records confidential.";
  const batch = await prepareSinglePassMemoryBatch(a, [ids[0]]);
  const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content: [
    "S1", "(relationship: Fred + George = Fred and George agreed to be long-term business partners.)",
    "(relationship: George + Fred = Fred promised to keep George's private account records confidential.)",
  ].join("\n") });
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  const result = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
  expect(result.sources[0].rejected).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
  a = reduce(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId,
    sources: [{ result: result.sources[0], checkpoint: batch.checkpoints[0].checkpoint }] });
  expect(a.storyCards.filter(card => card.type === "relationship")).toHaveLength(autoApprove ? 1 : 0);
  const proposals = a.activeState.memoryProposals.filter(proposal => proposal.storyCardType === "relationship");
  expect(proposals).toHaveLength(2);
  expect(proposals.filter(proposal => proposal.status === "pending")).toHaveLength(autoApprove ? 1 : 2);
  if (autoApprove) expect(proposals.find(proposal => proposal.status === "pending")).toMatchObject({ cardOperation: "append", requiresReview: true });
});

it("keeps inactive identities in the pooled manifest and rechecks edited evidence and references", async () => {
  const { a, ids } = looseMemoryFixture();
  a.storyCards.find(card => card.id === "george")!.active = false;
  const batch = await prepareSinglePassMemoryBatch(a, [ids[0]]);
  const george = Object.values(batch.outputAliases.S1.characters ?? {}).find(card => card.id === "george")!;
  expect(batch.payload.references[george.reference]).toEqual({ id: "george", title: "George Weasley", keys: ["George Weasley", "George"] });
  a.storyCards.find(card => card.id === "george")!.keys = ["New alias"];
  expect(singlePassReferenceState(a, ids[0])).not.toBe(batch.checkpoints[0].checkpoint.referenceState);
  a.messages[0].content += " Edited.";
  const result = routeLooseMemoryOperations(a, batch, parseLooseMemoryOperations("(relationship: Fred + George = They witnessed the opening.)", ["S1"]));
  expect(result.sources[0].findings).toEqual([]);
  expect(result.sources[0].rejected[0]?.reason).toContain("Source content or revision changed");
});
