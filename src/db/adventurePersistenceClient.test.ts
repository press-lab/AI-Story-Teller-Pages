import { afterEach, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import type { PersistenceRequest } from "./adventurePersistenceProtocol";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
function setup(){
 const posted:PersistenceRequest[]=[];const instances:FakeWorker[]=[];
 class FakeWorker {onmessage?: (event: {data: {id:number;error?:string}})=>void;onerror?:()=>void;
 constructor(){instances.push(this);}postMessage(value:PersistenceRequest){posted.push(value);}terminate=vi.fn();}
 vi.stubGlobal('Worker',FakeWorker);return {posted,instances};
}
it("waits for the worker commit, sends small deltas, sanitizes credentials and drops the mirror on switch",async()=>{
 const {posted,instances}=setup();const {persistAdventure,releasePersistenceWorker}=await import('./adventurePersistenceClient');
 const a=createDefaultAdventure();a.modelConfig.apiKey='private-runtime-key';
 let done=false;const first=persistAdventure(a).then(()=>{done=true;});
 expect(done).toBe(false);expect(JSON.stringify(posted[0])).not.toContain('private-runtime-key');
 instances[0].onmessage!({data:{id:posted[0].id}});await first;expect(done).toBe(true);
 const next={...a,title:'Edited'};const second=persistAdventure(next);
 expect(posted[1].baseRevision).toBe(posted[0].id);expect(posted[1].patch.kind).toBe('object');
 instances[0].onmessage!({data:{id:posted[1].id}});await second;
 releasePersistenceWorker(a.id);expect(instances[0].terminate).toHaveBeenCalledOnce();
 const switched=persistAdventure(createDefaultAdventure('Other'));expect(posted[2].baseRevision).toBeUndefined();
 instances[1].onmessage!({data:{id:posted[2].id}});await switched;releasePersistenceWorker();
});
it("invalidates a failed worker mirror and retries with a full snapshot",async()=>{
 const {posted,instances}=setup();const {persistAdventure,releasePersistenceWorker}=await import('./adventurePersistenceClient');const a=createDefaultAdventure();
 const failed=persistAdventure(a);instances[0].onmessage!({data:{id:posted[0].id,error:'Transaction aborted'}});
 await expect(failed).rejects.toThrow('Transaction aborted');
 const retry=persistAdventure(a);expect(posted[1].baseRevision).toBeUndefined();expect(posted[1].patch.kind).toBe('replace');
 instances[1].onmessage!({data:{id:posted[1].id}});await retry;releasePersistenceWorker();
});

it("rejects a native worker crash, ignores stale acknowledgements and retries safely",async()=>{
 const {posted,instances}=setup();const {persistAdventure,releasePersistenceWorker}=await import('./adventurePersistenceClient');const a=createDefaultAdventure();
 const failed=persistAdventure(a);instances[0].onerror!();await expect(failed).rejects.toThrow('worker failed');
 const retry=persistAdventure(a);let committed=false;void retry.then(()=>{committed=true;});
 instances[0].onerror!();instances[1].onmessage!({data:{id:posted[0].id}});await Promise.resolve();expect(committed).toBe(false);
 expect(posted[1].baseRevision).toBeUndefined();instances[1].onmessage!({data:{id:posted[1].id}});await retry;releasePersistenceWorker();
});
