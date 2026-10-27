/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup(initial = createDefaultAdventure()) {
  initial.semanticEvaluationSettings.backgroundProviderConfig = { baseUrl: "https://example.test/v1", model: "evaluator", memoryReasoningControl: "omit" };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(initial);
    return { adventure, runtime: useAdventureRuntime(adventure, setAdventure,
      { ...defaultModelConfig, model: "narrator", baseUrl: "https://example.test/v1", apiKey: "offline" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined,
      { pipeline: "singlePass", enabled: true, everyNTurns: 1, generateContent: true }) };
  });
}
describe.each(["json", "commands"])("runtime %s response compatibility", format => {
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
  expect(hook.result.current.adventure!.messages.filter(m => m.role === "assistant").at(-1)!.memoryEvaluation!.singlePass!.dispositions).toContainEqual(expect.objectContaining({ status: "rejected", reason: expect.any(String) }));
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
  expect(saved.storyCards).toEqual(originalCards); expect(saved.brains).toEqual(originalBrains); expect(saved.components).toEqual(originalComponents);
  expect(memoryCalls).toBe(1); expect(narrationCalls).toBe(3);
  for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
  expect(saved.activeState.apiCalls!.filter(c => c.memoryRequest?.stage === "singlePass")).toHaveLength(1);
  expect(saved.activeState.apiCalls!.filter(c => c.memoryRequest && c.memoryRequest.stage !== "singlePass")).toEqual([]);
});
