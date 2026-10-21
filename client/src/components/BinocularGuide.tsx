import { knownLocationName } from "@/lib/saved-locations";
import { browsingMonthMoment, isPastBrowsingMoment } from "@/lib/binocular-browsing";
import {clockNightDate} from "@/lib/astronomical-clock";
import {TargetNightSuggestions} from "./TargetNightSuggestions";
import { ContextDateButton, ContextLocationButton, ObservingContextScope } from "./ObservingContext";
import { BinocularAssessment } from "./BinocularAssessment";
import { binocularAssessment, type BinocularProfile } from "@/lib/binocular-assessment";
import type { ReactNode } from "react";
import { moonState } from "@/lib/moon";
import { createMoonSampler } from "@/lib/observing-profile";
import { NightAltitudeChart } from "./ObservingVisuals";
import { MoonlightCard } from "./MoonObservatory";
import { catalogDiameter } from "@/lib/finder-detail";
import { catalogSearchDiagnostics, catalogSearchScore, searchCatalog } from "@/lib/catalog-search";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowUpRight, Binoculars, BookOpen, Check, Clock, Eye, MapPin, Navigation, Plus, Star, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { BinocularImages, BinocularPhoto } from "./BinocularImages";
import { CatalogCombobox } from "./CatalogCombobox";
import { binocularDatabaseResources, binocularMedia, opticalPhotoCaption } from "@/lib/binocular-media";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { eqToHorizontal, getConstellationName, type SkyNode, type ConstellationLine, type DenseStar, type MilkyWayFeature, type Star as CatalogStar, type UnifiedTarget } from "@/lib/astronomy";
import { SkyChart } from "./SkyChart";
import { nightAltitudeSamples, targetDayEvents, targetWindow, visibilityWindow, type VisibilityMode } from "@/lib/target-visibility";
import { BinocularObservations } from "./BinocularObservations";
import { compassLabel, skyConditions } from "@/lib/observing";
import { angularSizeLabel, meanSurfaceBrightnessLabel, targetDesignation } from "@/lib/catalog-presentation";
import { resolveLocalMoment } from "@/lib/session";
import * as Astro from "astronomy-engine";
import { BINOCULAR_BOOKS, BINOCULAR_ENTRIES, FAMILY_LABELS, LEVEL_LABELS, MONTH_NAMES, binocularCollection, binocularSample, type BinocularSampleMode, type BinocularFamily, type BinocularPick } from "@/lib/binocular-guide";
import "./catalog-presentation.css";
import "./BinocularGuide.css";

function CompactNightCurve({target,lat,lon,night,range=false}:{target:UnifiedTarget;lat:number;lon:number;night:ReturnType<typeof visibilityWindow>;range?:boolean}) {
  const samples=useMemo(()=>nightAltitudeSamples(target.ra,target.dec,lat,lon,night).flatMap(segment=>segment.samples),[target.ra,target.dec,lat,lon,night]);
  if(samples.length<2)return <p className="binocular-method-note">No dark window for a night curve.</p>;
  const first=+samples[0].date,last=+samples[samples.length-1].date;
  const points=samples.map((sample,index)=>`${index?"L":"M"}${12+(+sample.date-first)/(last-first)*276},${48-Math.max(0,Math.min(90,sample.alt))/90*40}`).join(" ");
  return <svg className="binocular-compact-curve" style={{width:"100%",height:56}} viewBox="0 0 300 56" role="img" aria-label={`Compact altitude curve for ${target.name} during ${range?"the selected time range":"astronomical darkness"}`}><line x1="12" x2="288" y1="48" y2="48" stroke="#38535a"/><path d={points} fill="none" stroke="#a2d5c5" strokeWidth="2"/><text x="12" y="55" fill="#91a9b0" fontSize="8">{range?"Start":"Dusk"}</text><text x="288" y="55" textAnchor="end" fill="#91a9b0" fontSize="8">{range?"End":"Dawn"}</text></svg>;
}

interface Props {
  profile:BinocularProfile; profileControls:ReactNode;
  onInspect?:(id:string)=>void;
  onMoon:(id:string,at:Date)=>void;
  onCompare:(id:string,at:Date)=>void;
  saveDestination:string; locationName?:string;
  isSavedAt?:(id:string,date:Date)=>boolean;
  skyBrightness?: number;
  targets: UnifiedTarget[]; stars: CatalogStar[]; lat: number; lon: number;
  timezone: string; observingDate: Date; savedIds: Set<string>; loading: boolean;
  onSave: (id: string, at?: Date) => void; onPlan: (id: string, at: Date) => void;
  constellations: ConstellationLine[]; denseStars: DenseStar[]; milkyWay: MilkyWayFeature[];
  fovWidth: number; fovHeight: number; fovShape: "circle" | "rectangle"; limitingMag: number;
  onFovChange: (width: number) => void; onLimitingMagChange: (magnitude: number) => void;
  onDate?: (date: Date) => void;
  onEditSetup?: () => void;
  live?: boolean;
}

export function BinocularGuide({ locationName, saveDestination, profile, isSavedAt, onInspect, onMoon, onCompare, skyBrightness = 21.6, targets, stars, lat, lon, timezone, observingDate, savedIds, loading, onSave, onPlan, constellations, denseStars, milkyWay, fovWidth, fovHeight, fovShape, limitingMag, onFovChange, onLimitingMagChange, onDate, onEditSetup, live = false }: Props) {
  const savedAt=(id:string,date:Date)=>isSavedAt?.(id,date)??savedIds.has(id);
  const [finderDepth,setFinderDepth]=useState(10.5);
  const openTarget=(id:string)=>{onInspect?.(id);setOpened(id);};
  const currentYear = Number(formatInTimeZone(observingDate, timezone, "yyyy"));
  const currentDay = formatInTimeZone(observingDate, timezone, "yyyy-MM-dd");
  const currentTime = formatInTimeZone(observingDate, timezone, "HH:mm");
  const observingTimestamp = observingDate.getTime();
  const [year, setYear] = useState(currentYear);
  const [sampleMode,setSampleMode]=useState<BinocularSampleMode>("dark");
  const [month, setMonth] = useState(Number(formatInTimeZone(observingDate, timezone, "M")));
  const [family, setFamily] = useState<BinocularFamily | "all">("all");
  const [level, setLevel] = useState("all");
  const [includeLargeTargets, setIncludeLargeTargets] = useState<boolean | null>(null);
  const showLargeTargets=includeLargeTargets??profile.aperture>=80;
  const [sort,setSort]=useState("altitude");
  const [view,setView]=useState<"cards"|"list">("cards");
  const [query, setQuery] = useState("");
  const [visibilityMode,setVisibilityMode]=useState<VisibilityMode>("time");
  useEffect(()=>{if(visibilityMode==="night")setSort("time");},[visibilityMode]);
  const [chosenDate,setChosenDate]=useState<string>(currentDay),[chosenTime,setChosenTime]=useState<string>(currentTime);
  const [browsingMonthLens,setBrowsingMonthLens]=useState(false);
  const lastGlobalDay=useRef(currentDay);
  useEffect(()=>{
    const day=formatInTimeZone(new Date(observingTimestamp),timezone,"yyyy-MM-dd");
    const time=formatInTimeZone(new Date(observingTimestamp),timezone,"HH:mm");
    const globalDayChanged=day!==lastGlobalDay.current;
    lastGlobalDay.current=day;
    if(live&&browsingMonthLens&&!globalDayChanged)return;
    setChosenDate(day);setChosenTime(time);setYear(Number(day.slice(0,4)));setMonth(Number(day.slice(5,7)));setBrowsingMonthLens(false);
  },[observingTimestamp,timezone,live]);
  const [until,setUntil]=useState("22:00"),[rangeStart,setRangeStart]=useState("20:00");
  const [minAltitude,setMinAltitude]=useState("15"),[throughout,setThroughout]=useState(false);
  const observingDay=chosenDate;
  const observingTime=chosenTime;
  const window=useMemo(()=>visibilityWindow(observingDay,visibilityMode==="range"?rangeStart:observingTime,until,visibilityMode,timezone,lat,lon),[observingDay,observingTime,rangeStart,until,visibilityMode,timezone,lat,lon]);
  const nightWindow=useMemo(()=>visibilityWindow(observingDay,"12:00","12:00","night",timezone,lat,lon),[observingDay,timezone,lat,lon]);
  const nightMoon=useMemo(()=>createMoonSampler(lat,lon),[lat,lon,nightWindow]);
  const altitude=minAltitude.trim()===""?-90:Number(minAltitude),validAltitude=minAltitude.trim()===""||Number.isFinite(altitude)&&altitude>=0&&altitude<=90;
  const [seasonalOnly, setSeasonalOnly] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const monthEveningSamples=useMemo(()=>MONTH_NAMES.map((_,index)=>{
    const monthDate=`${year}-${String(index+1).padStart(2,"0")}-15`;
    const night=visibilityWindow(monthDate,"12:00","12:00","night",timezone,lat,lon);
    const nextDate=new Date(`${monthDate}T12:00:00Z`);nextDate.setUTCDate(nextDate.getUTCDate()+1);
    const midnight=resolveLocalMoment(nextDate.toISOString().slice(0,10),"00:00",timezone);
    const dates:Date[]=[];
    if(night.ok&&night.segments.length&&midnight){
      const start=night.segments[0].start,end=new Date(Math.min(+night.segments[0].end,+midnight));
      if(end>start)for(let time=+start;time<+end;time+=30*60_000)dates.push(new Date(time));
      if(end>start)dates.push(end);
    }
    if(!dates.length){const start=resolveLocalMoment(monthDate,"18:00",timezone);if(start&&midnight)for(let time=+start;time<+midnight;time+=30*60_000)dates.push(new Date(time));}
    return dates;
  }),[year,lat,lon,timezone]);
  const newMoonDates=useMemo(()=>MONTH_NAMES.map((_,index)=>{
    const monthStart=resolveLocalMoment(`${year}-${String(index+1).padStart(2,"0")}-01`,"12:00",timezone);
    const phase=monthStart?Astro.SearchMoonPhase(0,monthStart,40)?.date:null;
    return phase&&Number(formatInTimeZone(phase,timezone,"M"))===index+1?phase:null;
  }),[year,timezone]);
  const collection = useMemo(() => {
    const picks=binocularCollection(targets,lat,lon,year,month,timezone,sampleMode);
    if(sampleMode==="fixed")return picks;
    return picks.map(p=>{
    const monthlyAltitudes=monthEveningSamples.map((samples,index)=>samples.length?Math.max(...samples.map(date=>eqToHorizontal(p.target.ra,p.target.dec,lat,lon,date).alt)):p.monthlyAltitudes[index]);
    const peak=Math.max(...monthlyAltitudes),bestMonths=monthlyAltitudes.flatMap((alt,index)=>alt>=Math.min(40,peak-18)?[index+1]:[]);
    return {...p,monthlyAltitudes,bestMonths};
  });
  }, [targets,lat,lon,year,month,timezone,sampleMode,monthEveningSamples]);
  const at=window.ok?window.start:observingDate;
  const sampleAt=useMemo(()=>binocularSample(year,month,lat,lon,timezone,sampleMode),[year,month,lat,lon,timezone,sampleMode]);
  const windows=useMemo(()=>new Map(collection.map(p=>[p.targetId,window.ok?targetWindow(p.target.ra,p.target.dec,lat,lon,window):null])),[collection,window,lat,lon]);
  const positioned=useMemo(()=>collection.map(p=>({...p,...eqToHorizontal(p.target.ra,p.target.dec,lat,lon,windows.get(p.targetId)?.bestAt??at)})),[collection,windows,lat,lon,at]);
  const timeFor=(p:BinocularPick)=>windows.get(p.targetId)?.bestAt??at;
  const positionTime=(p:BinocularPick)=>`${formatInTimeZone(timeFor(p),timezone,"HH:mm")}${formatInTimeZone(timeFor(p),timezone,"yyyy-MM-dd")!==observingDay?" +1d":""}`;
  const conditions = useMemo(() => skyConditions(lat, lon, at), [lat, lon, at]);
  const sampleConditions=useMemo(()=>skyConditions(lat,lon,sampleAt),[lat,lon,sampleAt]);
  const searchTargets=useMemo(()=>positioned.map(p=>p.target),[positioned]);
  const searchMatchIds=useMemo(()=>new Set(searchCatalog(searchTargets,query).map(match=>match.target.id)),[searchTargets,query]);
  const matches = (pick: BinocularPick) => (family === "all" || pick.family === family)
    && (showLargeTargets || (pick.minAperture ?? 50) <= 50)
    && (level === "all" || pick.level === level)
    && (!query.trim() || searchMatchIds.has(pick.targetId));
  const picks = positioned.filter(p=>matches(p)&&window.ok&&validAltitude&&(throughout&&visibilityMode==="range"?(windows.get(p.targetId)?.min??-Infinity):(windows.get(p.targetId)?.max??-Infinity))>=altitude&&(!seasonalOnly||p.bestMonths.includes(month))).sort((a,b)=>{
    const relevance=catalogSearchScore(a.target,query,getConstellationName(a.target.con))-catalogSearchScore(b.target,query,getConstellationName(b.target.con));
    if(relevance)return relevance;
    if(sort==="time")return timeFor(a).getTime()-timeFor(b).getTime();
    if(sort==="moon"){
      const left=binocularAssessment(a.target,profile,{alt:a.alt,moon:nightMoon(timeFor(a)),skyBrightness}),right=binocularAssessment(b.target,profile,{alt:b.alt,moon:nightMoon(timeFor(b)),skyBrightness});
      return left.rating-right.rating||left.glow-right.glow||(right.contrast??0)-(left.contrast??0);
    }
    if(sort==="rating")return binocularAssessment(a.target,profile,{alt:a.alt,moon:nightMoon(timeFor(a)),skyBrightness}).rating-binocularAssessment(b.target,profile,{alt:b.alt,moon:nightMoon(timeFor(b)),skyBrightness}).rating||b.alt-a.alt;
    return b.alt-a.alt;
  });
  const searchStatus=catalogSearchDiagnostics(query,searchTargets,picks.map(p=>p.target),target=>{
    const pick=positioned.find(p=>p.targetId===target.id);if(!pick)return undefined;
    const reasons:string[]=[];
    if(family!=="all"&&pick.family!==family)reasons.push(`Type: ${FAMILY_LABELS[family]}`);
    if(!showLargeTargets&&(pick.minAperture??50)>50)reasons.push("Small binoculars (up to 50 mm)");
    if(level!=="all"&&pick.level!==level)reasons.push(`Level: ${LEVEL_LABELS[level as keyof typeof LEVEL_LABELS]}`);
    if(seasonalOnly&&!pick.bestMonths.includes(month))reasons.push("Monthly picks");
    if((throughout&&visibilityMode==="range"?(windows.get(pick.targetId)?.min??-Infinity):(windows.get(pick.targetId)?.max??-Infinity))<altitude)reasons.push(`Minimum altitude ${altitude}° (${Math.round(pick.alt)}° at the selected time)`);
    if(!window.ok)reasons.push(`Date/time: ${window.error}`);
    return reasons.length?`Hidden by ${reasons.map(reason=>`“${reason}”`).join(" and ")}.`:undefined;
  });
  const revealSearchMatch=()=>{setFamily("all");setLevel("all");setIncludeLargeTargets(true);setMinAltitude("");setVisibilityMode("time");setSeasonalOnly(false);setVisibleCount(12);};
  const featured = picks.find((p) => p.level === "easy") ?? picks[0];
  const detail = positioned.find((p) => p.targetId === opened);
  const detailAt=detail?timeFor(detail):at;
  const detailGraphWindow=visibilityMode==="range"?window:nightWindow;
  const fieldNodes = useMemo<SkyNode[]>(() => detail ? stars.filter((s) => s.mag <= finderDepth).map((s) => ({ ...s, ...eqToHorizontal(s.ra, s.dec, lat, lon, detailAt), name: s.name || s.bayer || s.id, type: "star" as const })) : [], [stars, finderDepth, detail?.targetId, lat, lon, detailAt]);
  const fieldTarget: SkyNode | null = detail ? { ...detail.target, alt: detail.alt, az: detail.az, type: detail.target.source === "messier" ? "messier" : "binocular", constellation: detail.target.con } : null;
  const place = locationName || knownLocationName([],lat,lon) || `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;
  const nightLabel=(date:Date)=>{const night=clockNightDate(date,timezone);return `${MONTH_NAMES[Number(night.slice(5,7))-1]} ${Number(night.slice(8,10))}, ${night.slice(0,4)}`;};
  const sampleLabel = formatInTimeZone(sampleAt, timezone, "MMM d, yyyy · HH:mm");
  const browsingMoment=resolveLocalMoment(observingDay,observingTime,timezone)??observingDate;
  const browsingLabel=formatInTimeZone(browsingMoment,timezone,"MMM d, yyyy · HH:mm");
  const detailLabel=formatInTimeZone(detailAt,timezone,"MMM d, yyyy · HH:mm");
  const events=useMemo(()=>new Map([...picks.slice(0,visibleCount),...(detail?[detail]:[])].map(p=>[p.targetId,targetDayEvents(p.target.ra,p.target.dec,lat,lon,at,timezone)])),[picks.map(p=>p.targetId).join(","),visibleCount,detail?.targetId,lat,lon,at.getTime(),timezone]);
  const eventTimes=(p:BinocularPick)=>{const day=events.get(p.targetId);return day?<div className="binocular-event-times" aria-label={`Rise transit and set for ${p.name??p.target.name}`}><span>Rise<strong>{day.alwaysUp?"Always up":day.neverUp?"Never rises":day.rise?formatInTimeZone(day.rise,timezone,"HH:mm"):"None today"}</strong></span><span>Transit<strong>{day.transit?formatInTimeZone(day.transit,timezone,"HH:mm"):"None today"}</strong></span><span>Set<strong>{day.alwaysUp?"Always up":day.neverUp?"Never rises":day.set?formatInTimeZone(day.set,timezone,"HH:mm"):"None today"}</strong></span></div>:null;};
  const years = Array.from(new Set([currentYear - 1, currentYear, currentYear + 1, year])).sort();
  const applyMoment=(value:Date,notifyGlobal:boolean)=>{
    const day=formatInTimeZone(value,timezone,"yyyy-MM-dd"),time=formatInTimeZone(value,timezone,"HH:mm");
    setChosenDate(day);setChosenTime(time);setYear(Number(day.slice(0,4)));setMonth(Number(day.slice(5,7)));setVisibleCount(12);
    if(notifyGlobal)setBrowsingMonthLens(false);
    if(notifyGlobal)onDate?.(value);
  };
  const applyBrowsingNight=()=>{const value=resolveLocalMoment(observingDay,observingTime,timezone);if(value){setBrowsingMonthLens(false);onDate?.(value);}};
  const selectMonth = (value:number,nextYear=year,nextSample=sampleMode,target?:UnifiedTarget) => { const candidates=nextSample==="dark"&&target&&nextYear===year?monthEveningSamples[value-1]:[];const sample=browsingMonthMoment(observingDate,value,nextYear,timezone)??(candidates.length?candidates.reduce((best,date)=>eqToHorizontal(target!.ra,target!.dec,lat,lon,date).alt>eqToHorizontal(target!.ra,target!.dec,lat,lon,best).alt?date:best):binocularSample(nextYear,value,lat,lon,timezone,nextSample));setBrowsingMonthLens(!browsingMonthMoment(observingDate,value,nextYear,timezone));applyMoment(sample,false);setSeasonalOnly(true); };
  const changeDay=(value:string)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;
    const moment=resolveLocalMoment(value,observingTime,timezone)??resolveLocalMoment(value,"12:00",timezone);
    if(moment)applyMoment(moment,true);
  };
  const changeTime=(value:string)=>{
    const moment=resolveLocalMoment(observingDay,value,timezone);
    if(moment)applyMoment(moment,true);
  };
  const reset = () => { setFamily("all"); setLevel("all"); setQuery(""); setIncludeLargeTargets(null); setMinAltitude("");setVisibilityMode("time"); setSeasonalOnly(false); setVisibleCount(12); };
  const planNewMoonNight=()=>{
    const phase=newMoonDates[month-1];if(!phase)return;
    const date=formatInTimeZone(phase,timezone,"yyyy-MM-dd");
    const night=visibilityWindow(date,"12:00","12:00","night",timezone,lat,lon);
    const start=night.ok&&night.segments.length?new Date(+night.segments[0].start+15*60_000):resolveLocalMoment(date,"21:00",timezone);
    if(!start)return;
    applyMoment(start,true);setVisibilityMode("time");setSeasonalOnly(false);
  };

  return (
    <ObservingContextScope date={at} timezone={timezone} lat={lat} lon={lon} onTime={value=>applyMoment(value,true)}><div className="binocular-guide" data-testid="binocular-guide">
      <div className="page-heading binocular-heading">
        <div>
          <p className="eyebrow">THE BINOCULAR OBSERVATORY</p>
          <h1>Two eyes. A whole sky<span>.</span></h1>
          <p>A year of small discoveries, from familiar stars to faraway islands of light.</p>
        </div>
        <div className="binocular-heading-mark" aria-hidden="true"><Binoculars strokeWidth={1} /></div>
      </div>

      <div className="saving-context" role="status">Saving to: <strong>{formatInTimeZone(new Date(`${clockNightDate(at,timezone)}T12:00:00Z`),"UTC","MMM d")} observing night</strong> · {place}{browsingMonthLens&&" · monthly preview"}</div>
      <div className="binocular-profile-summary">Binocular setup · {profile.magnification}×{profile.aperture} mm · {profile.fov.toFixed(1)}° true field {onEditSetup&&<button className="text-action" type="button" onClick={onEditSetup}>Edit setup</button>}</div>
      <section className="binocular-calendar" aria-label="Monthly binocular guide">
        <div className="binocular-calendar-heading">
          <div><span className="eyebrow">TWELVE CHAPTERS, ONE SKY</span><h2>Where will {MONTH_NAMES[month - 1]} take you?</h2></div>
          <details className="binocular-month-settings"><summary>Monthly method & year</summary><div className="binocular-sample-settings"><label className="binocular-year"><span>Monthly pick method</span><select aria-label="Binocular sample time" value={sampleMode} onChange={e=>{const value=e.target.value as BinocularSampleMode;setSampleMode(value);selectMonth(month,year,value);}}><option value="dark">Evening peak · dusk to midnight</option><option value="fixed">21:00 reference</option></select></label>
          <label className="binocular-year">Planning year
            <select value={year} onChange={(e) => selectMonth(month,Number(e.target.value))} aria-label="Binocular planning year">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label></div></details>
        </div>
        <div className="binocular-months" role="group" aria-label="Choose a month">
          {MONTH_NAMES.map((name, i) => {
            const count = collection.filter((p) => (showLargeTargets || (p.minAperture ?? 50) <= 50) && p.bestMonths.includes(i + 1) && p.monthlyAltitudes[i] >= 15).length;
            return <button key={name} className={month === i + 1 ? "active" : ""} aria-pressed={month === i + 1} onClick={() => selectMonth(i + 1)} data-testid={`binocular-month-${i + 1}`}>
              <span>{String(i + 1).padStart(2, "0")}</span><strong>{name.slice(0, 3)}</strong><small>{newMoonDates[i]?`New · ${formatInTimeZone(newMoonDates[i]!,timezone,"d")}`:"No new Moon"}</small><small>{loading ? "…" : `${count} picks`}</small>
            </button>;
          })}
        </div>
        <div className="binocular-calendar-context">
          <span><MapPin size={13} /> {place}</span><span><Clock size={13} /> Browse lens · {browsingLabel} local</span><span>Monthly reference · {sampleLabel} · {sampleConditions.darkness}</span><button className="text-action" type="button" disabled={!onDate} onClick={applyBrowsingNight}>Set as observing night</button>
        </div>
        <div className="binocular-new-moon-action">{newMoonDates[month-1]&&<span>New Moon {formatInTimeZone(newMoonDates[month-1]!,timezone,"MMM d")}</span>}<button className="text-action" disabled={!newMoonDates[month-1]} onClick={planNewMoonNight}>Plan new-Moon night</button></div>
        <details className="binocular-method-details"><summary>How monthly picks are calculated</summary><p className="binocular-method-note">Monthly picks in evening-window mode use each target’s highest sampled altitude from astronomical dusk to local midnight, at 30-minute intervals. If astronomical night does not occur, the guide samples 18:00 to midnight local time. The 21:00 option is a single reference time. Check your actual observing time before heading out; weather and local obstructions are not included.</p></details>
      </section>

      {featured && (
        <details className="binocular-feature-preview"><summary>A good place to begin · {featured.name ?? featured.target.name}</summary><section className="binocular-feature panel">
          <div className="binocular-feature-copy">
            <span className="eyebrow">A GOOD PLACE TO BEGIN · {MONTH_NAMES[month - 1].toUpperCase()}</span>
            <h2>{featured.name ?? featured.target.name}</h2>
            <p>{featured.impression}</p>
            <div className="binocular-meta"><span><Binoculars size={14} /> Suggested: {featured.equipment}</span><span>{Math.round(featured.alt)}° {compassLabel(featured.az)} at {formatInTimeZone(timeFor(featured),timezone,"MMM d, yyyy · HH:mm")}</span></div>
            <button className="text-action" onClick={() => openTarget(featured.targetId)}>Explore this field <ArrowUpRight size={15} /></button>
          </div>
          <div className="binocular-feature-field"><BinocularPhoto id={featured.targetId} name={featured.name ?? featured.target.name} /><span className="binocular-field-caption">{opticalPhotoCaption(featured.targetId)}</span></div>
        </section></details>
      )}
      {visibilityMode==="time" && !conditions.isDark && !loading && <p className="twilight-note binocular-twilight">At the chosen time, the Sun is {Math.round(conditions.sunAlt)}° high. Select “During the night” or a later time for a darker sky; an object’s altitude alone does not mean it is observable.</p>}

      <section className="binocular-collection">
        <div className="section-heading"><div><span className="eyebrow">LET THE FIELD SURPRISE YOU</span><h2>{seasonalOnly ? `${MONTH_NAMES[month - 1]}’s collection` : "The binocular collection"}</h2></div><span>{picks.length} of {BINOCULAR_ENTRIES.length} curated {BINOCULAR_ENTRIES.length===1?"target":"targets"}</span></div>
        <details className="binocular-filter-details"><summary>Find & filter targets · date, time, type and altitude</summary>
        <div className="binocular-family-tabs" role="group" aria-label="Binocular target type">
          <button className={family === "all" ? "active" : ""} aria-pressed={family === "all"} onClick={() => { setFamily("all"); setVisibleCount(12); }}>All discoveries</button>
          {(Object.keys(FAMILY_LABELS) as BinocularFamily[]).map((type) => <button key={type} className={family === type ? "active" : ""} aria-pressed={family === type} onClick={() => { setFamily(type); setVisibleCount(12); }}>{FAMILY_LABELS[type]}</button>)}
        </div>
        <div className="binocular-toolbar">
          <CatalogCombobox className="binocular-search" targets={searchTargets} query={query} onQuery={value=>{setQuery(value);setVisibleCount(12);}} onSelect={target=>{setQuery(target.name);setFamily("all");setLevel("all");setIncludeLargeTargets(true);setSeasonalOnly(false);setVisibleCount(12);}} label="Search binocular targets" placeholder="Name, constellation or catalog number…" />
          <select aria-label="Binocular observing difficulty" value={level} onChange={(e) => { setLevel(e.target.value); if (e.target.value === "large") setIncludeLargeTargets(true); setVisibleCount(12); }}><option value="all">All observing levels</option>{Object.entries(LEVEL_LABELS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
          <span className="binocular-profile-summary">Showing targets for your {profile.aperture} mm binoculars</span><button className={`filter-toggle ${showLargeTargets ? "active" : ""}`} aria-pressed={showLargeTargets} onClick={() => { setIncludeLargeTargets(!showLargeTargets); setVisibleCount(12); }}><Binoculars size={14} /> {showLargeTargets?"Hide 80 mm targets":"Include 80 mm targets"}</button>
          <button className={`filter-toggle ${seasonalOnly ? "active" : ""}`} aria-pressed={seasonalOnly} onClick={() => setSeasonalOnly(!seasonalOnly)}><Clock size={14} /> Monthly picks</button>
          <label>Sort<select aria-label="Sort binocular targets" value={sort} onChange={event=>setSort(event.target.value)}><option value="time">Best time</option><option value="moon">Moon-friendly</option><option value="rating">Best rating</option><option value="altitude">Highest altitude</option></select></label>
          <div role="group" aria-label="Binocular target layout"><button aria-pressed={view==="cards"} onClick={()=>setView("cards")}>Cards</button><button aria-pressed={view==="list"} onClick={()=>setView("list")}>List</button></div>
        </div>

        <div className="binocular-visibility" aria-label="Binocular visibility filters">
          <div className="binocular-visibility-fields">
            <label>When<select aria-label="Binocular visibility mode" value={visibilityMode} onChange={e=>{setVisibilityMode(e.target.value as VisibilityMode);setSeasonalOnly(false);setVisibleCount(12);}}><option value="time">At a chosen time</option><option value="night">During the night</option><option value="range">Custom time range</option></select></label>
            <label>Observing date<input aria-label="Binocular observing date" type="date" value={observingDay} onChange={e=>changeDay(e.target.value)}/></label>
            {visibilityMode==="time"&&<label>Local time<input aria-label="Binocular observing time" type="time" value={observingTime} onChange={e=>changeTime(e.target.value)}/></label>}
            {visibilityMode==="range"&&<><label>From<input aria-label="Visibility start time" type="time" value={rangeStart} onChange={e=>setRangeStart(e.target.value)}/></label><label>Until<input aria-label="Visibility end time" type="time" value={until} onChange={e=>setUntil(e.target.value)}/></label></>}
            <label>Minimum altitude · °<input aria-label="Minimum target altitude" placeholder="Any" type="number" min="0" max="90" step="1" value={minAltitude} onChange={e=>{setMinAltitude(e.target.value);setVisibleCount(12);}}/></label>
            {visibilityMode==="range"&&<label>Above the limit<select aria-label="Altitude window rule" value={throughout?"all":"any"} onChange={e=>setThroughout(e.target.value==="all")}><option value="any">At any point</option><option value="all">Whole range</option></select></label>}
          </div>
          <div className="binocular-visibility-context"><div className="context-actions"><ContextDateButton value={at} timezone={timezone} onChange={value=>applyMoment(value,true)}/><ContextLocationButton/></div><p>{window.ok?visibilityMode==="time"?`${formatInTimeZone(at,timezone,"MMM d, yyyy · HH:mm")} · ${timezone.replaceAll("_"," ")}`:visibilityMode==="night"?`Astronomical night of ${formatInTimeZone(at,timezone,"MMM d, yyyy")} · Sun below −18° · ${window.segments.length?window.segments.map(s=>`${formatInTimeZone(s.start,timezone,"MMM d, yyyy HH:mm")}–${formatInTimeZone(s.end,timezone,"MMM d, yyyy HH:mm")}`).join("; "):"No astronomical darkness at this site"}`:`${formatInTimeZone(at,timezone,"MMM d, yyyy")} · ${rangeStart}–${until}${until<=rangeStart?" (+1 day)":""} · ${timezone.replaceAll("_"," ")}`:window.error}</p><button className="text-action" onClick={()=>{setBrowsingMonthLens(false);setChosenDate(currentDay);setChosenTime(currentTime);setYear(currentYear);setMonth(Number(currentDay.slice(5,7)));setVisibilityMode("time");setSeasonalOnly(false);}}>Use observing time</button></div>
          {!validAltitude&&<p role="alert">Choose an altitude from 0° to 90°.</p>}
          <details className="binocular-timing-notes"><summary>Times & visibility explained</summary><p className="binocular-method-note">Rise, upper transit and set are for {formatInTimeZone(browsingMoment,timezone,"MMM d, yyyy")}, local time at {place}. Transit is the highest crossing. Flat horizon, no refraction or terrain; clear the altitude limit to browse all fields. Night graphs overlay altitude (solid mint, left axis) and Moon separation (dashed silver, right axis; 180° is opposite the Moon). Gray shading estimates extra sky glow using lunar phase, height and distance from the target; it disappears when the Moon is down. Suggested times balance altitude against modeled moonlight, with stronger penalties for diffuse objects. They are guidance, not visibility guarantees; haze, local lighting and low altitudes affect the estimate. {visibilityMode==="time"?"Altitude alone does not guarantee a dark sky.":visibilityMode==="range"?"Cards show each target’s highest altitude in the range; a range ending before it starts continues into the next day. Altitude alone does not guarantee darkness.":"Cards show the highest altitude between astronomical dusk and dawn; moonlight, clouds and obstructions can still affect visibility."}</p></details>
        </div>

        </details>
        {loading ? <div className="panel empty-state"><Binoculars size={28} /><p>Opening the binocular field guide…</p></div> : !picks.length ? (
          <div className="panel empty-state"><Star size={28} /><h3>A different window may open the sky.</h3><p>{query?searchStatus.message:"No targets match these filters at this site. Try a lower altitude, another time window or a different date. Monthly picks can also narrow the results."}</p>{query&&searchStatus.kind==="filtered"&&<Button variant="outline" onClick={revealSearchMatch}>Show {searchStatus.matches[0].target.name}</Button>}<Button variant="outline" onClick={reset}>Browse all binocular targets</Button></div>
        ) : (
          <div className="binocular-target-grid" style={view==="list"?{display:"grid",gridTemplateColumns:"1fr"}:undefined}>
            {picks.slice(0, visibleCount).map((p) => <article className={`binocular-target-card level-${p.level}`} key={p.targetId} style={view==="list"?{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"center"}:undefined}>
              <button className="binocular-target-main" onClick={() => openTarget(p.targetId)} aria-label={`Explore binocular target ${p.name ?? p.target.name}`} data-testid={`binocular-target-${p.targetId}`}>
                {view==="cards"&&<div className="binocular-target-field"><BinocularPhoto id={p.targetId} name={p.name ?? p.target.name} /><span className="binocular-family-label">{FAMILY_LABELS[p.family]}</span><span className="binocular-photo-label">{opticalPhotoCaption(p.targetId)}</span></div>}
                <div className="binocular-target-body"><span className="eyebrow">{[targetDesignation(p.target).replace(/^(NGC|IC|Mel|Cr|Tr|Stock)(?=\d)/,"$1 "),getConstellationName(p.target.con)].filter(Boolean).join(" · ")}</span><h3>{p.name ?? p.target.name}</h3>{view==="cards"&&<p>{p.impression}</p>}<div className="binocular-card-position"><span className={p.alt < 15 ? "low" : ""}>{p.neverRises ? "Never rises here" : p.alt < 0 ? `Below horizon at ${positionTime(p)}` : `${Math.round(p.alt)}° ${compassLabel(p.az)} at ${positionTime(p)}`}</span><span>{p.variable ? "Variable star" : `mag ${p.target.mag.toFixed(1)}`}{angularSizeLabel(p.target.size)?` · ${angularSizeLabel(p.target.size)} across`:""}</span></div>{view==="cards"&&eventTimes(p)}{meanSurfaceBrightnessLabel(p.target)&&<small>{meanSurfaceBrightnessLabel(p.target)}</small>}</div>
              </button>
              {view==="cards"&&<div className="binocular-card-chart"><CompactNightCurve target={p.target} lat={lat} lon={lon} night={visibilityMode==="range"?window:nightWindow} range={visibilityMode==="range"}/><details><summary>Expand altitude & Moon graph</summary><NightAltitudeChart target={p.target} lat={lat} lon={lon} night={visibilityMode==="range"?window:nightWindow} timezone={timezone} selectedAt={visibilityMode==="range"?timeFor(p):undefined} skyBrightness={skyBrightness} moonAt={nightMoon}/></details></div>}
              <div className="binocular-target-bottom"><button className="binocular-clock-action" title="Compare at this target’s suggested time" aria-label={`Compare ${p.name??p.target.name} in astronomical clock`} onClick={()=>onCompare(p.targetId,timeFor(p))}><Clock size={15}/></button><span>{binocularAssessment(p.target,profile,{alt:p.alt,moon:nightMoon(timeFor(p)),skyBrightness}).label}</span><button className={savedAt(p.targetId,timeFor(p)) ? "saved" : ""} title={`${savedAt(p.targetId,timeFor(p))?"Remove from":"Add to"} night of ${nightLabel(timeFor(p))}`} onClick={() => onSave(p.targetId,timeFor(p))} aria-label={`${savedAt(p.targetId,timeFor(p)) ? "Remove" : "Add"} ${p.name ?? p.target.name} ${savedAt(p.targetId,timeFor(p)) ? "from" : "to"} night of ${nightLabel(timeFor(p))}`} aria-pressed={savedAt(p.targetId,timeFor(p))}>{savedAt(p.targetId,timeFor(p)) ? <Check size={17} /> : <Plus size={17} />}</button></div>
            </article>)}
          </div>
        )}
        {picks.length > visibleCount && <button className="load-more" onClick={() => setVisibleCount(visibleCount + 12)}>More fields to discover</button>}
        <p className="binocular-collection-note"><WifiOff size={14} /> Targets have audited optical images, finder charts and sources. Infrared views are included where useful; damaged scan frames are omitted. Images travel offline once “Offline ready” appears; external databases need a connection.</p>
        <p className="binocular-method-note">Small binoculars shows targets selected for instruments up to 50 mm. Turn it off to include the mounted 80 mm collection. Targets can be useful in several months; monthly counts reflect your location and filters.</p>
      </section>

      <section className="binocular-books binocular-references" aria-label="Binocular observing references">
        <details><summary><BookOpen size={14}/> Books & sources <span>{BINOCULAR_BOOKS.length} references</span></summary>
          <p className="binocular-books-intro">An original selection informed by published guides and public author notes. Each target links to its evidence.</p>
          <ul>{BINOCULAR_BOOKS.map(book=><li key={book.author}><a href={book.url} target="_blank" rel="noreferrer">{book.title} <ArrowUpRight size={12}/></a><span>{book.author}</span></li>)}</ul>
        <details className="binocular-provenance"><summary>About the selection and the month-by-month calendar</summary><p>We checked target names against O’Meara’s publisher index and supplemented them with Harrington’s binocular tours, Tonkin’s BinocularSky notes, and the Astronomical League’s small-binocular, 80 mm, deep-sky and southern-sky programs. The collection is not a reproduction of a book’s complete observing list. StarHop’s short notes and finder maps are original.</p><p>In evening-window mode, StarHop samples each target’s altitude every 30 minutes from astronomical dusk to local midnight, then includes months above 40° or within 18° of that target’s sampled peak. If astronomical darkness does not occur, it samples 18:00 to midnight. The 21:00 mode uses one reference time. The adjustable altitude filter checks your selected date or time window. Month labels stay in calendar order in both hemispheres: latitude changes altitude and horizon access, rather than reversing the sky’s calendar. This is a planning guide, not a visibility or weather guarantee. Variable-star brightness and eclipse times are not forecast.</p><p>Images are archived optical DSS2 and near-infrared 2MASS mosaics, served by <a href="https://alasky.cds.unistra.fr/hips-image-services/hips2fits" target="_blank" rel="noreferrer">CDS HiPS2FITS</a>. Each target provides credits, source cutouts, and use policies. They show telescope survey data, not a binocular view.</p><p>Inspired by the <a href="https://www.cloudynights.com/forums/topic/858306-best-binocular-targets-book/" target="_blank" rel="noreferrer">Cloudy Nights discussion of binocular observing books</a>.</p></details>
        </details>
      </section>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setOpened(null); }}>
        <DialogContent className="binocular-detail">
          {detail && <>
            <DialogHeader><span className="eyebrow">{[FAMILY_LABELS[detail.family],targetDesignation(detail.target).replace(/^(NGC|IC|Mel|Cr|Tr|Stock)(?=\d)/,"$1 ")].filter(Boolean).join(" · ")}</span><DialogTitle>{detail.name ?? detail.target.name}</DialogTitle><DialogDescription>{getConstellationName(detail.target.con)} · {LEVEL_LABELS[detail.level]} · Suggested equipment: {detail.equipment}</DialogDescription></DialogHeader>
            <div className="binocular-detail-sticky-actions"><div className="binocular-quick-actions"><Button variant="outline" aria-label={`Compare ${detail.name??detail.target.name} at ${formatInTimeZone(detailAt,timezone,"HH:mm")} in the astronomical clock`} onClick={()=>{setOpened(null);onCompare(detail.targetId,detailAt);}}>Compare in clock ↗</Button><Button variant="outline" aria-label={`Check ${detail.name??detail.target.name} against the Moon`} onClick={()=>{setOpened(null);onMoon(detail.targetId,detailAt);}}>Check Moon ↗</Button><button className="save-button" aria-label={savedAt(detail.targetId,detailAt)?`Remove ${detail.name??detail.target.name} from night of ${nightLabel(detailAt)}`:`Add ${detail.name??detail.target.name} to night of ${nightLabel(detailAt)}`} title={`${savedAt(detail.targetId,detailAt)?"Remove from":"Add to"} night of ${nightLabel(detailAt)}`} onClick={()=>onSave(detail.targetId,detailAt)}>{savedAt(detail.targetId,detailAt)?<Check size={15}/>:<Plus size={15}/>} {savedAt(detail.targetId,detailAt)?"Remove from night":"Add to night"}</button><Button disabled={detail.alt < 5} aria-label={`Hop to ${detail.name??detail.target.name}${detail.alt<5?", target is below the 5 degree altitude limit":""}`} onClick={() => { setOpened(null); onPlan(detail.targetId, detailAt); }}><Navigation size={15} /> Hop to it</Button></div></div>
            <p className="binocular-detail-impression">{detail.impression}</p>
            <details className="binocular-detail-more"><summary>Finder, observing notes & sources</summary>
            <div className="binocular-finder-heading"><span className="eyebrow">YOUR FINDER FIELD</span><span>{angularSizeLabel(detail.target.size)?`${angularSizeLabel(detail.target.size)} across · `:""}mag {detail.target.mag.toFixed(1)} · north up before rotation</span></div><div className="binocular-detail-chart"><SkyChart onSelect={onInspect} key={detail.targetId} nodes={fieldTarget ? [...fieldNodes, fieldTarget] : fieldNodes} constellations={constellations} denseStars={denseStars} milkyWay={milkyWay} route={null} targetNode={fieldTarget} animStep={0} fovWidth={fovWidth} fovHeight={fovHeight} fovShape={fovShape} limitingMag={finderDepth} maxCatalogMagnitude={10.5} targetDiameter={catalogDiameter(detail.target.size)} lat={lat} lon={lon} date={detailAt} onFovChange={onFovChange} onLimitingMagChange={setFinderDepth} setupSummary={`${profile.magnification}×${profile.aperture} mm · ${fovWidth.toFixed(1)}° field · stars to mag ${finderDepth.toFixed(1)}`} onEditSetup={onEditSetup} isBinocular /></div>
            <details className="binocular-detail-conditions"><summary>Altitude, Moon & observing conditions</summary><ObservingContextScope date={detailAt} timezone={timezone} lat={lat} lon={lon} onTime={value=>applyMoment(value,true)}><NightAltitudeChart target={detail.target} lat={lat} lon={lon} night={detailGraphWindow} timezone={timezone} selectedAt={detailAt} skyBrightness={skyBrightness} moonAt={nightMoon}/></ObservingContextScope>
            {eventTimes(detail)}
            <p className="binocular-method-note">Rise, transit and set on <ContextDateButton value={detailAt} timezone={timezone} onChange={value=>applyMoment(value,true)}>{formatInTimeZone(detailAt,timezone,"MMM d, yyyy")}</ContextDateButton> · {timezone.replaceAll("_"," ")} · geometric horizon.</p>
            <BinocularAssessment target={detail.target} profile={profile} alt={detail.alt} moon={moonState(lat,lon,detailAt)} skyBrightness={skyBrightness}/>
            {onDate&&<TargetNightSuggestions target={detail.target} lat={lat} lon={lon} timezone={timezone} date={detailAt} onDate={onDate}/>}
            <MoonlightCard target={detail.target} lat={lat} lon={lon} date={detailAt} skyBrightness={skyBrightness} />
            </details>
            <div className="binocular-detail-notes"><div><h3>Start here</h3><p>{detail.finding}</p></div></div>
            <BinocularObservations id={detail.targetId} />
            {isPastBrowsingMoment(detailAt,observingDate)&&<p className="binocular-method-note">This is a past observing time. Choose a future date to plan a new visit.</p>}
            <details className="binocular-reference-photos"><summary>Reference photographs & source images</summary><BinocularImages key={detail.targetId} id={detail.targetId} name={detail.name ?? detail.target.name} /></details>
            <details className="binocular-year-details"><summary>Altitude through the year</summary><div className="binocular-year-path"><span className="eyebrow">A YEAR IN YOUR SKY · {sampleMode==="dark"?"EVENING WINDOW PEAK":"21:00"} ON THE 15TH</span><div className="binocular-altitude-months">{detail.monthlyAltitudes.map((alt, i) => <button key={i} className={month === i + 1 ? "active" : ""} onClick={() => selectMonth(i + 1,year,sampleMode,detail.target)} aria-label={`${MONTH_NAMES[i]}, peak evening altitude ${Math.round(alt)} degrees`} aria-pressed={month === i + 1}><span className="binocular-altitude-bar"><i style={{ height: `${Math.max(3, Math.max(0, alt) / 90 * 100)}%` }} className={alt < 15 ? "low" : ""} /></span><small>{MONTH_NAMES[i].slice(0, 3)}</small></button>)}</div><p>{detail.neverRises ? "This target never rises at your latitude. Change your observing location to explore its southern sky." : `${detailLabel}: ${Math.round(detail.alt)}° ${compassLabel(detail.az)}. ${detail.alt < 15 ? "This is low or below the horizon; try another month or time." : "Aim for higher altitude and an unobstructed view."}`}</p></div>
            </details>
            <p className="binocular-method-note">Targets save to “{browsingMonthLens ? `${nightLabel(detailAt)} observing night` : saveDestination || `${nightLabel(detailAt)} observing night`}” at {place}. Hop preview: {detailLabel}.</p>
            {eqToHorizontal(detail.target.ra, detail.target.dec, lat, lon, observingDate).alt >= 5 && <button className="text-action" onClick={() => { setOpened(null); onPlan(detail.targetId, observingDate); }}>Use my current observing time instead <ArrowUpRight size={13} /></button>}
            <details className="binocular-sources-details"><summary>References & public databases</summary><div className="binocular-detail-sources"><h3><BookOpen size={14} /> Follow the observer’s trail</h3>{detail.references.map((ref) => <a key={ref.url + ref.title} href={ref.url} target="_blank" rel="noreferrer">{ref.title}<ArrowUpRight size={12} /></a>)}<h3>Explore the public databases</h3>{binocularDatabaseResources(detail.target, binocularMedia(detail.targetId)?.fov ?? 2).map((ref) => <a key={ref.url} href={ref.url} target="_blank" rel="noreferrer">{ref.title}<ArrowUpRight size={12} /></a>)}<small>The finder chart uses your configured field of view. The fine gold outline marks the catalog diameter when available; it is a locating guide, not a simulated glow. Stars are real catalog positions, not a photographic background. {detail.variable ? "Brightness varies; no current magnitude is predicted." : "Magnitudes are catalog values; sky brightness and steadiness affect the view."}</small></div>
            </details></details>
          </>}
        </DialogContent>
      </Dialog>
    </div></ObservingContextScope>
  );
}
