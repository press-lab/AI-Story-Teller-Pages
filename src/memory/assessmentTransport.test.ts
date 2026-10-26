import { afterEach, expect, it, vi } from "vitest";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { assessmentConfig, assessmentFixture, mockAssessmentHttp, potions, sales } from "../test/hogwartsAssessment";
import { memoryCycleSources } from "./memoryCycleState";
import { subscribeApiCalls } from "../providers/apiCallAccounting";
import { onePassMemoryInstruction } from "./onePassMemory";
import type { Adventure, ApiCallRecord } from "../types/adventure";

afterEach(() => vi.restoreAllMocks());
it.each([false, true])("keeps the legacy narrator task on its envelope contract (Story Cards: %s)", includeStoryCards => {
  const prompt = onePassMemoryInstruction([], [], includeStoryCards);
  expect(prompt).toContain('<memory_updates>{"updates":[]}</memory_updates>');
  expect(prompt).not.toMatch(/Return suggestions or an empty array|return an empty array/);
});
async function cycle(a: Adventure) {
  const sourceId = a.messages.at(-1)!.id;
  const claimed = reduce(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId, turn: a.activeState.turn, manual: true });
  const result = await runMemoryCycle(claimed, assessmentConfig, { sourceId, manual: true });
  return { ...result, state: result.actions.reduce(reduce, claimed) };
}
it.each([false, true])("sends one shared output contract through the save's Anthropic path (prompt caching: %s)", async promptCaching => {
  const a = assessmentFixture("routine"), http = mockAssessmentHttp(a, "routine");
  a.semanticEvaluationSettings.backgroundProviderConfig = undefined;
  // Exercise both the string system prompt and Anthropic cache-control blocks.
  const sourceId = a.messages.at(-1)!.id;
  const result = await runMemoryCycle(a, { ...assessmentConfig, promptCaching }, { sourceId, manual: true });
  expect(http.spy).toHaveBeenCalledTimes(1);
  const { body, url } = http.requests[0];
  expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
  const wire = JSON.stringify(body);
  expect(wire.match(/Return ONLY a JSON object/g)).toHaveLength(1);
  expect(wire).not.toMatch(/Return suggestions or an empty array|suggest Plot Component updates|Return ONLY a JSON array|candidateOnly=true|eventStatus=unresolved/);
  expect(wire).toContain("Plot Essentials: premise/constraints");
  expect(wire).toContain("Every field is required");
  expect(body).not.toHaveProperty("response_format");
  expect(body).not.toHaveProperty("reasoning");
  const state = result.actions.reduce(reduce, a);
  expect(state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(state.activeState.memoryProposals).toHaveLength(0);
});
it("records one shared failure with exact safe fields and keeps HTTP success separate", async () => {
  const a = assessmentFixture("breakfast"), http = mockAssessmentHttp(a, "breakfast", { invalid: "[]" });
  const calls: ApiCallRecord[] = [], unsubscribe = subscribeApiCalls(call => calls.push(call));
  try {
    const r = await cycle(a);
    const diagnostics = r.state.activeState.memoryDiagnostics!.filter(d => d.outcome === "evaluation_failed");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ sourceId: "message_mvohiudy_5a4yw393", requestStage: "assessment",
      failureCode: "memory_assessment_wrong_type", fieldPath: "$", transport: "succeeded", evaluationAttempt: 4 });
    expect(diagnostics[0].group).toBeUndefined();
    expect(calls.filter(c => c.status === "succeeded")).toHaveLength(1);
    expect(calls.at(-1)?.memoryRequest).toMatchObject({ sourceId: a.messages.at(-1)!.id, stage: "assessment" });
    expect(http.spy).toHaveBeenCalledTimes(1); // no fallback or format-repair request
    expect(r.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "quarantined", completedGroups: [] });
    expect(r.state.activeState.memoryProposals).toHaveLength(0);
  } finally { unsubscribe(); }
});
it("retries the existing quarantined breakfast, appends to product Lore and never duplicates it", async () => {
  const a = assessmentFixture("breakfast"), http = mockAssessmentHttp(a, "breakfast");
  expect(a.messages.at(-1)?.memoryEvaluation?.status).toBe("quarantined");
  expect(memoryCycleSources(a)).toEqual([]);
  const r = await cycle(a);
  expect(r.logEntry.errors).toEqual([]);
  expect(http.spy).toHaveBeenCalledTimes(3);
  expect(r.state.activeState.memoryProposals).toHaveLength(1);
  const proposal = r.state.activeState.memoryProposals[0];
  expect(proposal).toMatchObject({ cardOperation: "append", targetId: a.storyCards[0].id, storyCardType: "lore", content: sales });
  expect(r.state.messages.map(m => m.content)).toEqual(a.messages.map(m => m.content));
  const approved = reduce(r.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
  expect(approved.storyCards).toHaveLength(a.storyCards.length);
  expect(approved.storyCards[0].content).toContain(a.storyCards[0].content);
  expect(approved.storyCards[0].content).toContain(sales);
  const again = await cycle(approved);
  expect(again.state.storyCards).toEqual(approved.storyCards);
  expect(again.state.activeState.memoryProposals).toEqual(approved.activeState.memoryProposals);
  expect(http.spy).toHaveBeenCalledTimes(3);
});
it("resumes quarantined saved reviews without replaying assessment, generation or completed groups", async () => {
  const a = assessmentFixture("breakfast");
  const firstHttp = mockAssessmentHttp(a, "breakfast", { failReview: true });
  const first = await cycle(a);
  expect(first.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "quarantined", completedGroups: ["plot", "brains", "discovery"] });
  expect(first.state.messages.at(-1)?.memoryEvaluation?.groupWork?.storyCards?.drafts).toBeDefined();
  firstHttp.spy.mockRestore();
  const retry = mockAssessmentHttp(first.state, "breakfast");
  const result = await cycle(first.state);
  expect(retry.spy).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(retry.requests[0].body)).toContain("MEMORY UPDATE VALIDATION");
  expect(result.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(result.state.activeState.memoryProposals).toHaveLength(1);
});
it("preserves all checkpoints, approved proposals and completed groups when reassessment fails", async () => {
  const a = assessmentFixture("breakfast");
  const http = mockAssessmentHttp(a, "breakfast");
  const good = await cycle(a);
  const approved = reduce(good.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: good.state.activeState.memoryProposals[0].id });
  const ev = approved.messages.at(-1)!.memoryEvaluation!;
  ev.status = "quarantined"; ev.completedGroups = ["plot", "brains"]; // imported partially completed recovery
  ev.groupWork = { storyCards: { fingerprint: "old-checkpoint", drafts: { saved: { raw: "Saved generated draft" } } } };
  ev.discoveryCheckpoint = { version: 1, dependencies: [], referenceFingerprint: "old-discovery", candidates: [] };
  http.spy.mockRestore();
  const broken = mockAssessmentHttp(approved, "breakfast", { invalid: "{}" });
  const failed = await cycle(approved);
  expect(broken.spy).toHaveBeenCalledTimes(1);
  const actual = failed.state.messages.at(-1)!.memoryEvaluation!;
  expect(actual.completedGroups).toEqual(ev.completedGroups);
  expect(actual.groupWork).toEqual(ev.groupWork);
  expect(actual.discoveryCheckpoint).toEqual(ev.discoveryCheckpoint);
  expect(actual.assessment).toEqual(ev.assessment);
  expect(failed.state.activeState.memoryProposals).toEqual(approved.activeState.memoryProposals);
  expect(failed.state.storyCards).toEqual(approved.storyCards);
  expect(failed.state.messages.map(m => m.content)).toEqual(approved.messages.map(m => m.content));
});
it.each([false, true])("does not duplicate recorded Charms facts (model nominates covered target: %s)", async covered => {
  const a = assessmentFixture("charms"), http = mockAssessmentHttp(a, "charms", { covered });
  const r = await cycle(a);
  expect(r.logEntry.errors).toEqual([]);
  expect(r.state.activeState.memoryProposals).toHaveLength(0);
  expect(http.spy).toHaveBeenCalledTimes(1);
});
it.each([false, true])("allows either a quiet Potions decision or supported public Lore (Lore: %s)", async potionsLore => {
  const a = assessmentFixture("potions"), http = mockAssessmentHttp(a, "potions", { potionsLore });
  const r = await cycle(a);
  expect(r.logEntry.errors).toEqual([]);
  expect(r.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(http.spy).toHaveBeenCalledTimes(potionsLore ? 3 : 1);
  expect(r.state.brains).toEqual(a.brains);
  expect(r.state.activeState.memoryProposals).toHaveLength(potionsLore ? 1 : 0);
  if (potionsLore) expect(r.state.activeState.memoryProposals[0]).toMatchObject({ storyCardType: "lore", content: potions });
});
