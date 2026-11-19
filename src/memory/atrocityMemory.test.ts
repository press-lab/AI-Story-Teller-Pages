import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const fixturePath = process.env.ATROCITY_MEMORY_FIXTURE;
import type { Adventure } from "../types/adventure";
import { normalizeAdventure, defaultModelConfig } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { prepareSinglePassMemoryBatch, runSinglePassMemoryBatch } from "./singlePassMemory";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import { writeAdventure, readAdventure } from "../db/adventureDbCore";
vi.mock("../providers/memoryCompletion", async original => ({
  ...await original<typeof import("../providers/memoryCompletion")>(),
  sendMemoryCompletion: vi.fn()
}));
it.skipIf(!fixturePath)("recovers the failed Atrocity source and persists exactly one proposal", async () => {
  let a = normalizeAdventure(JSON.parse(readFileSync(fixturePath!, "utf8")) as Adventure);
  const id = "message_mwn3d470_zh5f6r32";
  const batch = await prepareSinglePassMemoryBatch(a, [id]);
  expect(Object.values(batch.outputAliases.S1.brains).some(b => b.id === "brain-atrocity-tori")).toBe(true);
  a = reduce(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints, manual: true });
  vi.mocked(sendMemoryCompletion).mockImplementation(async (_a, _config, messages) => {
    expect(JSON.parse(messages.at(-1)!.content).references).toContainEqual(expect.objectContaining({ id, content: a.messages.find(m => m.id === id)!.content }));
    return { raw: {}, content: "S1\n(brain.thoughts: Tori Rivas = Five is the limit for game night. With Chloe distracted by the others, I can keep those projects covered and keep everyone away from my workbench.)" };
  });
  const result = await runSinglePassMemoryBatch(a, defaultModelConfig, batch);
  expect(result.sources[0].rejected).toEqual([]);
  expect(result.sources[0].findings).toHaveLength(1);
  const commit = { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH" as const, batchId: batch.batchId,
    sources: [{ result: result.sources[0], checkpoint: batch.checkpoints[0].checkpoint }] };
  a = reduce(a, commit);
  expect(a.messages.find(m => m.id === id)!.memoryEvaluation!.status).toBe("complete");
  expect(a.activeState.memoryProposals.filter(p => p.sourceTurnId === id)).toHaveLength(1);
  expect(reduce(a, commit)).toBe(a);
  await writeAdventure(a);
  const restored = await readAdventure(a.id);
  expect(restored!.activeState.memoryProposals.filter(p => p.sourceTurnId === id)).toHaveLength(1);
});
