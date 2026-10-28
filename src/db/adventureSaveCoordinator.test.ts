import { afterEach, expect, it, vi } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
const persist=vi.hoisted(()=>vi.fn());
vi.mock('./adventurePersistenceClient',()=>({persistAdventure:persist,releasePersistenceWorker:vi.fn()}));
afterEach(()=>{vi.resetModules();persist.mockReset();});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
it("coalesces only routine saves and retains checkpoint ordering and commit acknowledgements",async()=>{
  const {saveAdventure}=await import('./adventureDb');
  const completions:Array<()=>void>=[];persist.mockImplementation(()=>new Promise<void>(resolve=>completions.push(resolve)));
  const a=createDefaultAdventure(),b={...a,title:'B'},c={...a,title:'C checkpoint'},d={...a,title:'D latest'};
  const first=saveAdventure(a),background=saveAdventure(b,{priority:'background'}),checkpoint=saveAdventure(c),latest=saveAdventure(d,{priority:'background'});
  expect(persist.mock.calls.map(c=>c[0].title)).toEqual([a.title]);
  let acknowledged=false;void checkpoint.then(()=>{acknowledged=true;});
  completions.shift()!();await first;await flush();expect(acknowledged).toBe(false);
  expect(persist.mock.calls.at(-1)![0]).toBe(c);
  completions.shift()!();await checkpoint;await flush();expect(persist.mock.calls.at(-1)![0]).toBe(d);
  completions.shift()!();await Promise.all([background,latest]);await flush();
  expect(persist).toHaveBeenCalledTimes(3);
  await saveAdventure(d,{priority:'background'});expect(persist).toHaveBeenCalledTimes(3);
});
it("upgrades a joined autosave to a checkpoint and cannot coalesce it away",async()=>{
  const {saveAdventure}=await import('./adventureDb');const completions:Array<()=>void>=[];
  persist.mockImplementation(()=>new Promise<void>(resolve=>completions.push(resolve)));
  const a=createDefaultAdventure(),b={...a,title:'claimed'},c={...a,title:'newer'};
  const first=saveAdventure(a),auto=saveAdventure(b,{priority:'background'}),claim=saveAdventure(b),last=saveAdventure(c,{priority:'background'});
  expect(claim).toBe(auto);
  completions.shift()!();await first;await flush();expect(persist.mock.calls.at(-1)![0]).toBe(b);
  completions.shift()!();await claim;await flush();expect(persist.mock.calls.at(-1)![0]).toBe(c);
  completions.shift()!();await last;await flush();
});
it("a failed checkpoint rejects and the same state can be retried",async()=>{
  const {saveAdventure}=await import('./adventureDb');const a=createDefaultAdventure();
  persist.mockRejectedValueOnce(new Error('Quota')).mockResolvedValue(undefined);
  await expect(saveAdventure(a)).rejects.toThrow('Quota');await flush();
  await saveAdventure(a);expect(persist).toHaveBeenCalledTimes(2);
});
