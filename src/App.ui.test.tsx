/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Adventure } from "./types/adventure";
import App from "./App";

let savedAdventures: Adventure[] = [];

vi.mock("./db/adventureDb", () => ({
  listAdventures: vi.fn(async () =>
    savedAdventures.map((adventure) => ({
      id: adventure.id,
      title: adventure.title,
      createdAt: adventure.createdAt,
      updatedAt: adventure.updatedAt,
      turnCount: adventure.activeState.turn,
      storyEntryCount: adventure.messages.filter(
        (message) => message.role === "user" || message.role === "assistant",
      ).length,
    })),
  ),
  saveAdventure: vi.fn(async (adventure: Adventure) => {
    savedAdventures = [adventure, ...savedAdventures.filter((existing) => existing.id !== adventure.id)];
  }),
  getAdventure: vi.fn(async (id: string) => savedAdventures.find((adventure) => adventure.id === id)),
  deleteAdventure: vi.fn(async (id: string) => {
    savedAdventures = savedAdventures.filter((adventure) => adventure.id !== id);
  }),
}));

vi.mock("./providers/openAICompatible", () => ({
  sendOpenAICompatibleChatCompletion: vi.fn(async () => ({ content: "Mock response", raw: {} })),
}));

function installLocalStorage() {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });
}

describe("App adventure tool workspace", () => {
  beforeEach(() => {
    savedAdventures = [];
    installLocalStorage();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens management tools in the editor workspace without losing the adventure", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    const titleInput = screen.getByDisplayValue("New Adventure");
    await user.clear(titleInput);
    await user.type(titleInput, "Workspace Test");
    await user.click(screen.getByRole("button", { name: "Create Adventure" }));

    // After creation the app lands on the dashboard — title appears as a heading
    await screen.findByRole("heading", { name: "Workspace Test" });
    expect(screen.queryByRole("button", { name: "Quests" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.click(screen.getByRole("button", { name: "Story Cards" }));

    // Now in the editor — title is an editable input
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Workspace Test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Story Card" })).toBeInTheDocument();

    // Adventure tab returns to dashboard — heading again
    await user.click(screen.getByRole("button", { name: "Adventure" }));
    expect(screen.getByRole("heading", { name: "Workspace Test" })).toBeInTheDocument();
  });
});
