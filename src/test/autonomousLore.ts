import { makeStoryCard } from "../state/defaults";
import { parseSinglePassMemoryResponse, prepareSinglePassMemoryBatch } from "../memory/singlePassMemory";
import { toSinglePassProposal } from "../memory/singlePassMemoryValidation";
import { looseMemoryFixture } from "./looseMemory";

export const autonomousEvent = "(storyCard.lore.autonomous: Annex shutter repairs = The wardens replaced the eastern Annex shutters before dawn. || A1 || Annex wardens)";

export async function autonomousLoreFixture() {
  const { a, ids } = looseMemoryFixture();
  a.storyCards[5].autonomousDevelopment = true;
  const sourceId = ids.at(-1)!;
  const batch = await prepareSinglePassMemoryBatch(a, ids, { allowAutonomousDevelopment: true });
  const checkpoint = batch.checkpoints.at(-1)!.checkpoint;
  const result = parseSinglePassMemoryResponse("S1\nNONE\nS2\nNONE\nS3\n" + autonomousEvent, ids, a, batch.outputAliases, batch).sources.at(-1)!;
  const finding = result.findings[0];
  const proposal = toSinglePassProposal(a, sourceId, checkpoint, finding);
  return { a, ids, sourceId, batch, checkpoint, result, finding, proposal };
}

export async function autonomousPersistenceFixture() {
  const fixture = await autonomousLoreFixture();
  const { a, ids, checkpoint, proposal } = fixture;
  a.memoryAutoApprove.autonomousLoreStoryCard = true;
  a.messages.find(message => message.id === ids.at(-1))!.memoryEvaluation!.singlePass = { ...checkpoint, status: "complete" };
  a.storyCards.push(makeStoryCard({ id: "recorded-development", type: "lore", title: proposal.title, content: proposal.content, lore: proposal.lore }));
  a.activeState.memoryProposals = [proposal];
  return fixture;
}
