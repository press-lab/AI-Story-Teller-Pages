import { offlinePlacementReview } from "../test/memoryPlacement";
import type { MemoryProposal } from "../types/adventure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runMemoryCycle, runManualPEComponentUpdate } from "../triggers/semanticEngine";
import { validateMemoryUpdate, memoryUpdateShapeError } from "./validateMemoryUpdate";
import { resolveMemoryTarget } from "./resolveMemoryTarget";
import { detectStoryCardProposals } from "./memoryDetection";
vi.mock("../providers/openAICompatible", () => ({ isNativeDeepSeekProvider: () => false, sendOpenAICompatibleChatCompletion: vi.fn() }));
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { name: "test", baseUrl: "https://example.com", apiKey: "test", model: "test", temperature: 0, maxOutputTokens: 600 };
const accepted = JSON.stringify({ accepted: true, meaningfulChange: true, evidenceMessageIds: ["arrival"], reason: "Arrival supersedes travel.", pressureChange: "changed_obligation", identityMatchesTarget: true });
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
beforeEach(() => { provider.mockReset(); provider.mockImplementation(async r => offlinePlacementReview(r) ?? { content: "[]", raw: {} }); });

describe("Seattle memory quality", () => {
  it("does not miss early evidence when discovery runs every five turns", async () => {
    const a = seattle();
    a.memoryDetectionSettings = { enabled: true, generateContent: true, everyNTurns: 5 };
    a.messages = Array.from({ length: 10 }, (_, i) => ({
      id: `evidence-${i}`, role: i % 2 ? "assistant" as const : "user" as const,
      content: i === 1 ? "Mira is the new harbor master and will handle our permits." : "The conversation continues.", createdAt: "2026-09-27T12:40:00Z",
    }));
    provider.mockResolvedValueOnce({ content: JSON.stringify([{ title: "Mira", content: "Mira is the harbor master.", storyCardType: "character", evidenceMessageIds: ["evidence-1"] }]), raw: {} });
    const result = await detectStoryCardProposals(a, config);
    expect(result.actions).toContainEqual(expect.objectContaining({ type: "ADD_MEMORY_PROPOSAL", proposal: expect.objectContaining({ title: "Mira", sourceText: expect.stringContaining("harbor master") }) }));
    expect(provider.mock.calls[0][0].messages.at(-1)?.content).toContain("evidence-0");
  });

  it("suppresses renamed captured facts, including dismissed and same-response duplicates, but keeps new facts", async () => {
    const a = seattle(); a.memoryDetectionSettings.enabled = true;
    a.storyCards = [makeStoryCard({ title: "Harbor", content: "Mira controls harbor permits." })];
    a.activeState.memoryProposals = [makeMemoryProposal({ title: "Welcome", content: "Earnest offered Seth a chair.", status: "rejected" })];
    a.messages.push({ id: "new", role: "assistant", content: "Mira controls harbor permits. Earnest offered Seth a chair. The floodgate has permanently collapsed.", createdAt: "2026-09-27T12:42:00Z" });
    provider.mockResolvedValueOnce({ content: JSON.stringify([
      { title: "Permit authority", content: "• Mira controls harbor permits." },
      { title: "Hospitality", content: "Earnest offered Seth a chair." },
      { title: "Floodgate", content: "The floodgate has permanently collapsed." },
      { title: "Broken gate", content: "The floodgate has permanently collapsed." },
    ].map(p => ({ ...p, storyCardType: "plot", evidenceMessageIds: ["new"] }))), raw: {} });
    const result = await detectStoryCardProposals(a, config);
    expect(result.actions.filter(action => action.type === "ADD_MEMORY_PROPOSAL")).toHaveLength(1);
    expect(result.actions.find(action => action.type === "ADD_MEMORY_PROPOSAL")).toMatchObject({ type: "ADD_MEMORY_PROPOSAL", proposal: { title: "Floodgate" } });
    const prompt = provider.mock.calls[0][0].messages.map(m => m.content).join("\n");
    expect(prompt).toContain("Routine hospitality");
    expect(prompt).toContain("Earnest offered Seth a chair");
    expect(provider.mock.calls[0][0].messages[0].content).not.toContain("Permit authority");
  });

  it("routes locally checked manual Plot Essentials and pressure drafts through review", async () => {
    const a = seattle();
    const replacement = "Seth has heard Edythe's explanation of vampires but remains unconvinced. He has arrived at the Cullen house to meet her family.";
    provider.mockImplementation(async request => {
      const text = request.messages.map(m => m.content).join("\n");
      if (text.includes("MEMORY UPDATE VALIDATION")) return { content: accepted, raw: {} };
      if (text.includes("maintaining Plot Essentials")) return { content: replacement, raw: {} };
      if (text.includes("updating the Active Pressure")) return { content: "The Cullen family requires Seth to answer their questions before leaving.", raw: {} };
      throw new Error("Unexpected request");
    });
    const pe = await runManualPEComponentUpdate(a, config, "pe");
    const pressure = await runManualPEComponentUpdate(a, config, "pressure");
    expect(pe.logEntry.errors).toEqual([]);
    expect(pressure.logEntry.errors).toEqual([]);
    let state = [...pe.actions, ...pressure.actions].reduce(adventureReducer, a);
    for (const p of state.activeState.memoryProposals) if (p.status === "pending") state = adventureReducer(state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    expect(state.components.find(c => c.id === "pe")?.content).toBe(replacement);
    expect(state.components.find(c => c.id === "pressure")?.content).toContain("requires Seth");
    const reviews = provider.mock.calls.filter(([r]) => r.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION")));
    expect(reviews).toHaveLength(0);
    const generations = provider.mock.calls.filter(([r]) => r.messages.some(m => m.content.includes("maintaining Plot Essentials") || m.content.includes("updating the Active Pressure")));
    expect(generations).toHaveLength(2);
    expect(generations[0][0].messages.filter(m => m.role === "system")).toEqual(generations[1][0].messages.filter(m => m.role === "system"));
  });

  it("blocks narrated pressure in the manual tool and leaves existing pressure intact", async () => {
    const a = seattle(); a.components = a.components.filter(c => c.type === "activePressure");
    provider.mockResolvedValueOnce({ content: 'Rain beads on her coat. Edythe turns and says, "Seth. Out of the car."', raw: {} });
    const result = await runManualPEComponentUpdate(a, config, "pressure");
    const state = result.actions.reduce(adventureReducer, a);
    expect(state.components[0].content).toBe(a.components[0].content);
    expect(result.actions.some(a => a.type === "MARK_COMPONENT_UPDATED")).toBe(false);
    expect(result.logEntry.errors.join(" ")).toContain("not dialogue or scene narration");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("keeps plausible-looking replacements pending for author review without a paid verdict", async () => {
    const a = seattle(); a.components = a.components.filter(c => c.type === "plotEssentials");
    provider.mockResolvedValueOnce({ content: "Seth believes Edythe's explanation and remains in the car.", raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ accepted: false, meaningfulChange: true, evidenceMessageIds: [], reason: "Contradicts skepticism and completed exit from the car." }), raw: {} });
    const result = await runManualPEComponentUpdate(a, config, "pe");
    const state = result.actions.reduce(adventureReducer, a);
    expect(state.components.map(c => c.content)).toEqual(a.components.map(c => c.content));
    expect(state.activeState.memoryProposals).toContainEqual(expect.objectContaining({ status: "pending", requiresReview: true }));
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["NONE", "Watchers are following Seth's car."])("skips unchanged pressure %s without another validation call", async content => {
    expect(await validateMemoryUpdate(seattle(), config, "activePressure", "Active Pressure", "Watchers are following Seth's car.", content)).toEqual({ changed: false });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(["invalid JSON", '{"accepted":true,"meaningfulChange":true,"evidenceMessageIds":["invented"]}'])("fails closed on invalid review %s", async content => {
    provider.mockResolvedValueOnce({ content, raw: {} });
    const result = await validateMemoryUpdate(seattle(), config, "plotEssentials", "Plot Essentials", "Old", "Seth arrived at the Cullen home.");
    expect(result.changed).toBe(false); expect(result.error).toContain("memory_model_output_invalid");
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
      const proposal = makeMemoryProposal({ ...routed, storyCardType: "character", userInitiated: true });
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

  it("grounds validation in characters named only by a proposed replacement", async () => {
    const a = seattle();
    a.storyCards = [makeStoryCard({ title: "Mira", type: "character", content: "Mira cannot read minds." })];
    provider.mockResolvedValueOnce({ content: JSON.stringify({ accepted: false, meaningfulChange: true, evidenceMessageIds: [], identityMatchesTarget: false, reason: "Mira cannot read minds." }), raw: {} });
    const result = await validateMemoryUpdate(a, config, "storyCard", "Seth", "Seth arrived.", "Mira read Seth's thoughts.");
    expect(result.changed).toBe(false);
    expect(provider.mock.calls[0][0].messages.map(m => m.content).join("\n")).toContain("Mira cannot read minds");
  });
});


describe("Seattle pressure and identity regressions", () => {
  it.each(["same route", "shower", "typing indicator"])("requires author review for %s pressure churn without a paid judge", async detail => {
    const a = seattle();
    provider.mockResolvedValueOnce({ content: `Watchers remain while Seth continues the ${detail}.`, raw: {} })
      .mockResolvedValueOnce({ content: JSON.stringify({ accepted: true, meaningfulChange: true, reason: "Grounded pressure assessment", evidenceMessageIds: ["arrival"], pressureChange: "none" }), raw: {} });
    const result = await runManualPEComponentUpdate(a, config, "pressure");
    const state = result.actions.reduce(adventureReducer, a);
    expect(state.components.map(c => c.content)).toEqual(a.components.map(c => c.content));
    expect(state.activeState.memoryProposals).toContainEqual(expect.objectContaining({ status: "pending", requiresReview: true }));
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("cannot recycle an old threat as a latest-turn pressure change", async () => {
    provider.mockResolvedValueOnce({ content: JSON.stringify({ accepted: true, meaningfulChange: true, reason: "Grounded pressure assessment", evidenceMessageIds: ["correction"], pressureChange: "new_threat" }), raw: {} });
    const result = await validateMemoryUpdate(seattle(), config, "activePressure", "Pressure", "Old pressure", "A watcher threatens Seth.");
    expect(result.changed).toBe(false);
    expect(result.error).toContain("latest turn");
  });

  it("allows pressure resolution without inventing a replacement threat", async () => {
    const a = seattle(); a.messages.at(-1)!.content = "The watchers abandon the pursuit and release me without conditions.";
    provider.mockResolvedValueOnce({ content: JSON.stringify({ accepted: true, meaningfulChange: true, reason: "Grounded pressure assessment", evidenceMessageIds: ["arrival"], pressureChange: "resolved" }), raw: {} });
    expect(await validateMemoryUpdate(a, config, "activePressure", "Pressure", "Watchers pursue Seth.", "There is no immediate external pressure.")).toMatchObject({ changed: true });
  });
});

import { qualityFixture, spokenFred, privateGeorge, privateDraconia, thoughtFinding, loreFinding, repeatedLore } from "../test/memoryQuality";
import { prepareSinglePassMemoryBatch, parseSinglePassMemoryResponse } from "./singlePassMemory";
import { loreNovelty } from "./factCoverage";
import { toSinglePassProposal } from "./singlePassMemoryValidation";
import { compactHistoricalProposal } from "./memoryHistory";
it("commits the same mocked seven findings as two private reactions and one new Lore consequence", async () => {
  let { a, ids } = qualityFixture(3);
  const consequence = "Draconia negotiated a separate design safeguard.";
  a.messages[0].content += " " + consequence;
  const batch = await prepareSinglePassMemoryBatch(a, ids);
  const findings = [thoughtFinding("Fred", spokenFred), thoughtFinding("George", privateGeorge), thoughtFinding("Draconia", privateDraconia), ...repeatedLore.map(text => loreFinding(text)), loreFinding(consequence)];
  const result = parseSinglePassMemoryResponse(JSON.stringify({ sources: ids.map((sourceId, i) => ({ sourceId, findings: i ? [] : findings })) }), ids, a, batch.outputAliases, batch);
  const original = structuredClone(a);
  a = adventureReducer(a, { type: "CLAIM_SINGLE_PASS_MEMORY_BATCH", checkpoints: batch.checkpoints });
  a = adventureReducer(a, { type: "COMMIT_SINGLE_PASS_MEMORY_BATCH", batchId: batch.batchId, sources: result.sources.map(r => ({ result: r, checkpoint: batch.checkpoints.find(c => c.sourceId === r.sourceId)!.checkpoint })) });
  expect(a.activeState.memoryProposals.filter(p => p.proposedType === "brainUpdate")).toHaveLength(2);
  expect(a.activeState.memoryProposals.filter(p => p.proposedType === "storyCard")).toHaveLength(1);
  expect(a.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true);
  expect(a.messages[0].memoryEvaluation?.singlePass?.suppressedCount).toBe(4);
  expect(a.messages[0].memoryEvaluation?.singlePass?.dispositions.find(d => d.index === 0)?.reason).toContain("spoken dialogue");
  expect(a.brains).toEqual(original.brains); expect(a.storyCards).toEqual(original.storyCards);
  const proposal = a.activeState.memoryProposals.find(p => p.proposedType === "storyCard")!;
  expect(proposal.evaluationSource?.messages[0].id).toBe(ids[0]);
  expect(proposal.placementValidation?.sources[0].content).toBe(original.messages[0].content);
});
it.each([false, true])("covers pending and resolved Lore records including compact historical records=%s", async compressed => {
  const { a, ids } = qualityFixture(); const batch = await prepareSinglePassMemoryBatch(a, ids);
  a.storyCards.find(c => c.id === "relationship")!.content = "They know each other.";
  for (const status of ["pending", "approved", "rejected", "ignored"] as const) {
    const proposal = { ...toSinglePassProposal(a, ids[0], batch.checkpoints[0].checkpoint, loreFinding(repeatedLore[2])), id: "prior", status };
    a.activeState.memoryProposals = [compressed && status !== "pending" ? compactHistoricalProposal(proposal, "archive-id") : proposal];
    expect(loreNovelty(a, { ...proposal, id: "incoming" }).status).toBe("covered");
    expect(loreNovelty(a, { ...proposal, id: "incoming" }, false).status).toBe("new");
  }
});
it.each([
  ["Draconia attempted to kiss Seth.", "Draconia kissed Seth."],
  ["Seth offered a design agreement.", "Draconia accepted the design agreement."],
  ["Draconia did not remove her Mood Ring.", "Draconia removed her Mood Ring."],
  ["Draconia might remove her Mood Ring.", "Draconia will remove her Mood Ring."],
  ["Draconia plans to kiss Seth.", "Draconia kissed Seth."],
  ["Draconia kissed Seth on January 2, 2001.", "Draconia kissed Seth on January 3, 2001."],
  ["Draconia kissed Seth.", "Hermione kissed Seth."],
  ["Draconia refuses to remove her Mood Ring.", "Draconia refuses to remove her Mood Ring because it now anchors the protective ward."],
])("preserves distinct factual states: %s / %s", (before, after) => {
  const { a } = qualityFixture(); a.storyCards.find(c => c.id === "relationship")!.content = before;
  const p = makeMemoryProposal({ storyCardType: "lore", targetId: "relationship", content: after });
  expect(loreNovelty(a, p).status).not.toBe("covered");
  const next = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
  expect(next.activeState.memoryProposals[0]?.content).toBe(after);
});
it("normalizes a written date without merging distinct dated occurrences", () => {
  const { a } = qualityFixture(); a.storyCards.find(c => c.id === "relationship")!.content = "Draconia kissed Seth on January 2, 2001.";
  expect(loreNovelty(a, makeMemoryProposal({ targetId: "relationship", content: "Draconia kissed Seth on 2001-01-02." })).status).toBe("covered");
});

it("keeps bracketed dates and uncertain overlap without deleting new information", () => {
  const { a } = qualityFixture(); a.storyCards.find(c => c.id === "relationship")!.content = "[2001-01-02] Draconia kissed Seth.";
  const p = makeMemoryProposal({ targetId: "relationship", storyCardType: "lore", content: "[2001-01-03] Draconia kissed Seth." });
  expect(loreNovelty(a, p).status).not.toBe("covered");
  a.storyCards.find(c => c.id === "relationship")!.content = "Draconia publicly keeps Seth's blazer despite George's warning.";
  expect(loreNovelty(a, { ...p, content: "Draconia keeps Seth's blazer publicly despite Fred's warning." }).status).toBe("uncertain");
});
