/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAdventureGen } from "../ai/adventureGen";
import type { NewAdventureSetup } from "../types/adventure";
import { createDefaultAdventure } from "../state/defaults";
import { AdventuresPage } from "./AdventuresPage";

vi.mock("../ai/adventureGen", () => ({
  runAdventureGen: vi.fn(),
}));

function renderAdventuresPage(
  onCreate = vi.fn(async (_setup: NewAdventureSetup) => undefined),
  syncProps: Partial<ComponentProps<typeof AdventuresPage>> = {},
) {
  render(
    <AdventuresPage
      adventures={[]}
      onCreate={onCreate}
      onOpen={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      {...syncProps}
    />,
  );
  return { onCreate };
}

describe("AdventuresPage new adventure setup", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(runAdventureGen).mockReset();
  });

  it("creates a new adventure with starter components and manual Story Cards", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderAdventuresPage();

    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    await user.clear(screen.getByLabelText("Adventure title"));
    await user.type(screen.getByLabelText("Adventure title"), "Setup Test");
    await user.type(screen.getByPlaceholderText(/The scene opens/), "Rain cuts across the bridge.");

    await user.click(screen.getByRole("button", { name: "Add Plot Essentials" }));
    const componentContentFields = screen.getAllByLabelText("Content");
    await user.type(componentContentFields[componentContentFields.length - 1], "The city is under siege.");

    await user.click(screen.getByRole("button", { name: "Add Manual Card" }));
    const titleFields = screen.getAllByLabelText("Title");
    await user.clear(titleFields[titleFields.length - 1]);
    await user.type(titleFields[titleFields.length - 1], "Margo");
    await user.type(screen.getByLabelText("Triggers / keys"), "Margo, hedge prince");
    const allContentFields = screen.getAllByLabelText("Content");
    await user.type(allContentFields[allContentFields.length - 1], "Margo calls Seth hedge prince as a private joke.");

    await user.click(screen.getByRole("button", { name: "Create Adventure" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const setup = onCreate.mock.calls[0][0];
    expect(setup.title).toBe("Setup Test");
    expect(setup.openingScene).toBe("Rain cuts across the bridge.");
    expect(setup.thumbnailImage).toBeUndefined();
    expect(setup.components).toHaveLength(2);
    expect(setup.components.find((component) => component.type === "plotEssentials")).toMatchObject({
      title: "Plot Essentials",
      type: "plotEssentials",
      content: "The city is under siege.",
      alwaysOn: true,
      protected: true,
    });
    expect(setup.storyCards).toHaveLength(1);
    expect(setup.storyCards[0]).toMatchObject({
      title: "Margo",
      keys: ["Margo", "hedge prince"],
      content: "Margo calls Seth hedge prince as a private joke.",
    });
  });

  it("imports Story Cards from an uploaded JSON file before creating the adventure", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderAdventuresPage();
    const file = new File(
      [
        JSON.stringify([
          {
            title: "Ward Threshold",
            keys: "ward, threshold",
            entry: "Magic cannot cross the warded threshold.",
            type: "lore",
          },
        ]),
      ],
      "story-cards.json",
      { type: "application/json" },
    );

    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    await user.upload(screen.getByLabelText("Upload .json file"), file);

    await waitFor(() => expect(screen.getByText("1 JSON Story Card(s) ready")).toBeInTheDocument());
    expect(screen.getByText("Ward Threshold")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Adventure" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0].storyCards).toHaveLength(1);
    expect(onCreate.mock.calls[0][0].storyCards[0]).toMatchObject({
      title: "Ward Threshold",
      keys: ["ward", "threshold"],
      content: "Magic cannot cross the warded threshold.",
      type: "lore",
    });
  });

  it("imports a full AIST adventure JSON from the create adventure flow", async () => {
    const user = userEvent.setup();
    const onCreateAdventureFromImport = vi.fn(async (_adventure: unknown) => undefined);
    const onOpenImportedAdventure = vi.fn();
    const adventure = {
      ...createDefaultAdventure("Loaded AIST Adventure"),
      id: "adv-imported-aist",
      messages: [
        {
          id: "msg-1",
          role: "assistant" as const,
          content: "The old scene breathes again.",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const file = new File([JSON.stringify(adventure)], "loaded-aist.json", { type: "application/json" });

    renderAdventuresPage(undefined, { onCreateAdventureFromImport, onOpenImportedAdventure });

    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    await user.click(screen.getByRole("button", { name: "Import from AIST" }));
    await user.upload(screen.getByLabelText("AIST adventure JSON"), file);

    await waitFor(() => expect(screen.getByText("Loaded AIST Adventure")).toBeInTheDocument());
    expect(screen.getByText("Ready to import")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import and open" }));

    expect(onCreateAdventureFromImport).toHaveBeenCalledTimes(1);
    expect(onCreateAdventureFromImport.mock.calls[0][0]).toMatchObject({
      id: "adv-imported-aist",
      title: "Loaded AIST Adventure",
    });
    expect(onOpenImportedAdventure).toHaveBeenCalledTimes(1);
  });

  it("prevents creation when an unpinned Story Card has no triggers", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderAdventuresPage();

    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    await user.click(screen.getByRole("button", { name: "Add Manual Card" }));
    await user.type(screen.getAllByLabelText("Content").at(-1)!, "A fact that needs to be reachable.");
    await user.click(screen.getByRole("button", { name: "Create Adventure" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/Add at least one trigger/)).toBeInTheDocument();

    await user.click(screen.getAllByLabelText("Pinned").at(-1)!);
    await user.click(screen.getByRole("button", { name: "Create Adventure" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("replaces prior generated drafts, preserves manual cards, and protects generated Plot Essentials", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async (_setup: NewAdventureSetup) => undefined);
    renderAdventuresPage(onCreate, {
      providerConfig: {
        name: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
        temperature: 1,
        maxOutputTokens: 1200,
      },
    });
    vi.mocked(runAdventureGen)
      .mockResolvedValueOnce({
        title: "First Draft",
        openingScene: "The first opening.",
        components: [
          { title: "Plot", type: "plotEssentials", content: "Old canon.", alwaysOn: false, pinned: false, priority: 80 },
          { title: "World", type: "custom", content: "Old world context.", alwaysOn: true, pinned: false, priority: 0 },
        ],
        storyCards: [
          { title: "Old Ally", type: "character", keys: ["old ally"], content: "Old card.", pinned: false, priority: 0 },
        ],
      })
      .mockResolvedValueOnce({
        title: "Second Draft",
        openingScene: "The second opening.",
        components: [
          { title: "Plot", type: "plotEssentials", content: "New canon.", alwaysOn: false, pinned: false, priority: 80 },
          { title: "Pressure", type: "activePressure", content: "The gate is failing.", alwaysOn: true, pinned: false, priority: 245 },
          { title: "World", type: "custom", content: "New world context.", alwaysOn: true, pinned: false, priority: 0 },
        ],
        storyCards: [
          { title: "New Ally", type: "character", keys: ["new ally"], content: "New card.", pinned: false, priority: 0 },
          { title: "New Ally", type: "character", keys: ["duplicate"], content: "Duplicate card.", pinned: false, priority: 0 },
        ],
      });

    await user.click(screen.getByRole("button", { name: "New Adventure" }));
    await user.click(screen.getByRole("button", { name: "Add Manual Card" }));
    const manualTitle = screen.getAllByLabelText("Title").at(-1)!;
    await user.clear(manualTitle);
    await user.type(manualTitle, "Manual Ally");
    await user.type(screen.getByLabelText("Triggers / keys"), "manual ally");
    await user.type(screen.getAllByLabelText("Content").at(-1)!, "Keep this manual card.");
    await user.type(screen.getByLabelText("Premise"), "A ward is failing.");
    await user.selectOptions(screen.getByLabelText("Story setup"), "missionLoop");
    await user.selectOptions(screen.getByLabelText("Prose mode"), "cinematic");
    await user.selectOptions(screen.getByLabelText("Player control"), "minorActions");
    await user.selectOptions(screen.getByLabelText("Adult content / NSFW"), "romanceOnly");

    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByDisplayValue("Old canon.")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByDisplayValue("New canon.")).toBeInTheDocument());

    expect(vi.mocked(runAdventureGen)).toHaveBeenLastCalledWith(
      "A ward is failing.",
      expect.objectContaining({ model: "deepseek-v4-flash" }),
      expect.objectContaining({
        storyShape: "missionLoop",
        proseMode: "cinematic",
        playerControl: "minorActions",
        adultContent: "romanceOnly",
      }),
    );

    expect(screen.queryByDisplayValue("Old canon.")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Old world context.")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Old Ally")).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue("New Ally")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Create Adventure" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const setup = onCreate.mock.calls[0][0];
    expect(setup.components.find((component) => component.type === "plotEssentials")).toMatchObject({
      content: "New canon.",
      alwaysOn: true,
      pinned: true,
      protected: true,
    });
    expect(setup.components.map((component) => component.content)).not.toContain("Old world context.");
    expect(setup.storyCards.map((card) => card.title)).toEqual(["Manual Ally", "New Ally"]);
  });

  it("shows adventure thumbnail images in the Library", () => {
    renderAdventuresPage(undefined, {
      adventures: [
        {
          id: "adv-thumbnail",
          title: "Thumbnail Adventure",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          turnCount: 12,
          storyEntryCount: 25,
          thumbnailImage: {
            dataUrl: "data:image/png;base64,abc",
            altText: "A painted fire city",
          },
        },
      ],
    });

    const image = screen.getByAltText("A painted fire city");
    expect(image).toHaveAttribute("src", "data:image/png;base64,abc");
    expect(screen.getByRole("heading", { name: "Thumbnail Adventure" })).toBeInTheDocument();
    expect(screen.getByText(/12 turns/)).toBeInTheDocument();
    expect(screen.getByText(/25 story entries/)).toBeInTheDocument();
  });

  it("shows singular turn and story-entry text in the Library", () => {
    renderAdventuresPage(undefined, {
      adventures: [
        {
          id: "adv-one-action",
          title: "One Action Adventure",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          turnCount: 1,
          storyEntryCount: 1,
        },
      ],
    });

    expect(screen.getByText(/1 turn/)).toBeInTheDocument();
    expect(screen.getByText(/1 story entry/)).toBeInTheDocument();
  });
});
