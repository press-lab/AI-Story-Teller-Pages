import { mockAssessment, isAssessment } from "../test/memoryAssessment";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure, makeComponent, makeBrain } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import type { Adventure } from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { saveAdventure } from "../db/adventureDb";
import { useAdventureRuntime } from "./useAdventureRuntime";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", async original => ({ ...await original<typeof import("../providers/openAICompatible")>(), sendOpenAICompatibleChatCompletion: vi.fn() }));
const nativeTimeout = globalThis.setTimeout;
async function tickIdle() { await new Promise<void>(resolve => nativeTimeout(resolve, 10)); }
function fastIdleDeadline() {
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
    nativeTimeout(callback, delay === 120_000 ? 0 : delay, ...args)) as typeof setTimeout);
}
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const story = "Mira waits beside the gate.";
let assessmentMessages: Parameters<typeof mockAssessment>[0];
function response(content = mockAssessment(assessmentMessages)) { return { content, raw: {} }; }
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(saved?: Adventure, keepComponents = false) {
  const initial = saved ?? createDefaultAdventure("Memory worker");
  if (!keepComponents) initial.components = [];
  const openTab = vi.fn();
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    return { adventure, setAdventure, openTab, runtime: useAdventureRuntime(adventure, setAdventure,
      { ...defaultModelConfig, apiKey: "offline-test" }, vi.fn(), vi.fn(), openTab, async () => undefined,
      { enabled: true, everyNTurns: 1, generateContent: true }) };
  });
}
beforeEach(() => { vi.restoreAllMocks(); fastIdleDeadline(); vi.clearAllMocks(); provider.mockReset();
  provider.mockImplementation(async request => response(request.memoryEvaluation ? mockAssessment(request.messages) : story)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("releases narration loading while discovery waits and persists earlier groups before the outstanding request", async () => {
  const pending = deferred();
  provider.mockImplementation(request => !request.memoryEvaluation ? Promise.resolve(response(story)) : isAssessment(request.messages) ? Promise.resolve(response(mockAssessment(request.messages, [], true))) : pending.promise);
  const hook = setup();
  await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.filter(([request]) => request.memoryEvaluation)).toHaveLength(2));
  expect(hook.result.current.runtime.loading).toBe(false);
  expect(hook.result.current.runtime.memoryWork).toMatchObject({ status: "running", group: "discovery", remaining: 1 });
  expect(hook.result.current.adventure!.messages.at(-1)).toMatchObject({ content: story,
    memoryEvaluation: { attempts: 1, completedGroups: ["plot", "storyCards", "brains"] } });
  expect(vi.mocked(saveAdventure).mock.calls.at(-1)![0].messages.at(-1)?.memoryEvaluation?.completedGroups).toEqual(["plot", "storyCards", "brains"]);
  await act(async () => { pending.resolve(response("[]")); });
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
  expect(provider).toHaveBeenCalledTimes(3);
});

it("builds the next prompt only after the existing worker commits and blocks duplicate submissions", async () => {
  const pending = deferred(); let evaluations = 0;
  provider.mockImplementation(request => request.memoryEvaluation && evaluations++ === 0 ? (assessmentMessages = request.messages, pending.promise)
    : Promise.resolve(response(request.memoryEvaluation ? mockAssessment(request.messages) : story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("First turn."); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  let next!: Promise<boolean>;
  await act(async () => { next = hook.result.current.runtime.submitTurn("Second turn."); });
  await act(async () => { await hook.result.current.runtime.submitTurn("Duplicate."); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  expect(provider).toHaveBeenCalledTimes(2);
  await act(async () => { pending.resolve(response()); await next; });
  expect(hook.result.current.adventure!.messages.map(message => message.content)).toEqual(["First turn.", story, "Second turn.", story]);
  await waitFor(() => expect(hook.result.current.adventure!.messages.filter(message => message.role === "assistant")
    .every(message => message.memoryEvaluation?.status === "complete")).toBe(true));
  expect(provider).toHaveBeenCalledTimes(4);
});

it("keeps failed memory advisory while explicit retry spends only one unfinished request", async () => {
  let fail = true;
  provider.mockImplementation(async request => response(request.memoryEvaluation ? fail ? "invalid" : mockAssessment(request.messages) : story));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).toBe("failed"));
  expect(hook.result.current.runtime.loading).toBe(false);
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledTimes(2); // One batch and narration; no paid repair or fallback.
  fail = false; await act(async () => { await hook.result.current.runtime.retryMemory(); });
  expect(provider).toHaveBeenCalledTimes(3);
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "complete", attempts: 2 });
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
});

it("allows successive turns after memory failures without a choice and retains unfinished sources", async () => {
  provider.mockImplementation(async request => response(request.memoryEvaluation ? "invalid" : story));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  const sourceId = hook.result.current.adventure!.messages.at(-1)!.id;
  await act(async () => { expect(await hook.result.current.runtime.submitTurn("I keep playing.")).toBe(true); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  expect(provider.mock.calls.filter(([request]) => !request.memoryEvaluation)).toHaveLength(2);
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.find(message => message.id === sourceId)?.memoryEvaluation?.status).toBe("quarantined");
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
});

it("retains an edit made during a paid evaluation, rejects the stale group and adds no automatic retry", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? (assessmentMessages = request.messages, pending.promise) : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  const id = hook.result.current.adventure!.messages.at(-1)!.id;
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "UPDATE_MESSAGE", messageId: id, content: "Mira left the gate." })));
  await act(async () => { pending.resolve(response()); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.at(-1)?.content).toBe("Mira left the gate.");
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("pending");
  expect(hook.result.current.adventure!.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "evaluation_stale" }));
  expect(hook.result.current.runtime.memoryWork?.status).toBe("failed");
  expect(provider).toHaveBeenCalledTimes(2);
});

it("keeps unrelated user edits made while evaluation waits", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? (assessmentMessages = request.messages, pending.promise) : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "SET_TITLE", title: "Edited title" })));
  await act(async () => { pending.resolve(response()); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.title).toBe("Edited title");
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(vi.mocked(saveAdventure).mock.calls.at(-1)![0].title).toBe("Edited title");
});

it("does not write an old result into a switched adventure or replay pending work when switched back", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? (assessmentMessages = request.messages, pending.promise) : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  const original = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
  const other = createDefaultAdventure("Other");
  act(() => hook.result.current.setAdventure(other));
  const savesBeforeFinish = vi.mocked(saveAdventure).mock.calls.length;
  await act(async () => { pending.resolve(response()); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.id).toBe(other.id);
  expect(hook.result.current.adventure!.messages).toHaveLength(0);
  expect(vi.mocked(saveAdventure).mock.calls).toHaveLength(savesBeforeFinish);
  act(() => hook.result.current.setAdventure(original));
  expect(provider).toHaveBeenCalledTimes(2);
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
});

it("shares an outstanding worker with manual evaluation instead of issuing duplicate calls", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? (assessmentMessages = request.messages, pending.promise) : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  let manual!: Promise<void>;
  await act(async () => { manual = hook.result.current.runtime.evaluateMemorySources([hook.result.current.adventure!.messages.at(-1)!.id]); });
  expect(provider).toHaveBeenCalledTimes(2);
  await act(async () => { pending.resolve(response()); await manual; });
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.attempts).toBe(1);
});

it("includes a committed automatic memory update in the next prompt without additional checks", async () => {
  const initial = createDefaultAdventure("Consistency");
  initial.components = [makeComponent({ id: "pressure", type: "activePressure", title: "Pressure", content: "A dormant threat." })];
  initial.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  initial.memoryAutoApprove.plotPressureUpdate = true;
  const validation = deferred(); let sourceIds: string[] = []; let checks = 0;
  provider.mockImplementation(async request => {
    const text = request.messages.map(message => message.content).join("\n");
    if (!request.memoryEvaluation) return response(story);
    if (isAssessment(request.messages)) return response(mockAssessment(request.messages, checks++ === 0 ? ["plotEssentialsPressure:pressure"] : []));
    if (text.includes("MEMORY UPDATE VALIDATION")) {
      sourceIds = JSON.parse(request.messages.at(-1)!.content).latestTurnMessageIds;
      return validation.promise;
    }
    if (text.includes("updating the Active Pressure")) return response("The council demands the signed charter.");
    return response("[]");
  });
  const hook = setup(initial, true); await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); await tickIdle(); });
  expect(hook.result.current.runtime.memoryWork?.status).toBe("running");
  await waitFor(() => expect(sourceIds.length).toBeGreaterThan(0));
  let next!: Promise<boolean>;
  await act(async () => { next = hook.result.current.runtime.submitTurn("I answer."); });
  expect(provider.mock.calls.filter(([request]) => !request.memoryEvaluation)).toHaveLength(1);
  await act(async () => { validation.resolve(response(JSON.stringify({ accepted: true, meaningfulChange: true,
    evidenceMessageIds: sourceIds, reason: "An established external obligation.", pressureChange: "changed_obligation" }))); await next; await tickIdle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  const narration = provider.mock.calls.filter(([request]) => !request.memoryEvaluation);
  expect(narration[1][0].messages.map(message => message.content).join("\n")).toContain("The council demands the signed charter.");
  expect(provider).toHaveBeenCalledTimes(6); // Two narration; assessment/generation/validation then one quiet assessment.
});

it("rejects a destination edited while validation is outstanding and retains the user's change", async () => {
  const initial = createDefaultAdventure("Destination edit");
  initial.components = [makeComponent({ id: "pressure", type: "activePressure", title: "Pressure", content: "A dormant threat." })];
  initial.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  initial.memoryAutoApprove.plotPressureUpdate = true;
  const validation = deferred(); let sourceIds: string[] = [];
  provider.mockImplementation(async request => {
    const text = request.messages.map(message => message.content).join("\n");
    if (!request.memoryEvaluation) return response(story);
    if (isAssessment(request.messages)) return response(mockAssessment(request.messages, ["plotEssentialsPressure:pressure"]));
    if (text.includes("MEMORY UPDATE VALIDATION")) {
      sourceIds = JSON.parse(request.messages.at(-1)!.content).latestTurnMessageIds; return validation.promise;
    }
    return response("The council demands the signed charter.");
  });
  const hook = setup(initial, true); await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(sourceIds.length).toBeGreaterThan(0));
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, {
    type: "UPDATE_COMPONENT", componentId: "pressure", patch: { content: "The player corrected the threat." },
  })));
  await act(async () => { validation.resolve(response(JSON.stringify({ accepted: true, meaningfulChange: true,
    evidenceMessageIds: sourceIds, reason: "An established obligation.", pressureChange: "changed_obligation" }))); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.components[0].content).toBe("The player corrected the threat.");
  expect(hook.result.current.adventure!.activeState.memoryProposals).toHaveLength(0);
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("pending");
  expect(hook.result.current.runtime.memoryWork?.status).toBe("failed");
  expect(provider).toHaveBeenCalledTimes(4); // Stops before discovery; no immediate reevaluation.
});


it("opens and reopens a save with the reported historical failure counts without requests, notices or redirects", async () => {
  const saved = createDefaultAdventure("Historical retry regression");
  saved.activeState.turn = 192; saved.activeState.memoryRecoveryStoryTurn = 175;
  const statuses = [...Array(24).fill("quarantined"), "running", "failed", "failed"] as const;
  saved.messages = statuses.map((status, index) => ({ id: "old-source-" + index, role: "assistant", content: "An earlier saved exchange.", createdAt: "2026-01-01",
    memoryEvaluation: { turn: index + 1, status, attempts: status === "running" ? 6 : 3,
      completedGroups: ["plot", "storyCards"], lastError: "memory_model_output_invalid: Placement verdict is missing or malformed." } }));
  let hook = setup(saved); await act(async () => {});
  expect(provider).not.toHaveBeenCalled(); expect(hook.result.current.runtime.memoryWork).toBeUndefined();
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
  await act(async () => { expect(await hook.result.current.runtime.submitTurn("A new turn.")).toBe(true); await tickIdle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledTimes(2); // One narration and one new-source discovery; no historical replay.
  expect(hook.result.current.adventure!.messages.slice(0, statuses.length)).toEqual(saved.messages);
  const reopened = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure))); hook.unmount(); provider.mockClear();
  hook = setup(reopened); await act(async () => {});
  expect(provider).not.toHaveBeenCalled(); expect(hook.result.current.runtime.memoryWork).toBeUndefined();
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
});

it("continues a queued submission after an incomplete batch without paid repair", async () => {
  const pending = deferred(); let first = true;
  provider.mockImplementation(request => request.memoryEvaluation && first ? (first = false, assessmentMessages = request.messages, pending.promise)
    : Promise.resolve(response(request.memoryEvaluation ? mockAssessment(request.messages.some(m => m.content.includes("ASSESSMENT BATCH FORMAT REPAIR")) ? assessmentMessages : request.messages) : story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("First turn."); await tickIdle(); });
  await waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
  let next!: Promise<boolean>; await act(async () => { next = hook.result.current.runtime.submitTurn("Second turn."); });
  await act(async () => { pending.resolve(response("malformed")); expect(await next).toBe(true); await tickIdle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.map(message => message.content)).toEqual(["First turn.", story, "Second turn.", story]);
  expect(hook.result.current.adventure!.messages[1].memoryEvaluation).toMatchObject({ status: "quarantined", attempts: 1 });
  expect(provider.mock.calls.filter(([r]) => r.messages.some(m => m.content.includes("ASSESSMENT BATCH FORMAT REPAIR")))).toHaveLength(0);
  expect(provider).toHaveBeenCalledTimes(4); // Two narration and two assessments; no repair.
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
});

function brainWorkerSeed() {
  const a = createDefaultAdventure("Batch worker"); a.components = []; a.storyCards = [];
  a.brains = [makeBrain({ id: "mira", characterName: "Mira", active: true })];
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = true;
  return a;
}
function mockBrainWorker(waiting?: ReturnType<typeof deferred>) {
  provider.mockImplementation(async request => {
    if (!request.memoryEvaluation) return response(story);
    if (isAssessment(request.messages)) return response(mockAssessment(request.messages, ["brain:mira"]));
    if (request.messages.some(m => m.content.includes("MEMORY UPDATE VALIDATION"))) {
      if (waiting) return waiting.promise;
      const body = JSON.parse(request.messages.at(-1)!.content);
      return response(JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
        evidenceMessageIds: body.latestTurnMessageIds, reason: "Supported original sources" }));
    }
    return response('{"thoughts":{"research_agreement":"I will check the research agreement myself."}}');
  });
}
async function workerTurn(hook: ReturnType<typeof setup>) {
  await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
}
it("batches through startIndependentMemory and resumes a saved buffer after runtime reload", async () => {
  mockBrainWorker();
  let hook = setup(brainWorkerSeed());
  await workerTurn(hook);
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toHaveLength(1);
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
  expect(vi.mocked(saveAdventure).mock.calls.at(-1)![0].activeState.pendingBrainDeltas).toHaveLength(1);
  hook.unmount(); provider.mockClear(); hook = setup(saved);
  await act(async () => {}); expect(provider).not.toHaveBeenCalled();
  await workerTurn(hook); await workerTurn(hook);
  const memory = provider.mock.calls.filter(([r]) => r.memoryEvaluation);
  expect(memory.filter(([r]) => isAssessment(r.messages))).toHaveLength(2);
  expect(memory.filter(([r]) => r.config.memoryRequest?.stage === "generation")).toHaveLength(1);
  expect(memory.filter(([r]) => r.config.memoryRequest?.stage === "validation")).toHaveLength(1);
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual([]);
  expect(hook.result.current.adventure!.activeState.memoryProposals.filter(p => p.proposedType === "brainUpdate")).toHaveLength(1);
});
it("does not consume pending deltas when the worker stops during validation", async () => {
  mockBrainWorker(); const hook = setup(brainWorkerSeed());
  await workerTurn(hook); await workerTurn(hook);
  const pending = deferred(); mockBrainWorker(pending);
  await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([r]) => r.config.memoryRequest?.stage === "validation")).toBe(true));
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
  expect(saved.activeState.pendingBrainDeltas).toHaveLength(2);
  act(() => hook.result.current.setAdventure(createDefaultAdventure("Switched")));
  await act(async () => { pending.resolve(response(JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
    evidenceMessageIds: saved.activeState.pendingBrainDeltas!.map(d => d.sourceId), reason: "Supported" }))); });
  act(() => hook.result.current.setAdventure(saved));
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual(saved.activeState.pendingBrainDeltas);
  expect(hook.result.current.adventure!.activeState.memoryProposals).toEqual([]);
});
it("keeps manual historical recovery separate from a later automatic buffer", async () => {
  mockBrainWorker(); const initial = brainWorkerSeed();
  initial.messages = [{ id: "historical", role: "assistant", content: "Mira learned the ward key.", createdAt: "2026-01-01",
    memoryEvaluation: { turn: 0, attempts: 3, completedGroups: [], status: "quarantined" } }];
  const hook = setup(initial); await workerTurn(hook);
  const queued = hook.result.current.adventure!.activeState.pendingBrainDeltas;
  provider.mockClear();
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources(["historical"]); });
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual(queued);
  const generated = provider.mock.calls.find(([r]) => r.config.memoryRequest?.stage === "generation")![0];
  expect(JSON.stringify(generated.messages)).not.toContain("Bounded Brain batch:");
  expect(hook.result.current.adventure!.activeState.memoryProposals.find(p => p.proposedType === "brainUpdate")?.sourceTurnId).toBe("historical");
});

it.each(["edit", "delete", "deleteLast", "removeAssistant"] as const)("repairs the Brain buffer through runtime %s, undo, redo and reload without requests", async operation => {
  mockBrainWorker(); let hook = setup(brainWorkerSeed());
  await workerTurn(hook); await workerTurn(hook);
  const original = hook.result.current.adventure!;
  const id = original.messages.at(-1)!.id;
  const survivor = original.activeState.pendingBrainDeltas![0];
  provider.mockClear();
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, operation === "edit"
    ? { type: "UPDATE_MESSAGE", messageId: id, content: "Mira departed." }
    : operation === "delete" ? { type: "DELETE_MESSAGE", messageId: id }
    : { type: operation === "deleteLast" ? "DELETE_LAST_MESSAGE" : "REMOVE_LAST_ASSISTANT_MESSAGE" })));
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual([survivor]);
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "UNDO_STORY_EDIT" })));
  expect(hook.result.current.adventure!.messages.at(-1)?.content).toBe(original.messages.at(-1)!.content);
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual([survivor]);
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "REDO_STORY_EDIT" })));
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual([survivor]);
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
  hook.unmount(); hook = setup(saved); await act(async () => {});
  expect(hook.result.current.adventure!.activeState.pendingBrainDeltas).toEqual([survivor]);
  expect(provider).not.toHaveBeenCalled();
});
it("rejects a generated Brain patch if establishing evidence is edited while generation is pending", async () => {
  mockBrainWorker(); const hook = setup(brainWorkerSeed());
  await workerTurn(hook); await workerTurn(hook);
  const prior = hook.result.current.adventure!;
  const pending = deferred(); const original = provider.getMockImplementation()!;
  provider.mockImplementation(r => r.config.memoryRequest?.stage === "generation" ? pending.promise : original(r));
  await act(async () => { await hook.result.current.runtime.continueTurn(); await tickIdle(); });
  await waitFor(() => expect(provider.mock.calls.some(([r]) => r.config.memoryRequest?.stage === "generation")).toBe(true));
  const editedId = prior.messages[0].id;
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "UPDATE_MESSAGE", messageId: editedId, content: "Mira never learned the key." })));
  await act(async () => { pending.resolve(response('{"thoughts":{"stale":"I learned the key."}}')); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  const current = hook.result.current.adventure!;
  expect(current.brains[0].thoughts).toEqual(prior.brains[0].thoughts);
  expect(current.activeState.memoryProposals).toEqual([]);
  expect(current.activeState.pendingBrainDeltas?.some(d => d.sourceId === editedId)).toBe(false);
  expect(provider.mock.calls.filter(([r]) => isAssessment(r.messages))).toHaveLength(3);
  expect(provider.mock.calls.filter(([r]) => r.config.memoryRequest?.stage === "generation")).toHaveLength(1);
});

// These scheduler tests use the production deadline with a controlled clock.
function controlledBatchClock() {
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}
async function settleWorker(hook: ReturnType<typeof setup>) {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await tickIdle(); });
    if (hook.result.current.runtime.memoryWork?.status !== "running") return;
  }
  throw new Error("Memory worker did not settle");
}
it("three narrator turns start exactly one assessment batch and count its usage once", async () => {
  controlledBatchClock();
  provider.mockImplementation(async r => ({ content: r.memoryEvaluation ? mockAssessment(r.messages) : story, raw: {},
    usage: { promptTokens: 17, completionTokens: 9, totalTokens: 26 } }));
  const hook = setup();
  for (let i = 0; i < 3; i++) {
    await act(async () => { await hook.result.current.runtime.continueTurn(); });
    if (i < 2) expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  }
  await settleWorker(hook);
  const calls = provider.mock.calls.filter(([r]) => r.memoryEvaluation);
  expect(calls).toHaveLength(1);
  expect(calls[0][0].config.memoryRequest).toMatchObject({ batchSourceIds: hook.result.current.adventure!.messages.map(m => m.id), stage: "assessment", attempt: 1 });
  expect(hook.result.current.adventure!.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true);
  expect(hook.result.current.adventure!.activeState.backgroundTokenUsage).toEqual({ promptTokens: 17, completionTokens: 9 });
});
it("a new narrator resets the idle deadline and two queued sources flush together", async () => {
  controlledBatchClock(); const hook = setup();
  await act(async () => { await hook.result.current.runtime.continueTurn(); await vi.advanceTimersByTimeAsync(100_000); });
  await act(async () => { await hook.result.current.runtime.continueTurn(); await vi.advanceTimersByTimeAsync(20_000); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(99_999); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
  expect(hook.result.current.adventure!.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true);
});
it("manual selection starts immediately and leaves an unrelated pending source queued", async () => {
  controlledBatchClock(); const hook = setup();
  await act(async () => { await hook.result.current.runtime.continueTurn(); await hook.result.current.runtime.continueTurn(); });
  const ids = hook.result.current.adventure!.messages.map(m => m.id);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources([ids[0]]); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
  expect(provider.mock.calls.find(([r]) => r.memoryEvaluation)![0].config.memoryRequest?.batchSourceIds).toBeUndefined();
  expect(hook.result.current.adventure!.messages[1].memoryEvaluation).toMatchObject({ status: "pending", attempts: 0 });
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); }); await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(2);
});
it("adventure changes cancel idle timers and reload retains tracked queued work only", async () => {
  controlledBatchClock(); let hook = setup();
  await act(async () => { await hook.result.current.runtime.continueTurn(); });
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
  act(() => hook.result.current.setAdventure(createDefaultAdventure("Other")));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  hook.unmount(); saved.messages.unshift({ id: "untracked", role: "assistant", content: "Old historical narration.", createdAt: "2026-01-01" });
  hook = setup(saved); await act(async () => { await vi.advanceTimersByTimeAsync(120_000); }); await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
  expect(hook.result.current.adventure!.messages[0].memoryEvaluation).toBeUndefined();
});
it("batch transport failure retains all three sources for backoff without individual fan-out", async () => {
  controlledBatchClock();
  provider.mockImplementation(async r => { if (r.memoryEvaluation) throw Error("Disconnected"); return response(story); });
  const hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
  expect(hook.result.current.adventure!.messages.every(m => m.memoryEvaluation?.status === "failed" && m.memoryEvaluation.attempts === 1)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
});
it("hidden pages cancel the deadline and start a new one when visible", async () => {
  controlledBatchClock(); const hook = setup();
  await act(async () => { await hook.result.current.runtime.continueTurn(); });
  const visibility = vi.spyOn(document, "visibilityState", "get"); visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  visibility.mockReturnValue("visible"); act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => { await vi.advanceTimersByTimeAsync(119_999); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
});

it("a story edit during a three-source HTTP batch blocks stale sibling commits", async () => {
  controlledBatchClock(); const pending = deferred();
  provider.mockImplementation(r => r.memoryEvaluation ? (assessmentMessages = r.messages, pending.promise) : Promise.resolve(response(story)));
  const hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); });
  // Wait for asynchronous input fingerprints before editing the in-flight request.
  for (let i = 0; i < 20 && !provider.mock.calls.some(([r]) => r.memoryEvaluation); i++) await act(async () => { await tickIdle(); });
  const id = hook.result.current.adventure!.messages[1].id;
  act(() => hook.result.current.setAdventure(a => adventureReducer(a!, { type: "UPDATE_MESSAGE", messageId: id, content: "Corrected narrator event." })));
  await act(async () => { pending.resolve(response()); }); await settleWorker(hook);
  const sources = hook.result.current.adventure!.messages;
  expect(sources[0].memoryEvaluation?.status).toBe("complete");
  expect(sources[1].memoryEvaluation?.assessment).toBeUndefined();
  expect(sources[2].memoryEvaluation?.assessment).toBeUndefined();
  expect(sources[1].memoryEvaluation?.completedGroups).toEqual([]);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
});
it("an active narration request suspends the idle timer until its successful narrator is saved", async () => {
  controlledBatchClock(); const hook = setup();
  await act(async () => { await hook.result.current.runtime.continueTurn(); });
  const narration = deferred(); provider.mockImplementation(r => r.memoryEvaluation ? Promise.resolve(response(mockAssessment(r.messages))) : narration.promise);
  let turn!: Promise<void>;
  await act(async () => { turn = hook.result.current.runtime.continueTurn(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(0);
  await act(async () => { narration.resolve(response(story)); await turn; });
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); }); await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
});

it("an incomplete batch does not request repair or individual fallback", async () => {
  controlledBatchClock();
  provider.mockImplementation(async r => {
    if (!r.memoryEvaluation) return response(story);
    if (isAssessment(r.messages)) return response('{"sources":[]}');
    throw Error("Disconnected during compact repair");
  });
  const hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await settleWorker(hook);
  expect(provider.mock.calls.filter(([r]) => r.memoryEvaluation)).toHaveLength(1);
  expect(hook.result.current.adventure!.messages.every(m => m.memoryEvaluation?.status === "quarantined" && m.memoryEvaluation.attempts === 1)).toBe(true);
});
