import { ContextDateButton } from "./ObservingContext";
import { useId, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { observationProfile, suggestedObservation, createMoonSampler, observationAt, profileCursorDate } from "@/lib/observing-profile";
import type { MoonState } from "@/lib/moon";
import { type VisibilityWindow } from "@/lib/target-visibility";
import {
  type UnifiedTarget,
} from "@/lib/astronomy";
import {
  altitudeSamples,
  compassLabel,
} from "@/lib/observing";

export function AltitudeChart({
  target,
  lat,
  lon,
  date,
  timezone,
}: {
  target: UnifiedTarget;
  lat: number;
  lon: number;
  date: Date;
  timezone: string;
}) {
  const samples = useMemo(
    () => altitudeSamples(target, lat, lon, date),
    [target, lat, lon, date],
  );
  const y = (alt: number) => 88 - (Math.max(-10, Math.min(90, alt)) / 90) * 72;
  const path = samples
    .map((s, i) => `${i === 0 ? "M" : "L"}${28 + i * 9},${y(s.alt)}`)
    .join(" ");
  const best = samples
    .filter((s) => s.dark && s.alt >= 30)
    .sort((a, b) => b.alt - a.alt)[0];
  return (
    <div className="altitude-chart">
      <div className="flex justify-between text-xs mb-2">
        <span className="text-muted-foreground">
          Calculated altitude · next 8 hours
        </span>
        <span className="text-primary">
          {best
            ? `High & dark: ${formatInTimeZone(best.date, timezone, "HH:mm")}`
            : "No high, dark window"}
        </span>
      </div>
      <svg
        viewBox="0 0 330 116"
        role="img"
        aria-label={`Calculated altitude for ${target.name} over eight hours. Shaded bands mark times when the Sun is below 18 degrees under the horizon; this is not a weather forecast.`}
      >
        {samples.map(
          (s, i) =>
            s.dark && (
              <rect
                key={i}
                x={28 + i * 9 - 4.5}
                y="12"
                width="9"
                height="84"
                fill="#7fbcb1"
                opacity=".07"
              />
            ),
        )}
        {[0, 30, 60].map((a) => (
          <g key={a}>
            <line
              x1="28"
              x2="316"
              y1={y(a)}
              y2={y(a)}
              stroke="#263c48"
              strokeDasharray={a === 0 ? undefined : "3 4"}
            />
            <text x="2" y={y(a) + 3} fontSize="9" fill="#7d94a2">
              {a}°
            </text>
          </g>
        ))}
        <path d={path} stroke="#91c7bf" strokeWidth="2" fill="none" />
        <circle cx="28" cy={y(samples[0].alt)} r="3" fill="#d9bd81" />
        {[0, 8, 16, 24, 32].map((i) => (
          <text
            key={i}
            x={28 + i * 9}
            y="112"
            textAnchor="middle"
            fill="#7d94a2"
            fontSize="9"
          >
            {formatInTimeZone(samples[i].date, timezone, "HH:mm")}
          </text>
        ))}
      </svg>
      <p className="text-[10px] text-muted-foreground mt-1">
        Shaded = Sun below −18° · position only, no weather data · aim for 30° or higher
      </p>
    </div>
  );
}

export interface NightChartProps {
  target:UnifiedTarget;lat:number;lon:number;night:VisibilityWindow;timezone:string;
  selectedAt?:Date;showContext?:boolean;span?:"night"|"day";skyBrightness?:number;moonAt?:(date:Date)=>MoonState;range?:{start:Date;end:Date};
}
/** Shared night chart: target altitude, angular Moon distance and modeled glow. */
export function NightAltitudeChart({target,lat,lon,night,timezone,skyBrightness=21.6,moonAt,range,showContext=false,span="night",selectedAt}:NightChartProps) {
  const clipId=`night-altitude-${useId().replaceAll(":","")}`;
  const localMoon=useMemo(()=>createMoonSampler(lat,lon),[lat,lon,night]);
  const segments=useMemo(()=>observationProfile(target,lat,lon,night,skyBrightness,moonAt??localMoon),[target.ra,target.dec,lat,lon,night,skyBrightness,moonAt,localMoon]);
  const profileKey=`${target.id}:${target.ra}:${target.dec}:${lat}:${lon}:${night.ok?+night.start:"invalid"}:${skyBrightness}`;
  const [cursor,setCursor]=useState<{key:string;date:Date}|null>(null);
  const cursorDate=cursor?.key===profileKey?cursor.date:null;
  const inspected=useMemo(()=>cursorDate?observationAt(target,lat,lon,cursorDate,skyBrightness,moonAt??localMoon):null,[cursorDate,target.ra,target.dec,lat,lon,skyBrightness,moonAt,localMoon]);
  if(!night.ok)return <p className="night-altitude-unavailable">{night.error}</p>;
  if(!segments.length)return <p className="night-altitude-unavailable">No astronomical darkness on this night.</p>;
  const start=segments[0].start,end=segments[segments.length-1].end;
  const x=(date:Date)=>28+(+date-+start)/(+end-+start)*266;
  const minimumAltitude=showContext?-90:0;
  // Keep the chart readable at phone width: the 170-unit viewBox is rendered
  // at 170 CSS px high, while the wider viewBox is compressed only horizontally.
  const y=(alt:number)=>132-(alt-minimumAltitude)/(90-minimumAltitude)*116;
  const sy=(separation:number)=>132-separation/180*116;
  const isNextDay=(date:Date)=>formatInTimeZone(date,timezone,"yyyy-MM-dd")!==formatInTimeZone(night.start,timezone,"yyyy-MM-dd");
  const time=(date:Date)=>`${formatInTimeZone(date,timezone,"HH:mm")}${isNextDay(date)?" +1d":""}`;
  const startLabel=+start===+night.start?"Start":"Dusk",endLabel=+end===+night.end?"End":"Dawn";
  const samples=segments.flatMap(segment=>segment.samples),below=samples.every(sample=>sample.alt<0);
  const moonDownAllNight=samples.every(sample=>sample.moon.alt<=-sample.moon.diameter/2);
  const best=suggestedObservation(samples.filter(s=>s.moon.sunAlt<=-18),target,range);
  const middle=new Date((+start+ +end)/2),phaseSample=samples.reduce((a,b)=>Math.abs(+a.date-+middle)<Math.abs(+b.date-+middle)?a:b);
  const shownMoon=inspected??phaseSample;
  const illumination=Math.round(shownMoon.moon.illumination*100);
  const selectFraction=(fraction:number)=>{const date=profileCursorDate(night,fraction);if(date)setCursor(previous=>previous?.key===profileKey&&+previous.date===+date?previous:{key:profileKey,date});};
  const selectPointer=(event:React.PointerEvent<SVGSVGElement>)=>{const box=event.currentTarget.getBoundingClientRect();selectFraction(((event.clientX-box.left)/box.width*330-28)/266);};
  const readout=inspected?`${time(inspected.date)} · Altitude ${inspected.alt.toFixed(1)}° · Moon ${inspected.moon.alt<=-inspected.moon.diameter/2?"below horizon; ":""}distance ${inspected.separation.toFixed(1)}°${showContext?` · Moon altitude ${inspected.moon.alt.toFixed(1)}° · Sun altitude ${inspected.moon.sunAlt.toFixed(1)}°`:""}`:best?`Suggested ${time(best.date)} · ${Math.round(best.alt)}° altitude${best.moon.alt<=-best.moon.diameter/2?" · Moon below horizon":` · Moon ${Math.round(best.moon.alt)}° high`}`:"Hover or touch for time, altitude & Moon distance";
  return <div className="night-altitude-chart">
    <div className="night-altitude-heading"><span className="night-altitude-key">Altitude °</span><span className="night-moon-key" title={moonDownAllNight?"Moon below horizon throughout this graph; angular distance has no moonlight penalty":"Angular distance from the Moon"}>Moon distance °{moonDownAllNight?" · Moon down":""}</span>{showContext&&<><span className="context-moon-key">Moon altitude °</span><span className="context-sun-key">Sun altitude °</span></>}</div>
    <svg viewBox="0 0 330 170" preserveAspectRatio="none" style={{height:170}} role="slider" tabIndex={0} aria-valuemin={0} aria-valuemax={Math.round((+end-+start)/60000)} aria-valuenow={Math.round((+(cursorDate??best?.date??start)-+start)/60000)} aria-valuetext={inspected?readout:undefined} aria-describedby={`${clipId}-help`}
      onPointerMove={selectPointer}
      onPointerDown={event=>{event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);selectPointer(event);}}
      onPointerLeave={event=>{if(event.pointerType==="mouse"&&!event.currentTarget.hasPointerCapture(event.pointerId)&&document.activeElement!==event.currentTarget)setCursor(null);}}
      onPointerCancel={()=>setCursor(null)}
      onFocus={()=>{if(!cursorDate)selectFraction((+(best?.date??middle)-+start)/(+end-+start));}}
      onBlur={()=>setCursor(null)}
      onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End","Escape"].includes(event.key))return;event.preventDefault();event.stopPropagation();if(event.key==="Escape"){setCursor(null);event.currentTarget.blur();return;}selectFraction(event.key==="Home"?0:event.key==="End"?1:((Math.floor(+(cursorDate??best?.date??middle)/60000)*60000-+start)+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?15:1)*60000)/(+end-+start));}}
      aria-label={`Altitude and angular distance from the Moon for ${target.name} during ${span==="day"?"the selected local day":"astronomical darkness"}, ${formatInTimeZone(night.start,timezone,"MMM d, yyyy")}, from ${startLabel.toLowerCase()} ${time(start)} to ${endLabel.toLowerCase()} ${time(end)}. Solid mint: altitude, left axis ${showContext?"−90–90":"0–90"} degrees. ${showContext?"Blue: Moon altitude. Peach: Sun altitude. ":""}Dashed silver: Moon separation, right axis 0–180 degrees. More gray shading means stronger estimated moonlight. Times in ${timezone}.`}>
      <defs><clipPath id={clipId}><rect x="28" y="16" width="266" height="116"/></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>{segments.map(segment=>segment.samples.slice(0,-1).map((sample,i)=>{const next=segment.samples[i+1];return <rect key={+sample.date} x={x(sample.date)} y="16" width={x(next.date)-x(sample.date)+.2} height="116" className="night-moon-shading" fill="#aaaaaa" opacity={sample.moon.sunAlt>-18||sample.moon.alt<=-sample.moon.diameter/2?0:.36*Math.sqrt(Math.min(1,Math.max(0,sample.moonlight)/4))}/>;}))}</g>
      {span==='day'&&<g clipPath={`url(#${clipId})`}>{segments.flatMap(segment=>segment.samples.slice(0,-1).map((sample,i)=>sample.moon.sunAlt<=-18?<rect key={+sample.date} x={x(sample.date)} y="16" width={x(segment.samples[i+1].date)-x(sample.date)+.2} height="116" fill="#adc7c5" opacity=".09"/>:null))}</g>}
      {(showContext?[-90,-60,-30,0,30,60,90]:[0,30,60,90]).map(alt=><g key={alt}><line x1="28" x2="294" y1={y(alt)} y2={y(alt)} stroke={alt===0?"#56716f":"#29434e"} strokeDasharray={alt===0?undefined:"3 4"}/><text x="1" y={y(alt)+5} fontSize="15" fill="#96afb6">{alt}°</text></g>)}
      {[0,60,120,180].map(distance=><text key={distance} x="299" y={sy(distance)+5} fontSize="15" fill="#a1a8b6">{distance}°</text>)}
      <g clipPath={`url(#${clipId})`}>{segments.map((segment,i)=>{const path=segment.samples.map((sample,j)=>`${j?"L":"M"}${x(sample.date).toFixed(2)},${y(sample.alt).toFixed(2)}`).join(" ");const moonPath=segment.samples.map((sample,j)=>`${j?"L":"M"}${x(sample.date).toFixed(2)},${sy(sample.separation).toFixed(2)}`).join(" ");return <g key={i}>{showContext&&<><path className="context-moon-altitude" d={segment.samples.map((sample,j)=>`${j?'L':'M'}${x(sample.date).toFixed(2)},${y(sample.moon.alt).toFixed(2)}`).join(' ')} fill="none" stroke="#929cab" strokeWidth="1" opacity=".8"/><path className="context-sun-altitude" d={segment.samples.map((sample,j)=>`${j?'L':'M'}${x(sample.date).toFixed(2)},${y(sample.moon.sunAlt).toFixed(2)}`).join(' ')} fill="none" stroke="#dc9d84" strokeWidth="1.2"/></>}
      <path className="target-altitude-line" d={path} stroke="#a2d5c5" strokeWidth="2" fill="none"/><path className="moon-separation-line" opacity={moonDownAllNight?.35:1} d={moonPath} stroke="#b1b7c4" strokeWidth="1.8" strokeDasharray="4 3" fill="none"/></g>;})}</g>
      {selectedAt&&selectedAt>=start&&selectedAt<=end&&<g className="night-selected-time" pointerEvents="none"><line x1={x(selectedAt)} x2={x(selectedAt)} y1="16" y2="132" stroke="#d3ddd5" strokeWidth="1.2" strokeDasharray="2 5"/><title>Selected observing time {time(selectedAt)}</title></g>}
      {best&&<g className="night-suggested-time" pointerEvents="none"><line x1={x(best.date)} x2={x(best.date)} y1="16" y2="132" stroke="#d8bc80" strokeWidth="1.5" strokeDasharray="5 4"/><circle cx={x(best.date)} cy={y(best.alt)} r="4.5" fill="#d8bc80" stroke="#0c1c27" strokeWidth="1.5"/><title>Suggested time {time(best.date)} at {Math.round(best.alt)} degrees altitude</title></g>}
      {inspected&&<g className="night-chart-cursor" pointerEvents="none"><line x1={x(inspected.date)} x2={x(inspected.date)} y1="16" y2="132" stroke="#e1ede5" strokeWidth="1.4" strokeDasharray="3 5"/><g clipPath={`url(#${clipId})`}>{inspected.alt>=minimumAltitude&&<circle cx={x(inspected.date)} cy={y(inspected.alt)} r="4" fill="#a2d5c5" stroke="#0c1c27" strokeWidth="1.3"/>}<circle cx={x(inspected.date)} cy={sy(inspected.separation)} r="4" fill="#b1b7c4" stroke="#0c1c27" strokeWidth="1.3"/></g></g>}
      {below&&<text x="161" y="70" textAnchor="middle" fill="#c3d0c4" fontSize="15">Below horizon all {span==='day'?'day':'night'}</text>}
      <text x="28" y="158" textAnchor="start" fill="#a0b5bb" fontSize="15">{startLabel} {time(start)}</text><text x="161" y="158" textAnchor="middle" fill="#829ea8" fontSize="15">{time(middle)}</text><text x="294" y="158" textAnchor="end" fill="#a0b5bb" fontSize="15">{endLabel} {time(end)}</text>
    </svg>
    <span id={`${clipId}-help`} className="sr-only">Hover, tap or drag horizontally to inspect. Arrow keys move one minute; Shift plus arrow moves fifteen minutes; Home and End select dusk and dawn.</span>
    <output className={`night-chart-readout ${inspected?"active":""}`} aria-live="polite">{readout}</output>
    <p className="night-moon-explanation">{span==='day'?'Day':'Night'} <ContextDateButton value={selectedAt??night.start} timezone={timezone}>{formatInTimeZone(night.start,timezone,"MMM d, yyyy")}</ContextDateButton></p>
    <div className="night-moon-illumination">
      <div className="night-moon-illumination-label"><span>Moon illumination</span><strong>{illumination}% <span>· {shownMoon.moon.alt<=-shownMoon.moon.diameter/2?"Moon down":"above horizon"}</span></strong></div>
      <div className="night-moon-meter" role="meter" aria-label={`Moon illumination at ${time(shownMoon.date)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={illumination} aria-valuetext={`${illumination}% illuminated; 0% new Moon, 100% full Moon`}><span style={{width:`${illumination}%`,background:`rgb(${Math.round(45+illumination*1.25)} ${Math.round(45+illumination*1.25)} ${Math.round(45+illumination*1.25)})`}}/></div>
      <div className="night-moon-scale"><span>0% · New Moon</span><span>100% · Full Moon</span></div>
    </div>
    <p className="night-moon-explanation">Gray shading = estimated moonlight in darkness; none when Moon is down{span==='day'?'. Cool shading = astronomical darkness.':''}</p>
    <p className="night-observation-suggestion">{best?<>Suggested{range?" in session":""}: {time(best.date)} · {Math.round(best.alt)}° high · {Math.round(best.separation)}° from Moon <span>· {best.moon.alt<=-best.moon.diameter/2?"Moon down":`Moon ${Math.round(best.moon.alt)}° high · ≈${best.moonlight.toFixed(1)} mag sky glow`}</span></>:range?"No usable dark slot in this session.":"No dark window above 15° for this target."}</p>
  </div>;
}

export function NightObservationDetails({initialOpen=false,...props}:NightChartProps&{initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  return <details className="planner-row-forecast" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Altitude & Moon graph</summary>{open&&<NightAltitudeChart {...props}/>}</details>;
}
