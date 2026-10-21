import { useSvgWidth } from "@/hooks/use-svg-width";
import { SeasonAltitudeCalendar, trajectoryMoment } from "./SeasonAltitudeCalendar";
import { observationAt } from "@/lib/observing-profile";
import { formatInTimeZone } from "date-fns-tz";
import { ContextDateButton } from "./ObservingContext";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { UnifiedTarget } from "@/lib/astronomy";
import {
  seasonEligible,
  clockPoint,
  CLOCK_COLORS,
  type ClockSample,
  type ClockSeason,
} from "@/lib/astronomical-clock";
import { targetDayEvents } from "@/lib/target-visibility";
import {
  ALTITUDE_BANDS,
  TIME_BANDS,
  densityOpacity,
  monthlyTrajectories,
  trajectoryCellDates,
  trajectoryDensity,
  trajectoryIncluded,
  trajectorySector,
  type SeasonTrajectory,
  type TrajectoryScope,
} from "@/lib/season-trajectories";
import {
  MONTH_COLORS,
  nearestMonthlyTrajectoryPoint,
} from "@/lib/seasonal-clock-visual";

type Props = {
  season: ClockSeason;
  targets: UnifiedTarget[];
  samples: ClockSample[];
  night: string;
  lat: number;
  lon: number;
  timezone: string;
  minAlt: number;
  minSeparation: number;
  objectId: string;
  onObject: (id: string) => void;
  scope: TrajectoryScope;
  onScope: (scope: TrajectoryScope) => void;
  onNight: (day: string) => void;
  onTime: (at: Date) => void;
};
const dateLabel = (day: string) =>
  format(new Date(`${day}T12:00:00`), "MMM d, yyyy");
const timeLabel = (bin: number) =>
  `${String(Math.floor(bin / 2)).padStart(2, "0")}:${bin % 2 ? "30" : "00"}`;
function trackPath(
  track: SeasonTrajectory,
  object: number,
  scope: TrajectoryScope,
) {
  return track.hour
    .map((hour, i) => {
      if (!trajectoryIncluded(track, i, object, scope)) return "";
      const p = clockPoint(hour, track.alt[object][i]),
        prev =
          i > 0 &&
          trajectoryIncluded(track, i - 1, object, scope) &&
          (hour - track.hour[i - 1] + 24) % 24 < 0.8;
      return `${prev ? "L" : "M"}${p.x},${p.y}`;
    })
    .join(" ");
}

/** One object's altitude/time distribution; Moon/Sun curves deliberately stay in the daily clock. */
export function SeasonTrajectoryClock({
  season,
  targets,
  samples,
  night,
  lat,
  lon,
  timezone,
  minAlt,
  minSeparation,
  objectId,
  onObject,
  scope,
  onScope,
  onNight,
  onTime,
}: Props) {
  const {ref:monthDialRef,width:dialWidth}=useSvgWidth(640);
  const [monthPoint, setMonthPoint] = useState<{day:string;sample:number}|null>(null);
  const [showOutline, setShowOutline] = useState(false);
  const [focusDay, setFocusDay] = useState<string | null>(null),
    [cell, setCell] = useState<{ time: number; alt: number } | null>(null);
  const index = Math.max(
      0,
      targets.findIndex((t) => t.id === objectId),
    ),
    target = targets[index],
    color = CLOCK_COLORS[index];
  const density = useMemo(
    () => trajectoryDensity(season.trajectories, index, scope),
    [season, index, scope],
  );
  const representatives = useMemo(
    () => monthlyTrajectories(season.trajectories),
    [season],
  );
  const dates = useMemo(
    () =>
      cell
        ? trajectoryCellDates(
            season.trajectories,
            index,
            scope,
            cell.time,
            cell.alt,
          )
        : [],
    [season, index, scope, cell],
  );
  const events = useMemo(
    () =>
      targetDayEvents(
        target.ra,
        target.dec,
        lat,
        lon,
        new Date(`${night}T12:00:00Z`),
        timezone,
      ),
    [target, lat, lon, night, timezone],
  );
  const minMax = useMemo(() => {
    const values = season.trajectories.flatMap((t) => t.alt[index]);
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [season, index]);
  const focused = representatives.find((t) => t.day === focusDay);
  const noPaths = !density.some((row) => row.some((v) => v > 0));
  const pointer = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * 640 - 320,
      y = ((e.clientY - r.top) / r.height) * 640 - 320,
      distance = Math.hypot(x, y);
    if (distance > 254) return;
    const hour =
      (((Math.atan2(y, x) + Math.PI / 2) / (2 * Math.PI)) * 24 + 24) % 24;
    setCell({
      time: Math.floor(hour * 2) % 48,
      alt: Math.min(35, Math.floor((distance / 254) * 36)),
    });
  };
  const keyboard = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") {
      setCell(null);
      return;
    }
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Enter",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    const current = cell ?? { time: 42, alt: 24 };
    if (e.key === "Enter") {
      if (dates[0]) onNight(dates[0]);
      return;
    }
    setCell({
      time:
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 47
            : (current.time +
                (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) +
                48) %
              48,
      alt: Math.max(
        0,
        Math.min(
          35,
          current.alt +
            (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0),
        ),
      ),
    });
  };
  // The chosen-night outline is already sampled by the main clock, with exact events.
  const sampleIncluded = (s: ClockSample) =>
    scope === "all" ||
    (scope === "dark" && s.sun <= -18 + 0.0001) ||
    (scope === "qualified" &&
      seasonEligible(
        s.alt[index],
        s.sun,
        s.moon,
        s.separation[index],
        minAlt,
        minSeparation,
      ));
  const chosenPath = samples
    .map((s, i) => {
      const p = clockPoint(s.hour, s.alt[index]),
        previous = samples[i - 1];
      return sampleIncluded(s)
        ? `${previous && sampleIncluded(previous) && (s.hour - previous.hour + 24) % 24 < 0.4 ? "L" : "M"}${p.x},${p.y}`
        : "";
    })
    .join(" ");
  const monthTrack = representatives.find(t=>t.day===monthPoint?.day), monthSample=monthTrack&&monthPoint?Math.min(monthPoint.sample,monthTrack.hour.length-1):0, monthAt=monthTrack?trajectoryMoment(monthTrack,monthSample,timezone):null;
  const monthValue=monthAt?observationAt(target,lat,lon,monthAt,21.6):null;
  const monthPointer=(event:React.MouseEvent<SVGSVGElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect(), x=(event.clientX-rect.left)/rect.width*640,y=(event.clientY-rect.top)/rect.height*640;
    const nearest=nearestMonthlyTrajectoryPoint(representatives,index,scope,x,y,focused?.day);
    if(nearest && nearest.distance<=28){setMonthPoint(nearest);return nearest;}
    setMonthPoint(null);return null;
  };
  const monthKeyboard=(event:React.KeyboardEvent<SVGSVGElement>)=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape'].includes(event.key))return;event.preventDefault();
    if(event.key==='Escape'){setMonthPoint(null);return;}
    if(event.key==='Enter'){if(monthAt)onTime(monthAt);return;}
    const tracks=focused?[focused]:representatives, current=Math.max(0,tracks.findIndex(t=>t.day===monthPoint?.day));
    const next=tracks[(current+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0)+tracks.length)%tracks.length];
    let sample=Math.max(0,Math.min(next.hour.length-1,(monthPoint?.sample??20)+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0)));
    const candidates=next.hour.map((_,i)=>i).filter(i=>trajectoryIncluded(next,i,index,scope));
    if(candidates.length){sample=candidates.reduce((best,i)=>Math.abs(i-sample)<Math.abs(best-sample)?i:best,candidates[0]);setMonthPoint({day:next.day,sample});}
  };
  const dial = (mode: "months" | "density") => (
    <svg
      ref={mode==="months"?monthDialRef:undefined}
      viewBox="0 0 640 640"
      role="slider"
      tabIndex={0}
      aria-label={mode === "months" ? `Month paths for ${target.name}. Left/right choose time; up/down choose a month. Enter opens that moment.` : `Occupancy shading for ${target.name}. Left/right choose a half hour, up/down choose a five degree altitude band. Enter visits a matching date.`}
      aria-valuemin={0}
      aria-valuemax={mode==="months"?(monthTrack?.hour.length??48)-1:TIME_BANDS * ALTITUDE_BANDS - 1}
      aria-valuenow={mode==="months"?monthPoint?.sample??0:cell ? cell.time * 36 + cell.alt : 42 * 36 + 24}
      aria-valuetext={
        mode==="months" ? monthAt&&monthValue?`${formatInTimeZone(monthAt,timezone,"MMM d HH:mm")}: ${Math.abs(monthValue.alt).toFixed(1)} degrees ${monthValue.alt>=0?"above the horizon":"below the horizon"}, ${monthValue.separation.toFixed(1)} degrees from Moon`:"Inspect a path by pointer or touch, or use arrow keys to choose a month and time." : cell
          ? `${timeLabel(cell.time)}, ${cell.alt * 5 - 90} to ${cell.alt * 5 - 85} degrees, ${(density[cell.time][cell.alt] * 100).toFixed(1)} percent frequency`
          : "Choose an altitude and time to inspect recurrence."
      }
      onPointerMove={mode==='months'?monthPointer:pointer}
      onClick={mode==='months'?event=>{const p=monthPointer(event);const t=representatives.find(t=>t.day===p?.day);if(t&&p)onTime(trajectoryMoment(t,p.sample,timezone));}:undefined}
      onPointerDown={mode==='density'?pointer:undefined}
      onKeyDown={mode==='months'?monthKeyboard:keyboard}
    >
      <title>
        {target.name}: seasonal trajectories from {dateLabel(season.days[0].day)} through{" "}
        {dateLabel(season.days.at(-1)!.day)}. Angle is local time; radius is altitude, not
        azimuth. Inner horizon ring is zero degrees.
      </title>
      <circle cx="320" cy="320" r="254" fill="#07131e" />
      {mode === "density" && density.flatMap((row, time) =>
        row.map(
          (fraction, band) =>
            fraction > 0 && (
              <path
                key={`${time}-${band}`}
                d={trajectorySector(
                  time / 2,
                  time / 2 + 0.5,
                  -90 + band * 5,
                  -85 + band * 5,
                )}
                fill={color}
                opacity={
                  densityOpacity(fraction)
                }
              />
            ),
        ),
      )}
      {[-60, -30, 0, 30, 60, 90].map((alt) => (
        <g key={alt}>
          <circle
            cx="320"
            cy="320"
            r={((alt + 90) / 180) * 254}
            fill="none"
            stroke={alt === 0 ? "#9db7bd" : "#385363"}
            strokeWidth={alt === 0 ? 1.7 : 0.8}
          />
          <text
            x="325"
            y={315 - ((alt + 90) / 180) * 254}
            className="astro-ring-label"
            style={{fontSize:`calc(var(--chart-label-size, 12px) * ${640/dialWidth})`}}
          >
            {alt === 0 ? "0° · HORIZON" : `${alt}°`}
          </text>
        </g>
      ))}
      {Array.from({ length: 24 }, (_, hour) => {
        const end = clockPoint(hour, 90);
        const a = (hour / 12) * Math.PI - Math.PI / 2;
        return (
          <g key={hour}>
            <line
              x1="320"
              y1="320"
              x2={end.x}
              y2={end.y}
              stroke="#56717c"
              strokeWidth=".7"
              opacity=".35"
            />
            <text
              x={320 + Math.cos(a) * 280}
              y={324 + Math.sin(a) * 280}
              textAnchor="middle"
              className="astro-hour"
              style={{fontSize:`calc(var(--chart-label-size, 12px) * ${640/dialWidth})`}}
            >
              {hour === 0
                ? "00 · Midnight"
                : hour === 12
                  ? "12 · Noon"
                  : String(hour).padStart(2, "0")}
            </text>
          </g>
        );
      })}
      {mode === "months" &&
        representatives.map((track) => (
          <path
            key={track.day}
            d={trackPath(track, index, scope)}
            fill="none"
            stroke={MONTH_COLORS[Number(track.day.slice(5, 7)) - 1]}
            strokeWidth={focusDay === track.day ? 4 : 2.5}
            opacity={focused && focused.day !== track.day ? 0.18 : 1}
          />
        ))}
      {mode === "density" && showOutline && chosenPath && (
        <>
          <path d={chosenPath} fill="none" stroke="#03090e" strokeWidth="3.5" />
          <path d={chosenPath} fill="none" stroke={color} strokeWidth="1.8" />
        </>
      )}
      {mode === "density" && cell && (
        <path
          d={trajectorySector(
            cell.time / 2,
            cell.time / 2 + 0.5,
            -90 + cell.alt * 5,
            -85 + cell.alt * 5,
          )}
          fill="none"
          stroke="#f2e6c9"
          strokeWidth="1.5"
        />
      )}
      {mode === 'months' && monthTrack && monthPoint && (()=>{const p=clockPoint(monthTrack.hour[monthSample],monthTrack.alt[index][monthSample]);return <circle className="season-month-point" cx={p.x} cy={p.y} r="5" fill={MONTH_COLORS[Number(monthTrack.day.slice(5,7))-1]} stroke="#111c28" strokeWidth="2" pointerEvents="none"/>;})()}
    </svg>
  );
  return (
    <section
      className="season-trajectory"
      aria-label="Seasonal object trajectory clocks"
    >
      <header>
        <div>
          <h3>One object, across the seasons</h3>
          <p>
            Monthly paths and a night-by-night altitude calendar
          </p>
        </div>
        <label>
          Object
          <select
            aria-label="Seasonal trajectory object"
            value={target.id}
            onChange={(e) => {
              onObject(e.target.value);
              setMonthPoint(null);
              setFocusDay(null);
              setCell(null);
            }}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName || t.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="season-trajectory-tools">
        <div className="season-trajectory-summary">
          <strong style={{ color }}>{target.displayName || target.name}</strong>
          <p>
            Daily geometry, all hours:{" "}
            <b>
              {minMax.min.toFixed(0)}° → {minMax.max.toFixed(0)}°
            </b>
            {events.alwaysUp ? (
              <span>Always above the horizon at this location.</span>
            ) : events.neverUp ? (
              <span>
                Never rises at this location. Its path is inside the horizon
                ring.
              </span>
            ) : null}
          </p>
        </div>
        <label>
          Show times in both views
          <select
            aria-label="Seasonal trajectory time filter"
            value={scope}
            onChange={(e) => {
              onScope(e.target.value as TrajectoryScope);
              setMonthPoint(null);
              setCell(null);
            }}
          >
            <option value="all">All 24 hours</option>
            <option value="dark">Astronomical darkness</option>
            <option value="qualified">Meets observing limits below</option>
          </select>
        </label>
      </div>
      <div className="season-trajectory-grid">
        <div className="season-clock-view" data-season-view="months">
          <h4>Paths colored by month</h4>
          <div className="season-trajectory-dial">{dial("months")}</div>
          <div className="season-trajectory-reading">
            <h4>Follow the months</h4>
            <div className="season-month-readout" aria-live="polite">{monthValue&&monthAt&&monthTrack?<><ContextDateButton value={monthAt} timezone={timezone} onChange={onTime}>{formatInTimeZone(monthAt,timezone,'MMM d, yyyy · HH:mm')}</ContextDateButton><p>{Math.abs(monthValue.alt).toFixed(1)}° {monthValue.alt>=0?'high':'below horizon'} · {monthValue.moon.sunAlt<=-18?'Astronomical darkness':'Twilight / daylight'} · {trajectoryIncluded(monthTrack,monthSample,index,scope)?'Included by current time filter':'Outside current time filter'} · {monthValue.separation.toFixed(1)}° from Moon · Moon {Math.round(monthValue.moon.illumination*100)}% lit</p></>:<p>Inspect a monthly path by pointer or touch to see its exact sampled time, altitude and visibility.</p>}</div>
            <p>
              One representative night near the 15th of each month. Select a
              label to isolate that path. Hover a path to inspect an actual position; tap to open that moment.
            </p>
            <div className="season-month-key">
              {representatives.map((track) => (
                <button
                  key={track.day}
                  style={{
                    color: MONTH_COLORS[Number(track.day.slice(5, 7)) - 1],
                  }}
                  aria-label={`Highlight ${dateLabel(track.day)} trajectory`}
                  aria-pressed={track.day === focusDay}
                  onClick={() => {
                    setFocusDay(focusDay === track.day ? null : track.day);
                    setCell(null);
                  }}
                >
                  {format(new Date(`${track.day}T12:00:00`), "MMM d")}
                </button>
              ))}
            </div>
            {focused && (
              <button
                className="text-action"
                onClick={() => onNight(focused.day)}
              >
                Open {dateLabel(focused.day)} in clock ↗
              </button>
            )}
          </div>
        </div>
        <SeasonAltitudeCalendar tracks={season.trajectories} object={index} target={target} scope={scope} lat={lat} lon={lon} timezone={timezone} onTime={onTime}/>
      </div>
      <details className="season-density-detail"><summary>Advanced: recurrence in altitude bands</summary><p className="astro-note">This combines all dates into one clock. A filled region means the object passed through there on some dates, not that it is always visible. Linear brightness is the fraction of dates that had a sample at this local time and passed through the 5° band. Dates that failed the selected time filter remain in the denominator. Use the date-by-time calendar above to find specific nights.</p><div className="season-trajectory-dial">{dial("density")}</div><div className="season-density-key">{[0,.05,.2,.5,1].map(f=><span key={f}><i style={{background:color,opacity:densityOpacity(f)}}/>{f*100}% of dates at that time</span>)}</div><label><input type="checkbox" checked={showOutline} onChange={e=>setShowOutline(e.target.checked)}/> Show chosen night · {dateLabel(night)}</label>
      {cell&&<div className="season-cell-reading"><strong>{timeLabel(cell.time)} · {cell.alt*5-90}° to {cell.alt*5-85}°</strong><p>{(density[cell.time][cell.alt]*100).toFixed(1)}% of dates with a sample at this time · {dates.length} matching nights out of {season.days.length}</p>{dates[0]&&<button className="text-action" onClick={()=>onNight(dates[0])}>Open {dateLabel(dates[0])} ↗</button>}</div>}
      </details>
      {noPaths && (
        <p role="status">
          No paths match this time filter. Choose all 24 hours to see the full
          geometry.
        </p>
      )}
      <p className="astro-note">
        Angle = local clock time; radius = altitude (center −90°, horizon 0°,
        rim 90°), not compass direction.{" "}
        {scope === "dark"
          ? "Only times with the Sun below −18° are shown."
          : scope === "all"
            ? "Daylight and darkness are both included."
            : "Only samples meeting the altitude and Moon-distance limits below are shown."}{" "}
        Geometry sampled every half hour. Shading uses 5° bands; it shows
        recurrence across dates, not forecast probability. Repeated clock hours
        are averaged.
      </p>
      {scope === "all" && season.days.length > 300 && (
        <p className="astro-note">
          A whole year blends daily motion into a ring in the occupancy clock.
          The month paths show when each trajectory occurs.
        </p>
      )}
    </section>
  );
}
