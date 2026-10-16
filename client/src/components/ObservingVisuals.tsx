import { useId, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { observationProfile, suggestedObservation, createMoonSampler } from "@/lib/observing-profile";
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
  skyBrightness?:number;moonAt?:(date:Date)=>MoonState;range?:{start:Date;end:Date};
}
/** Shared night chart: target altitude, angular Moon distance and modeled glow. */
export function NightAltitudeChart({target,lat,lon,night,timezone,skyBrightness=21.6,moonAt,range}:NightChartProps) {
  const clipId=`night-altitude-${useId().replaceAll(":","")}`;
  const localMoon=useMemo(()=>createMoonSampler(lat,lon),[lat,lon,night]);
  const segments=useMemo(()=>observationProfile(target,lat,lon,night,skyBrightness,moonAt??localMoon),[target.ra,target.dec,lat,lon,night,skyBrightness,moonAt,localMoon]);
  if(!night.ok)return <p className="night-altitude-unavailable">{night.error}</p>;
  if(!segments.length)return <p className="night-altitude-unavailable">No astronomical darkness on this night.</p>;
  const start=segments[0].start,end=segments[segments.length-1].end;
  const x=(date:Date)=>28+(+date-+start)/(+end-+start)*266;
  const y=(alt:number)=>76-alt/90*64;
  const isNextDay=(date:Date)=>formatInTimeZone(date,timezone,"yyyy-MM-dd")!==formatInTimeZone(night.start,timezone,"yyyy-MM-dd");
  const time=(date:Date)=>`${formatInTimeZone(date,timezone,"HH:mm")}${isNextDay(date)?" +1d":""}`;
  const startLabel=+start===+night.start?"Start":"Dusk",endLabel=+end===+night.end?"End":"Dawn";
  const samples=segments.flatMap(segment=>segment.samples),below=samples.every(sample=>sample.alt<0);
  const best=suggestedObservation(samples,target,range);
  const middle=new Date((+start+ +end)/2),phaseSample=samples.reduce((a,b)=>Math.abs(+a.date-+middle)<Math.abs(+b.date-+middle)?a:b);
  return <div className="night-altitude-chart">
    <div className="night-altitude-heading"><span className="night-altitude-key">Altitude °</span><span className="night-moon-key">Moon distance °</span></div>
    <svg viewBox="0 0 330 106" role="img" aria-label={`Altitude and angular distance from the Moon for ${target.name} during astronomical darkness, ${formatInTimeZone(night.start,timezone,"MMM d, yyyy")}, from ${startLabel.toLowerCase()} ${time(start)} to ${endLabel.toLowerCase()} ${time(end)}. Solid mint: altitude, left axis 0–90 degrees. Dashed gold: Moon separation, right axis 0–180 degrees. More gold shading means stronger estimated moonlight. Times in ${timezone}.`}>
      <defs><clipPath id={clipId}><rect x="28" y="11" width="266" height="65"/></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>{segments.map(segment=>segment.samples.slice(0,-1).map((sample,i)=>{const next=segment.samples[i+1];return <rect key={+sample.date} x={x(sample.date)} y="12" width={x(next.date)-x(sample.date)+.2} height="64" fill="#e4bd76" opacity={Math.min(.35,sample.moonlight/3*.35)}/>;}))}</g>
      {[0,30,60,90].map(alt=><g key={alt}><line x1="28" x2="294" y1={y(alt)} y2={y(alt)} stroke={alt===0?"#56716f":"#29434e"} strokeDasharray={alt===0?undefined:"3 4"}/><text x="1" y={y(alt)+3} fontSize="9" fill="#96afb6">{alt}°</text><text x="299" y={y(alt)+3} fontSize="9" fill="#d2b77e">{alt*2}°</text></g>)}
      <g clipPath={`url(#${clipId})`}>{segments.map((segment,i)=>{const path=segment.samples.map((sample,j)=>`${j?"L":"M"}${x(sample.date).toFixed(2)},${y(sample.alt).toFixed(2)}`).join(" ");const moonPath=segment.samples.map((sample,j)=>`${j?"L":"M"}${x(sample.date).toFixed(2)},${y(sample.separation/2).toFixed(2)}`).join(" ");return <g key={i}><path className="target-altitude-line" d={path} stroke="#a2d5c5" strokeWidth="2" fill="none"/><path className="moon-separation-line" d={moonPath} stroke="#e3c17f" strokeWidth="1.8" strokeDasharray="4 3" fill="none"/></g>;})}</g>
      {below&&<text x="161" y="44" textAnchor="middle" fill="#c3d0c4" fontSize="11">Below horizon all night</text>}
      <text x="28" y="96" textAnchor="start" fill="#a0b5bb" fontSize="9">{startLabel} {time(start)}</text><text x="161" y="96" textAnchor="middle" fill="#829ea8" fontSize="9">{time(middle)}</text><text x="294" y="96" textAnchor="end" fill="#a0b5bb" fontSize="9">{endLabel} {time(end)}</text>
    </svg>
    <p className="night-moon-explanation">Night {formatInTimeZone(night.start,timezone,"MMM d, yyyy")} · Moon {Math.round(phaseSample.moon.illumination*100)}% lit</p>
    <p className="night-moon-explanation">More gold = stronger moonlight (estimate)</p>
    <p className="night-observation-suggestion">{best?<>Suggested{range?" in session":""}: {time(best.date)} · {Math.round(best.alt)}° high · {Math.round(best.separation)}° from Moon <span>· {best.moon.alt<=-best.moon.diameter/2?"Moon down":`Moon ${Math.round(best.moon.alt)}° high · ≈${best.moonlight.toFixed(1)} mag sky glow`}</span></>:range?"No usable dark slot in this session.":"No dark window above 15° for this target."}</p>
  </div>;
}

export function NightObservationDetails({initialOpen=false,...props}:NightChartProps&{initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  return <details className="planner-row-forecast" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Altitude & Moon graph</summary>{open&&<NightAltitudeChart {...props}/>}</details>;
}
