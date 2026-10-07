import { expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { regenerateProposalContent } from "./memoryDetection";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";

vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));

it("does not regenerate an old pressure suggestion after its component is gone", async () => {
  const adventure = createDefaultAdventure("No pressure");
  const proposal = makeMemoryProposal({ proposedType: "plotPressureUpdate", targetId: "deleted" });
  await expect(regenerateProposalContent(proposal, adventure, adventure.modelConfig)).rejects.toThrow("component no longer exists");
  expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
});
