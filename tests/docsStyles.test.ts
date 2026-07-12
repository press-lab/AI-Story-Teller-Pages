import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("documentation layout CSS contract", () => {
  it("keeps topics visible by scrolling the docs content pane instead of the whole page", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");

    expect(css).toMatch(/\.docs-page\s*{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.docs-layout\s*{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.docs-toc\s*{[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/\.docs-content\s*{[^}]*overflow:\s*auto/s);
  });
});
