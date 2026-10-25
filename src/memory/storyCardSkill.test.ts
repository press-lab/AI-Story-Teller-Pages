import { describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer as reduce } from "../state/adventureReducer";
import { runLegacyCandidateFixture as runTurnPipeline } from "../test/legacyMemory";
import { buildContext } from "../contextBuilder/contextBuilder";
import { makeStoryCardSuggestion, scanStoryCardExchange, storyCardScanFingerprint, STORY_CARD_MEMORY_CHECK, STORY_CARD_OUTPUT_SCHEMA } from "./storyCardSuggestions";

function seed(autoApprove = false) {
  const state = createDefaultAdventure();
  state.memoryAutoApprove.storyCard = autoApprove;
  state.storyCards = ["Seth", "Draconia", "Voldemort"].map(title => makeStoryCard({ id: title.toLowerCase(), title, type: "character", keys: [title], content: `${title} is established.` }));
  return state;
}
async function play(text: string, updates: unknown[] = [], state = seed()) {
  const provider = vi.fn(async () => ({ content: text + "<memory_updates>" + JSON.stringify({ updates }) + "</memory_updates>" }));
  const result = await runTurnPipeline({ adventure: state, text: "I listen.", assistantMessageId: "source", sendChatCompletion: provider });
  expect(provider).toHaveBeenCalledTimes(1);
  return result.adventure;
}
const proposals = (state: ReturnType<typeof seed>) => state.activeState.memoryProposals.filter(p => p.proposedType === "storyCard");
const finding = (text: string, title = "A meaningful commitment") => ({ kind: "lore", target: title, content: text, evidence: text, reason: "A lasting development", triggers: [title] });

describe("Story Card skill policy", () => {
  it.each([
    ["Draconia kisses Seth.", undefined],
    ["Draconia kissed Seth.", undefined],
    ["Draconia almost kissed Seth.", undefined],
    ["They share their first kiss.", "kiss"],
    ["Draconia kisses Seth for the first time.", "kiss"],
    ["Will you marry me?", "proposal"],
    ["I wonder if Seth will propose.", undefined],
    ["Seth imagined proposing.", undefined],
    ["Seth proposes overthrowing the government.", undefined],
    ["They discuss their upcoming wedding.", undefined],
    ["They got married that afternoon.", "marriage"],
    ["They are married.", undefined],
    ["I promise I'll be back.", undefined],
    ["Seth promised to help Draconia.", undefined],
    ["Voldemort died.", "death"],
    ["Seth killed Voldemort.", "death"],
    ["Seth intends to kill Voldemort.", undefined],
    ["Voldemort was not killed.", undefined],
    ["Voldemort threatened to kill Seth.", undefined],
    ["I will propose marriage tomorrow.", undefined],
    ["They almost shared their first kiss.", undefined],
    ["Seth discovered a spoon and revealed its color.", undefined],
    ["Seth proposes marriage to Draconia; she might accept tomorrow.", "proposal"],
  ].map(([content]) => content))("delegates narrative development to the model: %s", content => {
    const state = seed();
    const nominations = scanStoryCardExchange(state, { id: "source", role: "assistant", content: content!, createdAt: "2026-01-01" });
    const milestones = nominations.filter(p => p.storyCardType === "lore");
    expect(milestones).toEqual([]);
  });
  it("keeps an ordinary kiss available to independent LLM judgment and merged review", async () => {
    const text = "Draconia kissed Seth.";
    expect(scanStoryCardExchange(seed(), { id: "source", role: "assistant", content: text, createdAt: "2026-01-01" }).filter(p => p.storyCardType === "lore")).toEqual([]);
    const state = await play(text, [finding(text, "Their public reconciliation")]);
    expect(proposals(state)).toHaveLength(1);
    expect(proposals(state)[0]).toMatchObject({ status: "pending", storyCardReview: { origin: "model", candidateOnly: false } });
  });
  it("still routes an LLM-only kiss to a suitable relationship history", async () => {
    const initial = seed();
    initial.storyCards.push(makeStoryCard({ id: "history", title: "Seth and Draconia Relationship History", type: "lore", memoryMode: "living", content: "Seth and Draconia are close." }));
    const text = "Draconia kissed Seth.";
    const state = await play(text, [finding(text, "A public kiss")], initial);
    expect(proposals(state)).toHaveLength(1);
    expect(proposals(state)[0]).toMatchObject({ targetId: "history", status: "pending", storyCardReview: { origin: "model", eventKind: "kiss" } });
  });
  it.each([
    "Seth meets Draconia for the first time.",
    "Draconia kisses Seth for the first time.",
    "Draconia considers overthrowing Voldemort.",
    "Seth and Draconia establish a secret alliance.",
  ])("retains a model review suggestion for %s", async text => {
    const state = await play(text, [finding(text)]);
    expect(proposals(state)).toContainEqual(expect.objectContaining({ storyCardType: "lore", status: "pending", storyCardReview: expect.objectContaining({ origin: "model" }) }));
    expect(state.storyCards).toHaveLength(3);
  });
  it.each([
    "Voldemort threatened to kill Seth.",
    "Voldemort was not killed.",
    "Draconia almost kissed Seth.",
  ])("never establishes a completed fact or identity change from %s", async text => {
    const state = await play(text, [finding(text)], seed(true));
    expect(proposals(state).length).toBeGreaterThan(0);
    expect(proposals(state).every(p => p.status === "pending" && p.storyCardReview?.candidateOnly)).toBe(true);
    expect(proposals(state).some(p => p.storyCardType === "character")).toBe(false);
    expect(state.storyCards).toHaveLength(3);
  });
  it("retains an imagined proposal as an unconfirmed model interpretation", async () => {
    const text = "Seth imagined proposing to Draconia.";
    const state = await play(text, [finding(text)], seed(true));
    expect(proposals(state)[0]).toMatchObject({ status: "pending", requiresReview: true, storyCardReview: { candidateOnly: true } });
  });
  it("retains a short but exact meaningful reply as a review candidate", async () => {
    const text = 'Draconia answers Seth: "Yes."';
    const state = await play(text, [{ ...finding("Draconia accepted Seth's proposal.", "Engagement"), evidence: "Yes." }], seed(true));
    expect(proposals(state)).toContainEqual(expect.objectContaining({ title: "Engagement", sourceText: "Yes.", status: "pending", requiresReview: true }));
  });
  it("keeps model-only findings pending with the default approval preference", async () => {
    expect(createDefaultAdventure().memoryAutoApprove.storyCard).toBe(false);
    const text = 'Draconia says, "Fuck the Ministry. I am with you."';
    const state = await play(text, [finding(text)]);
    expect(proposals(state)[0].status).toBe("pending");
    expect(state.storyCards).toHaveLength(3);
  });
  it("honors explicit opt-in for model findings after binding the completed exchange", async () => {
    const text = "Seth and Draconia shared their first kiss.";
    const state = await play(text, [finding(text, "Their first kiss")], seed(true));
    expect(proposals(state)).toHaveLength(1);
    expect(proposals(state)[0]).toMatchObject({ status: "approved", storyCardReview: { origin: "model", candidateOnly: false } });
    expect(state.storyCards.filter(card => card.type === "lore")).toHaveLength(1);
    expect(state.messages.at(-1)?.storyCardScan?.fingerprint).toBeDefined();
  });
  it("does not apply unrelated older pending work when finalizing a new source", async () => {
    let state = seed();
    state.activeState.memoryProposals = [{ id: "older", proposedType: "storyCard", storyCardType: "custom", title: "An older draft", content: "A draft awaiting review.", sourceTurnId: "manual", sourceText: "Manual draft", rationale: "Manual draft", suggestedTriggers: [], confidence: 0.8, status: "pending", createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
    state.memoryAutoApprove.storyCard = true;
    state = await play("Seth and Draconia discuss the weather.", [], state);
    expect(proposals(state).find(p => p.id === "older")?.status).toBe("pending");
    expect(state.storyCards).toHaveLength(3);
  });
  it("retains ambiguity and protected targets for review despite opt-in", async () => {
    const state = seed(true);
    state.storyCards.push(makeStoryCard({ id: "protected", title: "Secret agreement", type: "lore", content: "Old facts.", protected: true }));
    const text = "Draconia agreed to protect Seth's research.";
    const next = await play(text, [{ ...finding(text, "Secret agreement"), targetId: "protected" }], state);
    expect(proposals(next).find(p => p.targetId === "protected")?.status).toBe("pending");
    expect(next.storyCards.find(card => card.id === "protected")?.content).toBe("Old facts.");
  });
  it("discovers organizations as Custom references without a Faction category", async () => {
    const state = await play("The Order of the Phoenix establishes a secret alliance.");
    expect(proposals(state)).toContainEqual(expect.objectContaining({ title: "Order of the Phoenix", storyCardType: "custom", requiresReview: true }));
    expect(proposals(state).every(p => ["character", "location", "lore", "custom"].includes(p.storyCardType!))).toBe(true);
  });
  it("persists processed sources and invalidates the marker when player evidence changes", async () => {
    let state = await play("Seth and Draconia shared their first kiss.");
    const source = state.messages.at(-1)!;
    expect(storyCardScanFingerprint(state, source)).toBe(source.storyCardScan?.fingerprint);
    state = normalizeAdventure(JSON.parse(JSON.stringify(state)));
    const count = proposals(state).length;
    state = reduce(state, { type: "SCAN_STORY_CARD_EXCHANGE", sourceMessageId: "source", manual: true });
    expect(proposals(state)).toHaveLength(count);
    state = reduce(state, { type: "UPDATE_MESSAGE", messageId: state.messages[0].id, content: "This is only a dream." });
    expect(storyCardScanFingerprint(state, source)).not.toBe(source.storyCardScan?.fingerprint);
  });
  it("uses aliases for exceptional identity changes without assigning the victim's death to others", async () => {
    const state = seed();
    state.storyCards[2].keys.push("Tom Riddle");
    const next = await play("Seth killed Tom Riddle.", [{ kind: "card", target: "Voldemort", targetId: "voldemort", content: "Voldemort died in battle against Seth.", evidence: "Seth killed Tom Riddle.", reason: "A permanent status change" }], state);
    expect(proposals(next).filter(p => p.storyCardType === "character").map(p => p.targetId)).toEqual(["voldemort"]);
  });
  it("keeps local discovery independent of the model's empty result and keeps the instruction compact", () => {
    const state = seed();
    const source = { id: "source", role: "assistant" as const, content: "Captain Livia introduces herself.", createdAt: "2026-01-01" };
    expect(scanStoryCardExchange(state, source).some(p => p.storyCardType === "character")).toBe(true);
    expect(STORY_CARD_MEMORY_CHECK.split(/\s+/).length).toBeLessThan(180);
    expect(STORY_CARD_OUTPUT_SCHEMA).toContain("CREATE");
  });
  it("preserves factual subjects and suppresses their repeated evaluation", async () => {
    const text = "Draconia can decipher the sealed research journal.";
    let state = await play(text, [{ ...finding(text, "Draconia's Research"), operation: "CREATE" }]);
    const proposal = proposals(state)[0];
    expect(proposal.content).toBe(text);
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(state.storyCards.at(-1)?.content).toBe(text);
  });
  it("does not silently drop a new development recommended against closed historical Lore", async () => {
    const state = seed();
    state.storyCards.push(makeStoryCard({ id: "closed", title: "Their first kiss", type: "lore", memoryMode: "historical", content: "They kissed privately." }));
    const text = "Draconia revealed the sealed promise made during their first kiss.";
    const next = await play(text, [{ ...finding(text, "Their first kiss"), targetId: "closed" }], state);
    expect(proposals(next).some(p => p.title.startsWith("Their first kiss:") && !p.targetId)).toBe(true);
    expect(next.storyCards.find(card => card.id === "closed")?.content).toBe("They kissed privately.");
  });
  it("keeps the entity nomination cooldown while leaving events to the model", async () => {
    let state = await play("Captain Livia enters and introduces herself.");
    const identity = proposals(state).find(p => p.title === "Captain Livia")!;
    expect(identity).toBeDefined();
    state = reduce(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: identity.id });
    state = reduce(state, { type: "ADD_MESSAGE", id: "next", role: "assistant", content: "Captain Livia reads the map. Seth and Draconia shared their first kiss." });
    const next = scanStoryCardExchange(state, state.messages.at(-1)!);
    expect(next.some(p => p.title === "Captain Livia")).toBe(false);
    expect(next.some(p => p.storyCardType === "lore")).toBe(false);
  });
});

describe("calendar progression", () => {
  it("dates an inline model finding correctly when the narrator echoes the player's skip", async () => {
    let state = seed();
    state = reduce(state, { type: "SET_STORY_CLOCK", clock: { current: { date: "2019-02-01", text: "2019-02-01", precision: "day" } } });
    const text = "Three days later, Seth and Draconia shared their first kiss.";
    const result = await runTurnPipeline({ adventure: state, text: "Three days later, I return.", assistantMessageId: "source", sendChatCompletion: async () => ({ content: text + "<memory_updates>" + JSON.stringify({ updates: [finding(text, "Their first kiss")] }) + "</memory_updates>" }) });
    expect(result.adventure.storyClock?.current?.date).toBe("2019-02-04");
    expect(proposals(result.adventure)[0].lore?.occurredAt?.date).toBe("2019-02-04");
  });
  it("does not date an older relative skip by advancing the present clock again", () => {
    const state = seed();
    const source = { id: "old", role: "assistant" as const, content: "Three days later, Draconia kissed Seth.", createdAt: "2026-01-01" };
    state.messages.push(source);
    const proposal = makeStoryCardSuggestion(state, source.id, source.content, { title: "Old kiss", content: source.content, evidence: source.content, reason: "Historical source" });
    expect(proposal.lore?.occurredAt?.date).toBeUndefined();
    expect(proposal.lore?.occurredAt?.precision).toBe("relative");
  });
  it.each([["The following morning, they return.", "2019-02-01"], ["One month later, they return.", "2019-02-28"], ["Two months later, they return.", "2019-03-31"]])("counts %s once", (text, expected) => {
    let state = seed();
    state = reduce(state, { type: "SET_STORY_CLOCK", clock: { current: { date: "2019-01-31", text: "2019-01-31", precision: "day" } } });
    for (const role of ["user", "assistant"] as const) state = reduce(state, { type: "ADD_MESSAGE", role, content: text });
    expect(state.storyClock?.current?.date).toBe(expected);
  });
  it("flags several-days progression and keeps the authoritative date until correction", () => {
    let state = seed();
    const before = state.storyClock?.current;
    state = reduce(state, { type: "ADD_MESSAGE", role: "assistant", content: "Several days later, they return." });
    expect(state.storyClock?.current).toEqual(before);
    expect(state.storyClock?.pendingReference).toContain("unresolved duration");
    expect(state.messages.at(-1)?.storyTime?.precision).toBe("relative");
    expect(buildContext(state).messages.map(m => m.content).join(" ")).toContain("Unresolved time passage");
  });
});

describe("deterministic entity discovery precision", () => {
  function identities(text: string, history: string[] = []) {
    const state = seed();
    state.storyCards = state.storyCards.filter(card => card.title !== "Voldemort");
    state.storyCards.push(...["Eliot", "Draco Malfoy"].map(title => makeStoryCard({ id: title, title, type: "character", content: "An established character.", keys: [title] })));
    state.messages = [...history, text].map((content, index) => ({ id: `entity-${index}`, role: "assistant" as const, content, createdAt: "2026-01-01" }));
    return scanStoryCardExchange(state, state.messages.at(-1)!).filter(p => p.storyCardType !== "lore" && !p.targetId);
  }
  const gameplay = [
    "Some would come back for this.",
    "Draconia's eyes flick to you, sharp.",
    "The Department would very much like to understand what happened here today.",
    '"And I feel fine," Eliot finishes.',
  ];
  it.each(gameplay)("produces zero identity nominations for the gameplay failure: %s", text => {
    expect(identities(text)).toEqual([]);
    expect(identities(text, Array(23).fill(text))).toEqual([]);
  });
  it.each([
    "Draconia’s eyes flick to you, sharp.", "Seth's coat is wet.", "Eliot’s eyes close.", "Malfoy's wand drops.",
    "Perhaps tomorrow.", "Meanwhile, Draconia waits.", "The Ministry issued a statement.",
    "The Professor entered.", "The Minister refused.", "The Castle stands nearby.",
    "The Minister of Magic introduces himself.", "Captain of the Guard enters.",
    "The sword called Dawn gleams.",
    "Some would return as Captain Livia introduces herself.",
    '"And I feel fine," Captain Livia says.',
  ])("does not promote possessives, grammar, or detached introduction cues: %s", text => {
    const found = identities(text, Array(24).fill(text));
    expect(found.filter(p => p.title !== "Captain Livia")).toEqual([]);
  });
  it.each([
    ["Captain Livia enters and introduces herself.", "Captain Livia", "character"],
    ["Professor Elara Voss introduces herself to Seth.", "Professor Elara Voss", "character"],
    ['"Stay here," Dobby says.', "Dobby", "character"],
    ["Kreacher introduces himself to Seth.", "Kreacher", "character"],
    ["A wizard called Voldemort joins Seth.", "Voldemort", "character"],
    ["Professor O’Neill introduces herself.", "Professor O’Neill", "character"],
    ["Captain Jean-Luc introduces himself.", "Captain Jean-Luc", "character"],
    ["‘Captain Livia’ introduces herself.", "Captain Livia", "character"],
    ["They arrive at Silverpeak Citadel, the new magical academy.", "Silverpeak Citadel", "location"],
    ["The Order of the Phoenix establishes a secret alliance.", "Order of the Phoenix", "custom"],
    ["The Department of Mysteries issued a statement.", "Department of Mysteries", "custom"],
  ])("recognizes a distinct entity without requiring repetition: %s", (text, title, type) => {
    expect(identities(text)).toContainEqual(expect.objectContaining({ title, storyCardType: type, storyCardReview: expect.objectContaining({ origin: "deterministic" }) }));
  });
  it("uses character evidence for a single-word name before frequency ranks it", () => {
    const text = "Fenchurch arrives, landing on Seth's shoulder.";
    expect(identities(text, Array(24).fill(text))).toEqual([]);
    expect(identities(text, ["Seth introduces Fenchurch, his tiny dragon companion."])).toContainEqual(expect.objectContaining({ title: "Fenchurch", storyCardType: "character" }));
  });
  it("recognizes recurring character-specific context rather than mere name repetition", () => {
    const text = "Dobby rubs his eyes.";
    expect(identities(text)).toEqual([]);
    expect(identities(text, ["Dobby folds his arms."])).toContainEqual(expect.objectContaining({ title: "Dobby", storyCardType: "character" }));
  });
  it.each(["Draconia", "Seth", "Eliot", "Malfoy"])("resolves %s possessives even with otherwise qualifying character evidence", name => {
    for (const apostrophe of ["'", "’"]) {
      expect(identities(`${name}${apostrophe}s eyes flick to you.`, [`${name} introduces himself.`])).toEqual([]);
    }
  });
  it("covers possessive aliases and punctuation without losing apostrophes or hyphens in names", () => {
    const state = seed();
    state.storyCards.push(...[
      { title: "Narcissa Malfoy", keys: ["Cissy"] }, { title: "O'Neill" }, { title: "Jean-Luc" },
    ].map(card => makeStoryCard({ ...card, type: "character", content: "An established character." })));
    for (const content of ["Cissy’s eyes narrow.", "O’Neill's eyes narrow.", "Jean-Luc's eyes narrow.", '"Wait," Cissy says.', "Professor O’Neill introduces herself.", "Captain Jean-Luc introduces himself.", "‘Professor O’Neill’ introduces herself."]) {
      const source = { id: "aliases", role: "assistant" as const, content, createdAt: "2026-01-01" };
      state.messages = [source];
      expect(scanStoryCardExchange(state, source).filter(p => p.storyCardType !== "lore" && !p.targetId)).toEqual([]);
    }
  });
  it("allows a meaningful LLM-only entity into the Inbox when local evidence is insufficient", async () => {
    const text = "Fenchurch lands on Seth's shoulder.";
    expect(identities(text)).toEqual([]);
    const state = await play(text, [{ kind: "newCard", cardType: "character", operation: "CREATE", target: "Fenchurch", content: "Fenchurch is Seth's dragon companion.", evidence: text, reason: "Established scene context identifies a significant companion.", triggers: ["Fenchurch"] }]);
    expect(proposals(state)).toContainEqual(expect.objectContaining({ title: "Fenchurch", storyCardType: "character", status: "pending", storyCardReview: expect.objectContaining({ origin: "model" }) }));
  });
  it("keeps one reviewed identity when both detectors identify the same person", async () => {
    const text = "Captain Livia introduces herself.";
    expect(identities(text)).toContainEqual(expect.objectContaining({ title: "Captain Livia", storyCardReview: expect.objectContaining({ origin: "deterministic" }) }));
    let state = await play(text, [{ kind: "newCard", cardType: "character", target: "Captain Livia", content: "Captain Livia commands the northern guard.", evidence: text, reason: "A significant new person", triggers: ["Livia"] }]);
    const nominated = proposals(state).filter(p => p.storyCardType === "character");
    expect(nominated).toHaveLength(1);
    // The existing identity cooldown suppresses local duplication once the model proposal is pending.
    expect(nominated[0]).toMatchObject({ status: "pending", storyCardReview: { origin: "model" } });
    expect(state.storyCards.some(card => card.title === "Captain Livia")).toBe(false);
    state = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: nominated[0].id });
    expect(state.storyCards.some(card => card.title === "Captain Livia")).toBe(true);
  });
  it("retains the introduction proof when qualification depends on earlier context", () => {
    const state = seed();
    state.messages = [
      { id: "intro", role: "assistant", content: "Seth introduces Fenchurch, his tiny dragon companion.", createdAt: "2026-01-01" },
      { id: "current", role: "assistant", content: "Fenchurch arrives, landing on Seth's shoulder.", createdAt: "2026-01-01" },
    ];
    const proposal = scanStoryCardExchange(state, state.messages[1]).find(p => p.title === "Fenchurch")!;
    expect(proposal.storyCardReview?.additionalSources).toEqual([{ id: "intro", content: state.messages[0].content }]);
    state.activeState.memoryProposals = [proposal];
    state.messages[0].content = "No companion was introduced.";
    expect(reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id, automatic: true }).storyCards).toEqual(state.storyCards);
    const approved = reduce(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.storyCards.at(-1)?.title).toBe("Fenchurch");
    expect(approved.activeState.memoryProposals[0].storyCardReview?.additionalSources).toEqual(proposal.storyCardReview?.additionalSources);
  });
});
