/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryCardTriggerCleanup } from "./StoryCardTriggerCleanup";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import type { ProviderConfig } from "../types/adventure";
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
const config: ProviderConfig = { name: "test", baseUrl: "https://example.com", model: "test", maxOutputTokens: 4096, temperature: 0.5 };
function fixture() {
  const adventure = createDefaultAdventure();
  adventure.storyCards = [makeStoryCard({ id: "lore", title: "Thanksgiving 2018", type: "lore", content: "Aunt Marge dropped her stuffing.", keys: ["dinner"] }),
    makeStoryCard({ id: "person", title: "Aunt Marge", type: "character", content: "A formidable aunt.", keys: ["Marge"] })];
  return adventure;
}
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it("scopes requests, previews old/new keys and split notes, and applies only keys after explicit review", async () => {
  const user = userEvent.setup(), adventure = fixture(), dispatch = vi.fn();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: JSON.stringify([{ cardId: "lore", keys: ["2018 Thanksgiving", "Aunt Marge's stuffing"], reason: "Natural event references.", splitNote: "Review the unrelated later wedding separately." }]) } as never);
  render(<StoryCardTriggerCleanup adventure={adventure} dispatch={dispatch} providerConfig={config} />);
  await user.selectOptions(screen.getByLabelText("Trigger cleanup category"), "lore");
  await user.click(screen.getByRole("button", { name: "Preview Trigger Cleanup" }));
  expect(await screen.findByText("Natural event references.")).toBeInTheDocument();
  const input = JSON.parse(vi.mocked(sendOpenAICompatibleChatCompletion).mock.calls[0][0].messages[1].content as string);
  expect(input.map((item: { cardId: string }) => item.cardId)).toEqual(["lore"]);
  expect(screen.getByText(/Review the unrelated later wedding/)).toBeInTheDocument();
  expect(dispatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Replace triggers for Thanksgiving 2018" }));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "UPDATE_STORY_CARD", storyCardId: "lore", patch: { keys: ["2018 Thanksgiving", "Aunt Marge's stuffing"] } });
});
it("blocks stale proposals and rejects proposals without mutating the adventure", async () => {
  const user = userEvent.setup(), adventure = fixture(), dispatch = vi.fn();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: JSON.stringify([
    { cardId: "lore", keys: [], reason: "Title suffices." }, { cardId: "person", keys: ["Auntie Marge"], reason: "An alias." },
  ]) } as never);
  const { rerender } = render(<StoryCardTriggerCleanup adventure={adventure} dispatch={dispatch} providerConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Preview Trigger Cleanup" }));
  await screen.findByText("Title suffices.");
  rerender(<StoryCardTriggerCleanup adventure={{ ...adventure, storyCards: adventure.storyCards.map(card => card.id === "lore" ? { ...card, content: "Changed content" } : card) }} dispatch={dispatch} providerConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Replace triggers for Thanksgiving 2018" }));
  expect(screen.getByText(/Card changed or was removed/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reject triggers for Aunt Marge" }));
  expect(screen.getByText("Rejected")).toBeInTheDocument();
  expect(dispatch).not.toHaveBeenCalled();
});
it("keeps the completed batch when stopped and does not send the next batch", async () => {
  const user = userEvent.setup(), adventure = fixture();
  let finish!: (value: never) => void;
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<StoryCardTriggerCleanup adventure={adventure} dispatch={vi.fn()} providerConfig={{ ...config, maxOutputTokens: 512 }} />);
  await user.click(screen.getByRole("button", { name: "Preview Trigger Cleanup" }));
  await waitFor(() => expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "Stop after current request" }));
  finish({ content: JSON.stringify([{ cardId: "lore", keys: [], reason: "Completed before stopping." }]) } as never);
  expect(await screen.findByText("Completed before stopping.")).toBeInTheDocument();
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledOnce();
  expect(screen.getByText(/Stopped before all batches completed/)).toBeInTheDocument();
});
it("appends individually without removing existing phrases or adding case-insensitive duplicates", async () => {
  const user = userEvent.setup(), adventure = fixture(), dispatch = vi.fn();
  adventure.storyCards[0].keys = ["dinner", "2018 Thanksgiving"];
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: JSON.stringify([
    { cardId: "lore", keys: ["2018 THANKSGIVING", "stuffing incident"], reason: "An alternative reference." },
    { cardId: "person", keys: ["Auntie Marge"], reason: "An alias." },
  ]) } as never);
  render(<StoryCardTriggerCleanup adventure={adventure} dispatch={dispatch} providerConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Preview Trigger Cleanup" }));
  await screen.findByText("An alternative reference.");
  await user.click(screen.getByRole("button", { name: "Append triggers for Thanksgiving 2018" }));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "UPDATE_STORY_CARD", storyCardId: "lore", patch: { keys: ["dinner", "2018 Thanksgiving", "stuffing incident"] } });
  expect(screen.getByText("Appended")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Append All Pending Triggers" }));
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(dispatch).toHaveBeenLastCalledWith({ type: "UPDATE_STORY_CARD", storyCardId: "person", patch: { keys: ["Marge", "Auntie Marge"] } });
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledOnce();
});
it("bulk replace skips rejected, failed and stale cards while applying valid pending siblings", async () => {
  const user = userEvent.setup(), adventure = fixture(), dispatch = vi.fn();
  adventure.storyCards.push(makeStoryCard({ id: "failed", title: "Failed event", content: "A memory." }), makeStoryCard({ id: "valid", title: "Valid event", content: "Another memory.", keys: ["old valid"] }));
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: JSON.stringify([
    { cardId: "lore", keys: ["2018 Thanksgiving"], reason: "A dated event." },
    { cardId: "person", keys: ["Auntie Marge"], reason: "An alias." },
    { cardId: "valid", keys: ["new valid"], reason: "A better reference." },
  ]) } as never);
  const { rerender } = render(<StoryCardTriggerCleanup adventure={adventure} dispatch={dispatch} providerConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Preview Trigger Cleanup" }));
  await screen.findByText("A dated event.");
  await user.click(screen.getByRole("button", { name: "Reject triggers for Aunt Marge" }));
  rerender(<StoryCardTriggerCleanup adventure={{ ...adventure, storyCards: adventure.storyCards.map(card => card.id === "lore" ? { ...card, keys: ["manually edited"] } : card) }} dispatch={dispatch} providerConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Replace All Pending Triggers" }));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "UPDATE_STORY_CARD", storyCardId: "valid", patch: { keys: ["new valid"] } });
  expect(screen.getByText(/Card changed or was removed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Replace All Pending Triggers" })).toBeDisabled();
});
it("bulk append preserves both cards' existing keys and supports title-only proposals without clearing them", async () => {
  const user = userEvent.setup(), adventure = fixture(), dispatch = vi.fn();
  vi.mocked(sendOpenAICompatibleChatCompletion).mockResolvedValue({ content: JSON.stringify([
    { cardId: "lore", keys: [], reason: "Title suffices." },
    { cardId: "person", keys: ["Auntie Marge"], reason: "An alias." },
  ]) } as never);
  render(<StoryCardTriggerCleanup adventure={adventure} dispatch={dispatch} providerConfig={config} />);
  await user.click(screen.getByRole("button", { name: "Preview Trigger Cleanup" }));
  await screen.findByText("Title suffices.");
  await user.click(screen.getByRole("button", { name: "Append All Pending Triggers" }));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "UPDATE_STORY_CARD", storyCardId: "person", patch: { keys: ["Marge", "Auntie Marge"] } });
  expect(screen.getAllByText("Appended")).toHaveLength(2);
});
