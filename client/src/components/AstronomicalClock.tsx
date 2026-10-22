import { ContextDateButton, ContextLocationButton } from "./ObservingContext";
import "./ClockUX.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
} from "lucide-react";
import type { TrajectoryScope } from "@/lib/season-trajectories";
import { SeasonTrajectoryClock } from "./SeasonTrajectoryClock";
import { Button } from "./ui/button";
import { ComparisonCharts, SeasonChart } from "./ObjectComparisonCharts";
import { type UnifiedTarget } from "@/lib/astronomy";
import { CatalogCombobox } from "./CatalogCombobox";
import { observationAt, createMoonSampler } from "@/lib/observing-profile";
import { resolveLocalMoment } from "@/lib/session";
import { type SavedLocation } from "@/lib/saved-locations";
import {
  CLOCK_COLORS,
  CLOCK_LIMIT,
  clockTargetEvents,
  clockMoonEvents,
  clockBounds,
  clockCurve,
  clockHour,
  clockNightDate,
  clockPoint,
  clockSamples,
  seasonDates,
  shiftClockDate,
  solarColor,
  type ClockSeason,
  type SeasonRequest,
} from "@/lib/astronomical-clock";

type Props = {
  targets: UnifiedTarget[];
  ids: string[];
  onIds: (ids: string[]) => void;
  selectedId: string;
  sessionIds: string[];
  lat: number;
  lon: number;
  timezone: string;
  date: Date;
  locationName: string;
  locations: SavedLocation[];
  onLocation: (lat: number, lon: number) => void;
  onTime: (at: Date) => void;
  onLive: () => void;
  live: boolean;
  skyBrightness: number;
};
const polar = (hour: number, r: number) => {
  const a = (hour / 12) * Math.PI - Math.PI / 2;
  return { x: 320 + Math.cos(a) * r, y: 320 + Math.sin(a) * r };
};
function wedge(a: number, b: number, r: number, inner = 0) {
  const p = polar(a, r),
    q = polar(b, r),
    s = polar(b, inner),
    t = polar(a, inner);
  return `M${p.x},${p.y} A${r},${r} 0 0 1 ${q.x},${q.y} L${s.x},${s.y} ${inner ? `A${inner},${inner} 0 0 0 ${t.x},${t.y}` : ""} Z`;
}
const rounded = (n: number) => `${Math.round(n)}°`;

export function AstronomicalClock({
  targets,
  ids,
  onIds,
  selectedId,
  sessionIds,
  lat,
  lon,
  timezone,
  date,
  locationName,
  locations,
  onLocation,
  onTime,
  onLive,
  live,
  skyBrightness,
}: Props) {
  const dialRef = useRef<SVGSVGElement>(null);
  const [dialTextScale, setDialTextScale] = useState(1);
  const [locked, setLocked] = useState(false);
  const [query, setQuery] = useState(""),
    [cursor, setCursor] = useState<number | null>(null),
    [highlight, setHighlight] = useState<string | null>(null);
  const [travelPreview, setTravelPreview] = useState<Date | null>(null),
    [travelEnd, setTravelEnd] = useState<Date | null>(null);
  const [running, setRunning] = useState(false),
    [travelStep, setTravelStep] = useState<"hour" | "night">("hour");
  const [seasonOpen, setSeasonOpen] = useState(false),
    [from, setFrom] = useState(() => clockNightDate(date, timezone)),
    [to, setTo] = useState(() =>
      shiftClockDate(clockNightDate(date, timezone), 89),
    ),
    [minAlt, setMinAlt] = useState(30),
    [minSeparation, setMinSeparation] = useState(30);
  const [seasonObject, setSeasonObject] = useState(""),
    [trajectoryScope, setTrajectoryScope] = useState<TrajectoryScope>("dark");
  const [season, setSeason] = useState<ClockSeason | null>(null),
    [progress, setProgress] = useState(0),
    [seasonError, setSeasonError] = useState(""),
    [timeError, setTimeError] = useState("");
  const chosen = useMemo(
    () =>
      ids
        .map((id) => targets.find((t) => t.id === id))
        .filter((t): t is UnifiedTarget => !!t),
    [ids, targets],
  );
  useEffect(() => {
    const svg = dialRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const resize = () => {
      const width = svg.getBoundingClientRect().width;
      if (width > 0) setDialTextScale(Math.max(1, Math.min(2.6, 640 / width)));
    };
    const observer = new ResizeObserver(resize);
    resize();
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const clockDate = travelPreview ?? date;
  const night = clockNightDate(clockDate, timezone),
    bounds = useMemo(() => clockBounds(night, timezone), [night, timezone]);
  const samples = useMemo(
    () => clockSamples(chosen, lat, lon, night, timezone),
    [chosen, lat, lon, night, timezone],
  );
  const moonAt = useMemo(() => createMoonSampler(lat, lon), [lat, lon, night]);
  useEffect(() => setCursor(null), [+clockDate, lat, lon]);
  useEffect(() => {
    if (!running || !travelPreview || !travelEnd) return;
    const timer = window.setTimeout(() => {
      const next =
        travelStep === "hour"
          ? new Date(Math.min(+travelEnd, +travelPreview + 3600000))
          : new Date(Math.min(+travelEnd, +travelPreview + 86400000));
      setTravelPreview(next);
      if (+next >= +travelEnd) setRunning(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [running, travelStep, travelPreview ? +travelPreview : null, travelEnd ? +travelEnd : null]);
  const at = new Date(cursor ?? +clockDate),
    moon = moonAt(at),
    hour = clockHour(at, timezone);
  const observations = chosen.map((target) =>
    observationAt(target, lat, lon, at, skyBrightness, moonAt),
  );
  const events = useMemo(
    () => chosen.map((t) => clockTargetEvents(t, lat, lon, night, timezone)),
    [chosen, lat, lon, night, timezone],
  );
  const lunarEvents = useMemo(
    () => clockMoonEvents(lat, lon, night, timezone),
    [lat, lon, night, timezone],
  );
  const eventLabel = (at: Date | null) =>
    at
      ? `${formatInTimeZone(at, timezone, "HH:mm")}${formatInTimeZone(at, timezone, "yyyy-MM-dd") !== night ? " +1d" : ""}`
      : "—";
  const highlightedEvents =
    highlight === "moon"
      ? lunarEvents
      : events[chosen.findIndex((t) => t.id === highlight)];
  const add = (id: string) => {
    if (!ids.includes(id) && ids.length < CLOCK_LIMIT) onIds([...ids, id]);
  };
  const changeNight = (day: string) => {
    const time = formatInTimeZone(clockDate, timezone, "HH:mm"),
      civil = Number(time.slice(0, 2)) < 12 ? shiftClockDate(day, 1) : day;
    const next = resolveLocalMoment(civil, time, timezone);
    if (next) {
      setDisplayedTime(next);
      setTimeError("");
    } else
      setTimeError(
        "That local time is skipped by a clock change. Choose another time.",
      );
  };
  const setLocalTime = (time: string) => {
    const civil =
      Number(time.slice(0, 2)) < 12 ? shiftClockDate(night, 1) : night;
    const next = resolveLocalMoment(civil, time, timezone);
    if (next) {
      setDisplayedTime(next);
      setTimeError("");
    } else
      setTimeError(
        "That local time is skipped by a clock change. Choose another time.",
      );
  };
  const commitTime = (next: Date) => {
    setRunning(false);
    setTravelPreview(null);
    setTravelEnd(null);
    onTime(next);
  };
  const setDisplayedTime = (next: Date) => {
    setRunning(false);
    if (travelPreview) {
      setTravelPreview(next);
      setTravelEnd(clockBounds(clockNightDate(next, timezone), timezone).end);
    } else {
      onTime(next);
    }
  };
  const startTravel = () => {
    if (running) {
      setRunning(false);
      return;
    }
    const start = travelPreview ?? date;
    setLocked(false);
    setCursor(null);
    setTravelPreview(start);
    setTravelEnd(bounds.end);
    setRunning(true);
  };
  const request = useMemo<SeasonRequest>(
    () => ({
      targets: chosen.map(({ id, name, ra, dec }) => ({ id, name, ra, dec })),
      lat,
      lon,
      zone: timezone,
      from,
      to,
      minAlt,
      minSeparation,
      skyBrightness,
    }),
    [chosen, lat, lon, timezone, from, to, minAlt, minSeparation, skyBrightness],
  );
  useEffect(() => {
    setSeason(null);
    setProgress(0);
    setSeasonError("");
    if (!seasonOpen || !chosen.length) return;
    try {
      seasonDates(from, to);
    } catch (e) {
      setSeasonError((e as Error).message);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../lib/clock-season.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      setSeasonError(
        "The seasonal calculator could not start. Reload after the app is offline ready.",
      );
      return;
    }
    worker.onmessage = (event) => {
      if (event.data.value) {
        setSeason(event.data.value);
        setProgress(1);
      } else if (event.data.error) setSeasonError(event.data.error);
      else setProgress(event.data.progress);
    };
    worker.onerror = () =>
      setSeasonError(
        "The seasonal calculator could not load. Try reloading the app.",
      );
    worker.postMessage(request);
    return () => worker.terminate();
  }, [seasonOpen, request]);
  const pointer = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      x = ((event.clientX - rect.left) / rect.width) * 640 - 320,
      y = ((event.clientY - rect.top) / rect.height) * 640 - 320;
    const h =
      (((Math.atan2(y, x) + Math.PI / 2) / (2 * Math.PI)) * 24 + 24) % 24;
    const nearest = samples.reduce(
      (best, s) =>
        Math.min(Math.abs(s.hour - h), 24 - Math.abs(s.hour - h)) <
        Math.min(Math.abs(best.hour - h), 24 - Math.abs(best.hour - h))
          ? s
          : best,
      samples[0],
    );
    if (!locked) setCursor(nearest.ms);
    return nearest.ms;
  };
  const toggleTime = (ms: number) => {
    if (locked) { setLocked(false); setCursor(null); }
    else { setDisplayedTime(new Date(ms)); setCursor(null); setLocked(true); }
  };
  const keyboard = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") { setLocked(false); setCursor(null); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleTime(+at); return; }
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? +bounds.start
          : event.key === "End"
            ? +bounds.end - 60000
            : Math.max(
                +bounds.start,
                Math.min(
                  +bounds.end - 60000,
                  +at + (event.key === "ArrowRight" ? 1 : -1) * 10 * 60000,
                ),
              );
      setCursor(next);
      setDisplayedTime(new Date(next));
    }
  };
  const label = (at: Date) =>
    formatInTimeZone(at, timezone, "MMM d · HH:mm xxx");
  return (
    <div className="astro-workspace" data-testid="astronomical-clock">
      <header className="astro-heading">
        <div>
          <p className="eyebrow">FOLLOW YOUR OBJECTS THROUGH THE NIGHT</p>
          <ContextDateButton value={clockDate} timezone={timezone}/>
          <h1>
            Astronomical clock<span>.</span>
          </h1>
          <p>
            <ContextLocationButton>{locationName}</ContextLocationButton> · {timezone.replaceAll("_", " ")} · calculated on
            your device
          </p>
        </div>
        {locations.length > 0 && (
          <label>
            Observing location
            <select
              aria-label="Clock observing location"
              value={
                locations.find(
                  (l) =>
                    Math.abs(l.lat - lat) < 0.0001 &&
                    Math.abs(l.lon - lon) < 0.0001,
                )?.id ?? ""
              }
              onChange={(e) => {
                const site = locations.find((s) => s.id === e.target.value);
                if (site) onLocation(site.lat, site.lon);
              }}
            >
              <option value="">{locationName}</option>
              {locations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <section className="panel astro-timebar" aria-label="Clock time travel">
        <div className="astro-date-controls">
          <button
            className="icon-button"
            aria-label="Previous observing night"
            onClick={() => changeNight(shiftClockDate(night, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <label>
            Observing night
            <input
              type="date"
              aria-label="Clock observing date"
              value={night}
              onChange={(e) => {
                if (
                  e.target.value &&
                  resolveLocalMoment(e.target.value, "12:00", timezone)
                )
                  changeNight(e.target.value);
              }}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Next observing night"
            onClick={() => changeNight(shiftClockDate(night, 1))}
          >
            <ChevronRight size={18} />
          </button>
          <ContextDateButton value={clockDate} timezone={timezone} onChange={setDisplayedTime}>Calendar & time</ContextDateButton>
          <label>
            Local time
            <input
              type="time"
              aria-label="Clock local time"
              value={formatInTimeZone(clockDate, timezone, "HH:mm")}
              onChange={(e) => {
                if (e.target.value) setLocalTime(e.target.value);
              }}
            />
          </label>
          <Button
            variant="outline"
            onClick={() => {
              setRunning(false);
              setLocked(false);
              setCursor(null);
              setTravelPreview(null);
              setTravelEnd(null);
              onLive();
            }}
          >
            {live && !travelPreview ? "Now" : "Use current time"}
          </Button>
          <button
            className="text-action"
            aria-label={running ? "Pause time travel" : "Animate time travel"}
            onClick={startTravel}
          >
            {running ? <Pause size={15} /> : <Play size={15} />}{" "}
            {running ? "Pause" : "Travel"}
          </button>
          <select
            aria-label="Time travel animation step"
            value={travelStep}
            onChange={(e) => setTravelStep(e.target.value as "hour" | "night")}
          >
            <option value="hour">Hour by hour</option>
            <option value="night">Night by night</option>
          </select>
        </div>
        <div className="astro-scrubber">
          <span>Noon</span>
          <input
            type="range"
            aria-label="Travel through the observing night"
            min={+bounds.start}
            max={+bounds.end - 60000}
            step={60000}
            value={Math.max(
              +bounds.start,
              Math.min(+bounds.end - 60000, +clockDate),
            )}
            onChange={(e) => setDisplayedTime(new Date(Number(e.target.value)))}
          />
          <span>Noon +1d</span>
        </div>
        <p>
          {live && !travelPreview ? "Live sky" : "Time travel"} · {label(clockDate)} · noon {formatInTimeZone(resolveLocalMoment(night,"12:00",timezone)!,timezone,"MMM d")} →
          noon {formatInTimeZone(resolveLocalMoment(shiftClockDate(night,1),"12:00",timezone)!,timezone,"MMM d")}
          {+bounds.end - +bounds.start !== 86400000
            ? " · clock-change night"
            : ""}
        </p>
        {travelPreview && (
          <div className="astro-travel-preview" role="group" aria-label="Time travel preview">
            <span>Preview only · your saved plan has not changed.</span>
            <Button variant="outline" onClick={() => commitTime(travelPreview)}>Keep time</Button>
            <Button variant="ghost" onClick={() => { setRunning(false); setTravelPreview(null); setTravelEnd(null); setCursor(null); }}>Restore saved time</Button>
          </div>
        )}
        {timeError && <p role="alert">{timeError}</p>}
      </section>
      <section className="panel astro-objects" aria-label="Objects to compare">
        <div className="astro-object-tools">
          <CatalogCombobox
            className="astro-search flex-wrap"
            targets={targets}
            query={query}
            onQuery={setQuery}
            label="Find objects for the clock"
            placeholder="Add objects, stars, catalog numbers…"
            savedIds={new Set(ids)}
            onSelect={(target) => { add(target.id); setQuery(""); }}
          />
          {selectedId && (
            <button
              className="text-action"
              disabled={ids.includes(selectedId) || ids.length >= CLOCK_LIMIT}
              onClick={() => add(selectedId)}
            >
              Add{" "}
              {targets.find((target) => target.id === selectedId)?.name ??
                "selected object"}
            </button>
          )}
          <button
            className="text-action"
            disabled={
              !sessionIds.some((id) => targets.some((t) => t.id === id))
            }
            onClick={() =>
              onIds(
                Array.from(
                  new Set([
                    ...ids,
                    ...sessionIds.filter((id) =>
                      targets.some((t) => t.id === id),
                    ),
                  ]),
                ).slice(0, CLOCK_LIMIT),
              )
            }
          >
            Compare night’s objects
          </button>
          <span>
            {chosen.length}/{CLOCK_LIMIT}
          </span>
        </div>
        <p className="astro-note">Clock comparison · Add catalog objects or objects from this night to the comparison. This does not change the saved night’s target list.</p>
        <div className="astro-chips">
          {chosen.map((t, i) => (
            <span
              key={t.id}
              style={
                { "--object-color": CLOCK_COLORS[i] } as React.CSSProperties
              }
            >
              <button
                className={highlight === t.id ? "active" : ""}
                onClick={() => setHighlight(highlight === t.id ? null : t.id)}
                onPointerEnter={() => setHighlight(t.id)}
                onPointerLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(t.id)}
                onBlur={() => setHighlight(null)}
              >
                <i />
                {t.displayName || t.name}
              </button>
              <button
                aria-label={`Remove ${t.name} from comparison`}
                onClick={() => onIds(ids.filter((id) => id !== t.id))}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
        {!chosen.length && (
          <p className="astro-empty">
            Search to add up to eight objects, or bring in your selected object
            or observing session. The Moon and Sun are always included.
          </p>
        )}
        {ids.length >= CLOCK_LIMIT && (
          <p className="astro-note" role="status">
            Eight objects fit this view. Remove one to compare another.
          </p>
        )}
      </section>
      <div className="astro-main-grid">
        <section
          className="panel astro-dial-panel"
          aria-label="24 hour astronomical clock"
        >
          <div className="astro-dial-caption">
            <span>Midnight at top · noon at bottom</span>
            <button className="text-action astro-time-lock" aria-pressed={locked} onClick={()=>{if(locked){setLocked(false);setCursor(null);}else toggleTime(+at);}}>{locked?"Time locked · unlock":"Inspect by pointer or touch · tap to lock time"}</button>
          </div>
          <svg
            ref={dialRef}
            className="astro-dial"
            style={{ "--dial-text-scale": dialTextScale } as React.CSSProperties}
            viewBox="0 0 640 640"
            role="slider"
            aria-label="Astronomical clock time. Arrow keys move ten minutes; Home and End move to the observing night bounds."
            aria-valuemin={+bounds.start}
            aria-valuemax={+bounds.end - 60000}
            aria-valuenow={+at}
            aria-valuetext={label(at)}
            tabIndex={0}
            onPointerMove={pointer}
            onPointerLeave={() => { if (!locked) setCursor(null); }}
            onClick={(event) => {
              const ms = pointer(event);
              toggleTime(ms);
            }}
            onKeyDown={keyboard}
          >
            <title>
              24-hour object altitude clock for {formatInTimeZone(resolveLocalMoment(night,"12:00",timezone)!,timezone,"MMM d, yyyy")}, {locationName}. Center
              −90°, horizon ring 0°, outer ring 90°. All times local.
            </title>
            {samples.slice(0, -1).map((s, i) => {
              const b = samples[i + 1].hour;
              return (
                (b - s.hour + 24) % 24 < 0.4 && (
                  <path
                    key={s.ms}
                    d={wedge(
                      s.hour,
                      s.hour + ((b - s.hour + 24) % 24) + 0.005,
                      254,
                    )}
                    fill={solarColor(s.sun)}
                    opacity=".38"
                  />
                )
              );
            })}
            <circle cx="320" cy="320" r="127" fill="#060e16" fillOpacity=".9" />
            {[-60, -30, 0, 30, 60, 90].map((alt) => (
              <g key={alt}>
                <circle
                  cx="320"
                  cy="320"
                  r={((alt + 90) / 180) * 254}
                  fill="none"
                  stroke={alt === 0 ? "#b0c7c3" : "#8aa3b3"}
                  strokeOpacity={alt === 0 ? 0.75 : 0.23}
                  strokeWidth={alt === 0 ? 1.6 : 1}
                />
                <text
                  x={alt === 90 ? 20 : 325}
                  y={alt===90?35:320 - ((alt + 90) / 180) * 254 - 5}
                  className="astro-ring-label"
                >
                  {alt === 0 ? "0° · HORIZON" : `${alt}°`}
                </text>
              </g>
            ))}
            {Array.from({ length: 24 }, (_, h) => {
              const a = polar(h, 127),
                b = polar(h, 254),
                t = polar(h, 279);
              return (
                <g key={h}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#a4bcc7"
                    strokeOpacity={h % 6 === 0 ? 0.45 : 0.15}
                  />
                  <text
                    x={t.x}
                    y={t.y + 4}
                    textAnchor="middle"
                    className="astro-hour"
                  >
                    {h === 0 || h === 12 ? (
                      <>
                        <tspan>{String(h).padStart(2, "0")}</tspan>
                        <tspan className="astro-hour-long">
                          {h === 0 ? " · Midnight" : " · Noon"}
                        </tspan>
                      </>
                    ) : String(h).padStart(2, "0")}
                  </text>
                </g>
              );
            })}
            {season &&
              season.bins.map((row, i) =>
                row.map(
                  (fraction, b) =>
                    fraction > 0 && (
                      <path
                        key={`${i}-${b}`}
                        d={wedge(b / 2, b / 2 + 0.49, 312 - i * 2, 310 - i * 2)}
                        fill={CLOCK_COLORS[i]}
                        opacity={(0.12 + 0.88 * fraction) *
                          (highlight && highlight !== chosen[i]?.id ? 0.15 : 1)}
                      >
                        <title>
                          {chosen[i].name} ·{" "}
                          {String(Math.floor(b / 2)).padStart(2, "0")}:
                          {b % 2 ? "30" : "00"} · {Math.round(fraction * 100)}%
                          of sampled dates meet your limits
                        </title>
                      </path>
                    ),
                ),
              )}
            <path
              d={clockCurve(samples, (s) => s.sun)}
              fill="none"
              stroke="#d7a28b"
              strokeWidth="1.7"
              strokeDasharray="2 5"
            />
            <path
              d={clockCurve(samples, (s) => s.moon)}
              fill="none"
              stroke="var(--chart-silver, #aeb4be)"
              strokeWidth="1.7"
              strokeDasharray="10 3 2 3"
            />
            {chosen.map((t, i) => (
              <path
                key={t.id}
                d={clockCurve(samples, (s) => s.alt[i])}
                fill="none"
                stroke={CLOCK_COLORS[i]}
                strokeWidth={highlight === t.id ? 4 : 2.8}
                opacity={highlight && highlight !== t.id ? 0.3 : 1}
                tabIndex={0}
                role="img"
                aria-label={`${t.name} altitude path`}
                onPointerEnter={() => setHighlight(t.id)}
                onPointerLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(t.id)}
                onBlur={() => setHighlight(null)}
              />
            ))}
            {highlightedEvents &&
              (["rise", "transit", "set"] as const).map((key) => {
                const event = highlightedEvents[key];
                if (!event) return null;
                const h = clockHour(event, timezone),
                  a = polar(h, 127),
                  b = polar(h, 254),
                  t = polar(h, 238);
                return (
                  <g key={key}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#dfdccb"
                      strokeOpacity=".7"
                      strokeDasharray="2 4"
                    />
                    <text
                      x={t.x}
                      y={t.y}
                      textAnchor="middle"
                      className="astro-ring-label"
                    >
                      {key} {eventLabel(event)}
                    </text>
                  </g>
                );
              })}
            <line
              x1="320"
              y1="320"
              x2={polar(hour, 262).x}
              y2={polar(hour, 262).y}
              stroke={live && cursor === null ? "#e4e8e2" : "#efaa82"}
              strokeWidth="1.6"
            />
            {chosen.map((t, i) => {
              const p = clockPoint(hour, observations[i].alt);
              return (
                <circle
                  key={t.id}
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill={CLOCK_COLORS[i]}
                  stroke="#07111a"
                  strokeWidth="1.5"
                />
              );
            })}
            <circle
              cx={clockPoint(hour, moon.alt).x}
              cy={clockPoint(hour, moon.alt).y}
              r="4"
              fill="var(--chart-silver, #aeb4be)"
            />
            <circle cx="320" cy="320" r="3" fill="#d9c792" />
          </svg>
          <div className="astro-solar-legend">
            {[
              ["Day", "#83b2d3"],
              ["Civil", "#b99459"],
              ["Nautical", "#386e9e"],
              ["Astronomical", "#263e68"],
              ["Dark", "#101d30"],
            ].map(([name, color]) => (
              <span key={name}>
                <i style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
          <p className="astro-note">
            Radius shows altitude, not sky direction. Inside the horizon ring =
            below the horizon. Tap an object chip or the Moon to mark rise,
            transit and set. Twilight boundaries use Sun 0°, −6°, −12° and −18°;
            flat horizon, no terrain. Outer seasonal bands show the share of
            sampled dates when each object meets its altitude, darkness and Moon
            distance limits at that local half hour.
          </p>
        </section>
        <section
          className="panel astro-readout"
          aria-label="Compared objects at clock time"
        >
          <p className="eyebrow">
            {locked ? "LOCKED TIME" : cursor === null ? "CHOSEN TIME" : "CURSOR TIME"}
          </p>
          <h2>
            {formatInTimeZone(at, timezone, "HH:mm")}{" "}
            <small>{formatInTimeZone(at, timezone, "MMM d · xxx")}</small>
          </h2>
          <div className="astro-context">
            <button
              className="text-action"
              onClick={() => setHighlight(highlight === "moon" ? null : "moon")}
            >
              ☾ Moon <strong>{rounded(Math.abs(moon.alt))} {moon.alt<0?"below horizon":"high"}</strong> ·{" "}
              {Math.round(moon.illumination * 100)}% lit
            </button>
            <div className="astro-events">
              <span>
                Rise <b>{eventLabel(lunarEvents.rise)}</b>
              </span>
              <span>
                Transit <b>{eventLabel(lunarEvents.transit)}</b>
              </span>
              <span>
                Set <b>{eventLabel(lunarEvents.set)}</b>
              </span>
            </div>
            <span>
              ☀ Sun <strong>{rounded(moon.sunAlt)}</strong> ·{" "}
              {moon.sunAlt <= -18
                ? "Astronomical darkness"
                : moon.sunAlt < 0
                  ? "Twilight"
                  : "Daylight"}
            </span>
          </div>
          {chosen.map((t, i) => {
            const o = observations[i],
              e = events[i],
              time = eventLabel;
            return (
              <article
                key={t.id}
                className={highlight === t.id ? "active" : ""}
                style={
                  { "--object-color": CLOCK_COLORS[i] } as React.CSSProperties
                }
              >
                <button
                  onClick={() => setHighlight(highlight === t.id ? null : t.id)}
                  onPointerEnter={() => setHighlight(t.id)}
                  onPointerLeave={() => setHighlight(null)}
                  onFocus={() => setHighlight(t.id)}
                  onBlur={() => setHighlight(null)}
                >
                  <i />
                  {t.displayName || t.name}
                  <strong>{rounded(Math.abs(o.alt))} {o.alt<0?"below horizon":"high"}</strong>
                </button>
                <p>
                  {rounded(o.separation)} from Moon ·{" "}
                  {o.alt < 0
                    ? "Below horizon"
                    : o.moonlight > 0
                      ? `≈${o.moonlight.toFixed(1)} mag added sky glow`
                      : "No added Moon glow"}
                </p>
                <div className="astro-events">
                  <span>
                    Rise{" "}
                    <b>
                      {e.alwaysUp
                        ? "Always up"
                        : e.neverUp
                          ? "Never rises"
                          : time(e.rise)}
                    </b>
                  </span>
                  <span>
                    Transit <b>{time(e.transit)}</b>
                  </span>
                  <span>
                    Set{" "}
                    <b>
                      {e.alwaysUp
                        ? "Always up"
                        : e.neverUp
                          ? "Never rises"
                          : time(e.set)}
                    </b>
                  </span>
                </div>
              </article>
            );
          })}
          <p className="astro-note">
            Rise, transit and set cover this observing night, noon <ContextDateButton value={resolveLocalMoment(night,"12:00",timezone)!} timezone={timezone}>{formatInTimeZone(resolveLocalMoment(night,"12:00",timezone)!,timezone,"MMM d")}</ContextDateButton> to
            the following noon. +1d means after midnight. Moon glow is a
            clear-air estimate.
          </p>
        </section>
      </div>
      <ComparisonCharts
        samples={samples}
        targets={chosen}
        at={at}
        timezone={timezone}
        values={observations}
        onCursor={ms=>{if(!locked)setCursor(ms);}}
        onTime={at=>toggleTime(+at)}
        onAdjustTime={at=>{setLocked(true);setCursor(null);setDisplayedTime(at);}}
        locked={locked}
        onUnlock={()=>{setLocked(false);setCursor(null);}}
      />
      <section className="panel astro-season">
        <button
          className="astro-season-toggle"
          aria-expanded={seasonOpen}
          onClick={() => setSeasonOpen(!seasonOpen)}
        >
          <CalendarDays size={20} />
          <span>
            <strong>Across the seasons</strong>
            <small>
              Follow one object’s seasonal trajectories · compare observing
              hours
            </small>
          </span>
          <span>{seasonOpen ? "−" : "+"}</span>
        </button>
        {seasonOpen && (
          <div className="astro-season-body">
            <div className="astro-season-controls">
              <label>
                From
                <input
                  type="date"
                  aria-label="Season start date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  aria-label="Season end date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <button
                className="text-action"
                onClick={() => {
                  setFrom(`${night.slice(0, 4)}-01-01`);
                  setTo(`${night.slice(0, 4)}-12-31`);
                }}
              >
                Whole year
              </button>
            </div>
            {!chosen.length ? (
              <p>Add an object to calculate the interval.</p>
            ) : seasonError ? (
              <p role="alert">{seasonError}</p>
            ) : !season ? (
              <p role="status">
                Calculating {Math.round(progress * 100)}%… You can keep using
                the clock.
              </p>
            ) : (
              <>
                <SeasonTrajectoryClock
                  onTime={onTime}
                  objectId={seasonObject}
                  onObject={setSeasonObject}
                  scope={trajectoryScope}
                  onScope={setTrajectoryScope}
                  season={season}
                  targets={chosen}
                  samples={samples}
                  night={night}
                  lat={lat}
                  lon={lon}
                  timezone={timezone}
                  minAlt={minAlt}
                  minSeparation={minSeparation}
                  onNight={(day) => {
                    changeNight(day);
                    document
                      .querySelector(".astro-timebar")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
                <div className="season-hours-heading">
                  <h3>Observing hours & limits</h3>
                  <p className="astro-note">
                    Altitude limits apply to all hours metrics below. The Moon-distance cutoff applies to the strict metric, the outer bands
                    on the daily clock, and the seasonal clock’s “Meets
                    observing limits” filter.
                  </p>
                </div>
                <div className="astro-season-controls season-hours-controls">
                  <label>
                    Minimum altitude
                    <select
                      value={minAlt}
                      onChange={(e) => setMinAlt(Number(e.target.value))}
                    >
                      {[0, 15, 30, 40, 50, 60, 70].map((n) => (
                        <option key={n} value={n}>
                          {n}°
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Minimum Moon distance
                    <select
                      value={minSeparation}
                      onChange={(e) => setMinSeparation(Number(e.target.value))}
                    >
                      {[0, 30, 45, 60, 90, 120].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? "Any distance" : `${n}°`}
                        </option>
                      ))}
                    </select>
                  </label>{" "}
                </div>
                <p className="astro-note">
                  Every date, sampled each half hour. Requires Sun ≤ −18°,
                  object ≥ {minAlt}°, and Moon ≥ {minSeparation}° away when
                  above the horizon. A Moon below −1° passes the distance limit.
                  These are the strict limits; Moon-weighted contrast uses continuous sky glow instead of a distance cutoff. This is not a weather or visibility
                  guarantee. Moon phase is shown for each night.
                </p>
                <p className="astro-note">
                  Outer daily-clock bands show how often these limits are met at
                  each local half hour. Brighter daily tiles mean more
                  qualifying hours.
                </p>
                <SeasonChart timezone={timezone}
                  season={season}
                  targets={chosen}
                  night={night}
                  onNight={(day) => {
                    changeNight(day);
                    document
                      .querySelector(".astro-timebar")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
                <details className="astro-daily-details">
                  <summary>Daily tiles · choose a specific night</summary>
                  <div className="astro-season-results">
                    {chosen.map((t, i) => (
                      <div key={t.id} className="astro-season-row">
                        <strong style={{ color: CLOCK_COLORS[i] }}>
                          {t.displayName || t.name}
                        </strong>
                        <div className="astro-night-tiles">
                          {season.days.map((d) => (
                            <button
                              key={d.day}
                              aria-label={`${t.name}, ${formatInTimeZone(resolveLocalMoment(d.day,"12:00",timezone)!,timezone,"MMM d, yyyy")}: ${d.hours[i].toFixed(1)} qualifying hours, Moon ${Math.round(d.lit * 100)} percent lit`}
                              title={`${formatInTimeZone(resolveLocalMoment(d.day,"12:00",timezone)!,timezone,"MMM d, yyyy")} · ${d.hours[i].toFixed(1)} h · Moon ${Math.round(d.lit * 100)}% lit`}
                              onClick={() => {
                                changeNight(d.day);
                                document
                                  .querySelector(".astro-timebar")
                                  ?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start",
                                  });
                              }}
                              style={{
                                background: CLOCK_COLORS[i],
                                opacity:
                                  0.12 + 0.88 * Math.min(1, d.hours[i] / 12),
                                outline:
                                  d.day === night
                                    ? "2px solid #e8eddf"
                                    : undefined,
                              }}
                            >
                              {d.day.slice(8) === "01" ? d.day.slice(5, 7) : ""}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
                <p className="astro-note">
                  {formatInTimeZone(resolveLocalMoment(from,"12:00",timezone)!,timezone,"MMM d, yyyy")} → {formatInTimeZone(resolveLocalMoment(to,"12:00",timezone)!,timezone,"MMM d, yyyy")} · {season.days.length} nights · month numbers
                  mark the first of each month. Half-hour sampling makes totals
                  approximate; DST nights use their actual elapsed hours.
                </p>
              </>
            )}
          </div>
        )}
      </section>
      <details className="astro-explainer">
        <summary>About the clock & forecast sources</summary>
        <p>
          Inspired by Astrospheric’s 24-hour clock. This is StarHop’s own
          calculation and rendering using Astronomy Engine; no Astrospheric
          account or key is needed. Your comparison list is saved on this
          device. Calendar and seasonal calculations work offline once the app
          is ready.
        </p>
        <p>
          The cached stargazing weather report above uses Open-Meteo with ECMWF
          and GFS comparisons. It does not predict measured seeing or
          astronomical transparency. Astrospheric adds specialist North American
          seeing, transparency and smoke forecasts; its documented embed is a
          weather control, with no clock object/time API.
        </p>
        <a
          href={`https://www.astrospheric.com/?Latitude=${lat}&Longitude=${lon}&Loc=Forecast`}
          target="_blank"
          rel="noreferrer"
        >
          Compare this location in Astrospheric ↗
        </a>
      </details>
    </div>
  );
}
