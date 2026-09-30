import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5173/AI-Story-Teller/";
const viewport = { width: 1920, height: 917 };

function chromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const executablePath = chromePath();
  if (!executablePath) throw new Error("Could not find Chrome or Edge.");

  const port = await freePort();
  const profileDir = await mkdtemp(path.join(tmpdir(), "aist-chrome-profile-"));
  const auditDir = await mkdtemp(path.join(tmpdir(), "aist-full-ui-audit-"));
  const chrome = spawn(executablePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    const targetsUrl = `http://127.0.0.1:${port}/json`;
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await waitForJson(targetsUrl);
    const pageTarget = targets.find((target) => target.type === "page");
    if (!pageTarget?.webSocketDebuggerUrl) throw new Error("Could not find Chrome page target.");

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const evaluate = async (fn, arg) => {
      const expression = `(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
      }
      return result.result.value;
    };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickButton = async (scopeSelector, text, { contains = false } = {}) => {
      const result = await evaluate(({ scopeSelector, text, contains }) => {
        const scope = document.querySelector(scopeSelector) ?? document;
        const buttons = [...scope.querySelectorAll("button")].filter((button) => {
          const label = (button.textContent || "").replace(/\s+/g, " ").trim();
          return contains ? label.includes(text) : label === text;
        });
        if (buttons.length !== 1) {
          return { ok: false, count: buttons.length, labels: buttons.map((button) => (button.textContent || "").trim()).slice(0, 12) };
        }
        buttons[0].click();
        return { ok: true };
      }, { scopeSelector, text, contains });
      if (!result.ok) throw new Error(`Expected one button ${text} in ${scopeSelector}, found ${result.count}: ${JSON.stringify(result.labels)}`);
      await wait(450);
    };
    const ensureNav = async () => {
      await evaluate(() => {
        const menu = document.querySelector(".nav-show-btn");
        if (menu && getComputedStyle(menu).display !== "none") menu.click();
      });
      await wait(200);
    };
    const top = async (label) => {
      await ensureNav();
      await clickButton(".app-nav", label);
    };
    const header = async (label) => {
      await ensureNav();
      await clickButton(".header-meta", label);
    };
    const openDetails = async (scopeSelector = ".main-content") => {
      await evaluate((scopeSelector) => {
        const scope = document.querySelector(scopeSelector) ?? document;
        for (const detail of scope.querySelectorAll("details")) detail.open = true;
      }, scopeSelector);
      await wait(150);
    };

    const screenshot = async (fileName) => {
      const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const filePath = path.join(auditDir, fileName);
      await writeFile(filePath, Buffer.from(image.data, "base64"));
      return filePath;
    };

    const auditScreen = async (name, { detailsScope } = {}) => {
      if (detailsScope) await openDetails(detailsScope);
      await evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelector(".main-content")?.scrollTo?.(0, 0);
        document.querySelector(".play-sidebar-panel-body")?.scrollTo?.(0, 0);
        document.querySelector(".play-sidebar")?.scrollTo?.(0, 0);
      });
      await wait(200);
      const metrics = await evaluate((name) => {
        const root = document.documentElement;
        const body = document.body;
        const viewport = { width: innerWidth, height: innerHeight };
        const selectors = [
          ".app-header", ".main-content", ".page", ".editor-body", ".editor-tabs",
          ".play-layout", ".play-main", ".story-scroll", ".play-sidebar", ".play-sidebar-panel",
          ".play-sidebar-panel-body", ".composer", ".composer-input-row", ".story-card-item",
          ".brain-item", ".component-editor-item", ".context-preview-table", ".context-preview-shell",
          ".library-page", ".settings-page", ".import-export-page", ".memory-inbox-page",
          ".chronicle-page", ".triggers-page",
        ];
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
        };
        const selectorFor = (el) => {
          if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
          const classes = String(el.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
          return `${el.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
        };
        const overflowChildrenFor = (el, containerRect) => {
          const children = [];
          for (const child of el.querySelectorAll("*")) {
            if (!isVisible(child)) continue;
            const rect = child.getBoundingClientRect();
            const scrollDelta = child.scrollWidth - child.clientWidth;
            const rightDelta = rect.right - containerRect.right;
            const leftDelta = containerRect.left - rect.left;
            if (scrollDelta > 2 || rightDelta > 2 || leftDelta > 2) {
              children.push({
                selector: selectorFor(child),
                className: String(child.className || ""),
                scrollDelta: Math.round(scrollDelta),
                rightDelta: Math.round(rightDelta),
                leftDelta: Math.round(leftDelta),
                rect: {
                  left: Math.round(rect.left),
                  right: Math.round(rect.right),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                },
              });
            }
          }
          return children.slice(0, 8);
        };
        const directChildrenFor = (el) => {
          const children = [];
          for (const child of el.children) {
            if (!isVisible(child)) continue;
            const rect = child.getBoundingClientRect();
            const style = getComputedStyle(child);
            children.push({
              selector: selectorFor(child),
              className: String(child.className || ""),
              clientWidth: child.clientWidth,
              scrollWidth: child.scrollWidth,
              rect: {
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              computedStyle: {
                display: style.display,
                overflowX: style.overflowX,
                paddingLeft: style.paddingLeft,
                paddingRight: style.paddingRight,
                marginLeft: style.marginLeft,
                marginRight: style.marginRight,
                listStylePosition: style.listStylePosition,
              },
            });
          }
          return children.slice(0, 8);
        };
        const containersWithOverflow = [];
        for (const selector of selectors) {
          for (const el of document.querySelectorAll(selector)) {
            if (!isVisible(el)) continue;
            const delta = el.scrollWidth - el.clientWidth;
            if (delta > 2) {
              const rect = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              containersWithOverflow.push({
                selector,
                className: String(el.className || ""),
                overflowX: delta,
                clientWidth: el.clientWidth,
                scrollWidth: el.scrollWidth,
                rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) },
                computedStyle: {
                  display: style.display,
                  overflowX: style.overflowX,
                  paddingLeft: style.paddingLeft,
                  paddingRight: style.paddingRight,
                  marginLeft: style.marginLeft,
                  marginRight: style.marginRight,
                  listStylePosition: style.listStylePosition,
                },
                directChildren: directChildrenFor(el),
                overflowChildren: overflowChildrenFor(el, rect),
              });
            }
          }
        }
        const protrusions = [];
        const collapsedText = [];
        const collapsedControls = [];
        const internalOverflow = [];
        for (const el of document.querySelectorAll("body *")) {
          if (!isVisible(el)) continue;
          const rect = el.getBoundingClientRect();
          const visibleY = rect.bottom >= 0 && rect.top <= viewport.height;
          const selector = selectorFor(el);
          const style = getComputedStyle(el);
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || "";
          if (visibleY && (rect.right > viewport.width + 2 || rect.left < -2)) {
            protrusions.push({ selector, className: String(el.className || ""), rect: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) } });
          }
          const isNativeTinyControl = tag === "input" && ["checkbox", "radio"].includes(el.type);
          if (!isNativeTinyControl && visibleY && (tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary" || role === "button") && (rect.height < 16 || rect.width < 16)) {
            collapsedControls.push({ selector, tag, role, rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) } });
          }
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (visibleY && text.length > 30 && rect.height < 8 && !["script", "style", "option"].includes(tag)) {
            collapsedText.push({ selector, className: String(el.className || ""), textLength: text.length, rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) } });
          }
          if (visibleY && el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 2) {
            const important = /context|story-card|brain|component|editor|play|composer|library|settings|import|memory|trigger|chronicle/.test(selector);
            if (important && style.overflowX !== "auto" && style.overflowX !== "scroll") {
              internalOverflow.push({ selector, className: String(el.className || ""), overflowX: style.overflowX, delta: el.scrollWidth - el.clientWidth, rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) } });
            }
          }
        }
        const documentOverflowX = Math.max(root.scrollWidth, body.scrollWidth) - innerWidth;
        return {
          name,
          viewport,
          activeNav: [...document.querySelectorAll(".app-nav button.active")].map((button) => button.textContent?.trim()),
          activeEditorTabs: [...document.querySelectorAll(".editor-tabs button.active")].map((button) => button.textContent?.trim()),
          activePlayTools: [...document.querySelectorAll(".play-tool-nav button.active-tool,.play-tool-row button.active-tool")].map((button) => button.textContent?.trim()),
          h1: document.querySelector("h1")?.textContent?.trim() || "",
          h2: document.querySelector("h2")?.textContent?.trim() || "",
          documentOverflowX,
          containersWithOverflow: containersWithOverflow.slice(0, 10),
          protrusions: protrusions.slice(0, 10),
          collapsedText: collapsedText.slice(0, 10),
          collapsedControls: collapsedControls.slice(0, 10),
          internalOverflow: internalOverflow.slice(0, 10),
          counts: {
            protrusions: protrusions.length,
            collapsedText: collapsedText.length,
            collapsedControls: collapsedControls.length,
            internalOverflow: internalOverflow.length,
          },
        };
      }, name);
      const failures = [];
      if (metrics.documentOverflowX > 2) failures.push(`documentOverflowX=${metrics.documentOverflowX}`);
      if (metrics.containersWithOverflow.length) failures.push(`containersWithOverflow=${metrics.containersWithOverflow.length}`);
      if (metrics.protrusions.length) failures.push(`protrusions=${metrics.counts.protrusions}`);
      if (metrics.collapsedText.length) failures.push(`collapsedText=${metrics.counts.collapsedText}`);
      if (metrics.collapsedControls.length) failures.push(`collapsedControls=${metrics.counts.collapsedControls}`);
      if (metrics.internalOverflow.length) failures.push(`internalOverflow=${metrics.counts.internalOverflow}`);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
      const screenshotPath = await screenshot(`${String(results.length + 1).padStart(2, "0")}-${slug}.png`);
      results.push({ name, screenshotPath, failures, metrics });
    };

    const navigateApp = async () => {
      await cdp.send("Page.navigate", { url: baseUrl });
      await wait(1200);
      const hasAdventure = await evaluate(() => {
        const button = [...document.querySelectorAll(".app-nav button")].find((item) => item.textContent?.trim() === "Adventure");
        return !!button && !button.disabled;
      });
      if (hasAdventure) return;
      const loaded = await evaluate(() => {
        const arcane = [...document.querySelectorAll(".library-card")].find((card) => card.textContent?.includes("Arcane: After the Rocket"));
        const select = arcane ? [...arcane.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Select") : null;
        if (select) { select.click(); return "saved"; }
        return "";
      });
      if (loaded) { await wait(900); return; }
      await clickButton(".library-header", "Premade Library");
      await evaluate(() => {
        const arcane = [...document.querySelectorAll(".library-card")].find((card) => card.textContent?.includes("Arcane: After the Rocket"));
        const load = arcane ? [...arcane.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Load") : null;
        if (!load) throw new Error("Arcane premade load button not found");
        load.click();
      });
      await wait(900);
    };

    const results = [];
    await navigateApp();

    await top("Library");
    await auditScreen("Library - saved adventures");
    await clickButton(".library-header", "Premade Library");
    await auditScreen("Library - premade library", { detailsScope: ".main-content" });
    await clickButton(".main-content", "Library", { contains: true });
    await clickButton(".library-header", "Load from GitHub");
    await auditScreen("Library - GitHub save slots", { detailsScope: ".main-content" });
    await clickButton(".main-content", "Library", { contains: true });
    await clickButton(".library-header", "New Adventure");
    await auditScreen("Library - new adventure", { detailsScope: ".main-content" });

    await top("Adventure");
    await auditScreen("Adventure dashboard", { detailsScope: ".main-content" });

    await top("Play");
    await openDetails(".play-sidebar");
    await auditScreen("Play - base with story layout open");
    const composerOpen = await evaluate(() => !!document.querySelector(".composer:not(.composer-input-closed)"));
    if (!composerOpen) await clickButton(".composer-actions", "Take a Turn");
    await auditScreen("Play - composer open");
    for (const tool of ["Plot", "Cards", "Characters", "Memory", "Context"]) {
      await clickButton(".play-sidebar .play-tool-nav", tool, { contains: tool === "Context" ? false : false });
      await auditScreen(`Play sidebar - ${tool}`, { detailsScope: ".play-sidebar-panel-body" });
    }
    await clickButton(".play-sidebar .play-tool-nav", "Edit All");
    await auditScreen("Play toolbar - Edit All destination", { detailsScope: ".main-content" });

    await top("Edit");
    for (const label of ["Plot", "Story Cards", "Characters", "Memory", "Chronicle", "Automation", "Context", "Saves", "Import / Export"]) {
      await clickButton(".editor-tabs", label);
      await auditScreen(`Edit - ${label}`, { detailsScope: ".editor-body" });
      if (label === "Import / Export") {
        for (const mode of ["Back Up", "Restore", "Migrate"]) {
          await clickButton(".import-export-mode-switch", mode, { contains: true });
          await auditScreen(`Edit - Import Export - ${mode}`, { detailsScope: ".editor-body" });
        }
      }
    }

    await header("Settings");
    await auditScreen("Settings - all sections open", { detailsScope: ".main-content" });
    await header("Docs");
    await auditScreen("Docs - help", { detailsScope: ".main-content" });

    const report = {
      baseUrl,
      viewport,
      auditDir,
      screenCount: results.length,
      failures: results.filter((result) => result.failures.length),
      screens: results.map((result) => ({
        name: result.name,
        screenshotPath: result.screenshotPath,
        failures: result.failures,
        activeNav: result.metrics.activeNav,
        activeEditorTabs: result.metrics.activeEditorTabs,
        activePlayTools: result.metrics.activePlayTools,
        documentOverflowX: result.metrics.documentOverflowX,
        counts: result.metrics.counts,
      })),
    };
    const reportPath = path.join(auditDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reportPath, screenCount: report.screenCount, failureCount: report.failures.length, failures: report.failures.map((failure) => ({ name: failure.name, failures: failure.failures, screenshotPath: failure.screenshotPath })) }, null, 2));
    if (report.failures.length > 0) process.exitCode = 1;
    cdp.close();
  } finally {
    chrome.kill();
    try {
      await rm(profileDir, { recursive: true, force: true });
    } catch {
      // Chrome may keep Crashpad metrics files open briefly after exit.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
