import { appendFileSync } from "node:fs";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";
/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig, normalizeAdventure, makeBrain, makeStoryCard, makeTriggerRule } from "../state/defaults";
import type { Adventure, MemoryDetectionSettings } from "../types/adventure";
import { useAdventureRuntime } from "./useAdventureRuntime";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { runMemoryCycle, runSemanticPostTurnEvaluation } from "../triggers/semanticEngine";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
vi.mock("../triggers/semanticEngine", async importOriginal => ({
  ...await importOriginal<typeof import("../triggers/semanticEngine")>(),
  runMemoryCycle: vi.fn(async () => ({ actions: [] })),
  runSemanticPostTurnEvaluation: vi.fn(),
}));

afterEach(cleanup);

function setup(enabled = true, customRule = false, saved?: Adventure) {
  const initial = createDefaultAdventure("Call accounting");
  initial.memoryDetectionSettings = { ...initial.memoryDetectionSettings, enabled: !enabled }; // deliberately stale saved settings
  initial.memoryAutoApprove = { ...initial.memoryAutoApprove, storyCard: true };
  if (customRule) initial.triggerRules.push(makeTriggerRule({ name: "Explicit custom rule", condition: "When Mira learns something", evaluationMode: "semantic" }));
  initial.storyCards = [makeStoryCard({ id: "mira", title: "Mira", content: "Mira is a scout.", active: true, pinned: true, protected: false })];
  const globalMemory: MemoryDetectionSettings = { enabled, everyNTurns: 1, generateContent: true };
  return renderHook(() => {
    const [adventure, setAdventure] = useState<Adventure | undefined>(saved ?? initial);
    const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "test" }, vi.fn(), vi.fn(), vi.fn(), async () => undefined, globalMemory);
    return { runtime, adventure };
  });
}

const story = "Mira explains that silver burns her skin.";
const response = `${story}\n<memory_updates>${JSON.stringify({ updates: [{ kind: "card", target: "Mira", content: "Silver burns Mira's skin.", evidence: story, reason: "Lasting vulnerability" }] })}</memory_updates>`;


it.each(["inline", "missing"])("architecture cost baseline: twenty %s turns", async kind => {
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async options => {
    const ids = options.responseFormat ? JSON.parse(/EVERY source ID: (\[[^\]]*\])/.exec(options.messages.map(m => m.content).join("\n"))![1]) as string[] : [];
    return { content: options.responseFormat ? JSON.stringify({ turns: ids.map(sourceTurnId => ({ sourceTurnId, updates: [] })) }) : kind === "inline" ? response : story, raw: {} };
  });
  const hook = setup();
  for (let turn = 0; turn < 20; turn++) await act(async () => { await hook.result.current.runtime.submitTurn("I listen."); });
  const calls = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.map(([o]) => o);
  const metrics = {
    narration: calls.filter(o => !o.responseFormat).length,
    recovery: calls.filter(o => o.responseFormat).length,
    promptTokens: calls.reduce((sum, o) => sum + o.messages.reduce((n, m) => n + approximateTokenCount(m.content) + 8, 0), 0),
    outputBudget: calls.reduce((sum, o) => sum + (o.config.maxOutputTokens ?? 0), 0),
  };
  console.log("ARCHITECTURE_COST", kind, JSON.stringify(metrics));
  if (process.env.AIST_COST_REPORT) appendFileSync(process.env.AIST_COST_REPORT, JSON.stringify({ kind, ...metrics }) + "\n");
  const baseline = kind === "inline" ? { promptTokens: 74053, outputBudget: 24000 } : { promptTokens: 82238, outputBudget: 48000 };
  expect(metrics.promptTokens).toBeLessThanOrEqual(baseline.promptTokens);
  expect(metrics.outputBudget).toBe(baseline.outputBudget);
  expect(metrics.narration).toBe(20);
  expect(metrics.recovery).toBe(kind === "inline" ? 0 : 4);
  expect(runMemoryCycle).not.toHaveBeenCalled();
  hook.unmount();
});


it("preserves Brain cadence across twenty turns with a large Lore collection", async () => {
  const adventure = createDefaultAdventure();
  adventure.brains = [makeBrain({ id: "mira-brain", characterName: "Mira", autoUpdateCooldownTurns: 3, updateMode: "append" })];
  adventure.memoryAutoApprove.brainUpdate = true;
  adventure.storyCards = [makeStoryCard({ id: "mira", title: "Mira", type: "character", content: "Mira is a scout.", keys: ["Mira"] }),
    ...Array.from({ length: 60 }, (_, index) => makeStoryCard({ title: `Archive ${index}`, type: "lore", memoryMode: "historical", content: `Past adventure ${index}. ` + "Archived scene details. ".repeat(40), keys: [`specific memory cue ${index}`] }))];
  let turn = 0;
  vi.mocked(sendOpenAICompatibleChatCompletion).mockReset();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(async () => {
    const story = `Mira studies clue ${turn}.`;
    const content = `I must investigate clue ${turn++}.`;
    return { raw: {}, content: story + '<memory_updates>' + JSON.stringify({ updates: [{ kind: "thought", target: "Mira", content, evidence: story, reason: "New private plan" }] }) + '</memory_updates>' };
  });
  const hook = setup(true, false, adventure);
  for (let i = 0; i < 20; i++) await act(async () => { await hook.result.current.runtime.submitTurn("Mira studies the clue."); });
  const calls = vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls.map(([o]) => o);
  const brain = hook.result.current.adventure!.brains[0];
  expect(calls).toHaveLength(20);
  expect(brain.lastUpdatedTurn).toBe(18);
  expect(Object.values(brain.thoughts)).toHaveLength(7);
  expect(calls.every(o => !o.responseFormat && o.config.maxOutputTokens === defaultModelConfig.maxOutputTokens)).toBe(true);
  expect(calls.every(o => !o.messages.some(m => m.content.includes("Archived scene details")))).toBe(true);
  expect(calls.reduce((sum, o) => sum + o.messages.reduce((n, m) => n + approximateTokenCount(m.content) + 8, 0), 0)).toBeLessThanOrEqual(74580);
  if (process.env.AIST_COST_REPORT) appendFileSync(process.env.AIST_COST_REPORT, JSON.stringify({ kind: "heavy", narration: calls.length, recovery: 0, brainUpdates: 7, promptTokens: calls.reduce((sum, o) => sum + o.messages.reduce((n, m) => n + approximateTokenCount(m.content) + 8, 0), 0), outputBudget: calls.reduce((sum, o) => sum + o.config.maxOutputTokens, 0) }) + "\n");
  console.log("ARCHITECTURE_COST heavy", JSON.stringify({ requests: calls.length,
    promptTokens: calls.reduce((sum, o) => sum + o.messages.reduce((n, m) => n + approximateTokenCount(m.content) + 8, 0), 0),
    outputBudget: calls.reduce((sum, o) => sum + o.config.maxOutputTokens, 0), brainUpdates: 7 }));
  hook.unmount();
});
