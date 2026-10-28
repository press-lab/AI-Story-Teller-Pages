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
const server = await createServer({ cacheDir: join(profile, "node_modules/.vite"), plugins: [{ name: "probe-react", resolveId(id) { if(id === "/probe-react.ts") return "\0probe-react"; }, load(id) { if(id === "\0probe-react") return 'export { default as React } from "react"; export { createRoot } from "react-dom/client"; export { flushSync } from "react-dom";'; } }], server: { host: "127.0.0.1", port: 0, open: false } });
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
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? {sessionId} : {}) })); });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await cdp("Page.navigate", { url: base });
  await delay(1500);
  await evaluate(`window.fixtureText = ${JSON.stringify(fixture)}; undefined`);
  const probe = await readFile(new URL('./memory-performance-probe.js', import.meta.url), 'utf8');
  await cdp('Runtime.enable');
  socket.addEventListener('message', ({data})=> {const msg=JSON.parse(data); if(msg.method==='Runtime.consoleAPICalled' && msg.params.args[0]?.value==='AIST_DIAG') console.log(msg.params.args[1].value); });
  await evaluate('window.__requestedStress = ' + (Number(process.env.AIST_STRESS_TURNS) || 0));
  const report = await evaluate('(' + probe + ')(' + JSON.stringify(base) + ')');
  await cdp('Profiler.enable');
  await cdp('Profiler.start');
  report.preparationInstrumentation = await evaluate(`(async()=>{
    const a=window.__probeOriginal,single=window.__probeSingle;
    const ids=a.messages.filter(m=>m.role==='assistant'&&m.memoryEvaluation?.pipeline==='singlePass'&&['pending','failed'].includes(m.memoryEvaluation.status)).slice(-3).map(m=>m.id);
    const stringify=JSON.stringify;let calls=0,ms=0,characters=0;
    JSON.stringify=function(...args){const t=performance.now();const text=stringify.apply(this,args);ms+=performance.now()-t;calls++;characters+=text?.length??0;return text;};
    const tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
    const t=performance.now();try {const batch=await single.prepareSinglePassMemoryBatch(a,ids);const elapsedMs=performance.now()-t;await new Promise(r=>setTimeout(r,50));return {elapsedMs,jsonStringifyCalls:calls,jsonStringifyMs:ms,totalCharactersSerialized:characters,referenceCount:batch.payload.references.length,longTasks:tasks};}finally{JSON.stringify=stringify;observer.disconnect();}
  })()`);
  const {profile:cpuProfile}=await cdp('Profiler.stop');
  const selfTime=new Map();for(let i=0;i<(cpuProfile.samples??[]).length;i++){const id=cpuProfile.samples[i];selfTime.set(id,(selfTime.get(id)??0)+(cpuProfile.timeDeltas?.[i]??1000));}
  report.preparationCpuHotspots=cpuProfile.nodes.map(n=>({function:n.callFrame.functionName||'(anonymous)',file:n.callFrame.url.split('/').slice(-2).join('/').split('?')[0],line:n.callFrame.lineNumber+1,selfMs:(selfTime.get(n.id)??0)/1000})).filter(n=>n.selfMs>1).sort((a,b)=>b.selfMs-a.selfMs).slice(0,18);
  if(Number(process.env.AIST_STRESS_TURNS)>0){
    async function heapSample(turn){
      await cdp('HeapProfiler.collectGarbage');const main=await cdp('Runtime.getHeapUsage');const {targetInfos}=await cdp('Target.getTargets');const workers=[];
      for(const target of targetInfos.filter(t=>t.type==='worker'&&t.url.includes('127.0.0.1'))){
        const {sessionId}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
        try{await cdp('HeapProfiler.collectGarbage',{},sessionId);const heap=await cdp('Runtime.getHeapUsage',{},sessionId);workers.push({worker:target.url.includes('Persistence')?'persistence':'compression',usedBytes:heap.usedSize});}finally{await cdp('Target.detachFromTarget',{sessionId});}
      }
      return {turn,mainUsedBytes:main.usedSize,workers};
    }
    const samples=[await heapSample(0)];let state;
    for(let i=1;i<=Number(process.env.AIST_STRESS_TURNS);i++){
      state=await evaluate('window.__probeStep()');if(state.error)throw new Error('Stress narration failed: '+state.error);
      if(i%25===0){samples.push(await heapSample(i));console.log(JSON.stringify({stressTurn:i,messages:state.messages,heap:samples.at(-1)}));}
    }
    const saved=await evaluate('window.__probeStop()');report.stress={samples,...saved};
    await evaluate('delete window.__probeStep; delete window.__probeStop; delete window.__probeOriginal; delete window.__probeSingle; undefined');
    await cdp('HeapProfiler.collectGarbage');report.stress.afterCloseMainUsedBytes=(await cdp('Runtime.getHeapUsage')).usedSize;
    if(!saved.fullStateExact||!saved.completeHistory||!saved.exportImportHistory||saved.error)throw new Error('Stress history verification failed.');
  }
  report.sourceUnchanged = hash(await readFile(fixturePath, "utf8")) === originalHash;
  console.log(JSON.stringify(report, null, 2));
  if (process.env.STORY_TELLER_VALIDATION_REPORT) await writeFile(process.env.STORY_TELLER_VALIDATION_REPORT, JSON.stringify(report, null, 2));
  if (!report.sourceUnchanged) throw new Error("The source file unexpectedly changed.");
} finally {
  socket?.close(); child?.kill(); await server.close();
  await delay(1000);
  // Only remove the newly-created, explicitly verified temporary browser profile.
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("aist-history-browser-")) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
