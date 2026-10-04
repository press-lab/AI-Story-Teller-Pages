/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { adventureReducer } from "../state/adventureReducer";
import { createDefaultAdventure, makeComponent, makeStoryCard } from "../state/defaults";
import type { Adventure, AdventureAction, ProviderConfig } from "../types/adventure";
import { ContextPreviewPage } from "./ContextPreviewPage";
import { runContextDedup } from "../ai/contextAI";

vi.mock("../ai/contextAI", () => ({
  runCondenseContent: vi.fn(async () => "Condensed pact context."),
  runContextDedup: vi.fn(async () => []),
}));

const providerConfig: ProviderConfig = {
  name: "test",
  baseUrl: "https://api.example.com",
  apiKey: "test-key",
  model: "test-model",
  temperature: 0.7,
  maxOutputTokens: 256,
};

function renderWithAdventure(
  renderPage: (adventure: Adventure, dispatch: (action: AdventureAction) => void) => ReactNode,
  initialAdventure: Adventure,
) {
  function StatefulPage() {
    const [adventure, setAdventure] = useState(initialAdventure);
    const dispatch = (action: AdventureAction) => setAdventure((current) => adventureReducer(current, action));
    return <>{renderPage(adventure, dispatch)}</>;
  }

  render(<StatefulPage />);
}

describe("ContextPreviewPage adventure details", () => {
  afterEach(() => {
    cleanup();
  });

  it("edits, adds, and removes top-level metadata through reducer actions without sending it to the model", async () => {
    const user = userEvent.setup();
    let latest: Adventure | undefined;
    const adventure: Adventure = {
      ...createDefaultAdventure("Titans: Saiyan"),
      metadata: {
        scenarioDescription: "Adult Teen Titans AU centered on an established found-family superhero team in Jump City.",
        scenarioAuthorContentRating: "everyone",
        localRevisionLabel: "Initial adult Titans Saiyan AU",
        localRevisionNotes: "Built from the Seattle AIST JSON structure.",
        premadeAdventure: true,
        thumbnailImage: { dataUrl: "data:image/png;base64,AAAA", updatedAt: "2026-10-02T07:15:00.000Z" },
      },
    };

    renderWithAdventure((current, dispatch) => {
      latest = current;
      return <ContextPreviewPage adventure={current} dispatch={dispatch} onBuildContext={() => undefined} />;
    }, adventure);

    await user.click(screen.getByText("Adventure details"));
    expect(screen.getByText(/Not sent to the model/)).toBeInTheDocument();
    expect(screen.getByText(/cover image/)).toBeInTheDocument();

    const rating = screen.getByLabelText("Scenario author content rating");
    await user.clear(rating);
    await user.type(rating, "mature");
    expect(latest?.metadata.scenarioAuthorContentRating).toBe("mature");

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Titans");
    expect(latest?.title).toBe("Titans");

    await user.click(screen.getByLabelText("Premade adventure"));
    expect(latest?.metadata.premadeAdventure).toBe(false);

    await user.click(screen.getByRole("button", { name: "Remove Local revision notes" }));
    expect(latest?.metadata).not.toHaveProperty("localRevisionNotes");
    expect(screen.queryByLabelText("Local revision notes")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("New field name"), "seriesName");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.type(screen.getByLabelText("Series name"), "Titans");
    expect(latest?.metadata.seriesName).toBe("Titans");
    expect(latest?.metadata.thumbnailImage).toEqual(adventure.metadata.thumbnailImage);

    const payload = buildContext(latest!).messages.map((message) => message.content).join("\n");
    expect(payload).not.toContain("found-family superhero team in Jump City");
  });
});

describe("ContextPreviewPage condense", () => {
  const mockRunContextDedup = vi.mocked(runContextDedup);

  afterEach(() => {
    cleanup();
  });

  it("updates compact Story Card context immediately after accepting a condensed draft", async () => {
    const user = userEvent.setup();
    const card = makeStoryCard({
      id: "card-pact",
      title: "Seth's Pact",
      content: "",
      keys: ["pact"],
      active: true,
      pinned: true,
      compactKind: "pact",
      compactStatus: "active",
      coreFacts: ["OLD CORE FACT SHOULD DISAPPEAR FROM CONTEXT"],
      currentFacts: ["OLD CURRENT FACT SHOULD DISAPPEAR FROM CONTEXT"],
      recentDevelopments: ["OLD RECENT FACT SHOULD DISAPPEAR FROM CONTEXT"],
    });
    const adventure = { ...createDefaultAdventure("Condense Test"), storyCards: [card] };
    const staleContextResult = buildContext(adventure);

    renderWithAdventure((current, dispatch) => (
      <ContextPreviewPage
        adventure={current}
        dispatch={dispatch}
        contextResult={staleContextResult}
        onBuildContext={() => undefined}
        providerConfig={providerConfig}
      />
    ), adventure);

    expect(screen.getByText(/OLD CORE FACT SHOULD DISAPPEAR/)).toBeInTheDocument();

    const cardRow = screen.getByText("Seth's Pact").closest("tr");
    expect(cardRow).not.toBeNull();
    await user.click(within(cardRow!).getByRole("button", { name: "Condense" }));
    await user.click(await screen.findByRole("button", { name: "Accept Draft" }));

    expect(screen.getByText(/Condensed pact context/)).toBeInTheDocument();
    expect(screen.queryByText(/OLD CORE FACT SHOULD DISAPPEAR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OLD CURRENT FACT SHOULD DISAPPEAR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OLD RECENT FACT SHOULD DISAPPEAR/)).not.toBeInTheDocument();
  });

  it("runs Auto Dedup deterministically unless the AI pass is checked", async () => {
    mockRunContextDedup.mockClear();
    const user = userEvent.setup();
    const duplicateText = [
      "The red ward key opens the sealed archive under the east tower.",
      "Margo hid the red ward key inside the brass lamp before the gala.",
      "Seth must keep the red ward key away from the Red Ring scouts.",
      "The archive door answers only to the red ward key and Margo's voice.",
    ].join("\n");
    const adventure = {
      ...createDefaultAdventure("Dedup Test"),
      components: [
        makeComponent({
          id: "component-ward-key",
          title: "Ward Key Plot",
          type: "plotEssentials",
          content: duplicateText,
          alwaysOn: true,
          active: true,
        }),
      ],
      storyCards: [
        makeStoryCard({
          id: "card-ward-key",
          title: "Red Ward Key",
          content: duplicateText,
          active: true,
          inclusionPolicy: "always",
          priority: 20,
        }),
      ],
    };

    renderWithAdventure((current, dispatch) => (
      <ContextPreviewPage
        adventure={current}
        dispatch={dispatch}
        onBuildContext={() => undefined}
        providerConfig={providerConfig}
      />
    ), adventure);

    await user.click(screen.getByRole("button", { name: "Auto Dedup" }));

    expect(mockRunContextDedup).not.toHaveBeenCalled();
    expect(await screen.findByText("DETECTED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Duplicate" })).toBeInTheDocument();
  });
});
