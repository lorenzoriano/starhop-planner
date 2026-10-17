import { useMemo,useState } from "react";
import { Moon,Search } from "lucide-react";
import { catalogSearchScore } from "@/lib/catalog-search";
import { getConstellationName,type UnifiedTarget } from "@/lib/astronomy";

export function MoonTargetPicker({targets,target,onSelect}:{targets:UnifiedTarget[];target?:UnifiedTarget;onSelect:(id:string)=>void}) {
  const [query,setQuery]=useState("");
  const results=useMemo(()=>query.trim()?targets.map(t=>({target:t,score:catalogSearchScore(t,query,getConstellationName(t.con))})).filter(t=>Number.isFinite(t.score)).sort((a,b)=>a.score-b.score||a.target.name.localeCompare(b.target.name)).slice(0,7):[],[targets,query]);
  const choose=(id:string)=>{onSelect(id);setQuery("");};
  return <section className="moon-target-picker" id="moon-comparison-target" aria-label="Moon comparison object">
    <div><span className="eyebrow"><Moon size={13}/> COMPARE WITH THE MOON</span><h2>{target?.name??"Choose an object"}</h2><p>Shared with Tonight, Binoculars and Star hop. Uses the observing time and location above.</p></div>
    <div className="moon-target-search"><label htmlFor="moon-target-search">Change comparison object</label><div className="search-field"><Search size={15}/><input id="moon-target-search" aria-label="Search Moon comparison objects" placeholder="Name, constellation or catalog number…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&results[0]){e.preventDefault();choose(results[0].target.id);}if(e.key==="Escape")setQuery("");}}/></div>
      {query.trim()&&<div className="moon-target-results" aria-label="Matching comparison objects">{results.length?results.map(({target:t})=><button key={t.id} onClick={()=>choose(t.id)}><strong>{t.name}</strong><span>{t.id} · {getConstellationName(t.con)}</span></button>):<p>No matching objects. Try a catalog number or another name.</p>}</div>}
    </div>
  </section>;
}
