import { expect, it } from "vitest";
import { createDefaultAdventure } from "../state/defaults";
import { applyPersistencePatch, createPersistencePatch } from "./adventurePersistenceProtocol";
it("transports exact nested values, unknown fields, property order, undefined and sparse arrays",()=>{
  const before={removed:1,array:[1,2,undefined],nested:{old:1,keep:'value'}};
  const array=new Array(5);array[1]=undefined;array[4]='end';
  const after={nested:{keep:'value',unknown:{optional:undefined}},array,added:-0};
  const patch=structuredClone(createPersistencePatch(before,after));
  const result=applyPersistencePatch(structuredClone(before),patch);
  expect(result).toStrictEqual(after);expect(JSON.stringify(result)).toBe(JSON.stringify(after));expect(before.array).toEqual([1,2,undefined]);
});
it("sends changed records and new blocks without resending an unchanged large archive or transcript",()=>{
  const before=createDefaultAdventure();
  const block={id:'b',format:'aist-memory-history' as const,version:1 as const,encoding:'typed-json-gzip-base64' as const,kind:'evaluation' as const,recordId:'m',decodedBytes:1,sha256:'0'.repeat(64),data:'large-archive-'.repeat(100_000)};
  before.activeState.compressedMemoryHistory={version:1,blocks:{b:block}};
  before.messages=Array.from({length:1000},(_,i)=>({id:String(i),role:'assistant' as const,content:'Transcript '+i,createdAt:'2000-01-01'}));
  const after={...before,messages:[...before.messages,{id:'new',role:'assistant' as const,content:'New narration',createdAt:'2000-01-01'}],activeState:{...before.activeState,turn:2}};
  const patch=createPersistencePatch(before,after);
  expect(JSON.stringify(patch).length).toBeLessThan(5000);
  expect(applyPersistencePatch(structuredClone(before),structuredClone(patch))).toStrictEqual(after);
});
