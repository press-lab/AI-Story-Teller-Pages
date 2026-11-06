import { describe, expect, it } from "vitest";
import fs from "node:fs";

const styles = fs.readFileSync("src/styles.css", "utf8");

const cssBlock = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "gs"))];
  return matches.at(-1)?.groups?.body ?? "";
};

describe("brain thought history styles", () => {
  it("keeps clickable memory rows wrapped and readable in the page flow", () => {
    const listStyles = cssBlock(".brain-history-list");
    expect(listStyles).toContain("display: flex");
    expect(listStyles).toContain("flex-direction: column");
    // No inner scroll box: it trapped touch scrolling on mobile.
    expect(listStyles).toContain("max-height: none");
    expect(listStyles).toContain("overflow: visible");

    const entryStyles = cssBlock(".brain-history-entry");
    expect(entryStyles).toContain("flex: 0 0 auto");

    const actionStyles = cssBlock(".brain-history-entry-action");
    expect(actionStyles).toContain("display: flex");
    expect(actionStyles).toContain("flex-direction: column");
    expect(actionStyles).toContain("width: 100%");
    expect(actionStyles).toContain("white-space: normal");

    const textStyles = cssBlock(".brain-history-text");
    expect(textStyles).toContain("display: block");
    // Full thought text is shown; it used to be clipped mid-line at two lines.
    expect(textStyles).toContain("overflow: visible");
    expect(textStyles).toContain("max-height: none");
    expect(textStyles).toContain("white-space: normal");
  });
});
