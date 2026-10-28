/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArchivedMemoryDetails, ArchivedMemoryVersions } from "./ArchivedMemoryDetails";
import { createDefaultAdventure } from "../state/defaults";
import { readHistoryInWorker } from "../memory/memoryHistoryWorker";
import { makeMemoryProposal } from "../test/goldenAdventure";
import type { CompressedMemoryHistoryBlock } from "../types/adventure";
vi.mock("../memory/memoryHistoryWorker", () => ({ readHistoryInWorker: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("does not decompress on render; explicitly opened history exposes complete original details", async () => {
  const a = createDefaultAdventure();
  const p = makeMemoryProposal();
  a.activeState.compressedMemoryHistory = { version: 1, blocks: { b: { id: "b", kind: "proposal", recordId: p.id } as CompressedMemoryHistoryBlock } };
  vi.mocked(readHistoryInWorker).mockResolvedValue({ kind: "proposal", id: p.id, value: p });
  const view = render(<ArchivedMemoryDetails adventure={a} archiveId="b" />);
  expect(readHistoryInWorker).not.toHaveBeenCalled();
  const element = view.container.querySelector("details")!; element.open = true; fireEvent(element, new Event("toggle"));
  await waitFor(() => expect(readHistoryInWorker).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Complete original record (JSON)")).toBeTruthy();
  expect(view.container.textContent).toContain(p.sourceText);
});
it("shows decode errors and preserves the block, including earlier versions after retry", async () => {
  const a = createDefaultAdventure();
  const block = { id: "b", kind: "evaluation", recordId: "source" } as CompressedMemoryHistoryBlock;
  a.activeState.compressedMemoryHistory = { version: 1, blocks: { b: block } };
  vi.mocked(readHistoryInWorker).mockRejectedValue(new Error("integrity check failed"));
  const view = render(<ArchivedMemoryVersions adventure={a} kind="evaluation" recordId="source" />);
  await act(async () => { const element = view.container.querySelector("details")!; element.open = true; fireEvent(element, new Event("toggle")); });
  expect((await screen.findByRole("alert")).textContent).toContain("integrity check failed");
  expect(a.activeState.compressedMemoryHistory.blocks.b).toBe(block);
});
