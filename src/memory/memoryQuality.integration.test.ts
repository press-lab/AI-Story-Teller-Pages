import type { MemoryProposal } from "../types/adventure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { validateMemoryUpdate, memoryUpdateShapeError } from "./validateMemoryUpdate";
import { resolveMemoryTarget } from "./resolveMemoryTarget";
import { detectStoryCardProposals } from "./memoryDetection";
vi.mock("../providers/openAICompatible", () => ({ isNativeDeepSeekProvider: () => false, sendOpenAICompatibleChatCompletion: vi.fn() }));
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { name: "test", baseUrl: "https://example.com", apiKey: "test", model: "test", temperature: 0, maxOutputTokens: 600 };
const accepted = JSON.stringify({ accepted: true, meaningfulChange: true, evidenceMessageIds: ["arrival"], reason: "Arrival supersedes travel." });
function makeMemoryProposal(fields: Partial<MemoryProposal>): MemoryProposal {
  return { id: "test-proposal", proposedType: "storyCard", title: "Test", content: "", status: "pending", sourceTurnId: "245", sourceText: "", suggestedTriggers: [], confidence: 0.8, rationale: "Test", createdAt: "2026-09-27T12:42:00Z", updatedAt: "2026-09-27T12:42:00Z", ...fields };
}
function seattle() {
  const a = createDefaultAdventure("Seattle regression");
  a.memoryDetectionSettings.enabled = false;
  a.activeState.turn = 245;
  a.components = [
    makeComponent({ id: "pe", title: "Plot Essentials", type: "plotEssentials", autoUpdate: true, content: "Seth is unaware of vampires. Edythe is driving him from Belltown." }),
    makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "Watchers are following Seth's car." }),
  ];
  a.messages = [
    { id: "correction", role: "user", content: "I know your explanation about vampires and immortality. I remain unconvinced. I corrected the thumbs-up text; my actual text was witty.", createdAt: "2026-09-27T12:40:00Z" },
    { id: "arrival", role: "user", content: "At the Cullen house, I get out of the car and follow Edythe. The family insists on questioning me before I leave.", createdAt: "2026-09-27T12:41:00Z" },
  ];
  return a;
}
beforeEach(() => { provider.mockReset(); });

describe("Seattle memory quality", () => {
  it("updates Plot Essentials and pressure independently with validated evidence", async () => {
    const a = seattle();
    const replacement = "Seth has heard Edythe's explanation of vampires but remains unconvinced. He has arrived at the Cullen house to meet her family.";
    provider.mockImplementation(async request => {
      const system = request.messages.filter(m => m.role === "system").map(m => m.content).join("\n");
      if (system.includes("MEMORY UPDATE VALIDATION")) return { content: accepted, raw: {}, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      if (system.includes("evaluation engine")) return { content: '["plotEssentialsPressure:pressure","plotEssentialsDrift:pe"]', raw: {} };
      if (system.includes("maintaining Plot Essentials")) return { content: replacement, raw: {} };
      if (system.includes("updating the Active Pressure")) return { content: "The Cullen family requires Seth to answer their questions before leaving.", raw: {} };
      throw new Error("Unexpected request");
    });
    const result = await runMemoryCycle(a, config);
    expect(result.logEntry.errors).toEqual([]);
    expect(result.actions.filter(a => a.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(2);
    expect(result.tokenUsage).toEqual({ promptTokens: 20, completionTokens: 10 });
    let state = result.actions.reduce(adventureReducer, a);
    const pe = state.activeState.memoryProposals.find(p => p.proposedType === "plotEssentialsUpdate")!;
    state = adventureReducer(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: pe.id });
    expect(state.components.find(c => c.id === "pe")?.content).toBe(replacement);
    expect(state.components.find(c => c.id === "pressure")?.content).toContain("requires Seth");
    expect(state.storyCards).toHaveLength(0);
    const reviews = provider.mock.calls.filter(([r]) => r.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION")));
    expect(reviews).toHaveLength(2);
    const prompt = reviews[0][0].messages.map(m => m.content).join("\n");
    expect(prompt).toContain("skepticism is not ignorance");
    expect(prompt).toContain("my actual text was witty");
    expect(prompt).toContain("I get out of the car");
  });

  it("blocks narrated pressure before auto-approval and leaves existing pressure intact", async () => {
    const a = seattle(); a.components = a.components.filter(c => c.type === "activePressure");
    provider.mockResolvedValueOnce({ content: '["plotEssentialsPressure:pressure"]', raw: {} })
      .mockResolvedValueOnce({ content: 'Rain beads on her coat. Edythe turns and says, "Seth. Out of the car."', raw: {} });
    const result = await runMemoryCycle(a, config);
    const state = result.actions.reduce(adventureReducer, a);
    expect(state.components[0].content).toBe(a.components[0].content);
    expect(result.actions.some(a => a.type === "MARK_COMPONENT_UPDATED")).toBe(false);
    expect(result.logEntry.errors.join(" ")).toContain("not dialogue or scene narration");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("blocks plausible-looking but unsupported replacements using the evidence verdict", async () => {
    const a = seattle(); a.components = a.components.filter(c => c.type === "plotEssentials");
    provider.mockResolvedValueOnce({ content: '["plotEssentialsDrift:pe"]', raw: {} })
      .mockResolvedValueOnce({ content: "Seth believes Edythe's explanation and remains in the car.", raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ accepted: false, meaningfulChange: true, reason: "Contradicts skepticism and completed exit from the car." }), raw: {} });
    const result = await runMemoryCycle(a, config);
    expect(result.actions.some(a => a.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
    expect(result.logEntry.errors.join(" ")).toContain("Contradicts skepticism");
  });

  it.each(["NONE", "Watchers are following Seth's car."])("skips unchanged pressure %s without another validation call", async content => {
    expect(await validateMemoryUpdate(seattle(), config, "activePressure", "Active Pressure", "Watchers are following Seth's car.", content)).toEqual({ changed: false });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(["invalid JSON", '{"accepted":true,"meaningfulChange":true,"evidenceMessageIds":["invented"]}'])("fails closed on invalid review %s", async content => {
    provider.mockResolvedValueOnce({ content, raw: {} });
    const result = await validateMemoryUpdate(seattle(), config, "plotEssentials", "Plot Essentials", "Old", "Seth arrived at the Cullen home.");
    expect(result.changed).toBe(false); expect(result.error).toContain("validation failed");
  });

  it("suppresses an Edythe paraphrase instead of rewriting or starting a cooldown", async () => {
    const a = seattle(); a.components = [];
    a.storyCards = [makeStoryCard({ id: "edythe", title: "Edythe", type: "character", memoryMode: "living", content: "Edythe is a guarded telepath.", autoUpdate: true, keys: [] })];
    provider.mockResolvedValueOnce({ content: '["storyCard:edythe"]', raw: {} })
      .mockResolvedValueOnce({ content: "Edythe is telepathic and emotionally guarded.", raw: {} })
      .mockResolvedValueOnce({ content: '{"accepted":true,"meaningfulChange":false,"reason":"Paraphrase"}', raw: {} });
    const result = await runMemoryCycle(a, config);
    expect(result.actions.some(a => a.type === "ADD_MEMORY_PROPOSAL" || a.type === "MARK_STORY_CARD_UPDATED")).toBe(false);
  });

  it("keeps Priya and Ren separate despite scene overlap and previously polluted character keys", async () => {
    const a = seattle();
    a.storyCards = [
      makeStoryCard({ id: "seth", title: "Seth", type: "character", keys: ["Priya", "blue sedan"], content: "Seth lives in Seattle and dates Priya." }),
      makeStoryCard({ id: "edythe", title: "Edythe", type: "character", memoryMode: "living", keys: ["Ren"], content: "Edythe watches Seth at Ren's bar in Seattle." }),
    ];
    for (const name of ["Priya", "Ren"]) {
      const routed = resolveMemoryTarget(a, { proposedType: "storyCard", title: name, content: `${name} knows Seth and Edythe in Seattle.`, sourceText: "Seth and Edythe talk about Priya and Ren in Seattle.", memoryMode: name === "Priya" ? "static" : "living" });
      expect(routed.targetId).toBeUndefined(); expect(routed.title).toBe(name);
      const proposal = makeMemoryProposal({ ...routed, storyCardType: "character" });
      let state = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal });
      state = adventureReducer(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
      expect(state.storyCards.find(c => c.title === name)?.type).toBe("character");
      expect(state.storyCards.find(c => c.id === "seth")?.content).toBe(a.storyCards[0].content);
    }
    a.memoryDetectionSettings.enabled = true;
    a.messages.push({ id: "priya", role: "assistant", content: "Priya is a Seattle product manager and has arranged another date with Seth.", createdAt: "2026-09-27T12:42:00Z" });
    provider.mockResolvedValueOnce({ content: JSON.stringify([{ title: "Priya", content: "Priya is a Seattle product manager.", memoryMode: "static", storyCardType: "character", evidenceMessageIds: ["priya"] }]), raw: {} });
    const discovery = await detectStoryCardProposals(a, config);
    expect(discovery.actions).toContainEqual(expect.objectContaining({ type: "ADD_MEMORY_PROPOSAL", proposal: expect.objectContaining({ title: "Priya", targetId: undefined }) }));
  });

  it("does not recycle corrected Plot Essentials into cards, even with auto-approval", () => {
    const a = seattle(); a.memoryAutoApprove.storyCard = true; a.memoryAutoApprove.plotEssentialsUpdate = true;
    const state = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: makeMemoryProposal({ proposedType: "plotEssentialsUpdate", title: "Plot Essentials", targetId: "pe", content: "Seth is informed but unconvinced and has arrived at the Cullen home." }) });
    expect(state.storyCards).toHaveLength(0);
    expect(state.activeState.memoryProposals.filter(p => p.proposedType === "storyCard")).toHaveLength(0);
    expect(JSON.stringify(state.components.find(c => c.id === "pe")?.memoryUpdateHistory)).toContain("unaware");
  });

  it("bounds component and card size", () => {
    expect(memoryUpdateShapeError("activePressure", "word ".repeat(46))).toContain("45-word");
    expect(memoryUpdateShapeError("plotEssentials", "word ".repeat(181))).toContain("180-word");
    expect(memoryUpdateShapeError("storyCard", "word ".repeat(501))).toContain("500-word");
  });
});
