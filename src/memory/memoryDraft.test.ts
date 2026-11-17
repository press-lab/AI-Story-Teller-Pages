import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeComponent, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { draftMessages, draftPreview, draftTargetFingerprint, generateMemoryDraft, generateMemoryDrafts, resolveDraftContext } from "./memoryDraft";
import { sendMemoryCompletion } from "../providers/memoryCompletion";
import type { Adventure, DraftComponentType, MemoryDraftRequest, MemoryProposal } from "../types/adventure";

vi.mock("../providers/memoryCompletion", () => ({ sendMemoryCompletion: vi.fn() }));
afterEach(() => vi.clearAllMocks());
function fixture() {
  const adventure = createDefaultAdventure();
  adventure.tokenBudgetSettings.maxContextTokens = 100_000;
  adventure.messages = Array.from({ length: 25 }, (_, i) => ({ id: `entry-${i}`, role: i % 2 ? "assistant" as const : "user" as const,
    content: `SOURCE ${i}`, createdAt: "2026-01-01T00:00:00.000Z" }));
  adventure.storyCards = [makeStoryCard({ id: "chosen", title: "Ward research", type: "lore", content: "x".repeat(1200) + "FULL CARD END" }),
    makeStoryCard({ id: "unselected", title: "UNSELECTED CARD", content: "PRIVATE UNSELECTED BODY", type: "custom" })];
  const request: MemoryDraftRequest = { action: "draft", destination: "component", componentType: "custom", storyCardType: "character",
    description: "Create an open-ended research subplot.", intent: "auto", inclusionPolicy: "always",
    context: { components: "all", componentIds: [], storyCardIds: ["chosen"], recentEntryCount: 20 } };
  return { adventure, request };
}
function response(content = "The guild has offered funding in exchange for access to the ward research.") {
  vi.mocked(sendMemoryCompletion).mockResolvedValue({ content: JSON.stringify({ title: "Guild research", content, keys: ["guild research"], rationale: "User requested subplot." }) } as never);
}
async function draft(adventure: Adventure, request: MemoryDraftRequest) {
  response();
  return (await generateMemoryDraft(adventure, defaultModelConfig, request))!;
}
function insert(adventure: Adventure, proposal: MemoryProposal) {
  return adventureReducer(adventure, { type: "ADD_MEMORY_PROPOSAL", proposal });
}

describe("explicit memory drafting context", () => {
  it("sends complete selected references and exactly the last 20 entries in source order", () => {
    const { adventure, request } = fixture();
    const context = resolveDraftContext(adventure, request);
    expect(context.entries.map(m => m.id)).toEqual(Array.from({ length: 20 }, (_, i) => `entry-${i + 5}`));
    expect(context.text).toContain("FULL CARD END");
    expect(context.text).not.toContain("PRIVATE UNSELECTED BODY");
    expect(context.text).toContain("entry-5] assistant:");
    expect(context.components).toHaveLength(adventure.components.length);
  });
  it("supports zero entries, explicit component selection and no implicit Brains", () => {
    const { adventure, request } = fixture();
    request.context = { components: "selected", componentIds: [adventure.components[0].id], storyCardIds: [], recentEntryCount: 0 };
    const context = resolveDraftContext(adventure, request);
    expect(context.components.map(c => c.id)).toEqual([adventure.components[0].id]);
    expect(context.entries).toEqual([]);
    expect(context.cards).toEqual([]);
  });
  it("includes the full update target even when no references are selected", () => {
    const { adventure, request } = fixture();
    request.destination = "storyCard"; request.storyCardType = "lore"; request.targetId = "chosen";
    request.context = { components: "none", componentIds: [], storyCardIds: [], recentEntryCount: 0 };
    expect(resolveDraftContext(adventure, request).text).toContain("FULL CARD END");
  });
  it("refuses missing references, invalid counts and missing or mismatched targets", () => {
    const { adventure, request } = fixture();
    expect(() => resolveDraftContext(adventure, { ...request, targetId: "gone" })).toThrow("missing");
    expect(() => resolveDraftContext(adventure, { ...request, context: { ...request.context, recentEntryCount: -1 } })).toThrow("whole number");
    expect(() => resolveDraftContext(adventure, { ...request, context: { ...request.context, storyCardIds: ["gone"] } })).toThrow("missing");
    expect(() => resolveDraftContext(adventure, { ...request, targetId: adventure.components[0].id })).toThrow("type changed");
  });
  it("rejects oversized input before making a provider call", async () => {
    const { adventure, request } = fixture();
    adventure.tokenBudgetSettings.maxContextTokens = 500;
    await expect(generateMemoryDraft(adventure, defaultModelConfig, request)).rejects.toThrow("Nothing was shortened or sent");
    expect(sendMemoryCompletion).not.toHaveBeenCalled();
  });
  it("uses the shared open-ended subplot policy and validates before sending", () => {
    const { adventure, request } = fixture();
    const prompt = draftMessages(adventure, request)[0].content;
    expect(prompt).toContain("perpetual buildup");
    expect(prompt).toContain("not mandatory mention every scene");
    expect(draftPreview(adventure, request).estimatedTokens).toBeGreaterThan(0);
    expect(() => draftMessages(adventure, { ...request, action: "suggest" })).toThrow("Use a written brief");
  });
  it("handles a no-change response and rejects malformed model output", async () => {
    const { adventure, request } = fixture(); request.action = "suggest"; request.destination = "storyCard";
    vi.mocked(sendMemoryCompletion).mockResolvedValue({ content: '{"noChange":true,"rationale":"Already recorded"}' } as never);
    expect(await generateMemoryDraft(adventure, defaultModelConfig, request)).toBeUndefined();
    vi.mocked(sendMemoryCompletion).mockResolvedValue({ content: '{"title":"empty"}' } as never);
    await expect(generateMemoryDraft(adventure, defaultModelConfig, request)).rejects.toThrow("missing a valid");
  });
  it("reviews only explicitly selected card targets in one request and rejects unselected outputs atomically", async () => {
    const { adventure, request } = fixture();
    request.action = "suggest"; request.destination = "storyCard"; request.storyCardType = "lore"; request.reviewSelectedCards = true;
    vi.mocked(sendMemoryCompletion).mockResolvedValue({ content: JSON.stringify({ proposals: [{ targetId: "chosen", title: "Ward research", content: "The guild funded a new laboratory.", keys: [] }] }) } as never);
    const proposals = await generateMemoryDrafts(adventure, defaultModelConfig, request);
    expect(sendMemoryCompletion).toHaveBeenCalledTimes(1);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ targetId: "chosen", appendContent: true, userInitiated: true });
    expect(proposals[0].manualDraft?.targetSnapshot).toBe(draftTargetFingerprint(adventure.storyCards[0]));
    vi.mocked(sendMemoryCompletion).mockResolvedValue({ content: JSON.stringify({ proposals: [{ targetId: "unselected", title: "Other", content: "Wrong target", keys: [] }] }) } as never);
    await expect(generateMemoryDrafts(adventure, defaultModelConfig, request)).rejects.toThrow("unselected update target");
  });
});

describe("manual authoring approval", () => {
  it.each<DraftComponentType>(["narrationRules", "aiInstructions", "plotEssentials", "currentArc", "authorNote", "custom"])("creates and approves %s without automatic permission", async componentType => {
    const { adventure, request } = fixture(); adventure.components = [];
    request.componentType = componentType;
    const proposal = await draft(adventure, request);
    const pending = insert(adventure, proposal);
    expect(pending.components).toEqual([]);
    expect(pending.activeState.memoryProposals[0].status).toBe("pending");
    const blocked = adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id, automatic: true });
    expect(blocked.components).toEqual([]);
    const approved = adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.components[0]).toMatchObject({ type: componentType, content: proposal.content, inclusionPolicy: "always", alwaysOn: true, autoUpdate: false });
    expect(approved.activeState.memoryProposals[0].status).toBe("approved");
  });
  it("preserves draft queue with suggestions hidden and auto-approval enabled", async () => {
    const { adventure, request } = fixture(); request.destination = "storyCard";
    adventure.memorySuggestionsEnabled = false;
    adventure.memoryAutoApprove.otherStoryCard = true;
    const proposal = await draft(adventure, request);
    const pending = insert(adventure, proposal);
    expect(pending.storyCards).toHaveLength(2);
    expect(pending.activeState.memoryProposals[0]).toMatchObject({ status: "pending", userInitiated: true });
  });
  it("appends to exactly the selected Story Card and leaves reference cards unchanged", async () => {
    const { adventure, request } = fixture(); request.destination = "storyCard"; request.storyCardType = "lore"; request.targetId = "chosen";
    const proposal = await draft(adventure, request);
    const approved = adventureReducer(insert(adventure, proposal), { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.storyCards.find(c => c.id === "chosen")?.content).toContain("FULL CARD END");
    expect(approved.storyCards.find(c => c.id === "chosen")?.content).toContain(proposal.content);
    expect(approved.storyCards.find(c => c.id === "unselected")).toEqual(adventure.storyCards[1]);
  });
  it("blocks changed and missing destinations instead of creating a replacement", async () => {
    const { adventure, request } = fixture();
    const component = makeComponent({ type: "custom", title: "Research", content: "Original" });
    adventure.components.push(component); request.targetId = component.id;
    const proposal = await draft(adventure, request);
    const pending = insert(adventure, proposal);
    pending.components = pending.components.map(c => c.id === component.id ? { ...c, content: "Edited while waiting" } : c);
    const result = adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(result.activeState.memoryProposals[0].status).toBe("pending");
    expect(result.activeState.memoryProposals[0].approvalFeedback).toContain("destination changed");
    result.components = result.components.filter(c => c.id !== component.id);
    expect(adventureReducer(result, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id }).components).toEqual(result.components);
  });
  it("preserves Current Arc phase, authored controls and source history on replacement", async () => {
    const { adventure, request } = fixture();
    const arc = makeComponent({ type: "currentArc", title: "Research", content: "Old arc text", arcPremise: "Study wards", protected: true,
      arcBreakInstruction: "The lab is lost", arcState: { phase: "break", tier: 2, threadEngagement: {}, pendingBreak: false } });
    adventure.components.push(arc); request.componentType = "currentArc"; request.targetId = arc.id;
    const proposal = await draft(adventure, request);
    const approved = adventureReducer(insert(adventure, proposal), { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.components.find(c => c.id === arc.id)).toMatchObject({ arcState: arc.arcState, arcPremise: arc.arcPremise, protected: true, arcBreakInstruction: arc.arcBreakInstruction });
    expect(approved.components.find(c => c.id === arc.id)?.lastMemoryUpdatedAt).toBeTruthy();
    expect(approved.components.find(c => c.id === arc.id)?.content).toBe(proposal.content);
  });
  it("survives JSON save normalization and guards destination selection", async () => {
    const { adventure, request } = fixture();
    adventure.components.push(makeComponent({ type: "plotEssentials", title: "Premise", content: "Original premise" }));
    request.componentType = "plotEssentials"; request.targetId = adventure.components.find(c => c.type === "plotEssentials")!.id;
    const proposal = await draft(adventure, request);
    const pending = normalizeAdventure(JSON.parse(JSON.stringify(insert(adventure, proposal))));
    const approved = adventureReducer(pending, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.activeState.memoryProposals[0].status).toBe("approved");
    expect(draftTargetFingerprint({ a: 1, b: 2 })).toBe(draftTargetFingerprint({ b: 2, a: 1 }));
    const retargeted = adventureReducer(pending, { type: "UPDATE_MEMORY_PROPOSAL", proposalId: proposal.id, patch: { targetId: undefined } });
    expect(retargeted.activeState.memoryProposals[0].targetId).toBe(proposal.targetId);
  });
});
