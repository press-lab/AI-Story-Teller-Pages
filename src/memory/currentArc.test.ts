import { describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { defaultModelConfig, makeComponent, normalizeAdventure } from "../state/defaults";
import { singlePassFixture } from "../test/singlePassMemory";
import * as transport from "../providers/memoryCompletion";
import { buildSinglePassMemoryMessages, prepareSinglePassMemoryBatch, runSinglePassMemoryBatch } from "./singlePassMemory";

const initial = "CURRENT DEVELOPMENTS\nThe wardens are investigating.\n\nCOMPLETED DEVELOPMENTS\nThe gate fell.";
const replacement = "CURRENT DEVELOPMENTS\nThe scouts are secretly crossing.\n\nCOMPLETED DEVELOPMENTS\nThe gate fell.";

function fixture() {
  const { a, ids } = singlePassFixture(1);
  const plan = makeComponent({ type: "currentArcPlan", title: "Current Arc Plan", content: "Hidden design for the Sapphire Pass.", pinned: true });
  const state = makeComponent({ type: "currentArcState", title: "Current Arc State", content: initial, pinned: true, arcIntensity: "executeNow" });
  a.components.push(plan, state);
  return { a, ids, plan, state };
}

describe("current arc", () => {
  it.each(["missing plan", "inactive plan", "inactive state", "dormant"] as const)("excludes %s from automatic context", async mode => {
    const { a, ids, plan, state } = fixture();
    if (mode === "missing plan") a.components = a.components.filter(c => c.id !== plan.id);
    if (mode === "inactive plan") plan.active = false;
    if (mode === "inactive state") state.active = false;
    if (mode === "dormant") state.arcIntensity = "dormant";
    const prompt = JSON.stringify(buildSinglePassMemoryMessages(await prepareSinglePassMemoryBatch(a, ids)));
    expect(prompt).not.toMatch(/Sapphire Pass|wardens are investigating|component\.currentArcState/);
    expect(JSON.stringify(buildContext(a).messages)).not.toMatch(/Sapphire Pass|wardens are investigating/);
  });

  it.each([false, true])("routes a replacement in one request (auto-approval %s)", async autoApprove => {
    const { a, ids, plan, state } = fixture();
    a.memoryAutoApprove.currentArcStateUpdate = autoApprove;
    const narration = JSON.stringify(buildContext(a).messages);
    expect(narration).toContain("ARC INTENSITY: EXECUTE NOW");
    expect(narration).toContain("The wardens are investigating.");
    expect(narration).not.toContain(plan.content);
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    expect(JSON.stringify(buildSinglePassMemoryMessages(batch))).toContain(plan.content);
    const claimed = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
    const provider = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({
      raw: {}, content: "S1\n(component.currentArcState: Current Arc State = " + replacement + ")",
    });
    try {
      const response = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(response.sources[0].findings[0]?.kind).toBe("currentArcState");
      const committed = reduce(claimed, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId,
        sources: response.sources.map((result, i) => ({ result, checkpoint: batch.checkpoints[i].checkpoint })) });
      const proposal = committed.activeState.memoryProposals.find(p => p.proposedType === "currentArcStateUpdate")!;
      expect(proposal.status).toBe(autoApprove ? "approved" : "pending");
      const approved = autoApprove ? committed : reduce(committed, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
      expect(approved.components.find(c => c.id === state.id)).toMatchObject({ content: replacement, arcIntensity: "executeNow" });
      if (!autoApprove) {
        const withoutPlan = reduce(committed, { type: "DELETE_COMPONENT", componentId: plan.id });
        const blocked = reduce(withoutPlan, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
        expect(blocked.components.find(c => c.id === state.id)?.content).toBe(initial);
      }
    } finally {
      provider.mockRestore();
    }
  });

  it("removes stale arc references before sending the existing request", async () => {
    const { a, ids, plan } = fixture();
    const batch = await prepareSinglePassMemoryBatch(a, ids);
    const incomplete = reduce(a, { type: "DELETE_COMPONENT", componentId: plan.id });
    const provider = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content: "S1\nNONE" });
    try {
      await runSinglePassMemoryBatch(incomplete, defaultModelConfig, batch);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(provider.mock.calls[0][2])).not.toMatch(/Sapphire Pass|wardens are investigating|arcPlan|component\\.currentArcState/);
    } finally {
      provider.mockRestore();
    }
  });

  it("converts completed history once without a Plan and retains approval settings on reload", () => {
    const { a, plan, state } = fixture();
    a.memoryAutoApprove.otherStoryCard = true;
    delete a.memoryAutoApprove.currentArcStateUpdate;
    const restored = normalizeAdventure(JSON.parse(JSON.stringify(a)));
    expect(restored.memoryAutoApprove).toMatchObject({ otherStoryCard: true, currentArcStateUpdate: false });
    expect(restored.components.find(c => c.id === state.id)?.arcIntensity).toBe("executeNow");
    const incomplete = reduce(restored, { type: "DELETE_COMPONENT", componentId: plan.id });
    const converted = reduce(incomplete, { type: "CONVERT_ARC_STATE_TO_LORE", componentId: state.id });
    expect(converted.storyCards.at(-1)).toMatchObject({ type: "lore", content: "The gate fell." });
    expect(converted.components.some(c => c.id === state.id)).toBe(false);
    expect(reduce(converted, { type: "CONVERT_ARC_STATE_TO_LORE", componentId: state.id })).toBe(converted);
  });
});
