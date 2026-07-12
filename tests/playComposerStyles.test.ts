import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

describe("play composer layout contract", () => {
  it("keeps the desktop send control inside the input frame", () => {
    const css = readProjectFile("src/styles.css");

    expect(css).toMatch(/\.composer-input-row\s*{[^}]*position:\s*relative[^}]*display:\s*block/s);
    expect(css).toMatch(/\.composer-input-row textarea\s*{[^}]*padding-right:\s*62px/s);
    expect(css).toMatch(/\.composer-send-btn\s*{[^}]*position:\s*absolute[^}]*right:\s*10px[^}]*bottom:\s*10px/s);
  });

  it("keeps the phone composer as a side-by-side touch row", () => {
    const css = readProjectFile("src/styles.css");
    const mobileBlock = css.match(/@media \(max-width: 640px\) \{[\s\S]*$/)?.[0] ?? "";

    expect(mobileBlock).toMatch(/\.composer-input-row\s*{[^}]*display:\s*flex[^}]*position:\s*static/s);
    expect(mobileBlock).toMatch(/\.composer-send-btn\s*{[^}]*position:\s*static/s);
  });
});
