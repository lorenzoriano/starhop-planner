import {UpcomingNights} from "./UpcomingNights";
import {sessionBinocularSuggestions} from "@/lib/session-suggestions";
import {CoordinatePairInput} from "./CoordinatePairInput";
import "./SessionPlanner.css";
import { ObservingContextScope } from "./ObservingContext";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarDays, Plus, Moon, Compass, ArrowUpRight, MapPin, Archive, Download, Check, X, Circle, CheckCircle2, Undo2, Copy } from "lucide-react";
import { NightObservationDetails } from "./ObservingVisuals";
import { visibilityWindow } from "@/lib/target-visibility";
import { createMoonSampler, sessionNightWindow } from "@/lib/observing-profile";
import { WeatherPanel } from "./WeatherPanel";
import { SavedLocations } from "./SavedLocations";
import { matchingLocation, knownLocationName, type SavedLocation } from "@/lib/saved-locations";
import { ObservingCalendar } from "./ObservingCalendar";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { CatalogCombobox } from "./CatalogCombobox";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { KITE_14X50, type BinocularProfile } from "@/lib/binocular-assessment";
import { makeSession, planningShortcut, eveningOn, sessionTimezone, suggestSequence, type ObservingSession, type SequenceStep } from "@/lib/session-planner";
import { sessionDraft, resolveSessionDraft, reuseNightItems, duplicateNightItems, observingNightDate, sameObservingNight, derivedNightName, isDerivedNightName, sessionDraftAt, type SessionDraft } from "@/lib/session-draft";
import { eqToHorizontal, type UnifiedTarget } from "@/lib/astronomy";
import { lunarFeatures, lunarFrame, projectLunarFeature, moonState } from "@/lib/moon";
import { compassLabel } from "@/lib/observing";
import { resolveLocalMoment } from "@/lib/session";
import type { NightItem } from "@/lib/session";

interface Props {
  savedLocations:SavedLocation[]; onLocationsChange:(locations:SavedLocation[])=>void;
  sessions:ObservingSession[]; active:ObservingSession|undefined; targets:UnifiedTarget[];
  date:Date; lat:number; lon:number; timezone:string; items:NightItem[]; skyBrightness:number; live:boolean;
  profile?:BinocularProfile; selectedTarget?:UnifiedTarget;
  actions:ReactNode;
  onCompare:(ids:string[],at:Date,lat:number,lon:number)=>void;
  onCreate:(s:ObservingSession)=>void; onUpdate:(s:ObservingSession)=>void; onSelect:(id:string|null)=>void;
  onPreview:(at:Date,lat:number,lon:number,stay?:boolean)=>void; onVisit:(id:string,at:Date)=>void;
  onAdd:(id:string)=>void; onObserved:(id:string)=>void; onNotes:(id:string,notes:string)=>void;
}
export {derivedNightName,isDerivedNightName} from "@/lib/session-draft";

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
      {samples.slice(0,-1).map((at,i)=>{const next=samples[i+1],state=moonAt(new Date((+at+ +next)/2));return <g key={+at}><rect x={x(+at)} y={top} width={Math.max(1,x(+next)-x(+at))} height={bottom-top} fill={state.sunAlt<=-18?"#9fc7a8":"#506273"} opacity={state.sunAlt<=-18?.15:.045}/>{state.alt>0&&<rect x={x(+at)} y={top} width={Math.max(1,x(+next)-x(+at))} height={bottom-top} fill="#d5bb82" opacity=".2"/>}</g>;})}
      {[0,30,60,90].map(alt=><g key={alt}><line x1={left} x2={right} y1={y(alt)} y2={y(alt)} stroke="#78909a" strokeOpacity=".3" strokeDasharray={alt===0?undefined:"3 5"}/><text x={left-8} y={y(alt)+4} fill="#9bb0b7" fontSize="18" textAnchor="end">{alt}°</text></g>)}
      {items.map((item,index)=><path key={item.id} d={pathFor(item)} fill="none" stroke={["#53e352","#ff59ce","#ff792f","#459bff","#ff4b67","#00c9b7","#ac77ff","#ead328"][index%8]} strokeWidth="2"/>)}
      {steps.filter(step=>step.date).map((step,index)=>{const x1=x(+step.date!),x2=x(+step.date!+session.minutesPerTarget*60_000);return <g key={step.id}><rect x={x1} y="205" width={Math.max(2,x2-x1)} height="26" rx="2" fill="#c4d8be" opacity=".8"/><text x={(x1+x2)/2} y="224" fill="#12232c" fontSize="18" fontWeight="700" textAnchor="middle">{index+1}</text></g>;})}
      {[0,.25,.5,.75,1].map(f=>{const at=new Date(start+(end-start)*f);return <text key={f} x={x(+at)} y="266" fill="#9bb0b7" fontSize="18" textAnchor={f===0?"start":f===1?"end":"middle"}>{formatInTimeZone(at,zone,"HH:mm · MMM d")}</text>;})}
    </svg></div>
    <div className="planner-timeline-legend"><span className="planner-legend-dark">Astronomical darkness</span><span className="planner-legend-moon">Moon above horizon</span><span className="planner-legend-slot">Scheduled slot</span>{items.map((item,index)=><span className="planner-legend-target" key={item.id}><i style={{background:["#53e352","#ff59ce","#ff792f","#459bff","#ff4b67","#00c9b7","#ac77ff","#ead328"][index%8]}}/>{index+1}. {targetsById.get(item.id)?.displayName??lunarFeatures.find(feature=>`moon:${feature.id}`===item.id)?.name??item.id}</span>)}</div>
  </section>;
}
export function SessionPlanner({savedLocations,onLocationsChange,sessions,active,targets,date,lat,lon,timezone,items,skyBrightness,profile=KITE_14X50,selectedTarget,live,actions,onCompare,onCreate,onUpdate,onSelect,onPreview,onVisit,onAdd,onObserved,onNotes}:Props) {
  const defaultNight = () => {
    const at=live?planningShortcut("tonight",lat,lon).date:date;
    return makeSession(derivedNightName(observingNightDate(at,timezone),timezone),at,lat,lon,[],matchingLocation(savedLocations,lat,lon)?.name??"");
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
  const [carryover,setCarryover]=useState<{at:Date;lat:number;lon:number;locationName:string;existing?:ObservingSession;items:NightItem[]}|null>(null);
  const archiveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    setIsNew(!active);setDraft(sessionDraft(active??defaultNight()));setCopy(!active&&items.length>0);setError("");if(siteDetails.current)siteDetails.current.open=false;
  },[active?.id,active?.name,active?.startAt,active?.lat,active?.lon,active?.locationName,active?.durationMinutes,active?.minutesPerTarget]);
  useEffect(()=>()=>{if(archiveTimer.current)clearTimeout(archiveTimer.current);},[]);
  const resolved=useMemo(()=>resolveSessionDraft(draft,isNew?undefined:active),[draft,isNew,active?.startAt]);
  const visibleItems=useMemo(()=>isNew?(copy?reuseNightItems(items,!active):[]):items,[isNew,copy,items,active?.id]);
  const preview=useMemo<ObservingSession|undefined>(()=>resolved.ok?{...(active??{id:"draft",createdAt:date.toISOString(),archived:false}),...resolved.value,items:visibleItems}:undefined,[active,resolved,visibleItems]);
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
  const selectNight=(id:string)=>{const selected=sessions.find(session=>session.id===id);if(!selected)return;onSelect(id);setDraft(sessionDraft(selected));setMonth(new Date(`${formatInTimeZone(new Date(selected.startAt),sessionTimezone(selected),"yyyy-MM-dd")}T12:00:00`));setIsNew(false);setQuery("");setError("");setStatus("");if(siteDetails.current)siteDetails.current.open=false;};
  const suggestions=useMemo(()=>preview&&visibleItems.length===0?sessionBinocularSuggestions(preview,targets,profile,skyBrightness,forecastMoon):[],[targets,preview?.startAt,preview?.durationMinutes,preview?.lat,preview?.lon,visibleItems,skyBrightness,profile,forecastMoon]);
  const [allSuggestions,setAllSuggestions]=useState(false);
  const patch=(value:Partial<SessionDraft>)=>{setDraft(previous=>({...previous,...value}));setError("");setStatus("");};
  const openNew=(at?:Date)=>{
    if(siteDetails.current)siteDetails.current.open=false;
    const site=resolved.ok?resolved.value:preview;
    const latitude=site?.lat??lat,longitude=site?.lon??lon;
    const moment=at??planningShortcut("tonight",latitude,longitude).date;
    const zone=sessionTimezone({lat:latitude,lon:longitude});
    const night=makeSession(derivedNightName(observingNightDate(moment,zone),zone),moment,latitude,longitude,[],site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??"");
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
    const nextAt=resolveLocalMoment(day,time,formZone);
    setMonth(new Date(`${day}T12:00:00`));
    patch(nextAt?sessionDraftAt(draft,nextAt,formZone):{date:day,time});
  };
  const archive=(session:ObservingSession)=>{
    onUpdate({...session,archived:true});onSelect(null);setArchiveUndo(session);setMenuOpen(false);setStatus("");
    if(archiveTimer.current)clearTimeout(archiveTimer.current);
    archiveTimer.current=setTimeout(()=>setArchiveUndo(null),8000);
  };
  const undoArchive=()=>{
    if(!archiveUndo)return;
    onUpdate({...archiveUndo,archived:false});selectNight(archiveUndo.id);setArchiveUndo(null);
    if(archiveTimer.current)clearTimeout(archiveTimer.current);
  };
  const unavailableReasons=useMemo(()=>new Map(unavailable.map(step=>[step.id,preview?detailedUnavailableReason(step,preview,targetMap.get(step.id),zone):step.reason])),[unavailable,preview?.startAt,preview?.durationMinutes,preview?.lat,preview?.lon,targetMap,zone]);
  const actionForUnavailable=(id:string):{kind:"extend"|"move";at:Date}|null=>{
    if(!preview)return null;
    const target=targetMap.get(id),lunar=id.startsWith("moon:"),minimum=lunar?5:15;
    if(!target&&!lunar)return null;
    const start=new Date(preview.startAt),currentEnd=new Date(+start+preview.durationMinutes*60_000),maxEnd=new Date(+start+720*60_000);
    const feature=lunarFeatures.find(item=>`moon:${item.id}`===id),brightStar=target&&/star|asterism/i.test(target.category)&&target.mag<=5;
    const altitudeAt=(at:Date)=>lunar?moonState(preview.lat,preview.lon,at).alt:target?eqToHorizontal(target.ra,target.dec,preview.lat,preview.lon,at).alt:-90;
    const suitable=(at:Date)=>{
      const moon=moonState(preview.lat,preview.lon,at),alt=altitudeAt(at);
      if(alt<minimum||(lunar&&moon.sunSeparation<20)||(target&&moon.sunAlt>(brightStar?-6:-18)))return false;
      if(feature){const projected=projectLunarFeature(feature,lunarFrame(preview.lat,preview.lon,at));if(!projected.visible||!projected.lit)return false;}
      return true;
    };
    for(let ms=Math.ceil(+currentEnd/(15*60_000))*15*60_000;ms+preview.minutesPerTarget*60_000<=+maxEnd;ms+=15*60_000){
      const at=new Date(ms);if(suitable(at))return {kind:"extend",at};
    }
    let best:Date|null=null,bestAlt=minimum;
    for(let ms=Math.ceil((+start+30*60_000)/(15*60_000))*15*60_000;ms<=+start+24*60*60_000;ms+=15*60_000){const at=new Date(ms),alt=altitudeAt(at);if(alt>bestAlt&&suitable(at)){best=at;bestAlt=alt;}}
    return best?{kind:"move",at:best}:null;
  };
  const extendSession=(at:Date)=>{
    const nextDraft={...draft,duration:String(Math.min(720,Math.ceil((+at-new Date(preview!.startAt).getTime())/60_000)+preview!.minutesPerTarget))};
    if(isNew||!active){patch({duration:nextDraft.duration});return;}
    const result=resolveSessionDraft(nextDraft,active);if(!result.ok){setError(result.error);return;}
    const updated={...active,...result.value,items};onUpdate(updated);setDraft(sessionDraft(updated));setError("");setStatus(`Session extended to include ${formatInTimeZone(at,formZone,"HH:mm")}.`);
  };
  const moveSessionStart=(at:Date)=>{
    const nextDraft=sessionDraftAt(draft,at,formZone);
    if(isNew||!active){setDraft(nextDraft);setError("");setStatus(`Preview moved to ${formatInTimeZone(at,formZone,"MMM d · HH:mm")}. Create the night to save it.`);return;}
    const result=resolveSessionDraft(nextDraft,active);if(!result.ok){setError(result.error);return;}
    const updated={...active,...result.value,items};onUpdate(updated);setDraft(sessionDraft(updated));setError("");setStatus(`Session moved to ${formatInTimeZone(at,formZone,"MMM d · HH:mm")} to fit this target.`);
  };
  const quickNight=(kind:"tonight"|"new-moon")=>{
    if(siteDetails.current)siteDetails.current.open=false;
    const site=resolved.ok?resolved.value:preview;
    const latitude=site?.lat??lat,longitude=site?.lon??lon;
    const at=planningShortcut(kind,latitude,longitude).date;
    const existing=present.find(session=>sameObservingNight(session,at,latitude,longitude));
    const sourceItems=visibleItems;
    if(kind==="new-moon"){
      setCarryover({at,lat:latitude,lon:longitude,locationName:site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??"",existing,items:sourceItems});
      setError("");return;
    }
    if(existing){selectNight(existing.id);}
    else {const zone=sessionTimezone({lat:latitude,lon:longitude});onCreate(makeSession(derivedNightName(observingNightDate(at,zone),zone),at,latitude,longitude,[],site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??""));}
    setStatus("Tonight’s observing night is ready. Add targets below.");setError("");
  };
  const finishCarryover=(bring:boolean)=>{
    if(!carryover)return;
    const copied=bring?duplicateNightItems(carryover.items):[];
    if(carryover.existing){
      if(bring){const existingIds=new Set(carryover.existing.items.map(item=>item.id));onUpdate({...carryover.existing,items:[...carryover.existing.items,...copied.filter(item=>!existingIds.has(item.id))]});}
      selectNight(carryover.existing.id);
    } else {
      const zone=sessionTimezone({lat:carryover.lat,lon:carryover.lon});
      const night=makeSession(derivedNightName(observingNightDate(carryover.at,zone),zone),carryover.at,carryover.lat,carryover.lon,copied,carryover.locationName);
      onCreate(night);
    }
    setCarryover(null);setStatus(bring?`Night ready with ${copied.length} copied target${copied.length===1?"":"s"}. Original notes and observations remain on the source night.`:"New-Moon night ready. The source night is unchanged.");setError("");
  };
  const duplicateActive=()=>{
    if(!active)return;
    const copyName=`${active.name.slice(0,94)} copy`;
    const fresh=makeSession(copyName,new Date(active.startAt),active.lat,active.lon,duplicateNightItems(active.items),active.locationName);
    fresh.durationMinutes=active.durationMinutes;fresh.minutesPerTarget=active.minutesPerTarget;
    onCreate(fresh);setMenuOpen(false);setStatus(`Duplicated “${active.name}” with fresh target records. The original is unchanged.`);
  };
  const nameFor=(id:string)=>targetMap.get(id)?.displayName??lunarFeatures.find(feature=>`moon:${feature.id}`===id)?.name??id;
  const row=(item:NightItem,index:number,step?:SequenceStep)=> <li key={item.id} className={step&&!step.date?"unavailable":""}>
    <div className="planner-row-main"><span className="planner-order">{item.observedAt?<Check size={13}/>:index+1}</span>
      <div className="planner-row-copy"><strong>{nameFor(item.id)}</strong><span>{item.observedAt?`Observed ${formatInTimeZone(new Date(item.observedAt),zone,"MMM d, yyyy")}`:step?.date?`${formatInTimeZone(step.date,zone,"HH:mm")} · ${Math.round(step.alt)}° ${compassLabel(step.az)}${step.separation!==null?(forecastMoon(step.date).alt<=0?" · Moon down":` · ${Math.round(step.separation)}° from Moon`):""}`:step?.reason??"No scheduled time"}</span>{step?.date&&step.reason!=="Well placed at this time"&&<small>{step.reason}</small>}</div>
      <div className="planner-row-actions"><button className="icon-button" aria-label={`${item.observedAt?"Log another observation":"Log observation"}: ${nameFor(item.id)}`} title={item.observedAt?"Log another observation":"Log observation"} disabled={isNew} onClick={()=>onObserved(item.id)}>{item.observedAt?<CheckCircle2 size={17}/>:<Circle size={17}/>}</button><button className="text-action" disabled={isNew||(!targetMap.has(item.id)&&!item.id.startsWith("moon:"))} onClick={()=>onVisit(item.id,step?.date??new Date(preview!.startAt))}>Hop to it <ArrowUpRight size={12}/></button><button className="icon-button" aria-label={`Remove ${nameFor(item.id)} from session`} disabled={isNew} onClick={()=>onAdd(item.id)}><X size={14}/></button></div>
    </div>
    {targetMap.has(item.id)&&<NightObservationDetails target={targetMap.get(item.id)!} lat={forecastLat} lon={forecastLon} night={forecastNight} timezone={zone} skyBrightness={skyBrightness} moonAt={forecastMoon} range={forecastRange} selectedAt={step?.date??undefined} initialOpen={index===0&&!item.observedAt&&!!step?.date}/>}
    {step&&!step.date&&(()=>{const action=actionForUnavailable(item.id);return action?<div className="planner-unavailable-action"><button type="button" className="text-action" onClick={()=>action.kind==="extend"?extendSession(action.at):moveSessionStart(action.at)}>{action.kind==="extend"?"Extend session":"Move session"} to {formatInTimeZone(action.at,zone,"HH:mm")}</button></div>:null})()}
    {!!item.observations?.length&&<details className="planner-row-notes"><summary>Observation history · {item.observations?.length??0}</summary><ol>{(item.observations??[]).map((observation,index)=><li key={`${observation.at}-${index}`}><strong>{formatInTimeZone(new Date(observation.at),zone,"MMM d, yyyy · HH:mm")}</strong>{observation.instrument&&<span> · {observation.instrument}</span>}{observation.notes&&<p>{observation.notes}</p>}</li>)}</ol></details>}
    <details className="planner-row-notes"><summary>{item.notes?"Field notes · saved":"Add field notes"}</summary><Textarea aria-label={`Notes for ${nameFor(item.id)}`} value={item.notes} disabled={isNew} rows={2} onChange={event=>onNotes(item.id,event.target.value)} placeholder="Conditions, colors, what caught your eye…"/>{isNew&&<p>Create this night to edit its records.</p>}</details>
  </li>;

  return <ObservingContextScope date={resolved.ok?new Date(resolved.value.startAt):date} timezone={formZone} lat={resolved.ok?resolved.value.lat:lat} lon={resolved.ok?resolved.value.lon:lon} locationName={draft.place||"Session site"} onTime={at=>changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),formatInTimeZone(at,formZone,"HH:mm"))} onLocation={(a,b,name)=>patch({lat:String(a),lon:String(b),place:name})}><div className="session-planner planner-workbench" data-testid="session-planner">
    <details open className="panel upcoming-nights-disclosure"><summary>Compare upcoming nights · Moon-free darkness</summary><UpcomingNights lat={forecastLat} lon={forecastLon} timezone={formZone} date={resolved.ok?new Date(resolved.value.startAt):date} selected={selectedTarget} targets={targets.filter(target=>visibleItems.some(item=>item.id===target.id))} onDate={at=>{changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),formatInTimeZone(at,formZone,"HH:mm"));onPreview(at,forecastLat,forecastLon,true);}}/></details>
    <section className="panel planner-command" aria-label="Plan your observing night">
      {archiveUndo&&<div className="planner-archive-undo" role="status"><span>Archived “{archiveUndo.name}”.</span><button type="button" className="text-action" onClick={undoArchive}><Undo2 size={13}/> Undo</button></div>}
      <div className="planner-night-switch"><label>Observing night<select aria-label="Observing session" value={isNew?"new":active?.id??"new"} onChange={event=>{if(event.target.value==="new")openNew();else{selectNight(event.target.value);}}}><option value="new">New observing night</option>{present.map(session=><option key={session.id} value={session.id}>{session.name} · {formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"HH:mm")}</option>)}</select></label><button className="text-action" aria-label="Calendar and saved nights" onClick={()=>{setMonth(new Date(`${calendarDate}T12:00:00`));setCalendarOpen(true);}}><CalendarDays size={15}/><span>Calendar</span></button><button className="text-action" aria-label="New night" onClick={()=>openNew()}><Plus size={15}/><span>New night</span></button><Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><button type="button" className="text-action planner-workspace-menu" aria-label="Export and session actions"><Download size={15}/><span>Export & more</span></button></PopoverTrigger><PopoverContent align="end" className="grid w-72 gap-2 rounded-md border border-[#42645e] bg-[#10232e] p-3 text-[#d1e0d6] shadow-xl">{(!isNew||!active)?actions:<p>Create this night before exporting it.</p>}{active&&!isNew&&<><button className="text-action" onClick={duplicateActive}><Copy size={12}/> Duplicate night</button><button className="text-action" onClick={()=>{setMenuOpen(false);onPreview(new Date(active.startAt),active.lat,active.lon);}}>View this night’s sky <ArrowUpRight size={12}/></button><button className="text-action" onClick={()=>archive(active)}><Archive size={12}/> Archive night</button></>}</PopoverContent></Popover></div>
      <div className="planner-quick-nights"><button disabled={!resolved.ok} onClick={()=>{if(resolved.ok)onCompare(visibleItems.map(item=>item.id),new Date(resolved.value.startAt),resolved.value.lat,resolved.value.lon);}}><CalendarDays size={14}/> Clock & compare this night</button><button onClick={()=>quickNight("tonight")}><Compass size={14}/> Plan tonight</button><button onClick={()=>quickNight("new-moon")}><Moon size={14}/> Next new Moon</button></div>
      <form onSubmit={event=>{event.preventDefault();save();}} className="planner-inline-form">
        <div className="planner-time-fields"><label className="min-w-0 flex-1 basis-[150px]">Date<div className="planner-date-control"><input aria-label="Planned session date" type="date" value={draft.date} onChange={event=>changeDateTime(event.target.value,draft.time)}/><Popover><PopoverTrigger asChild><button type="button" className="planner-calendar-trigger" aria-label="Choose planned session date"><CalendarDays size={15}/></button></PopoverTrigger><PopoverContent align="start" className="planner-date-calendar w-auto rounded-md border border-[#42645e] bg-[#10232e] p-2 text-[#d1e0d6] shadow-xl"><ObservingCalendar value={resolved.ok?new Date(resolved.value.startAt):date} onChange={at=>changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),draft.time)} lat={resolved.ok?resolved.value.lat:lat} lon={resolved.ok?resolved.value.lon:lon} timezone={formZone} month={month} onMonthChange={setMonth} savedDates={present.map(session=>observingNightDate(new Date(session.startAt),formZone))}/></PopoverContent></Popover></div></label><label className="min-w-0 flex-1 basis-[130px]">Local start<input aria-label="Planned session time" type="time" value={draft.time} onChange={event=>changeDateTime(draft.date,event.target.value)}/></label><label className="min-w-0 flex-1 basis-[100px]">Length · min<input aria-label="Session duration" type="number" min={30} max={720} step={1} value={draft.duration} onChange={event=>patch({duration:event.target.value})}/></label>{(isNew||dirty)&&<Button type="submit" className={isNew?"planner-create-empty":""}>{isNew?"Create night":"Save changes"}</Button>}</div>
        <SavedLocations context="Session" locations={savedLocations} lat={draft.lat.trim()?Number(draft.lat):NaN} lon={draft.lon.trim()?Number(draft.lon):NaN} name={draft.place} onChange={onLocationsChange} onSelect={site=>patch({place:site.name,lat:String(site.lat),lon:String(site.lon)})}/>
        <details ref={siteDetails} className="planner-site-details"><summary><MapPin size={13}/>{draft.place||knownLocationName(savedLocations,Number(draft.lat),Number(draft.lon))||`${draft.lat}°, ${draft.lon}°`} · {formZone.replaceAll("_"," ")} <span>Change site & details</span></summary><CoordinatePairInput onParsed={(a,b)=>patch({lat:String(a),lon:String(b),place:""})}/><div className="session-editor-fields"><label>Night name<input aria-label="Session name" value={draft.name} onChange={event=>patch({name:event.target.value})}/></label><label>Site name<input aria-label="Observing site name" value={draft.place} placeholder="Back garden, campsite…" onChange={event=>patch({place:event.target.value})}/></label><label>Latitude<input aria-label="Session latitude" type="number" min={-90} max={90} step="any" value={draft.lat} onChange={event=>patch({lat:event.target.value})}/></label><label>Longitude<input aria-label="Session longitude" type="number" min={-180} max={180} step="any" value={draft.lon} onChange={event=>patch({lon:event.target.value})}/></label><label>Minutes per target<input aria-label="Minutes per target" type="number" min={5} max={60} value={draft.perTarget} onChange={event=>patch({perTarget:event.target.value})}/></label></div><div className="session-site-presets"><span>Use a site:</span>{[["San Francisco",37.77,-122.42],["London",51.5,-.12],["Sydney",-33.87,151.21]].map(([name,a,b])=><button type="button" key={String(name)} onClick={()=>patch({place:String(name),lat:String(a),lon:String(b)})}>{name}</button>)}</div>{isNew&&items.length>0&&<label className="session-copy"><input type="checkbox" checked={copy} onChange={event=>setCopy(event.target.checked)}/>{active?"Reuse this night’s targets with fresh observations":"Keep my unscheduled targets, notes and observations"}</label>}{(isNew||dirty)&&<Button type="submit" variant="outline">{isNew?"Create night":"Save changes"}</Button>}</details>
      </form>
      {isNew&&<p className="planner-inline-hint">Your first target saves this night.</p>}{dirty&&<p className="planner-inline-hint">Save your changes to update this night’s viewing times. Exports use the saved night.</p>}{error&&<p className="session-editor-error" role="alert">{error}</p>}

    </section>

    {resolved.ok&&<>{(isNew||dirty)&&<p className="planner-preview-label">Unsaved preview · weather, altitude and suggestions use these values. Save to keep this session.</p>}<WeatherPanel lat={resolved.value.lat} lon={resolved.value.lon} date={new Date(resolved.value.startAt)} timezone={formZone} skyBrightness={skyBrightness} locationName={resolved.value.locationName||knownLocationName(savedLocations,resolved.value.lat,resolved.value.lon)||`${resolved.value.lat.toFixed(2)}°, ${resolved.value.lon.toFixed(2)}°`} onTime={at=>changeDateTime(formatInTimeZone(at,formZone,"yyyy-MM-dd"),formatInTimeZone(at,formZone,"HH:mm"))}/></>}

    <section className="panel planner-target-board" aria-label="Targets and viewing sequence">
      <CatalogCombobox targets={targets} query={query} onQuery={setQuery} onSelect={add} savedIds={savedIds} label="Add targets" placeholder="Search M31, a star, cluster, double star…" className="planner-target-search"/>
      {!query.trim()&&suggestions.length>0&&visibleItems.length===0&&<div className="planner-suggestions"><span>Binocular picks across your {isNew||dirty?"chosen":"saved"} session · ranked by optical fit, useful apparent size and brightness</span><div>{(allSuggestions?suggestions:suggestions.slice(0,8)).map(({target,alt,fit,dark,at})=><button type="button" key={target.id} aria-label={`Add ${target.displayName} to session`} onClick={()=>add(target)}><strong>{target.name}</strong><small>{fit===0?"Excellent fit":fit===1?"Worthwhile":fit===2?"Challenging":"Telescope more rewarding"} · {Math.round(alt)}° at {formatInTimeZone(at,zone,"HH:mm")} · {dark?"dark":"twilight"} <Plus size={12}/></small></button>)}</div>{suggestions.length>8&&<button type="button" className="text-action" onClick={()=>setAllSuggestions(value=>!value)}>{allSuggestions?"Show top 8":`Show all ${suggestions.length} binocular suggestions`}</button>}<Button type="button" variant="outline" onClick={addTopFive}>Add top 5 for binoculars</Button></div>}
      <p className="planner-add-status" role="status">{status||"Search and press Enter to add the highlighted match."}</p>
      <div className="planner-sequence-heading"><h3>Your viewing order</h3><span>{scheduled.length} scheduled · {completed.length} observed{preview?` · ${preview.minutesPerTarget} min each`:""}</span></div>
      {!visibleItems.length&&<p className="planner-empty-copy">Add a target above. StarHop will suggest an order that gives setting objects a chance before they get too low.</p>}
      {preview&&visibleItems.length>0&&<SessionTimeline session={preview} items={visibleItems} steps={sequence} targets={targets} zone={zone} darkSegments={forecastNight.ok?forecastNight.segments:[]} moonAt={forecastMoon}/>}
      <ol className="planner-sequence">{scheduled.map((step,index)=>{const item=visibleItems.find(item=>item.id===step.id);return item?row(item,index,step):null;})}</ol>
      {unavailable.length>0&&<details className="planner-unavailable" open><summary>Doesn’t fit this session · {unavailable.length}</summary><ol className="planner-sequence">{unavailable.map((step,index)=>{const item=visibleItems.find(item=>item.id===step.id);return item?row(item,index,{...step,reason:unavailableReasons.get(step.id)??step.reason}):null;})}</ol></details>}
      {completed.length>0&&<details className="planner-completed"><summary>Observed targets ({completed.length})</summary><ol className="planner-sequence">{completed.map((item,index)=>row(item,index))}</ol></details>}
      <details className="planner-method"><summary>How the order is suggested</summary><p>Targets with earlier closing viewing windows come first, then altitude and reduced moonlight. Deep-sky targets need astronomical darkness; bright stellar targets allow twilight. Lunar features must be sunlit and the Moon up. Each target’s Altitude & Moon graph shows a suggested individual time inside the saved session, balancing altitude with lunar phase, altitude and angular separation. Solid mint uses the left altitude axis; dashed silver uses the right Moon-distance axis (180° is opposite). Gray shading is modeled sky glow, not a visibility probability. Slots can differ from individual suggestions to fit other targets and closing windows. Weather forecasts are shown separately and do not change this order. Local obstructions are not measured.</p></details>
    </section>

    <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}><DialogContent className="planner-calendar-dialog"><DialogHeader><DialogTitle>Calendar & saved nights</DialogTitle><DialogDescription>Select a saved night, or pick a date to start a new one. Existing nights keep their observations and notes.</DialogDescription></DialogHeader><div className="planner-calendar-layout"><section className="planner-calendar"><ObservingCalendar value={new Date(`${calendarDate}T12:00:00`)} onChange={at=>{const selected=formatInTimeZone(at,formZone,"yyyy-MM-dd"),evening=eveningOn(selected,preview?.lat??lat,preview?.lon??lon),existing=present.find(session=>sameObservingNight(session,evening.date,preview?.lat??lat,preview?.lon??lon));if(existing)selectNight(existing.id);else openNew(evening.date);setCalendarOpen(false);}} lat={preview?.lat??lat} lon={preview?.lon??lon} timezone={formZone} month={month} onMonthChange={setMonth} savedDates={present.map(session=>observingNightDate(new Date(session.startAt),formZone))}/></section><section className="planner-sessions"><h3>Saved nights</h3>{present.map(session=><button key={session.id} className={`planner-session-card ${active?.id===session.id?"active":""}`} onClick={()=>{selectNight(session.id);setCalendarOpen(false);}} data-testid={`session-${session.id}`}><strong>{session.name}</strong><span>Night {formatInTimeZone(new Date(`${observingNightDate(new Date(session.startAt),sessionTimezone(session))}T12:00:00Z`),"UTC","MMM d, yyyy")} · starts {formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"MMM d, HH:mm")} · {session.items.length} targets</span></button>)}{!present.length&&<p className="planner-empty-copy">Your saved nights will appear here.</p>}{archived.length>0&&<details><summary>Archived nights ({archived.length})</summary>{archived.map(session=><div className="planner-archived" key={session.id}><span>{session.name}</span><button className="text-action" onClick={()=>{onUpdate({...session,archived:false});selectNight(session.id);setCalendarOpen(false);}}>Restore</button></div>)}</details>}</section></div></DialogContent></Dialog>
    <Dialog open={!!carryover} onOpenChange={open=>{if(!open)setCarryover(null);}}><DialogContent className="planner-carryover-dialog"><DialogHeader><DialogTitle>Bring targets to the next new-Moon night?</DialogTitle><DialogDescription>{carryover?.items.length?`Copy ${carryover.items.length} target${carryover.items.length===1?"":"s"} into ${carryover.existing?`the existing night “${carryover.existing.name}”`:"a new night"}? New copies start with blank notes and no observation history; the original night stays unchanged.`:"There are no targets to carry over. Create or open the next new-Moon night?"}</DialogDescription></DialogHeader><div className="planner-carryover-actions"><Button type="button" variant="outline" onClick={()=>finishCarryover(false)}>{carryover?.existing?"Open existing night as-is":"Start empty"}</Button>{!!carryover?.items.length&&<Button type="button" onClick={()=>finishCarryover(true)}>Bring {carryover.items.length} target{carryover.items.length===1?"":"s"}</Button>}</div></DialogContent></Dialog>
  </div></ObservingContextScope>;
}
