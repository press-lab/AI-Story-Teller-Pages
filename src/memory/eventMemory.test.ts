import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { applyAIMemoryUpdate } from "./applyAIMemoryUpdate";
import { detectStoryCardProposals } from "./memoryDetection";
import { scanEventMemories } from "./eventMemoryScan";
import { sameEventMemory, selectEventMemories } from "./eventMemory";
import type { MemoryProposal } from "../types/adventure";
vi.mock("../providers/openAICompatible", () => ({ isNativeDeepSeekProvider: () => false, sendOpenAICompatibleChatCompletion: vi.fn() }));
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { name: "test", baseUrl: "https://example.com", apiKey: "test", model: "test", temperature: 0, maxOutputTokens: 600 };
const eventMemory = { sourceMessageIds: ["door"], participants: ["Edythe"], recallCues: ["how we met", "unannounced visit", "first meeting", "showed up at my door"], kind: "first" as const };
const content = "Edythe introduced herself by arriving at the player's door unannounced.";
const candidate = { title: "Edythe's doorstep introduction", content, storyCardType: "event", memoryMode: "historical", evidenceMessageIds: ["door"], eventMemory };
function seed() {
  const a = createDefaultAdventure("Seattle");
  a.memoryDetectionSettings.enabled = true;
  a.memoryDetectionSettings.generateContent = true;
  a.memoryAutoApprove.storyCard = true;
  a.storyCards = [makeStoryCard({ title: "Edythe", type: "character", content: "Edythe is a vampire.", keys: ["Edythe"] })];
  a.messages = [{ id: "door", role: "assistant", content, createdAt: "2026-09-27T00:00:00Z" }];
  return a;
}
function proposal(overrides: Partial<MemoryProposal> = {}): MemoryProposal {
  return { id: "event-proposal", sourceTurnId: "1", sourceText: content, proposedType: "storyCard", title: candidate.title, content, suggestedTriggers: eventMemory.recallCues, confidence: 0.8, rationale: "How they met", status: "pending", memoryMode: "historical", storyCardType: "event", eventMemory, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z", ...overrides };
}
function eventCard() { return makeStoryCard({ id: "encounter", title: candidate.title, content, type: "event", eventMemory }); }
beforeEach(() => provider.mockReset());

describe("Event Memories", () => {
  it("discovers an event independently of an existing character, requires approval, and preserves evidence", async () => {
    const reviewState = seed();
    reviewState.memoryAutoApprove.storyCard = false;
    provider.mockResolvedValue({ content: JSON.stringify([candidate]), raw: {} });
    const result = await detectStoryCardProposals(reviewState, config);
    expect(result.errors).toEqual([]);
    let state = result.actions.reduce(adventureReducer, reviewState);
    expect(state.storyCards).toHaveLength(1);
    const p = state.activeState.memoryProposals[0];
    expect(p.eventMemory?.sourceMessageIds).toEqual(["door"]);
    expect(p.status).toBe("pending");
    expect(buildContext(state).messages.map(m => m.content).join("\n")).not.toContain("Historical reference;");
    state = adventureReducer(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    expect(state.storyCards).toHaveLength(2);
    const card = state.storyCards.find(c => c.type === "event")!;
    expect(card).toMatchObject({ content, memoryMode: "historical", autoUpdate: false, eventMemory });
    expect(normalizeAdventure(JSON.parse(JSON.stringify(state))).storyCards.find(c => c.type === "event")).toMatchObject({ eventMemory });
    const repeat = await detectStoryCardProposals(state, config);
    expect(repeat.actions).toEqual([]);
  });

  it("rejects invented source IDs, including partially valid evidence", async () => {
    provider.mockResolvedValue({ content: JSON.stringify([{ ...candidate, evidenceMessageIds: ["door", "invented"] }]), raw: {} });
    expect((await detectStoryCardProposals(seed(), config)).actions).toEqual([]);
  });

  it("deduplicates renamed retellings after rejection without merging different events from one scene", () => {
    let state = adventureReducer(seed(), { type: "ADD_MEMORY_PROPOSAL", proposal: proposal() });
    state = adventureReducer(state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: "event-proposal" });
    const repeated = adventureReducer(state, { type: "ADD_MEMORY_PROPOSAL", proposal: proposal({ id: "repeat", title: "Meeting at home" }) });
    expect(repeated).toBe(state);
    const different = proposal({ id: "different", title: "The revealed secret", content: "Edythe revealed that she could read other people's minds.", eventMemory: { ...eventMemory, kind: "revelation", recallCues: ["mind reading revelation"] } });
    expect(sameEventMemory(proposal(), different)).toBe(false);
    expect(adventureReducer(state, { type: "ADD_MEMORY_PROPOSAL", proposal: different }).activeState.memoryProposals).toHaveLength(2);
  });

  it("retrieves the encounter later with an inspectable reason, but not on name alone", () => {
    const a = seed();
    a.messages = [];
    a.storyCards.push(eventCard());
    const recall = buildContext(a, { currentInput: "Edythe, do you remember how we met?" });
    expect(recall.sections.find(s => s.id === "storyCards")?.items.some(i => i.id === "encounter")).toBe(true);
    expect(recall.decisions.some(d => d.itemId === "encounter" && d.detail.includes("event recall"))).toBe(true);
    expect(recall.messages.map(m => m.content).join("\n")).toContain("do not force a callback");
    const unrelated = buildContext(a, { currentInput: "Edythe, pass the salt." });
    expect(unrelated.sections.find(s => s.id === "storyCards")?.items.some(i => i.id === "encounter")).toBe(false);
  });

  it("uses participant aliases for generic recall and does not recall someone else's first meeting", () => {
    const card = eventCard();
    card.eventMemory = { ...eventMemory, participants: ["Edythe Cullen"] };
    const identity = makeStoryCard({ title: "Edythe Cullen", type: "character", content: "", keys: ["Edythe"] });
    expect(selectEventMemories([identity, card], "Edythe, how we met was unusual.").has(card.id)).toBe(true);
    expect(selectEventMemories([identity, card], "Priya, tell them how we met.").has(card.id)).toBe(false);
  });

  it("caps automatic recall and respects inactive/manual cards and explicit pins", () => {
    const a = seed(); a.messages = [];
    a.storyCards = Array.from({ length: 6 }, (_, i) => makeStoryCard({ ...eventCard(), id: "event-" + i }));
    expect(selectEventMemories(a.storyCards, "Edythe remembers our first meeting").size).toBe(3);
    a.storyCards[0].active = false;
    a.storyCards[1].inclusionPolicy = "manual";
    const selected = selectEventMemories(a.storyCards, "Edythe remembers our first meeting");
    expect(selected.has("event-0")).toBe(false);
    expect(selected.has("event-1")).toBe(false);
    a.storyCards[2].pinned = true;
    expect(buildContext(a, { currentInput: "Dinner" }).sections.find(s => s.id === "storyCards")?.items.some(i => i.id === "event-2")).toBe(true);
  });

  it("blocks autonomous rewriting while retaining explicit editing", () => {
    const a = seed(); a.storyCards.push(eventCard());
    expect(applyAIMemoryUpdate(a, [{ type: "storyCardUpdate", storyCardId: "encounter", content: "They are dating now." }]).actions).toEqual([]);
    expect(adventureReducer(a, { type: "APPLY_STORY_CARD_UPDATE", storyCardId: "encounter", content: "They are dating now." })).toBe(a);
    const edited = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: "encounter", patch: { content: "Corrected event.", autoUpdate: true, memoryMode: "living" } });
    expect(edited.storyCards.at(-1)).toMatchObject({ content: "Corrected event.", autoUpdate: false, memoryMode: "historical" });
  });

  it("leaves old historical cards in their existing category", () => {
    const a = seed(); a.storyCards.push(makeStoryCard({ title: "Old history", content: "A completed arc.", type: "plot", memoryMode: "historical" }));
    expect(normalizeAdventure(a).storyCards.at(-1)?.type).toBe("plot");
  });

  it("scans earlier Chronicle excerpts even with automatic discovery disabled and suppresses overlap duplicates", async () => {
    const a = seed(); a.memoryDetectionSettings.enabled = false;
    a.messages.push(...Array.from({ length: 30 }, (_, i) => ({ id: "later-" + i, role: "assistant" as const, content: "Later scene " + i, createdAt: "2026-09-27T00:00:00Z" })));
    provider.mockResolvedValueOnce({ content: JSON.stringify([candidate]), raw: {} }).mockResolvedValueOnce({ content: "[]", raw: {} });
    const progress = vi.fn(); const actions = vi.fn();
    expect(await scanEventMemories(a, config, actions, progress, new AbortController().signal)).toBe(1);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1][0].messages.at(-1)?.content).toContain("[later-19]");
    expect(progress.mock.calls.at(-1)?.[0]).toContain("1 Event Memory suggestions");
  });

  it("cancels between excerpts and preserves completed proposals on a later provider failure", async () => {
    const a = seed(); a.messages.push(...Array.from({ length: 30 }, (_, i) => ({ ...a.messages[0], id: "later-" + i })));
    const controller = new AbortController();
    provider.mockResolvedValue({ content: JSON.stringify([candidate]), raw: {} });
    const actions = vi.fn(() => controller.abort());
    expect(await scanEventMemories(a, config, actions, vi.fn(), controller.signal)).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
    provider.mockReset();
    provider.mockResolvedValueOnce({ content: JSON.stringify([candidate]), raw: {} }).mockRejectedValueOnce(new Error("Provider unavailable"));
    const persisted = vi.fn();
    await expect(scanEventMemories(a, config, persisted, vi.fn(), new AbortController().signal)).rejects.toThrow("Provider unavailable");
    expect(persisted).toHaveBeenCalledTimes(1);
  });
});
