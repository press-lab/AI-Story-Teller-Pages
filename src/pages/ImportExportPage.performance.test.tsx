/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImportExportPage } from "./ImportExportPage";
import { createDefaultAdventure } from "../state/defaults";
import * as json from "../utils/json";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("serializes only for an explicitly requested backup, including after unrelated renders", () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:backup"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const encode = vi.spyOn(json, "exportAdventureJson");
  const a = createDefaultAdventure("Large save");
  const props = { adventure: a, dispatch: vi.fn(), onImportAdventure: vi.fn() };
  const view = render(<ImportExportPage {...props} />);
  expect(encode).not.toHaveBeenCalled();
  view.rerender(<ImportExportPage {...props} adventure={{ ...a, title: "Edited" }} />);
  expect(encode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download full backup" }));
  expect(encode).toHaveBeenCalledOnce();
  expect(screen.getByText(/KB JSON/)).toBeTruthy();
});
