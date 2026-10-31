/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { adventureReducer } from "../state/adventureReducer";
import { approvalAdventure, approvalProposal, existingApprovalCard } from "../test/memoryApproval";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { defaultGlobalAdventureSettings, normalizeGlobalAdventureSettings, type GlobalAdventureSettings } from "./pageTypes";
import { MemoryInboxPage } from "./MemoryInboxPage";

const controls = [
  ["Plot Essentials", "plotEssentialsUpdate"], ["Active Pressure", "plotPressureUpdate"],
  ["Current Arc", "currentArcUpdate"], ["Arc Proposals", "arcProposal"],
  ["Story Cards — Lore", "loreStoryCard"], ["Story Cards — Everything Else", "otherStoryCard"], ["Character Self", "brainUpdate"],
] as const;
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), clear: () => data.clear() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("offers exactly one independent approval toggle per category with detection disabled", async () => {
  const user = userEvent.setup(); const initial = approvalAdventure();
  initial.activeState.memoryProposals = [approvalProposal("brainUpdate")];
  function Harness() {
    const [adventure, dispatch] = useReducer(adventureReducer, initial);
    return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output data-testid="settings">{JSON.stringify(adventure.memoryAutoApprove)}</output><output data-testid="status">{adventure.activeState.memoryProposals[0].status}</output></>;
  }
  render(<Harness />);
  for (const [label, key] of controls) {
    expect(screen.getAllByLabelText(label)).toHaveLength(1);
    const before = JSON.parse(screen.getByTestId("settings").textContent!);
    await user.click(screen.getByLabelText(label));
    expect(JSON.parse(screen.getByTestId("settings").textContent!)).toEqual({ ...before, [key]: true });
    expect(screen.getByTestId("status")).toHaveTextContent("pending");
  }
  expect(screen.queryByLabelText(/Route all auto-updates|Require review for automatic/i)).not.toBeInTheDocument();
});

it("shows the stored card subtype and prevents the proposal from changing it", () => {
  const a = approvalAdventure(); a.storyCards = [existingApprovalCard("lore")];
  a.activeState.memoryProposals = [approvalProposal("otherStoryCard", { title: "Mira", targetId: "card" })];
  render(<MemoryInboxPage adventure={a} dispatch={() => undefined} />);
  expect(screen.getByLabelText("Card Type")).toHaveValue("lore");
  expect(screen.getByLabelText("Card Type")).toBeDisabled();
});

it("drops obsolete global approval preferences without changing the background provider", () => {
  const key = "approval-global-test";
  localStorage.setItem(key, JSON.stringify({ ...defaultGlobalAdventureSettings, semanticEvaluationSettings: { ...defaultGlobalAdventureSettings.semanticEvaluationSettings, backgroundProviderConfig: { baseUrl: "https://example.test", model: "background", apiKey: "local-test-key" } }, memoryAutoApprove: { storyCard: true, brainUpdate: true } }));
  const hook = renderHook(() => useLocalStorage<GlobalAdventureSettings>(key, defaultGlobalAdventureSettings, normalizeGlobalAdventureSettings));
  expect(hook.result.current[0]).not.toHaveProperty("memoryAutoApprove");
  expect(hook.result.current[0].semanticEvaluationSettings.backgroundProviderConfig?.apiKey).toBe("local-test-key");
  hook.unmount();
  const reopened = renderHook(() => useLocalStorage<GlobalAdventureSettings>(key, defaultGlobalAdventureSettings, normalizeGlobalAdventureSettings));
  expect(reopened.result.current[0]).not.toHaveProperty("memoryAutoApprove");
  expect(JSON.parse(localStorage.getItem(key)!)).not.toHaveProperty("memoryAutoApprove");
});

it("keeps seven controls visible outside collapsed details when there are no suggestions", () => {
  render(<MemoryInboxPage adventure={approvalAdventure()} dispatch={() => undefined} />);
  const panel = screen.getByRole("region", { name: "Auto-approval — This adventure" });
  expect(panel.closest("details")).toBeNull();
  expect(panel.querySelectorAll('input[type="checkbox"]')).toHaveLength(7);
  for (const [label] of controls) expect(screen.getByLabelText(label)).toBeVisible();
});

import type { Adventure } from "../types/adventure";
import { loreCorrectionFixture } from "../test/loreDateCorrection";
import { saveAdventure, getAdventure } from "../db/adventureDb";
import { IDBFactory } from "fake-indexeddb";

function ManualReview({ initial }: { initial: Adventure }) {
  const [adventure, dispatch] = useReducer(adventureReducer, initial);
  return <><MemoryInboxPage adventure={adventure} dispatch={dispatch} /><output data-testid="manual-state">{JSON.stringify(adventure)}</output></>;
}
const manualState = (): Adventure => JSON.parse(screen.getByTestId("manual-state").textContent!);

it.each(["pending", "rejected", "ignored"] as const)("approves a %s uncertain protected Lore conflict and preserves history", async status => {
  const a = loreCorrectionFixture(); const target = a.storyCards[0]; target.protected = true;
  const p = a.activeState.memoryProposals.find(p => p.id === "append")!;
  p.status = status; p.confidence = 0.1; p.requiresReview = true; p.storyCardReview!.candidateOnly = true;
  p.lore!.lastChangedAt = { text: "1900-01-01", date: "1900-01-01", precision: "day" };
  a.activeState.memoryProposals = [p];
  render(<ManualReview initial={a} />); const user = userEvent.setup();
  if (status !== "pending") {
    await user.click(screen.getByText("History (1)", { selector: "summary" }));
    await user.click(document.querySelector(".proposal-card > summary")!);
  }
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  if (status !== "pending") {
    await user.type(screen.getByPlaceholderText("Proposed content..."), " Mira catalogued the records.");
    expect(manualState().activeState.memoryProposals[0].status).toBe("pending");
  }
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const saved = manualState();
  expect(saved.activeState.memoryProposals[0]).toMatchObject({ id: p.id, status: "approved", sourceTurnId: p.sourceTurnId });
  expect(saved.storyCards[0].content).toContain(p.content);
  expect(saved.storyCards[0].lore?.occurredAt).toEqual(target.lore!.occurredAt);
  expect(saved.storyCards[0].lore?.lastChangedAt).toEqual(a.storyClock!.current);
  expect(saved.storyClock).toEqual(a.storyClock);
  expect(screen.getByText("Approved — memory updated.")).toBeVisible();
  expect(adventureReducer(saved, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id })).toBe(saved);
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  await saveAdventure(saved);
  const reloaded = await getAdventure(saved.id);
  expect(reloaded?.storyCards[0]).toMatchObject({ content: saved.storyCards[0].content, lore: saved.storyCards[0].lore });
  expect(reloaded?.activeState.memoryProposals[0].status).toBe("approved");
});

it.each([false, true])("approves overlap without repeating identical statements (all-covered=%s)", async covered => {
  const a = approvalAdventure(); const card = existingApprovalCard("lore"); a.storyCards = [card];
  a.activeState.memoryProposals = [approvalProposal("loreStoryCard", { targetId: card.id, title: card.title,
    content: card.content + (covered ? "" : " Mira obtained permanent archive access.") })];
  render(<ManualReview initial={a} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));
  const saved = manualState();
  expect(saved.activeState.memoryProposals[0].status).toBe("approved");
  expect(saved.storyCards[0].content.match(/An enduring original fact/g)).toHaveLength(1);
  expect(screen.getByText(covered ? "Approved — no new memory content." : "Approved — memory updated.")).toBeVisible();
  if (covered) expect(saved.storyCards).toEqual(a.storyCards);
});

it.each(["assumed", "unknown"])("allows manual creation with an %s clock without inventing chronology", async origin => {
  const a = approvalAdventure(); if (origin === "unknown") a.storyClock = undefined;
  a.activeState.memoryProposals = [approvalProposal("loreStoryCard")];
  render(<ManualReview initial={a} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));
  expect(manualState().activeState.memoryProposals[0].status).toBe("approved");
  expect(manualState().storyCards[0].lore?.occurredAt).toBeUndefined();
  expect(manualState().storyClock).toEqual(a.storyClock);
});

it("offers a missing destination fallback and honors CREATE with a duplicate title", async () => {
  const a = approvalAdventure(); a.storyCards = [existingApprovalCard("lore")];
  a.activeState.memoryProposals = [approvalProposal("loreStoryCard", { title: "Mira", targetId: "missing" })];
  render(<ManualReview initial={a} />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(screen.getByText(/Unable to apply — destination card is missing/, { selector: "p" })).toBeVisible();
  expect(manualState().activeState.memoryProposals[0].status).toBe("pending");
  await user.selectOptions(screen.getByLabelText("Story Card destination"), "");
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(manualState().storyCards).toHaveLength(2);
  expect(manualState().storyCards.map(card => card.title)).toEqual(["Mira", "Mira"]);
});

it("reports structural errors without changing memory", async () => {
  const a = approvalAdventure(); a.activeState.memoryProposals = [approvalProposal("arcProposal", { content: '{"arcPremise": 3}' })];
  render(<ManualReview initial={a} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));
  expect(screen.getByText(/Unable to apply — invalid structured memory content/, { selector: "p" })).toBeVisible();
  expect(manualState().components).toEqual(a.components);
  expect(manualState().activeState.memoryProposals[0].status).toBe("pending");
});

it("changing the confirmed clock leaves approved history unchanged", async () => {
  const a = loreCorrectionFixture(); a.activeState.memoryProposals = [a.activeState.memoryProposals[0]];
  render(<ManualReview initial={a} />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const history = manualState().storyCards;
  await user.clear(screen.getByLabelText("Current story time", { exact: true }));
  await user.type(screen.getByLabelText("Current story time", { exact: true }), "2002-01-01");
  await user.click(screen.getByRole("button", { name: "Apply Story Date" }));
  expect(manualState().storyCards).toEqual(history);
  const b = approvalAdventure(); const optional = approvalProposal("otherStoryCard", { storyCardType: undefined });
  b.activeState.memoryProposals = [optional];
  expect(adventureReducer(b, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: optional.id }).storyCards[0].type).toBe("custom");
});
