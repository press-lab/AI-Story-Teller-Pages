import { describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeBrain, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runLegacyCandidateFixture as runTurnPipeline } from "../test/legacyMemory";
import { characterParticipants } from "./storyCardEntities";
import { makeStoryCardSuggestion, scanStoryCardExchange, suggestionSourceValid } from "./storyCardSuggestions";

function fixture() {
  const state = createDefaultAdventure();
  state.memoryDetectionSettings.enabled = true;
  state.memoryAutoApprove.loreStoryCard = false; state.memoryAutoApprove.otherStoryCard = false;
  state.storyCards = [
    ["Seth", "Seth"], ["Draconia", "Draconia"], ["Hermione Granger", "Hermione"],
    ["Lucius Malfoy", "Lucius"], ["Severus Snape", "Snape"], ["Aberforth Dumbledore", "Aberforth"],
    ["Albus Dumbledore", "Albus"], ["Voldemort", "Dark Lord"],
  ].map(([title, alias]) => makeStoryCard({ id: title, title, keys: [alias], type: "character", content: `${title} is an established character.` }));
  return state;
}
const inbox = (state: ReturnType<typeof fixture>) => state.activeState.memoryProposals.filter(p => p.proposedType === "storyCard");
const finding = (content: string, evidence = content, extra = {}) => ({ kind: "lore", target: "Political developments", content, evidence, reason: "A consequential development", ...extra });
async function narrate(text: string, updates: unknown[], state = fixture()) {
  const provider = vi.fn(async () => ({ content: `${text}\n<memory_updates>${JSON.stringify({ updates })}</memory_updates>` }));
  const result = await runTurnPipeline({ adventure: state, text: "I ask Draconia and Hermione about Britain.", assistantMessageId: "source", sendChatCompletion: provider });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(result.providerPayload.some(m => m.content.includes("[ONE-PASS MEMORY]"))).toBe(false);
  expect(result.responseContent).toBe(text);
  return result.adventure;
}

describe("Story Card detection responsibilities", () => {
  it.each([
    'Hermione says, "While Draconia was away, my friend died opposing the old regime."',
    'Hermione tells Seth and Draconia, "You killed Voldemort years ago."',
    'Draconia says, "Lucius and Lucius\'s relatives were killed years earlier."',
    'Aberforth says, "Well, Snape killed Albus Dumbledore in 1997."',
    'Snape tells Aberforth, "Albus Dumbledore died in 1997, on my hand, at his request."',
    'Seth and Draconia discuss Voldemort\'s already-recorded death. Voldemort was killed years ago.',
    "Seth and Draconia shared their first kiss, married, made an alliance, and betrayed the government.",
    "Lucius dies in battle. Blackrock Castle was destroyed permanently.",
  ])("never nominates a narrative event from local text: %s", content => {
    const state = fixture();
    const source = { id: "source", role: "assistant" as const, content, createdAt: "2026-10-23" };
    state.messages = [source];
    const local = scanStoryCardExchange(state, source);
    expect(local.filter(p => p.storyCardType === "lore" || p.targetId)).toEqual([]);
  });
  it("still discovers entities when the model returns no events", async () => {
    const state = await narrate("Captain Livia introduces herself to Seth.", []);
    expect(inbox(state)).toHaveLength(1);
    expect(inbox(state)[0]).toMatchObject({ title: "Captain Livia", storyCardType: "character", status: "pending", storyCardReview: { origin: "deterministic" } });
  });
  it("resolves participants through known titles, aliases, possessives and unambiguous identity references", () => {
    const state = fixture();
    expect(characterParticipants(state.storyCards, "While Draconia's eyes narrow, Well, Lucius and Lucius’s friends listen to Snape.")).toEqual(["Draconia", "Lucius Malfoy", "Severus Snape"]);
    expect(characterParticipants(state.storyCards, "Seth’s arm touches Draconia’s hand.")).toEqual(["Seth", "Draconia"]);
    expect(characterParticipants(state.storyCards, "Well, While, Perhaps and Some.")).toEqual([]);
    expect(characterParticipants(state.storyCards, "Dumbledore spoke.")).toEqual([]);
    expect(characterParticipants(state.storyCards, "Unrelated dialogue.", ["Snape", "Lucius's", "While", "Lucius Malfoy", "Dumbledore"])).toEqual(["Severus Snape", "Lucius Malfoy"]);
    const suggestion = makeStoryCardSuggestion(state, "source", "An exchange.", { title: "The model's subject", content: "A model-provided finding.", evidence: "An exchange.", reason: "Model assessment", participants: ["While", "Snape", "Snape’s"] });
    expect(suggestion.title).toBe("The model's subject");
    expect(suggestion.storyCardReview?.participants).toEqual(["Severus Snape"]);
  });
  it.each([
    "Seth meets Hermione in Paris for a consequential political discussion.",
    "Hermione establishes three conditions: abolish the registry, guarantee trials, and protect witnesses before she considers returning to Britain.",
    "Seth and Draconia invite Hermione to participate in the new government; she has not accepted.",
    "Draconia states that she ordered the discriminatory registry destroyed; its destruction is not yet confirmed.",
    "Seth and Hermione establish a secret political alliance.",
  ])("routes a grounded model-only Lore finding to review: %s", async text => {
    const state = await narrate(text, [finding(text)]);
    expect(inbox(state)).toHaveLength(1);
    expect(inbox(state)[0]).toMatchObject({ content: expect.stringContaining(text), status: "pending", storyCardReview: { origin: "model" } });
    expect(state.storyCards).toEqual(fixture().storyCards.map(card => expect.objectContaining({ title: card.title, content: card.content })));
    expect(suggestionSourceValid(state, inbox(state)[0])).toBe(true);
  });
  it.each([false, true])("routes a newly occurring Character status change to explicit review (auto-approval=%s)", async autoApprove => {
    const state = fixture();
    state.memoryAutoApprove.loreStoryCard = autoApprove; state.memoryAutoApprove.otherStoryCard = autoApprove;

    const text = "Lucius died defending the bridge during the battle.";
    const next = await narrate(text, [finding("Lucius Malfoy died defending the bridge.", text, { kind: "card", target: "Lucius Malfoy", targetId: "Lucius Malfoy" })], state);
    const identity = inbox(next).find(p => p.storyCardType === "character")!;
    expect(identity).toMatchObject({ targetId: "Lucius Malfoy", status: autoApprove ? "approved" : "pending", requiresReview: false, storyCardReview: { origin: "model" } });
    expect(inbox(next).filter(p => p.storyCardType === "lore")).toHaveLength(1);
    if (!autoApprove) expect(next.storyCards.filter(card => card.type === "character")).toEqual(state.storyCards);
    else expect(next.storyCards.find(c => c.id === "Lucius Malfoy")?.content).toContain("died defending the bridge");
    const approved = adventureReducer(next, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: identity.id });
    expect(approved.storyCards.find(c => c.id === "Lucius Malfoy")?.content).toContain("died defending the bridge");
  });
  it("keeps Brain updates independent of Story Card suggestions in the same envelope", async () => {
    const state = fixture();
    state.memoryAutoApprove.brainUpdate = true;
    state.brains = [makeBrain({ id: "brain", characterName: "Draconia", pinned: true, thoughts: { old: "I distrust the Ministry." } })];
    const text = "Draconia reads Hermione's conditions and agrees to protect the witnesses.";
    const next = await narrate(text, [finding(text), { kind: "thought", target: "Draconia", content: "I must earn Hermione's trust by protecting these witnesses.", evidence: text, reason: "Changed private commitment" }], state);
    expect(inbox(next)).toContainEqual(expect.objectContaining({ status: "pending", storyCardReview: expect.objectContaining({ origin: "model" }) }));
    expect(Object.values(next.brains[0].thoughts).join(" ")).toContain("I must earn Hermione's trust");
    expect(Object.values(next.brains[0].thoughts)).toContain("I distrust the Ministry.");
  });
  it("uses existing content checks to suppress an already-recorded status fact", async () => {
    const state = fixture();
    state.storyCards.find(c => c.title === "Voldemort")!.content = "Voldemort is dead. Seth killed the Dark Lord in public.";
    const text = '"Seth—” she lowers her voice, “—you killed the Dark Lord in public.';
    const next = await narrate(text, [finding("Voldemort is dead.", text, { kind: "card", target: "Voldemort" })], state);
    expect(inbox(next)).toEqual([]);
    expect(next.storyCards).toEqual(state.storyCards);
  });
  it("rejects the actual copied scene-dialogue fragment as Character content", async () => {
    const state = fixture();
    state.storyCards.find(c => c.title === "Voldemort")!.content = "Voldemort is dead. Seth killed the Dark Lord in public.";
    const text = 'Seth—” she lowers her voice, “—you killed the Dark Lord in public.';
    const next = await narrate(text, [finding(text, text, { kind: "card", target: "Voldemort" })], state);
    expect(inbox(next)).toEqual([]);
    expect(next.storyCards).toEqual(state.storyCards);
    expect(next.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("copies scene dialogue")))).toBe(true);
  });
  it.each(["", "<memory_updates>{broken}</memory_updates>"])("preserves missing/malformed envelope handling without a new normal-play call: %s", async tail => {
    const state = fixture();
    const story = "Seth and Draconia shared their first kiss.";
    const provider = vi.fn(async () => ({ content: story + tail }));
    const result = await runTurnPipeline({ adventure: state, text: "I listen.", sendChatCompletion: provider });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.responseContent).toBe(story);
    expect(inbox(result.adventure)).toEqual([]);
    expect(result.adventure.activeState.evaluationLog.some(log => log.errors.some(error => /envelope|JSON/.test(error)))).toBe(true);
  });
});

// These legacy assertions inspect detailed logging. OFF contracts are tested separately.
const debugLogging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: true }));
vi.mock("../config/debugLogging", () => debugLogging);
