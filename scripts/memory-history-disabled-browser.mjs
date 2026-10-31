// Production-browser regression with optional read-only large fixture. Providers are mocked and external calls are blocked.
import { createServer, preview } from "vite";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
const fixturePath = process.env.STORY_TELLER_SAVE_FIXTURE;
const sourceText = fixturePath ? await readFile(fixturePath, "utf8") : undefined;
const hash = text => createHash("sha256").update(text).digest("hex");
const sourceHash = sourceText ? hash(sourceText) : undefined;
const executable = process.env.HISTORY_BROWSER ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
if (!executable) throw new Error("Set HISTORY_BROWSER to a Chromium browser executable.");
const profile = await mkdtemp(join(tmpdir(), "aist-history-browser-"));
const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
const production = await preview({ preview: { host: "127.0.0.1", port: 0, open: false } });
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

  // Use development modules only to construct a typed historical fixture.
  await cdp("Page.navigate", { url: base }); await delay(1000);
  const fixture = await evaluate(`(async () => {
    const { createDefaultAdventure } = await import(${JSON.stringify(base)}+'src/state/defaults.ts');
    const { withArchivedRecord } = await import(${JSON.stringify(base)}+'src/test/archivedMemoryFixture.ts');
    const { makeMemoryProposal } = await import(${JSON.stringify(base)}+'src/test/goldenAdventure.ts');
    const { importAdventureJson } = await import(${JSON.stringify(base)}+'src/utils/json.ts');
    const a = ${sourceText ? 'importAdventureJson('+JSON.stringify(sourceText)+')' : "createDefaultAdventure('Compression disabled browser regression')"};
    if (!${Boolean(sourceText)}) { a.components = []; a.openingScene = 'Mira waits beside the gate.'; }
    const p = makeMemoryProposal({id:'benchmark-archived-proposal',status:'approved'}); a.activeState.memoryProposals = [...a.activeState.memoryProposals,p];
    a.semanticEvaluationSettings.backgroundProviderConfig = {baseUrl:'https://mock.test/v1', model:'evaluator', memoryReasoningControl:'omit'};
    return await withArchivedRecord(a, {kind:'proposal',id:p.id,value:p});
  })()`);
  const instrument = `(() => {
    window.__aistCompressionMetrics = { workers:[], posts:[], timers:[], calls:[], longTasks:[], saveMs:[], firstAutosaveMs:null, gzipEncodes:0, gzipDecodes:0, fullHistoryWrites:0, maxMainThreadGapMs:0 };
    const m=window.__aistCompressionMetrics;
    const nativeInterval=window.setInterval; let previous=performance.now();
    nativeInterval(()=>{const n=performance.now();m.maxMainThreadGapMs=Math.max(m.maxMainThreadGapMs,n-previous);previous=n;},10);
    for(const name of ['CompressionStream','DecompressionStream']) { const Native=window[name]; window[name]=class extends Native {constructor(format){super(format);if(format==='gzip')m[name==='CompressionStream'?'gzipEncodes':'gzipDecodes']++;}}; }
    const workerProbe = function() {
      for(const name of ['CompressionStream','DecompressionStream']) { const Native=globalThis[name];globalThis[name]=class extends Native {constructor(format){super(format);if(format==='gzip')postMessage({__historyMetric:name==='CompressionStream'?'gzipEncodes':'gzipDecodes'});}}; }
      const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){const r=put.call(this,value,...args);if(this.name==='adventures'&&Array.isArray(value.messages))this.transaction.addEventListener('complete',()=>postMessage({__historyMetric:'fullHistoryWrites'}),{once:true});return r;};
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        const source='('+workerProbe.toString()+')();const waiting=[];const hold=e=>{waiting.push(e.data);e.stopImmediatePropagation();};addEventListener("message",hold);await import('+JSON.stringify(String(url))+');removeEventListener("message",hold);for(const data of waiting)dispatchEvent(new MessageEvent("message",{data}));';
        const probeUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        super(probeUrl,options);URL.revokeObjectURL(probeUrl);m.workers.push(String(url));this.saveStarts=new Map();
        this.addEventListener('message',event=>{if(event.data.__historyMetric){m[event.data.__historyMetric]++;event.stopImmediatePropagation();return;}const start=this.saveStarts.get(event.data.id);if(start!==undefined){m.saveMs.push(performance.now()-start);if(m.firstAutosaveMs===null&&m.firstAutosaveStart!==undefined)m.firstAutosaveMs=performance.now()-m.firstAutosaveStart;this.saveStarts.delete(event.data.id);}});
      }
      postMessage(value, ...args) { if(value.patch)this.saveStarts.set(value.id,performance.now());window.__aistCompressionMetrics.posts.push({operation:value.operation, baseRevision:value.baseRevision, patchKind:value.patch?.kind}); return super.postMessage(value,...args); }
    };
    for(const name of ['setTimeout','setInterval']) {
      const native = window[name]; window[name] = function(callback,ms,...args) {
        window.__aistCompressionMetrics.timers.push({kind:name,ms});
        // Accelerate only the existing memory-assessment idle flush in this test.
        if(ms===350&&m.firstAutosaveMs===null){const run=callback;callback=(...params)=>{if(m.firstAutosaveStart===undefined)m.firstAutosaveStart=performance.now();return run(...params);};}
        return native.call(this,callback,ms===120000?100:ms,...args);
      };
    }
    new PerformanceObserver(list => window.__aistCompressionMetrics.longTasks.push(...list.getEntries().map(e => e.duration))).observe({type:'longtask',buffered:true});
    const nativeFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (!String(url).startsWith('https://mock.test/')) { if(new URL(String(url),location.href).origin===location.origin)return nativeFetch(url,init);throw Error('External provider requests blocked by benchmark'); }
      const body = JSON.parse(init.body); window.__aistCompressionMetrics.calls.push({model:body.model});
      let content = 'Mira waits beside the gate.';
      if(body.model==='evaluator') {
        const payload=JSON.parse(body.messages.at(-1).content);
        const decision = {plot:{targets:[],reason:'No change'}, storyCards:{targets:[],reason:'No change'}, brains:{targets:[],reason:'No change'}, discovery:{needed:false,reason:'No additional durable changes',evidenceMessageIds:[]}};
        content=payload.outputAliases ? Object.keys(payload.outputAliases).map(key=>'DONE '+key).join('\\n') : JSON.stringify(payload.sources?{sources:payload.sources.map(s=>({sourceId:s.sourceId,...decision}))}:decision);
      }
      return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}),{headers:{'Content-Type':'application/json'}});
    };
  })()`;
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:instrument});
  const prodBase = production.resolvedUrls.local[0];
  await cdp('Page.navigate',{url:prodBase}); await delay(1000);
  await evaluate(`(async () => {
    const a = ${JSON.stringify(fixture)};
    localStorage.setItem('ai-story-teller-provider-settings',JSON.stringify({apiKey:'offline-test',baseUrl:'https://mock.test/v1',model:'narrator'}));
    localStorage.removeItem('ai-story-teller-provider-presets');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-story-teller',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['adventures','adventureSummaries'],'readwrite');tx.objectStore('adventures').put(a);tx.objectStore('adventureSummaries').put({id:a.id,title:a.title,createdAt:a.createdAt,updatedAt:a.updatedAt,turnCount:0,storyEntryCount:0});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  })()`);
  await cdp('Page.reload'); await delay(1000);
  const click = async text => {
    let found=false;
    for(let attempt=0;attempt<600&&!found;attempt++) {
    found = await evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled); if(b){b.click();return true;} return false;})()`);
    if(!found)await delay(100);
    }
    if(!found) { const state=await evaluate("JSON.stringify({continueDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue')?.disabled,metrics:window.__aistCompressionMetrics})");throw Error('Missing enabled button after 60 seconds: '+text+' '+state); }
    console.log('Browser step complete: '+text);
    await delay(400);
  };
  await click('Select'); await click('Continue');
  for(let i=0;i<3;i++) { await click('Continue'); await delay(700); }
  await delay(3500); // let the final normal save and memory checkpoint settle
  const savesBeforeIdle=await evaluate('window.__aistCompressionMetrics.posts.filter(p=>p.patchKind).length');
  // Observe beyond multiple historical 2-second archive-save intervals.
  await delay(6500);
  const report=await evaluate(`(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('ai-story-teller',2);r.onsuccess=()=>resolve(r.result)});
    const a=await new Promise(resolve=>{const r=db.transaction('adventures').objectStore('adventures').get(${JSON.stringify(fixture.id)});r.onsuccess=()=>resolve(r.result)});db.close();
    return {browser:navigator.userAgent,mode:'Production build; isolated fixture copy and mocked providers; 120-second assessment idle flush accelerated to 100ms',
      narrationCalls:window.__aistCompressionMetrics.calls.filter(c=>c.model==='narrator').length,memoryCalls:window.__aistCompressionMetrics.calls.filter(c=>c.model==='evaluator').length,
      gzipEncodingCalls:window.__aistCompressionMetrics.gzipEncodes,
      gzipDecodingCalls:window.__aistCompressionMetrics.gzipDecodes,
      fullHistoryDatabaseWrites:window.__aistCompressionMetrics.fullHistoryWrites,
      largestMainThreadGapMs:window.__aistCompressionMetrics.maxMainThreadGapMs,
      saveCompletionMs:window.__aistCompressionMetrics.saveMs,
      firstAutosaveCompletionMs:window.__aistCompressionMetrics.firstAutosaveMs,
      saveFileBytes:new Blob([JSON.stringify(a,null,2)]).size,
      compressionJobs:window.__aistCompressionMetrics.posts.filter(p=>p.operation==='compress').length,
      historyWorkers:window.__aistCompressionMetrics.workers.filter(u=>u.includes('memoryHistory')).length,
      persistenceWorkers:window.__aistCompressionMetrics.workers.filter(u=>u.includes('adventurePersistence')).length,
      saveWorkerRequests:window.__aistCompressionMetrics.posts.filter(p=>p.patchKind).length,
      deltaSaveRequests:window.__aistCompressionMetrics.posts.filter(p=>p.baseRevision!==undefined).length,
      compressionTimers:window.__aistCompressionMetrics.timers.filter(t=>t.ms===500||t.ms===2000).length,
      assistantMessagesAdded:a.messages.filter(m=>m.role==='assistant').length-${fixture.messages.filter(m=>m.role==='assistant').length},
      completedEvaluationsAdded:a.messages.filter(m=>m.memoryEvaluation?.status==='complete').length-${fixture.messages.filter(m=>m.memoryEvaluation?.status==='complete').length},
      newNarratorEvaluationStatuses:a.messages.slice(${fixture.messages.length}).filter(m=>m.role==='assistant').map(m=>m.memoryEvaluation?.status),
      archiveBlocksPreserved:JSON.stringify(a.activeState.compressedMemoryHistory)===${JSON.stringify(JSON.stringify(fixture.activeState.compressedMemoryHistory))},
      apiCalls:a.activeState.apiCalls.length,
      longTaskCount:window.__aistCompressionMetrics.longTasks.length,maxLongTaskMs:Math.max(0,...window.__aistCompressionMetrics.longTasks)};
  })()`);
  report.idleSaveRequests=report.saveWorkerRequests-savesBeforeIdle;
  report.sourceFileBytes=sourceText?Buffer.byteLength(sourceText):undefined;
  report.sourceSha256=sourceHash;
  report.sourceUnchanged=!sourceText || hash(await readFile(fixturePath,'utf8'))===sourceHash;
  report.saveCompletionMs.sort((a,b)=>a-b);
  report.saveCompletionMedianMs=report.saveCompletionMs[Math.floor(report.saveCompletionMs.length/2)];
  report.saveCompletionMaxMs=Math.max(0,...report.saveCompletionMs);
  console.log(JSON.stringify(report,null,2));
  if(process.env.STORY_TELLER_VALIDATION_REPORT)await writeFile(process.env.STORY_TELLER_VALIDATION_REPORT,JSON.stringify(report,null,2));
  if(report.assistantMessagesAdded!==3 || report.newNarratorEvaluationStatuses.some(s=>s!=='complete') || report.narrationCalls!==3 || (sourceText?report.memoryCalls<1:report.memoryCalls!==3) || report.compressionJobs || report.gzipEncodingCalls || report.gzipDecodingCalls || !report.sourceUnchanged || report.historyWorkers || report.compressionTimers || report.idleSaveRequests || !report.persistenceWorkers || !report.deltaSaveRequests || (sourceText?report.completedEvaluationsAdded<3:report.completedEvaluationsAdded!==3) || !report.archiveBlocksPreserved) throw Error('Production gameplay regression failed');
} finally {
  socket?.close(); child?.kill(); await server.close(); await new Promise(resolve=>production.httpServer.close(resolve));
  await delay(1000);
  if(dirname(resolve(profile))===resolve(tmpdir()) && basename(profile).startsWith('aist-history-browser-')) await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
