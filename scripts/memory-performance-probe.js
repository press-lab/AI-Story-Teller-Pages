(async function(base) {
 const load=path=>import(base+path);
 const [{React,createRoot,flushSync},{importAdventureJson,exportAdventureJson},db,{buildContext},single,{nextHistoryRecord},{useMemoryHistoryCompression},{useAdventureRuntime},{useAdventureAutosave},{PlayPage},{defaultModelConfig,normalizeAdventure,sanitizeAdventureForPersistence},{defaultUiPreferences},{adventureReducer}]=await Promise.all([
 load('probe-react.ts'),load('src/utils/json.ts'),load('src/db/adventureDb.ts'),load('src/contextBuilder/contextBuilder.ts'),load('src/memory/singlePassMemory.ts'),load('src/memory/memoryHistory.ts'),load('src/hooks/useMemoryHistoryCompression.ts'),load('src/hooks/useAdventureRuntime.ts'),load('src/hooks/useAdventureAutosave.ts'),load('src/pages/PlayPage.tsx'),load('src/state/defaults.ts'),load('src/pages/pageTypes.ts'),load('src/state/adventureReducer.ts')]);

 const source=window.fixtureText;delete window.fixtureText;
 const t0=performance.now();const original=importAdventureJson(source);const initialImportMs=performance.now()-t0;
 const pause=ms=>new Promise(r=>setTimeout(r,ms)), now=()=>performance.now();
 const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
 const summary=a=>({count:a.length,totalMs:a.reduce((s,x)=>s+x,0),medianMs:a.length?median(a):0,maxMs:Math.max(0,...a)});
 let phase,events,frameTimes=[],activeFrame=true,lastFrame=now();
 const raf=()=>{if(!activeFrame)return;const n=now();frameTimes.push(n-lastFrame);lastFrame=n;requestAnimationFrame(raf);};requestAnimationFrame(raf);
 const observer=new PerformanceObserver(list=>{if(events)events.tasks.push(...list.getEntries().map(e=>e.duration));});observer.observe({type:'longtask'});
 const originalGet=IDBObjectStore.prototype.get,originalPut=IDBObjectStore.prototype.put,originalPost=Worker.prototype.postMessage;
 IDBObjectStore.prototype.get=function(...args){const target=events;const t=now();const r=originalGet.apply(this,args);if(this.name==='adventures'&&target){target.getCalls++;r.addEventListener('success',()=>{const d=now();void r.result;target.getMaterialize.push(now()-d);target.getWall.push(now()-t);});}return r;};
 IDBObjectStore.prototype.put=function(...args){const t=now();const r=originalPut.apply(this,args);if(this.name==='adventures'&&events){events.putCalls++;events.putSync.push(now()-t);}return r;};
 Worker.prototype.postMessage=function(...args){const t=now();const r=originalPost.apply(this,args);if(events){events.workerJobs.push(args[0]?.patch?'persist':args[0]?.operation);events.postSync.push(now()-t);}return r;};
 const nativeFetch=window.fetch;let mockedCalls=[],blockedCalls=0;
 window.fetch=async (url,init)=>{
   const u=String(url);
   if(u.startsWith(base))return nativeFetch(url,init);
   if(!u.startsWith('https://offline.invalid/')){blockedCalls++;throw new Error('External requests disabled by diagnostic harness.');}
   const body=JSON.parse(init.body);const memory=body.model==='evaluator'||body.messages.some(m=>typeof m.content==='string'&&m.content.includes('SINGLE PASS MEMORY EXTRACTION')); mockedCalls.push(memory?'memory':'narration');
   let content='Rain taps against the closed window. Mira stands quietly beside the doorway, waiting for a response.';
   if(memory){const payload=JSON.parse(body.messages.at(-1).content);content=Object.keys(payload.outputAliases??{}).map(s=>'DONE '+s).join('\n')||'[]';}
   await pause(100);
   return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}),{headers:{'content-type':'application/json'}});
 };
 function begin(name){phase=name;frameTimes=[];lastFrame=now();events={getCalls:0,putCalls:0,getMaterialize:[],getWall:[],putSync:[],workerJobs:[],postSync:[],tasks:[],renders:[],refreshes:0};mockedCalls=[];return now();}
 function finish(t){const e=events;const r={name:phase,elapsedMs:now()-t,fullAdventureReads:e.getCalls,fullAdventureWrites:e.putCalls,getResultMaterialization:summary(e.getMaterialize),getWall:summary(e.getWall),putSynchronousClone:summary(e.putSync),reactRender:summary(e.renders),longTasks:summary(e.tasks),maxFrameGapMs:Math.max(0,...frameTimes),workerCompressionJobs:e.workerJobs.filter(x=>x==='compress').length,workerDecompressionJobs:e.workerJobs.filter(x=>x==='decompress').length,persistenceWorkerJobs:e.workerJobs.filter(x=>x==='persist').length,postMessage:summary(e.postSync),libraryRefreshes:e.refreshes,mockedRequests:mockedCalls.slice()};events=undefined;console.log('AIST_DIAG',JSON.stringify(r));return r;}
 let exposed,root,seq=0;
 function Harness({initial,compress}){
  const [a,setA]=React.useState(initial),[saveStatus,setSaveStatus]=React.useState('idle'),[ctx,setCtx]=React.useState();
  const refresh=React.useCallback(async()=>{await db.listAdventures();if(events)events.refreshes++;},[]);
  React.useEffect(()=>()=>db.releaseAdventurePersistence(a.id),[a.id]);
  const compressionError=useMemoryHistoryCompression(compress?a:undefined,setA);
  useAdventureAutosave(a,setSaveStatus,refresh);
  const provider=React.useMemo(()=>({...defaultModelConfig,apiKey:'offline',baseUrl:'https://offline.invalid/v1',model:'narrator'}),[]);
  const runtime=useAdventureRuntime(a,setA,provider,setSaveStatus,setCtx,()=>{},refresh,a.memoryDetectionSettings);
  exposed={a,setA,runtime,compressionError};
  return React.createElement(React.Profiler,{id:'Play',onRender:(_id,_phase,time)=>{if(events)events.renders.push(time);}},React.createElement(PlayPage,{adventure:a,dispatch:action=>setA(current=>adventureReducer(current,action)),contextResult:ctx,loading:runtime.loading,memoryWork:runtime.memoryWork,error:runtime.error,saveStatus,onSubmitTurn:runtime.submitTurn,onContinue:runtime.continueTurn,onRegenerate:runtime.regenerateLastResponse,onBuildContext:runtime.buildPreview,onOpenContext:()=>{},onRememberThis:runtime.rememberThis,providerPresets:[],uiPreferences:defaultUiPreferences}));
 }
 function mount(compress){
  const a={...original,id:'diagnostic-copy-'+(++seq),semanticEvaluationSettings:{...original.semanticEvaluationSettings,backgroundProviderConfig:{baseUrl:'https://offline.invalid/v1',model:'evaluator',memoryReasoningControl:'omit'}}};
  const host=document.createElement('section');host.id='lag-probe';document.body.append(host);root=createRoot(host);flushSync(()=>root.render(React.createElement(Harness,{initial:a,compress})));return a;
 }
 async function unmount(){if(root){flushSync(()=>root.unmount());root=undefined;document.getElementById('lag-probe')?.remove();}await pause(500);}
 const cases=[];
 const retryIds=original.messages.filter(m=>m.role==='assistant'&&m.memoryEvaluation?.pipeline==='singlePass'&&['pending','failed'].includes(m.memoryEvaluation.status)).slice(-3).map(m=>m.id);
 let t=begin('attached-save-open-and-idle-compression-enabled');mount(true);await pause(6500);cases.push(finish(t));
 t=begin('already-archived-save-idle-steady-state');await pause(4500);cases.push(finish(t));
 t=begin('one-narration-and-memory-cycle-compression-enabled');const n=now();await exposed.runtime.continueTurn();const turnReturnMs=now()-n;await pause(6000);const withCompression=finish(t);withCompression.turnReturnMs=turnReturnMs;withCompression.finishedMemoryStatus=exposed.runtime.memoryWork?.status??'idle';withCompression.compressionError=exposed.compressionError??null;withCompression.appErrorPresent=!!exposed.runtime.error;cases.push(withCompression);
 t=begin('explicit-three-source-memory-check-compression-enabled');await exposed.runtime.evaluateMemorySources(retryIds);await pause(3500);const memoryOn=finish(t);memoryOn.finishedMemoryStatus=exposed.runtime.memoryWork?.status??'idle';memoryOn.appErrorPresent=!!exposed.runtime.error;cases.push(memoryOn);
 await unmount();
 t=begin('attached-save-open-compression-disabled');mount(false);await pause(2600);cases.push(finish(t));
 t=begin('one-narration-and-memory-cycle-compression-disabled');const s=now();await exposed.runtime.continueTurn();const withoutTurn=now()-s;await pause(6000);const without=finish(t);without.turnReturnMs=withoutTurn;without.finishedMemoryStatus=exposed.runtime.memoryWork?.status??'idle';without.appErrorPresent=!!exposed.runtime.error;cases.push(without);
 t=begin('explicit-three-source-memory-check-compression-disabled');await exposed.runtime.evaluateMemorySources(retryIds);await pause(3500);const memoryOff=finish(t);memoryOff.finishedMemoryStatus=exposed.runtime.memoryWork?.status??'idle';memoryOff.appErrorPresent=!!exposed.runtime.error;cases.push(memoryOff);
 await unmount();
 const micros={};
 for(const [name,fn]of [['archiveEligibilityScan',()=>nextHistoryRecord(original,new WeakSet())],['contextBuild',()=>buildContext(original)],['jsonExport',()=>exportAdventureJson(original)]]){const times=[];for(let i=0;i<3;i++){const t=now();fn();times.push(now()-t);}micros[name]=summary(times);}
 const pending=original.messages.filter(m=>m.memoryEvaluation?.pipeline==='singlePass'&&['pending','failed'].includes(m.memoryEvaluation.status)).slice(-3).map(m=>m.id);
 if(pending.length){const m=now();const batch=await single.prepareSinglePassMemoryBatch(original,pending);micros.prepareThreeMemorySourcesMs=now()-m;micros.threeSourceReferencesBytes=batch.checkpoints.reduce((sum,c)=>sum+c.checkpoint.referenceState.length,0);}
 if(window.__requestedStress){
   mount(true);await pause(2600);
   window.__probeStep=async()=>{await exposed.runtime.continueTurn();await pause(50);return {messages:exposed.a.messages.length,turn:exposed.a.activeState.turn,error:exposed.runtime.error??null,compressionError:exposed.compressionError??null};};
   window.__probeStop=async()=>{for(let i=0;i<600&&exposed.runtime.memoryWork?.status==='running';i++)await pause(50);await pause(3500);await db.saveAdventure(exposed.a);
    const loaded=await db.getAdventure(exposed.a.id);
    const fullStateExact=JSON.stringify(loaded)===JSON.stringify(normalizeAdventure(sanitizeAdventureForPersistence(exposed.a)));
    const completeHistory=JSON.stringify(loaded.activeState.compressedMemoryHistory)===JSON.stringify(exposed.a.activeState.compressedMemoryHistory);
    const result={fullStateExact,completeHistory,exportImportHistory:JSON.stringify(importAdventureJson(exportAdventureJson(loaded)).activeState.compressedMemoryHistory)===JSON.stringify(loaded.activeState.compressedMemoryHistory),messages:loaded.messages.length,blocks:Object.keys(loaded.activeState.compressedMemoryHistory.blocks).length,error:!!exposed.runtime.error};await unmount();window.fetch=nativeFetch;return result;};
 }
 const r={environment:'Desktop Chrome with Vite development modules, actual React PlayPage/runtime/autosave/compression hooks, isolated fixture copy, mocked LLM transport',initialImportMs,cases,micros,blockedExternalCalls:blockedCalls,sourceRecordCounts:{messages:original.messages.length,proposals:original.activeState.memoryProposals.length,blocks:Object.keys(original.activeState.compressedMemoryHistory.blocks).length}};
 window.__probeOriginal=original;window.__probeSingle=single;
 observer.disconnect();activeFrame=false;if(!window.__requestedStress)window.fetch=nativeFetch;IDBObjectStore.prototype.get=originalGet;IDBObjectStore.prototype.put=originalPut;Worker.prototype.postMessage=originalPost;
 return r;
})
