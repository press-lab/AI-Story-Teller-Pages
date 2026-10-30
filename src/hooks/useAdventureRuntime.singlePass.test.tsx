/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure, makeStoryCard } from "../state/defaults";
import type { Adventure } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import * as semantic from "../triggers/semanticEngine";
import * as assessment from "../memory/memoryAssessment";
import * as discovery from "../memory/memoryDetection";
import * as review from "../memory/validateMemoryUpdate";
import * as cardReview from "../memory/validateStoryCardProposal";
vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
const nativeTimeout = globalThis.setTimeout;
const settle = () => new Promise<void>(resolve => nativeTimeout(resolve, 30));
afterEach(() => { debugLogging.MEMORY_DEBUG_LOGGING = true; cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup(initial = createDefaultAdventure()) {
  initial.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://example.test/v1", model: "evaluator", memoryReasoningControl: "omit" };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    return { adventure, runtime: useAdventureRuntime(adventure, setAdventure,
      { ...defaultModelConfig, model: "narrator", baseUrl: "https://example.test/v1", apiKey: "offline" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined,
      { pipeline: "singlePass", enabled: true, everyNTurns: 1, generateContent: true }) };
  });
}
describe.each(["json", "commands"].flatMap(format => [false, true].map(enabled => ({ format, enabled }))))("runtime $format logging $enabled response compatibility", ({ format, enabled }) => {
beforeEach(() => { debugLogging.MEMORY_DEBUG_LOGGING = enabled; });
function mockHttp(mode = "empty") {
  let memoryCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const memory = body.model === "evaluator";
    let content = mode === "siblings" ? "Mira marked the gate as a sanctuary." : "Mira waits beside the gate.";
    if (memory) {
      memoryCalls++;
      if (mode === "timeout") throw new Error("network");
      const payload = JSON.parse(body.messages.at(-1).content);
      const ids = payload.sources.map((s: { sourceId: string }) => s.sourceId);
      content = mode === "invalid" ? "{" : JSON.stringify({ sources: (mode === "missing" ? ids.slice(1) : ids).map((sourceId: string) => ({ sourceId, findings: [] })) });
      if (format === "commands") content = mode === "invalid" ? "MEM invalid" : Object.keys(payload.outputAliases).slice(mode === "missing" ? 1 : 0).map(s => `DONE ${s}`).join("\n");
      if (mode === "siblings") {
        const sourceId = ids.at(-1);
        const source = Object.entries(payload.outputAliases).find(([, v]) => (v as { sourceId: string }).sourceId === sourceId)!;
        const manifest = source[1] as { evidence: Record<string, { id: string }> };
        const e = Object.entries(manifest.evidence).find(([, v]) => v.id === sourceId)![0];
        const finding = { kind: "storyCard", targetId: null, title: "Gate sanctuary", content: "Mira marked the gate as a sanctuary.", evidenceQuotes: [{ messageId: sourceId, quote: "Mira marked the gate as a sanctuary." }] };
        content = format === "json" ? JSON.stringify({ sources: ids.map((id: string) => ({ sourceId: id, findings: id === sourceId ? [finding, {}] : [] })) })
          : `MEM ${source[0]} storyCard NEW\nTITLE Gate sanctuary\nE ${e} | Mira marked the gate as a sanctuary.\nTEXT\nMira marked the gate as a sanctuary.\nEND\nMEM ${source[0]} brain INVALID\nE ${e} | Mira marked the gate as a sanctuary.\nFIELD thought\nTEXT\nI suspect a secret.\nEND\n${content}`;
      }
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
  });
  return () => memoryCalls;
}
it("three sources use one HTTP request and no legacy discovery, generation or paid review", async () => {
  const forbidden = [vi.spyOn(semantic, "runMemoryCycle"), vi.spyOn(assessment, "assessMemoryBatch"), vi.spyOn(assessment, "assessMemory"),
    vi.spyOn(discovery, "detectStoryCardProposals"), vi.spyOn(review, "validateMemoryUpdate"), vi.spyOn(cardReview, "validateStoryCardProposal")];
  const calls = mockHttp(); const hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.submitTurn("I wait."); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.messages.filter(m => m.role === "assistant").every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
  expect(calls()).toBe(1);
  for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
  const records = hook.result.current.adventure!.activeState.apiCalls!;
  expect(records.filter(c => c.memoryRequest?.stage === "singlePass")).toHaveLength(1);
  expect(records.filter(c => c.purpose === "narration")).toHaveLength(3);
});
it.each([1, 2])("idle flush uses one request for %i sources", async count => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const calls = mockHttp(); const hook = setup();
  for (let i = 0; i < count; i++) await act(async () => { await hook.result.current.runtime.submitTurn("I wait."); });
  expect(calls()).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); await settle(); });
  vi.useRealTimers();
  await waitFor(() => expect(calls()).toBe(1));
});
it.each(["invalid", "missing", "timeout"])("does not retry %s on later turns or reopen; explicit Retry uses one new request", async mode => {
  const calls = mockHttp(mode); let hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  await waitFor(() => expect(hook.result.current.runtime.memoryWork?.status).toBe("failed"));
  expect(calls()).toBe(1);
  const failedId = hook.result.current.adventure!.messages.find(m => m.memoryEvaluation?.status === "failed")!.id;
  await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  expect(calls()).toBe(1);
  const saved = normalizeAdventure(JSON.parse(JSON.stringify(hook.result.current.adventure)) as Adventure);
  hook.unmount(); hook = setup(saved);
  await act(async () => { await settle(); }); expect(calls()).toBe(1);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources([failedId]); await settle(); });
  expect(calls()).toBe(2);
});
it("opening pending historical legacy or marked single-pass sources starts no request", async () => {
  const calls = mockHttp(); const a = createDefaultAdventure();
  a.messages = ["legacy", "singlePass"].map((id, i) => ({ id, role: "assistant", content: "Mira waits.", createdAt: "2000-01-01", memoryEvaluation: { pipeline: i ? "singlePass" : undefined, turn: 1, attempts: 0, status: "pending", completedGroups: [] } }));
  setup(a); await act(async () => { await settle(); }); expect(calls()).toBe(0);
});

it("retains valid siblings in the existing Memory Inbox without paid repair", async () => {
  const calls = mockHttp("siblings"); const hook = setup();
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.messages.filter(m => m.role === "assistant").every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
  const dispositions = hook.result.current.adventure!.messages.filter(m => m.role === "assistant").at(-1)!.memoryEvaluation!.singlePass!.dispositions;
  if (enabled) expect(dispositions).toContainEqual(expect.objectContaining({ status: "rejected", reason: expect.any(String) }));
  else expect(dispositions).toEqual([]);
  expect(calls()).toBe(1);
  expect(hook.result.current.adventure!.activeState.memoryProposals).toContainEqual(expect.objectContaining({ title: "Gate sanctuary", status: "pending" }));
  await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  expect(calls()).toBe(1);
});
});

it("explicitly retries the three October 27 sources in one HTTP request and preserves pending proposals", async () => {
  const fixture = (await import("../memory/fixtures/memory-failure-20261027.json")).default;
  const a = createDefaultAdventure();
  a.memoryDetectionSettings.pipeline = "singlePass";
  a.memoryAutoApprove.storyCard = true;
  a.storyCards = [
    makeStoryCard({ ...fixture.existingLoreTarget, type: "lore", content: "The products have four designs.", keys: ["production", "supply", "tattoo paper"] }),
    makeStoryCard({ id: "twins", title: "Fred and George", type: "character", content: "The twins are students." }),
  ];
  a.messages = fixture.cases.flatMap((c, index) => [
    { ...c.precedingPlayer, role: "user" as const, createdAt: "2026-10-27T00:00:00Z", inputMode: "story" as const },
    { id: c.narratorSourceId, content: c.narratorContent, role: "assistant" as const, createdAt: "2026-10-27T00:00:01Z", inputMode: "story" as const,
      memoryEvaluation: { pipeline: "singlePass" as const, status: "failed" as const, attempts: 1, turn: index + 1, revision: "original", completedGroups: [] } },
  ]);
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const payload = JSON.parse(body.messages.at(-1).content);
    const commands = Object.entries(payload.outputAliases).map(([sourceAlias, value], index) => {
      const manifest = value as { sourceId: string; cards: Record<string, { id: string }>; evidence: Record<string, { id: string }> };
      const c = fixture.cases.find(c => c.narratorSourceId === manifest.sourceId)!;
      const target = Object.entries(manifest.cards).find(([, v]) => v.id === (index === 1 ? "twins" : fixture.existingLoreTarget.id))![0];
      const content = c.originalModelFindings[0]?.content ?? "Fred and George discussed production testing, product designs, and a paper shortage explanation for higher prices.";
      const evidence = Object.entries(manifest.evidence).filter(([, e]) => [c.narratorSourceId, c.precedingPlayer.id].includes(e.id)).map(([alias]) => "E " + alias).join("\n");
      return "MEM " + sourceAlias + " storyCard " + target + "\nTITLE " + (index === 1 ? "Production testing and paper shortage" : fixture.existingLoreTarget.title)
        + "\n" + evidence + "\nTEXT\n" + content + "\nEND\nDONE " + sourceAlias;
    }).join("\n");
    return new Response(JSON.stringify({ choices: [{ message: { content: commands } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
  });
  const hook = setup(a);
  await act(async () => { await settle(); });
  expect(fetch).not.toHaveBeenCalled();
  const ids = fixture.cases.map(c => c.narratorSourceId);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources(ids); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.messages.filter(m => ids.includes(m.id)).every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
  const saved = hook.result.current.adventure!;
  expect(saved.storyCards).toEqual(a.storyCards);
  expect(saved.activeState.memoryProposals.filter(p => ids.includes(p.sourceTurnId!))).toHaveLength(3);
  expect(saved.activeState.memoryProposals.every(p => p.status === "pending" && p.requiresReview)).toBe(true);
  expect(saved.activeState.memoryProposals.find(p => p.sourceTurnId === ids[2])!.content).toBe(fixture.cases[2].originalModelFindings[0].content);
  expect(saved.messages.filter(m => ids.includes(m.id)).every(m => m.memoryEvaluation?.singlePass?.dispositions.some(d => d.index === 0))).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources(ids); await settle(); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("delivers all six loose operations to the Memory Inbox with one HTTP extraction and no paid repair", async () => {
  const { looseMemoryFixture, looseResponse, looseNarrations } = await import("../test/looseMemory");
  const { expectSixLooseProposals } = await import("../test/looseMemoryAssertions");
  const { a } = looseMemoryFixture(false);
  const originalCards = structuredClone(a.storyCards), originalBrains = structuredClone(a.brains), originalComponents = structuredClone(a.components);
  const forbidden = [vi.spyOn(semantic, "runMemoryCycle"), vi.spyOn(assessment, "assessMemoryBatch"), vi.spyOn(assessment, "assessMemory"),
    vi.spyOn(discovery, "detectStoryCardProposals"), vi.spyOn(review, "validateMemoryUpdate"), vi.spyOn(cardReview, "validateStoryCardProposal")];
  let memoryCalls = 0, narrationCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const memory = body.model === "evaluator";
    const content = memory ? (++memoryCalls, looseResponse) : looseNarrations[narrationCalls++];
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  });
  const hook = setup(a);
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.activeState.memoryProposals).toHaveLength(6));
  const saved = hook.result.current.adventure!;
  const ids = saved.messages.filter(m => m.role === "assistant").map(m => m.id);
  expectSixLooseProposals(saved, ids);
  expect(saved.storyCards.find(c => c.id === "business")?.content).toContain("96 rune tattoos");
  expect(saved.storyCards.filter(c => c.id !== "business" && originalCards.some(old => old.id === c.id))).toEqual(originalCards.filter(c => c.id !== "business")); expect(saved.brains.filter(b => b.id !== "brain-george")).toEqual(originalBrains.filter(b => b.id !== "brain-george"));
  expect(Object.values(saved.brains.find(b => b.id === "brain-george")!.thoughts)).toEqual([expect.stringContaining("I believe the business can grow beyond individual customers.")]); expect(saved.components).toEqual(originalComponents);
  expect(memoryCalls).toBe(1); expect(narrationCalls).toBe(3);
  for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
  expect(saved.activeState.apiCalls!.filter(c => c.memoryRequest?.stage === "singlePass")).toHaveLength(1);
  expect(saved.activeState.apiCalls!.filter(c => c.memoryRequest && c.memoryRequest.stage !== "singlePass")).toEqual([]);
});

it.each([false, true])("keeps mixed Brain/Lore extraction to one call with Character auto-approval=%s", async autoApprove => {
  const { qualityFixture, qualitySource, spokenFred, privateGeorge } = await import("../test/memoryQuality");
  const { a } = qualityFixture(); a.messages = []; a.memoryAutoApprove.brainUpdate = autoApprove; a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  let memoryCalls = 0, narrationCalls = 0;
  const forbidden = [vi.spyOn(semantic, "runMemoryCycle"), vi.spyOn(assessment, "assessMemory"), vi.spyOn(review, "validateMemoryUpdate")];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string); let content: string;
    if (body.model === "evaluator") {
      memoryCalls++;
      expect(body.messages[0].content).toContain("brain:"); expect(body.messages[0].content).toContain("storyCard:");
      const payload = JSON.parse(body.messages.at(-1).content);
      expect(Object.keys(payload.outputAliases)).toHaveLength(3);
      content = `S1\n(brain.thoughts: Fred = ${spokenFred})\n(brain.thoughts: George = ${privateGeorge})\n(storyCard.lore: Gryffindor Quidditch Tryouts 2001 = Ron will audition for Keeper.)\nS2\n(brain.thoughts: Fred = ${spokenFred})\nS3\nNONE`;
    } else { narrationCalls++; content = qualitySource; }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  });
  const hook = setup(a);
  for (let i = 0; i < 3; i++) await act(async () => { await hook.result.current.runtime.continueTurn(); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.messages.filter(m => m.role === "assistant").every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
  expect(narrationCalls).toBe(3); expect(memoryCalls).toBe(1);
  expect(hook.result.current.adventure!.activeState.memoryProposals.filter(p => p.proposedType === "brainUpdate")).toHaveLength(1);
  expect(hook.result.current.adventure!.activeState.memoryProposals.filter(p => p.proposedType === "storyCard")).toHaveLength(1);
  const saved = hook.result.current.adventure!;
  const brain = saved.activeState.memoryProposals.find(p => p.proposedType === "brainUpdate")!;
  const lore = saved.activeState.memoryProposals.find(p => p.proposedType === "storyCard")!;
  expect(brain).toMatchObject({ status: autoApprove ? "approved" : "pending", requiresReview: false });
  expect(lore).toMatchObject({ status: "pending", requiresReview: false });
  expect(Object.values(saved.brains.find(b => b.id === "brain-George")!.thoughts).some(t => t.includes(privateGeorge))).toBe(autoApprove);
  for (const p of [brain, lore]) expect(p.evaluationSource?.messages.some(e => e.id === p.sourceTurnId && e.content === qualitySource)).toBe(true);
  const first = saved.messages.find(m => m.role === "assistant")!;
  expect(first.memoryEvaluation?.singlePass).toMatchObject({ parsedCount: 3, suppressedCount: 1, acceptedCount: autoApprove ? 1 : 0, reviewCount: autoApprove ? 1 : 2 });
  expect(first.memoryEvaluation?.singlePass?.dispositions).toContainEqual(expect.objectContaining({ status: autoApprove ? "accepted" : "review", proposalId: brain.id }));
  expect(first.memoryEvaluation?.singlePass?.dispositions).toContainEqual(expect.objectContaining({ status: "review", proposalId: lore.id }));
  expect(saved.activeState.memoryDiagnostics).toContainEqual(expect.objectContaining({ sourceId: first.id, outcome: "evaluation_completed" }));
  expect(saved.activeState.apiCalls!.filter(c => c.memoryRequest?.stage === "singlePass")).toHaveLength(1);
  expect(saved.activeState.apiCalls!.filter(c => c.memoryRequest && c.memoryRequest.stage !== "singlePass")).toEqual([]);
  for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
  await act(async () => { await settle(); }); expect(memoryCalls).toBe(1);
  expect(hook.result.current.runtime.memoryWork).toBeUndefined();
});

// These legacy assertions inspect detailed logging. OFF contracts are tested separately.
const debugLogging = vi.hoisted(() => ({ MEMORY_DEBUG_LOGGING: true }));
vi.mock("../config/debugLogging", () => debugLogging);


it.each([false, true])("keeps a fixed chronology batch at one memory API request, with conflict=%s", async conflict => {
  debugLogging.MEMORY_DEBUG_LOGGING = true;
  const a = createDefaultAdventure();
  a.memoryDetectionSettings.pipeline = "singlePass";
  a.memoryAutoApprove.storyCard = true;
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  const content = "Mira received exclusive archive access.";
  a.messages = ["clock-a", "clock-b", "clock-c"].map((id, index) => ({ id, role: "assistant" as const,
    content: index === 2 ? content : "Mira waits beside the gate.", createdAt: "2026-10-29",
    storyTime: { text: "2001-09-02", date: "2001-09-02", precision: "day" as const },
    memoryEvaluation: { pipeline: "singlePass" as const, status: "pending" as const, attempts: 0, turn: index + 1, completedGroups: [] } }));
  const title = conflict ? "4 September — Archive access" : "2 September — Archive access";
  const responseBodies: string[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("evaluator");
    const payload = JSON.parse(body.messages.at(-1).content);
    const finding = { kind: "storyCard", targetId: null, title, content, evidenceQuotes: [{ messageId: "clock-c", quote: content }],
      reason: "A lasting access agreement.", candidateOnly: false, storyCardType: "lore", operation: "create", memoryMode: "historical",
      eventStatus: "completed", suggestedTriggers: ["archive access", "research agreement"], participants: ["Mira"] };
    const reply = JSON.stringify({ sources: payload.sources.map((source: { sourceId: string }) => ({ sourceId: source.sourceId,
      findings: source.sourceId === "clock-c" ? [finding] : [] })) });
    responseBodies.push(reply);
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }));
  });
  const hook = setup(a);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources(a.messages.map(m => m.id)); await settle(); });
  await waitFor(() => expect(hook.result.current.adventure!.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(responseBodies).toHaveLength(1);
  const after = hook.result.current.adventure!;
  const proposal = after.activeState.memoryProposals.find(p => p.title === title)!;
  expect(proposal).toMatchObject({ title, content, sourceText: content, lore: { occurredAt: { date: "2001-09-02" } } });
  expect(proposal.status).toBe(conflict ? "pending" : "approved");
  if (conflict) expect(proposal.requiresReview).toBe(true);
  expect(after.messages.at(-1)!.memoryEvaluation!.singlePass!.findings).toEqual(
    JSON.parse(responseBodies[0]).sources.find((source: { sourceId: string }) => source.sourceId === "clock-c").findings);
  expect(after.activeState.apiCalls).toHaveLength(1);
  expect(after.activeState.apiCalls![0].usage).toMatchObject({ promptTokens: 100, completionTokens: 30, totalTokens: 130 });
  await act(async () => { await settle(); });
  expect(fetch).toHaveBeenCalledTimes(1);
});


import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryInboxPage } from "../pages/MemoryInboxPage";
import { loreCorrectionFixture } from "../test/loreDateCorrection";

it("clock editing, selection, preview, and confirmed correction cost zero requests and leave single-pass accounting unchanged", async () => {
  debugLogging.MEMORY_DEBUG_LOGGING = false;
  const fixture = () => {
    const a = loreCorrectionFixture(); a.messages = a.messages.slice(0, 3).map((m, index) => ({ ...m,
      memoryEvaluation: { pipeline: "singlePass", status: "pending", attempts: 0, turn: index + 1, completedGroups: [] } }));
    a.memoryDetectionSettings.pipeline = "singlePass";
    return a;
  };
  const responseBodies: string[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string); requests.push(body);
    const payload = JSON.parse(body.messages.at(-1).content);
    const content = JSON.stringify({ sources: payload.sources.map((source: { sourceId: string }) => ({ sourceId: source.sourceId, findings: [] })) });
    responseBodies.push(content);
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }));
  });
  const baseline = setup(fixture());
  await act(async () => { await baseline.result.current.runtime.evaluateMemorySources(["stale", "historical", "append"]); await settle(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  const beforeUsage = baseline.result.current.adventure!.activeState.backgroundTokenUsage;
  const beforeRecords = baseline.result.current.adventure!.activeState.apiCalls!;
  baseline.unmount(); fetch.mockClear();
  const hook = setup(fixture());
  const renderPage = () => <MemoryInboxPage adventure={hook.result.current.adventure!} dispatch={action => { hook.result.current.runtime.applyActionsAndPersist([action]); }} />;
  const page = render(renderPage()); const user = userEvent.setup();
  const original = hook.result.current.adventure!;
  await user.clear(screen.getByLabelText("Current story time", { exact: true }));
  await user.type(screen.getByLabelText("Current story time", { exact: true }), "2001-09-09");
  expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply Story Date" })); page.rerender(renderPage());
  expect(hook.result.current.adventure!.storyClock?.current?.date).toBe("2001-09-09");
  expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: "Select Lore: Archive discovery" }));
  expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Review Date Changes" }));
  expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm and Apply Dates" })); page.rerender(renderPage());
  await act(async () => { await settle(); });
  const corrected = hook.result.current.adventure!;
  expect(corrected.activeState.memoryProposals[0].lore?.occurredAt?.date).toBe("2001-09-09");
  expect(fetch).not.toHaveBeenCalled();
  expect(corrected.activeState.apiCalls).toEqual(original.activeState.apiCalls);
  expect(corrected.activeState.backgroundTokenUsage).toEqual(original.activeState.backgroundTokenUsage);
  expect(corrected.messages).toEqual(original.messages);
  await act(async () => { await hook.result.current.runtime.evaluateMemorySources(["stale", "historical", "append"]); await settle(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  const after = hook.result.current.adventure!;
  expect(after.activeState.apiCalls).toHaveLength(beforeRecords.length);
  expect(after.activeState.apiCalls![0].usage).toEqual(beforeRecords[0].usage);
  expect(after.activeState.apiCalls![0].model).toEqual(beforeRecords[0].model);
  expect(after.activeState.backgroundTokenUsage).toEqual(beforeUsage);
  expect(responseBodies[1]).toBe(responseBodies[0]);
  expect(requests[1].model).toBe(requests[0].model);
  expect(requests[1].max_tokens).toBe(requests[0].max_tokens);
  expect(requests[1].max_completion_tokens).toBe(requests[0].max_completion_tokens);
  expect(after.messages.map(m => m.content)).toEqual(original.messages.map(m => m.content));
});


it("Story Card auto-approval changes only local outcomes across a realistic multi-message window", async () => {
  debugLogging.MEMORY_DEBUG_LOGGING = false;
  const { looseMemoryFixture } = await import("../test/looseMemory");
  const fact = "The research team gained access to the library archives.";
  const attempt = "He attempted to kiss her but withdrew before contact.";
  const findings = [
    { title: "Archive access", content: fact, quote: fact },
    { title: "Claimed first kiss", content: "They kissed.", quote: attempt },
  ].map(({ title, content, quote }) => ({ kind: "storyCard", targetId: null, title, content,
    evidenceQuotes: [{ messageId: "narrator-2", quote }], reason: "A durable event.", candidateOnly: false,
    storyCardType: "lore", operation: "create", memoryMode: "historical", eventStatus: "completed", suggestedTriggers: ["archive research", "personal milestones"], participants: [] }));
  const output = JSON.stringify({ sources: ["narrator-1", "narrator-2", "narrator-3"].map(sourceId => ({ sourceId, findings: sourceId === "narrator-2" ? findings : [] })) });
  const requests: unknown[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ choices: [{ message: { content: output } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
  });
  const outcomes: Adventure[] = [];
  for (const enabled of [false, true]) {
    const { a } = looseMemoryFixture(); a.storyCards = []; a.brains = []; a.components = [];
    a.messages[0].content = "Fred and George might produce rune tattoos next week.";
    a.messages[1].content = fact + " " + attempt + " Hermione accepted the invitation to meet.";
    a.messages[2].content = "The team returned to its workshop to discuss tomorrow's research plans.";
    a.memoryAutoApprove.storyCard = enabled;
    a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
    const hook = setup(a);
    await act(async () => { await hook.result.current.runtime.evaluateMemorySources(a.messages.map(m => m.id)); await settle(); });
    await waitFor(() => expect(hook.result.current.adventure!.messages.every(m => m.memoryEvaluation?.status === "complete")).toBe(true));
    await act(async () => { await settle(); });
    outcomes.push(hook.result.current.adventure!); hook.unmount();
  }
  expect(fetch).toHaveBeenCalledTimes(2); // One extraction per configuration; zero review/retry calls.
  expect(requests[1]).toEqual(requests[0]);
  const [off, on] = outcomes;
  expect(on.messages[1].memoryEvaluation?.singlePass?.parsedCount).toBe(2);
  expect(off.messages[1].memoryEvaluation?.singlePass?.parsedCount).toBe(2);
  expect(on.activeState.memoryProposals.map(p => [p.title, p.content])).toEqual(off.activeState.memoryProposals.map(p => [p.title, p.content]));
  expect(on.messages[1].memoryEvaluation?.singlePass?.findings).toEqual(off.messages[1].memoryEvaluation?.singlePass?.findings);
  expect(on.activeState.backgroundTokenUsage).toEqual(off.activeState.backgroundTokenUsage);
  for (const a of outcomes) {
    expect(a.activeState.apiCalls).toHaveLength(1);
    expect(a.activeState.apiCalls![0].usage).toMatchObject({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
    expect(a.activeState.apiCalls![0].memoryRequest?.stage).toBe("singlePass");
    expect(a.activeState.memoryProposals).toHaveLength(2);
    expect(a.activeState.memoryProposals.find(p => p.title === "Claimed first kiss")).toMatchObject({ status: "pending", requiresReview: true });
    expect(a.activeState.memoryDiagnostics ?? []).toEqual([]);
  }
  expect(on.activeState.apiCalls![0].model).toBe(off.activeState.apiCalls![0].model);
  expect(on.activeState.apiCalls![0].provider).toBe(off.activeState.apiCalls![0].provider);
  expect(off.activeState.memoryProposals.find(p => p.title === "Archive access")).toMatchObject({ status: "pending", requiresReview: false });
  expect(on.activeState.memoryProposals.find(p => p.title === "Archive access")).toMatchObject({ status: "approved", requiresReview: false });
  expect(off.storyCards).toEqual([]); expect(on.storyCards[0].content).toBe(fact);
});
