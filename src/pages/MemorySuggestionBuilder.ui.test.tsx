/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDefaultAdventure, makeComponent, makeStoryCard } from "../state/defaults";
import { MemorySuggestionBuilder } from "./MemorySuggestionBuilder";
import { MemoryInboxPage } from "./MemoryInboxPage";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
function fixture() {
  const adventure = createDefaultAdventure();
  adventure.tokenBudgetSettings.maxContextTokens = 100_000;
  adventure.storyCards = Array.from({ length: 300 }, (_, i) => makeStoryCard({ id: `card-${i}`, title: `Character ${String(i).padStart(3, "0")}`, content: `Full biography ${i}`, type: "character" }));
  return adventure;
}

it("lives in Memory as a collapsed panel and lists every supported component type", async () => {
  const user = userEvent.setup();
  render(<MemoryInboxPage adventure={fixture()} dispatch={vi.fn()} onCreateDraft={vi.fn()} />);
  const summary = screen.getByText("Create suggestion with AI");
  expect(Array.from(document.querySelectorAll(".memory-inbox-page > details > summary")).slice(0, 3).map(el => el.textContent)).toEqual([
    "Suggestion visibility and history", "Story date", "Create suggestion with AI",
  ]);
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await user.click(summary);
  expect(within(screen.getByLabelText("Component type")).getAllByRole("option").map(o => o.textContent)).toEqual([
    "Narration Rules", "AI Instructions", "Plot Essentials", "Current Story Arc", "Author’s Note", "Custom",
  ]);
});

it("keeps selections across search, filters and pages with 300 reference cards", async () => {
  const user = userEvent.setup();
  render(<MemorySuggestionBuilder adventure={fixture()} onCreate={vi.fn()} />);
  await user.click(screen.getByText("Create suggestion with AI"));
  await user.click(screen.getByText(/Context to send/));
  await user.click(screen.getByRole("button", { name: /Choose reference cards/ }));
  const dialog = screen.getByRole("dialog", { name: "Choose reference cards" });
  expect(within(dialog).getAllByRole("checkbox")).toHaveLength(41); // 40 rows + Selected view
  await user.click(within(dialog).getByLabelText("Character 000character"));
  await user.type(within(dialog).getByLabelText("Search cards"), "299");
  await user.click(within(dialog).getByLabelText("Character 299character"));
  await user.clear(within(dialog).getByLabelText("Search cards"));
  await user.click(within(dialog).getByLabelText("Show selected only"));
  expect(within(dialog).getByText("2 selected · 2 matching")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Choose reference cards (2 selected)" })).toBeInTheDocument();
});

it("sends a new-character request with 20 entries and selected full reference context", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn(async () => true);
  render(<MemorySuggestionBuilder adventure={fixture()} onCreate={onCreate} />);
  await user.click(screen.getByText("Create suggestion with AI"));
  await user.selectOptions(screen.getByLabelText("Destination"), "storyCard");
  await user.type(screen.getByLabelText("Your instructions"), "Create a character from the last 20 entries.");
  await user.click(screen.getByRole("button", { name: "Create suggestion" }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ destination: "storyCard", storyCardType: "character", targetId: undefined,
    context: { components: "all", componentIds: [], storyCardIds: [], recentEntryCount: 20 } }));
  expect(screen.getByRole("status")).toHaveTextContent("Draft added below");
});

it("selects an existing singleton automatically and keeps destinations separate from reference cards", async () => {
  const user = userEvent.setup();
  const adventure = fixture();
  adventure.components.push(makeComponent({ id: "instructions", type: "aiInstructions", title: "Rules", content: "Keep the tone dry." }));
  const onCreate = vi.fn(async () => true);
  render(<MemorySuggestionBuilder adventure={adventure} onCreate={onCreate} />);
  await user.click(screen.getByText("Create suggestion with AI"));
  await user.selectOptions(screen.getByLabelText("Component type"), "aiInstructions");
  expect(screen.getByLabelText("Component target")).toHaveValue("instructions");
  await user.type(screen.getByLabelText("Your instructions"), "Add an exploration emphasis.");
  await user.click(screen.getByRole("button", { name: "Create suggestion" }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ targetId: "instructions", componentType: "aiInstructions" }));
});

it("shows provider failures without clearing the brief", async () => {
  const user = userEvent.setup();
  render(<MemorySuggestionBuilder adventure={fixture()} onCreate={vi.fn(async () => { throw new Error("Provider unavailable"); })} />);
  await user.click(screen.getByText("Create suggestion with AI"));
  await user.type(screen.getByLabelText("Your instructions"), "Draft the research subplot.");
  await user.click(screen.getByRole("button", { name: "Create suggestion" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
  expect(screen.getByLabelText("Your instructions")).toHaveValue("Draft the research subplot.");
});

it("shows one-hop provenance and the full payload while leaving above-allowance card drafts sendable", async () => {
  const user = userEvent.setup();
  const adventure = fixture();
  adventure.components = [];
  adventure.tokenBudgetSettings.maxContextTokens = 500;
  adventure.storyCards = [makeStoryCard({ id: "vault", type: "location", title: "Sapphire Vault", content: "Beyond the Ivory Gate. " + "x".repeat(1200) + "FULL VAULT END" }),
    makeStoryCard({ id: "gate", type: "location", title: "Ivory Gate", content: "SECOND HOP ONLY" })];
  const onCreate = vi.fn(async () => true);
  render(<MemorySuggestionBuilder adventure={adventure} onCreate={onCreate} />);
  await user.click(screen.getByText("Create suggestion with AI"));
  await user.selectOptions(screen.getByLabelText("Destination"), "storyCard");
  await user.type(screen.getByLabelText("Your instructions"), "Create a character guarding Sapphire Vault.");
  await user.click(screen.getByText(/Context to send/));
  const manifest = screen.getByLabelText("Draft context manifest");
  expect(within(manifest).getByText(/Your instructions → Sapphire Vault/, { selector: "li" })).toHaveTextContent("full content included");
  expect(manifest).not.toHaveTextContent("SECOND HOP ONLY");
  expect(screen.getByText(/characters · estimated/)).toHaveTextContent("(advisory)");
  expect(screen.getByRole("status")).toHaveTextContent("will not shorten or block");
  await user.click(screen.getByText("Full request sent to AI", { selector: "summary" }));
  expect(within(manifest).getByText(/FULL VAULT END/, { selector: "pre" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Create suggestion" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Create suggestion" }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ destination: "storyCard", context: expect.objectContaining({ storyCardIds: [] }) }));
});
