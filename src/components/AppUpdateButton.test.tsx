/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppUpdateButton } from "./AppUpdateButton";

afterEach(cleanup);

it("blocks repeated updates while the save and reload are pending", async () => {
  let finish!: () => void;
  const onUpdate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<AppUpdateButton onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole("button", { name: "Update app" }));
  expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button"));
  expect(onUpdate).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(screen.getByRole("button", { name: "Update app" })).toBeEnabled());
});

it("shows update or save failures and allows another attempt", async () => {
  render(<AppUpdateButton onUpdate={vi.fn().mockRejectedValue(new Error("Save failed"))} />);
  fireEvent.click(screen.getByRole("button", { name: "Update app" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(screen.getByRole("button", { name: "Update app" })).toBeEnabled();
});

it("disables updates during active work", () => {
  render(<AppUpdateButton disabled onUpdate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Update app" })).toBeDisabled();
});
