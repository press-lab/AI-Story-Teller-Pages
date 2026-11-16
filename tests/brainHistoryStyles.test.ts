import { describe, expect, it } from "vitest";
import fs from "node:fs";

const styles = fs.readFileSync("src/styles.css", "utf8");

const cssBlock = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "gs"))];
  return matches.map((match) => match.groups?.body ?? "").join("\n");
};

describe("brain thought history styles", () => {
  it("shows complete thoughts in wrapped, non-shrinking clickable rows", () => {
    const listStyles = cssBlock(".brain-history-list");
    expect(listStyles).toContain("display: flex");
    expect(listStyles).toContain("flex-direction: column");
    expect(listStyles).toContain("max-height: min(60dvh, 480px)");

    const entryStyles = cssBlock(".brain-history-entry");
    expect(entryStyles).toContain("flex: 0 0 auto");

    const actionStyles = cssBlock(".brain-history-entry-action");
    expect(actionStyles).toContain("display: flex");
    expect(actionStyles).toContain("flex-direction: column");
    expect(actionStyles).toContain("width: 100%");
    expect(actionStyles).toContain("white-space: normal");

    const textStyles = cssBlock(".brain-history-text");
    expect(textStyles).toContain("display: block");
    expect(textStyles).not.toContain("overflow: hidden");
    expect(textStyles).not.toContain("max-height:");
    expect(textStyles).toContain("white-space: pre-wrap");
  });
});
