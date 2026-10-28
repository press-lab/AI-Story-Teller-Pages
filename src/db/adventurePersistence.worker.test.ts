import { afterEach, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { createPersistencePatch, type PersistenceRequest } from "./adventurePersistenceProtocol";
const write=vi.hoisted(()=>vi.fn());vi.mock('./adventureDbCore',()=>({writeAdventure:write}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();write.mockReset();});
async function setup(){const post=vi.fn();vi.stubGlobal('postMessage',post);vi.stubGlobal('onmessage',undefined);await import('./adventurePersistence.worker');
 return {post,send:(data:PersistenceRequest)=>(globalThis as unknown as {onmessage:(e:{data:PersistenceRequest})=>Promise<void>}).onmessage({data})};}
it("acknowledges only a committed transaction and rejects stale deltas",async()=>{
 const {post,send}=await setup();const a=createDefaultAdventure();let commit!:(v:typeof a)=>void;write.mockReturnValueOnce(new Promise(resolve=>{commit=resolve;}));
 const job=send({id:1,adventureId:a.id,patch:createPersistencePatch(undefined,a)});expect(post).not.toHaveBeenCalled();
 commit(a);await job;expect(post).toHaveBeenLastCalledWith({id:1});
 await send({id:2,baseRevision:0,adventureId:a.id,patch:createPersistencePatch(a,{...a,title:'Stale'})});
 expect(write).toHaveBeenCalledTimes(1);expect(post.mock.calls.at(-1)![0].error).toContain('baseline changed');
 write.mockImplementation(async v=>v);const next={...a,title:'Latest'};
 await send({id:3,baseRevision:1,adventureId:a.id,patch:createPersistencePatch(a,next)});
 expect(write.mock.calls.at(-1)![0]).toEqual(next);expect(post).toHaveBeenLastCalledWith({id:3});
});
it("a failed transaction cannot advance or mutate the worker mirror",async()=>{
 const {post,send}=await setup();const a=createDefaultAdventure();write.mockImplementation(async v=>v);
 await send({id:1,adventureId:a.id,patch:createPersistencePatch(undefined,a)});
 const failed={...a,metadata:{...a.metadata,failedOnly:true}};write.mockRejectedValueOnce(new Error('Quota'));
 await send({id:2,baseRevision:1,adventureId:a.id,patch:createPersistencePatch(a,failed)});
 expect(post.mock.calls.at(-1)![0].error).toBe('Quota');
 const next={...a,title:'Retry'};await send({id:3,baseRevision:1,adventureId:a.id,patch:createPersistencePatch(a,next)});
 expect(write.mock.calls.at(-1)![0]).toStrictEqual(next);
});
