import { resolveLocalMoment } from "@/lib/session";
import { ContextDateButton } from "./ObservingContext";
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
  locked,
  onUnlock,
  onAdjustTime,
}: {
  samples: ClockSample[];
  targets: UnifiedTarget[];
  at: Date;
  timezone: string;
  values: { alt: number; separation: number }[];
  onCursor: (ms: number | null) => void;
  onTime: (at: Date) => void;
  locked: boolean;
  onUnlock: () => void;
  onAdjustTime: (at: Date) => void;
}) {
  const [span, setSpan] = useState<"night" | "day">("night");
  const [highlight, setHighlight] = useState<string | null>(null);
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
        The same objects, colors and cursor as the clock. Hover to inspect; click
        to pin the displayed time; click again or press Escape to unlock. Object
        paths are solid colors; Moon altitude is dashed silver and Sun altitude
        is dotted gold. {locked && "Time is pinned; pointer movement will not change it."}
      </p>
      {span === "night" && !dark.length ? (
        <p>
          The Sun stays above −18° on this observing night, so there is no
          astronomical-darkness interval to plot. Choose noon to noon to inspect
          the Sun’s full path.
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
              ticks = kind === 0 ? [-30, 0, 30, 60, 90] : [0, 60, 120, 180],
              hourTicks = visible.filter((s) =>
                formatInTimeZone(new Date(s.ms), timezone, "mm") === "00",
              );
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
                  onPointerMove={(e) => { if (!locked) onCursor(point(e)); }}
                  onPointerLeave={() => { if (!locked) onCursor(null); }}
                  onClick={(e) => onTime(new Date(point(e)))}
                  onKeyDown={(e) => {
                    if(e.key === "Escape") { onUnlock(); return; }
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      onAdjustTime(
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
                      fill={s.sun > -18 ? solarColor(s.sun) : "#aaaaaa"}
                      opacity={
                        s.sun > -18
                          ? 0.24
                          : s.moon > 0
                            ? 0.04 + 0.16 * s.lit
                            : 0
                      }
                    />
                  ))}
                  {ticks.map((v) => {
                    return (
                      <g key={v}>
                        <line
                          x1="46"
                          x2="706"
                          y1={y(v)}
                          y2={y(v)}
                          stroke={kind === 0 && v === 0 ? "#d5e1d9" : "#7692a3"}
                          strokeOpacity={kind === 0 && v === 0 ? ".85" : ".3"}
                          strokeDasharray={kind === 0 && v === 0 ? undefined : "3 5"}
                          strokeWidth={kind === 0 && v === 0 ? "2" : "1"}
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
                        stroke="#adb1b8"
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
                      strokeWidth={highlight === t.id ? "4" : "2.8"}
                      opacity={highlight && highlight !== t.id ? ".25" : "1"}
                      tabIndex={0}
                      role="img"
                      aria-label={`${t.name} ${name.toLowerCase()} path`}
                      onPointerEnter={() => setHighlight(t.id)}
                      onPointerLeave={() => setHighlight(null)}
                      onFocus={() => setHighlight(t.id)}
                      onBlur={() => setHighlight(null)}
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
                  {[
                    { ms: start, label: `${span === "night" ? "Dusk" : "Start"} · ${formatInTimeZone(new Date(start), timezone, "HH:mm")}` },
                    ...hourTicks.filter((s) => s.ms > start && s.ms < end).map((s) => ({ ms: s.ms, label: formatInTimeZone(new Date(s.ms), timezone, "HH:mm") })),
                    { ms: end, label: `${span === "night" ? "Dawn" : "End"} · ${formatInTimeZone(new Date(end), timezone, "HH:mm")}` },
                  ].map(({ ms, label }, i, ticks) => (
                    <text
                      key={ms}
                      x={x(ms)}
                      y="211"
                      textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
                    >
                      {label}
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
          <button key={t.id} type="button" style={{ color: CLOCK_COLORS[i] }}
            onPointerEnter={() => setHighlight(t.id)} onPointerLeave={() => setHighlight(null)}
            onFocus={() => setHighlight(t.id)} onBlur={() => setHighlight(null)}>
            {t.name} · {rounded(values[i].alt)} high ·{" "}
            {rounded(values[i].separation)} from Moon
          </button>
        ))}
      </div>
      <div className="astro-chart-legend">
        {targets.map((t, i) => (
          <button key={t.id} type="button"
            onPointerEnter={() => setHighlight(t.id)} onPointerLeave={() => setHighlight(null)}
            onFocus={() => setHighlight(t.id)} onBlur={() => setHighlight(null)}>
            <i style={{ background: CLOCK_COLORS[i] }} />
            {t.displayName || t.name}
          </button>
        ))}
        <span>
          <i style={{ background: "#adb1b8" }} />
          Moon altitude · dashed
        </span>
        <span>
          <i style={{ background: "#edc56e" }} />
          Sun altitude
        </span>
      </div>
      <p className="astro-note">
        Altitudes below −30° are clipped, including the Sun when it is far below
        the plot range; the dial shows the full range. Gray shading during darkness follows Moon illumination only when
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
  timezone,
}: {
  season: ClockSeason;
  targets: UnifiedTarget[];
  night: string;
  onNight: (day: string) => void;
  timezone: string;
}) {
  const [metric, setMetric] = useState<"moonFree" | "available" | "contrast" | "hours">("moonFree");
  const [hover, setHover] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const selectedIndex = Math.max(0, season.days.findIndex((d) => d.day === night));
  const index = Math.max(0, Math.min(season.days.length - 1, hover ?? selectedIndex));
  const day = season.days[index];
  const max = Math.max(12, ...season.days.flatMap((d) => [...d.moonFree, ...d.available, ...d.hours])),
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
      <div className="astro-chart-heading"><h3>{metric === "moonFree" ? "Moon-free dark hours" : metric === 'contrast' ? 'Diffuse-contrast index' : metric === 'available' ? 'Dark hours above your altitude limit' : 'Hours meeting strict limits'}</h3><select aria-label="Seasonal hours metric" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}><option value="moonFree">Moon-free dark hours</option><optgroup label="Advanced metrics"><option value="available">Altitude and darkness only</option><option value="hours">Strict Moon-distance cutoff</option><option value="contrast">Diffuse-contrast index</option></optgroup></select></div>
      <p className="astro-note">{metric === "moonFree" ? "Estimated time in astronomical darkness when the Moon is below the horizon and the target is above your altitude limit. Integrated from half-hour samples; Moon-up time is excluded." : metric === 'contrast' ? 'For faint extended detail: 1 h under a sky twice as bright contributes 0.5 contrast-hours. Uses lunar phase, height and separation continuously. This index is not actual observing time.' : metric === 'available' ? 'Geometric time in astronomical darkness above the chosen altitude. Moonlight does not reduce this total.' : 'Colored solid lines show half-hour samples passing the hard Moon-distance cutoff. Gray dashed lines show altitude-and-darkness hours without that cutoff.'}</p>
      <svg
        viewBox="0 0 752 215"
        role="slider"
        aria-label="Seasonal object availability. Arrow keys choose a night; Enter opens it in the clock."
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={season.days.length - 1}
        aria-valuenow={index}
        aria-valuetext={`${hover === null ? "Chosen night" : `Hover date ${day.day}; chosen night ${season.days[selectedIndex].day}`}: ${targets.map((t, i) => `${t.name} ${day[metric][i].toFixed(1)} ${metric === "contrast" ? "contrast-hours" : "hours"}${metric === "hours" ? ` strict; ${day.available[i].toFixed(1)} altitude-and-darkness hours without the Moon cutoff` : ""}`).join(", ")}`}
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
        {metric === "hours" && targets.map((t, i) => (
          <path
            key={`geometric-${t.id}`}
            d={season.days
              .map((d, n) => `${n ? "L" : "M"}${x(n)},${y(d.available[i])}`)
              .join(" ")}
            fill="none"
            stroke="#aab6b7"
            strokeWidth="2"
            strokeDasharray="6 4"
            opacity=".9"
          />
        ))}
        {targets.map((t, i) => (
          <path
            key={t.id}
            d={season.days
              .map((d, n) => `${n ? "L" : "M"}${x(n)},${y(d[metric][i])}`)
              .join(" ")}
            fill="none"
            stroke={CLOCK_COLORS[i]}
            strokeWidth={highlight === t.id ? "4" : "2"}
            opacity={highlight && highlight !== t.id ? ".25" : "1"}
            tabIndex={0}
            role="img"
            aria-label={`${t.name} seasonal hours`}
            onPointerEnter={() => setHighlight(t.id)}
            onPointerLeave={() => setHighlight(null)}
            onFocus={() => setHighlight(t.id)}
            onBlur={() => setHighlight(null)}
          />
        ))}
        <line
          x1={x(selectedIndex)}
          x2={x(selectedIndex)}
          y1="24"
          y2="180"
          stroke="#d1d7c6"
          strokeWidth="2"
        />
        {hover !== null && hover !== selectedIndex && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1="24"
            y2="180"
            stroke="#edc56e"
            strokeDasharray="3 4"
          />
        )}
      </svg>
      <div className="astro-cursor-values">
        <strong>
          <span>{hover === null ? "Chosen night" : "Hover date"} · </span><ContextDateButton value={resolveLocalMoment(day.day,"20:00",timezone)!}>{day.day}</ContextDateButton> · Moon {Math.round(day.lit * 100)}% lit
        </strong>
        {targets.map((t, i) => (
          <button key={t.id} type="button" style={{ color: CLOCK_COLORS[i] }}
            onPointerEnter={() => setHighlight(t.id)} onPointerLeave={() => setHighlight(null)}
            onFocus={() => setHighlight(t.id)} onBlur={() => setHighlight(null)}>
            {t.name} · {day[metric][i].toFixed(1)} {metric === "contrast" ? "contrast-h" : "h"}
            {metric === "hours" && ` strict · ${day.available[i].toFixed(1)} h geometric`}
          </button>
        ))}
      </div>
      {metric === "hours" && <p className="astro-note">Gray dashed: altitude and darkness hours without the Moon-distance restriction. Colored solid: hours passing the strict Moon-distance cutoff. The difference is time excluded by that cutoff, not time below the horizon.</p>}
      <p className="astro-note">
        Hover or touch to inspect a date. Tap to open that night in the clock.
        Colors match the objects above.
      </p>
    </div>
  );
}
