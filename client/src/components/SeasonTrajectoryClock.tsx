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
  MONTH_COLORS,
  densityOpacity,
  monthlyTrajectories,
  trajectoryCellDates,
  trajectoryDensity,
  trajectoryIncluded,
  trajectorySector,
  type SeasonTrajectory,
  type TrajectoryScope,
} from "@/lib/season-trajectories";

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
}: Props) {
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
  const dial = (mode: "months" | "density") => (
    <svg
      viewBox="0 0 640 640"
      role="slider"
      tabIndex={0}
      aria-label={`${mode === "months" ? "Month paths" : "Occupancy shading"}: seasonal altitude and time for ${target.name}. Left/right choose a half hour, up/down choose a five degree altitude band. Enter visits a matching date.`}
      aria-valuemin={0}
      aria-valuemax={TIME_BANDS * ALTITUDE_BANDS - 1}
      aria-valuenow={cell ? cell.time * 36 + cell.alt : 42 * 36 + 24}
      aria-valuetext={
        cell
          ? `${timeLabel(cell.time)}, ${cell.alt * 5 - 90} to ${cell.alt * 5 - 85} degrees, ${(density[cell.time][cell.alt] * 100).toFixed(1)} percent frequency`
          : "Choose an altitude and time to inspect recurrence."
      }
      onPointerMove={pointer}
      onPointerDown={pointer}
      onKeyDown={keyboard}
    >
      <title>
        {target.name}: seasonal trajectories from {season.days[0].day} through{" "}
        {season.days.at(-1)!.day}. Angle is local time; radius is altitude, not
        azimuth. Inner horizon ring is zero degrees.
      </title>
      <circle cx="320" cy="320" r="254" fill="#07131e" />
      {density.flatMap((row, time) =>
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
                  densityOpacity(fraction) * (mode === "months" ? 0.2 : 1)
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
      {cell && (
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
            Two clocks: seasonal timing and occupancy · no Moon or Sun curves
          </p>
        </div>
        <label>
          Object
          <select
            aria-label="Seasonal trajectory object"
            value={target.id}
            onChange={(e) => {
              onObject(e.target.value);
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
          Show times in both clocks
          <select
            aria-label="Seasonal trajectory time filter"
            value={scope}
            onChange={(e) => {
              onScope(e.target.value as TrajectoryScope);
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
            <p>
              One representative night near the 15th of each month. Select a
              label to isolate that path.
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
        <div className="season-clock-view" data-season-view="density">
          <h4>Occupancy · altitude × time</h4>
          <div className="season-trajectory-dial">{dial("density")}</div>
          <div className="season-trajectory-reading">
            <h4>How often is it here?</h4>
            <p>
              Brighter shading means more sampled dates put the object in that
              altitude band at that local time.
            </p>
            <div className="season-density-key">
              {[0, 0.01, 0.05, 0.2, 0.5, 1].map((f) => (
                <span key={f}>
                  <i
                    style={{ background: color, opacity: densityOpacity(f) }}
                  />
                  {f * 100}%
                </span>
              ))}
            </div>
            <label className="season-outline-toggle">
              <input
                type="checkbox"
                checked={showOutline}
                onChange={(event) => setShowOutline(event.target.checked)}
              />{" "}
              Show chosen night · {dateLabel(night)}
            </label>
            <p>Hover or touch the grid to find matching dates.</p>
          </div>
        </div>
      </div>
      {cell && (
        <div className="season-cell-reading">
          <strong>
            {timeLabel(cell.time)}–{timeLabel((cell.time + 1) % 48)} ·{" "}
            {cell.alt * 5 - 90}° to {cell.alt * 5 - 85}°
          </strong>
          <p>
            {(density[cell.time][cell.alt] * 100).toFixed(1)}% frequency ·{" "}
            {dates.length} matching dates
          </p>
          {dates.length > 0 ? (
            <>
              <p>
                Examples: {dateLabel(dates[0])}
                {dates.length > 1 ? ` · ${dateLabel(dates.at(-1)!)}` : ""}
              </p>
              <button className="text-action" onClick={() => onNight(dates[0])}>
                Open first matching night ↗
              </button>
            </>
          ) : (
            <p>No sampled dates in this cell with the current time filter.</p>
          )}
        </div>
      )}
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
