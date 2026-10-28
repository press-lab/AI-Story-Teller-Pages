// Desktop Chromium integration benchmark. No fixture content is written or logged.
// HISTORY_BROWSER optionally selects Chrome/Edge; STORY_TELLER_SAVE_FIXTURE is required.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
const fixturePath = process.env.STORY_TELLER_SAVE_FIXTURE;
if (!fixturePath) throw new Error("Set STORY_TELLER_SAVE_FIXTURE to a local adventure JSON; its contents will not be logged.");
const fixture = await readFile(fixturePath, "utf8");
const hash = text => createHash("sha256").update(text).digest("hex");
const originalHash = hash(fixture);
const executable = process.env.HISTORY_BROWSER ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
if (!executable) throw new Error("Set HISTORY_BROWSER to a Chromium browser executable.");
const profile = await mkdtemp(join(tmpdir(), "aist-history-browser-"));
const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
let child, socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore", windowsHide: true });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error("Headless browser did not start.");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let serial = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await cdp("Page.navigate", { url: base });
  await delay(1500);
  await evaluate(`window.fixtureText = ${JSON.stringify(fixture)}; undefined`);
  const report = await evaluate(`(async () => {
    const base = ${JSON.stringify(base)};
    const load = path => import(base + path);
    const [{ importAdventureJson, exportAdventureJson }, { nextHistoryRecord }, { compressHistoryInWorker, readHistoryInWorker }, { adventureReducer }, { buildContext }, db,
      ReactModule, clientModule, domModule, { MemoryInboxPage }, { MemoryDecisionsPage }] = await Promise.all([
      load('src/utils/json.ts'), load('src/memory/memoryHistory.ts'), load('src/memory/memoryHistoryWorker.ts'), load('src/state/adventureReducer.ts'), load('src/contextBuilder/contextBuilder.ts'), load('src/db/adventureDb.ts'),
      import(base + 'node_modules/.vite/deps/react.js'), import(base + 'node_modules/.vite/deps/react-dom_client.js'), import(base + 'node_modules/.vite/deps/react-dom.js'), load('src/pages/MemoryInboxPage.tsx'), load('src/pages/MemoryDecisionsPage.tsx')]);
    const React = ReactModule.default ?? ReactModule;
    const { createRoot } = clientModule.default ?? clientModule;
    const { flushSync } = domModule.default ?? domModule;
    const original = importAdventureJson(window.fixtureText); delete window.fixtureText;
    const originalJson = exportAdventureJson(original);
    let a = original;
    await new Promise(resolve => setTimeout(resolve, 0)); // exclude initial fixture parsing/serialization from worker responsiveness
    const postedMs = [], tasks = [];
    const nativePost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(...args) { const t = performance.now(); const result = nativePost.apply(this,args); postedMs.push(performance.now()-t); return result; };
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
    observer.observe({ type: 'longtask' });
    let frames = 0, animate = true;
    const frame = () => { if (animate) { frames++; requestAnimationFrame(frame); } }; requestAnimationFrame(frame);
    const records = [], attempted = new WeakSet();
    const start = performance.now(); let record;
    while ((record = nextHistoryRecord(a, attempted))) {
      attempted.add(record.value); records.push(record);
      const block = await compressHistoryInWorker(record);
      a = adventureReducer(a, { type: 'ARCHIVE_MEMORY_HISTORY', adventureId: a.id, record, block });
    }
    const compressionMs = performance.now()-start;
    await new Promise(resolve => setTimeout(resolve,100));
    animate = false; observer.disconnect(); Worker.prototype.postMessage = nativePost;
    const archivedJson = exportAdventureJson(a);
    let exact = true;
    const decodeStart = performance.now();
    for (const block of Object.values(a.activeState.compressedMemoryHistory.blocks)) {
      const decoded = await readHistoryInWorker(block);
      const expected = records.find(r => r.kind === decoded.kind && r.id === decoded.id);
      if (JSON.stringify(decoded) !== JSON.stringify(expected)) exact = false;
    }
    const onDemandAllDecodeMs = performance.now()-decodeStart;
    const median = times => times.sort((a,b)=>a-b)[Math.floor(times.length/2)];
    const measure = task => median(Array.from({length:3},()=>{ const t=performance.now(); task(); return performance.now()-t; }));
    const measureAsync = async task => { const times=[]; for(let i=0;i<3;i++){const t=performance.now();await task();times.push(performance.now()-t);}return median(times); };
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    const renderPage = (Page, adventure) => median(Array.from({length:3},()=>{ flushSync(()=>root.render(null)); const t=performance.now(); flushSync(()=>root.render(React.createElement(Page,{adventure,dispatch:()=>{},onSuggestions:()=>{}}))); return performance.now()-t; }));
    const originalInboxRenderMs=renderPage(MemoryInboxPage,original), archivedInboxRenderMs=renderPage(MemoryInboxPage,a);
    const originalDecisionsRenderMs=renderPage(MemoryDecisionsPage,original), archivedDecisionsRenderMs=renderPage(MemoryDecisionsPage,a);
    flushSync(()=>root.unmount());host.remove();
    const originalSaveMs=await measureAsync(()=>db.saveAdventure(original));
    const originalLoadMs=await measureAsync(()=>db.getAdventure(original.id));
    const archivedSaveMs=await measureAsync(()=>db.saveAdventure(a));
    const archivedLoadMs=await measureAsync(()=>db.getAdventure(a.id));
    return { browser:navigator.userAgent, environment:'Actual desktop headless Chromium; no mobile hardware tested',
      originalJsonBytes:new Blob([originalJson]).size, archivedJsonBytes:new Blob([archivedJson]).size,
      blocks:records.length, compressionMs, onDemandAllDecodeMs, exactRoundTrips:exact,
      identicalContext:JSON.stringify(buildContext(a))===JSON.stringify(buildContext(original)),
      framesDuringCompression:frames, mainThreadLongTasksDuringCompression:tasks.length, maxMainThreadLongTaskMs:Math.max(0,...tasks),
      maxRecordPostMessageMs:Math.max(...postedMs),
      originalParseMs:measure(()=>JSON.parse(originalJson)),archivedParseMs:measure(()=>JSON.parse(archivedJson)),
      originalSerializeMs:measure(()=>exportAdventureJson(original)),archivedSerializeMs:measure(()=>exportAdventureJson(a)),
      originalSaveMs,archivedSaveMs,originalLoadMs,archivedLoadMs,
      originalInboxRenderMs,archivedInboxRenderMs,originalDecisionsRenderMs,archivedDecisionsRenderMs };
  })()`);
  report.sourceUnchanged = hash(await readFile(fixturePath, "utf8")) === originalHash;
  console.log(JSON.stringify(report, null, 2));
  if (process.env.STORY_TELLER_VALIDATION_REPORT) await writeFile(process.env.STORY_TELLER_VALIDATION_REPORT, JSON.stringify(report, null, 2));
  if (!report.exactRoundTrips || !report.identicalContext || !report.sourceUnchanged || report.framesDuringCompression < 1) throw new Error("Browser history integration verification failed.");
} finally {
  socket?.close(); child?.kill(); await server.close();
  await delay(1000);
  // Only remove the newly-created, explicitly verified temporary browser profile.
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("aist-history-browser-")) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
