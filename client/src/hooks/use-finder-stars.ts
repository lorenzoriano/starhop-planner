import { useEffect,useState } from "react";
import fields from "@/lib/finder-fields.json";
import type { DenseStar } from "@/lib/astronomy";
const EMPTY:DenseStar[]=[];
const cache=new Map<string,Promise<DenseStar[]>>();
export function useFinderStars(id:string|undefined,enabled:boolean) {
  const exists=!!id&&Object.hasOwn(fields,id);
  const [loaded,setLoaded]=useState<{id:string;stars:DenseStar[];failed:boolean}|null>(null);
  useEffect(()=>{
    if(!id||!exists||!enabled)return;let cancelled=false;
    let promise=cache.get(id);
    if(!promise){promise=fetch(`./data/finder-stars/${encodeURIComponent(id)}.json`).then(r=>{if(!r.ok)throw Error('Finder field unavailable');return r.json();}).then(data=>{if(!Array.isArray(data)||data.some(s=>!Array.isArray(s)||s.length!==4||!s.every(Number.isFinite)))throw Error('Invalid finder field');return data as DenseStar[];});cache.set(id,promise);if(cache.size>8)cache.delete(cache.keys().next().value!);}
    promise.then(stars=>{if(!cancelled)setLoaded({id,stars,failed:false});}).catch(()=>{cache.delete(id);if(!cancelled)setLoaded({id,stars:[],failed:true});});return()=>{cancelled=true;};
  },[id,exists,enabled]);
  return {stars:enabled&&loaded&&loaded.id===id?loaded.stars:EMPTY,state:!enabled||!exists?'base':loaded?.id===id?(loaded.failed?'error':'ready'):'loading'} as const;
}
