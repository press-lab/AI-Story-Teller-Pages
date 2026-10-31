import { mockAssessment, isAssessment } from "../test/memoryAssessment";
import moodyPlacement from "./fixtures/moody-placement.json";
import { mockPlacementVerdict } from "../test/memoryPlacement";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, makeBrain, makeComponent, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { runMemoryCycle } from "../triggers/semanticEngine";
import { buildContext } from "../contextBuilder/contextBuilder";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { memoryCycleSources } from "./memoryCycleState";
import { pendingMemoryRecovery } from "./memoryRecoveryBatch";
import { memoryEvidenceWindow } from "./memoryEvidenceWindow";
import { memoryCanonMessages } from "./memoryCanon";
import { scanStoryCardExchange, STORY_CARD_MEMORY_CHECK } from "./storyCardSuggestions";
import { suggestionSourceValid } from "./storyCardSuggestions";
import reliability from "./fixtures/hogwarts-reliability.json";
import arcane from "./fixtures/arcane-foundation.json";
import { displayedBrainThoughts } from "./displayedBrainThoughts";
import type { Adventure } from "../types/adventure";

vi.mock("../providers/openAICompatible", () => ({ isNativeDeepSeekProvider: () => true, sendOpenAICompatibleChatCompletion: vi.fn() }));
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const config = { ...defaultModelConfig, apiKey: "offline-test" };
let fired: string[], discoveries: unknown[], fail: string | undefined, reject: boolean, discoveryNeeded: boolean;
const reaction = (name: string) => `I trust ${name === "Mira" ? "Seth's offer" : "the evidence"} after what we established; I will check the ward myself.`;
function seed() {
  const a = createDefaultAdventure("Original foundation regression");
  a.semanticEvaluationSettings = { ...a.semanticEvaluationSettings };
  a.components = [];
  a.brains = [makeBrain({ id: "mira", characterName: "Mira", active: true, thoughts: { old: "I still distrust the duke." }, inclusionPolicy: "always" })];
  a.messages = [{ id: "ask", role: "user", content: "Mira, I offer to share the ward research.", createdAt: "2026-07-01" },
    { id: "source", role: "assistant", content: "Mira accepts Seth's offer and reveals the ward's hidden key.", createdAt: "2026-07-01" }];
  return a;
}
function finding(a: Adventure, content = "Mira and Seth discovered the ward's hidden key.") {
  return { memoryMode: "historical", eventStatus: "completed", title: "The ward key discovery", storyCardType: "lore", content, suggestedTriggers: ["hidden key"],
    rationale: "A significant completed discovery", evidenceMessageIds: ["ask", "source"],
    evidenceQuotes: a.messages.map(message => ({ messageId: message.id, quote: message.content })) };
}
async function evaluate(a: Adventure, sourceId = "source") {
  const claimed = adventureReducer(a, { type: "CLAIM_MEMORY_EVALUATION", sourceId, turn: a.activeState.memoryRecoveryStoryTurn ?? 0, manual: true });
  const result = await runMemoryCycle(claimed, config, { sourceId, manual: true });
  return { ...result, state: result.actions.reduce(adventureReducer, claimed), claimed };
}
beforeEach(() => {
  fired = ["brain:mira"]; discoveries = []; fail = undefined; reject = false; discoveryNeeded = true;
  provider.mockReset();
  provider.mockImplementation(async request => {
    const text = request.messages.map(message => message.content).join("\n");
    let content = "[]";
    if (isAssessment(request.messages)) { const decision = JSON.parse(mockAssessment(request.messages, fired, discoveryNeeded));
      for (const target of decision.storyCards.targets) target.delta = "The coalition signed a binding charter.";
      content = JSON.stringify(decision);
    } else if (text.includes("MEMORY UPDATE VALIDATION")) {
      if (fail === "validation") throw new Error("offline validation failure");
      const body = JSON.parse(request.messages.at(-1)!.content);
      content = JSON.stringify({ accepted: !reject, meaningfulChange: !reject, reason: "Supported change in the supplied establishing exchange",
        evidenceMessageIds: body.latestTurnMessageIds, placement: mockPlacementVerdict(body), identityMatchesTarget: true, pressureChange: "changed_obligation" });
    } else if (text.includes("evaluation engine")) {
      const body = JSON.parse(request.messages.at(-1)!.content);
      if (fail && body.conditions.some((condition: { id: string }) => condition.id.includes(fail!))) throw new Error("offline condition failure");
      content = JSON.stringify(body.conditions.filter((condition: { id: string }) => fired.includes(condition.id)).map((condition: { id: string }) => condition.id));
    } else if (text.includes("STORY CARD MEMORY CHECK")) {
      if (fail === "discovery") return { content: "malformed", raw: {}, usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 } };
      content = JSON.stringify(discoveries);
    } else if (text.includes("recording one new thought")) {
      if (fail === "brain" || fail === "brain:mira") throw new Error("offline Brain generation failure");
      const name = /private plan for ([^.]+) based on/.exec(text)?.[1] ?? "Mira";
      content = JSON.stringify({ thoughts: { ward_research: `1 → ${reaction(name)}` } });
    } else if (text.includes("pruning")) {
      content = '{"thoughts":{"old":null}}';
    } else if (text.includes("maintaining Plot Essentials")) {
      content = "The old regime has fallen; the coalition now governs under a binding charter.";
    } else if (text.includes("updating the Active Pressure")) {
      content = "The council requires the signed charter by dawn.";
    } else if (text.includes("appending to a running log")) {
      content = "Mira confirmed the key and opened the sealed ward.";
    } else if (text.includes("Append new durable facts about")) {
      content = "The coalition signed a binding charter.";
    }
    return { content, raw: {}, usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 } };
  });
});

describe("original independent foundation", () => {
  it("measures false negatives, false positives, duplicate destinations and calls on a fixed offline routing benchmark", async () => {
    const metrics = { truePositives: 0, falseNegatives: 0, falsePositives: 0, duplicates: 0, providerCalls: 0 };
    for (const name of ["brain", "ordinary", "event", "known-event", "shared-discovery"]) {
      const a = seed(); fired = name === "brain" || name === "shared-discovery" ? ["brain:mira"] : [];
      discoveries = name === "event" || name === "known-event" || name === "shared-discovery" ? [finding(a)] : [];
      if (name === "event" || name === "known-event") a.brains = [];
      if (name === "known-event") a.storyCards = [makeStoryCard({ title: "The ward key discovery", content: "Mira and Seth discovered the ward's hidden key.", type: "lore", memoryMode: "historical" })];
      if (name === "shared-discovery") { a.brains.push(makeBrain({ id: "vi", characterName: "Vi", active: true })); a.messages.at(-1)!.content += " Vi confirms the finding."; fired.push("brain:vi"); discoveries = [finding(a)]; }
      const expected = name === "brain" ? ["brainUpdate:mira"] : name === "event" ? ["storyCard:The ward key discovery"]
        : name === "shared-discovery" ? ["brainUpdate:mira", "brainUpdate:vi", "storyCard:The ward key discovery"] : [];
      discoveryNeeded = discoveries.length > 0;
      provider.mockClear(); const result = await evaluate(a);
      const actual = result.state.activeState.memoryProposals.map(proposal => `${proposal.proposedType}:${proposal.targetId ?? proposal.title}`);
      metrics.truePositives += expected.filter(destination => actual.includes(destination)).length;
      metrics.falseNegatives += expected.filter(destination => !actual.includes(destination)).length;
      metrics.falsePositives += actual.filter(destination => !expected.includes(destination)).length;
      metrics.duplicates += actual.length - new Set(actual).size;
      metrics.providerCalls += provider.mock.calls.length;
    }
    expect(metrics).toEqual({ truePositives: 5, falseNegatives: 0, falsePositives: 0, duplicates: 0, providerCalls: 16 });
    console.log("FOUNDATION_OFFLINE_ROUTING", JSON.stringify(metrics));
  });
  it("captures a first-person Brain change from plain narration, preserves history and keeps pending memory out of canon", async () => {
    const a = seed();
    const result = await evaluate(a);
    expect(result.state.brains[0].thoughts).toEqual(a.brains[0].thoughts);
    const proposal = result.state.activeState.memoryProposals.find(proposal => proposal.proposedType === "brainUpdate")!;
    expect(proposal.sourceTurnId).toBe("source");
    expect(proposal.evaluationSource?.messages.map(message => message.id)).toEqual(["ask", "source"]);
    expect(buildContext(result.state).messages.map(message => message.content).join("\n")).not.toContain(reaction("Mira"));
    const approved = adventureReducer(result.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.brains[0].thoughts.old).toBe(a.brains[0].thoughts.old);
    expect(Object.values(approved.brains[0].thoughts)).toContain(`1 → ${reaction("Mira")}`);
    expect(buildContext(approved).messages.map(message => message.content).join("\n")).toContain(reaction("Mira"));
    expect(result.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  });
  it("recognizes a pronoun continuation through the bounded original exchange", async () => {
    const a = seed(); a.messages = reliability[2].messages as Adventure["messages"];
    a.brains = [makeBrain({ id: "draconia", characterName: "Draconia", active: true })];
    fired = ["brain:draconia"];
    const source = a.messages.at(-1)!;
    const result = await evaluate(a, source.id);
    expect(result.state.activeState.memoryProposals.some(proposal => proposal.targetId === "draconia")).toBe(true);
    const evaluation = provider.mock.calls.find(([request]) => isAssessment(request.messages))![0];
    expect(evaluation.messages.at(-1)!.content).toContain("Draconia");
    expect(result.logEntry.conditionsEvaluated.map(condition => condition.id)).toContain("brain:draconia");
  });
  it("preserves the original Brain condition contract on the actual July Arcane exchange without an appendix", async () => {
    const a = seed(); a.messages = arcane.messages as Adventure["messages"];
    a.brains = [makeBrain({ id: "mel", characterName: "Mel Medarda", triggers: ["Mel"], active: true })];
    fired = ["brain:mel"];
    expect(a.messages.every(message => !message.content.includes("<memory_updates>"))).toBe(true);
    const result = await evaluate(a, a.messages.at(-1)!.id);
    expect(result.logEntry.conditionsFired).toContain("brain:mel");
    expect(result.state.activeState.memoryProposals).toContainEqual(expect.objectContaining({ proposedType: "brainUpdate", targetId: "mel", sourceTurnId: a.messages.at(-1)!.id }));
    expect(arcane.provenance.title).toBe("Arcane: After the Rocket");
  });
  it("differentiates a shared completed discovery from two private reactions", async () => {
    const a = seed(); a.brains.push(makeBrain({ id: "vi", characterName: "Vi", active: true }));
    a.messages.at(-1)!.content += " Vi confirms the finding.";
    fired.push("brain:vi"); discoveries = [finding(a)];
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals.filter(proposal => proposal.proposedType === "brainUpdate")).toHaveLength(2);
    const lore = result.state.activeState.memoryProposals.find(proposal => proposal.storyCardType === "lore")!;
    expect(lore.memoryMode).toBe("historical"); expect(lore.content).not.toContain("I trust");
    expect(lore.lore?.sourceMessageIds).toEqual(expect.arrayContaining(["ask", "source"]));
    expect(suggestionSourceValid(result.state, lore)).toBe(true);
  });
  it("attributes a multi-turn relationship change to confirmation and preserves the earlier offer", async () => {
    const a = seed();
    a.messages = [{ id: "offer", role: "assistant", content: "Mira offers a lasting research partnership.", createdAt: "2026-07-01" }, ...a.messages];
    discoveries = [{ ...finding(a, "Mira and Seth confirmed their research partnership."), title: "Confirmed research partnership", evidenceMessageIds: ["offer", "ask", "source"] }];
    const result = await evaluate(a);
    const proposal = result.state.activeState.memoryProposals.find(proposal => proposal.proposedType === "storyCard")!;
    expect(proposal.evaluationSource?.messages.map(message => message.id)).toContain("offer");
    expect(proposal.storyCardReview?.evidenceQuotes).toHaveLength(3);
  });
  it("does not recreate an already-established historical event", async () => {
    const a = seed(); a.brains = []; const known = finding(a);
    a.storyCards = [makeStoryCard({ title: known.title, type: "lore", content: known.content, memoryMode: "historical" })];
    discoveries = [known];
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals).toHaveLength(0);
  });
  it("records a confirmed agreement as historical even when its promised work is still future", async () => {
    const a = seed(); discoveries = [{ ...finding(a, "Mira agreed to share the ward research tomorrow."), memoryMode: "historical", eventStatus: "completed" }];
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals.find(proposal => proposal.storyCardType === "lore")).toMatchObject({ memoryMode: "historical", lore: { status: "completed" } });
  });
  it("honors explicit auto-approval while keeping protected Brains under review", async () => {
    const a = seed();  a.memoryAutoApprove.brainUpdate = true;
    const applied = await evaluate(a);
    expect(Object.values(applied.state.brains[0].thoughts)).toContain(`1 → ${reaction("Mira")}`);
    const protectedAdventure = seed(); protectedAdventure.brains[0].protected = true;
     protectedAdventure.memoryAutoApprove.brainUpdate = true;
    const protectedResult = await evaluate(protectedAdventure);
    expect(protectedResult.state.brains[0].thoughts).toEqual(protectedAdventure.brains[0].thoughts);
    expect(protectedResult.state.activeState.memoryProposals[0].status).toBe("pending");
  });
  it("records an evidence rejection without applying the update or treating a valid negative verdict as a transport failure", async () => {
    reject = true; const a = seed(); const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals).toHaveLength(0);
    expect(result.state.brains).toEqual(a.brains);
    expect(result.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "validation_rejected" }));
  });
  it("restores all three distinct plot conditions, respects opt-outs, and leaves Director phases unchanged", async () => {
    const a = seed(); a.brains = [];
    a.components = [makeComponent({ id: "pe", title: "Plot Essentials", type: "plotEssentials", autoUpdate: true, content: "The regime governs." }),
      makeComponent({ id: "arc", title: "Current Arc", type: "currentArc", arcPremise: "Open the sealed ward", content: "The ward was found." }),
      makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "The regime threatens the city." })];
    fired = ["plotEssentialsDrift:pe", "currentArc:arc", "plotEssentialsPressure:pressure"];
    const result = await evaluate(a);
    expect(result.logEntry.conditionsFired).toEqual(expect.arrayContaining(fired));
    expect(result.state.activeState.memoryProposals.map(proposal => proposal.proposedType)).toEqual(expect.arrayContaining(["plotEssentialsUpdate", "currentArcUpdate", "plotPressureUpdate"]));
    expect(result.state.components).toEqual(a.components);
    let approved = result.state;
    for (const proposal of result.state.activeState.memoryProposals) approved = adventureReducer(approved, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.components[1].content).toContain("The ward was found.");
    expect(approved.components[1].content).toContain("Mira confirmed");
    expect(approved.components[1].arcState).toEqual(a.components[1].arcState);
    const optedOut = seed(); optedOut.components = a.components.map(component => ({ ...component, autoUpdate: false }));
    expect((await evaluate(optedOut)).logEntry.conditionsEvaluated.some(condition => condition.sourceType === "component")).toBe(false);
  });
  it("updates an existing Lore subject without replacing its historical facts", async () => {
    const a = seed(); a.brains = [];
    a.storyCards = [makeStoryCard({ id: "coalition", title: "Coalition", type: "lore", memoryMode: "living", content: "The coalition formed after the siege.", keys: [], autoUpdate: true })];
    fired = ["storyCard:coalition"];
    const result = await evaluate(a);
    const proposal = result.state.activeState.memoryProposals[0];
    expect(proposal.targetId).toBe("coalition");
    const approved = adventureReducer(result.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.storyCards[0].content).toContain("formed after the siege");
    expect(approved.storyCards[0].content).toContain("signed a binding charter");
  });
  it("leaves ordinary dialogue unwritten with one shared assessment", async () => {
    const a = seed(); fired = []; a.components = [makeComponent({ id: "pressure", title: "Active Pressure", type: "activePressure", content: "No threat" })];
    a.storyCards = [makeStoryCard({ title: "Ward", content: "A sealed ward", type: "lore", memoryMode: "living", keys: [], autoUpdate: true })];
    discoveryNeeded = false;
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals).toHaveLength(0);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.tokenUsage).toEqual({ promptTokens: 5, completionTokens: 1 });
  });
  it("retries only a failed group; never stamps failed discovery as successful", async () => {
    const a = seed(); fail = "discovery";
    const first = await evaluate(a);
    expect(first.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "failed", completedGroups: ["plot", "storyCards", "brains"] });
    expect(first.state.activeState.lastMemoryCycleTurn).toBeUndefined();
    expect(first.state.messages.at(-1)?.content).toBe(a.messages.at(-1)?.content);
    provider.mockClear(); fail = undefined;
    const second = await evaluate(first.state);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(second.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
    expect(second.state.activeState.memoryProposals).toHaveLength(1);
    await evaluate(second.state); expect(provider).toHaveBeenCalledTimes(1);
  });
  it("discards stale transactions while allowing manual approval of a retained draft after an edit", async () => {
    const a = seed(), result = await evaluate(a);
    const edited = adventureReducer(result.claimed, { type: "UPDATE_MESSAGE", messageId: "ask", content: "A different offer." });
    const stale = result.actions.reduce(adventureReducer, edited);
    expect(stale.activeState.memoryProposals).toHaveLength(0);
    const targetEdited = { ...result.claimed, brains: result.claimed.brains.map(brain => ({ ...brain, notes: "User edited this character." })) };
    expect(result.actions.reduce(adventureReducer, targetEdited).activeState.memoryProposals).toHaveLength(0);
    const pending = result.state.activeState.memoryProposals[0];
    const changed = adventureReducer(result.state, { type: "UPDATE_MESSAGE", messageId: "source", content: "It was a dream." });
    expect(adventureReducer(changed, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: pending.id, automatic: true })).toBe(changed);
    const approved = adventureReducer(changed, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: pending.id });
    expect(approved.activeState.memoryProposals.find(p => p.id === pending.id)?.status).toBe("approved");
    expect(approved.brains).not.toEqual(changed.brains);
  });
  it("keeps rejection and manual edits effective and cannot apply a successful transaction twice", async () => {
    const a = seed(), result = await evaluate(a);
    const proposal = result.state.activeState.memoryProposals[0];
    const rejected = adventureReducer(result.state, { type: "REJECT_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(rejected.brains).toEqual(a.brains);
    expect(result.actions.reduce(adventureReducer, rejected).activeState.memoryProposals).toEqual(rejected.activeState.memoryProposals);
    const approved = adventureReducer(result.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id, editedProposal: { content: '{"thoughts":{"reviewed":"I will verify this myself."}}' } });
    expect(approved.brains[0].thoughts.reviewed).toBe("I will verify this myself.");
  });
  it("preserves condensation history through reviewed patches", async () => {
    const a = seed(); a.brains[0].condenseThreshold = 1;
    const result = await evaluate(a); const proposal = result.state.activeState.memoryProposals[0];
    const approved = adventureReducer(result.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(approved.brains[0].archivedThoughts.old).toBe(a.brains[0].thoughts.old);
    expect(Object.values(approved.brains[0].thoughts)).toContain(`1 → ${reaction("Mira")}`);
  });
  it("shows approved printed thoughts without altering the stored evidence or provider transcript", async () => {
    const a = seed(); a.brains[0].printThoughts = true;
    const result = await evaluate(a); const proposal = result.state.activeState.memoryProposals[0];
    expect(displayedBrainThoughts(result.state, result.state.messages.at(-1)!)).toEqual([]);
    const approved = adventureReducer(result.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
    expect(displayedBrainThoughts(approved, approved.messages.at(-1)!)).toEqual([`Mira: 1 → ${reaction("Mira")}`]);
    expect(approved.messages).toEqual(a.messages.map((message, index) => index === a.messages.length - 1 ? expect.objectContaining({ id: message.id, content: message.content }) : message));
    expect(suggestionSourceValid(approved, { ...proposal, evaluationSource: { messages: proposal.evaluationSource!.messages } })).toBe(true);
  });
  it("preserves optional state and legacy recovery in export/import without scheduling history", async () => {
    const a = seed(); a.messages[0].memoryRecovery = { turn: 1, status: "pending" };
    const state = (await evaluate(a)).state;
    const imported = importAdventureJson(exportAdventureJson(state));
    expect(imported.messages).toEqual(state.messages);
    expect(imported.activeState.memoryProposals).toEqual(state.activeState.memoryProposals);
    const legacy = normalizeAdventure(seed());
    expect(memoryCycleSources(legacy)).toHaveLength(0);
  });
  it.each([false, true])("makes no automatic request when disabled or manual-only (%s)", async enabled => {
    const a = seed(); a.memoryDetectionSettings = { enabled, everyNTurns: enabled ? 0 : 1, generateContent: true };
    await runMemoryCycle(a, config); expect(provider).not.toHaveBeenCalled();
  });
  it("preserves a plain story and queues independent work without adding narrator instructions or applying an unsolicited envelope", async () => {
    const a = seed(); a.messages = [];
    const send = vi.fn(async () => ({ content: 'Mira reveals the hidden key.<memory_updates>{"updates":[]}</memory_updates>' }));
    const result = await runTurnPipeline({ adventure: a, text: "I ask Mira.", sendChatCompletion: send });
    expect(send).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled();
    expect(result.providerPayload.map(message => message.content).join("\n")).not.toContain("[ONE-PASS MEMORY]");
    expect(result.adventure.messages.at(-1)?.memoryEvaluation?.status).toBe("pending");
    expect(result.adventure.messages.at(-1)?.content).toBe("Mira reveals the hidden key.");
  });
  it("uses the confirmed memory-operation date without borrowing later evidence", async () => {
    const a = seed(); a.storyClock = { origin: "established", current: { text: "2030-10-01", date: "2030-10-01", precision: "day" } };
    a.messages.push({ id: "future", role: "assistant", content: "The ward exploded years later.", createdAt: "2026-10-24" });
    discoveries = [finding({ ...a, messages: a.messages.slice(0, 2) })];
    const result = await evaluate(a);
    const proposal = result.state.activeState.memoryProposals.find(proposal => proposal.storyCardType === "lore")!;
    expect(proposal.lore?.occurredAt?.date).toBe("2030-10-01");
    expect(proposal.evaluationSource?.messages.map(message => message.id)).not.toContain("future");
  });
});


// Controlled provider replies validate software paths, NOT model detection accuracy.
describe("interpersonal discovery reliability paths", () => {
  const cases = [
    { name: "explicit attempted kiss", player: "I try to kiss Hermione.", narrator: "Hermione withdraws before our lips touch and says no.",
      fact: "Seth attempted to kiss Hermione; she withdrew before contact and declined.", candidateOnly: true, eventStatus: "completed" },
    { name: "unresolved explicit kiss attempt", player: "I try to kiss Hermione.", narrator: "Hermione pauses before any contact. Her response remains unresolved.",
      fact: "Seth attempted to kiss Hermione; no contact or consent was established and her response remains unresolved.", candidateOnly: true, eventStatus: "unresolved" },
    { name: "unaccepted protective magic offer", player: "I offer Hermione a lasting protective ward for the tournament.", narrator: "Hermione says she needs to review the risks before deciding. No ward is cast.",
      fact: "Seth offered Hermione a protective ward for the tournament. She deferred her decision pending a risk review; no agreement or casting occurred.", candidateOnly: true, eventStatus: "unresolved" },
    { name: "research collaboration disagreement", player: "I propose testing our joint rune design on a live ward today.", narrator: "Hermione refuses live testing until they settle the instability in their shared calculations. Their collaboration continues, but the test is postponed.",
      fact: "Hermione opposed Seth's proposed live rune test until instability in their shared calculations is resolved. Their collaboration continues; no live test occurred.", candidateOnly: false, eventStatus: "ongoing" },
    { name: "mutual first kiss", player: "May I kiss you?", narrator: "Hermione says yes, and they share their first mutual kiss.",
      fact: "Hermione and Seth shared their first mutual kiss.", candidateOnly: false, eventStatus: "completed" },
    { name: "ambiguous significant advance", player: "Disarming and undermining am I? I grin as I lean in.", narrator: "Hermione leans back a precise, deliberate inch. She jokes about his flirting and invites him to walk her to Gryffindor Tower.",
      fact: "During flirtation Seth leaned in; Hermione deliberately leaned back, then invited him to walk her to her tower. Romantic intent remains uncertain.", candidateOnly: true, eventStatus: "unresolved" },
    { name: "accepted research dinner", player: "Will you have dinner with me to discuss the runes?", narrator: "Hermione says, I wasn't going to say no to dinner regardless. We can discuss the research there.",
      fact: "Hermione accepted Seth's invitation to dinner to discuss rune research; the dinner has not happened.", candidateOnly: false, eventStatus: "completed" },
  ];
  it.each(cases)("routes $name with original evidence and protected character identity", async scene => {
    const a = seed(); a.brains = []; fired = [];
    a.storyCards = [makeStoryCard({ id: "hermione", type: "character", title: "Hermione", keys: ["Hermione"], content: "A scholar.", autoUpdate: false, protected: true, memoryMode: "static" })];
    a.messages[0].content = scene.player; a.messages[1].content = scene.narrator;
    discoveries = [{ ...finding(a, scene.fact), title: scene.name, candidateOnly: scene.candidateOnly, eventStatus: scene.eventStatus }];

    a.memoryAutoApprove.loreStoryCard = true; a.memoryAutoApprove.otherStoryCard = true;
    const result = await evaluate(a);
    expect(result.state.storyCards.find(card => card.id === "hermione")).toEqual(a.storyCards[0]);
    const proposal = result.state.activeState.memoryProposals.find(item => item.storyCardType === "lore")!;
    expect(proposal).toMatchObject({ memoryMode: "historical", lore: { status: scene.eventStatus }, storyCardReview: { candidateOnly: scene.candidateOnly } });
    if (scene.candidateOnly) expect(proposal).toMatchObject({ status: "pending", requiresReview: true });
    expect(proposal.storyCardReview?.evidenceQuotes).toEqual(a.messages.map(message => ({ messageId: message.id, quote: message.content })));
    if (scene.name.includes("attempt") || scene.name.includes("ambiguous")) expect(proposal.content).not.toMatch(/shared.*kiss|completed kiss|confirmed kiss attempt/i);
    if (scene.name.includes("dinner")) expect(proposal.content).not.toContain("romantic date");
    expect(result.logEntry.conditionsEvaluated.some(condition => condition.id === "storyCard:hermione")).toBe(true);
    const count = result.state.activeState.memoryProposals.length;
    expect((await evaluate(result.state)).state.activeState.memoryProposals).toHaveLength(count);
  });
  it("keeps ordinary book-reading negative and records semantic zero separately from identity", async () => {
    const a = seed(); a.brains = []; fired = []; discoveries = [];
    a.messages[1].content = "They lean closer to read the book. Hermione says they can return to Gryffindor Tower.";
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals).toHaveLength(0);
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "zero_candidates", candidateKinds: ["semanticLore"] }));
    expect(result.logEntry.conditionsFired).not.toContain("storyCardDiscovery");
    const prompt = provider.mock.calls.flatMap(([request]) => request.messages).find(message => message.content.startsWith("STORY CARD MEMORY CHECK"))!.content;
    expect(prompt).toContain("Ordinary smiles, leaning to read");
    expect(prompt).toContain('"evidenceQuotes"'); expect(prompt).not.toContain('"memoryMode"'); expect(prompt).toContain('"eventStatus"');
  });
  it("distinguishes identity-only nominations from semantic detection success", async () => {
    const a = seed(); a.brains = []; fired = [];
    a.messages[1].content = "Silverpeak Citadel is a hidden academy built into the mountain.";
    const result = await evaluate(a);
    expect(result.logEntry.conditionsFired).toContain("storyCardIdentityDiscovery");
    expect(result.logEntry.conditionsFired).not.toContain("storyCardDiscovery");
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ candidateKinds: ["deterministicIdentity"] }));
    expect(scanStoryCardExchange(a, { ...a.messages[1], content: 'Hermione says, "Walk me to Gryffindor Tower."' }).some(proposal => proposal.storyCardType === "location")).toBe(false);
  });
  it.each([
    { evidenceQuotes: [{ messageId: "source", quote: "They kissed." }] },
    { evidenceQuotes: [{ messageId: "ask", quote: "Mira, I offer to share the ward research." }] },
    { evidenceMessageIds: ["source", "invented"] },
    { eventStatus: undefined }, { eventStatus: "invented" },
  ])("retains diagnosable source-contract failures: %j", async invalid => {
    const a = seed(); a.brains = []; fired = []; discoveries = [{ ...finding(a), ...invalid }];
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals).toHaveLength(0);
    expect(result.state.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "validation_rejected", candidateKinds: ["semanticLore"] }));
  });
  it("tags OOC replies and spends the evidence budget only on story exchanges, preserving correction references", async () => {
    let a = seed(); fired = [];
    a.messages.unshift(
      { id: "old-ask", role: "user", content: "Earlier scene.", createdAt: "2026-07-01" },
      { id: "old-source", role: "assistant", content: "Earlier narration.", createdAt: "2026-07-01" },
      { id: "prior-ask", role: "user", content: "I ask about the library.", createdAt: "2026-07-01" },
      { id: "prior-source", role: "assistant", content: "Mira points to the library.", createdAt: "2026-07-01" });
    for (let n = 0; n < 3; n++) {
      const turn = await runTurnPipeline({ adventure: a, text: "Correction: this dinner is research, not a date.", mode: "comms", sendChatCompletion: async () => ({ content: "Acknowledged; no story action occurred." }) });
      a = turn.adventure;
      expect(a.messages.at(-1)?.inputMode).toBe("comms");
    }
    a.messages.push({ id: "ask2", role: "user", content: "I open the book.", createdAt: "2026-07-01" }, { id: "source2", role: "assistant", content: "Hermione reads alongside him.", createdAt: "2026-07-01" });
    const evidence = memoryEvidenceWindow(a, "source2");
    expect(evidence.map(message => message.id)).toEqual(["prior-ask", "prior-source", "ask", "source", "ask2", "source2"]);
    expect(memoryCanonMessages(a, "", "").some(message => message.content.includes("Explicit author/OOC reference"))).toBe(true);
    await evaluate(a, "source2");
    const requests = provider.mock.calls.flatMap(([request]) => request.messages);
    expect(requests.filter(message => message.content.startsWith("Recent story evidence:")).every(message => !message.content.includes("Acknowledged"))).toBe(true);
    const conditions = provider.mock.calls.find(([request]) => isAssessment(request.messages))![0];
    expect(conditions.messages.at(-1)!.content).not.toContain("Acknowledged");
    expect(conditions.messages.at(-1)!.content).not.toContain("Correction:");
    expect(STORY_CARD_MEMORY_CHECK).toContain("NEVER a confirmed kiss attempt");
  });
});

it("preserves legacy assistant recovery for explicit review without scheduling or replaying it", async () => {
  const a = seed(); a.brains = []; fired = [];
  a.messages.unshift({ id: "legacy", role: "assistant", content: "Hermione accepted the research dinner invitation.", createdAt: "2026-07-01", memoryRecovery: { turn: 1, status: "pending" } });
  a.messages[1].memoryEvaluation = undefined;
  const normalized = normalizeAdventure(a);
  expect(pendingMemoryRecovery(normalized).map(message => message.id)).toContain("legacy");
  expect(memoryCycleSources(normalized)).toHaveLength(0);
  expect(provider).not.toHaveBeenCalled();
  const result = await evaluate(normalized);
  expect(result.state.messages.find(message => message.id === "legacy")?.memoryRecovery).toEqual(a.messages[0].memoryRecovery);
  expect(pendingMemoryRecovery(result.state).map(message => message.id)).toContain("legacy");
  expect(provider.mock.calls.filter(([request]) => request.messages.some(message => message.content.startsWith("STORY CARD MEMORY CHECK")))).toHaveLength(1);
});


describe("memory provider configuration recovery", () => {
  it.each(["pending", "failed", "quarantined"] as const)("preflights %s sources without consuming attempts or checkpoints", async status => {
    const a = seed();
    a.messages[1].memoryEvaluation = { turn: 1, status, attempts: status === "pending" ? 0 : 3, completedGroups: ["plot", "storyCards"] };
    a.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "1", model: "", apiKey: "secret-never-log" };
    const before = structuredClone(a.messages);
    const blocked = await evaluate(a);
    expect(blocked.state.messages).toEqual(before);
    expect(provider).not.toHaveBeenCalled();
    expect(blocked.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "not_attempted", failureCategory: "configuration", failureCode: "memory_background_base_url_invalid" }));
    expect(blocked.logEntry.errors.join()).toContain("Memory Suggestions are paused");
    expect(JSON.stringify(blocked.logEntry)).not.toContain("secret-never-log");
    expect(blocked.actions.some(action => action.type === "COMMIT_MEMORY_EVALUATION_GROUP")).toBe(false);
    const fixed = { ...blocked.state, semanticEvaluationSettings: { ...a.semanticEvaluationSettings, backgroundProviderConfig: { baseUrl: "https://example.test/v1", model: "" } } };
    discoveries = [finding(fixed)];
    // Correction alone makes no paid request; failed/quarantined entries require explicit recovery.
    expect(provider).not.toHaveBeenCalled();
    if (status !== "pending") expect(memoryCycleSources(fixed)).toHaveLength(0);
    const recovered = await evaluate(fixed);
    expect(recovered.state.messages[1].memoryEvaluation).toMatchObject({ status: "complete", completedGroups: ["plot", "storyCards", "brains", "discovery"] });
    expect(recovered.state.messages.map(message => message.content)).toEqual(before.map(message => message.content));
    expect(recovered.state.activeState.memoryProposals.filter(proposal => proposal.storyCardType === "lore")).toHaveLength(1);
    const calls = provider.mock.calls.length;
    await evaluate(recovered.state);
    expect(provider).toHaveBeenCalledTimes(calls);
  });
  it("rejects an invalid inherited endpoint or empty effective model before any group runs", async () => {
    for (const override of [{ baseUrl: "1" }, { model: "" }]) {
      const a = seed();
      const result = await runMemoryCycle(a, { ...config, ...override }, { sourceId: "source", manual: true });
      expect(result.actions.some(action => action.type === "COMMIT_MEMORY_EVALUATION_GROUP")).toBe(false);
      expect(result.logEntry.errors.join()).toContain("Memory Suggestions are paused");
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("distinguishes safe transport failure from invalid output and genuine zero discovery", async () => {
    const a = seed(); a.brains = []; fired = [];
    provider.mockRejectedValueOnce(new Error("API failure with key secret-never-log"));
    const transport = await evaluate(a);
    expect(transport.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ requestStage: "assessment", failureCategory: "transport_api", failureCode: "memory_provider_request_failed" }));
    expect(transport.state.activeState.memoryDiagnostics?.filter(d => d.outcome === "evaluation_failed")).toHaveLength(1);
    expect(JSON.stringify(transport.logEntry)).not.toContain("secret-never-log");
    expect(transport.state.activeState.memoryDiagnostics?.some(entry => entry.outcome === "zero_candidates")).toBe(false);
    fail = "discovery";
    const malformed = await evaluate(a);
    expect(malformed.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ group: "discovery", failureCategory: "invalid_model_output" }));
    fail = undefined;
    const zero = await evaluate(a);
    expect(zero.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ candidateKinds: ["semanticLore"], outcome: "zero_candidates" }));
    expect(zero.logEntry.conditionsFired).not.toContain("storyCardDiscovery");
  });
  it("does not represent existing-card maintenance as discovery", async () => {
    const a = seed(); a.brains = [];
    a.storyCards = [makeStoryCard({ id: "coalition", title: "Coalition", type: "lore", memoryMode: "living", content: "The coalition formed after the siege.", keys: [], autoUpdate: true })];
    fired = ["storyCard:coalition"]; discoveries = [];
    const result = await evaluate(a);
    expect(result.logEntry.conditionsFired).toContain("storyCard:coalition");
    expect(result.logEntry.conditionsFired).not.toContain("storyCardDiscovery");
    expect(result.logEntry.actionsExecuted).toContain("Semantic discovery: 0 proposals");
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ candidateKinds: ["semanticLore"], outcome: "zero_candidates" }));
  });
});


describe("discovery transactions and edited sources", () => {
  it.each([true, false])("retains a valid synthetic sibling regardless of malformed candidate order: %s", async badFirst => {
    const a = seed(); a.brains = []; fired = [];
    const good = finding(a);
    const bad = { ...finding(a), title: "Unsupported finding", content: "An unsupported different event happened.", evidenceMessageIds: ["invented"] };
    discoveries = badFirst ? [bad, good] : [good, bad];
    const result = await evaluate(a);
    expect(result.state.activeState.memoryProposals.map(p => p.title)).toEqual([good.title]);
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({
      outcome: "validation_rejected", failureCode: "discovery_foreign_evidence_ids" }));
    expect(result.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
    expect(result.actions.reduce(adventureReducer, result.state).activeState.memoryProposals).toHaveLength(1);
  });

  it("requeues edited tracked sources and their dependent evaluations without scanning untracked history", async () => {
    const a = seed(); a.brains = []; fired = [];
    const first = await evaluate(a);
    first.state.messages.push({ id: "next-user", role: "user", content: "What next?", createdAt: "2026-07-01" },
      { id: "next-source", role: "assistant", content: "They inspect the ward.", createdAt: "2026-07-01",
        memoryEvaluation: { turn: 2, status: "complete", attempts: 1, completedGroups: ["plot", "storyCards", "brains", "discovery"] } },
      { id: "legacy", role: "assistant", content: "Legacy history.", createdAt: "2026-07-01" });
    const edited = adventureReducer(first.state, { type: "UPDATE_MESSAGE", messageId: "ask", content: "Mira, keep the key private." });
    expect(edited.messages.find(m => m.id === "source")?.memoryEvaluation).toMatchObject({ status: "pending", attempts: 0, completedGroups: [] });
    expect(edited.messages.find(m => m.id === "next-source")?.memoryEvaluation?.status).toBe("pending");
    expect(memoryCycleSources(edited).map(m => m.id)).toEqual(["source", "next-source"]);
    expect(edited.messages.find(m => m.id === "legacy")?.memoryEvaluation).toBeUndefined();
    expect(adventureReducer(edited, { type: "UPDATE_MESSAGE", messageId: "ask", content: "Mira, keep the key private." })).toBe(edited);
  });

  it("persists validated drafts and retries only unfinished validation before an atomic commit", async () => {
    const a = normalizeAdventure(seed()); a.brains = []; fired = [];
    a.messages.at(-1)!.content += " A storm permanently destroyed the harbor gate.";
    discoveries = [finding(a), { ...finding(a, "A storm permanently destroyed the harbor gate."), title: "Harbor gate collapse", suggestedTriggers: ["harbor gate collapse"] }];
    const implementation = provider.getMockImplementation()!;
    let failSecond = true;
    provider.mockImplementation(async request => {
      if (request.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) {
        const body = JSON.parse(request.messages.at(-1)!.content);
        if (body.title === "Harbor gate collapse" && failSecond) { failSecond = false; throw new Error("temporary failure with secret-never-log"); }
      }
      return implementation(request);
    });
    const first = await evaluate(a);
    expect(first.state.activeState.memoryProposals).toHaveLength(0);
    expect(first.state.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint?.candidates.map(c => c.status)).toEqual(["accepted", "awaiting_retry"]);
    expect(JSON.stringify(first.state)).not.toContain("secret-never-log");
    const reloaded = importAdventureJson(exportAdventureJson(first.state));
    expect(reloaded.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint).toEqual(first.state.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint);
    provider.mockClear();
    const second = await evaluate(reloaded);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(second.state.activeState.memoryProposals).toHaveLength(2);
    expect(second.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
    expect(second.state.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint).toBeUndefined();
    expect(second.actions.reduce(adventureReducer, second.state).activeState.memoryProposals).toHaveLength(2);
  });
});


describe("Hogwarts read-only source regressions", () => {
  it("retains invalid-attempt history when a later evaluation legitimately returns zero", async () => {
    const fixture = await import("./fixtures/hogwarts-memory-reliability.json");
    expect(fixture.provenance.rejectedDiscoveryPayloadsAvailable).toBe(false);
    const recorded = fixture.cases[0];
    expect(recorded.diagnostics.some(d => d.reason.includes("returned 3 candidates"))).toBe(true);
    const a = seed(); a.brains = []; fired = [];
    a.messages = (recorded.messages as Adventure["messages"]).map(({ memoryEvaluation: _evaluation, ...message }) => message) as Adventure["messages"];
    // Synthetic malformed output: the original rejected payload was not exported.
    discoveries = [{ ...finding(a), evidenceMessageIds: ["invented"] }];
    const first = await evaluate(a, recorded.sourceId);
    expect(first.state.messages.at(-1)?.memoryEvaluation?.status).toBe("failed");
    discoveries = [];
    const second = await evaluate(first.state, recorded.sourceId);
    expect(second.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
    expect(second.state.activeState.memoryProposals).toHaveLength(0);
    expect(second.state.activeState.memoryDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "validation_rejected", failureCode: "discovery_foreign_evidence_ids" }),
      expect.objectContaining({ outcome: "zero_candidates" }),
    ]));
  });

  it("keeps the Ron attribution rejection separate from the subsequent edit and queues corrected evidence", async () => {
    const fixture = await import("./fixtures/hogwarts-memory-reliability.json");
    const recorded = fixture.cases[1], a = seed(); a.brains = []; fired = [];
    a.messages = recorded.messages as Adventure["messages"];
    const actual = recorded.diagnostics.find(d => "candidate" in d)! as unknown as { candidate: { title: string; content: string } };
    discoveries = [{ ...finding(a, actual.candidate.content), title: actual.candidate.title,
      evidenceMessageIds: a.messages.map(m => m.id) }];
    const implementation = provider.getMockImplementation()!;
    provider.mockImplementation(async request => {
      if (request.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) {
        const body = JSON.parse(request.messages.at(-1)!.content);
        return { content: JSON.stringify({ accepted: true, meaningfulChange: true, evidenceMessageIds: body.latestTurnMessageIds,
          identityMatchesTarget: false, reason: "Attribution needs review." }), raw: {} };
      }
      return implementation(request);
    });
    const first = await evaluate(a, recorded.sourceId);
    expect(first.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ failureCode: "memory_identity_rejected", reason: expect.stringContaining("Attribution needs review") }));
    const edited = adventureReducer(first.state, { type: "UPDATE_MESSAGE", messageId: recorded.sourceId, content: a.messages.at(-1)!.content + "\nRon clarifies that he has not bought anything." });
    expect(memoryCycleSources(edited).map(m => m.id)).toContain(recorded.sourceId);
    expect(edited.activeState.memoryProposals).toEqual(first.state.activeState.memoryProposals);
  });

  it("retains completed plot/card groups when the latest source has independent Brain and discovery failures", async () => {
    const fixture = await import("./fixtures/hogwarts-memory-reliability.json");
    const recorded = fixture.cases[2], a = seed();
    a.messages = (recorded.messages as Adventure["messages"]).map(({ memoryEvaluation: _evaluation, ...message }) => message) as Adventure["messages"];
    a.brains = [makeBrain({ id: "draco", characterName: "Draco", active: true })];
    fired = ["brain:draco"]; fail = "brain";
    discoveries = [{ ...finding(a), evidenceMessageIds: ["invented"] }];
    const result = await evaluate(a, recorded.sourceId);
    expect(result.state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "failed", completedGroups: ["plot", "storyCards"] });
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ group: "brains", failureCode: "memory_provider_request_failed" }));
    expect(result.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ group: "discovery", failureCode: "discovery_foreign_evidence_ids" }));
  });

  it("invalidates saved drafts on evidence edits and rejects an old transaction even after the text is restored", async () => {
    const a = seed(); a.brains = []; fired = []; discoveries = [finding(a)]; fail = "validation";
    const first = await evaluate(a);
    const original = first.state.messages.at(-1)!.content;
    const edited = adventureReducer(first.state, { type: "UPDATE_MESSAGE", messageId: "source", content: "The key was never found." });
    expect(edited.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint).toBeUndefined();
    const restored = adventureReducer(edited, { type: "UPDATE_MESSAGE", messageId: "source", content: original });
    const stale = first.actions.reduce(adventureReducer, restored);
    expect(stale.activeState.memoryProposals).toHaveLength(0);
    expect(stale.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "pending", attempts: 0 });
    expect(stale.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint).toBeUndefined();
    expect(stale.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "evaluation_stale" }));
  });

  it("invalidates cached reviews when canon or destination controls change", async () => {
    const a = normalizeAdventure(seed()); a.brains = []; fired = []; discoveries = [finding(a)]; fail = "validation";
    const first = await evaluate(a);
    first.state.storyCards = [makeStoryCard({ title: "New canon", content: "Mira must verify the key.", keys: ["Mira"], autoUpdate: false })];
    fail = undefined; provider.mockClear();
    const second = await evaluate(first.state);
    expect(provider.mock.calls.some(([request]) => request.messages.some(m => m.content.startsWith("STORY CARD MEMORY CHECK")))).toBe(true);
    expect(second.state.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "checkpoint_invalidated" }));
  });

  it("retains noncanonical drafts after three failed attempts and allows bounded explicit recovery", async () => {
    const a = normalizeAdventure(seed()); a.brains = []; fired = []; discoveries = [finding(a)]; fail = "validation";
    let state = a;
    for (let attempt = 0; attempt < 3; attempt++) state = (await evaluate(state)).state;
    expect(state.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "quarantined", attempts: 3 });
    expect(state.messages.at(-1)?.memoryEvaluation?.discoveryCheckpoint?.candidates[0].status).toBe("awaiting_retry");
    expect(state.activeState.memoryProposals).toHaveLength(0);
    expect(memoryCycleSources(state)).toHaveLength(0);
    expect(JSON.stringify(buildContext(state).messages)).not.toContain("referenceFingerprint");
    fail = undefined; provider.mockClear();
    const recovered = await evaluate(state);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(recovered.state.activeState.memoryProposals).toHaveLength(1);
    expect(recovered.state.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  });
});


it("repairs an edited old source whose evaluation marker was lost but whose diagnostics prove it was tracked", async () => {
  const fixture = await import("./fixtures/hogwarts-memory-reliability.json");
  const recorded = fixture.cases[1], a = seed();
  a.messages = recorded.messages as Adventure["messages"];
  a.activeState.memoryDiagnostics = [{ id: "tracked", sourceId: recorded.sourceId, createdAt: "2026-10-24", stage: "independent", outcome: "evaluation_queued" }];
  expect(a.messages.at(-1)?.memoryEvaluation).toBeUndefined();
  const edited = adventureReducer(a, { type: "UPDATE_MESSAGE", messageId: recorded.sourceId, content: a.messages.at(-1)!.content + " Corrected wording." });
  expect(memoryCycleSources(edited).map(m => m.id)).toContain(recorded.sourceId);
});

it("retains a Moody lesson from the existing Character check as focused Lore without changing its identity", async () => {
  const a = seed(); a.brains = []; a.storyCards = [makeStoryCard({ id: "moody", title: "Alastor Moody", type: "character", content: moodyPlacement.biography, autoUpdate: true, keys: ["Moody"] })];
  a.messages.at(-1)!.content = moodyPlacement.source; fired = ["storyCard:moody"]; discoveries = [];
  const previous = provider.getMockImplementation()!;
  provider.mockImplementation(async request => {
    const text = request.messages.map(m => m.content).join("\n");
    if (text.includes("MEMORY UPDATE VALIDATION")) {
      const body = JSON.parse(request.messages.at(-1)!.content);
      return { content: JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true, evidenceMessageIds: body.latestTurnMessageIds, reason: "Supported classroom event.",
        placement: { kind: "historicalLore", title: "Moody’s Unforgivable Curses Demonstration", content: moodyPlacement.lore, newFact: moodyPlacement.lore, reason: "Completed lesson, no identity change." } }), raw: {} };
    }
    if (!isAssessment(request.messages) && text.includes("Append new durable facts about")) return { content: moodyPlacement.proposal, raw: {} };
    return previous(request);
  });
  const result = await evaluate(a);
  expect(result.logEntry.errors).toEqual([]);
  const proposal = result.state.activeState.memoryProposals.find(p => p.storyCardType === "lore")!;
  expect(proposal).toMatchObject({ content: moodyPlacement.lore, targetId: undefined, placementValidation: { kind: "create" } });
  const approved = adventureReducer(result.state, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: proposal.id });
  expect(approved.storyCards[0]).toEqual(a.storyCards[0]);
  expect(approved.storyCards.find(c => c.type === "lore")?.content).toContain(moodyPlacement.lore);
});

// These legacy assertions inspect detailed logging. OFF contracts are tested separately.
const debugLogging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: true }));
vi.mock("../config/debugLogging", () => debugLogging);
