import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Moon, ArrowUpRight, Binoculars, Check, Plus, Search, ChevronRight, Compass, X, Circle, CheckCircle2 } from "lucide-react";
import { useChartPreferences } from "./ChartPreferences";
import { compassLabel, altitudeLabel } from "@/lib/observing";
import { eqToHorizontal, angularDistance, type UnifiedTarget } from "@/lib/astronomy";
import { moonState, moonDay, lunarFeatures, lunarFrame, projectLunarFeature, featureAngularSize, binocularResolution, scatteredMoonlight, targetMoonlight, MOONLIGHT_SOURCE, type LunarFeature } from "@/lib/moon";
import { renderLunarViewport, separationScale } from "@/lib/lunar-renderer";
import { MoonTargetPicker } from "./MoonTargetPicker";
import { TargetPhoto, TargetPhotoCredit } from "./TargetPhoto";
import type { Settings, NightItem } from "@/lib/session";

export function MoonlightCard({ target, lat, lon, date, skyBrightness = 21.6, onMoon }: { target: UnifiedTarget; lat: number; lon: number; date: Date; skyBrightness?: number; onMoon?: () => void }) {
  const impact = useMemo(() => targetMoonlight(target, lat, lon, date, skyBrightness), [target, lat, lon, date, skyBrightness]);
  return <section className="moonlight-card" aria-label={`Moonlight for ${target.name}`} data-testid="moonlight-card">
    <div className="moonlight-heading"><Moon size={14} /><strong>{impact.targetAlt <= 0 ? "Target below horizon" : impact.level}</strong><span>{Math.round(impact.separation)}° from Moon</span></div>
    <p className={`moonlight-target-position ${impact.targetAlt < 15 ? "low" : ""}`}>Target {Math.round(impact.targetAlt)}° {compassLabel(impact.targetAz)} · {altitudeLabel(impact.targetAlt)}</p><p>{impact.advice}</p><p className="moonlight-target-brightness">Catalog magnitude {target.mag.toFixed(1)}{/double/i.test(target.category) ? " · component brightness can differ" : target.category==="Star" ? " · stellar brightness can vary" : " · integrated light; faint detail can be much harder"}.</p>
    <div className="moonlight-numbers"><span>{Math.round(impact.moon.illumination*100)}% lit · Moon {Math.round(impact.moon.alt)}° {compassLabel(impact.moon.az)}</span>
      {impact.targetAlt > 0 && impact.moon.alt > -impact.moon.diameter/2 && impact.moon.sunAlt <= -18 && <span>≈ {impact.brightening.toFixed(1)} mag brighter sky</span>}</div>
    <details><summary>How this estimate works</summary><p>Angular separation is measured on the sky: 180° puts the Moon opposite the target. The <a href={MOONLIGHT_SOURCE} target="_blank" rel="noreferrer">Krisciunas–Schaefer model</a> estimates extra sky glow from lunar phase, height and separation. Assumes a {skyBrightness.toFixed(1)} mag/arcsec² moonless zenith sky and clear-air extinction of 0.172 mag/airmass. It does not predict a percentage chance of seeing this object.</p><p>{impact.reliable ? "Even under clear skies this is an estimate; haze, local lighting and the object's surface brightness affect visibility." : "Outside the model's usual observing range: low altitude, twilight or extreme separation makes the estimate less dependable."} Lunar eclipses and local obstructions are not included.</p></details>
    {onMoon && <button className="text-action" onClick={onMoon}>Plan around the Moon <ArrowUpRight size={12} /></button>}
  </section>;
}

function LunarFeaturePhoto({feature}:{feature:LunarFeature}) {
  return <figure className="lunar-feature-photo"><img src={`./data/moon/features/${feature.id}.jpg`} width={640} height={400} alt={`NASA LROC photographic reference mosaic centered on ${feature.name}; north up, fixed lighting`} loading="lazy"/><figcaption><span>NASA / LROC reference mosaic · fixed lighting</span><a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">Source ↗</a></figcaption></figure>;
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
  const mag = settings.binocularMagnification, aperture = settings.binocularAperture;
  const apparentSpan = Math.max(60, settings.fov * mag);
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
  const shown = lunarFeatures.filter(f => { const p = projectLunarFeature(f, frame); return p.visible && (reference || p.lit) && (f.kind !== "crater" || f.id === selectedId); });
  const labelBoxes:{left:number;top:number;width:number;height:number}[]=[];
  const mapFeatures=shown.slice().sort((a,b)=>Number(b.id===selectedId)-Number(a.id===selectedId)).map(feature=>{
    const p=projectLunarFeature(feature,frame),angle=preferences.rotation*Math.PI/180;
    const mx=p.x*radius*(preferences.mirrored?-1:1),my=p.y*radius;
    const x=stageWidth/2+(pan.x+mx*Math.cos(angle)-my*Math.sin(angle))*stageScale;
    const y=stageWidth/2+(pan.y+mx*Math.sin(angle)+my*Math.cos(angle))*stageScale;
    const text=feature.name.replace("Mare ","");
    const width=Math.ceil(text.length*preferences.labelSize*.6)+8,height=Math.ceil(preferences.labelSize*1.25)+4;
    let label:{dx:number;dy:number}|null=null;
    if(preferences.labelSize>0)for(const [dx,dy] of [[9,-height+4],[9,4],[-width-9,-height+4],[-width-9,4]]){
      const box={left:x+dx,top:y+dy,width,height};
      if(box.left<5||box.top<34||box.left+width>stageWidth-5||box.top+height>stageWidth-30)continue;
      if(labelBoxes.some(b=>!(box.left+width<b.left||box.left>b.left+b.width||box.top+height<b.top||box.top>b.top+b.height)))continue;
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
          <canvas ref={canvas} width={renderSize} height={renderSize} className="lunar-viewport-canvas" style={{filter:`blur(${blur*stageScale}px)`}} role="img" aria-label={`Calculated ${state.phaseName}, ${Math.round(state.illumination*100)}% illuminated. Lunar north up before manual orientation; NASA LROC surface map. ${view === "binocular" ? `${mag} by ${aperture} binocular preview, ${settings.fov} degree field.` : "Magnified reference atlas."}`} />
      <div className="lunar-stage-inner" style={{transform:`translate(-50%,-50%) scale(${stageScale})`}}>
        {view === "binocular" && <div className="lunar-field-ring" style={{ width: 480*settings.fov*mag/apparentSpan, height: 480*settings.fov*mag/apparentSpan }} />}
        <div className="lunar-disk-layer" style={{ transform }}>

          {selected && view === "binocular" && labels && (() => { const p = projectLunarFeature(selected, frame); return p.visible && (reference || p.lit) ? <span className="lunar-selection-dot" style={{ left: 256+p.x*radius, top: 256+p.y*radius }} /> : null; })()}
        </div>
      </div>
      {labels&&view==="atlas"&&mapFeatures.map(({feature,x,y,text,label})=><button key={feature.id} data-lunar-feature={feature.id} className={`lunar-map-feature ${selectedId===feature.id?"selected":""}`} style={{left:x,top:y,width:16,height:16,padding:0}} onClick={event=>{if(event.detail===0)onSelect(feature.id);}} aria-label={`Identify ${feature.name}`}><i/>{label&&<span style={{left:label.dx+8,top:label.dy+8,fontSize:preferences.labelSize,lineHeight:1.25}}>{text}</span>}</button>)}
      <span className="lunar-orientation">Lunar N ↑ · E → before rotation</span><span className="lunar-view-caption">{reference ? "REFERENCE ATLAS · LIGHTING DISABLED" : view === "atlas" ? "MAGNIFIED ATLAS · CALCULATED LIGHTING" : `${mag}×${aperture} · ${settings.fov.toFixed(1)}° FIELD${zoom !== 1 ? " · DISPLAY ZOOM" : ""}`}</span>
      {!texture && <p className="lunar-loading">{failed ? "Surface map unavailable. Reconnect to prepare the offline atlas." : "Opening the lunar map…"}</p>}
    </div>
    <div className="chart-toolbar"><div className="chart-toolbar-group"><button aria-label="Zoom lunar view in" onClick={() => setZoom(z => Math.min(8,z*1.2))}>+</button><button aria-label="Zoom lunar view out" onClick={() => setZoom(z => Math.max(.5,z/1.2))}>−</button><button onClick={reset}>Reset {zoom.toFixed(1)}×</button></div><div className="chart-toolbar-group"><button className={preferences.mirrored ? "active" : ""} aria-pressed={preferences.mirrored} onClick={() => updateDisplay({ mirrored: !preferences.mirrored })}>Mirror</button><button onClick={() => updateDisplay({ rotation: ((preferences.rotation+90)%360) as 0|90|180|270 })}>Rotate · {preferences.rotation}°</button></div></div>
    <div className="lunar-label-controls"><label>Label size <input aria-label="Lunar label size" type="range" min={0} max={30} value={preferences.labelSize} onChange={e=>updateDisplay({labelSize:Number(e.target.value)})}/><output>{preferences.labelSize===0?"Off":`${preferences.labelSize}px`}</output></label><span>Drag to pan · Ctrl / ⌘ + scroll or pinch to zoom · orientation changes only with Rotate</span></div>
    <div className="lunar-optics"><label>Magnification <OpticsInput label="Binocular magnification" min={5} max={40} value={mag} onValue={n => update({ binocularMagnification:n })} />×</label><label>Aperture <OpticsInput label="Binocular aperture" min={20} max={150} value={aperture} onValue={n => update({ binocularAperture:n })} />mm</label><label>True field <OpticsInput label="Lunar field of view" min={.2} max={15} step={.1} value={settings.fov} onValue={n => update({ fov:n, ...(settings.shape === "circle" ? { fovHeight:n } : {}) })} />°</label><span>Binocular preview · 5–40×, 20–150 mm · exit pupil {(aperture/mag).toFixed(1)} mm · nominal resolution {resolution.toFixed(1)}″</span></div>
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
  const [fullSeparation,setFullSeparation]=useState(false);
  const [query, setQuery] = useState(""); const [litOnly, setLitOnly] = useState(true); const [kind, setKind] = useState("all");
  const selected = lunarFeatures.find(f => f.id === selectedId)!;
  const featurePosition = projectLunarFeature(selected, frame);
  const picks = lunarFeatures.filter(f => f.name.toLowerCase().includes(query.toLowerCase()) && (kind === "all" || f.kind === kind) && (!litOnly || (projectLunarFeature(f,frame).lit && projectLunarFeature(f,frame).visible))).sort((a,b) => Number(projectLunarFeature(b,frame).favored)-Number(projectLunarFeature(a,frame).favored));
  const time = (at: Date) => formatInTimeZone(at,timezone,"HH:mm");
  const afterSet = day.nextSet ? new Date(day.nextSet.getTime()+15*60_000) : null;
  const afterSetSun = afterSet ? moonState(lat,lon,afterSet).sunAlt : -90;
  const afterSetSky = afterSetSun >= 0 ? "daylight" : afterSetSun > -18 ? "twilight" : "astronomical night";
  const windowDate = (at: Date) => formatInTimeZone(at,timezone,"MMM d, HH:mm");
  const eventLabel = (at: Date | null) => at ? time(at) : "No event today";
  const pointX = (at: Date) => 38+(at.getTime()-day.start.getTime())/(day.end.getTime()-day.start.getTime())*640;
  const pointY = (alt: number) => 180-(Math.max(-20,Math.min(90,alt))+20)/110*156;
  const path = day.samples.map((p,i) => `${i ? "L" : "M"}${pointX(p.date).toFixed(1)},${pointY(p.alt).toFixed(1)}`).join(" ");
  const separation = target ? angularDistance(target.ra,target.dec,state.ra,state.dec) : null;
  const comparison = target ? day.samples.map(p => {
    const targetAlt = eqToHorizontal(target.ra,target.dec,lat,lon,p.date).alt;
    const distance = angularDistance(target.ra,target.dec,p.ra,p.dec);
    return { ...p, targetAlt, separation:distance, ...scatteredMoonlight(p,targetAlt,distance,settings.skyBrightness) };
  }) : [];
  const hasMoonlitDarkness=comparison.some(p=>p.sunAlt<=-18&&p.alt>-p.diameter/2&&p.targetAlt>0&&p.brightening>.01);
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
  return <div className="moon-observatory" data-testid="moon-observatory">
    <div className="page-heading"><div><p className="eyebrow">WHEN THE MOON STEALS THE SHOW</p><h1>A world next door<span>.</span></h1><p>Follow the light. Trace a sea. Make a bright night your own.</p></div><Moon className="moon-heading-mark" strokeWidth={1} /></div>
    <nav className="lunar-section-links" aria-label="Jump to Moon section"><button className="text-action" onClick={() => document.getElementById("lunar-planning")?.scrollIntoView({behavior:"smooth",block:"start"})}><Compass size={13} /> Today’s chart</button><button className="text-action" onClick={() => document.getElementById("lunar-atlas")?.scrollIntoView({behavior:"smooth",block:"start"})}><Moon size={13} /> Moon atlas</button><button className="text-action" onClick={() => document.getElementById("lunar-landmarks")?.scrollIntoView({behavior:"smooth",block:"start"})}>Landmark list <ChevronRight size={13} /></button></nav>
    <MoonTargetPicker targets={targets} target={target} onSelect={onTarget}/>
    <div className="lunar-status-strip"><div><span>At your observing time</span><strong>{state.phaseName}</strong><small>{Math.round(state.illumination*100)}% illuminated</small></div><div><span>Find it in your sky</span><strong>{Math.round(state.alt)}° {compassLabel(state.az)}</strong><small>Azimuth {Math.round(state.az)}° · {state.alt >= 0 ? "above horizon" : "below horizon"}</small></div><div><span>Moonrise today</span><strong>{eventLabel(day.rise)}</strong><small>{day.rise ? `${Math.round(moonState(lat,lon,day.rise).az)}° ${compassLabel(moonState(lat,lon,day.rise).az)}` : "A rise need not occur each civil day"}</small></div><div><span>Moonset today</span><strong>{eventLabel(day.set)}</strong><small>{day.set ? `${Math.round(moonState(lat,lon,day.set).az)}° ${compassLabel(moonState(lat,lon,day.set).az)}` : "Check the next event below"}</small></div></div>
    <div className={`lunar-invitation ${state.alt < 0 ? "low" : ""}`}><Compass size={18} /><p>{state.sunSeparation < 20 ? `The Moon is only ${Math.round(state.sunSeparation)}° from the Sun. Explore the reference atlas; do not search near the Sun with binoculars.` : state.alt < -state.diameter/2 ? "The Moon is below the horizon. Explore the atlas now, then choose a time when it is up." : state.alt < 15 ? "The Moon is low. A higher view usually gives a steadier image; find a clear horizon or wait for it to climb." : state.illumination > .7 ? "A bright Moon is a good reason to explore its seas and ray systems. For faint deep-sky targets, use the moonless windows below." : "Look along the terminator—the boundary between lunar day and night. Low sunlight brings crater rims into relief."}</p></div>
    <section className="panel lunar-planning" id="lunar-planning"><div className="panel-heading"><div><span className="eyebrow">MAKE ROOM FOR DARKNESS</span><h2>The Moon through your day</h2></div><span className="live-label">{formatInTimeZone(date,timezone,"MMM d, yyyy")}</span></div>
      <p className="lunar-chart-context" title={coordinates}>{locationName??coordinates} · {timezone.replaceAll("_"," ")} · times local</p>
      <div className="lunar-chart-legend" aria-label="Moon chart legend"><span><i className="legend-line moon-line" /> Moon height</span>{target && <span><i className="legend-line target-line dashed" /> {target.name} height</span>}<span><i className="legend-shading" /> Astronomical darkness</span><span><i className="legend-cursor" /> Chosen time</span></div>
      <p className="lunar-chart-axis-title">Height above the horizon · degrees</p>
      <svg className="lunar-altitude-chart" viewBox="0 0 710 212" role="img" aria-label={`Moon altitude on ${formatInTimeZone(date,timezone,"MMMM d, yyyy")}; shaded bands are astronomical darkness, gold line is the Moon${target ? `, mint line is ${target.name}` : ""}.`}>
        {day.samples.slice(0,-1).map((p,i) => p.sunAlt <= -18 ? <rect key={i} x={pointX(p.date)} y={20} width={640/96+.2} height={160} fill="#a3c6b1" opacity={.09} /> : null)}
        {[-20,0,30,60,90].map(alt => <g key={alt}><line x1={38} x2={678} y1={pointY(alt)} y2={pointY(alt)} stroke={alt === 0 ? "#6f858c" : "#28404b"} strokeDasharray={alt === 0 ? undefined : "3 4"} /><text x={30} y={pointY(alt)+3} textAnchor="end" fill="#9ab0b9" fontSize={10}>{alt}°</text></g>)}
        {target && <path d={targetPath} fill="none" stroke="#a4c7bb" strokeWidth={1.5} strokeDasharray="5 3" />}
        <path d={path} fill="none" stroke="#dfc482" strokeWidth={2.5} />
        <line x1={pointX(date)} x2={pointX(date)} y1={20} y2={180} stroke="#dbe4df" strokeDasharray="2 3" /><circle cx={pointX(date)} cy={pointY(state.alt)} r={4} fill="#dfc482" />
        {[0,24,48,72,96].map(i => <text key={i} x={pointX(day.samples[i].date)} y={203} textAnchor="middle" fill="#9ab0b9" fontSize={10}>{time(day.samples[i].date)}{i === 96 ? "+1d" : ""}</text>)}
      </svg>
      {target && <div className="lunar-separation-panel" data-testid="moon-separation-chart"><div className="lunar-separation-heading"><strong>Moon → {target.name}</strong><span>{Math.round(separation!)}° apart at {time(date)}</span></div><p>Angular distance across the sky · 0° = together, 180° = opposite</p>
        <div className="lunar-separation-scale"><span>Today: {Math.min(...distances).toFixed(1)}°–{Math.max(...distances).toFixed(1)}° apart</span><button type="button" aria-pressed={fullSeparation} onClick={()=>setFullSeparation(!fullSeparation)}>{fullSeparation?"Show detail scale":"Show full 0–180° scale"}</button></div>
        <p className="lunar-separation-note">Earth’s rotation carries both across the sky together. Their separation changes more slowly as the Moon orbits Earth. {fullSeparation?"Full angular scale.":`Detail scale: ${scale.min}°–${scale.max}°.`}</p><svg viewBox="0 0 710 150" role="img" aria-label={`Angular separation between the Moon and ${target.name} through the day, axis ${scale.min} to ${scale.max} degrees; currently ${Math.round(separation!)} degrees apart.`}>
        {comparison.slice(0,-1).map((p,i) => p.sunAlt <= -18 && p.alt > -p.diameter/2 && p.targetAlt > 0 ? <rect key={i} x={pointX(p.date)} y={20} width={640/96+.2} height={100} fill="#d8ba76" opacity={Math.min(.35,p.brightening/10)} /> : null)}
        {separationTicks.map(angle => <g key={angle}><line x1={38} x2={678} y1={separationY(angle)} y2={separationY(angle)} stroke="#28404b" strokeDasharray="3 4" /><text x={30} y={separationY(angle)+3} textAnchor="end" fill="#9ab0b9" fontSize={10}>{Number(angle.toFixed(1))}°</text></g>)}<path d={separationPath} fill="none" stroke="#a4c7bb" strokeWidth={2.5} /><line x1={pointX(date)} x2={pointX(date)} y1={20} y2={120} stroke="#dbe4df" strokeDasharray="2 3" /><circle cx={pointX(date)} cy={separationY(separation!)} r={4} fill="#b8dbcf" />{[0,24,48,72,96].map(i => <text key={i} x={pointX(day.samples[i].date)} y={143} textAnchor="middle" fill="#9ab0b9" fontSize={10}>{time(day.samples[i].date)}{i===96 ? "+1d" : ""}</text>)}
        </svg><div className="lunar-chart-legend"><span><i className="legend-line target-line" /> Angular separation</span><span><i className="legend-shading moon-glare" /> {hasMoonlitDarkness?"Warm shading = extra moonlight in darkness":"No moonlit darkness for this target today"}</span></div><div className="lunar-comparison-now"><span>Moon {Math.round(state.illumination*100)}% illuminated · {Math.round(state.alt)}° high</span><MoonlightCard target={target} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} /></div></div>}
      <div className="lunar-timeline"><label htmlFor="lunar-time">Choose time · {time(date)}</label><input id="lunar-time" aria-label="Moon planning time" type="range" min={0} max={95} value={Math.min(moment,95)} onChange={e => onDate(day.samples[Number(e.target.value)].date)} /><span>Gold = Moon · mint = {target?.name ?? "no target selected"} · shaded = Sun below −18°</span></div>
      <div className="lunar-event-actions">{day.nextRise && <button className="text-action" onClick={() => onDate(day.nextRise!)}><ChevronRight size={12} /> Next rise · {formatInTimeZone(day.nextRise,timezone,"MMM d, HH:mm")}</button>}{day.nextSet && <button className="text-action" onClick={() => onDate(afterSet!)}><ChevronRight size={12} /> Moonset + 15 min · {formatInTimeZone(afterSet!,timezone,"MMM d, HH:mm")} · {afterSetSky}</button>}{day.transit && <button className="text-action" onClick={() => onDate(day.transit!)}>Highest today · {time(day.transit)}</button>}</div>
      <div className="lunar-dark-windows"><strong>Moonless darkness · next 24 hours</strong>{day.windows.length ? day.windows.map((w,i) => <button key={i} onClick={() => onDate(new Date((w.start.getTime()+w.end.getTime())/2))}>{windowDate(w.start)}–{formatInTimeZone(w.start,timezone,"yyyy-MM-dd") === formatInTimeZone(w.end,timezone,"yyyy-MM-dd") ? time(w.end) : windowDate(w.end)} <ArrowUpRight size={12} /></button>) : <span>No moonless astronomical-darkness window in the next 24 hours.</span>}<small>Refined rise/set and twilight crossings; flat horizon, standard refraction. Choose a window to plan its midpoint.</small></div>
    </section>
    <div className="lunar-workspace"><MoonAtlas lat={lat} lon={lon} date={date} settings={settings} update={update} selectedId={selectedId} onSelect={setSelectedId} /><aside className="lunar-guide-column">
      <section className="panel lunar-feature-detail"><span className="eyebrow">YOUR LUNAR LANDMARK</span><h2>{selected.name}</h2><LunarFeaturePhoto feature={selected}/><div className="lunar-feature-tags"><span>{selected.kind === "sea" ? "Lava sea" : selected.kind === "region" ? "Bay or plain" : selected.rays ? "Crater & rays" : "Crater"}</span><span>{selected.minMagnification}× or more · steady view</span></div><p>{selected.tip}</p>
        <div className="lunar-feature-light"><strong>{!featurePosition.visible ? "Beyond the visible limb" : !featurePosition.lit ? "On the night side" : featurePosition.favored ? "Lighting favors this feature" : "Sunlit; compare on another phase"}</strong><span>Sun {Math.round(featurePosition.sunAltitude)}° above this feature’s horizon</span></div>
        <p className="lunar-feature-scale">{selected.diameterKm.toFixed(0)} km across · projected size ≈ {nominalSize.toFixed(0)}″. {selected.rays ? "The ray system extends well beyond the crater." : nominalSize < 2*resolution || settings.binocularMagnification < selected.minMagnification ? "A challenging outline at your settings; more magnification and steady support may help." : "The broad outline is a reasonable goal at your settings; fine detail is not guaranteed."}</p>
        <div className="lunar-feature-links"><button className="text-action" onClick={() => onSave(featureSaveId)}>{savedIds.has(featureSaveId) ? <Check size={14} /> : <Plus size={14} />}{savedIds.has(featureSaveId) ? "Saved to my night · remove" : "Add to my night"}</button><a href={selected.source} target="_blank" rel="noreferrer">IAU feature record <ArrowUpRight size={12} /></a></div>
      </section>
      {target && <section className="panel lunar-target-panel"><div className="lunar-target-heading"><span className="eyebrow">SELECTED COMPARISON OBJECT</span><button className="text-action" onClick={()=>{document.getElementById("moon-comparison-target")?.scrollIntoView({behavior:"smooth",block:"center"});document.getElementById("moon-target-search")?.focus({preventScroll:true});}}>Change object ↑</button></div><h2>{target.name}</h2><div className="lunar-target-photo"><TargetPhoto target={target} compact/></div><TargetPhotoCredit target={target}/><MoonlightCard target={target} lat={lat} lon={lon} date={date} skyBrightness={settings.skyBrightness} /><label className="lunar-sky-input">Moonless zenith sky <select aria-label="Moonless sky brightness" value={settings.skyBrightness} onChange={e => update({ skyBrightness:Number(e.target.value) })}>{Array.from(new Set([21.6,20.5,19,18,settings.skyBrightness])).map(n => <option key={n} value={n}>{n.toFixed(1)} mag/arcsec²{n===21.6 ? " · dark site" : n===20.5 ? " · rural" : n===19 ? " · suburban" : n===18 ? " · urban" : ""}</option>)}</select></label><small>Reference assumptions; local sky brightness is not measured.</small></section>}
    </aside></div>
    <section className="lunar-feature-library" id="lunar-landmarks"><div className="section-heading"><div><p className="eyebrow">SMALL OPTICS, BIG DISCOVERIES</p><h2>Seas, bays & bright craters</h2></div><button className="text-action lunar-back-to-atlas" onClick={() => document.getElementById("lunar-atlas")?.scrollIntoView({behavior:"smooth",block:"start"})}>Back to atlas <ArrowUpRight size={12} /></button><span>{picks.length} of {lunarFeatures.length} landmarks</span></div><div className="discovery-toolbar"><label className="search-field"><Search size={15} /><input aria-label="Search lunar features" placeholder="Find a sea or crater…" value={query} onChange={e => setQuery(e.target.value)} /></label><select className="category-select" aria-label="Lunar feature type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All lunar features</option><option value="sea">Lava seas</option><option value="region">Bays & plains</option><option value="crater">Craters & rays</option></select><button className={`filter-toggle ${litOnly ? "active" : ""}`} aria-pressed={litOnly} onClick={() => setLitOnly(!litOnly)}>Sunlit now</button></div>
      <div className="lunar-feature-grid">{picks.map(f => { const p=projectLunarFeature(f,frame); return <button key={f.id} className={`lunar-feature-card ${selectedId === f.id ? "selected" : ""}`} onClick={() => { setSelectedId(f.id); document.querySelector(".lunar-workspace")?.scrollIntoView({behavior:"smooth",block:"start"}); }} data-testid={`lunar-feature-${f.id}`}><img className="lunar-feature-thumbnail" src={`./data/moon/features/${f.id}.jpg`} alt={`NASA LROC photographic reference mosaic centered on ${f.name}; fixed lighting`} width={640} height={400} loading="lazy"/><span className="eyebrow">{f.kind === "sea" ? "MARE" : f.kind === "region" ? "BAY / PLAIN" : f.rays ? "CRATER / RAYS" : "CRATER"}</span><h3>{f.name}</h3><p className="lunar-card-description">{f.tip}</p><span className={p.favored&&p.visible ? "lunar-favored" : ""}>{!p.visible ? "Beyond limb" : !p.lit ? "Night side" : p.favored ? "Good lighting" : "Sunlit"} · {f.minMagnification}×+</span><ChevronRight size={14} /></button>; })}</div>
      {!picks.length && <div className="empty-state"><Moon size={25} /><h3>No matching sunlit landmarks</h3><p>Turn off Sunlit now to explore the reference list, or plan another date.</p></div>}
    </section>
    <details className="lunar-sources"><summary>Where the lunar data comes from</summary><p>Positions, phase, angular size and rise/set times are calculated offline with Astronomy Engine for your chosen location and moment. The atlas uses the IAU lunar rotation model, topocentric viewing geometry and NASA’s LROC surface map. It stays lunar north up unless you choose Mirror or Rotate; this is not the Moon’s tilt relative to your local horizon.</p><p>Feature coordinates and diameters come from the IAU/USGS Gazetteer. Picks follow maria and binocular features in the Astronomical League’s Lunar Observing Program. Magnification suggestions are observing guidance, not guaranteed resolution or an official certification list.</p><div><a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">NASA lunar map</a><a href="https://planetarynames.wr.usgs.gov/" target="_blank" rel="noreferrer">IAU / USGS Gazetteer</a><a href="https://www.astroleague.org/lunar-observing-program/" target="_blank" rel="noreferrer">Astronomical League observing guide</a><a href={MOONLIGHT_SOURCE} target="_blank" rel="noreferrer">Moonlight model paper</a></div></details>
  </div>;
}

export function LunarNightItem({ feature, item, timezone, onRemove, onObserved, onOpen, onNotes }: { feature: LunarFeature; item: NightItem; timezone: string; onRemove: () => void; onObserved: () => void; onOpen: () => void; onNotes: (notes: string) => void }) {
  return <article className={`panel night-item ${item.observedAt ? "observed" : ""}`}><div className="night-item-art lunar-night-art"><Moon size={70} strokeWidth={.6} /></div><div className="night-item-body"><div className="flex justify-between gap-3"><div><span className="eyebrow">MOON · {feature.kind}</span><h2>{feature.name}</h2><p className="object-location">{feature.minMagnification}×+ · {feature.diameterKm.toFixed(0)} km across</p></div><button className="icon-button" onClick={onRemove} aria-label={`Remove ${feature.name} from my night`}><X size={16} /></button></div><div className="night-item-actions"><button className={`observed-toggle ${item.observedAt ? "active" : ""}`} onClick={onObserved}>{item.observedAt ? <CheckCircle2 size={16} /> : <Circle size={16} />}{item.observedAt ? `Observed ${formatInTimeZone(new Date(item.observedAt),timezone,"MMM d")}` : "Mark as observed"}</button><button className="text-action" onClick={onOpen}>Lunar atlas <ArrowUpRight size={14} /></button></div><label className="field-label" htmlFor={`note-${item.id}`}>Your field notes</label><textarea id={`note-${item.id}`} className="lunar-night-notes" value={item.notes} onChange={e => onNotes(e.target.value)} placeholder="Light, shadows, steadiness… what did you notice?" rows={2} /></div></article>;
}
