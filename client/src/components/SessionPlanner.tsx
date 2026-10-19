import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";
import { CalendarDays, Plus, Moon, Compass, ArrowUpRight, MapPin, Archive, Download, Check, X, Circle, CheckCircle2 } from "lucide-react";
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
import { catalogSearchScore } from "@/lib/catalog-search";
import { makeSession, planningShortcut, eveningOn, sessionTimezone, suggestSequence, type ObservingSession, type SequenceStep } from "@/lib/session-planner";
import { sessionDraft, resolveSessionDraft, reuseNightItems, type SessionDraft } from "@/lib/session-draft";
import { eqToHorizontal, type UnifiedTarget } from "@/lib/astronomy";
import { lunarFeatures } from "@/lib/moon";
import { compassLabel } from "@/lib/observing";
import type { NightItem } from "@/lib/session";

interface Props {
  savedLocations:SavedLocation[]; onLocationsChange:(locations:SavedLocation[])=>void;
  sessions:ObservingSession[]; active:ObservingSession|undefined; targets:UnifiedTarget[];
  date:Date; lat:number; lon:number; timezone:string; items:NightItem[]; skyBrightness:number; live:boolean;
  actions:ReactNode;
  onCreate:(s:ObservingSession)=>void; onUpdate:(s:ObservingSession)=>void; onSelect:(id:string|null)=>void;
  onPreview:(at:Date,lat:number,lon:number,stay?:boolean)=>void; onVisit:(id:string,at:Date)=>void;
  onAdd:(id:string)=>void; onObserved:(id:string)=>void; onNotes:(id:string,notes:string)=>void;
}
export function SessionPlanner({savedLocations,onLocationsChange,sessions,active,targets,date,lat,lon,timezone,items,skyBrightness,live,actions,onCreate,onUpdate,onSelect,onPreview,onVisit,onAdd,onObserved,onNotes}:Props) {
  const defaultNight = () => {
    const at=live?planningShortcut("tonight",lat,lon).date:date;
    return makeSession(`${formatInTimeZone(at,timezone,"MMM d")} observing night`,at,lat,lon,[],matchingLocation(savedLocations,lat,lon)?.name??"");
  };
  const [draft,setDraft]=useState(()=>sessionDraft(active??defaultNight()));
  const [isNew,setIsNew]=useState(!active);
  const [copy,setCopy]=useState(!active&&items.length>0);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [calendarOpen,setCalendarOpen]=useState(false);
  const [month,setMonth]=useState(()=>new Date(`${formatInTimeZone(date,timezone,"yyyy-MM-dd")}T12:00:00`));
  const search=useRef<HTMLInputElement>(null);
  const siteDetails=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    setIsNew(!active);setDraft(sessionDraft(active??defaultNight()));setCopy(!active&&items.length>0);setError("");if(siteDetails.current)siteDetails.current.open=false;
  },[active?.id,active?.name,active?.startAt,active?.lat,active?.lon,active?.locationName,active?.durationMinutes,active?.minutesPerTarget]);
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
  const matches=useMemo(()=>query.trim()?targets.filter(target=>Number.isFinite(catalogSearchScore(target,query))).sort((a,b)=>catalogSearchScore(a,query)-catalogSearchScore(b,query)).slice(0,8):[],[query,targets]);
  const suggestions=useMemo(()=>preview?targets.filter(target=>!target.id.startsWith("star:")&&target.mag<=8&&!visibleItems.some(item=>item.id===target.id))
    .map(target=>({target,...eqToHorizontal(target.ra,target.dec,preview.lat,preview.lon,new Date(preview.startAt))}))
    .filter(target=>target.alt>=25).sort((a,b)=>b.alt-a.alt||a.target.mag-b.target.mag).slice(0,3):[],[targets,preview?.startAt,preview?.lat,preview?.lon,visibleItems]);
  const patch=(value:Partial<SessionDraft>)=>{setDraft(previous=>({...previous,...value}));setError("");};
  const openNew=(at?:Date)=>{
    if(siteDetails.current)siteDetails.current.open=false;
    const site=resolved.ok?resolved.value:preview;
    const latitude=site?.lat??lat,longitude=site?.lon??lon;
    const moment=at??planningShortcut("tonight",latitude,longitude).date;
    const night=makeSession(`${formatInTimeZone(moment,sessionTimezone({lat:latitude,lon:longitude}),"MMM d")} observing night`,moment,latitude,longitude,[],site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??"");
    setDraft(sessionDraft(night));setIsNew(true);setCopy(!active&&items.length>0);setError("");setStatus("");setQuery("");
  };
  const save=(targetId?:string)=>{
    if(!resolved.ok){setError(resolved.error);return false;}
    const chosenItems=isNew?visibleItems:items;
    const nextItems=targetId&&!chosenItems.some(item=>item.id===targetId)?[...chosenItems,{id:targetId,addedAt:new Date().toISOString(),notes:""}]:chosenItems;
    if(isNew||!active){onCreate({...makeSession(resolved.value.name,new Date(resolved.value.startAt),resolved.value.lat,resolved.value.lon,nextItems,resolved.value.locationName),...resolved.value});}
    else onUpdate({...active,...resolved.value,items:nextItems});
    setIsNew(false);setError("");if(siteDetails.current)siteDetails.current.open=false;return true;
  };
  const add=(target:UnifiedTarget)=>{
    if(savedIds.has(target.id)){setStatus(`${target.name} is already in this night.`);return;}
    if(isNew||dirty){if(!save(target.id))return;}else onAdd(target.id);
    setQuery("");setStatus(`Added ${target.name}.`);search.current?.focus({preventScroll:true});
  };
  const quickNight=(kind:"tonight"|"new-moon")=>{
    if(siteDetails.current)siteDetails.current.open=false;
    const site=resolved.ok?resolved.value:preview;
    const latitude=site?.lat??lat,longitude=site?.lon??lon;
    const at=planningShortcut(kind,latitude,longitude).date;
    const existing=present.find(session=>Math.abs(session.lat-latitude)<.0001&&Math.abs(session.lon-longitude)<.0001&&Math.abs(Date.parse(session.startAt)-at.getTime())<=30*60_000);
    if(existing){selectNight(existing.id);}
    else onCreate(makeSession(`${formatInTimeZone(at,sessionTimezone({lat:latitude,lon:longitude}),"MMM d")} observing night`,at,latitude,longitude,!active?reuseNightItems(items,true):[],site?.locationName??matchingLocation(savedLocations,latitude,longitude)?.name??""));
    setStatus(kind==="tonight"?"Tonight’s observing night is ready. Add targets below.":"A night near the next new Moon is ready. Add targets below.");setError("");
  };
  const nameFor=(id:string)=>targetMap.get(id)?.displayName??lunarFeatures.find(feature=>`moon:${feature.id}`===id)?.name??id;
  const row=(item:NightItem,index:number,step?:SequenceStep)=> <li key={item.id} className={step&&!step.date?"unavailable":""}>
    <div className="planner-row-main"><span className="planner-order">{item.observedAt?<Check size={13}/>:index+1}</span>
      <div className="planner-row-copy"><strong>{nameFor(item.id)}</strong><span>{item.observedAt?`Observed ${formatInTimeZone(new Date(item.observedAt),zone,"MMM d, yyyy")}`:step?.date?`${formatInTimeZone(step.date,zone,"HH:mm")} · ${Math.round(step.alt)}° ${compassLabel(step.az)}${step.separation!==null?` · ${Math.round(step.separation)}° from Moon`:""}`:step?.reason??"No scheduled time"}</span>{step?.date&&step.reason!=="Well placed at this time"&&<small>{step.reason}</small>}</div>
      <div className="planner-row-actions"><button className="icon-button" aria-label={`${item.observedAt?"Mark unobserved":"Mark observed"}: ${nameFor(item.id)}`} disabled={isNew} onClick={()=>onObserved(item.id)}>{item.observedAt?<CheckCircle2 size={17}/>:<Circle size={17}/>}</button><button className="text-action" disabled={isNew||(!targetMap.has(item.id)&&!item.id.startsWith("moon:"))} onClick={()=>onVisit(item.id,step?.date??new Date(preview!.startAt))}>Find <ArrowUpRight size={12}/></button><button className="icon-button" aria-label={`Remove ${nameFor(item.id)} from session`} disabled={isNew} onClick={()=>onAdd(item.id)}><X size={14}/></button></div>
    </div>
    {targetMap.has(item.id)&&<NightObservationDetails target={targetMap.get(item.id)!} lat={forecastLat} lon={forecastLon} night={forecastNight} timezone={zone} skyBrightness={skyBrightness} moonAt={forecastMoon} range={forecastRange} initialOpen={index===0&&!item.observedAt&&!!step?.date}/>}
    <details className="planner-row-notes"><summary>{item.notes?"Field notes · saved":"Add field notes"}</summary><Textarea aria-label={`Notes for ${nameFor(item.id)}`} value={item.notes} disabled={isNew} rows={2} onChange={event=>onNotes(item.id,event.target.value)} placeholder="Conditions, colors, what caught your eye…"/>{isNew&&<p>Create this night to edit its records.</p>}</details>
  </li>;

  return <div className="session-planner planner-workbench" data-testid="session-planner">
    <section className="panel planner-command" aria-label="Plan your observing night">
      <div className="planner-night-switch"><label>Observing night<select aria-label="Observing session" value={isNew?"new":active?.id??"new"} onChange={event=>{if(event.target.value==="new")openNew();else{selectNight(event.target.value);}}}><option value="new">New observing night</option>{present.map(session=><option key={session.id} value={session.id}>{session.name} · {formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"MMM d")}</option>)}</select></label><button className="text-action" aria-label="Calendar and saved nights" onClick={()=>{setMonth(new Date(`${calendarDate}T12:00:00`));setCalendarOpen(true);}}><CalendarDays size={15}/><span>Calendar</span></button><button className="text-action" aria-label="New night" onClick={()=>openNew()}><Plus size={15}/><span>New night</span></button><details className="planner-session-actions planner-workspace-menu"><summary aria-label="Export and session actions"><Download size={15}/><span>Export & more</span></summary><div className="planner-menu-actions">{(!isNew||!active)?actions:<p>Create this night before exporting it.</p>}{active&&!isNew&&<><button className="text-action" onClick={()=>onPreview(new Date(active.startAt),active.lat,active.lon)}>View this night’s sky <ArrowUpRight size={12}/></button><button className="text-action" onClick={()=>{onUpdate({...active,archived:true});onSelect(null);}}><Archive size={12}/> Archive night</button></>}</div></details></div>
      <div className="planner-quick-nights"><button onClick={()=>quickNight("tonight")}><Compass size={14}/> Plan tonight</button><button onClick={()=>quickNight("new-moon")}><Moon size={14}/> Next new Moon</button></div>
      <form onSubmit={event=>{event.preventDefault();save();}} className="planner-inline-form">
        <div className="planner-time-fields"><label>Date<input aria-label="Planned session date" type="date" value={draft.date} onChange={event=>patch({date:event.target.value})}/></label><label>Local start<input aria-label="Planned session time" type="time" value={draft.time} onChange={event=>patch({time:event.target.value})}/></label><label>Length · min<input aria-label="Session duration" type="number" min={30} max={720} step={1} value={draft.duration} onChange={event=>patch({duration:event.target.value})}/></label>{(isNew||dirty)&&<Button type="submit" className={isNew?"planner-create-empty":""}>{isNew?"Create night":"Save changes"}</Button>}</div>
        <SavedLocations context="Session" locations={savedLocations} lat={draft.lat.trim()?Number(draft.lat):NaN} lon={draft.lon.trim()?Number(draft.lon):NaN} name={draft.place} onChange={onLocationsChange} onSelect={site=>patch({place:site.name,lat:String(site.lat),lon:String(site.lon)})}/>
        <details ref={siteDetails} className="planner-site-details"><summary><MapPin size={13}/>{draft.place||`${draft.lat}°, ${draft.lon}°`} · {formZone.replaceAll("_"," ")} <span>Change site & details</span></summary><div className="session-editor-fields"><label>Night name<input aria-label="Session name" value={draft.name} onChange={event=>patch({name:event.target.value})}/></label><label>Site name<input aria-label="Observing site name" value={draft.place} placeholder="Back garden, campsite…" onChange={event=>patch({place:event.target.value})}/></label><label>Latitude<input aria-label="Session latitude" type="number" min={-90} max={90} step="any" value={draft.lat} onChange={event=>patch({lat:event.target.value})}/></label><label>Longitude<input aria-label="Session longitude" type="number" min={-180} max={180} step="any" value={draft.lon} onChange={event=>patch({lon:event.target.value})}/></label><label>Minutes per target<input aria-label="Minutes per target" type="number" min={5} max={60} value={draft.perTarget} onChange={event=>patch({perTarget:event.target.value})}/></label></div><div className="session-site-presets"><span>Use a site:</span>{[["San Francisco",37.77,-122.42],["London",51.5,-.12],["Sydney",-33.87,151.21]].map(([name,a,b])=><button type="button" key={String(name)} onClick={()=>patch({place:String(name),lat:String(a),lon:String(b)})}>{name}</button>)}</div>{isNew&&items.length>0&&<label className="session-copy"><input type="checkbox" checked={copy} onChange={event=>setCopy(event.target.checked)}/>{active?"Reuse this night’s targets with fresh observations":"Keep my unscheduled targets, notes and observations"}</label>}{(isNew||dirty)&&<Button type="submit" variant="outline">{isNew?"Create night":"Save changes"}</Button>}</details>
      </form>
      {isNew&&<p className="planner-inline-hint">Your first target saves this night.</p>}{dirty&&<p className="planner-inline-hint">Save your changes to update this night’s viewing times. Exports use the saved night.</p>}{error&&<p className="session-editor-error" role="alert">{error}</p>}

    </section>

    {resolved.ok&&<WeatherPanel lat={resolved.value.lat} lon={resolved.value.lon} date={new Date(resolved.value.startAt)} timezone={formZone} locationName={resolved.value.locationName||matchingLocation(savedLocations,resolved.value.lat,resolved.value.lon)?.name||`${resolved.value.lat.toFixed(2)}°, ${resolved.value.lon.toFixed(2)}°`} onTime={at=>patch({date:formatInTimeZone(at,formZone,"yyyy-MM-dd"),time:formatInTimeZone(at,formZone,"HH:mm")})}/>}

    <section className="panel planner-target-board" aria-label="Targets and viewing sequence">
      <label className="planner-target-search">Add targets<input ref={search} aria-label="Add target to session" placeholder="Search M31, a star, cluster, double star…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing&&matches[0]){event.preventDefault();add(matches[0]);}}}/></label>
      {matches.length>0&&<div className="planner-search-results">{matches.map(target=><button key={target.id} disabled={savedIds.has(target.id)} aria-label={`${savedIds.has(target.id)?"Already added":"Add"} ${target.displayName} to session`} onClick={()=>add(target)}><span>{target.displayName}</span>{savedIds.has(target.id)?<Check size={15}/>:<Plus size={15}/>}</button>)}</div>}
      {query.trim()&&!matches.length&&<p className="planner-empty-copy" role="status">No matches for “{query.trim()}”. Try a name or catalog number.</p>}
      {!query.trim()&&suggestions.length>0&&visibleItems.length===0&&<div className="planner-suggestions"><span>High at your {isNew?"chosen":"saved"} time</span><div>{suggestions.map(({target,alt})=><button key={target.id} aria-label={`Add ${target.displayName} to session`} onClick={()=>add(target)}><strong>{target.name}</strong><small>{Math.round(alt)}° high <Plus size={12}/></small></button>)}</div></div>}
      <p className="planner-add-status" role="status">{status||"Search and press Enter to add the first match."}</p>
      <div className="planner-sequence-heading"><h3>Your viewing order</h3><span>{scheduled.length} scheduled · {completed.length} observed{preview?` · ${preview.minutesPerTarget} min each`:""}</span></div>
      {!visibleItems.length&&<p className="planner-empty-copy">Add a target above. StarHop will suggest an order that gives setting objects a chance before they get too low.</p>}
      <ol className="planner-sequence">{scheduled.map((step,index)=>{const item=visibleItems.find(item=>item.id===step.id);return item?row(item,index,step):null;})}</ol>
      {unavailable.length>0&&<details className="planner-unavailable" open={!scheduled.length}><summary>Outside this night’s usable window ({unavailable.length})</summary><ol className="planner-sequence">{unavailable.map((step,index)=>{const item=visibleItems.find(item=>item.id===step.id);return item?row(item,index,step):null;})}</ol></details>}
      {completed.length>0&&<details className="planner-completed"><summary>Observed targets ({completed.length})</summary><ol className="planner-sequence">{completed.map((item,index)=>row(item,index))}</ol></details>}
      <details className="planner-method"><summary>How the order is suggested</summary><p>Targets with earlier closing viewing windows come first, then altitude and reduced moonlight. Deep-sky targets need astronomical darkness; bright stellar targets allow twilight. Lunar features must be sunlit and the Moon up. Each target’s Altitude & Moon graph shows a suggested individual time inside the saved session, balancing altitude with lunar phase, altitude and angular separation. Solid mint uses the left altitude axis; dashed gold uses the right Moon-distance axis (180° is opposite). Gold shading is modeled sky glow, not a visibility probability. Slots can differ from individual suggestions to fit other targets and closing windows. Weather forecasts are shown separately and do not change this order. Local obstructions are not measured.</p></details>
    </section>

    <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}><DialogContent className="planner-calendar-dialog"><DialogHeader><DialogTitle>Calendar & saved nights</DialogTitle><DialogDescription>Select a saved night, or pick a date to start a new one. Existing nights keep their observations and notes.</DialogDescription></DialogHeader><div className="planner-calendar-layout"><section className="planner-calendar"><Calendar mode="single" month={month} onMonthChange={setMonth} selected={new Date(`${calendarDate}T12:00:00`)} onSelect={day=>{if(!day)return;const selected=format(day,"yyyy-MM-dd");const existing=present.find(session=>formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"yyyy-MM-dd")===selected);if(existing){selectNight(existing.id);}else openNew(eveningOn(selected,preview?.lat??lat,preview?.lon??lon).date);setCalendarOpen(false);}} labels={{labelDay:(day,modifiers)=>`${format(day,"EEEE, MMMM d, yyyy")}${modifiers.planned?", saved observing session":""}`}} modifiers={{planned:present.map(session=>new Date(`${formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"yyyy-MM-dd")}T12:00:00`))}} modifiersClassNames={{planned:"calendar-has-session"}}/><p>Marked dates have saved observing nights.</p></section><section className="planner-sessions"><h3>Saved nights</h3>{present.map(session=><button key={session.id} className={`planner-session-card ${active?.id===session.id?"active":""}`} onClick={()=>{selectNight(session.id);setCalendarOpen(false);}} data-testid={`session-${session.id}`}><strong>{session.name}</strong><span>{formatInTimeZone(new Date(session.startAt),sessionTimezone(session),"MMM d, yyyy · HH:mm")} · {session.items.length} targets</span></button>)}{!present.length&&<p className="planner-empty-copy">Your saved nights will appear here.</p>}{archived.length>0&&<details><summary>Archived nights ({archived.length})</summary>{archived.map(session=><div className="planner-archived" key={session.id}><span>{session.name}</span><button className="text-action" onClick={()=>{onUpdate({...session,archived:false});selectNight(session.id);setCalendarOpen(false);}}>Restore</button></div>)}</details>}</section></div></DialogContent></Dialog>
  </div>;
}
