import { describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { scanStoryCardExchange, makeStoryCardSuggestion, STORY_CARD_MEMORY_CHECK } from "./storyCardSuggestions";
import type { Adventure } from "../types/adventure";

function seed() {
  const state = createDefaultAdventure();
  state.storyClock = { origin: "established", current: { text: "2019-02-01", date: "2019-02-01", precision: "day" } };
  state.memoryAutoApprove = { ...state.memoryAutoApprove, storyCard: true, brainUpdate: true, currentArcUpdate: true, plotPressureUpdate: true, plotEssentialsUpdate: true };
  state.storyCards = ["Seth", "Draconia", "Voldemort"].map(title => makeStoryCard({ id: title.toLowerCase(), title, type: "character", keys: [title], content: `${title} is an established character.` }));
  return state;
}
async function play(story: string, updates: unknown[] = [], state = seed(), input = "I listen.") {
  const provider = vi.fn(async () => ({ content: story + '<memory_updates>' + JSON.stringify({ updates }) + '</memory_updates>' }));
  const result = await runTurnPipeline({ adventure: state, text: input, assistantMessageId: "final-source", sendChatCompletion: provider });
  expect(provider).toHaveBeenCalledTimes(1);
  return result.adventure;
}
const cards = (state: Adventure) => state.activeState.memoryProposals.filter(proposal => proposal.proposedType === "storyCard");
const lore = (state: Adventure) => cards(state).filter(proposal => proposal.storyCardType === "lore");
const finding = (content: string, evidence = content, extra = {}) => ({ kind: "lore", target: "Seth and Draconia: first kiss", content, evidence, reason: "Meaningful development", triggers: ["first kiss"], ...extra });

describe("merged Story Card suggestions", () => {
  it("merges first-kiss model and local detection into one pending dated Lore suggestion", async () => {
    const text = "Draconia grabs Seth's shirt and kisses him for the first time.";
    const state = await play(text, [finding("Seth and Draconia shared their first kiss.", text)]);
    expect(lore(state)).toHaveLength(1);
    expect(lore(state)[0]).toMatchObject({ status: "pending", requiresReview: true, storyCardReview: { origin: "both" }, lore: { occurredAt: { date: "2019-02-01" }, sourceMessageIds: expect.arrayContaining(["final-source"]) } });
    expect(state.storyCards).toHaveLength(3);
  });
  it("keeps an almost-kiss unconfirmed", async () => {
    const state = await play("Draconia almost kissed Seth for the first time.");
    expect(lore(state)).toHaveLength(1);
    expect(lore(state)[0]).toMatchObject({ status: "pending", storyCardReview: { candidateOnly: true } });
    expect(lore(state)[0].content).toMatch(/^Candidate interpretation/);
    expect(state.storyCards).toHaveLength(3);
  });
  it("proposes Lore for a marriage proposal without claiming a marriage occurred", async () => {
    const state = await play("Seth proposes marriage to Draconia.");
    expect(lore(state)).toHaveLength(1);
    expect(lore(state)[0].storyCardReview?.eventKind).toBe("proposal");
    expect(lore(state)[0].content).not.toContain("They married");
  });
  it("updates an appropriate ongoing relationship subject when a proposal is accepted", async () => {
    const initial = seed();
    initial.storyCards.push(makeStoryCard({ id: "relationship", title: "Seth and Draconia Relationship History", type: "lore", memoryMode: "living", content: "Seth and Draconia shared their first kiss.", lore: { status: "ongoing", sourceMessageIds: ["kiss"] } }));
    let state = await play("Draconia accepts Seth's proposal.", [], initial);
    expect(lore(state)).toHaveLength(1);
    expect(lore(state)[0]).toMatchObject({ targetId: "relationship", appendContent: true, status: "pending" });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: lore(state)[0].id });
    expect(state.storyCards.find(card => card.id === "relationship")?.content).toContain("first kiss");
    expect(state.storyCards.find(card => card.id === "relationship")?.content).toContain("accepts");
  });
  it("ignores an ordinary dinner", async () => {
    expect(cards(await play("Seth and Draconia enjoy an ordinary dinner. They talk about the weather."))).toEqual([]);
  });
  it("retains an implicit political commitment found only by the model", async () => {
    const text = 'Draconia says, "Fuck the Ministry. I am with you."';
    const state = await play(text, [finding("Draconia committed to helping Seth oppose the Ministry.", text, { target: "Opposition to the Ministry" })]);
    expect(lore(state)).toHaveLength(1);
    expect(lore(state)[0].storyCardReview?.origin).toBe("model");
  });
  it.each([ ["Captain Livia enters and introduces herself.", "character", "Captain Livia"], ["They arrive at Silverpeak Citadel, the new magical academy.", "location", "Silverpeak Citadel"] ] as const)("nominates a significant missing identity from %s", async (text, type, title) => {
    const state = await play(text);
    expect(cards(state)).toContainEqual(expect.objectContaining({ title, storyCardType: type, status: "pending", storyCardReview: expect.objectContaining({ candidateOnly: true }) }));
  });
  it("proposes dated Lore and an exceptional Character status change for a death, never the killer's death", async () => {
    const state = await play("Seth killed Voldemort.");
    expect(lore(state)).toHaveLength(1);
    expect(cards(state).filter(proposal => proposal.storyCardType === "character")).toHaveLength(1);
    expect(cards(state).find(proposal => proposal.storyCardType === "character")?.targetId).toBe("voldemort");
    expect(cards(state).every(proposal => proposal.status === "pending")).toBe(true);
  });
  it("does not treat a plan to kill as a death", async () => {
    const state = await play("Seth intends to kill Voldemort tomorrow.");
    expect(cards(state).some(proposal => proposal.storyCardType === "character")).toBe(false);
    expect(lore(state).every(proposal => proposal.storyCardReview?.candidateOnly)).toBe(true);
  });
  it("suppresses repeat facts and reevaluation duplicates, including rejected suggestions", async () => {
    let state = await play("Seth and Draconia shared their first kiss.");
    const proposal = lore(state)[0];
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: proposal.id });
    state = reduce(state, { type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: "final-source", manual: true });
    expect(lore(state)).toHaveLength(1);
    expect(lore(state)[0].status).toBe("rejected");
  });
  it("retains a deterministic event omitted by the model", async () => {
    expect(lore(await play("Seth and Draconia shared their first kiss."))).toHaveLength(1);
  });
  it("keeps distinct meaningful events separate even when they share participants", async () => {
    const state = await play("Seth and Draconia shared their first kiss. Draconia later betrayed Seth's confidence.");
    expect(lore(state)).toHaveLength(2);
    expect(new Set(lore(state).map(proposal => proposal.storyCardReview?.eventKind))).toEqual(new Set(["kiss", "betrayal"]));
  });
  it("retains different developments for the same continuing Lore target", async () => {
    const initial = seed();
    initial.storyCards.push(makeStoryCard({ id: "relationship", title: "Seth and Draconia Relationship", type: "lore", memoryMode: "living", content: "Seth and Draconia are close." }));
    const text = "Draconia accepts Seth's proposal. Draconia later betrayed Seth's confidence.";
    const state = await play(text, [finding("Draconia accepts Seth's proposal.", "Draconia accepts Seth's proposal.", { target: "Seth and Draconia Relationship", targetId: "relationship" }), finding("Draconia betrayed Seth's confidence.", "Draconia later betrayed Seth's confidence.", { target: "Seth and Draconia Relationship", targetId: "relationship" })], initial);
    expect(lore(state).filter(p => p.targetId === "relationship")).toHaveLength(2);
  });
  it("nominates a destroyed location and preserves its identity until review", async () => {
    const initial = seed();
    initial.storyCards.push(makeStoryCard({ id: "castle", title: "Blackrock Castle", type: "location", content: "An inhabited fortress.", keys: ["Blackrock Castle"] }));
    const state = await play("Blackrock Castle was destroyed permanently.", [], initial);
    expect(cards(state)).toContainEqual(expect.objectContaining({ storyCardType: "location", targetId: "castle", requiresReview: true }));
    expect(lore(state)).toHaveLength(1);
    expect(state.storyCards.at(-1)?.content).toBe("An inhabited fortress.");
  });
  it("does not rebind an old proof when an edited source merely starts with its original text", async () => {
    let state = await play("Seth and Draconia shared their first kiss.");
    const old = lore(state)[0];
    state = reduce(state, { type: "UPDATE_MESSAGE", messageId: "final-source", content: old.storyCardReview!.sourceContent + " This was only a dream." });
    state = reduce(state, { type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: "final-source", manual: true });
    const before = state.storyCards;
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: old.id });
    expect(state.storyCards).toEqual(before);
  });
  it("rejects an invented model target ID even when its title matches a real card", async () => {
    const initial = seed();
    initial.storyCards.push(makeStoryCard({ id: "real", title: "Relationship", type: "lore", content: "An existing subject." }));
    const text = "Draconia accepts Seth's proposal.";
    const state = await play(text, [finding(text, text, { target: "Relationship", targetId: "invented" })], initial);
    expect(state.activeState.evaluationLog.some(log => log.errors.some(error => error.includes("unknown target ID")))).toBe(true);
    expect(cards(state).some(p => p.title === "Relationship")).toBe(false);
  });
  it("does not merge a kiss into a government conflict merely because participants match", async () => {
    const initial = seed();
    initial.storyCards.push(makeStoryCard({ id: "conflict", title: "Seth and Draconia Government Conflict", type: "lore", memoryMode: "living", content: "Seth and Draconia oppose the government." }));
    expect(lore(await play("Seth and Draconia shared their first kiss.", [], initial))[0].targetId).toBeUndefined();
  });
  it("presents ambiguous continuing subjects instead of choosing arbitrarily", async () => {
    const initial = seed();
    for (const id of ["history", "bond"]) initial.storyCards.push(makeStoryCard({ id, title: `Seth and Draconia Relationship ${id}`, type: "lore", memoryMode: "living", content: "Seth and Draconia are close." }));
    const proposal = lore(await play("Draconia accepts Seth's proposal.", [], initial))[0];
    expect(proposal.targetId).toBeUndefined();
    expect(proposal.storyCardReview?.targetCandidates).toHaveLength(2);
  });
  it("rejects stale regenerated evidence but allows a fresh interpretation of revised text", async () => {
    let state = await play("Seth and Draconia shared their first kiss.");
    const stale = lore(state)[0];
    state = reduce(state, { type: "DELETE_MESSAGE", messageId: "final-source" });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: stale.id });
    expect(state.storyCards).toHaveLength(3);
    state = reduce(state, { type: "ADD_MESSAGE", id: "revised-source", role: "assistant", content: "Draconia almost kissed Seth for the first time." });
    state = reduce(state, { type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: "revised-source", manual: true });
    expect(lore(state).some(proposal => proposal.sourceTurnId === "revised-source")).toBe(true);
  });
  it("does not automatically route any component operation, while preserving manual edits", async () => {
    const initial = seed();
    initial.components = [makeComponent({ id: "pressure", title: "Pressure", type: "activePressure", content: "The duke demands tribute." })];
    const text = "The duke has ended the tribute demand.";
    let state = await play(text, [finding("The obligation ended.", text, { kind: "pressure", target: "Pressure" }), finding("The arc ended.", text, { kind: "arc", target: "Arc" })], initial);
    expect(state.components).toEqual(initial.components);
    expect(state.activeState.memoryProposals.every(proposal => proposal.proposedType === "storyCard" || proposal.proposedType === "brainUpdate")).toBe(true);
    state = reduce(state, { type: "UPDATE_COMPONENT", componentId: "pressure", patch: { content: "User-authored replacement." } });
    expect(state.components[0].content).toBe("User-authored replacement.");
    expect(STORY_CARD_MEMORY_CHECK).toContain("Never suggest Plot Essentials");
  });
  it("keeps the existing thought contract and auto-approval behavior", async () => {
    const initial = seed();
    initial.brains = [makeBrain({ id: "brain", characterName: "Draconia", updateMode: "append", thoughts: { old: "I distrust the Minister." } })];
    const text = "Draconia learns the Minister betrayed her.";
    const state = await play(text, [finding("I cannot trust the Minister.", text, { kind: "thought", target: "Draconia" })], initial, "Draconia reads the letter.");
    expect(Object.values(state.brains[0].thoughts)).toEqual(expect.arrayContaining(["I distrust the Minister.", expect.stringContaining("I cannot trust the Minister.")]));
    expect(cards(state).every(proposal => proposal.status === "pending")).toBe(true);
  });
});

describe("deterministic story clock", () => {
  it("initializes a stable assumed date and never dates old imported entries from it", () => {
    const raw = createDefaultAdventure();
    delete raw.storyClock;
    raw.messages = [{ id: "old", role: "assistant", content: "Seth and Draconia shared their first kiss.", createdAt: "2026-10-23" }];
    const once = normalizeAdventure(raw), twice = normalizeAdventure(once);
    expect(once.storyClock).toEqual(twice.storyClock);
    expect(once.storyClock).toMatchObject({ origin: "assumed", current: { date: "2000-01-01" } });
    expect(scanStoryCardExchange(once, once.messages[0])[0].lore?.occurredAt).toBeUndefined();
  });
  it.each([ ["The next morning, they return.", "2019-02-02"], ["Three days later, they return.", "2019-02-04"], ["Two weeks later, they return.", "2019-02-15"] ])("advances %s once across a player/narrator exchange", (text, expected) => {
    let state = seed();
    state = reduce(state, { type: "ADD_MESSAGE", role: "user", content: text });
    state = reduce(state, { type: "ADD_MESSAGE", role: "assistant", content: text });
    expect(state.storyClock?.current?.date).toBe(expected);
  });
  it("initializes an imported player/narrator skip only once and persists it on reload", () => {
    const raw = seed();
    delete raw.storyClock;
    raw.openingScene = "Story date: February 1, 2019";
    raw.messages = ["user", "assistant"].map((role, index) => ({ id: String(index), role: role as "user" | "assistant", content: "Three days later, they return.", createdAt: "2026-10-23" }));
    const once = normalizeAdventure(raw);
    expect(once.storyClock?.current?.date).toBe("2019-02-04");
    expect(normalizeAdventure(once).storyClock).toEqual(once.storyClock);
  });
  it("retains the present for a flashback, a plan for tomorrow, or no time transition", () => {
    let state = seed();
    for (const content of ["Flashback: January 12, 2019\nThey meet.", "They plan to leave tomorrow.", "They continue talking."]) state = reduce(state, { type: "ADD_MESSAGE", role: "assistant", content });
    expect(state.storyClock?.current?.date).toBe("2019-02-01");
  });
});
