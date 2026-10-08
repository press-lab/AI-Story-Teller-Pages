/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HelpPage } from "./HelpPage";

describe("HelpPage documentation UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows technical documentation topics and filters them with search", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    expect(screen.getByRole("heading", { name: "AI Story Teller Documentation" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Context Contract" })[0]).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search docs/i), "mutation");

    expect(screen.getAllByRole("link", { name: "AI Mutation Boundaries" })[0]).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Context Contract" })).not.toBeInTheDocument();
  });

  it("documents every sidebar destination as its own searchable topic", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    [
      "Library",
      "Dashboard",
      "Play",
      "Chronicle",
      "Memory Suggestions",
      "Story Cards",
      "Character Cards — Voice Contract",
      "Characters",
      "Current Story Arc",
      "World Blocks",
      "Context Preview",
      "Automations",
      "Import / Export",
      "Settings",
      "Documentation",
    ].forEach((label) => {
      expect(screen.getAllByRole("link", { name: label })[0]).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText(/search docs/i));
    await user.type(screen.getByLabelText(/search docs/i), "chronicle");

    expect(screen.getAllByRole("link", { name: "Chronicle" })[0]).toBeInTheDocument();
    expect(screen.getByText(/complete local transcript/i)).toBeInTheDocument();
  });

  it("keeps the topics list and documentation body as separate scroll regions", () => {
    render(<HelpPage />);

    expect(document.querySelector(".docs-page")).toBeInTheDocument();
    expect(document.querySelector(".docs-toc")).toBeInTheDocument();
    expect(document.querySelector(".docs-content")).toBeInTheDocument();
  });

  it("documents Next Turn Note as an inspectable context lane", async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    await user.type(screen.getByLabelText(/search docs/i), "next turn note");

    expect(screen.getAllByText("Next Turn Note")[0]).toBeInTheDocument();
    expect(screen.getByText(/visible, token-counted, and expires after use by default/i)).toBeInTheDocument();
  });
});
