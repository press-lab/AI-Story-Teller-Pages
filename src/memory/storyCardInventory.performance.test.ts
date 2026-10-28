import { afterEach, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { normalizeMemoryText, relevantStoryCardInventory } from "./storyCardSuggestions";
import type { Adventure } from "../types/adventure";
afterEach(() => vi.restoreAllMocks());
// Locked copy of the pre-optimization selection rules, including ties and empty normalized keys.
function original(a: Adventure, text: string) {
  const stop = new Set("the a an and but then now later today tomorrow yesterday i you he she they we it his her their our my your yes no january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ministry current story date flashback candidate first possible political ordinary dinner breakfast lunch evening night meanwhile suddenly after before nearby fuck silver morning".split(" "));
  const words = (s: string) => new Set(normalizeMemoryText(s).split(" ").filter(w => w.length > 3 && !stop.has(w)));
  const known = words(text);
  return a.storyCards.map(card => ({ card, score: [card.title, ...card.keys].filter(name => Boolean(name.trim()) && (` ${normalizeMemoryText(text)} `).includes(` ${normalizeMemoryText(name)} `)).length * 10
    + [...words(card.title + " " + card.keys.join(" "))].filter(w => known.has(w)).length }))
    .filter(e => e.score >= 2).sort((a,b) => b.score-a.score || b.card.priority-a.card.priority).slice(0,8)
    .map(({card}) => ({id:card.id,title:card.title.slice(0,100),type:card.type,keys:card.keys.slice(0,3)}));
}
it("preserves inventory contents/order for Unicode, duplicate/empty keys, ties and edits", () => {
  const a=createDefaultAdventure();
  a.storyCards=Array.from({length:30},(_,i)=>makeStoryCard({content:'Profile',id:String(i),title:i%2?'Ａvery research':'Zoë workshop',keys:['research','research',i%3?'workshop':'😀',''],priority:i%4}));
  for(const text of ['Ａvery researches at Zoë’s workshop.','research workshop','', '😀','Unrelated scenery.']) expect(relevantStoryCardInventory(a,text)).toEqual(original(a,text));
  a.storyCards[0].keys=['Unrelated scenery'];a.storyCards[0].priority=99;
  expect(relevantStoryCardInventory(a,'Unrelated scenery.')).toEqual(original(a,'Unrelated scenery.'));
  const next={...a,storyCards:a.storyCards.map((c,i)=>i===2?{...c,title:'Unrelated scenery'}:c)};
  expect(relevantStoryCardInventory(next,'Unrelated scenery.')).toEqual(original(next,'Unrelated scenery.'));
});
it("normalizes the source once and reuses an exact bounded lookup without exposing cached arrays", () => {
  const a=createDefaultAdventure();a.storyCards=[makeStoryCard({content:'Profile',title:'Workshop research',keys:['workshop','research']})];
  const text='A distinctive workshop research excerpt repeated throughout a batch.';
  let sourceNormalizations=0;const native=String.prototype.normalize;
  vi.spyOn(String.prototype,'normalize').mockImplementation(function(this:string,form){if(String(this)===text)sourceNormalizations++;return native.call(this,form);});
  const result=relevantStoryCardInventory(a,text);expect(sourceNormalizations).toBe(1);
  result[0].keys.push('Caller mutation');
  expect(relevantStoryCardInventory(a,text)[0].keys).not.toContain('Caller mutation');expect(sourceNormalizations).toBe(1);
  for(let i=0;i<17;i++)relevantStoryCardInventory(a,'Other workshop research '+i);
  relevantStoryCardInventory(a,text);expect(sourceNormalizations).toBe(2);
});
