// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, defaultModelConfig } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { sendOpenAICompatibleChatCompletion } from "../providers/openAICompatible";
import { PlayPage } from "../pages/PlayPage";
import { useAdventureRuntime } from "./useAdventureRuntime";
import type { Adventure } from "../types/adventure";

vi.mock("../db/adventureDb", () => ({ saveAdventure: vi.fn(async () => undefined) }));
vi.mock("../providers/openAICompatible", () => ({ sendOpenAICompatibleChatCompletion: vi.fn() }));
vi.mock("../contextBuilder/contextBuilder", async original => {
  const actual = await original<typeof import("../contextBuilder/contextBuilder")>();
  return { ...actual, buildContext: vi.fn(actual.buildContext) };
});
vi.mock("../state/adventureReducer", async original => {
  const actual = await original<typeof import("../state/adventureReducer")>();
  return { ...actual, adventureReducer: vi.fn(actual.adventureReducer) };
});

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness() {
  const [adventure, setAdventure] = useState<Adventure | undefined>(() => {
    const initial = createDefaultAdventure("Loading feedback");
    initial.memoryDetectionSettings.enabled = false;
    initial.messages = [
      { id: "user", role: "user", content: "I look around.", createdAt: "2026-01-01" },
      { id: "assistant", role: "assistant", content: "The courtyard is quiet.", createdAt: "2026-01-01" },
    ];
    return initial;
  });
  const runtime = useAdventureRuntime(adventure, setAdventure, { ...defaultModelConfig, apiKey: "test" },
    () => {}, () => {}, () => {}, async () => {}, adventure!.memoryDetectionSettings);
  return <><button onClick={() => setAdventure(createDefaultAdventure("Other adventure"))}>Switch adventure</button><PlayPage adventure={adventure!} dispatch={() => {}} loading={runtime.loading} error={runtime.error}
    saveStatus="saved" onSubmitTurn={runtime.submitTurn} onContinue={runtime.continueTurn}
    onRegenerate={runtime.regenerateLastResponse} onBuildContext={() => {}} onOpenContext={() => {}}
    onRememberThis={async () => {}} /></>;
}

async function frame() {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(performance.now()));
  });
}

it.each(["Action", "Continue", "Retry"])("%s commits the dots before preparation, context, and provider work", async kind => {
  let finish!: (response: { content: string; raw: object }) => void;
  vi.mocked(sendOpenAICompatibleChatCompletion).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Harness />);
  if (kind === "Action") {
    fireEvent.change(screen.getByPlaceholderText("What does your character do?"), { target: { value: "I inspect the courtyard." } });
    fireEvent.click(screen.getByTitle("Send"));
  } else fireEvent.click(screen.getByRole("button", { name: kind }));
  expect(screen.getByLabelText("Generating…")).toBeTruthy();
  const assertNoPreparation = () => {
    expect(vi.mocked(adventureReducer).mock.calls.some(([, action]) => action.type === "FLUSH_PENDING_UPDATES")).toBe(false);
    expect(buildContext).not.toHaveBeenCalled();
    expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
  };
  assertNoPreparation();
  // Repeated clicks during the paint boundary cannot start another request.
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await frame();
  assertNoPreparation();
  await frame();
  expect(buildContext).toHaveBeenCalledTimes(1);
  expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Generating…")).toBeTruthy();
  await act(async () => finish({ raw: {}, content: "A breeze stirs the leaves beside the courtyard wall. A distant bell rings twice, and a guard steps into view, watching the gate with a thoughtful expression." }));
  expect(screen.queryByLabelText("Generating…")).toBeNull();
});

it.each(["hidden", "visible"] as const)("continues when a tab starts %s and animation frames become suspended", async initialVisibility => {
  vi.useFakeTimers();
  let visibility = initialVisibility;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.mocked(sendOpenAICompatibleChatCompletion).mockRejectedValue(new Error("Provider unavailable"));
  try {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Generating…")).toBeTruthy();
    expect(buildContext).not.toHaveBeenCalled();
    await act(async () => {
      if (visibility === "visible") {
        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
      }
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sendOpenAICompatibleChatCompletion).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Generating…")).toBeNull();
    expect(screen.getByText("Provider unavailable")).toBeTruthy();
    expect(frames.size).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("does not apply a delayed action to another adventure selected before paint", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch adventure" }));
  await frame();
  await frame();
  expect(buildContext).not.toHaveBeenCalled();
  expect(sendOpenAICompatibleChatCompletion).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Generating…")).toBeNull();
});
