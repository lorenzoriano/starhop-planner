import { ContextDateButton, ContextLocationButton, ObservingContextScope } from "./ObservingContext";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";
import { CalendarDays, Plus, Moon, Compass, ArrowUpRight, MapPin, Archive, Download, Check, X, Circle, CheckCircle2, Undo2 } from "lucide-react";
import { NightObservationDetails } from "./ObservingVisuals";
import { visibilityWindow } from "@/lib/target-visibility";
import { createMoonSampler, sessionNightWindow } from "@/lib/observing-profile";
import { WeatherPanel } from "./WeatherPanel";
import { SavedLocations } from "./SavedLocations";
import { matchingLocation, type SavedLocation } from "@/lib/saved-locations";
import { Calendar } from "./ui/calendar";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { CatalogCombobox } from "./CatalogCombobox";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { binocularAssessment, KITE_14X50, type BinocularProfile } from "@/lib/binocular-assessment";
import { makeSession, planningShortcut, eveningOn, sessionTimezone, suggestSequence, type ObservingSession, type SequenceStep } from "@/lib/session-planner";
import { sessionDraft, resolveSessionDraft, reuseNightItems, type SessionDraft } from "@/lib/session-draft";
import { eqToHorizontal, type UnifiedTarget } from "@/lib/astronomy";
import { lunarFeatures, moonState } from "@/lib/moon";
import { compassLabel } from "@/lib/observing";
import { resolveLocalMoment } from "@/lib/session";
import type { NightItem } from "@/lib/session";

interface Props {
  savedLocations:SavedLocation[]; onLocationsChange:(locations:SavedLocation[])=>void;
  sessions:ObservingSession[]; active:ObservingSession|undefined; targets:UnifiedTarget[];
  date:Date; lat:number; lon:number; timezone:string; items:NightItem[]; skyBrightness:number; live:boolean;
  profile?:BinocularProfile;
  actions:ReactNode;
  onCompare:(ids:string[],at:Date,lat:number,lon:number)=>void;
  onCreate:(s:ObservingSession)=>void; onUpdate:(s:ObservingSession)=>void; onSelect:(id:string|null)=>void;
  onPreview:(at:Date,lat:number,lon:number,stay?:boolean)=>void; onVisit:(id:string,at:Date)=>void;
  onAdd:(id:string)=>void; onObserved:(id:string)=>void; onNotes:(id:string,notes:string)=>void;
}
export function derivedNightName(day:string, zone:string) {
  const noon=resolveLocalMoment(day,"12:00",zone);
  return `${formatInTimeZone(noon??new Date(`${day}T12:00:00`),zone,"MMM d")} observing night`;
}
export function isDerivedNightName(name:string, day:string, zone:string) {
  return name===derivedNightName(day,zone);
}

export function detailedUnavailableReason(step:SequenceStep, session:ObservingSession, target:UnifiedTarget|undefined, zone:string) {
  const start=new Date(session.startAt),end=new Date(+start+session.durationMinutes*60_000),lunar=step.id.startsWith("moon:"),minimum=lunar?5:15;
  const altAt=(at:Date)=>lunar?moonState(session.lat,session.lon,at).alt:target?eqToHorizontal(target.ra,target.dec,session.lat,session.lon,at).alt:-90;
  const localTime=(at:Date)=>formatInTimeZone(at,zone,"HH:mm");
  const during:number[]=[];
  for(let ms=+start;ms<=+end;ms+=10*60_000)during.push(altAt(new Date(ms)));
  if(Math.max(...during)<minimum) {
    const later:Date[]=[];let peak=Math.max(...during);
    for(let ms=+end+10*60_000;ms<=+end+24*60*60_000;ms+=10*60_000){const at=new Date(ms),alt=altAt(at);peak=Math.max(peak,alt);if(alt>=minimum)later.push(at);}
    if(!later.length)return `Never rises above ${minimum}° from this latitude (peaks at ${Math.round(peak)}°).`;
    return `${lunar?"Moon rises":"Rises above "+minimum+"°"} at ${localTime(later[0])}, after this session ends at ${localTime(end)}.`;
  }
  if(lunar&&moonState(session.lat,session.lon,start).alt<0) {
    const rise=during.findIndex((_,i)=>during[i]>=minimum);
    if(rise>=0)return `Moon is down at ${localTime(start)}; rises above 5° at ${localTime(new Date(+start+rise*10*60_000))}.`;
  }
  if(target&&!/star|asterism/i.test(target.category)) {
    const darkness=Array.from({length:during.length},(_,i)=>moonState(session.lat,session.lon,new Date(+start+i*10*60_000)).sunAlt<=-18);
    if(!darkness.some(Boolean))return `Astronomical darkness begins after this session ends at ${localTime(end)}. Extend the session or move this target to a darker night.`;
  }
  return "Not enough time in this session for another target. Extend the session or move it to another night.";
}

function SessionTimeline({ session, items, steps, targets, zone, darkSegments, moonAt }: {
  session:ObservingSession; items:NightItem[]; steps:SequenceStep[]; targets:UnifiedTarget[]; zone:string;
  darkSegments:{start:Date;end:Date}[]; moonAt:(at:Date)=>ReturnType<typeof moonState>;
}) {
  const rangeStart=Math.min(+new Date(session.startAt),darkSegments[0]?+darkSegments[0].start:+new Date(session.startAt));
  const rangeEnd=Math.max(+new Date(+new Date(session.startAt)+session.durationMinutes*60_000),darkSegments.at(-1)?+darkSegments.at(-1)!.end:+new Date(+new Date(session.startAt)+session.durationMinutes*60_000));
  const targetsById=new Map(targets.map(target=>[target.id,target]));
  const start=rangeStart,end=rangeEnd||rangeStart+1,width=900,left=42,right=885,top=22,bottom=190;
  const x=(ms:number)=>left+(ms-start)/(end-start||1)*(right-left),y=(alt:number)=>bottom-Math.max(0,Math.min(90,alt))/90*(bottom-top);
  const samples=Array.from({length:Math.max(2,Math.ceil((end-start)/(15*60_000))+1)},(_,i)=>new Date(start+(end-start)*i/(Math.max(2,Math.ceil((end-start)/(15*60_000))))));
  const pathFor=(item:NightItem)=>{
    let path="",connected=false;
    for(const at of samples){const feature=lunarFeatures.find(f=>`moon:${f.id}`===item.id),target=targetsById.get(item.id);const alt=feature?moonAt(at).alt:target?eqToHorizontal(target.ra,target.dec,session.lat,session.lon,at).alt:-1;
      if(alt<0){connected=false;continue;}path+=`${connected?"L":"M"}${x(+at).toFixed(1)},${y(alt).toFixed(1)} `;connected=true;}
    return path;
  };
  return <section className="planner-night-timeline" aria-label="Whole observing night timeline">
    <h3>Whole-night overview</h3><p>Altitude across the dark hours. Shaded bands mark astronomical darkness and Moon-up time; blocks show scheduled target slots.</p>
    <div style={{overflowX:"auto"}}><svg viewBox={`0 0 ${width} 280`} role="img" aria-label={`Altitude timeline for ${items.length} targets from ${formatInTimeZone(start,zone,"MMM d HH:mm")} to ${formatInTimeZone(end,zone,"MMM d HH:mm")}`} style={{minWidth:640,width:"100%"}}>
      {samples.slice(0,-1).map((at,i)=>{const next=samples[i+1],state=moonAt(new Date((+at+ +next)/2));return <g key={+at}><rect x={x(+at)} y={top} width={Math.max(1,x(+next)-x(+at))} height={bottom-top} fill={state.sunAlt<=-18?"#9fc7a8":"#506273"} opacity={state.sunAlt<=-18?.1:.045}/>{state.alt>0&&<rect x={x(+at)} y={top} width={Math.max(1,x(+next)-x(+at))} height={bottom-top} fill="#d5bb82" opacity=".045"/>}</g>;})}
      {[0,30,60,90].map(alt=><g key={alt}><line x1={left} x2={right} y1={y(alt)} y2={y(alt)} stroke="#78909a" strokeOpacity=".3" strokeDasharray={alt===0?undefined:"3 5"}/><text x={left-8} y={y(alt)+4} fill="#9bb0b7" fontSize="10" textAnchor="end">{alt}°</text></g>)}
      {items.map((item,index)=><path key={item.id} d={pathFor(item)} fill="none" stroke={["#53e352","#ff59ce","#ff792f","#459bff","#ff4b67","#00c9b7","#ac77ff","#ead328"][index%8]} strokeWidth="2"/>)}
      {steps.filter(step=>step.date).map(step=>{const x1=x(+step.date!),x2=x(+step.date!+session.minutesPerTarget*60_000);return <g key={step.id}><rect x={x1} y="205" width={Math.max(2,x2-x1)} height="13" rx="2" fill="#c4d8be" opacity=".8"/><text x={(x1+x2)/2} y="235" fill="#c4d8be" fontSize="9" textAnchor="middle">{step.name}</text></g>;})}
      {[0,.25,.5,.75,1].map(f=>{const at=new Date(start+(end-start)*f);return <text key={f} x={x(+at)} y="266" fill="#9bb0b7" fontSize="10" textAnchor={f===0?"start":f===1?"end":"middle"}>{formatInTimeZone(at,zone,"HH:mm · MMM d")}</text>;})}
    </svg></div>
    <div className="planner-timeline-legend" style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",fontSize:11,marginTop:8}}><span>Altitude</span><span>Darkness</span><span>Moon above horizon</span><span>Scheduled slot</span>{items.map((item,index)=><span key={item.id} style={{color:["#53e352","#ff59ce","#ff792f","#459bff","#ff4b67","#00c9b7","#ac77ff","#ead328"][index%8]}}>— {targetsById.get(item.id)?.displayName??lunarFeatures.find(feature=>`moon:${feature.id}`===item.id)?.name??item.id}</span>)}</div>
  </section>;
}
export function SessionPlanner({savedLocations,onLocationsChange,sessions,active,targets,date,lat,lon,timezone,items,skyBrightness,profile=KITE_14X50,live,actions,onCompare,onCreate,onUpdate,onSelect,onPreview,onVisit,onAdd,onObserved,onNotes}:Props) {
  const defaultNight = () => {
    const at=live?planningShortcut("tonight",lat,lon).date:date;
    return makeSession(derivedNightName(formatInTimeZone(at,timezone,"yyyy-MM-dd"),timezone),at,lat,lon,[],matchingLocation(savedLocations,lat,lon)?.name??"");
  };
  const [draft,setDraft]=useState(()=>sessionDraft(active??defaultNight()));
  const [isNew,setIsNew]=useState(!active);
  const [copy,setCopy]=useState(!active&&items.length>0);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [calendarOpen,setCalendarOpen]=useState(false);
  const [month,setMonth]=useState(()=>new Date(`${formatInTimeZone(date,timezone,"yyyy-MM-dd")}T12:00:00`));
  const siteDetails=useRef<HTMLDetailsElement>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const [archiveUndo,setArchiveUndo]=useState<ObservingSession|null>(null);
  const archiveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    setIsNew(!active);setDraft(sessionDraft(active??defaultNight()));setCopy(!active&&items.length>0);setError("");if(siteDetails.current)siteDetails.current.open=false;
  },[active?.id,active?.name,active?.startAt,active?.lat,active?.lon,active?.locationName,active?.durationMinutes,active?.minutesPerTarget]);
  useEffect(()=>()=>{if(archiveTimer.current)clearTimeout(archiveTimer.current);},[]);
  const resolved=useMemo(()=>resolveSessionDraft(draft,isNew?undefined:active),[draft,isNew,active?.startAt]);
  const visibleItems=useMemo(()=>isNew?(copy?reuseNightItems(items,!active):[]):items,[isNew,copy,items,active?.id]);
  const preview=useMemo<ObservingSession|undefined>(()=>!isNew?active:resolved.ok?{...resolved.value,id:"draft",items:visibleItems,createdAt:date.toISOString(),archived:false}:undefined,[isNew,active,resolved,visibleItems]);
  // Notes don't change scheduling. Avoid repeating the astronomical search on
  // every keystroke in an expanded field-note editor.
  const scheduleKey=preview?JSON.stringify([preview.startAt,preview.lat,preview.lon,preview.durationMinutes,preview.minutesPerTarget,preview.items.map(i=>[i.id,i.observedAt])]):"";
  const sequence=useMemo(()=>preview?suggestSequence(preview,targets,skyBrightness):[],[scheduleKey,targets,skyBrightness]);
  const zone=preview?sessionTimezone(preview):timezone;
  const formZone=resolved.ok?sessionTimezone(resolved.value):zone;
  const calendarDate=Number.isFinite(Date.parse(`${draft.date}T12:00:00`))?draft.date:formatInTimeZone(date,timezone,"yyyy-MM-dd");
  const forecastDate=preview?formatInTimeZone(new Date(preview.startAt),zone,"yyyy-MM-dd"):"";
  const forecastLat=preview?.lat??lat,forecastLon=preview?.lon??lon;
  const forecastRange=useMemo(()=>preview?{start:new Date(preview.startAt),end:new Date(Date.parse(preview.startAt)+(preview.durationMinutes-preview.minutesPerTarget)*60000)}:undefined,[preview?.startAt,preview?.durationMinutes,preview?.minutesPerTarget]);
  const forecastNight=useMemo(()=>forecastRange?sessionNightWindow(forecastRange.start,forecastRange.end,zone,forecastLat,forecastLon):visibilityWindow(forecastDate,"12:00","12:00","night",zone,forecastLat,forecastLon),[forecastRange,forecastDate,zone,forecastLat,forecastLon]);
  const forecastMoon=useMemo(()=>createMoonSampler(forecastLat,forecastLon),[forecastLat,forecastLon,forecastNight]);

  const targetMap=useMemo(()=>new Map(targets.map(target=>[target.id,target])),[targets]);
  const present=sessions.filter(session=>!session.archived),archived=sessions.filter(session=>session.archived);
  const completed=visibleItems.filter(item=>item.observedAt);
  const scheduled=sequence.filter(step=>step.date),unavailable=sequence.filter(step=>!step.date);
  const savedIds=new Set(visibleItems.map(item=>item.id));
  const dirty=!isNew&&active&&JSON.stringify(draft)!==JSON.stringify(sessionDraft(active));
  const selectNight=(id:string)=>{const selected=sessions.find(session=>session.id===id);if(!selected)return;onSelect(id);setDraft(sessionDraft(selected));setIsNew(false);setQuery("");setError("");setStatus("");if(siteDetails.current)siteDetails.current.open=false;};
  const suggestions=useMemo(()=>preview?targets.filter(target=>!target.id.startsWith("star:")&&target.mag<=9&&!visibleItems.some(item=>item.id===target.id))
    .map(target=>{const at=new Date(preview.startAt),alt=eqToHorizontal(target.ra,target.dec,preview.lat,preview.lon,at).alt,moon=moonState(preview.lat,preview.lon,at);return {target,alt,fit:binocularAssessment(target,profile,{alt,moon,skyBrightness}).rating,dark:moon.sunAlt<=-18};})
    .filter(target=>target.alt>=15).sort((a,b)=>a.fit-b.fit||Number(b.dark)-Number(a.dark)||b.alt-a.alt||a.target.mag-b.target.mag).slice(0,5):[],[targets,preview?.startAt,preview?.lat,preview?.lon,visibleItems,skyBrightness,profile]);
  const patch=(value:Partial<SessionDraft>)=>{setDraft(previous=>({...previous,...value}));setError("");setStatus("");};
  const openNew=(at?:Date)=>{
    if(siteDetails.current)siteDetails.current.open=false;
    const site=resolved.ok?resolved.value:preview;
    const latitude=site?.lat??lat,longitude=site?.lon??lon;
    const moment=at??planningShortcut("tonight",latitude,longitude).date;
    const zone=sessionTimezone({lat:latitude,lon:longitude});
    const night=makeSession(derivedNightName(formatInTimeZone(moment,zone,"yyyy-MM-dd"),zone),moment,latitude,longitude,[],site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??"");
    setDraft(sessionDraft(night));setIsNew(true);setCopy(!active&&items.length>0);setError("");setStatus("");setQuery("");
  };
  const save=(targetId?:string|string[])=>{
    if(!resolved.ok){setError(resolved.error);return false;}
    const chosenItems=isNew?visibleItems:items;
    const targetIds=targetId===undefined?[]:Array.isArray(targetId)?targetId:[targetId];
    const additions=targetIds.filter(id=>!chosenItems.some(item=>item.id===id)).map(id=>({id,addedAt:new Date().toISOString(),notes:""}));
    const nextItems=[...chosenItems,...additions];
    if(isNew||!active){onCreate({...makeSession(resolved.value.name,new Date(resolved.value.startAt),resolved.value.lat,resolved.value.lon,nextItems,resolved.value.locationName),...resolved.value});}
    else onUpdate({...active,...resolved.value,items:nextItems});
    setIsNew(false);setError("");if(siteDetails.current)siteDetails.current.open=false;return true;
  };
  const add=(target:UnifiedTarget)=>{
    if(savedIds.has(target.id)){setStatus(`${target.name} is already in this night.`);return;}
    if(isNew||dirty){if(!save(target.id))return;}else onAdd(target.id);
    setQuery("");setStatus(`Added ${target.name}.`);
  };
  const addTopFive=()=>{
    const picks=suggestions.slice(0,5).map(({target})=>target);
    if(!picks.length)return;
    if(isNew||dirty){if(!save(picks.map(target=>target.id)))return;}else picks.forEach(target=>onAdd(target.id));
    setStatus(`Added ${picks.length} binocular suggestions.`);
  };
  const changeDateTime=(day:string,time:string)=>{
    const keepDerived=isDerivedNightName(draft.name,draft.date,formZone);
    patch({date:day,time,...(keepDerived?{name:derivedNightName(day,formZone)}:{})});
  };
  const archive=(session:ObservingSession)=>{
    onUpdate({...session,archived:true});onSelect(null);setArchiveUndo(session);setMenuOpen(false);
    if(archiveTimer.current)clearTimeout(archiveTimer.current);
    archiveTimer.current=setTimeout(()=>setArchiveUndo(null),8000);
  };
  const undoArchive=()=>{
    if(!archiveUndo)return;
    onUpdate({...archiveUndo,archived:false});selectNight(archiveUndo.id);setArchiveUndo(null);
    if(archiveTimer.current)clearTimeout(archiveTimer.current);
  };
  const unavailableReasons=useMemo(()=>new Map(unavailable.map(step=>[step.id,preview?detailedUnavailableReason(step,preview,targetMap.get(step.id),zone):step.reason])),[unavailable,preview?.startAt,preview?.durationMinutes,preview?.lat,preview?.lon,targetMap,zone]);
  const quickNight=(kind:"tonight"|"new-moon")=>{
    if(siteDetails.current)siteDetails.current.open=false;
    const site=resolved.ok?resolved.value:preview;
    const latitude=site?.lat??lat,longitude=site?.lon??lon;
    const at=planningShortcut(kind,latitude,longitude).date;
    const existing=present.find(session=>Math.abs(session.lat-latitude)<.0001&&Math.abs(session.lon-longitude)<.0001&&Math.abs(Date.parse(session.startAt)-at.getTime())<=30*60_000);
    if(existing){selectNight(existing.id);}
    else {const zone=sessionTimezone({lat:latitude,lon:longitude});onCreate(makeSession(derivedNightName(formatInTimeZone(at,zone,"yyyy-MM-dd"),zone),at,latitude,longitude,!active?reuseNightItems(items,true):[],site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??""));}
    setStatus(kind==="tonight"?"Tonight’s observing night is ready. Add targets below.":"A night near the next new Moon is ready. Add targets below.");setError("");
  };
  const nameFor=(id:string)=>targetMap.get(id)?.displayName??lunarFeatures.find(feature=>`moon:${feature.id}`===id)?.name??id;
  const row=(item:NightItem,index:number,step?:SequenceStep)=> <li key={item.id} className={step&&!step.date?"unavailable":""}>
    <div className="planner-row-main"><span className="planner-order">{item.observedAt?<Check size={13}/>:index+1}</span>
      <div className="planner-row-copy"><strong>{nameFor(item.id)}</strong><span>{item.observedAt?`Observed ${formatInTimeZone(new Date(item.observedAt),zone,"MMM d, yyyy")}`:step?.date?`${formatInTimeZone(step.date,zone,"HH:mm")} · ${Math.round(step.alt)}° ${compassLabel(step.az)}${step.separation!==null?` · ${Math.round(step.separation)}° from Moon`:""}`:step?.reason??"No scheduled time"}</span>{step?.date&&step.reason!=="Well placed at this time"&&<small>{step.reason}</small>}</div>
      <div className="planner-row-actions"><button className="icon-button" aria-label={`${item.observedAt?"Log another observation":"Log observation"}: ${nameFor(item.id)}`} title={item.observedAt?"Log another observation":"Log observation"} disabled={isNew} onClick={()=>onObserved(item.id)}>{item.observedAt?<CheckCircle2 size={17}/>:<Circle size={17}/>}</button><button className="text-action" disabled={isNew||(!targetMap.has(item.id)&&!item.id.startsWith("moon:"))} onClick={()=>onVisit(item.id,step?.date??new Date(preview!.startAt))}>Find <ArrowUpRight size={12}/></button><button className="icon-button" aria-label={`Remove ${nameFor(item.id)} from session`} disabled={isNew} onClick={()=>onAdd(item.id)}><X size={14}/></button></div>
    </div>
    {targetMap.has(item.id)&&<NightObservationDetails target={targetMap.get(item.id)!} lat={forecastLat} lon={forecastLon} night={forecastNight} timezone={zone} skyBrightness={skyBrightness} moonAt={forecastMoon} range={forecastRange} initialOpen={index===0&&!item.observedAt&&!!step?.date}/>}
    {!!item.observations?.length&&<details className="planner-row-notes"><summary>Observation history · {item.observations?.length??0}</summary><ol>{(item.observations??[]).map((observation,index)=><li key={`${observation.at}-${index}`}><strong>{formatInTimeZone(new Date(observation.at),zone,"MMM d, yyyy · HH:mm")}</strong>{observation.instrument&&<span> · {observation.instrument}</span>}{observation.notes&&<p>{observation.notes}</p>}</li>)}</ol></details>}
    <details className="planner-row-notes"><summary>{item.notes?"Field notes · saved":"Add field notes"}</summary><Textarea aria-label={`Notes for ${nameFor(item.id)}`} value={item.notes} disabled={isNew} rows={2} onChange={event=>onNotes(item.id,event.target.value)} placeholder="Conditions, colors, what caught your eye…"/>{isNew&&<p>Create this night to edit its records.</p>}</details>
  </li>;

  return <ObservingContextScope date={resolved.ok?new Date(resolved.value.startAt):date} timezone={formZone} lat={resolved.ok?resolved.value.lat:lat} lon={resolved.ok?resolved.value.lon:lon} locationName={draft.place||"Session site"} onTime={at=>changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),formatInTimeZone(at,formZone,"HH:mm"))} onLocation={(a,b,name)=>patch({lat:String(a),lon:String(b),place:name})}><div className="session-planner planner-workbench" data-testid="session-planner">
    <section className="panel planner-command" aria-label="Plan your observing night">
      {archiveUndo&&<div className="planner-archive-undo" role="status"><span>Archived “{archiveUndo.name}”.</span><button type="button" className="text-action" onClick={undoArchive}><Undo2 size={13}/> Undo</button></div>}
      <div className="planner-night-switch"><label>Observing night<select aria-label="Observing session" value={isNew?"new":active?.id??"new"} onChange={event=>{if(event.target.value==="new")openNew();else{selectNight(event.target.value);}}}><option value="new">New observing night</option>{present.map(session=><option key={session.id} value={session.id}>{session.name} · {formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"MMM d")}</option>)}</select></label><button className="text-action" aria-label="Calendar and saved nights" onClick={()=>{setMonth(new Date(`${calendarDate}T12:00:00`));setCalendarOpen(true);}}><CalendarDays size={15}/><span>Calendar</span></button><button className="text-action" aria-label="New night" onClick={()=>openNew()}><Plus size={15}/><span>New night</span></button><Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><button type="button" className="text-action planner-workspace-menu" aria-label="Export and session actions"><Download size={15}/><span>Export & more</span></button></PopoverTrigger><PopoverContent align="end" className="grid w-72 gap-2 rounded-md border border-[#42645e] bg-[#10232e] p-3 text-[#d1e0d6] shadow-xl">{(!isNew||!active)?actions:<p>Create this night before exporting it.</p>}{active&&!isNew&&<><button className="text-action" onClick={()=>{setMenuOpen(false);onPreview(new Date(active.startAt),active.lat,active.lon);}}>View this night’s sky <ArrowUpRight size={12}/></button><button className="text-action" onClick={()=>archive(active)}><Archive size={12}/> Archive night</button></>}</PopoverContent></Popover></div>
      <div className="planner-quick-nights"><button disabled={!resolved.ok} onClick={()=>{if(resolved.ok)onCompare(visibleItems.map(item=>item.id),new Date(resolved.value.startAt),resolved.value.lat,resolved.value.lon);}}><CalendarDays size={14}/> Clock & compare this night</button><button onClick={()=>quickNight("tonight")}><Compass size={14}/> Plan tonight</button><button onClick={()=>quickNight("new-moon")}><Moon size={14}/> Next new Moon</button></div>
      <form onSubmit={event=>{event.preventDefault();save();}} className="planner-inline-form">
        <div className="planner-time-fields"><ContextDateButton value={resolved.ok?new Date(resolved.value.startAt):date} timezone={formZone} onChange={at=>changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),formatInTimeZone(at,formZone,"HH:mm"))}>Calendar & time</ContextDateButton><ContextLocationButton lat={resolved.ok?resolved.value.lat:lat} lon={resolved.ok?resolved.value.lon:lon} onChange={(a,b,name)=>patch({lat:String(a),lon:String(b),place:name})}>{draft.place||"Choose site"}</ContextLocationButton><label className="min-w-0 flex-1 basis-[150px]">Date<input aria-label="Planned session date" type="date" value={draft.date} onChange={event=>changeDateTime(event.target.value,draft.time)}/></label><label className="min-w-0 flex-1 basis-[130px]">Local start<input aria-label="Planned session time" type="time" value={draft.time} onChange={event=>changeDateTime(draft.date,event.target.value)}/></label><label className="min-w-0 flex-1 basis-[100px]">Length · min<input aria-label="Session duration" type="number" min={30} max={720} step={1} value={draft.duration} onChange={event=>patch({duration:event.target.value})}/></label>{(isNew||dirty)&&<Button type="submit" className={isNew?"planner-create-empty":""}>{isNew?"Create night":"Save changes"}</Button>}</div>
        <SavedLocations context="Session" locations={savedLocations} lat={draft.lat.trim()?Number(draft.lat):NaN} lon={draft.lon.trim()?Number(draft.lon):NaN} name={draft.place} onChange={onLocationsChange} onSelect={site=>patch({place:site.name,lat:String(site.lat),lon:String(site.lon)})}/>
        <details ref={siteDetails} className="planner-site-details"><summary><MapPin size={13}/>{draft.place||`${draft.lat}°, ${draft.lon}°`} · {formZone.replaceAll("_"," ")} <span>Change site & details</span></summary><div className="session-editor-fields"><label>Night name<input aria-label="Session name" value={draft.name} onChange={event=>patch({name:event.target.value})}/></label><label>Site name<input aria-label="Observing site name" value={draft.place} placeholder="Back garden, campsite…" onChange={event=>patch({place:event.target.value})}/></label><label>Latitude<input aria-label="Session latitude" type="number" min={-90} max={90} step="any" value={draft.lat} onChange={event=>patch({lat:event.target.value})}/></label><label>Longitude<input aria-label="Session longitude" type="number" min={-180} max={180} step="any" value={draft.lon} onChange={event=>patch({lon:event.target.value})}/></label><label>Minutes per target<input aria-label="Minutes per target" type="number" min={5} max={60} value={draft.perTarget} onChange={event=>patch({perTarget:event.target.value})}/></label></div><div className="session-site-presets"><span>Use a site:</span>{[["San Francisco",37.77,-122.42],["London",51.5,-.12],["Sydney",-33.87,151.21]].map(([name,a,b])=><button type="button" key={String(name)} onClick={()=>patch({place:String(name),lat:String(a),lon:String(b)})}>{name}</button>)}</div>{isNew&&items.length>0&&<label className="session-copy"><input type="checkbox" checked={copy} onChange={event=>setCopy(event.target.checked)}/>{active?"Reuse this night’s targets with fresh observations":"Keep my unscheduled targets, notes and observations"}</label>}{(isNew||dirty)&&<Button type="submit" variant="outline">{isNew?"Create night":"Save changes"}</Button>}</details>
      </form>
      {isNew&&<p className="planner-inline-hint">Your first target saves this night.</p>}{dirty&&<p className="planner-inline-hint">Save your changes to update this night’s viewing times. Exports use the saved night.</p>}{error&&<p className="session-editor-error" role="alert">{error}</p>}

    </section>

    {resolved.ok&&<>{(isNew||dirty)&&<p className="planner-preview-label">Unsaved preview · weather, altitude and suggestions use these values. Save to keep this session.</p>}<WeatherPanel lat={resolved.value.lat} lon={resolved.value.lon} date={new Date(resolved.value.startAt)} timezone={formZone} skyBrightness={skyBrightness} locationName={resolved.value.locationName||matchingLocation(savedLocations,resolved.value.lat,resolved.value.lon)?.name||`${resolved.value.lat.toFixed(2)}°, ${resolved.value.lon.toFixed(2)}°`} onTime={at=>changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),formatInTimeZone(at,formZone,"HH:mm"))}/></>}

    <section className="panel planner-target-board" aria-label="Targets and viewing sequence">
      <CatalogCombobox targets={targets} query={query} onQuery={setQuery} onSelect={add} savedIds={savedIds} label="Add targets" placeholder="Search M31, a star, cluster, double star…" className="planner-target-search"/>
      {!query.trim()&&suggestions.length>0&&visibleItems.length===0&&<div className="planner-suggestions"><span>Binocular picks at your {isNew?"chosen":"saved"} time</span><div>{suggestions.map(({target,alt,fit,dark})=><button type="button" key={target.id} aria-label={`Add ${target.displayName} to session`} onClick={()=>add(target)}><strong>{target.name}</strong><small>{fit===0?"Excellent fit":fit===1?"Worthwhile":fit===2?"Challenging":"Telescope more rewarding"} · {Math.round(alt)}° · {dark?"dark":"twilight"} <Plus size={12}/></small></button>)}</div><Button type="button" variant="outline" onClick={addTopFive}>Add top 5 for binoculars</Button></div>}
      <p className="planner-add-status" role="status">{status||"Search and press Enter to add the first match."}</p>
      <div className="planner-sequence-heading"><h3>Your viewing order</h3><span>{scheduled.length} scheduled · {completed.length} observed{preview?` · ${preview.minutesPerTarget} min each`:""}</span></div>
      {!visibleItems.length&&<p className="planner-empty-copy">Add a target above. StarHop will suggest an order that gives setting objects a chance before they get too low.</p>}
      {preview&&visibleItems.length>0&&<SessionTimeline session={preview} items={visibleItems} steps={sequence} targets={targets} zone={zone} darkSegments={forecastNight.ok?forecastNight.segments:[]} moonAt={forecastMoon}/>}
      <ol className="planner-sequence">{scheduled.map((step,index)=>{const item=visibleItems.find(item=>item.id===step.id);return item?row(item,index,step):null;})}</ol>
      {unavailable.length>0&&<details className="planner-unavailable" open><summary>Doesn’t fit this session · {unavailable.length}</summary><ol className="planner-sequence">{unavailable.map((step,index)=>{const item=visibleItems.find(item=>item.id===step.id);return item?row(item,index,{...step,reason:unavailableReasons.get(step.id)??step.reason}):null;})}</ol></details>}
      {completed.length>0&&<details className="planner-completed"><summary>Observed targets ({completed.length})</summary><ol className="planner-sequence">{completed.map((item,index)=>row(item,index))}</ol></details>}
      <details className="planner-method"><summary>How the order is suggested</summary><p>Targets with earlier closing viewing windows come first, then altitude and reduced moonlight. Deep-sky targets need astronomical darkness; bright stellar targets allow twilight. Lunar features must be sunlit and the Moon up. Each target’s Altitude & Moon graph shows a suggested individual time inside the saved session, balancing altitude with lunar phase, altitude and angular separation. Solid mint uses the left altitude axis; dashed silver uses the right Moon-distance axis (180° is opposite). Gray shading is modeled sky glow, not a visibility probability. Slots can differ from individual suggestions to fit other targets and closing windows. Weather forecasts are shown separately and do not change this order. Local obstructions are not measured.</p></details>
    </section>

    <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}><DialogContent className="planner-calendar-dialog"><DialogHeader><DialogTitle>Calendar & saved nights</DialogTitle><DialogDescription>Select a saved night, or pick a date to start a new one. Existing nights keep their observations and notes.</DialogDescription></DialogHeader><div className="planner-calendar-layout"><section className="planner-calendar"><Calendar mode="single" month={month} onMonthChange={setMonth} selected={new Date(`${calendarDate}T12:00:00`)} onSelect={day=>{if(!day)return;const selected=format(day,"yyyy-MM-dd");const existing=present.find(session=>formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"yyyy-MM-dd")===selected);if(existing){selectNight(existing.id);}else openNew(eveningOn(selected,preview?.lat??lat,preview?.lon??lon).date);setCalendarOpen(false);}} labels={{labelDay:(day,modifiers)=>`${format(day,"EEEE, MMMM d, yyyy")}${modifiers.planned?", saved observing session":""}`}} modifiers={{planned:present.map(session=>new Date(`${formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"yyyy-MM-dd")}T12:00:00`))}} modifiersClassNames={{planned:"calendar-has-session"}}/><p>Marked dates have saved observing nights.</p></section><section className="planner-sessions"><h3>Saved nights</h3>{present.map(session=><button key={session.id} className={`planner-session-card ${active?.id===session.id?"active":""}`} onClick={()=>{selectNight(session.id);setCalendarOpen(false);}} data-testid={`session-${session.id}`}><strong>{session.name}</strong><span>{formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"MMM d, yyyy · HH:mm")} · {session.items.length} targets</span></button>)}{!present.length&&<p className="planner-empty-copy">Your saved nights will appear here.</p>}{archived.length>0&&<details><summary>Archived nights ({archived.length})</summary>{archived.map(session=><div className="planner-archived" key={session.id}><span>{session.name}</span><button className="text-action" onClick={()=>{onUpdate({...session,archived:false});selectNight(session.id);setCalendarOpen(false);}}>Restore</button></div>)}</details>}</section></div></DialogContent></Dialog>
  </div></ObservingContextScope>;
}
