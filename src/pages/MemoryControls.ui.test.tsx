/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { getAdventure, saveAdventure } from "../db/adventureDb";
import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard, makeTriggerRule } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import type { Adventure, AdventureAction, TriggerAction, TriggerEvaluationMode } from "../types/adventure";
import { ComponentsPage } from "./ComponentsPage";
import { TriggersPage } from "./TriggersPage";

afterEach(cleanup);

it("shows component eligibility defaults and dispatches each component's own cooldown", async () => {
  const user = userEvent.setup();
  const initial = createDefaultAdventure();
  initial.components = [
    makeComponent({ id: "pe", type: "plotEssentials", title: "Plot Essentials", content: "Premise" }),
    makeComponent({ id: "pressure", type: "activePressure", title: "Active Pressure", content: "Threat" }),
    makeComponent({ id: "arc", type: "currentArc", title: "Current Arc", content: "Progress", lastAutoUpdateTurn: 9 }),
  ];
  const dispatchSpy = vi.fn();
  function Fixture() {
    const [adventure, setAdventure] = useState(initial);
    return <ComponentsPage adventure={adventure} dispatch={(action: AdventureAction) => {
      dispatchSpy(action);
      setAdventure(current => adventureReducer(current, action));
    }} />;
  }
  render(<Fixture />);
  const rows = [
    { id: "pe", title: "Plot Essentials", cooldown: 3, enabled: false },
    { id: "pressure", title: "Active Pressure", cooldown: 0, enabled: true },
    { id: "arc", title: "Current Arc", cooldown: 4, enabled: true },
  ];
  for (const row of rows) {
    const item = screen.getByLabelText(`Allow automatic ${row.title} updates`).closest(".component-editor-item") as HTMLElement;
    const ui = within(item);
    await user.click(item.querySelector(":scope > summary")!);
    await user.click(ui.getByText("Automation, context settings, and actions", { selector: "summary" }));
    const enable = ui.getByLabelText(`Allow automatic ${row.title} updates`);
    expect(enable).toBeVisible();
    expect((enable as HTMLInputElement).checked).toBe(row.enabled);
    expect(ui.getByText(/A cooldown does not force an update/)).toBeVisible();
    const cooldown = ui.getByLabelText("Minimum turns between memory updates");
    expect(cooldown).toHaveValue(row.cooldown);
    await user.click(enable);
    expect(dispatchSpy).toHaveBeenLastCalledWith({ type: "UPDATE_COMPONENT", componentId: row.id, patch: { autoUpdate: !row.enabled } });
    fireEvent.change(cooldown, { target: { value: String(row.cooldown + 2) } });
    expect(dispatchSpy).toHaveBeenLastCalledWith({ type: "UPDATE_COMPONENT", componentId: row.id, patch: { autoUpdateCooldownTurns: row.cooldown + 2 } });
    expect(cooldown).toHaveValue(row.cooldown + 2);
    expect(ui.getByLabelText("Recorded memory update turn")).toHaveAttribute("readonly");
    if (row.id === "arc") {
      expect(ui.getByLabelText("Recorded memory update turn")).toHaveValue("9");
      expect(ui.getByText("Automatic arc evaluation requires an active component and an Arc Premise.")).toBeVisible();
    }
  }
  for (const row of rows) {
    const item = screen.getByLabelText(`Allow automatic ${row.title} updates`).closest(".component-editor-item") as HTMLElement;
    expect(within(item).getByLabelText("Minimum turns between memory updates")).toHaveValue(row.cooldown + 2);
  }
});

const warning = "This semantic rule cannot write Plot Components . AIST skips these actions. Use automatic memory evaluation or a manual update tool.";
const blockedActions: TriggerAction[] = [
  { type: "updateComponent", componentId: "pe", patch: { content: "Saved instruction" } },
  { type: "updateComponentPressure", componentId: "pressure" },
  { type: "updateComponentArc", componentId: "arc" },
];

it.each(blockedActions)("warns for a semantic $type action without changing stored actions", async action => {
  const user = userEvent.setup();
  const a = createDefaultAdventure();
  a.triggerRules = [makeTriggerRule({ id: "rule", name: "Existing rule", evaluationMode: "semantic", actions: [action], cooldownTurns: 2 })];
  const dispatchSpy = vi.fn();
  function Fixture() {
    const [adventure, setAdventure] = useState(a);
    return <><TriggersPage adventure={adventure} dispatch={action => { dispatchSpy(action); setAdventure(current => adventureReducer(current, action)); }} />
      <output data-testid="saved">{JSON.stringify(adventure)}</output></>;
  }
  render(<Fixture />);
  expect(screen.queryByText("System memory triggers")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Enable system triggers")).not.toBeInTheDocument();
  expect(screen.queryByText("Quiet entity-only")).not.toBeInTheDocument();
  expect(screen.queryByText("Balanced story memory")).not.toBeInTheDocument();
  await user.click(document.querySelector(".trigger-rule-item > summary")!);
  expect(screen.getByRole("alert")).toHaveTextContent(warning);
  expect(dispatchSpy).not.toHaveBeenCalled();
  expect(JSON.parse((screen.getByLabelText("Actions JSON") as HTMLTextAreaElement).value)).toEqual([action]);
  fireEvent.change(screen.getByLabelText("Minimum turns between rule executions"), { target: { value: "0" } });
  expect(dispatchSpy).toHaveBeenLastCalledWith({ type: "UPDATE_TRIGGER_RULE", triggerRuleId: "rule", patch: { cooldownTurns: 0 } });
  expect(screen.getByLabelText("Minimum turns between rule executions")).toHaveValue(0);
  fireEvent.change(screen.getByLabelText("Semantic Condition"), { target: { value: "A promise changes." } });
  const saved = JSON.parse(screen.getByTestId("saved").textContent!);
  expect(saved.triggerRules[0]).toMatchObject({ cooldownTurns: 0, condition: "A promise changes.", actions: [action] });
  expect(saved.systemTriggers).toEqual(a.systemTriggers);
  await user.selectOptions(screen.getByLabelText("Evaluation Mode"), "keyword");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("saved").textContent!).triggerRules[0].actions).toEqual([action]);
});

it.each([undefined, "semantic", "keyword", "regex"] as Array<TriggerEvaluationMode | undefined>)("uses the saved rule mode to show warnings: %s", async mode => {
  const user = userEvent.setup();
  const a = createDefaultAdventure();
  const rule = makeTriggerRule({ name: "Mode test", actions: blockedActions });
  if (mode === undefined) Reflect.deleteProperty(rule, "evaluationMode");
  else rule.evaluationMode = mode;
  a.triggerRules = [rule];
  const dispatch = vi.fn();
  render(<TriggersPage adventure={a} dispatch={dispatch} />);
  await user.click(document.querySelector(".trigger-rule-item > summary")!);
  if (mode === undefined || mode === "semantic") expect(screen.getByRole("alert")).toHaveTextContent(warning);
  else expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(dispatch).not.toHaveBeenCalled();
  expect(rule.actions).toEqual(blockedActions);
});

it("does not warn for supported semantic actions", async () => {
  const user = userEvent.setup();
  const a = createDefaultAdventure();
  a.triggerRules = [makeTriggerRule({ name: "Flag", evaluationMode: "semantic", actions: [{ type: "activateStoryCard", storyCardId: "card" }] })];
  render(<TriggersPage adventure={a} dispatch={vi.fn()} />);
  await user.click(document.querySelector(".trigger-rule-item > summary")!);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("preserves current and legacy memory settings through save and reload after a UI edit", async () => {
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
  Object.defineProperty(globalThis, "IDBKeyRange", { value: IDBKeyRange, configurable: true });
  const a = createDefaultAdventure();
  a.memoryDetectionSettings = { ...a.memoryDetectionSettings, enabled: false, everyNTurns: 0 };
  a.semanticEvaluationSettings = { ...a.semanticEvaluationSettings, semanticEvalEveryNTurns: 7, };
  a.memoryAutoApprove = { ...a.memoryAutoApprove, loreStoryCard: true, otherStoryCard: true, currentArcUpdate: true };
  a.systemTriggers = { ...a.systemTriggers, enabled: false };
  a.tokenBudgetSettings = { ...a.tokenBudgetSettings };
  a.storyCards = [makeStoryCard({ title: "Legacy settings", content: "Facts", autoUpdate: false, autoUpdateCooldownTurns: 19 })];
  a.brains = [makeBrain({ characterName: "Mira", autoUpdateCooldownTurns: 6, lastUpdatedTurn: 8 })];
  a.components = [makeComponent({ id: "pe", type: "plotEssentials", title: "Plot Essentials", content: "Premise", autoUpdate: true, autoUpdateCooldownTurns: 3, lastAutoUpdateTurn: 4 })];
  const dispatch = vi.fn();
  render(<ComponentsPage adventure={a} dispatch={dispatch} />);
  fireEvent.change(screen.getByLabelText("Minimum turns between memory updates"), { target: { value: "5" } });
  const edited = adventureReducer(a, dispatch.mock.calls[0][0]);
  await saveAdventure(edited);
  const loaded = (await getAdventure(a.id))!;
  for (const key of ["memoryDetectionSettings", "semanticEvaluationSettings", "memoryAutoApprove", "systemTriggers", "tokenBudgetSettings"] as const) {
    expect(loaded[key]).toEqual(edited[key]);
  }
  expect(loaded.storyCards[0]).toMatchObject({ autoUpdate: false, autoUpdateCooldownTurns: 19 });
  expect(loaded.brains[0]).toMatchObject({ autoUpdateCooldownTurns: 6, lastUpdatedTurn: 8 });
  expect(loaded.components[0]).toMatchObject({ autoUpdate: true, autoUpdateCooldownTurns: 5, lastAutoUpdateTurn: 4 });
});
