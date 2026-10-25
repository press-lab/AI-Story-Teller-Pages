// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { MemoryInboxPage } from "./MemoryInboxPage";
import { MemoryDecisionsPage } from "./MemoryDecisionsPage";
import { createDefaultAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { runTurnPipeline } from "../state/turnPipeline";
import { buildContext } from "../contextBuilder/contextBuilder";
import { onePassMemoryActions } from "../memory/onePassMemory";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { saveAdventure, getAdventure } from "../db/adventureDb";

afterEach(cleanup);
const story = "Mira defeated the Glass King at the silver gate in their first battle together.";
const candidate = { kind: "lore", target: "The Glass King's defeat", content: story, evidence: story, reason: "A consequential victory" };
function seed() {
  const adventure = createDefaultAdventure();
  adventure.memoryDetectionSettings.enabled = true;
  adventure.memoryAutoApprove.storyCard = false;
  return adventure;
}

it.each([
  [story, "evaluation_queued", "Independent evaluation queued"],
  [story + '<memory_updates>{"updates":[]}</memory_updates>', "evaluation_queued", "Independent evaluation queued"],
  [story + '<memory_updates>{oops}</memory_updates>', "evaluation_queued", "Independent evaluation queued"],
])("queues independent evaluation regardless of legacy inline result %s", async (content, outcome, text) => {
  const provider = vi.fn(async () => ({ content }));
  const result = await runTurnPipeline({ adventure: seed(), text: "Mira fights.", assistantMessageId: "source", sendChatCompletion: provider });
  expect(result.adventure.activeState.memoryDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "source", stage: "independent", outcome })]));
  render(<MemoryDecisionsPage adventure={result.adventure} onSuggestions={vi.fn()} />);
  expect(screen.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
  expect(provider).toHaveBeenCalledTimes(1);
});

it("records accepted and rejected Lore, exact evidence and duplicate disposition independently", () => {
  const adventure = adventureReducer(seed(), { type: "ADD_MESSAGE", role: "assistant", id: "source", content: story });
  const actions = onePassMemoryActions(adventure, buildContext(adventure), [candidate, { ...candidate, target: "Invented", evidence: "This never happened." }], story, "source");
  let next = actions.reduce(adventureReducer, adventure);
  expect(next.activeState.memoryDiagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ outcome: "validation_accepted", candidate: expect.objectContaining({ evidence: story }) }),
    expect.objectContaining({ outcome: "validation_rejected", reason: expect.stringContaining("evidence") }),
  ]));
  const proposal = next.activeState.memoryProposals[0];
  expect(proposal).toBeDefined();
  next = adventureReducer(next, { type: "REJECT_MEMORY_PROPOSAL", proposalId: proposal.id });
  next = adventureReducer(next, { type: "ADD_MEMORY_PROPOSAL", proposal: { ...proposal, id: "duplicate", status: "pending" } });
  expect(next.activeState.memoryDiagnostics?.at(-1)?.outcome).toBe("candidate_suppressed");
  render(<MemoryDecisionsPage adventure={next} onSuggestions={vi.fn()} />);
  expect(screen.getByText("Rejected: the supplied evidence quote does not appear in the permitted source messages.", { exact: false })).toBeDefined();
});

it("provides accessible submenu navigation and read-only search and filtering at mobile width", () => {
  const adventure = seed();
  adventure.messages = [{ id: "old", role: "assistant", content: "An old turn.", createdAt: "2026-01-01" }];
  const dispatch = vi.fn(), request = vi.fn();
  const before = JSON.stringify(adventure);
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
  render(<MemoryInboxPage adventure={adventure} dispatch={dispatch} onFindEventMemories={request} />);
  expect(screen.getByRole("navigation", { name: "Memory views" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Decisions" }));
  expect(screen.getByRole("button", { name: "Decisions" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByText(/Diagnostics unavailable for older turns/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Search decisions"), { target: { value: "no-match" } });
  expect(screen.getByText("No matching turns.")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "pending" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
  expect(dispatch).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(JSON.stringify(adventure)).toBe(before);
});

it("shows pending and quarantined recovery and shared batch usage without treating transport as validation", () => {
  let adventure = seed();
  adventure.messages = ["pending", "quarantined"].map((status, i) => ({ id: `source-${i}`, role: "assistant" as const, content: story, createdAt: "2026-01-01", memoryRecovery: { turn: 1, status: status as "pending" | "quarantined", failures: i + 1 } }));
  adventure = adventureReducer(adventure, { type: "RECORD_MEMORY_DIAGNOSTIC", entry: {
    id: "batch", sourceId: "source-0", createdAt: "2026-01-01", stage: "recovery", outcome: "recovery_failed",
    transport: "succeeded", parsed: true, sourceIds: ["source-0", "source-1"], usage: { promptTokens: 50, completionTokens: 10 },
    reason: "memory_evidence_rejected",
  } });
  render(<MemoryDecisionsPage adventure={adventure} onSuggestions={vi.fn()} />);
  expect(screen.getByLabelText("Decision counts").textContent).toContain("1 pending recovery · 1 quarantined recovery");
  expect(screen.getByText(/Transport: succeeded; JSON parsed: yes/)).toBeDefined();
  expect(screen.getByText(/Batch total \(shared across all sources\): 50/)).toBeDefined();
  fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "failed" } });
  expect(screen.getAllByText(/Recovery failed/).length).toBeGreaterThan(0);
});

it("bounds diagnostics and preserves them through export/import and IndexedDB reload", async () => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true });
  let adventure = seed();
  for (let i = 0; i < 605; i++) adventure = adventureReducer(adventure, { type: "RECORD_MEMORY_DIAGNOSTIC", entry: { id: String(i), sourceId: "source", createdAt: "2026-01-01", stage: "inline", outcome: "zero_candidates" } });
  expect(adventure.activeState.memoryDiagnostics).toHaveLength(600);
  const imported = importAdventureJson(exportAdventureJson(adventure));
  expect(imported.activeState.memoryDiagnostics).toEqual(adventure.activeState.memoryDiagnostics);
  await saveAdventure(imported);
  expect((await getAdventure(imported.id))?.activeState.memoryDiagnostics).toEqual(adventure.activeState.memoryDiagnostics);
});


it("shows candidate counts per attempt and preserves failed history when a later attempt is empty", () => {
  const a = seed();
  a.messages = [{ id: "source", role: "assistant", content: story, createdAt: "2026-01-01",
    memoryEvaluation: { turn: 1, attempts: 2, status: "complete", completedGroups: ["plot", "storyCards", "brains", "discovery"] } }];
  a.activeState.memoryDiagnostics = [
    { id: "first", sourceId: "source", createdAt: "2026-01-01", stage: "candidate", outcome: "discovery_summary", evaluationAttempt: 1,
      counts: { returned: 3, accepted: 0, rejected: 3, suppressed: 0, retryPending: 0 } },
    { id: "second", sourceId: "source", createdAt: "2026-01-01", stage: "candidate", outcome: "discovery_summary", evaluationAttempt: 2,
      counts: { returned: 0, accepted: 0, rejected: 0, suppressed: 0, retryPending: 0 } },
  ];
  render(<MemoryDecisionsPage adventure={a} onSuggestions={vi.fn()} />);
  expect(screen.getByText(/Discovery attempt 1: 3 returned · 0 accepted · 3 rejected/)).toBeDefined();
  expect(screen.getByText(/Discovery attempt 2: 0 returned/)).toBeDefined();
  expect(screen.getByText(/Discovery completed with zero candidates; earlier attempts remain recorded/)).toBeDefined();
});

it("keeps quarantined drafts visible and retryable without presenting them as active memories", () => {
  const a = seed(), retry = vi.fn();
  a.messages = [{ id: "source", role: "assistant", content: story, createdAt: "2026-01-01",
    memoryEvaluation: { turn: 1, attempts: 3, status: "quarantined", completedGroups: ["plot", "storyCards", "brains"],
      discoveryCheckpoint: { version: 1, dependencies: [{ id: "source", content: story }], referenceFingerprint: "offline",
        candidates: [{ candidate: { title: "Victory", content: story, storyCardType: "lore", evidenceMessageIds: ["source"] }, status: "awaiting_retry", reason: "Provider unavailable." }] } } }];
  render(<MemoryDecisionsPage adventure={a} onSuggestions={vi.fn()} onEvaluateMemory={retry} />);
  expect(screen.getByText(/Saved discovery drafts \(1\)/)).toBeDefined();
  expect(screen.getByText(/not active memories or narration context/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Evaluate this source independently" }));
  expect(retry).toHaveBeenCalledWith(["source"]);
});


it("preserves noncanonical retry drafts through IndexedDB reload and keeps them out of provider context", async () => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true });
  const a = seed();
  a.messages = [{ id: "source", role: "assistant", content: story, createdAt: "2026-01-01",
    memoryEvaluation: { turn: 1, attempts: 1, status: "failed", completedGroups: ["plot", "storyCards", "brains"],
      discoveryCheckpoint: { version: 1, dependencies: [{ id: "source", content: story }], referenceFingerprint: "offline",
        candidates: [{ candidate: { title: "Saved review draft", content: "private-checkpoint-marker", storyCardType: "lore", evidenceMessageIds: ["source"] }, status: "awaiting_retry" }] } } }];
  await saveAdventure(a);
  const loaded = (await getAdventure(a.id))!;
  expect(loaded.messages[0].memoryEvaluation?.discoveryCheckpoint).toEqual(a.messages[0].memoryEvaluation?.discoveryCheckpoint);
  expect(loaded.activeState.memoryProposals).toHaveLength(0);
  expect(JSON.stringify(buildContext(loaded).messages)).not.toContain("private-checkpoint-marker");
});


it("shows memory progress and recovery choices only inside the Memory submenu", () => {
  const adventure = createDefaultAdventure("Memory progress");
  const retry = vi.fn(async () => undefined), bypass = vi.fn();
  const props = { adventure, dispatch: vi.fn(), onRetryMemory: retry, onContinueWithExistingMemory: bypass };
  const { rerender } = render(<MemoryInboxPage {...props}
    memoryWork={{ adventureId: adventure.id, status: "running", sourceIds: ["source"], remaining: 1, group: "brains" }} />);
  expect(screen.getByRole("status").textContent).toContain("Updating memory: Brains");
  fireEvent.click(screen.getByRole("button", { name: "Decisions" }));
  expect(screen.getByRole("status").textContent).toContain("Updating memory: Brains");
  rerender(<MemoryInboxPage {...props}
    memoryWork={{ adventureId: adventure.id, status: "failed", sourceIds: ["source"], remaining: 1,
      error: "Completed groups are saved. A retry may incur API costs." }} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry memory" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue with existing memory" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(bypass).toHaveBeenCalledTimes(1);
});
