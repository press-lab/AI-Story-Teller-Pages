import { describe, expect, it } from "vitest";
import fs from "node:fs";

const styles = fs.readFileSync("src/styles.css", "utf8");

const cssBlock = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "gs"))];
  return matches.at(-1)?.groups?.body ?? "";
};

describe("brain thought history styles", () => {
  it("keeps clickable memory rows wrapped and compact", () => {
    const listStyles = cssBlock(".brain-history-list");
    expect(listStyles).toContain("display: flex");
    expect(listStyles).toContain("flex-direction: column");

    const entryStyles = cssBlock(".brain-history-entry");
    expect(entryStyles).toContain("flex: 0 0 auto");

    const actionStyles = cssBlock(".brain-history-entry-action");
    expect(actionStyles).toContain("display: flex");
    expect(actionStyles).toContain("flex-direction: column");
    expect(actionStyles).toContain("width: 100%");
    expect(actionStyles).toContain("white-space: normal");

    const textStyles = cssBlock(".brain-history-text");
    expect(textStyles).toContain("display: block");
    expect(textStyles).toContain("overflow: hidden");
    expect(textStyles).toContain("max-height: calc(1.45em * 2)");
    expect(textStyles).toContain("white-space: normal");
  });
});
