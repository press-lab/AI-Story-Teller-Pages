/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure } from "../state/defaults";
import type { Adventure, AdventureAction, InputMode } from "../types/adventure";
import { PlayPage } from "./PlayPage";

// jsdom doesn't implement IntersectionObserver or scrollBy
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
Element.prototype.scrollBy = () => {};
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const originalInnerWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;
const timestamp = "2026-01-01T00:00:00.000Z";
type SubmitTurnHandler = (text: string, mode: InputMode) => Promise<void>;
type AsyncHandler = () => Promise<void>;

const noopSubmitTurn: SubmitTurnHandler = async () => undefined;
const noopAsync: AsyncHandler = async () => undefined;

function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  } as unknown as MediaQueryList;
}

function setMobileComposerViewport() {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => mediaQueryList(query, query.includes("max-width: 640px") || query.includes("pointer: coarse"))),
  });
}

function restoreViewport() {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalInnerWidth });
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: originalMatchMedia });
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
}

function playAdventure(): Adventure {
  return {
    ...createDefaultAdventure("UI Adventure"),
    messages: [
      { id: "msg-user", role: "user", content: "I open the door.", createdAt: timestamp },
      { id: "msg-ai", role: "assistant", content: "Rain waits outside.", createdAt: timestamp },
    ],
  };
}

function StatefulPlayPage({
  initialAdventure = playAdventure(),
  onSubmitTurn = noopSubmitTurn,
  onContinue = noopAsync,
  onRegenerate = noopAsync,
}: {
  initialAdventure?: Adventure;
  onSubmitTurn?: SubmitTurnHandler;
  onContinue?: AsyncHandler;
  onRegenerate?: AsyncHandler;
}) {
  const [adventure, setAdventure] = useState(initialAdventure);
  const dispatch = (action: AdventureAction) => setAdventure((current) => adventureReducer(current, action));
  return (
    <PlayPage
      adventure={adventure}
      dispatch={dispatch}
      loading={false}
      saveStatus="saved"
      onSubmitTurn={onSubmitTurn}
      onContinue={onContinue}
      onRegenerate={onRegenerate}
      onBuildContext={() => undefined}
      onOpenContext={() => undefined}
      onRememberThis={async () => undefined}
    />
  );
}

describe("PlayPage AID-style controls", () => {
  afterEach(() => {
    cleanup();
    restoreViewport();
  });

  it("submits a turn, continues, and retries through the visible controls", async () => {
    const user = userEvent.setup();
    const onSubmitTurn = vi.fn<SubmitTurnHandler>(async () => undefined);
    const onContinue = vi.fn<AsyncHandler>(async () => undefined);
    const onRegenerate = vi.fn<AsyncHandler>(async () => undefined);
    render(<StatefulPlayPage onSubmitTurn={onSubmitTurn} onContinue={onContinue} onRegenerate={onRegenerate} />);

    await user.click(screen.getByRole("button", { name: "Take a Turn" })); // open composer
    await user.click(screen.getByRole("button", { name: "Story" }));
    await user.type(screen.getByPlaceholderText("Guide the next story beat..."), "The hallway tilts.");
    await user.keyboard("{Enter}");
    expect(onSubmitTurn).toHaveBeenCalledWith("The hallway tilts.", "story");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("transforms Do mode input like AID action input", async () => {
    const user = userEvent.setup();
    const onSubmitTurn = vi.fn<SubmitTurnHandler>(async () => undefined);
    render(<StatefulPlayPage onSubmitTurn={onSubmitTurn} />);

    await user.click(screen.getByRole("button", { name: "Take a Turn" })); // open composer
    await user.type(screen.getByPlaceholderText("What does your character do?"), "draw your sword");
    await user.keyboard("{Enter}");

    expect(onSubmitTurn).toHaveBeenCalledWith("You draw your sword", "do");
  });

  it("does not submit with Enter in the mobile composer", async () => {
    setMobileComposerViewport();
    const user = userEvent.setup();
    const onSubmitTurn = vi.fn<SubmitTurnHandler>(async () => undefined);
    render(<StatefulPlayPage onSubmitTurn={onSubmitTurn} />);

    await user.click(screen.getByRole("button", { name: "Take a Turn" }));
    const input = screen.getByPlaceholderText("What does your character do?");
    await user.type(input, "draw your sword");
    await user.keyboard("{Enter}");

    expect(onSubmitTurn).not.toHaveBeenCalled();
    expect(input).toHaveValue("draw your sword\n");

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmitTurn).toHaveBeenCalledWith("You draw your sword", "do");
  });

  it("edits story text inline and supports erase, undo, and redo", async () => {
    const user = userEvent.setup();
    render(<StatefulPlayPage />);

    const assistantMessage = screen.getByText("Rain waits outside.").closest("article");
    expect(assistantMessage).toBeTruthy();
    await user.click(within(assistantMessage as HTMLElement).getByRole("button", { name: "Edit" }));
    const editor = screen.getByDisplayValue("Rain waits outside.");
    await user.clear(editor);
    await user.type(editor, "Rain lashes the threshold.");
    expect(screen.getByDisplayValue("Rain lashes the threshold.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Erase" }));
    expect(screen.queryByDisplayValue("Rain lashes the threshold.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Rain lashes the threshold.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.queryByText("Rain lashes the threshold.")).not.toBeInTheDocument();
  });

  it("deletes a specific transcript entry from the story text", async () => {
    const user = userEvent.setup();
    render(<StatefulPlayPage />);

    const userMessage = screen.getByText("I open the door.").closest("article");
    expect(userMessage).toBeTruthy();
    await user.click(within(userMessage as HTMLElement).getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("I open the door.")).not.toBeInTheDocument();
    expect(screen.getByText("Rain waits outside.")).toBeInTheDocument();
  });

  it("scrolls to the top of the newest transcript entry", () => {
    const scrollCalls: Array<{ element: Element; options?: boolean | ScrollIntoViewOptions }> = [];
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      scrollCalls.push({ element: this, options });
    };

    try {
      const nextAdventure = playAdventure();
      const initialAdventure = { ...nextAdventure, messages: nextAdventure.messages.slice(0, 1) };
      const props = {
        dispatch: () => undefined,
        loading: false,
        saveStatus: "saved" as const,
        onSubmitTurn: noopSubmitTurn,
        onContinue: noopAsync,
        onRegenerate: noopAsync,
        onBuildContext: () => undefined,
        onOpenContext: () => undefined,
        onRememberThis: async () => undefined,
      };

      const { rerender } = render(<PlayPage adventure={initialAdventure} {...props} />);
      scrollCalls.length = 0;

      rerender(<PlayPage adventure={nextAdventure} {...props} />);

      const newestEntry = screen.getByText("Rain waits outside.").closest("article");
      const lastCall = scrollCalls.at(-1);
      expect(lastCall?.element).toBe(newestEntry);
      expect(lastCall?.options).toEqual({ behavior: "smooth", block: "start" });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("opens context preview from the toolkit nav", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    const onBuildContext = vi.fn();
    render(
      <PlayPage
        adventure={playAdventure()}
        dispatch={() => undefined}
        loading={false}
        saveStatus="saved"
        onSubmitTurn={noopSubmitTurn}
        onContinue={noopAsync}
        onRegenerate={noopAsync}
        onBuildContext={onBuildContext}
        onOpenContext={() => onOpenTab("context")}
        onRememberThis={async () => undefined}
        onOpenTab={onOpenTab}
      />,
    );

    const contextBtn = screen.getAllByRole("button", { name: "Context" })[0];
    await user.click(contextBtn);
    expect(onBuildContext).toHaveBeenCalledTimes(1);
    expect(onOpenTab).toHaveBeenCalledWith("context");
  });

  it("toggles the inline Remember input from the composer", async () => {
    const user = userEvent.setup();
    const onRememberThis = vi.fn().mockResolvedValue(undefined);
    render(
      <PlayPage
        adventure={playAdventure()}
        dispatch={() => undefined}
        loading={false}
        saveStatus="saved"
        onSubmitTurn={noopSubmitTurn}
        onContinue={noopAsync}
        onRegenerate={noopAsync}
        onBuildContext={() => undefined}
        onOpenContext={() => undefined}
        onRememberThis={onRememberThis}
        onOpenTab={() => undefined}
      />,
    );

    expect(screen.queryByPlaceholderText(/Mira and Kael/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remember" }));
    expect(screen.getByPlaceholderText(/Mira and Kael/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Mira and Kael/), "Kael lost his sword");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onRememberThis).toHaveBeenCalledWith("Kael lost his sword");
    // input dismisses after save
    expect(screen.queryByPlaceholderText(/Mira and Kael/)).not.toBeInTheDocument();
  });

  it("edits the visible Next Turn Note controls through reducer actions", async () => {
    const user = userEvent.setup();
    render(<StatefulPlayPage />);

    await user.click(screen.getByText("Next Turn Note (empty)", { exact: false }));
    await user.type(
      screen.getByLabelText("Visible next-output steering note"),
      "Do not resolve the argument yet.",
    );
    expect(screen.getByDisplayValue("Do not resolve the argument yet.")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Protected"));
    await user.click(screen.getByLabelText("Expires after output"));
    expect(screen.getByLabelText("Protected")).toBeChecked();
    expect(screen.getByLabelText("Expires after output")).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByDisplayValue("Do not resolve the argument yet.")).not.toBeInTheDocument();
  });

});


it.each(["running", "failed"] as const)("allows Send with %s memory and retains an unaccepted draft", async status => {
  const user = userEvent.setup(); const adventure = playAdventure(); const submit = vi.fn(async () => false);
  render(<PlayPage adventure={adventure} dispatch={vi.fn()} loading={false} saveStatus="saved"
    memoryWork={{ adventureId: adventure.id, status, sourceIds: ["msg-ai"], remaining: 1, group: "brains" }}
    onSubmitTurn={submit} onContinue={noopAsync} onRegenerate={noopAsync} onBuildContext={vi.fn()}
    onOpenContext={vi.fn()} onRememberThis={noopAsync} />);
  expect(screen.queryByText(/Updating memory/)).not.toBeInTheDocument();
  const input = screen.getByPlaceholderText("What does your character do?");
  await user.type(input, "I wait");
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(submit).toHaveBeenCalledWith("I wait", "do");
  expect(input).toHaveValue("I wait");
});

it("keeps a newer draft and ignores duplicate clicks while a submission waits for memory", async () => {
  const user = userEvent.setup(); const adventure = playAdventure();
  let finish!: (accepted: boolean) => void;
  const submit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  render(<PlayPage adventure={adventure} dispatch={vi.fn()} loading={false} saveStatus="saved"
    onSubmitTurn={submit} onContinue={noopAsync} onRegenerate={noopAsync} onBuildContext={vi.fn()}
    onOpenContext={vi.fn()} onRememberThis={noopAsync} />);
  const input = screen.getByPlaceholderText("What does your character do?");
  await user.type(input, "I wait");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(submit).toHaveBeenCalledTimes(1);
  await user.clear(input); await user.type(input, "I listen");
  await act(async () => { finish(true); });
  expect(input).toHaveValue("I listen");
});


it("opens a long transcript at recent entries and lets the player reveal and edit older entries", async () => {
  const user = userEvent.setup();
  const adventure = playAdventure();
  adventure.messages = Array.from({ length: 250 }, (_, index) => ({
    id: `long-${index}`, role: "assistant" as const, content: `Unique story entry ${index}.`, createdAt: timestamp,
  }));
  render(<StatefulPlayPage initialAdventure={adventure} />);
  expect(screen.getByText("Unique story entry 249.")).toBeInTheDocument();
  expect(screen.queryByText("Unique story entry 0.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show earlier entries (150 hidden)" }));
  expect(screen.getByText("Unique story entry 50.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show earlier entries (50 hidden)" }));
  const oldest = screen.getByText("Unique story entry 0.");
  await user.dblClick(oldest);
  expect(screen.getByDisplayValue("Unique story entry 0.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Show earlier entries/ })).not.toBeInTheDocument();
  expect(adventure.messages).toHaveLength(250);
});


it("shows completed Continue and Retry responses in a long transcript without leaving Play", async () => {
  const user = userEvent.setup();
  const initial = playAdventure();
  initial.messages = Array.from({ length: 250 }, (_, index) => ({
    id: `entry-${index}`, role: "assistant" as const, content: `Earlier entry ${index}.`, createdAt: timestamp,
  }));
  function LongPlay() {
    const [adventure, setAdventure] = useState(initial);
    const dispatch = (action: AdventureAction) => setAdventure(current => adventureReducer(current, action));
    return <PlayPage adventure={adventure} dispatch={dispatch} loading={false} saveStatus="saved"
      onSubmitTurn={noopSubmitTurn} onBuildContext={() => undefined} onOpenContext={() => undefined}
      onRememberThis={noopAsync}
      onContinue={async () => { dispatch({ type: "ADD_MESSAGE", role: "assistant", content: "The next story arrives." }); }}
      onRegenerate={async () => {
        dispatch({ type: "REMOVE_LAST_ASSISTANT_MESSAGE" });
        dispatch({ type: "ADD_MESSAGE", role: "assistant", content: "The retried story arrives." });
      }} />;
  }
  const { container } = render(<LongPlay />);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("The next story arrives.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByText("The retried story arrives.")).toBeInTheDocument();
  expect(screen.queryByText("The next story arrives.")).not.toBeInTheDocument();
  expect(container.querySelectorAll("article.message")).toHaveLength(100);
});


it("exposes clock correction during Play and dates future messages without rewriting prior entries", async () => {
  let latest = playAdventure();
  latest = adventureReducer(latest, { type: "ADD_MESSAGE", id: "old-date", role: "assistant", content: "Story date: 2001-09-02" });
  const previous = latest.messages;
  function ClockPlay() {
    const [adventure, setAdventure] = useState(latest);
    latest = adventure;
    const dispatch = (action: AdventureAction) => setAdventure(current => adventureReducer(current, action));
    return <PlayPage adventure={adventure} dispatch={dispatch} loading={false} saveStatus="saved"
      onSubmitTurn={noopSubmitTurn} onContinue={async () => dispatch({ type: "ADD_MESSAGE", id: "future-date", role: "assistant", content: "They signed an agreement." })}
      onRegenerate={noopAsync} onBuildContext={() => undefined} onOpenContext={() => undefined} onRememberThis={noopAsync} />;
  }
  render(<ClockPlay />);
  const user = userEvent.setup();
  await user.click(screen.getByText("Correct story date", { selector: "summary" }));
  const input = screen.getByLabelText("Current story time", { exact: true });
  expect(input).toBeVisible();
  expect(screen.getByText("Story time: 2001-09-02 (Sunday)")).toBeVisible();
  await user.clear(input); await user.type(input, "2001-09-04");
  await user.click(screen.getByRole("button", { name: "Apply Story Date" }));
  expect(screen.getByText("Story time: 2001-09-04 (Tuesday)")).toBeVisible();
  expect(latest.storyClock).toMatchObject({ current: { date: "2001-09-04" }, anchor: { date: "2001-09-04" }, origin: "established" });
  expect(latest.messages).toEqual(previous);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(latest.messages.at(-1)).toMatchObject({ id: "future-date", storyTime: { date: "2001-09-04" } });
  expect(latest.messages.slice(0, -1)).toEqual(previous);
});
