import { ContextDateButton, ContextLocationButton } from "./ObservingContext";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Astro from "astronomy-engine";
import { formatInTimeZone } from "date-fns-tz";
import { Moon, ArrowUpRight, Binoculars, Check, Plus, Search, ChevronRight, Compass, X, Circle, CheckCircle2 } from "lucide-react";
import { useChartPreferences } from "./ChartPreferences";
import { compassLabel } from "@/lib/observing";
import { eqToHorizontal, angularDistance, type UnifiedTarget } from "@/lib/astronomy";
import { moonState, moonDay, lunarFeatures, lunarFrame, projectLunarFeature, featureAngularSize, binocularResolution, scatteredMoonlight, targetMoonlight, MOONLIGHT_SOURCE, type LunarFeature } from "@/lib/moon";
import { moonFreeTargetWindows, remainingMoonFreeWindows, upcomingNights } from "@/lib/upcoming-nights";
import { UpcomingNights } from "./UpcomingNights";
import "./ObservingCalendar.css";
import { renderLunarViewport, separationScale } from "@/lib/lunar-renderer";
import { MoonTargetPicker } from "./MoonTargetPicker";
import { TargetPhoto, TargetPhotoCredit } from "./TargetPhoto";
import type { Settings, NightItem } from "@/lib/session";
import { AltitudeStatus, ExplainedStatus } from "./ExplainedStatus";

export function formatWindowDuration(milliseconds:number) {
  const minutes=Math.round(milliseconds/60000),hours=Math.floor(minutes/60),remainder=minutes%60;
  return hours?`${hours} h${remainder?` ${remainder} min`:""}`:`${minutes} min`;
}

export function MoonlightCard({ target, lat, lon, date, skyBrightness = 21.6, onMoon }: { target: UnifiedTarget; lat: number; lon: number; date: Date; skyBrightness?: number; onMoon?: () => void }) {
  const impact = useMemo(() => targetMoonlight(target, lat, lon, date, skyBrightness), [target, lat, lon, date, skyBrightness]);
  const moonlightLabel=impact.targetAlt<=0?"Target below horizon":impact.level;
  return <section className="moonlight-card" aria-label={`Moonlight for ${target.name}`} data-testid="moonlight-card">
    <p className="moonlight-at-time">At chosen time · <ContextDateButton value={date}/></p><div className="moonlight-heading"><Moon size={14} /><ExplainedStatus label={moonlightLabel} explanation={<>
      <p>{impact.advice}</p>
      <p>The Moon is {(impact.moon.illumination*100).toFixed(0)}% illuminated, {Math.abs(impact.moon.alt).toFixed(1)}° {impact.moon.alt<0?"below horizon":"high"} and {impact.separation.toFixed(1)}° from this object. {impact.targetAlt<=0?'The object is below the horizon, so a sky-glow estimate cannot describe an observable view.':impact.moon.alt<=-impact.moon.diameter/2?'The entire lunar disk is below the flat horizon; the model adds no lunar sky glow.':`The model estimates ${impact.brightening.toFixed(1)} magnitudes of added sky brightness here.`}</p>
      <p>With the Moon up, the labels use added sky brightness: below 0.3 mag is little moonlight; 0.3–1 is some moonlight; 1–2 is brightened sky; 2 or more is strong moonlight. Higher values reduce the contrast of faint detail.</p>
      <p>{impact.reliable?'This assumes clear air and your selected moonless sky brightness; clouds and local lighting are not measured.':'The estimate is less dependable in twilight, near the horizon or at extreme angular separations.'}</p>
    </>}><strong>{moonlightLabel}</strong></ExplainedStatus><span>{Math.round(impact.separation)}° from Moon</span></div>
    <p className={`moonlight-target-position ${impact.targetAlt < 15 ? "low" : ""}`}>Target {Math.round(impact.targetAlt)}° {compassLabel(impact.targetAz)} · <AltitudeStatus alt={impact.targetAlt} sunAlt={impact.moon.sunAlt}/></p><p>{impact.advice}</p><p className="moonlight-target-brightness">Catalog magnitude {target.mag.toFixed(1)}{/double/i.test(target.category) ? " · component brightness can differ" : target.category==="Star" ? " · stellar brightness can vary" : " · integrated light; faint detail can be much harder"}.</p>
    <div className="moonlight-numbers"><span>{Math.round(impact.moon.illumination*100)}% lit · Moon {Math.abs(Math.round(impact.moon.alt))}° {impact.moon.alt<0?"below horizon":`high · ${compassLabel(impact.moon.az)}`}</span>
      {impact.targetAlt > 0 && impact.moon.alt > -impact.moon.diameter/2 && impact.moon.sunAlt <= -18 && <span>≈ {impact.brightening.toFixed(1)} mag brighter sky</span>}</div>
    <details><summary>How this estimate works</summary><p>Angular separation is measured on the sky: 180° puts the Moon opposite the target. The <a href={MOONLIGHT_SOURCE} target="_blank" rel="noreferrer">Krisciunas–Schaefer model</a> estimates extra sky glow from lunar phase, height and separation. Assumes a {skyBrightness.toFixed(1)} mag/arcsec² moonless zenith sky and clear-air extinction of 0.172 mag/airmass. It does not predict a percentage chance of seeing this object.</p><p>{impact.reliable ? "Even under clear skies this is an estimate; haze, local lighting and the object's surface brightness affect visibility." : "Outside the model's usual observing range: low altitude, twilight or extreme separation makes the estimate less dependable."} Lunar eclipses and local obstructions are not included.</p></details>
    {onMoon && <button className="text-action" onClick={onMoon}>Plan around the Moon <ArrowUpRight size={12} /></button>}
  </section>;
}

function LunarFeaturePhoto({feature}:{feature:LunarFeature}) {
  return <figure className="lunar-feature-photo"><img src={`./data/moon/features/${feature.id}.jpg`} width={640} height={400} alt={`NASA LROC photographic reference mosaic centered on ${feature.name}; north up, fixed lighting`} loading="lazy"/><figcaption><span>NASA / LROC reference mosaic · fixed lighting</span><a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">Source ↗</a></figcaption></figure>;
}

function lunarFeatureTip(feature: LunarFeature) {
  return feature.tip;
}

function OpticsInput({ value, min, max, step = 1, label, onValue }: { value:number; min:number; max:number; step?:number; label:string; onValue:(n:number)=>void }) {
  const [draft,setDraft] = useState(String(value));
  const [error,setError] = useState("");
  useEffect(() => { setDraft(String(value)); setError(""); }, [value]);
  return <span className="lunar-optics-input"><input aria-label={label} aria-invalid={!!error} type="number" min={min} max={max} step={step} value={draft} onChange={e => {
    const raw = e.target.value; setDraft(raw); const n=Number(raw);
    if(raw !== "" && Number.isFinite(n) && n>=min && n<=max) { setError(""); onValue(n); }
    else setError(`Use ${min}–${max}`);
  }} onBlur={() => { const n=Number(draft); if(draft === "" || !Number.isFinite(n) || n<min || n>max) { setDraft(String(value)); setError(`Use ${min}–${max}`); } }} />{error && <small role="alert">{error}</small>}</span>;
}

function MoonAtlas({ lat, lon, date, settings, update, selectedId, onSelect }: { lat: number; lon: number; date: Date; settings: Settings; update: (patch: Partial<Settings>) => void; selectedId: string; onSelect: (id: string) => void }) {
  const state = useMemo(() => moonState(lat, lon, date), [lat, lon, date]);
  const frame = useMemo(() => lunarFrame(lat, lon, date), [lat, lon, date]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [texture, setTexture] = useState<ImageData | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"atlas" | "binocular">("atlas");
  const [reference, setReference] = useState(false);
  const [labels, setLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan,setPan] = useState({x:0,y:0});
  const [stageWidth,setStageWidth] = useState(512);
  const [interacting,setInteracting]=useState(false);
  const stageRef=useRef<HTMLDivElement>(null);
  const drag=useRef<{x:number;y:number;panX:number;panY:number}|null>(null);
  const pointers=useRef(new Map<number,{x:number;y:number}>());
  const pinch=useRef<number|null>(null);
  const moved=useRef(false);
  const tappedFeature=useRef<string|null>(null);
  useLayoutEffect(()=>{const el=stageRef.current;if(!el)return;const measure=()=>setStageWidth(el.getBoundingClientRect().width);measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[]);
  const stageScale=Math.min(1,stageWidth/512)*.88;
  const { preferences, update: updateDisplay } = useChartPreferences();
  const [previewOptics,setPreviewOptics]=useState({mag:settings.binocularMagnification,aperture:settings.binocularAperture,fov:settings.fov});
  const {mag,aperture}=previewOptics;
  const apparentSpan = Math.max(60, previewOptics.fov * mag);
  const radius = (view === "atlas" ? 202 : 240 * state.diameter * mag / apparentSpan) * zoom;
  const panLimit=Math.max(128,radius-128);
  const clamp=(n:number)=>Math.max(-panLimit,Math.min(panLimit,n));
  useEffect(()=>setPan(p=>({x:Math.max(-panLimit,Math.min(panLimit,p.x)),y:Math.max(-panLimit,Math.min(panLimit,p.y))})),[panLimit]);
  const reset=()=>{setZoom(1);setPan({x:0,y:0});};
  useEffect(()=>{const el=stageRef.current;if(!el)return;const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();setZoom(z=>Math.max(.5,Math.min(8,z*(event.deltaY<0?1.2:1/1.2))));};el.addEventListener("wheel",wheel,{passive:false});return()=>el.removeEventListener("wheel",wheel);},[]);
  const resolution = binocularResolution(mag, aperture);
  const blur = view === "atlas" ? 0 : radius * 2 * resolution / (state.diameter * 3600) / 2.355;
  useEffect(() => {
    const image = new Image(); let cancelled = false;
    image.onload = () => {
      if (cancelled) return;
      const surface = document.createElement("canvas"); surface.width = image.width; surface.height = image.height;
      const context = surface.getContext("2d"); if (!context) return;
      context.drawImage(image, 0, 0); setTexture(context.getImageData(0, 0, image.width, image.height));
    };
    image.onerror = () => { if (!cancelled) setFailed(true); };
    image.src = "./data/moon/lroc-gray-4k.jpg";
    return () => { cancelled = true; };
  }, []);
  const renderSize=interacting?Math.min(384,Math.ceil(stageWidth)):Math.min(1024,Math.ceil(stageWidth*Math.min(window.devicePixelRatio||1,2)));
  useEffect(() => {
    const context=canvas.current?.getContext("2d");if(!context||!texture)return;
    const pixels=renderLunarViewport(texture,frame,renderSize,stageWidth,stageScale,radius,pan,preferences.rotation,preferences.mirrored,reference);
    context.putImageData(new ImageData(pixels,renderSize,renderSize),0,0);
  },[texture,frame,reference,renderSize,stageWidth,stageScale,radius,pan,preferences.rotation,preferences.mirrored]);
  const selected = lunarFeatures.find(f => f.id === selectedId);
  const transform = `translate(${pan.x}px,${pan.y}px) rotate(${preferences.rotation}deg) scaleX(${preferences.mirrored ? -1 : 1})`;
  const shown = lunarFeatures.filter(f => { const p = projectLunarFeature(f, frame); return p.visible && (reference || p.lit) && (f.kind !== "crater" || f.id === selectedId || zoom>=4 || zoom>=2&&f.diameterKm>=70); });
  const labelBoxes:{left:number;top:number;width:number;height:number}[]=[];
  const positionedFeatures=shown.slice().sort((a,b)=>Number(b.id===selectedId)-Number(a.id===selectedId)).map(feature=>{
    const p=projectLunarFeature(feature,frame),angle=preferences.rotation*Math.PI/180;
    const mx=p.x*radius*(preferences.mirrored?-1:1),my=p.y*radius;
    const x=stageWidth/2+(pan.x+mx*Math.cos(angle)-my*Math.sin(angle))*stageScale;
    const y=stageWidth/2+(pan.y+mx*Math.sin(angle)+my*Math.cos(angle))*stageScale;
    return {feature,x,y};
  });
  const mapFeatures=positionedFeatures.map(({feature,x,y})=>{
    const text=feature.name.replace("Mare ","");
    const width=Math.ceil(text.length*preferences.labelSize*.6)+8,height=Math.ceil(preferences.labelSize*1.25)+4;
    let label:{dx:number;dy:number}|null=null;
    if(preferences.labelSize>0)for(const [dx,dy] of [[9,-height+4],[9,4],[-width-9,-height+4],[-width-9,4]]){
      // The visible label starts 8px inside the map button. Use its painted
      // bounds, then keep that box clear of every other feature's hit target.
      const box={left:x+dx+8,top:y+dy+8,width,height};
      if(box.left<5||box.top<34||box.left+width>stageWidth-5||box.top+height>stageWidth-30)continue;
      if(labelBoxes.some(b=>!(box.left+width<b.left||box.left>b.left+b.width||box.top+height<b.top||box.top>b.top+b.height)))continue;
      // Marker buttons inherit the 44px touch-target minimum, even though
      // their inline visual marker is only 16px across.
      const targetRadius=22;
      const coversAnotherTarget=positionedFeatures.some(other=>other.feature.id!==feature.id&&!(box.left+width<other.x-targetRadius||box.left>other.x+targetRadius||box.top+height<other.y-targetRadius||box.top>other.y+targetRadius));
      if(coversAnotherTarget)continue;
      labelBoxes.push(box);label={dx,dy};break;
    }
    return {feature,x,y,text,label};
  });
  return <section className="panel lunar-atlas" id="lunar-atlas" data-testid="moon-atlas">
    <div className="panel-heading"><div><span className="eyebrow">A FAMILIAR WORLD, UP CLOSE</span><h2>{view === "atlas" ? "Explore the lunar atlas" : "Through your binoculars"}</h2></div><span className="live-label">{state.diameter.toFixed(2)}° disk</span></div>
    <div className="moon-view-tabs" role="group" aria-label="Moon view"><button className={view === "atlas" ? "active" : ""} aria-pressed={view === "atlas"} onClick={() => { setView("atlas"); reset(); }}>Inspect atlas</button><button className={view === "binocular" ? "active" : ""} aria-pressed={view === "binocular"} onClick={() => { setView("binocular"); reset(); }}><Binoculars size={14} /> Binocular field</button></div>
    <div ref={stageRef} className="lunar-stage interactive" style={{touchAction:"none",userSelect:"none"}} onPointerDown={event=>{
      if(event.button!==0)return;
      setInteracting(true);
      event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.current.size===1){moved.current=false;tappedFeature.current=(event.target as HTMLElement).closest<HTMLElement>("[data-lunar-feature]")?.dataset.lunarFeature??null;drag.current={x:event.clientX,y:event.clientY,panX:pan.x,panY:pan.y};}
      else {moved.current=true;tappedFeature.current=null;drag.current=null;const [a,b]=Array.from(pointers.current.values());pinch.current=Math.hypot(a.x-b.x,a.y-b.y);}
    }} onPointerMove={event=>{
      if(!pointers.current.has(event.pointerId))return;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.current.size>=2){const [a,b]=Array.from(pointers.current.values()),distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinch.current&&distance>0){const ratio=distance/pinch.current;setZoom(z=>Math.max(.5,Math.min(8,z*ratio)));}pinch.current=distance;moved.current=true;}
      else if(drag.current){const dx=(event.clientX-drag.current.x)/stageScale,dy=(event.clientY-drag.current.y)/stageScale;if(Math.hypot(dx,dy)>3)moved.current=true;setPan({x:clamp(drag.current.panX+dx),y:clamp(drag.current.panY+dy)});}
    }} onPointerUp={event=>{
      if(!pointers.current.has(event.pointerId))return;
      pointers.current.delete(event.pointerId);pinch.current=null;
      if(pointers.current.size===0){setInteracting(false);if(!moved.current&&tappedFeature.current)onSelect(tappedFeature.current);tappedFeature.current=null;drag.current=null;}
      else {const point=Array.from(pointers.current.values())[0];drag.current={x:point.x,y:point.y,panX:pan.x,panY:pan.y};}
    }} onPointerCancel={()=>{setInteracting(false);pointers.current.clear();drag.current=null;pinch.current=null;tappedFeature.current=null;moved.current=true;}} data-pan-x={pan.x} data-pan-y={pan.y} data-zoom={zoom} data-testid="lunar-stage" data-view={view} data-radius={radius} data-rotation={preferences.rotation} data-mirrored={preferences.mirrored}>
          <canvas ref={canvas} width={renderSize} height={renderSize} className="lunar-viewport-canvas" style={{filter:`blur(${blur*stageScale}px)`}} role="img" aria-label={`Calculated ${state.phaseName}, ${Math.round(state.illumination*100)}% illuminated. Lunar north up before manual orientation; NASA LROC surface map. ${view === "binocular" ? `${mag} by ${aperture} binocular preview, ${previewOptics.fov} degree field.` : "Magnified reference atlas."}`} />
      <div className="lunar-stage-inner" style={{transform:`translate(-50%,-50%) scale(${stageScale})`}}>
        {view === "binocular" && <div className="lunar-field-ring" style={{ width: 480*previewOptics.fov*mag/apparentSpan*zoom, height: 480*previewOptics.fov*mag/apparentSpan*zoom }} />}
        <div className="lunar-disk-layer" style={{ transform }}>

          {selected && view === "binocular" && labels && (() => { const p = projectLunarFeature(selected, frame); return p.visible && (reference || p.lit) ? <span className="lunar-selection-dot" style={{ left: 256+p.x*radius, top: 256+p.y*radius }} /> : null; })()}
        </div>
      </div>
      {labels&&view==="atlas"&&mapFeatures.map(({feature,x,y,text,label})=><Fragment key={feature.id}><button data-lunar-feature={feature.id} className={`lunar-map-feature ${selectedId===feature.id?"selected":""}`} style={{left:x,top:y,width:16,height:16,padding:0,zIndex:selectedId===feature.id?8:5}} onClick={event=>{if(event.detail===0)onSelect(feature.id);}} aria-label={label?undefined:`Identify ${feature.name}`} aria-hidden={label?true:undefined} tabIndex={label?-1:0}><i/></button>{label&&<button data-lunar-feature={feature.id} className="lunar-map-feature-label" style={{position:"absolute",left:x+label.dx+8,top:y+label.dy+8,width:Math.ceil(text.length*preferences.labelSize*.6)+8,height:Math.ceil(preferences.labelSize*1.25)+4,fontSize:preferences.labelSize,lineHeight:1.25,padding:"2px 4px",border:0,borderRadius:3,background:"#060f18b0",color:selectedId===feature.id?"#ffe3a7":"#d6e4dc",whiteSpace:"nowrap",minWidth:0,minHeight:0,zIndex:selectedId===feature.id?9:7}} onClick={event=>{if(event.detail===0)onSelect(feature.id);}} aria-label={`Identify ${feature.name}`}><span style={{fontSize:preferences.labelSize,lineHeight:1.25}}>{text}</span></button>}</Fragment>)}
      <span className="lunar-orientation">Lunar N ↑ · E → before rotation</span><span className="lunar-view-caption">{reference ? "REFERENCE ATLAS · LIGHTING DISABLED" : view === "atlas" ? "MAGNIFIED ATLAS · CALCULATED LIGHTING" : `${mag}×${aperture} · ${previewOptics.fov.toFixed(1)}° FIELD${zoom !== 1 ? " · DISPLAY ZOOM" : ""}`}</span>
      {!texture && <p className="lunar-loading">{failed ? "Surface map unavailable. Reconnect to prepare the offline atlas." : "Opening the lunar map…"}</p>}
    </div>
    <div className="chart-toolbar"><div className="chart-toolbar-group"><button aria-label="Zoom lunar view in" onClick={() => setZoom(z => Math.min(8,z*1.2))}>+</button><button aria-label="Zoom lunar view out" onClick={() => setZoom(z => Math.max(.5,z/1.2))}>−</button><button onClick={reset}>Reset {zoom.toFixed(1)}×</button></div><div className="chart-toolbar-group"><button className={preferences.mirrored ? "active" : ""} aria-pressed={preferences.mirrored} onClick={() => updateDisplay({ mirrored: !preferences.mirrored })}>Mirror</button><button onClick={() => updateDisplay({ rotation: ((preferences.rotation+90)%360) as 0|90|180|270 })}>Rotate · {preferences.rotation}°</button></div></div>
    <div className="lunar-label-controls"><label>Label size <input aria-label="Lunar label size" type="range" min={0} max={30} value={preferences.labelSize} onChange={e=>updateDisplay({labelSize:Number(e.target.value)})}/><output>{preferences.labelSize===0?"Off":`${preferences.labelSize}px`}</output></label><span><span className="chart-pointer-instructions">Drag to pan · Ctrl / ⌘ + scroll to zoom · </span><span className="chart-touch-instructions">Drag to pan · pinch to zoom · </span>orientation changes only with Rotate</span></div>
    <div className="lunar-optics"><label>Magnification <OpticsInput label="Moon preview magnification" min={5} max={40} value={mag} onValue={n => setPreviewOptics(value=>({...value,mag:n}))} />×</label><label>Aperture <OpticsInput label="Moon preview aperture" min={20} max={150} value={aperture} onValue={n => setPreviewOptics(value=>({...value,aperture:n}))} />mm</label><label>True field <OpticsInput label="Moon preview field of view" min={.2} max={15} step={.1} value={previewOptics.fov} onValue={n => setPreviewOptics(value=>({...value,fov:n}))} />°</label><span>Local preview only · 5–40×, 20–150 mm · exit pupil {(aperture/mag).toFixed(1)} mm · nominal resolution {resolution.toFixed(1)}″</span></div>
    <div className="lunar-display-options"><label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} /> Feature markers</label><label><input type="checkbox" checked={reference} onChange={e => setReference(e.target.checked)} /> Full reference lighting</label></div>
    <p className="lunar-preview-note">{view === "atlas" ? "The atlas is enlarged for identification. Switch to Binocular field for the Moon’s size relative to your optics." : `The Moon spans about ${(state.diameter*mag).toFixed(1)}° to your eye at ${mag}×. Field circle and disk use angular scale; screen size is illustrative.`} The preview limits detail by aperture and nominal eye resolution. Steadiness, focus and eyesight can reduce detail further. Smooth-sphere lighting does not reproduce crater shadows, earthshine or eclipses.</p>
    <a className="lunar-credit" href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">Surface map: NASA SVS / LROC / Arizona State University <ArrowUpRight size={11} /></a>
  </section>;
}

export function MoonObservatory({ lat, lon, date, timezone, settings, update, target, targets, onTarget, locationName, onDate, savedIds, onSave, initialFeatureId }: { lat: number; lon: number; date: Date; timezone: string; settings: Settings; update: (patch: Partial<Settings>) => void; target?: UnifiedTarget; targets:UnifiedTarget[]; onTarget:(id:string)=>void; locationName?:string; initialFeatureId?: string; onDate: (date: Date) => void; savedIds: Set<string>; onSave: (id: string) => void }) {
  const state = useMemo(() => moonState(lat,lon,date), [lat,lon,date]);
  const day = useMemo(() => moonDay(lat,lon,date,timezone), [lat,lon,date,timezone]);
  const frame = useMemo(() => lunarFrame(lat,lon,date), [lat,lon,date]);
  const [selectedId, setSelectedId] = useState(initialFeatureId ?? lunarFeatures[0].id);
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [featureLimit,setFeatureLimit]=useState(6);
  const [fullSeparation,setFullSeparation]=useState(true);
  const [query, setQuery] = useState(""); const [litOnly, setLitOnly] = useState(true); const [kind, setKind] = useState("all");
  useEffect(()=>setFeatureLimit(6),[query,kind,showAllFeatures]);
  const [chartWidth, setChartWidth] = useState(710);
  const chartRef = useRef<SVGSVGElement>(null);
  const selected = lunarFeatures.find(f => f.id === selectedId)!;
  const featurePosition = projectLunarFeature(selected, frame);
  const picks = lunarFeatures.filter(f => f.name.toLowerCase().includes(query.toLowerCase()) && (kind === "all" || f.kind === kind) && (showAllFeatures || !litOnly || (projectLunarFeature(f,frame).lit && projectLunarFeature(f,frame).visible))).sort((a,b) => Number(projectLunarFeature(b,frame).favored)-Number(projectLunarFeature(a,frame).favored));
  const nextTargetWindows = useMemo(() => target ? remainingMoonFreeWindows(moonFreeTargetWindows({ lat, lon, timezone, date, target, days: 30, minAltitude: 30 }),date) : [], [lat, lon, timezone, +date, target]);
  const thisNightTargetWindows = useMemo(() => target ? moonFreeTargetWindows({ lat, lon, timezone, date, target, days: 1, minAltitude: 30 }) : [], [lat, lon, timezone, +date, target]);
  const nextNewMoon = useMemo(() => Astro.SearchMoonPhase(0, date, 40)?.date ?? null, [+date]);
  const newMoonNight = useMemo(() => nextNewMoon ? upcomingNights({ lat, lon, timezone, date: nextNewMoon, days: 3 }).sort((a,b) => a.moonIllumination-b.moonIllumination)[0] : null, [lat, lon, timezone, nextNewMoon?.getTime()]);
  const time = (at: Date) => formatInTimeZone(at,timezone,"HH:mm");
  const afterSet = day.nextSet ? new Date(day.nextSet.getTime()+15*60_000) : null;
  const afterSetSun = afterSet ? moonState(lat,lon,afterSet).sunAlt : -90;
  const afterSetSky = afterSetSun >= 0 ? "daylight" : afterSetSun > -18 ? "twilight" : "astronomical night";
  const windowDate = (at: Date) => formatInTimeZone(at,timezone,"MMM d, HH:mm");
  const windowEndLabel = (start: Date, end: Date) => formatInTimeZone(start,timezone,"yyyy-MM-dd") === formatInTimeZone(end,timezone,"yyyy-MM-dd") ? time(end) : windowDate(end);
  const eventLabel = (at: Date | null) => at ? time(at) : "No event today";
  const pointX = (at: Date) => 38+(at.getTime()-day.start.getTime())/(day.end.getTime()-day.start.getTime())*(chartWidth-70);
  const pointY = (alt: number) => 180-(Math.max(-20,Math.min(90,alt))+20)/110*156;
  const path = day.samples.map((p,i) => `${i ? "L" : "M"}${pointX(p.date).toFixed(1)},${pointY(p.alt).toFixed(1)}`).join(" ");
  const separation = target ? angularDistance(target.ra,target.dec,state.ra,state.dec) : null;
  const comparison = target ? day.samples.map(p => {
    const targetAlt = eqToHorizontal(target.ra,target.dec,lat,lon,p.date).alt;
    const distance = angularDistance(target.ra,target.dec,p.ra,p.dec);
    return { ...p, targetAlt, separation:distance, ...scatteredMoonlight(p,targetAlt,distance,settings.skyBrightness) };
  }) : [];
  const distances=comparison.map(p=>p.separation),scale=separationScale(distances,fullSeparation);
  const separationTicks=fullSeparation?[0,60,120,180]:Array.from({length:(scale.max-scale.min)/5+1},(_,i)=>scale.min+i*5);
  const separationY = (angle:number) => 120-(angle-scale.min)/(scale.max-scale.min)*100;
  const separationPath = comparison.map((p,i) => `${i ? "L" : "M"}${pointX(p.date).toFixed(1)},${separationY(p.separation).toFixed(1)}`).join(" ");
  const targetPath = target ? day.samples.map((p,i) => `${i ? "L" : "M"}${pointX(p.date).toFixed(1)},${pointY(eqToHorizontal(target.ra,target.dec,lat,lon,p.date).alt).toFixed(1)}`).join(" ") : "";
  const moment = Math.max(0, Math.min(96, Math.round((date.getTime()-day.start.getTime())/(day.end.getTime()-day.start.getTime())*96)));
  const nominalSize = featureAngularSize(selected,state,frame);
  const resolution = binocularResolution(settings.binocularMagnification,settings.binocularAperture);
  const featureSaveId = `moon:${selected.id}`;
  const coordinates = `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}`;
  useLayoutEffect(() => {
    const container = chartRef.current?.parentElement;
    if (!container) return;
    const measure = () => setChartWidth(Math.max(320, Math.round(container.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const prioritizeDark=state.illumination<.08||state.alt<0;
  const lunarWorkspace=(<div className="lunar-workspace"><MoonAtlas lat={lat} lon={lon} date={date} settings={settings} update={update} selectedId={selectedId} onSelect={setSelectedId} /><aside className="lunar-guide-column">
      <section className="panel lunar-feature-detail"><span className="eyebrow">YOUR LUNAR LANDMARK</span><h2>{selected.name}</h2><LunarFeaturePhoto feature={selected}/><div className="lunar-feature-tags"><span>{selected.kind === "sea" ? "Lava sea" : selected.kind === "region" ? "Bay or plain" : selected.rays ? "Crater & rays" : "Crater"}</span><span>{selected.minMagnification}× or more · steady view</span></div><p>{lunarFeatureTip(selected)}</p>
        <div className="lunar-feature-light"><strong>{!featurePosition.visible ? "Beyond the visible limb" : !featurePosition.lit ? "On the night side" : featurePosition.favored ? "Lighting favors this feature" : "Sunlit; compare on another phase"}</strong><span>Sun {Math.abs(featurePosition.sunAltitude)<=0.5?"on":`${Math.abs(Math.round(featurePosition.sunAltitude))}° ${featurePosition.sunAltitude<0?"below":"above"}`} this feature’s horizon</span></div>
        <p className="lunar-feature-scale">{selected.diameterKm.toFixed(0)} km across · projected size ≈ {nominalSize.toFixed(0)}″. {selected.rays ? "The ray system extends well beyond the crater." : nominalSize < 2*resolution || settings.binocularMagnification < selected.minMagnification ? "A challenging outline at your settings; more magnification and steady support may help." : "The broad outline is a reasonable goal at your settings; fine detail is not guaranteed."}</p>
        <div className="lunar-feature-links"><button className="text-action" onClick={() => onSave(featureSaveId)}>{savedIds.has(featureSaveId) ? <Check size={14} /> : <Plus size={14} />}{savedIds.has(featureSaveId) ? "Added to night · remove" : "Add to night"}</button><a href={selected.source} target="_blank" rel="noreferrer">IAU feature record <ArrowUpRight size={12} /></a></div>
      </section>
      {target && <section className="panel lunar-target-panel"><div className="lunar-target-heading"><span className="eyebrow">SELECTED COMPARISON OBJECT</span><button className="text-action" onClick={()=>{document.getElementById("moon-comparison-target")?.scrollIntoView({behavior:"smooth",block:"center"});document.querySelector<HTMLInputElement>('#moon-comparison-target input[role="combobox"]')?.focus({preventScroll:true});}}>Change object ↑</button></div><h2>{target.name}</h2><div className="lunar-target-photo"><TargetPhoto target={target} compact opticalField={{width:settings.fov,height:settings.shape==='circle'?settings.fov:settings.fovHeight,shape:settings.shape,label:settings.mode==='binocular'?`${settings.binocularMagnification}×${settings.binocularAperture} binoculars`:'Telescope',onChange:width=>update({fov:width,...(settings.shape==='circle'?{fovHeight:width}:{})})}}/></div><TargetPhotoCredit target={target}/><MoonlightCard target={target} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} /><label className="lunar-sky-input">Moonless zenith sky <select aria-label="Moonless sky brightness" value={settings.skyBrightness} onChange={e => update({ skyBrightness:Number(e.target.value) })}>{Array.from(new Set([21.6,20.5,19,18,settings.skyBrightness])).map(n => <option key={n} value={n}>{n.toFixed(1)} mag/arcsec²{n===21.6 ? " · dark site" : n===20.5 ? " · rural" : n===19 ? " · suburban" : n===18 ? " · urban" : ""}</option>)}</select></label><small>Reference assumptions; local sky brightness is not measured.</small></section>}
    </aside></div>);
  return <div className="moon-observatory" data-testid="moon-observatory">
    <div className="page-heading"><div><p className="eyebrow">{state.illumination<.08?"MAKE THE MOST OF A DARK MOON":state.alt<0?"PLAN WHEN THE MOON RETURNS":"WHEN THE MOON STEALS THE SHOW"}</p><h1>{state.illumination<.08?"A window for the deep sky":state.alt<0?"The Moon, later tonight":"A world next door"}<span>.</span></h1><p>{state.illumination<.08?"Little lunar light tonight. Compare dark windows for your deep-sky targets below.":state.alt<0?"The Moon is below the horizon. Check its next rise or explore the reference atlas.":"Follow the light. Trace a sea. Make a bright night your own."}</p></div><Moon className="moon-heading-mark" strokeWidth={1} /></div>
    <nav className="lunar-section-links" aria-label="Jump to Moon section"><button className="text-action" onClick={() => document.getElementById("lunar-planning")?.scrollIntoView({behavior:"smooth",block:"start"})}><Compass size={13} /> Today’s chart</button><button className="text-action" onClick={() => document.getElementById("lunar-atlas")?.scrollIntoView({behavior:"smooth",block:"start"})}><Moon size={13} /> Moon atlas</button><button className="text-action" onClick={() => document.getElementById("lunar-landmarks")?.scrollIntoView({behavior:"smooth",block:"start"})}>Landmark list <ChevronRight size={13} /></button></nav>
    <MoonTargetPicker targets={targets} target={target} onSelect={onTarget}/>
    <section className="lunar-next-nights panel" aria-label="Plan upcoming Moon-free nights"><div className="lunar-next-heading"><div><span className="eyebrow">PLAN A DARK WINDOW</span><h2>Upcoming nights for the Moon and your target</h2></div><div className="lunar-new-moon-action"><span>{target ? `Target: ${target.name}` : "Moon phase & darkness"}</span>{nextNewMoon&&newMoonNight&&<button type="button" onClick={()=>onDate(newMoonNight.chooseAt)}>Plan next New Moon · {formatInTimeZone(nextNewMoon,timezone,"MMM d")} <ArrowUpRight size={12}/></button>}</div></div><UpcomingNights lat={lat} lon={lon} timezone={timezone} date={date} selected={target} onDate={onDate}/></section>
    {!prioritizeDark&&lunarWorkspace}

    <div className="lunar-status-strip"><div><span>At your observing time</span><strong>{state.phaseName}</strong><small>{Math.round(state.illumination*100)}% illuminated</small></div><div><span>Find it in your sky</span><strong>{state.alt < 0 ? "Below horizon" : `${Math.round(state.alt)}° ${compassLabel(state.az)}`}</strong><small>{state.alt < 0 ? `Azimuth ${Math.round(state.az)}° · below horizon` : `Azimuth ${Math.round(state.az)}° · above horizon`}</small></div><div><span>Next moonrise</span><strong>{eventLabel(day.nextRise)}</strong><small>{day.nextRise ? `${formatInTimeZone(day.nextRise,timezone,"MMM d")} · ${Math.round(moonState(lat,lon,day.nextRise).az)}° ${compassLabel(moonState(lat,lon,day.nextRise).az)}` : "A rise need not occur each civil day"}</small></div><div><span>Next moonset</span><strong>{eventLabel(day.nextSet)}</strong><small>{day.nextSet ? `${formatInTimeZone(day.nextSet,timezone,"MMM d")} · ${Math.round(moonState(lat,lon,day.nextSet).az)}° ${compassLabel(moonState(lat,lon,day.nextSet).az)}` : "Check the next event below"}</small></div></div>
    <div className={`lunar-invitation ${state.alt < 0 ? "low" : ""}`}><Compass size={18} /><p>{state.sunSeparation < 20 ? `The Moon is only ${Math.round(state.sunSeparation)}° from the Sun. Explore the reference atlas; do not search near the Sun with binoculars.` : state.alt < -state.diameter/2 ? "The Moon is below the horizon. Explore the atlas now, then choose a time when it is up." : state.alt < 15 ? "The Moon is low. A higher view usually gives a steadier image; find a clear horizon or wait for it to climb." : state.illumination > .7 ? "A bright Moon is a good reason to explore its seas and ray systems. For faint deep-sky targets, use the moonless windows below." : "Look along the terminator—the boundary between lunar day and night. Low sunlight brings crater rims into relief."}</p></div>
    <section className="panel lunar-planning" id="lunar-planning"><div className="panel-heading"><div><span className="eyebrow">MAKE ROOM FOR DARKNESS</span><h2>The Moon through your night</h2></div><ContextDateButton value={date} timezone={timezone} onChange={onDate}>{formatInTimeZone(date,timezone,"MMM d, yyyy")}</ContextDateButton></div>
      <p className="lunar-chart-context" title={coordinates}><ContextLocationButton>{locationName??coordinates}</ContextLocationButton> · {timezone.replaceAll("_"," ")} · times local</p>
      <div className="lunar-chart-legend" aria-label="Moon chart legend"><span><i className="legend-line moon-line" /> Moon height</span>{target && <span><i className="legend-line target-line dashed" /> {target.name} height</span>}<span><i className="legend-shading" /> Astronomical darkness</span><span><i className="legend-cursor" /> Chosen time</span></div>
      <p className="lunar-chart-axis-title">Height above the horizon · degrees</p>
      <svg ref={chartRef} className="lunar-altitude-chart" viewBox={`0 0 ${chartWidth} 232`} role="img" aria-label={`Moon altitude on ${formatInTimeZone(date,timezone,"MMMM d, yyyy")}; shaded bands are astronomical darkness, gray line is the Moon${target ? `, mint line is ${target.name}` : ""}.`}>
        {day.samples.slice(0,-1).map((p,i) => p.sunAlt <= -18 ? <rect key={i} x={pointX(p.date)} y={20} width={(chartWidth-70)/96+.2} height={160} fill="#a3c6b1" opacity={.09} /> : null)}
        {[-20,0,30,60,90].map(alt => <g key={alt}><line x1={38} x2={chartWidth-32} y1={pointY(alt)} y2={pointY(alt)} stroke={alt === 0 ? "#6f858c" : "#28404b"} strokeDasharray={alt === 0 ? undefined : "3 4"} /><text x={30} y={pointY(alt)+3} textAnchor="end" fill="#9ab0b9" fontSize={chartWidth<400?12:10}>{alt}°</text></g>)}
        {target && <path d={targetPath} fill="none" stroke="#a4c7bb" strokeWidth={1.5} strokeDasharray="5 3" />}
        <path d={path} fill="none" stroke="var(--chart-silver, #aeb4be)" strokeWidth={2.5} />
        <line x1={pointX(date)} x2={pointX(date)} y1={20} y2={180} stroke="#dbe4df" strokeDasharray="2 3" /><circle cx={pointX(date)} cy={pointY(state.alt)} r={4} fill="var(--chart-silver, #aeb4be)" />
        {[0,24,48,72,96].map(i => <text key={i} x={pointX(day.samples[i].date)} y={203} textAnchor="middle" fill="#9ab0b9" fontSize={chartWidth<400?12:10}><tspan x={pointX(day.samples[i].date)}>{time(day.samples[i].date)}</tspan>{(i===0||i===96)&&<tspan x={pointX(day.samples[i].date)} dy={13}>{formatInTimeZone(day.samples[i].date,timezone,"MMM d")}</tspan>}</text>)}
      </svg>
      {target && <div className="lunar-separation-panel" data-testid="moon-separation-chart"><div className="lunar-separation-heading"><strong>Moon → {target.name}</strong><span>{Math.round(separation!)}° apart at {time(date)}</span></div><p>Angular distance across the sky · 0° = together, 180° = opposite</p>
        <div className="lunar-separation-scale"><span>Today: {Math.min(...distances).toFixed(1)}°–{Math.max(...distances).toFixed(1)}° apart</span><button type="button" aria-pressed={fullSeparation} onClick={()=>setFullSeparation(!fullSeparation)}>{fullSeparation?"Show detail scale":"Show full 0–180° scale"}</button></div>
        <p className="lunar-separation-note">Earth’s rotation carries both across the sky together. Their separation changes more slowly as the Moon orbits Earth. {fullSeparation?"Full angular scale.":`Detail scale: ${scale.min}°–${scale.max}°.`}</p><svg className="lunar-separation-chart" viewBox={`0 0 ${chartWidth} 150`} role="img" aria-label={`Angular separation between the Moon and ${target.name} through the day, axis ${scale.min} to ${scale.max} degrees; currently ${Math.round(separation!)} degrees apart.`}>
        {comparison.slice(0,-1).map((p,i) => p.sunAlt <= -18 && p.alt > -p.diameter/2 && p.targetAlt > 0 ? <rect key={i} x={pointX(p.date)} y={20} width={(chartWidth-70)/96+.2} height={100} fill="#aaaaaa" opacity={Math.min(.35,p.brightening/10)} /> : null)}
        {separationTicks.map(angle => <g key={angle}><line x1={38} x2={chartWidth-32} y1={separationY(angle)} y2={separationY(angle)} stroke="#28404b" strokeDasharray="3 4" /><text x={30} y={separationY(angle)+3} textAnchor="end" fill="#9ab0b9" fontSize={chartWidth<400?12:10}>{Number(angle.toFixed(1))}°</text></g>)}<path d={separationPath} fill="none" stroke="#a4c7bb" strokeWidth={2.5} /><line x1={pointX(date)} x2={pointX(date)} y1={20} y2={120} stroke="#dbe4df" strokeDasharray="2 3" /><circle cx={pointX(date)} cy={separationY(separation!)} r={4} fill="#b8dbcf" />{[0,24,48,72,96].map(i => <text key={i} x={pointX(day.samples[i].date)} y={143} textAnchor="middle" fill="#9ab0b9" fontSize={chartWidth<400?12:10}>{time(day.samples[i].date)}{i===96 ? "+1d" : ""}</text>)}
        </svg><div className="lunar-chart-legend"><span><i className="legend-line target-line" /> Angular separation</span><span><i className="legend-shading moon-glare" /> Gray shading = extra moonlight in darkness</span></div><div className="lunar-comparison-now"><span>Moon {Math.round(state.illumination*100)}% illuminated · {Math.abs(Math.round(state.alt))}° {state.alt<0?"below horizon":"high"}</span><MoonlightCard target={target} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} /></div></div>}
      <div className="lunar-timeline"><label htmlFor="lunar-time">Choose time · {time(date)}</label><input id="lunar-time" aria-label="Moon planning time" type="range" min={0} max={96} value={Math.min(moment,96)} onChange={e => onDate(day.samples[Number(e.target.value)].date)} /><span>Gray = Moon · mint = {target?.name ?? "no target selected"} · shaded = Sun below −18°</span></div>
      <div className="lunar-event-actions">{day.nextRise && <button className="text-action" onClick={() => onDate(day.nextRise!)}><ChevronRight size={12} /> Next rise · {formatInTimeZone(day.nextRise,timezone,"MMM d, HH:mm")}</button>}{day.nextSet && <button className="text-action" onClick={() => onDate(afterSet!)}><ChevronRight size={12} /> Moonset + 15 min · {formatInTimeZone(afterSet!,timezone,"MMM d, HH:mm")} · {afterSetSky}</button>}{day.transit && <button className="text-action" onClick={() => onDate(day.transit!)}>Highest today · {time(day.transit)}</button>}</div>
      <div className="lunar-dark-windows"><strong>{target ? `Moon-free darkness · ${target.name} above 30°` : "Moonless darkness · observing night"}</strong>{(target ? thisNightTargetWindows : day.windows).length ? (target ? thisNightTargetWindows : day.windows).map((w,i) => <button key={`${w.start.toISOString()}-${i}`} onClick={() => onDate(new Date((w.start.getTime()+w.end.getTime())/2))}>{windowDate(w.start)}–{formatInTimeZone(w.start,timezone,"yyyy-MM-dd") === formatInTimeZone(w.end,timezone,"yyyy-MM-dd") ? time(w.end) : windowDate(w.end)} <ArrowUpRight size={12} /></button>) : <span>No {target ? `${target.name} above 30° during moon-free astronomical darkness` : "moon-free astronomical-darkness window"} on this observing night.</span>}{target && nextTargetWindows.length > 0 && <button className="lunar-next-window" onClick={() => onDate(new Date((+nextTargetWindows[0].start + +nextTargetWindows[0].end)/2))}>Next window · {formatInTimeZone(nextTargetWindows[0].start,timezone,"EEE, MMM d · HH:mm")}–{windowEndLabel(nextTargetWindows[0].start,nextTargetWindows[0].end)} ({formatWindowDuration(+nextTargetWindows[0].end-+nextTargetWindows[0].start)}) <ArrowUpRight size={12}/></button>}{target && !nextTargetWindows.length && <span>No moon-free window with {target.name} above 30° in the next 30 nights.</span>}<small>Sun below −18°, Moon below the horizon, and target above 30°. Boundaries are refined to about one second; flat horizon and standard refraction.</small></div>
    </section>
    {prioritizeDark&&lunarWorkspace}
    <section className="lunar-feature-library" id="lunar-landmarks"><div className="section-heading"><div><p className="eyebrow">SMALL OPTICS, BIG DISCOVERIES</p><h2>Seas, bays & bright craters</h2></div><button className="text-action lunar-back-to-atlas" onClick={() => document.getElementById("lunar-atlas")?.scrollIntoView({behavior:"smooth",block:"start"})}>Back to atlas <ArrowUpRight size={12} /></button><span>{picks.length} of {lunarFeatures.length} landmarks</span></div><div className="discovery-toolbar"><label className="search-field"><Search size={15} /><input aria-label="Search lunar features" placeholder="Find a sea or crater…" value={query} onChange={e => setQuery(e.target.value)} /></label><select className="category-select" aria-label="Lunar feature type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All lunar features</option><option value="sea">Lava seas</option><option value="region">Bays & plains</option><option value="crater">Craters & rays</option></select><button className={`filter-toggle ${litOnly && !showAllFeatures ? "active" : ""}`} aria-pressed={showAllFeatures} onClick={() => setShowAllFeatures(!showAllFeatures)}>{showAllFeatures ? "Phase-aware picks" : `Show all ${lunarFeatures.length}`}</button></div>
      <div className="lunar-feature-grid">{picks.slice(0,featureLimit).map(f => { const p=projectLunarFeature(f,frame); return <button key={f.id} className={`lunar-feature-card ${selectedId === f.id ? "selected" : ""}`} onClick={() => { setSelectedId(f.id); document.querySelector(".lunar-workspace")?.scrollIntoView({behavior:"smooth",block:"start"}); }} data-testid={`lunar-feature-${f.id}`}><img className="lunar-feature-thumbnail" src={`./data/moon/features/${f.id}.jpg`} alt={`NASA LROC photographic reference mosaic centered on ${f.name}; fixed lighting`} width={640} height={400} loading="lazy"/><span className="eyebrow">{f.kind === "sea" ? "MARE" : f.kind === "region" ? "BAY / PLAIN" : f.rays ? "CRATER / RAYS" : "CRATER"}</span><h3>{f.name}</h3><p className="lunar-card-description">{lunarFeatureTip(f)}</p><span className={p.favored&&p.visible ? "lunar-favored" : ""}>{!p.visible ? "Beyond limb" : !p.lit ? "Night side" : p.favored ? "Good lighting" : "Sunlit"} · {f.minMagnification}×+</span><ChevronRight size={14} /></button>; })}</div>
      {picks.length>featureLimit&&<button className="filter-toggle lunar-more-features" onClick={()=>setFeatureLimit(value=>value+6)}>Show next {Math.min(6,picks.length-featureLimit)} landmarks · {featureLimit} of {picks.length} shown</button>}
      {!picks.length && <div className="empty-state"><Moon size={25} /><h3>No matching sunlit landmarks</h3><p>Turn off Sunlit now to explore the reference list, or plan another date.</p></div>}
    </section>
    <details className="lunar-sources"><summary>Where the lunar data comes from</summary><p>Positions, phase, angular size and rise/set times are calculated offline with Astronomy Engine for your chosen location and moment. The atlas uses the IAU lunar rotation model, topocentric viewing geometry and NASA’s LROC surface map. It stays lunar north up unless you choose Mirror or Rotate; this is not the Moon’s tilt relative to your local horizon.</p><p>Feature coordinates and diameters come from the IAU/USGS Gazetteer. Picks follow maria and binocular features in the Astronomical League’s Lunar Observing Program. Magnification suggestions are observing guidance, not guaranteed resolution or an official certification list.</p><div><a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">NASA lunar map</a><a href="https://planetarynames.wr.usgs.gov/" target="_blank" rel="noreferrer">IAU / USGS Gazetteer</a><a href="https://www.astroleague.org/lunar-observing-program/" target="_blank" rel="noreferrer">Astronomical League observing guide</a><a href={MOONLIGHT_SOURCE} target="_blank" rel="noreferrer">Moonlight model paper</a></div></details>
  </div>;
}

export function LunarNightItem({ feature, item, timezone, onRemove, onObserved, onOpen, onNotes }: { feature: LunarFeature; item: NightItem; timezone: string; onRemove: () => void; onObserved: () => void; onOpen: () => void; onNotes: (notes: string) => void }) {
  return <article className={`panel night-item ${item.observedAt ? "observed" : ""}`}><div className="night-item-art lunar-night-art"><Moon size={70} strokeWidth={.6} /></div><div className="night-item-body"><div className="flex justify-between gap-3"><div><span className="eyebrow">MOON · {feature.kind}</span><h2>{feature.name}</h2><p className="object-location">{feature.minMagnification}×+ · {feature.diameterKm.toFixed(0)} km across</p></div><button className="icon-button" onClick={onRemove} aria-label={`Remove ${feature.name} from my night`}><X size={16} /></button></div><div className="night-item-actions"><button className={`observed-toggle ${item.observedAt ? "active" : ""}`} onClick={onObserved}>{item.observedAt ? <CheckCircle2 size={16} /> : <Circle size={16} />}{item.observedAt ? `Observed ${formatInTimeZone(new Date(item.observedAt),timezone,"MMM d")}` : "Mark as observed"}</button><button className="text-action" onClick={onOpen}>Lunar atlas <ArrowUpRight size={14} /></button></div><label className="field-label" htmlFor={`note-${item.id}`}>Your field notes</label><textarea id={`note-${item.id}`} className="lunar-night-notes" value={item.notes} onChange={e => onNotes(e.target.value)} placeholder="Light, shadows, steadiness… what did you notice?" rows={2} /></div></article>;
}
