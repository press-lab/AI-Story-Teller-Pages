import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeBrain, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { buildContext } from "../contextBuilder/contextBuilder";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import { selectEventMemories } from "./eventMemory";
import { readStoryTime } from "./storyTime";
import { mergeLoreMetadata, loreExcerpt } from "./storyCardArchitecture";
import type { Adventure, StoryCard, StoryClock } from "../types/adventure";

function dated(adventure: Adventure, id: string, text: string) {
  return reduce(adventure, { type: "ADD_MESSAGE", id, role: "assistant", content: text });
}

describe("primary Story Card architecture", () => {
  it.each([ ["plot", "lore"], ["event", "lore"], ["faction", "custom"], ["character", "character"], ["location", "location"], ["lore", "lore"], ["custom", "custom"]] as const)("migrates legacy %s to %s without losing content or controls", (type, expected) => {
    const original = { ...makeStoryCard({ id: "legacy", title: "Legacy subject", content: "Exact authored text.\nSecond line.", keys: ["alias", "specific recall"], pinned: true, protected: true, active: false, priority: 91, autoUpdate: true, memoryMode: "living" }), type };
    const adventure = { ...createDefaultAdventure(), storyCards: [original] };
    adventure.activeState.stateFlags.compactStoryCardsMigrated = true;
    const once = normalizeAdventure(adventure as Adventure);
    const twice = normalizeAdventure(once);
    expect(twice.storyCards).toEqual(once.storyCards);
    expect(twice.storyCards[0]).toMatchObject({ ...JSON.parse(JSON.stringify(original)), type: expected, memoryMode: type === "event" ? "historical" : "living" });
    expect(twice.messages).toEqual(adventure.messages);
    expect(twice.components).toEqual(once.components);
    expect(twice.modelConfig).toEqual(once.modelConfig);
  });

  it("round-trips historical evidence, chronology and revisions, with stable IDs on repeated import", () => {
    const card = makeStoryCard({ id: "door", title: "Doorstep introduction", type: "event", content: "They met privately.", keys: ["doorstep introduction"],
      eventMemory: { sourceMessageIds: ["source"], participants: ["Draconia", "Seth"], recallCues: ["doorstep introduction"], kind: "first" },
      lore: { occurredAt: { text: "around midwinter", precision: "approximate" }, status: "completed", sourceMessageIds: ["source"], knownTo: ["Seth", "Draconia"] },
    });
    const saved = { ...createDefaultAdventure(), storyCards: [card] };
    const first = importAdventureJson(exportAdventureJson(saved));
    const second = importAdventureJson(exportAdventureJson(first));
    expect(second.id).toBe(first.id);
    expect(second.storyCards).toEqual(first.storyCards);
    expect(second.storyCards[0]).toMatchObject({ id: "door", type: "lore", eventMemory: card.eventMemory, lore: card.lore });
    let repeated = reduce(second, { type: "UPSERT_STORY_CARD", storyCard: first.storyCards[0] });
    repeated = reduce(repeated, { type: "UPSERT_STORY_CARD", storyCard: first.storyCards[0] });
    expect(repeated.storyCards).toHaveLength(1);
    expect(repeated.storyClock).toBeUndefined();
  });

  it.each(["character", "location"] as const)("routes ordinary %s developments to Lore and leaves the biography unchanged", type => {
    const identity = makeStoryCard({ id: "identity", title: type === "character" ? "Draconia" : "Ministry", type, content: "Authored identity and appearance.", memoryMode: "living", pinned: true });
    let state = { ...createDefaultAdventure(), storyCards: [identity] };
    const content = type === "character" ? "Draconia married Seth." : "Seth and Draconia shared their first kiss at the Ministry.";
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "development", proposedType: "storyCard", title: identity.title, targetId: identity.id, content, appendContent: true, memoryMode: "living" }) });
    const pending = state.activeState.memoryProposals.find(p => p.id === "development")!;
    expect(pending).toMatchObject({ storyCardType: "lore", targetId: undefined });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: pending.id });
    expect(state.storyCards.find(c => c.id === identity.id)?.content).toBe(identity.content);
    expect(state.storyCards.find(c => c.type === "lore")?.content).toBe(content);
    expect(applyAIMemoryUpdate(state, [{ type: "storyCardUpdate", storyCardId: identity.id, content }]).actions).toEqual([]);
  });

  it("requires review for character death and records dated supporting Lore on approval", () => {
    let state = createDefaultAdventure();
    state.memoryAutoApprove.storyCard = true;
    state.storyCards = [makeStoryCard({ id: "voldemort", title: "Voldemort", type: "character", content: "Voldemort is a dark wizard.", pinned: true })];
    state = dated(state, "death", "Current story date: February 1, 2019\nVoldemort dies at Seth's hands.");
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "identity-death", title: "Voldemort", targetId: "voldemort", sourceTurnId: "death", content: "Voldemort dies at Seth's hands.", appendContent: true, proposedType: "storyCard" }) });
    expect(state.activeState.memoryProposals[0]).toMatchObject({ status: "pending", requiresReview: true, targetId: "voldemort" });
    expect(state.storyCards[0].content).not.toContain("dies");
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "identity-death" });
    expect(state.storyCards.find(c => c.id === "voldemort")?.content).toContain("dies");
    expect(state.storyCards.find(c => c.type === "lore")).toMatchObject({ memoryMode: "historical", lore: { status: "completed", occurredAt: { date: "2019-02-01" }, sourceMessageIds: ["death"] } });
    const reviewed = state.storyCards.length;
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "identity-death" });
    expect(state.storyCards).toHaveLength(reviewed);
  });

  it("keeps the first event and original date when an ongoing Lore subject develops", () => {
    let state = createDefaultAdventure();
    state.storyCards = [makeStoryCard({ id: "relationship", title: "Seth and Draconia's bond", type: "lore", memoryMode: "living", content: "January 12: Their first kiss.", keys: ["their first kiss"],
      lore: { status: "ongoing", occurredAt: { text: "January 12, 2019", date: "2019-01-12", precision: "day" }, sourceMessageIds: ["kiss"], knownTo: ["Seth", "Draconia"] } })];
    state = dated(state, "marriage", "Story date: February 1, 2019\nThey marry in private.");
    state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "marriage", proposedType: "storyCard", title: state.storyCards[0].title, targetId: "relationship", content: "February 1: They married privately.", sourceTurnId: "marriage", appendContent: false, memoryMode: "living" }) });
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: "marriage" });
    expect(state.storyCards).toHaveLength(1);
    expect(state.storyCards[0].content).toContain("first kiss");
    expect(state.storyCards[0].content).toContain("married");
    expect(state.storyCards[0].lore).toMatchObject({ status: "ongoing", occurredAt: { date: "2019-01-12" }, lastChangedAt: { date: "2019-02-01" }, sourceMessageIds: ["kiss", "marriage"], knownTo: ["Seth", "Draconia"] });
    expect(state.storyCards[0].memoryUpdateHistory?.[0].previous?.lore?.occurredAt?.date).toBe("2019-01-12");
  });

  it("recalls historical Lore by specific cues, not every mention of a participant", () => {
    const identity = makeStoryCard({ title: "Draconia", type: "character", keys: ["Draco"], content: "A witch." });
    const lore = makeStoryCard({ id: "kiss", title: "The first kiss at the Ministry", type: "lore", memoryMode: "historical", keys: ["Draconia", "first kiss"], content: "They kissed privately.", eventMemory: { sourceMessageIds: ["kiss-source"], participants: ["Draconia"], recallCues: ["first kiss"], kind: "first" }, lore: { status: "completed", occurredAt: { text: "January 12, 2019", date: "2019-01-12", precision: "day" }, sourceMessageIds: ["kiss-source"], knownTo: ["Seth", "Draconia"] } });
    expect(selectEventMemories([identity, lore], "Draconia enters.").size).toBe(0);
    expect(selectEventMemories([identity, lore], "Draco recalls our first kiss.").has("kiss")).toBe(true);
    const state = { ...createDefaultAdventure(), storyCards: [identity, lore], storyClock: { current: { text: "February 1, 2019", precision: "day" as const, date: "2019-02-01" } } };
    const result = buildContext(state, { currentInput: "Draco recalls our first kiss." });
    const text = result.messages.map(m => m.content).join("\n");
    expect(text).toContain("Current story time: February 1, 2019");
    expect(text).toContain("January 12, 2019");
    expect(text).toContain("Private knowledge: Seth, Draconia");
    expect(text).toContain("other characters do not automatically know");
    expect(text).toContain("not instructions to replay");
    expect(result.totalEstimatedTokens).toBeLessThanOrEqual(state.tokenBudgetSettings.maxContextTokens);
  });
});

describe("in-world clock", () => {
  it("supports explicit dates, day skips and dated flashbacks without moving the present backward", () => {
    let state = dated(createDefaultAdventure(), "present", "Current story date: February 1, 2019");
    state = dated(state, "skip", "Three days later, they return.");
    expect(state.storyClock?.current?.date).toBe("2019-02-04");
    state = dated(state, "past", "Flashback: January 12, 2019\nThey meet.");
    expect(state.storyClock?.current?.date).toBe("2019-02-04");
    expect(state.messages.at(-1)?.storyTime?.date).toBe("2019-01-12");
    expect((state.messages.at(-1) as { storyTurn?: number })?.storyTurn).toBeUndefined();
    expect(state.messages.at(-1)?.createdAt).not.toBe("2019-01-12");
    state = dated(state, "now", "They discuss the old promise.");
    expect(state.messages.at(-1)?.storyTime?.date).toBe("2019-02-04");
  });

  it.each([ ["Story date: around midwinter", "approximate"], ["Story date: three days before the coronation", "relative"], ["Date: unknown", "unknown"], ["Date: February 31, 2019", "unknown"] ] as const)("retains uncertainty in %s", (text, precision) => {
    const parsed = readStoryTime(text);
    expect(parsed.time?.precision).toBe(precision);
    expect(parsed.time?.date).toBeUndefined();
  });

  it("does not manufacture a date for an unanchored skip, incidental mention, or undated flashback", () => {
    expect(readStoryTime("Two days later, they meet.").time).toEqual({ text: "Two days later", precision: "relative" });
    expect(readStoryTime("They remember a letter dated January 12, 2019.").time).toBeUndefined();
    let state = dated(createDefaultAdventure(), "present", "Story date: 2019-02-01");
    state = dated(state, "past", "Flashback: they met at the Ministry.");
    expect(state.messages.at(-1)?.storyTime?.date).toBeUndefined();
    expect(state.storyClock?.current?.date).toBe("2019-02-01");
    state = reduce(state, { type: "ADD_MESSAGE", role: "user", inputMode: "comms", content: "Story date: 2050-01-01" });
    expect(state.storyClock?.current?.date).toBe("2019-02-01");
  });

  it("does not regress the latest change when an older source is recovered", () => {
    const previous = { status: "ongoing" as const, sourceMessageIds: ["now"], lastChangedAt: { text: "2019-02-01", date: "2019-02-01", precision: "day" as const } };
    expect(mergeLoreMetadata(previous, { status: "ongoing", sourceMessageIds: ["old"], lastChangedAt: { text: "2019-01-12", date: "2019-01-12", precision: "day" } })).toMatchObject({ lastChangedAt: previous.lastChangedAt, sourceMessageIds: ["now", "old"] });
  });
});

describe("Brain import instruction preservation", () => {
  it.each(["when Mira appears in the scene or is meaningfully referenced", "  My authored condition.  ", "", undefined])("preserves condition %s and authored prompts across normalization and JSON round-trip", condition => {
    const brain = makeBrain({ id: "brain", characterName: "Mira", updateCondition: condition, updatePrompt: "  Exact user instructions.  ", thoughts: { one: "I distrust the duke." }, archivedThoughts: { old: "I trusted him." } });
    if (condition === undefined) delete (brain as Partial<typeof brain>).updateCondition;
    const state = { ...createDefaultAdventure(), brains: [brain] };
    const normalized = normalizeAdventure(state);
    const roundTrip = importAdventureJson(exportAdventureJson(normalized));
    for (const next of [normalized, roundTrip]) {
      expect(next.brains[0].updateCondition).toBe(condition);
      expect(next.brains[0].updatePrompt).toBe(brain.updatePrompt);
      expect(next.brains[0].thoughts).toEqual(brain.thoughts);
      expect(next.brains[0].archivedThoughts).toEqual(brain.archivedThoughts);
    }
  });

  it("leaves missing prompts missing, keeps new-Brain defaults, and preserves append/archive behavior", () => {
    const brain = makeBrain({ id: "mira", characterName: "Mira", updateMode: "append", thoughts: { old: "I distrust the duke." } });
    expect(brain.updateCondition).toBeTruthy();
    delete (brain as Partial<typeof brain>).updatePrompt;
    let state = normalizeAdventure({ ...createDefaultAdventure(), brains: [brain] });
    expect(state.brains[0].updatePrompt).toBeUndefined();
    state = reduce(state, { type: "APPLY_BRAIN_UPDATE", brainId: "mira", patch: { thoughts: { next: "I trust the scout." } }, mode: "append", turn: 1 });
    expect(state.brains[0].thoughts).toEqual({ old: "I distrust the duke.", next: "I trust the scout." });
    state = reduce(state, { type: "APPLY_BRAIN_UPDATE", brainId: "mira", patch: { thoughts: { old: null } }, mode: "append", turn: 2 });
    expect(state.brains[0].archivedThoughts.old).toBe("I distrust the duke.");
    expect(state.brains[0].thoughts.next).toBe("I trust the scout.");
  });
});


it("keeps all Lore history while bounding the relevant context excerpt", () => {
  const content = Array.from({ length: 80 }, (_, index) => `Event ${index}: An important development concerning a different subject at the Ministry.`).join("\n") + "\nJanuary 12: Seth and Draconia shared their first kiss.";
  const card = makeStoryCard({ id: "long-lore", type: "lore", title: "Ministry history", content, tokenBudget: 180 });
  const excerpt = loreExcerpt(card, card.content, "Draconia recalls their first kiss");
  expect(excerpt.truncated).toBe(true);
  expect(excerpt.content).toContain("first kiss");
  expect(card.content).toBe(content);
  const state = { ...createDefaultAdventure(), storyCards: [{ ...card, pinned: true }] };
  const result = buildContext(state);
  expect(result.decisions.some(d => d.itemId === card.id && d.action === "truncated")).toBe(true);
});

it("reconciles the story clock when date evidence is edited and undone", () => {
  let state = dated(createDefaultAdventure(), "anchor", "Story date: 2019-02-01");
  state = dated(state, "skip", "Two days later, they return.");
  expect(state.storyClock?.current?.date).toBe("2019-02-03");
  state = reduce(state, { type: "UPDATE_MESSAGE", messageId: "anchor", content: "Story date: 2019-03-01" });
  expect(state.storyClock?.current?.date).toBe("2019-03-03");
  state = reduce(state, { type: "UNDO_STORY_EDIT" });
  expect(state.storyClock?.current?.date).toBe("2019-02-03");
});


it("does not bypass identity durability through a location alias", () => {
  let state = createDefaultAdventure();
  state.memoryAutoApprove.storyCard = true;
  const place = makeStoryCard({ id: "ministry", title: "Ministry of Magic", type: "location", keys: ["Ministry"], content: "A durable magical institution." });
  state.storyCards = [place];
  state = reduce(state, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ id: "alias", title: "Ministry", content: "Seth negotiated research access there.", proposedType: "storyCard", memoryMode: "static" }) });
  expect(state.storyCards.find(c => c.id === place.id)?.content).toBe(place.content);
  expect(state.activeState.memoryProposals[0]).toMatchObject({ targetId: undefined, storyCardType: "lore" });
});

it("preserves authored controls while migrating guarded legacy plot material", () => {
  const original = { ...makeStoryCard({ id: "pact", title: "Secret pact", content: "The two made a secret pact.", priority: 2, tokenBudget: 70, state: "user-defined", pinned: false }), type: "plot" as const };
  const state = normalizeAdventure({ ...createDefaultAdventure(), storyCards: [original] } as unknown as Adventure);
  expect(state.storyCards[0]).toMatchObject({ type: "lore", content: original.content, priority: 2, tokenBudget: 70, state: "user-defined", pinned: false });
});
