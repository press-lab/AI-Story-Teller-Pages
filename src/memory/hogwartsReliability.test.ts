import { expect, it } from "vitest";
import sequences from "./fixtures/hogwarts-reliability.json";
import { createDefaultAdventure, makeBrain, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { legacyMemoryContext as buildContext } from "../test/legacyMemory";
import { onePassMemoryActions } from "./onePassMemory";
import type { Message } from "../types/adventure";

function fixture(index: number) {
  const a = createDefaultAdventure("Hogwarts reliability");
  a.memoryDetectionSettings.enabled = true;
  a.memoryAutoApprove.storyCard = false;
  a.memoryAutoApprove.brainUpdate = false;
  a.messages = sequences[index].messages as Message[];
  a.brains = [makeBrain({ characterName: "Draconia", active: true })];
  a.storyCards = [makeStoryCard({ title: "Draconia Malfoy", type: "character", keys: ["Draconia"], content: "Draconia is a student and researcher." })];
  return a;
}

it("retains a grounded confirmed meeting as reviewable historical Lore", () => {
  const a = fixture(0), source = a.messages.at(-1)!;
  const evidence = source.content.slice(0, source.content.indexOf("She recovers")).trim();
  const actions = onePassMemoryActions(a, buildContext(a), [{ kind: "lore", target: "The eight o'clock library agreement",
    content: "Draconia agreed to meet Seth at eight in the library.", evidence, reason: "A confirmed agreement", memoryMode: "historical", eventStatus: "completed" }], source.content, source.id);
  const next = actions.reduce(adventureReducer, a);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ status: "pending", storyCardType: "lore", memoryMode: "historical", sourceTurnId: source.id }));
  expect(next.components).toEqual(a.components);
});

it("records gating research as a proposal, preserving the estimate and untested status", () => {
  const a = fixture(1), source = a.messages.at(-1)!;
  const evidence = "My estimate: thirty percent recovered, possibly more.";
  const actions = onePassMemoryActions(a, buildContext(a), [{ kind: "lore", target: "Stepped aperture gating research",
    content: "Draconia proposed stepped aperture gating and estimated thirty percent recovery. The design remains untested.", evidence,
    reason: "Ongoing research subject", memoryMode: "living", eventStatus: "ongoing" }], source.content, source.id);
  const next = actions.reduce(adventureReducer, a);
  expect(next.activeState.memoryProposals).toContainEqual(expect.objectContaining({ status: "pending", memoryMode: "living", content: expect.stringContaining("untested") }));
  expect(next.storyCards).toEqual(a.storyCards);
});

it("resolves Draconia's pronoun-only continuation against the original adjacent exchange", () => {
  const a = fixture(2), source = a.messages.at(-1)!;
  const actions = onePassMemoryActions(a, buildContext(a), [{ kind: "thought", target: "Draconia",
    content: "I need to find out whether his sigils can run passively.", evidence: "Can your sigils run passively? Always on?", reason: "Private research priority" }], source.content, source.id);
  expect(actions).toContainEqual(expect.objectContaining({ type: "ADD_MEMORY_PROPOSAL", proposal: expect.objectContaining({ proposedType: "brainUpdate", targetId: a.brains[0].id }) }));
});

it("does not propose the already recorded successful Fainting Fancy test again", () => {
  const a = fixture(3), source = a.messages.at(-1)!;
  const content = "Fred successfully tested the modified Fainting Fancy prototype: a clean faint with no sneeze or stutter.";
  a.storyCards.push(makeStoryCard({ title: "Successful Fainting Fancy test", type: "lore", content, memoryMode: "historical" }));
  const actions = onePassMemoryActions(a, buildContext(a), [{ kind: "lore", target: "Successful Fainting Fancy test", content,
    evidence: "Full production-quality faint. No sneeze, no stutter, nothing.", reason: "Successful prototype test" }], source.content, source.id);
  expect(actions.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
});
