import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";
import type { UnifiedTarget } from "@/lib/astronomy";
import {
  CLOCK_COLORS,
  solarColor,
  type ClockSample,
  type ClockSeason,
} from "@/lib/astronomical-clock";
const rounded = (n: number) => `${Math.round(n)}°`;

export function ComparisonCharts({
  samples,
  targets,
  at,
  timezone,
  values,
  onCursor,
  onTime,
}: {
  samples: ClockSample[];
  targets: UnifiedTarget[];
  at: Date;
  timezone: string;
  values: { alt: number; separation: number }[];
  onCursor: (ms: number | null) => void;
  onTime: (at: Date) => void;
}) {
  const [span, setSpan] = useState<"night" | "day">("night");
  const dark = samples.filter((s) => s.sun <= -18 + 0.0001),
    start = span === "night" && dark.length ? dark[0].ms : samples[0].ms,
    end =
      span === "night" && dark.length
        ? dark[dark.length - 1].ms
        : samples[samples.length - 1].ms;
  const visible = samples.filter((s) => s.ms >= start && s.ms <= end),
    x = (ms: number) => 46 + ((ms - start) / (end - start || 1)) * 660;
  const point = (event: React.MouseEvent<SVGSVGElement>) => {
    const r = event.currentTarget.getBoundingClientRect(),
      fraction = Math.max(
        0,
        Math.min(1, (((event.clientX - r.left) / r.width) * 752 - 46) / 660),
      );
    return Math.round((start + (end - start) * fraction) / 60000) * 60000;
  };
  return (
    <section
      className="panel astro-comparison"
      aria-label="Multi-object observing charts"
    >
      <div className="astro-chart-heading">
        <h2>Compare the night</h2>
        <select
          aria-label="Comparison charts time span"
          value={span}
          onChange={(e) => setSpan(e.target.value as "night" | "day")}
        >
          <option value="night">Astronomical darkness</option>
          <option value="day">Noon to noon</option>
        </select>
      </div>
      <p className="astro-note">
        The same objects, colors and cursor as the clock. Hover to inspect; tap
        to set the app’s time. Object paths are solid colors; Moon altitude is
        dashed silver and Sun altitude is dotted gold.
      </p>
      {span === "night" && !dark.length ? (
        <p>
          No astronomical darkness on this observing night. Choose noon to noon.
        </p>
      ) : (
        <div className="astro-chart-grid">
          {["Altitude", "Moon distance"].map((name, kind) => {
            const y = (v: number) =>
                24 +
                (1 - (v - (kind === 0 ? -30 : 0)) / (kind === 0 ? 120 : 180)) *
                  160,
              path = (value: (s: ClockSample) => number) =>
                visible
                  .map(
                    (s, i) =>
                      `${i ? "L" : "M"}${x(s.ms)},${y(Math.max(kind === 0 ? -30 : 0, value(s)))}`,
                  )
                  .join(" "),
              min = kind === 0 ? -30 : 0,
              max = kind === 0 ? 90 : 180;
            return (
              <div key={name}>
                <h3>{name} · degrees</h3>
                <svg
                  viewBox="0 0 752 226"
                  role="slider"
                  tabIndex={0}
                  aria-label={`${name} for ${targets.map((t) => t.name).join(", ") || "Moon and Sun"}. Arrow keys move ten minutes.`}
                  aria-valuemin={start}
                  aria-valuemax={end}
                  aria-valuenow={Math.max(start, Math.min(end, +at))}
                  aria-valuetext={formatInTimeZone(
                    at,
                    timezone,
                    "MMM d HH:mm xxx",
                  )}
                  onPointerMove={(e) => onCursor(point(e))}
                  onPointerLeave={() => onCursor(null)}
                  onClick={(e) => onTime(new Date(point(e)))}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      onTime(
                        new Date(
                          Math.max(
                            start,
                            Math.min(
                              end,
                              +at + (e.key === "ArrowRight" ? 1 : -1) * 600000,
                            ),
                          ),
                        ),
                      );
                    }
                  }}
                >
                  {visible.slice(0, -1).map((s, i) => (
                    <rect
                      key={s.ms}
                      x={x(s.ms)}
                      y="24"
                      width={Math.max(0, x(visible[i + 1].ms) - x(s.ms) + 0.5)}
                      height="160"
                      fill={s.sun > -18 ? solarColor(s.sun) : "#d9b968"}
                      opacity={
                        s.sun > -18
                          ? 0.24
                          : s.moon > 0
                            ? 0.04 + 0.16 * s.lit
                            : 0
                      }
                    />
                  ))}
                  {[0, 1, 2, 3].map((n) => {
                    const v = min + ((max - min) * n) / 3;
                    return (
                      <g key={n}>
                        <line
                          x1="46"
                          x2="706"
                          y1={y(v)}
                          y2={y(v)}
                          stroke="#7692a3"
                          strokeOpacity=".3"
                          strokeDasharray="3 5"
                        />
                        <text x="36" y={y(v) + 4} textAnchor="end">
                          {v}°
                        </text>
                      </g>
                    );
                  })}
                  {kind === 0 && (
                    <>
                      <path
                        d={path((s) => s.moon)}
                        fill="none"
                        stroke="#c9cdd2"
                        strokeWidth="1.7"
                        strokeDasharray="7 4"
                      />
                      <path
                        d={path((s) => s.sun)}
                        fill="none"
                        stroke="#edc56e"
                        strokeDasharray="3 5"
                        strokeWidth="1.7"
                      />
                    </>
                  )}
                  {targets.map((t, i) => (
                    <path
                      key={t.id}
                      d={path((s) => (kind === 0 ? s.alt[i] : s.separation[i]))}
                      fill="none"
                      stroke={CLOCK_COLORS[i]}
                      strokeWidth="2.8"
                    />
                  ))}
                  {+at >= start && +at <= end && (
                    <line
                      x1={x(+at)}
                      x2={x(+at)}
                      y1="20"
                      y2="187"
                      stroke="#f1ddbd"
                      strokeDasharray="2 3"
                    />
                  )}
                  {[0, 0.5, 1].map((f) => (
                    <text
                      key={f}
                      x={46 + 660 * f}
                      y="211"
                      textAnchor={
                        f === 0 ? "start" : f === 1 ? "end" : "middle"
                      }
                    >
                      {formatInTimeZone(
                        new Date(start + (end - start) * f),
                        timezone,
                        "HH:mm · MMM d",
                      )}
                    </text>
                  ))}
                </svg>
              </div>
            );
          })}
        </div>
      )}
      <div className="astro-cursor-values" aria-live="off">
        <strong>{formatInTimeZone(at, timezone, "MMM d · HH:mm xxx")}</strong>
        {targets.map((t, i) => (
          <span key={t.id} style={{ color: CLOCK_COLORS[i] }}>
            {t.name} · {rounded(values[i].alt)} high ·{" "}
            {rounded(values[i].separation)} from Moon
          </span>
        ))}
      </div>
      <div className="astro-chart-legend">
        {targets.map((t, i) => (
          <span key={t.id}>
            <i style={{ background: CLOCK_COLORS[i] }} />
            {t.displayName || t.name}
          </span>
        ))}
        <span>
          <i style={{ background: "#c9cdd2" }} />
          Moon altitude · dashed
        </span>
        <span>
          <i style={{ background: "#edc56e" }} />
          Sun altitude
        </span>
      </div>
      <p className="astro-note">
        Below −30° is clipped in the altitude chart; use the dial for the full
        range. Gold shading during darkness follows Moon illumination only when
        the Moon is up; it is not an object-specific brightness estimate. Exact
        time, altitude and Moon distance appear in the readout above.
      </p>
    </section>
  );
}

/** Shared seasonal availability, with the same object colors as the clock. */
export function SeasonChart({
  season,
  targets,
  night,
  onNight,
}: {
  season: ClockSeason;
  targets: UnifiedTarget[];
  night: string;
  onNight: (day: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const index = Math.max(
      0,
      Math.min(
        season.days.length - 1,
        hover ?? season.days.findIndex((d) => d.day === night),
      ),
    ),
    day = season.days[index];
  const max = Math.max(12, ...season.days.flatMap((d) => d.hours)),
    x = (i: number) => 46 + (i / Math.max(1, season.days.length - 1)) * 660,
    y = (hours: number) => 175 - (hours / max) * 145;
  const monthTicks = season.days
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => i === 0 || d.day.slice(8) === "01");
  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        season.days.length - 1,
        Math.round(
          ((((e.clientX - r.left) / r.width) * 752 - 46) / 660) *
            (season.days.length - 1),
        ),
      ),
    );
  };
  return (
    <div className="astro-year-chart">
      <h3>Qualifying hours per observing night</h3>
      <svg
        viewBox="0 0 752 215"
        role="slider"
        aria-label="Seasonal object availability. Arrow keys choose a night; Enter opens it in the clock."
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={season.days.length - 1}
        aria-valuenow={index}
        aria-valuetext={`${day.day}: ${targets.map((t, i) => `${t.name} ${day.hours[i].toFixed(1)} hours`).join(", ")}`}
        onPointerMove={(e) => setHover(pick(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onNight(season.days[pick(e)].day)}
        onKeyDown={(e) => {
          if (
            ["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "Enter") onNight(day.day);
            else
              setHover(
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? season.days.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          season.days.length - 1,
                          index + (e.key === "ArrowRight" ? 1 : -1),
                        ),
                      ),
              );
          }
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="46"
              x2="706"
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="#486575"
              strokeDasharray="3 5"
            />
            <text x="36" y={y(max * f) + 4} textAnchor="end">
              {(max * f).toFixed(0)}h
            </text>
          </g>
        ))}
        {monthTicks.map(({ d, i }) => (
          <text
            key={d.day}
            x={x(i)}
            y="201"
            textAnchor={i === 0 ? "start" : "middle"}
          >
            {format(new Date(`${d.day}T12:00:00`), "MMM")}
          </text>
        ))}
        {targets.map((t, i) => (
          <path
            key={t.id}
            d={season.days
              .map((d, n) => `${n ? "L" : "M"}${x(n)},${y(d.hours[i])}`)
              .join(" ")}
            fill="none"
            stroke={CLOCK_COLORS[i]}
            strokeWidth="2"
          />
        ))}
        <line
          x1={x(index)}
          x2={x(index)}
          y1="24"
          y2="180"
          stroke="#d1d7c6"
          strokeDasharray="2 3"
        />
      </svg>
      <div className="astro-cursor-values">
        <strong>
          {day.day} · Moon {Math.round(day.lit * 100)}% lit
        </strong>
        {targets.map((t, i) => (
          <span key={t.id} style={{ color: CLOCK_COLORS[i] }}>
            {t.name} · {day.hours[i].toFixed(1)} h
          </span>
        ))}
      </div>
      <p className="astro-note">
        Hover or touch to inspect a date. Tap to open that night in the clock.
        Colors match the objects above.
      </p>
    </div>
  );
}
