/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import type { Adventure } from "../types/adventure";
import { DashboardPage } from "./DashboardPage";

const timestamp = "2026-01-01T00:00:00.000Z";

function dashboardAdventure(): Adventure {
  return {
    ...createDefaultAdventure("Dashboard Adventure"),
    messages: [
      { id: "msg-user", role: "user", content: "I open the door.", createdAt: timestamp },
      { id: "msg-ai", role: "assistant", content: "Rain waits outside.", createdAt: timestamp },
    ],
  };
}

describe("DashboardPage adventure detail", () => {
  afterEach(() => {
    cleanup();
  });

  it("presents the current adventure as a detail page with primary destinations", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    const onBuildContext = vi.fn();
    const onOpenContext = vi.fn();

    render(
      <DashboardPage
        adventure={dashboardAdventure()}
        dispatch={() => undefined}
        loading={false}
        saveStatus="saved"
        onSubmitTurn={async () => undefined}
        onContinue={async () => undefined}
        onRegenerate={async () => undefined}
        onBuildContext={onBuildContext}
        onOpenContext={onOpenContext}
        onRememberThis={async () => undefined}
        onOpenTab={onOpenTab}
      />,
    );

    expect(screen.getByRole("heading", { name: "Dashboard Adventure" })).toBeInTheDocument();
    expect(screen.getByText("Rain waits outside.")).toBeInTheDocument();
    expect(screen.getByText(/\d+ tokens/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onOpenTab).toHaveBeenCalledWith("play");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(onOpenTab).toHaveBeenCalledWith("edit");

    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(onBuildContext).toHaveBeenCalledTimes(1);
    expect(onOpenContext).toHaveBeenCalledTimes(1);
  });
});
