/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryInboxPage } from "./MemoryInboxPage";
import { createDefaultAdventure } from "../state/defaults";
afterEach(cleanup);
it("starts a Chronicle event scan and exposes progress and cancellation", async () => {
  let release!: () => void;
  let signal!: AbortSignal;
  const scan = vi.fn(async (progress: (s: string) => void, value: AbortSignal) => {
    signal = value;
    progress("Reading messages 1–24 of 50");
    await new Promise<void>(resolve => { release = resolve; });
    progress("Stopped: 1 Event Memory suggestions added for review.");
  });
  render(<MemoryInboxPage adventure={createDefaultAdventure("Seattle")} dispatch={vi.fn()} onFindEventMemories={scan} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Find event memories in earlier play" }));
  expect(screen.getByRole("status")).toHaveTextContent("Reading messages");
  expect(screen.getByRole("button", { name: "Find event memories in earlier play" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Stop after current excerpt" }));
  expect(signal.aborted).toBe(true);
  release();
  expect(await screen.findByText("Stopped: 1 Event Memory suggestions added for review.")).toBeInTheDocument();
});
