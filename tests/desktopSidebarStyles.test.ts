import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop play sidebar layout contract", () => {
  it("opens embedded tool panels at a usable desktop width", () => {
    const source = readFileSync(resolve("src/pages/PlayPage.tsx"), "utf8");

    expect(source).toContain("const PLAY_TOOLKIT_COMPACT_WIDTH = 160");
    expect(source).toContain("const PLAY_TOOLKIT_PANEL_MIN_WIDTH = 420");
    expect(source).toContain("if (!playPanelContent || toolkitWidth >= PLAY_TOOLKIT_PANEL_MIN_WIDTH) return");
    expect(source).toContain("const minWidth = playPanelContent ? PLAY_TOOLKIT_PANEL_MIN_WIDTH : PLAY_TOOLKIT_MIN_WIDTH");
  });

  it("keeps compact editor summaries inside the desktop play panel", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    const desktopCss = css.split("@media (max-width: 860px)")[0] ?? "";

    expect(desktopCss).toMatch(/\.play-sidebar-panel-body\s*{[^}]*overflow-x:\s*hidden/s);
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.story-card-item,\s*\n\.play-sidebar-panel-body \.split-editor-item,\s*\n\.play-sidebar-panel-body \.brain-item,\s*\n\.play-sidebar-panel-body \.component-editor-item\s*{[^}]*display:\s*block;[^}]*list-style-position:\s*inside;[^}]*padding:\s*0/s,
    );
    expect(desktopCss).toMatch(/\.play-sidebar-panel-body \.story-card-item > summary\s*{[^}]*list-style-position:\s*inside/s);
    expect(desktopCss).toMatch(/\.play-sidebar-panel-body \.story-card-item > summary\s*{[^}]*min-width:\s*0;[^}]*width:\s*100%;[^}]*max-width:\s*100%/s);
    expect(desktopCss).toMatch(/\.play-sidebar-panel-body \.story-card-item > \.editor-card\s*{[^}]*min-width:\s*0;[^}]*width:\s*100%;[^}]*max-width:\s*100%/s);
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.story-card-summary,\s*\n\.play-sidebar-panel-body \.proposal-card-summary,\s*\n\.play-sidebar-panel-body \.trigger-rule-summary\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.split-editor-item\[open\] > summary \.story-card-summary,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.story-card-title,\s*\n\.play-sidebar-panel-body \.story-card-keys,\s*\n\.play-sidebar-panel-body \.story-card-summary \.search-snippet\s*{[^}]*white-space:\s*normal/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.editor-surface input,\s*\n\.play-sidebar-panel-body \.editor-surface select,\s*\n\.play-sidebar-panel-body \.editor-surface textarea,\s*\n\.play-sidebar-panel-body \.editor-surface button\s*{[^}]*max-width:\s*100%/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.editor-command-bar\s*{[^}]*position:\s*static/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.component-editor-item\[open\] > summary[\s\S]*?position:\s*static/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.component-inspector > \.component-arc-details\s*{[^}]*order:\s*1/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.component-inspector > \.item-focus-section\s*{[^}]*order:\s*2/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.split-editor-list:has\(\.split-editor-item\[open\]\) \.split-editor-item,[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.brains-page > \.list:has\(\.brain-item\[open\]\) \.brain-item,[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible/s,
    );
    expect(desktopCss).not.toMatch(/\.play-sidebar-panel-body[\s\S]*?max-height:\s*min\(62vh,\s*520px\)/s);
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.component-arc-details \.field > \.row > input,[\s\S]*?flex:\s*1 1 100%/s,
    );
    expect(desktopCss).toMatch(
      /\.arc-thread-option\s*{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)[^}]*overflow-wrap:\s*anywhere/s,
    );
    expect(desktopCss).toMatch(/\.arc-thread-option > span\s*{[^}]*min-width:\s*0/s);
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-preview-page\s*{[^}]*max-width:\s*100%/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-table-wrap\s*{[^}]*overflow-x:\s*hidden/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-table\s*{[^}]*table-layout:\s*fixed/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-item-row\s*{[^}]*display:\s*table-row/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-table \.col-title\s*{[^}]*overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-table \.col-priority,[\s\S]*?\.play-sidebar-panel-body \.context-table \.col-policy\s*{[^}]*display:\s*none/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-table \.col-actions\s*{[^}]*width:\s*76px/s,
    );
    expect(desktopCss).toMatch(
      /\.play-sidebar-panel-body \.context-action-btn\s*{[^}]*min-height:\s*24px/s,
    );
    expect(desktopCss).not.toMatch(/\.play-sidebar-panel-body \.context-table thead\s*{[^}]*display:\s*none/s);
  });
});
