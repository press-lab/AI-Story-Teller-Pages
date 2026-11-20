/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { expect, it, vi } from "vitest";
import { adventureReducer } from "../state/adventureReducer";
import * as transport from "../providers/memoryCompletion";
import { generateMemoryDraft } from "../memory/memoryDraft";
import type { MemoryDraftRequest } from "../types/adventure";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import { StoryCardsPage } from "./StoryCardsPage";

it("requires two explicit links, supports inactive characters and warns on duplicate groups", async () => {
  const user = userEvent.setup();
  const initial = createDefaultAdventure("Relationship editor");
  initial.storyCards = [
    makeStoryCard({ id: "a", type: "character", title: "Alice", content: "" }),
    makeStoryCard({ id: "b", type: "character", title: "Brian", content: "", active: false }),
  ];
  function Editor() {
    const [adventure, dispatch] = useReducer(adventureReducer, initial);
    return <StoryCardsPage adventure={adventure} dispatch={dispatch} />;
  }
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "Create Relationship Card" }));
  const picker = screen.getByRole("group", { name: "Linked Character Cards" });
  const save = screen.getByRole("button", { name: "Save linked characters" });
  expect(save).toBeDisabled();
  await user.click(within(picker).getByRole("checkbox", { name: "Alice" }));
  expect(save).toBeDisabled();
  await user.click(within(picker).getByRole("checkbox", { name: "Brian (inactive)" }));
  await user.click(save);
  expect(screen.getByText("All linked Character Cards must be in context.")).toBeInTheDocument();
  expect(screen.queryByText("Trigger Keys", { exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create Relationship Card" }));
  await user.click(screen.getByRole("checkbox", { name: "Brian (inactive)" }));
  await user.click(screen.getByRole("checkbox", { name: "Alice" }));
  expect(screen.getByRole("button", { name: "Open Alice + Brian" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save linked characters" })).toBeDisabled();
});

it("takes draft membership from the author and rejects provider-supplied links", async () => {
  const adventure = createDefaultAdventure("Relationship drafts");
  adventure.storyCards = [makeStoryCard({ id: "a", title: "Alice", content: "Alice teaches astronomy.", type: "character" }),
    makeStoryCard({ id: "b", title: "Brian", content: "Brian teaches history.", type: "character" })];
  const request: MemoryDraftRequest = { action: "draft", destination: "storyCard", componentType: "custom",
    storyCardType: "relationship", relationship: { characterIds: ["b", "a"] }, intent: "relationship",
    description: "Draft the confirmed friendship.", inclusionPolicy: "triggered",
    context: { components: "none", componentIds: [], storyCardIds: [], recentEntryCount: 0 } };
  const send = vi.spyOn(transport, "sendMemoryCompletion").mockResolvedValue({ raw: {}, content: JSON.stringify({
    title: "Generated title", content: "They became friends.", keys: [], rationale: "Existing friendship." }) });
  try {
    await expect(generateMemoryDraft(adventure, defaultModelConfig, request)).resolves.toMatchObject({
      title: "Alice + Brian", storyCardType: "relationship", relationship: { characterIds: ["a", "b"] }, suggestedTriggers: [],
    });
    expect(send.mock.calls[0][2][1].content).toContain("Brian teaches history.");
    send.mockResolvedValueOnce({ raw: {}, content: JSON.stringify({ title: "X", content: "Friends.", keys: [], relationship: { characterIds: ["z"] } }) });
    await expect(generateMemoryDraft(adventure, defaultModelConfig, request)).rejects.toThrow("selected by the author");
  } finally {
    send.mockRestore();
  }
});
