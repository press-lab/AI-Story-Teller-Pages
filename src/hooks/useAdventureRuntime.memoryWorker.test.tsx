/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure, makeComponent } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import type { Adventure } from "../types/adventure";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { saveAdventure } from "../db/adventureDb";
import { useAdventureRuntime } from "./useAdventureRuntime";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", async original => ({ ...await original<typeof import("../providers/openAICompatible")>(), sendOpenAICompatibleChatCompletion: vi.fn() }));
const provider = vi.mocked(sendOpenAICompatibleChatCompletion);
const story = "Mira waits beside the gate.";
function response(content = "[]") { return { content, raw: {} }; }
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
beforeEach(() => { vi.clearAllMocks(); provider.mockReset();
  provider.mockImplementation(async request => response(request.memoryEvaluation ? "[]" : story)); });
afterEach(cleanup);

it("releases narration loading while discovery waits and persists earlier groups before the outstanding request", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? pending.promise : Promise.resolve(response(story)));
  const hook = setup();
  await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  expect(hook.result.current.runtime.loading).toBe(false);
  expect(hook.result.current.runtime.memoryWork).toMatchObject({ status: "running", group: "discovery", remaining: 1 });
  expect(hook.result.current.adventure!.messages.at(-1)).toMatchObject({ content: story,
    memoryEvaluation: { attempts: 1, completedGroups: ["plot", "storyCards", "brains"] } });
  expect(vi.mocked(saveAdventure).mock.calls.at(-1)![0].messages.at(-1)?.memoryEvaluation?.completedGroups).toEqual(["plot", "storyCards", "brains"]);
  await act(async () => { pending.resolve(response()); });
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
  expect(provider).toHaveBeenCalledTimes(2);
});

it("builds the next prompt only after the existing worker commits and blocks duplicate submissions", async () => {
  const pending = deferred(); let evaluations = 0;
  provider.mockImplementation(request => request.memoryEvaluation && evaluations++ === 0 ? pending.promise
    : Promise.resolve(response(request.memoryEvaluation ? "[]" : story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("First turn."); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  let next!: Promise<boolean>;
  await act(async () => { next = hook.result.current.runtime.submitTurn("Second turn."); });
  await act(async () => { await hook.result.current.runtime.submitTurn("Duplicate."); });
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
  provider.mockImplementation(async request => response(request.memoryEvaluation ? fail ? "invalid" : "[]" : story));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).toBe("failed"));
  expect(hook.result.current.runtime.loading).toBe(false);
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledTimes(2);
  fail = false; await act(async () => { await hook.result.current.runtime.retryMemory(); });
  expect(provider).toHaveBeenCalledTimes(3);
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation).toMatchObject({ status: "complete", attempts: 2 });
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
});

it("allows successive turns after memory failures without a choice and retains unfinished sources", async () => {
  provider.mockImplementation(async request => response(request.memoryEvaluation ? "invalid" : story));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  const sourceId = hook.result.current.adventure!.messages.at(-1)!.id;
  await act(async () => { expect(await hook.result.current.runtime.submitTurn("I keep playing.")).toBe(true); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  expect(provider.mock.calls.filter(([request]) => !request.memoryEvaluation)).toHaveLength(2);
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.find(message => message.id === sourceId)?.memoryEvaluation?.status).toBe("failed");
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
});

it("retains an edit made during a paid evaluation, rejects the stale group and adds no automatic retry", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? pending.promise : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  const id = hook.result.current.adventure!.messages.at(-1)!.id;
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "UPDATE_MESSAGE", messageId: id, content: "Mira left the gate." })));
  await act(async () => { pending.resolve(response()); });
  expect(hook.result.current.adventure!.messages.at(-1)?.content).toBe("Mira left the gate.");
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("pending");
  expect(hook.result.current.adventure!.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "evaluation_stale" }));
  expect(hook.result.current.runtime.memoryWork?.status).toBe("failed");
  expect(provider).toHaveBeenCalledTimes(2);
});

it("keeps unrelated user edits made while evaluation waits", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? pending.promise : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, { type: "SET_TITLE", title: "Edited title" })));
  await act(async () => { pending.resolve(response()); });
  expect(hook.result.current.adventure!.title).toBe("Edited title");
  expect(hook.result.current.adventure!.messages.at(-1)?.memoryEvaluation?.status).toBe("complete");
  expect(vi.mocked(saveAdventure).mock.calls.at(-1)![0].title).toBe("Edited title");
});

it("does not write an old result into a switched adventure or replay pending work when switched back", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? pending.promise : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  await waitFor(() => expect(provider.mock.calls.some(([request]) => request.memoryEvaluation)).toBe(true));
  const original = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)));
  const other = createDefaultAdventure("Other");
  act(() => hook.result.current.setAdventure(other));
  const savesBeforeFinish = vi.mocked(saveAdventure).mock.calls.length;
  await act(async () => { pending.resolve(response()); });
  expect(hook.result.current.adventure!.id).toBe(other.id);
  expect(hook.result.current.adventure!.messages).toHaveLength(0);
  expect(vi.mocked(saveAdventure).mock.calls).toHaveLength(savesBeforeFinish);
  act(() => hook.result.current.setAdventure(original));
  expect(provider).toHaveBeenCalledTimes(2);
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
});

it("shares an outstanding worker with manual evaluation instead of issuing duplicate calls", async () => {
  const pending = deferred();
  provider.mockImplementation(request => request.memoryEvaluation ? pending.promise : Promise.resolve(response(story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.continueTurn(); });
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
    if (text.includes("evaluation engine")) return response(checks++ === 0 ? '["plotEssentialsPressure:pressure"]' : "[]");
    if (text.includes("MEMORY UPDATE VALIDATION")) {
      sourceIds = JSON.parse(request.messages.at(-1)!.content).latestTurnMessageIds;
      return validation.promise;
    }
    if (text.includes("updating the Active Pressure")) return response("The council demands the signed charter.");
    return response();
  });
  const hook = setup(initial, true); await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  expect(hook.result.current.runtime.memoryWork?.status).toBe("running");
  let next!: Promise<boolean>;
  await act(async () => { next = hook.result.current.runtime.submitTurn("I answer."); });
  expect(provider.mock.calls.filter(([request]) => !request.memoryEvaluation)).toHaveLength(1);
  await act(async () => { validation.resolve(response(JSON.stringify({ accepted: true, meaningfulChange: true,
    evidenceMessageIds: sourceIds, reason: "An established external obligation.", pressureChange: "changed_obligation" }))); await next; });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  const narration = provider.mock.calls.filter(([request]) => !request.memoryEvaluation);
  expect(narration[1][0].messages.map(message => message.content).join("\n")).toContain("The council demands the signed charter.");
  expect(provider).toHaveBeenCalledTimes(8); // Two narration; four first-turn memory calls; two second-turn checks.
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
    if (text.includes("evaluation engine")) return response('["plotEssentialsPressure:pressure"]');
    if (text.includes("MEMORY UPDATE VALIDATION")) {
      sourceIds = JSON.parse(request.messages.at(-1)!.content).latestTurnMessageIds; return validation.promise;
    }
    return response("The council demands the signed charter.");
  });
  const hook = setup(initial, true); await act(async () => { await hook.result.current.runtime.continueTurn(); });
  act(() => hook.result.current.setAdventure(current => adventureReducer(current!, {
    type: "UPDATE_COMPONENT", componentId: "pressure", patch: { content: "The player corrected the threat." },
  })));
  await act(async () => { validation.resolve(response(JSON.stringify({ accepted: true, meaningfulChange: true,
    evidenceMessageIds: sourceIds, reason: "An established obligation.", pressureChange: "changed_obligation" }))); });
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
  await act(async () => { expect(await hook.result.current.runtime.submitTurn("A new turn.")).toBe(true); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledTimes(2); // One narration and one new-source discovery; no historical replay.
  expect(hook.result.current.adventure!.messages.slice(0, statuses.length)).toEqual(saved.messages);
  const reopened = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure))); hook.unmount(); provider.mockClear();
  hook = setup(reopened); await act(async () => {});
  expect(provider).not.toHaveBeenCalled(); expect(hook.result.current.runtime.memoryWork).toBeUndefined();
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
});

it("continues a queued submission after a worker failure with unchanged bounded-retry accounting", async () => {
  const pending = deferred(); let first = true;
  provider.mockImplementation(request => request.memoryEvaluation && first ? (first = false, pending.promise)
    : Promise.resolve(response(request.memoryEvaluation ? "[]" : story)));
  const hook = setup(); await act(async () => { await hook.result.current.runtime.submitTurn("First turn."); });
  await waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
  let next!: Promise<boolean>; await act(async () => { next = hook.result.current.runtime.submitTurn("Second turn."); });
  await act(async () => { pending.resolve(response("malformed")); expect(await next).toBe(true); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).not.toBe("running"));
  expect(hook.result.current.adventure!.messages.map(message => message.content)).toEqual(["First turn.", story, "Second turn.", story]);
  expect(hook.result.current.adventure!.messages[1].memoryEvaluation).toMatchObject({ status: "complete", attempts: 2 });
  expect(hook.result.current.adventure!.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ outcome: "evaluation_failed", group: "discovery" }));
  expect(provider).toHaveBeenCalledTimes(5); // Existing one-group backoff retry plus the new source; no completed-group replay.
  expect(hook.result.current.openTab).not.toHaveBeenCalled();
});
