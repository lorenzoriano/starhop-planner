import { ContextDateButton, ContextLocationButton } from "./ObservingContext";
import { resolveLocalMoment } from "@/lib/session";
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { useLocation } from 'wouter';
import { ImagePlus, MapPin, X } from 'lucide-react';
import type { Settings } from '@/lib/session';
import { eqToHorizontal, getConstellationName, type UnifiedTarget } from '@/lib/astronomy';
import { catalogSearchDiagnostics, catalogSearchScore, searchCatalog } from '@/lib/catalog-search';
import { angularSizeLabel, meanSurfaceBrightnessLabel, targetDesignation } from '@/lib/catalog-presentation';
import { catalogMatches } from '@/lib/catalog-filter';
import { visibilityWindow, type VisibilityMode } from '@/lib/target-visibility';
import { createMoonSampler } from '@/lib/observing-profile';
import type { Observer, SkyInputs } from '@/lib/visibility/types';
import { TargetPhoto, TargetPhotoCredit } from './TargetPhoto';
import { BinocularImages } from './BinocularImages';
import { MoonlightCard } from './MoonObservatory';
import { ObjectActionRow } from './ObjectActionRow';
import { ObjectJourneyLinks } from './journeys/lazy-entry';
import { binocularMedia } from '@/lib/binocular-media';
import { catalogPath, navigateHash, parseCatalogLocation } from '@/lib/navigation';
import './CatalogExplorer.css';
import { BinocularAssessment, BinocularProfileSummary, profileFromSettings } from './BinocularAssessment';
import { CatalogCombobox } from './CatalogCombobox';
import './catalog-presentation.css';
import { objectSummaryText } from '@/lib/object-info';
import { illuminationPercent } from '@/lib/moon';
import { displayName, LINK_LABELS, NOOP_ACTIONS, objectName, sameObject, type ObjectActions, type ObjectSkyContext } from "@/lib/object-links";

/** The Catalog's focused object for a location (`#/catalog?object=<any id form>&photos=1`): any id form of a unified target. */
export function catalogFocus(location:string,targets:readonly UnifiedTarget[]):{target?:UnifiedTarget;photos:boolean} {
  const {objectId,photos}=parseCatalogLocation(location);
  const target=objectId?targets.find(t=>t.id===objectId)??targets.find(t=>sameObject(t.id,objectId)):undefined;
  return {...(target?{target}:{}),photos:!!target&&photos};
}

/** "Use your own chart" (LINK_LABELS.ownChart): the image page (#/image) prefilled with this object (it reads the selected target). */
export function openOwnChart(id:string,update:(patch:Partial<Settings>)=>void) {
  update({targetId:id,startStarId:undefined,waypointIds:undefined});
  navigateHash('/image');
}

export function CatalogExplorer({targets,settings,update,date,timezone,locationName,saveDestination,savedIds,onSave,onSky,onMoon,onCompare,onEditSetup,actions,skyAt,observer}:{onEditSetup:()=>void;/** Tonight's conditions at the site (useVisibilityConditions().at); defaults to the sky setting + Moon. */skyAt?:(date:Date)=>SkyInputs;observer?:Observer;targets:UnifiedTarget[];settings:Settings;update:(patch:Partial<Settings>)=>void;date:Date;timezone:string;locationName:string;saveDestination:string;savedIds:Set<string>;onSave:(id:string,at:Date)=>void;onSky:(id:string,at:Date)=>void;onMoon:(id:string,at:Date)=>void;onCompare:(id:string,at:Date)=>void;/** Shared cross-tab object verbs (lib/object-links). */actions?:ObjectActions}) {
  const [showVisibility,setShowVisibility]=useState(()=>globalThis.innerWidth>700);
  useEffect(()=>{const media=globalThis.matchMedia('(min-width:701px)');const resize=()=>setShowVisibility(media.matches);media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[]);
  const [query,setQuery]=useState(''),[type,setType]=useState('all'),[mode,setMode]=useState<VisibilityMode>('time');
  const [chosenDay,setDay]=useState<string|null>(null),[chosenTime,setTime]=useState<string|null>(null),[from,setFrom]=useState('20:00'),[until,setUntil]=useState('22:00');
  const [altitude,setAltitude]=useState('-90'),[separation,setSeparation]=useState('0'),[transit,setTransit]=useState('any'),[fit,setFit]=useState('3'),[sort,setSort]=useState('fit'),[count,setCount]=useState(24),[view,setView]=useState<'cards'|'list'>('cards');
  const day=chosenDay??formatInTimeZone(date,timezone,'yyyy-MM-dd'),time=chosenTime??formatInTimeZone(date,timezone,'HH:mm');
  const profile=useMemo(()=>profileFromSettings(settings),[settings.binocularMagnification,settings.binocularAperture,settings.binocularFov,settings.binocularStabilized,settings.binocularTransmission]);
  const [location]=useLocation();
  const focus=useMemo(()=>catalogFocus(location,targets),[location,targets]);
  const focused=focus.target;
  // Without the planner's shared verbs, fall back to this tab's own callbacks so the row still works.
  const verbs=useMemo<ObjectActions>(()=>actions??{...NOOP_ACTIONS,
    inspect:(id,at)=>onSky(id,at??date),hop:(id,o)=>onSky(id,o?.at??date),moon:(id,at)=>onMoon(id,at??date),clock:(ids,at)=>ids[0]&&onCompare(ids[0],at??date),
    catalog:id=>navigateHash(catalogPath(id)),images:id=>navigateHash(catalogPath(id,{photos:true})),addToNight:(ids,o)=>ids.forEach(id=>{if(!savedIds.has(id))onSave(id,o?.at??date);}),isInNight:id=>savedIds.has(id),
  },[actions,onSky,onMoon,onCompare,onSave,savedIds,date]);
  const sky=useMemo<ObjectSkyContext>(()=>({at:date,lat:settings.lat,lon:settings.lon,timezone,live:settings.timeMode==='live',skyBrightness:settings.skyBrightness,profile}),[date,settings.lat,settings.lon,timezone,settings.timeMode,settings.skyBrightness,profile]);
  const focusObject=(id:string)=>navigateHash(catalogPath(id));
  const window=useMemo(()=>visibilityWindow(day,mode==='range'?from:time,until,mode,timezone,settings.lat,settings.lon),[day,time,from,until,mode,timezone,settings.lat,settings.lon]);
  const types=useMemo(()=>Array.from(new Set(targets.map(t=>t.category))).filter(t=>t!=='Galaxy').sort(),[targets]);
  const valid=altitude!==''&&separation!==''&&Number(altitude)>=-90&&Number(altitude)<=90&&Number(separation)>=0&&Number(separation)<=180;
  const queryIds=useMemo(()=>query.trim()?new Set(searchCatalog(targets,query).map(match=>match.target.id)):null,[targets,query]);
  const rows=useMemo(()=>{
    if(!valid)return [];
    const moonAt=createMoonSampler(settings.lat,settings.lon);
    return targets.filter(t=>(type==='all'||t.category===type||type==='galaxies'&&/galaxy/i.test(t.category)||type==='nebulae'&&/nebula|remnant/i.test(t.category)||type==='clusters'&&/cluster/i.test(t.category))&&(!queryIds||queryIds.has(t.id))).flatMap(target=>{
      const row=catalogMatches(target,settings.lat,settings.lon,window,{minAltitude:Number(altitude),minMoonDistance:Number(separation),transitHours:transit==='any'?null:Number(transit),maxRating:Number(fit)},profile,settings.skyBrightness,moonAt,{skyAt,observer});
      return row?[row]:[];
    }).sort((a,b)=>catalogSearchScore(a.target,query)-catalogSearchScore(b.target,query)||(sort==='name'?a.target.name.localeCompare(b.target.name):sort==='altitude'?b.alt-a.alt:sort==='moon'?a.assessment.rating-b.assessment.rating||b.separation-a.separation:sort==='time'?a.at.getTime()-b.at.getTime():a.assessment.rating-b.assessment.rating||b.score-a.score));
  },[targets,type,query,queryIds,window,altitude,separation,transit,fit,profile,settings.lat,settings.lon,settings.skyBrightness,sort,valid,skyAt,observer]);
  const searchStatus=catalogSearchDiagnostics(query,targets,rows.map(row=>row.target));
  const focusRow=focused?rows.find(row=>row.target.id===focused.id):undefined;
  const chosenMoment=resolveLocalMoment(day,time,timezone)??date;
  const focusAt=focusRow?.at??chosenMoment;
  const focusState=useMemo(()=>{
    if(!focused)return null;
    if(focusRow)return {alt:focusRow.alt,moon:focusRow.moon};
    return {alt:eqToHorizontal(focused.ra,focused.dec,settings.lat,settings.lon,focusAt).alt,moon:createMoonSampler(settings.lat,settings.lon)(focusAt)};
  },[focused,focusRow,+focusAt,settings.lat,settings.lon]);
  const focusPanel=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!focused)return;
    // After the planner's page-change scroll reset (a parent effect, which runs after this one) and first layout.
    const timer=setTimeout(()=>{const el=focus.photos?document.getElementById('catalog-photos'):focusPanel.current;el?.scrollIntoView({behavior:'smooth',block:'start'});},150);
    return ()=>clearTimeout(timer);
  },[focused?.id,focus.photos]);
  const reset=()=>{setQuery('');setType('all');setMode('time');setDay(null);setAltitude('-90');setSeparation('0');setTransit('any');setFit('3');setCount(24);};
  const revealSearchMatch=()=>{setType('all');setAltitude('-90');setSeparation('0');setTransit('any');setFit('3');setCount(24);};
  return <div className="catalog-explorer" data-testid="catalog-explorer">
    <header className="page-heading catalog-heading"><div><p className="eyebrow">THE WHOLE OBSERVING CATALOG</p><h1>Find your kind of sky<span>.</span></h1><p>{targets.length} objects · <ContextLocationButton>{locationName}</ContextLocationButton> · {timezone.replaceAll('_',' ')}</p></div><span>{rows.length} {rows.length===1?'match':'matches'}<br/><ContextDateButton value={resolveLocalMoment(day,time,timezone)??date} timezone={timezone} onChange={at=>{setDay(formatInTimeZone(at,timezone,"yyyy-MM-dd"));setTime(formatInTimeZone(at,timezone,"HH:mm"));}}/></span></header>
    <BinocularProfileSummary settings={settings} onEditSetup={onEditSetup}/>
    <section className="catalog-filters panel" aria-label="Catalog filters">
      <div className="catalog-primary-filters"><CatalogCombobox className="catalog-search" targets={targets} query={query} onQuery={value=>{setQuery(value);setCount(24);}} onSelect={target=>focusObject(target.id)} label="Search the catalog" placeholder="Name, designation, constellation…"/><label>Object type<select aria-label="Catalog object type" value={type} onChange={e=>setType(e.target.value)}><option value="all">All object types</option><option value="galaxies">All galaxies</option><option value="nebulae">All nebulae & remnants</option><option value="clusters">All star clusters</option>{types.map(t=><option key={t}>{t}</option>)}</select></label><label>Binocular suitability<select aria-label="Binocular suitability" value={fit} onChange={e=>setFit(e.target.value)}><option value="3">All targets</option><option value="0">Excellent</option><option value="1">Excellent + worthwhile</option><option value="2">Include challenging</option></select></label></div>
      <details className="catalog-visibility-controls" open={showVisibility} onToggle={e=>setShowVisibility(e.currentTarget.open)}><summary>Visibility & observing window<span>{mode==='time'?`At ${time}`:mode==='night'?'Astronomical darkness':`${from}–${until}`} · {Number(altitude)===-90?'any altitude':`above ${altitude}°`}{Number(separation)>0?` · Moon ≥${separation}°`:''}{transit!=='any'?` · transit ±${transit} h`:''}</span></summary>
      <div className="catalog-window-filters"><label>When<select aria-label="Catalog visibility window" value={mode} onChange={e=>setMode(e.target.value as VisibilityMode)}><option value="time">At observing time</option><option value="night">During astronomical darkness</option><option value="range">Within a time range</option></select></label><label>Observing date<input aria-label="Catalog observing date" type="date" value={day} onChange={e=>setDay(e.target.value)}/></label>{mode==='range'&&<><label>From<input aria-label="Catalog start time" type="time" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Until<input aria-label="Catalog end time" type="time" value={until} onChange={e=>setUntil(e.target.value)}/></label></>}<label>Minimum altitude · °<input aria-label="Catalog minimum altitude" type="number" min="-90" max="90" value={altitude} onChange={e=>setAltitude(e.target.value)}/></label><label>Minimum Moon distance · °<input aria-label="Catalog Moon distance" type="number" min="0" max="180" value={separation} onChange={e=>setSeparation(e.target.value)}/></label><label>Near transit<select aria-label="Catalog transit distance" value={transit} onChange={e=>setTransit(e.target.value)}><option value="any">Any time</option><option value="1">Within ±1 hour</option><option value="2">Within ±2 hours</option><option value="4">Within ±4 hours</option></select></label></div>
      </details>
      <div className="catalog-filter-footer"><span>{mode==='time'?`${time} local · −90° includes objects below the horizon`:'All conditions hold together · 5-minute samples + exact culmination'}</span><button className="text-action" onClick={reset}>Reset filters</button><label>Sort<select aria-label="Catalog sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="fit">Best rating</option><option value="time">Best observing time</option><option value="moon">Moon-friendly</option><option value="altitude">Highest altitude</option><option value="name">Name</option></select></label><div role="group" aria-label="Catalog layout"><button aria-pressed={view==='cards'} onClick={()=>setView('cards')}>Cards</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}>List</button></div></div>
      <details className="catalog-filter-help"><summary>Visibility and Moon filters explained</summary><p>Astronomical darkness means the Sun is below −18°, from evening dusk to morning dawn at this location. A range ending earlier than it starts crosses midnight. Transit distance is hours before or after upper culmination. Moon distance is angular separation, even when the Moon is below the horizon; Moon sky glow is zero while it is down. Suitability is assessed at a matching moment. Weather and the local horizon are not measured.</p></details>
    </section>
    {!window.ok&&<p role="alert">{window.error}</p>}{!valid&&<p role="alert">Choose an altitude from −90° to 90° and Moon distance from 0° to 180°.</p>}{window.ok&&!window.segments.length&&<p>No astronomical darkness on this date at this location.</p>}
    {focused&&focusState&&<section ref={focusPanel} className="catalog-focus panel" aria-labelledby="catalog-focus-title" data-testid="catalog-focus" data-target-id={focused.id}>
      <div className="catalog-focus-photo"><TargetPhoto target={focused}/></div>
      <div className="catalog-focus-body">
        <div className="catalog-focus-heading"><span className="eyebrow">{[targetDesignation(focused),focused.categoryShort].filter(Boolean).join(' · ')}</span><button type="button" className="icon-button catalog-focus-close" aria-label={`Close ${displayName(focused)}`} onClick={()=>navigateHash('/catalog')}><X size={16}/></button></div>
        <h2 id="catalog-focus-title">{displayName(focused)}</h2>
        {objectName(focused).alsoKnownAs.length>0&&<p className="object-location">Also known as {objectName(focused).alsoKnownAs.join(', ')}</p>}
        <p className="object-location">{getConstellationName(focused.con)} · mag {focused.mag.toFixed(1)}{angularSizeLabel(focused.size)?` · ${angularSizeLabel(focused.size)} across`:''}</p>
        <p className="catalog-match-time">{formatInTimeZone(focusAt,timezone,'MMM d, yyyy · HH:mm')} local · {Math.round(focusState.alt)}° high{focusRow?` · ${Math.round(focusRow.separation)}° from Moon`:''}</p>
        {!focusRow&&<p className="catalog-focus-hidden" role="status">Hidden by the current filters. <button type="button" className="text-action" onClick={reset}>Show the whole catalog</button></p>}
        <BinocularAssessment target={focused} profile={profile} alt={focusState.alt} moon={focusState.moon} skyBrightness={settings.skyBrightness} sky={skyAt?.(focusAt)} observer={observer} at={focusAt} lat={settings.lat} lon={settings.lon} timezone={timezone} onEditSetup={onEditSetup} compact/>
        <ObjectActionRow variant="full" objectId={focused.id} name={displayName(focused)} actions={verbs} at={focusAt} omit={["catalog"]} saved={savedIds.has(focused.id)} onToggleSave={()=>onSave(focused.id,focusAt)}>
          {actions&&<Suspense fallback={null}><ObjectJourneyLinks objectId={focused.id} actions={actions} sky={sky}/></Suspense>}
        </ObjectActionRow>
        <p className="catalog-focus-note">Plans save to {saveDestination}. The Planner arranges the viewing order.</p>
        <button type="button" className="text-action catalog-focus-sky" onClick={()=>onSky(focused.id,focusAt)}><MapPin size={14}/> Show on sky</button>
        <MoonlightCard target={focused} lat={settings.lat} lon={settings.lon} date={focusAt} skyBrightness={settings.skyBrightness}/>
      </div>
      {focus.photos&&<div id="catalog-photos" className="catalog-focus-photos">{binocularMedia(focused.id)?<BinocularImages key={focused.id} id={focused.id} name={displayName(focused)}/>:<><TargetPhoto target={focused}/><TargetPhotoCredit target={focused}/></>}
        <p className="catalog-own-chart"><button type="button" className="text-action" onClick={()=>openOwnChart(focused.id,update)}><ImagePlus size={14} aria-hidden="true"/> {LINK_LABELS.ownChart}</button><span>Calibrate a photo or chart of this field and mark {displayName(focused)} on it.</span></p></div>}
    </section>}
    <p className="catalog-result-count" role="status">{rows.length} of {targets.length} catalog {rows.length===1?'object':'objects'}{mode!=='time'?' · each card shows a suggested matching time':''}</p>
    {query&&<div className="catalog-search-status" role="status"><span>{searchStatus.message}</span></div>}
    <div className="catalog-grid" style={view==='list'?{display:'grid',gridTemplateColumns:'1fr'}:undefined}>{rows.slice(0,count).map(row=><article key={row.target.id} className={`catalog-object panel${focused?.id===row.target.id?' focused':''}`} aria-current={focused?.id===row.target.id?'true':undefined} data-target-id={row.target.id} style={view==='list'?{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',alignItems:'center'}:undefined}>
      {view==='cards'&&<button className="catalog-object-photo-open" aria-label={`Open details for ${displayName(row.target)}`} onClick={()=>focusObject(row.target.id)}><TargetPhoto target={row.target} compact/></button>}<div className="catalog-object-body"><span className="eyebrow">{[targetDesignation(row.target),row.target.categoryShort].filter(Boolean).join(' · ')}</span><h2><button className="catalog-object-title-open" aria-label={`Open details for ${displayName(row.target)}`} onClick={()=>focusObject(row.target.id)}>{objectName(row.target).name}</button></h2><p className="object-location">{getConstellationName(row.target.con)} · mag {row.target.mag.toFixed(1)}{angularSizeLabel(row.target.size)?` · ${angularSizeLabel(row.target.size)} across`:''}</p>{meanSurfaceBrightnessLabel(row.target)&&<p className="object-location">{meanSurfaceBrightnessLabel(row.target)}</p>}{view==='cards'&&objectSummaryText(row.target.id,{target:row.target})&&<p className="catalog-object-summary">{objectSummaryText(row.target.id,{target:row.target})}</p>}<div className="catalog-object-metrics"><span>{Math.round(row.alt)}° high</span><span>{Math.round(row.separation)}° from Moon</span><span>{row.transitDistance.toFixed(1)} h from transit</span></div><p className="catalog-match-time">{formatInTimeZone(row.at,timezone,'MMM d, yyyy · HH:mm')} local · Moon {illuminationPercent(row.moon.illumination)}% lit{row.moon.alt<=0?' · Moon down':''}</p><BinocularAssessment target={row.target} profile={profile} alt={row.alt} moon={row.moon} skyBrightness={settings.skyBrightness} compact/></div>
      <div className="catalog-object-links"><ObjectActionRow variant="compact" objectId={row.target.id} name={displayName(row.target)} actions={verbs} at={row.at} omit={["catalog"]} saved={savedIds.has(row.target.id)} onToggleSave={()=>onSave(row.target.id,row.at)}/>{actions&&<Suspense fallback={null}><ObjectJourneyLinks objectId={row.target.id} actions={actions} compact sky={sky}/></Suspense>}</div>
    </article>)}</div>
    {!rows.length&&window.ok&&valid&&window.segments.length>0&&<div className="panel empty-state"><h2>{query?searchStatus.kind==='filtered'?'This object is hidden by the filters':'No search match':'No objects match this view'}</h2><p>{query?searchStatus.message:'Broaden the altitude, Moon or time filters, or choose another night.'}</p>{query&&searchStatus.kind==='filtered'&&<button className="text-action" onClick={revealSearchMatch}>Show {displayName(searchStatus.matches[0].target)}</button>}<button className="text-action" onClick={reset}>Show the whole catalog</button></div>}
    {rows.length>count&&<button className="load-more" onClick={()=>setCount(n=>n+24)}>Show 24 more objects</button>}
  </div>;
}
