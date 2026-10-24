/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { BrainsPage } from "./BrainsPage";
import { createDefaultAdventure, makeBrain } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { orderedBrains } from "../state/brainOrder";

afterEach(cleanup);
function seed() {
  const adventure = createDefaultAdventure();
  adventure.brains = [
    makeBrain({ id: "mira", characterName: "Mira Researcher", priority: 100, inclusionPolicy: "always", thoughts: { thought: "I will check the runes." } }),
    makeBrain({ id: "vi", characterName: "Vi", priority: 70, inclusionPolicy: "always", thoughts: { thought: "I will guard the gate." } }),
    makeBrain({ id: "mel", characterName: "Mel Researcher", priority: 30, inclusionPolicy: "always", thoughts: { thought: "I will negotiate." } }),
  ];
  return adventure;
}
const names = () => [...document.querySelectorAll(".brain-item > summary .story-card-title")].map(element => element.textContent);
function Editor() {
  const [adventure, setAdventure] = useState(seed);
  return <>
    <button onClick={() => setAdventure(importAdventureJson(exportAdventureJson(adventure)))}>Reload exported adventure</button>
    <BrainsPage adventure={adventure} dispatch={action => setAdventure(state => adventureReducer(state, action))}
      loading={false} onUpdateBrainNow={vi.fn()} />
  </>;
}

it("moves collapsed rows in either direction and retains the saved order after export/import", async () => {
  const user = userEvent.setup(); render(<Editor />);
  expect(screen.getByRole("button", { name: "Move Mira Researcher up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Mel Researcher down" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Move Mel Researcher up" }));
  expect(names()).toEqual(["Mira Researcher", "Mel Researcher", "Vi"]);
  expect([...document.querySelectorAll(".brain-item")].every(element => !element.hasAttribute("open"))).toBe(true);
  await user.click(screen.getByRole("button", { name: "Move Mira Researcher down" }));
  expect(names()).toEqual(["Mel Researcher", "Mira Researcher", "Vi"]);
  await user.click(screen.getByRole("button", { name: "Reload exported adventure" }));
  expect(names()).toEqual(["Mel Researcher", "Mira Researcher", "Vi"]);
});

it("reorders matching characters during search while preserving hidden characters", async () => {
  const user = userEvent.setup(); render(<Editor />);
  const search = screen.getByPlaceholderText("Search characters...");
  await user.type(search, "Researcher");
  expect(names()).toEqual(["Mira Researcher", "Mel Researcher"]);
  await user.click(screen.getByRole("button", { name: "Move Mel Researcher up" }));
  expect(names()).toEqual(["Mel Researcher", "Mira Researcher"]);
  await user.clear(search);
  expect(names()).toEqual(["Mel Researcher", "Vi", "Mira Researcher"]);
});

it("changes display order without mutating Brain contents, priorities or provider context", () => {
  const before = seed();
  const after = adventureReducer(before, { type: "REORDER_BRAIN", brainId: "mel", direction: "up", neighborId: "mira" });
  expect(orderedBrains(after).map(brain => brain.id)).toEqual(["mel", "vi", "mira"]);
  expect(after.brains).toBe(before.brains);
  expect(buildContext(after).messages).toEqual(buildContext(before).messages);
  const imported = importAdventureJson(exportAdventureJson(after));
  expect(orderedBrains(imported).map(brain => brain.id)).toEqual(["mel", "vi", "mira"]);
  expect(imported.brains.map(brain => brain.priority)).toEqual([100, 70, 30]);
});
