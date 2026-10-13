import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  eqToHorizontal,
  getConstellationName,
  type Star,
  type UnifiedTarget,
  type ConstellationLine,
} from "@/lib/astronomy";
import {
  altitudeSamples,
  compassLabel,
  type VisibleTarget,
} from "@/lib/observing";

export function ObjectArt({
  target,
  compact = false,
}: {
  target: UnifiedTarget;
  compact?: boolean;
}) {
  const type = target.categoryShort;
  const seed = target.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0);
  const stars = Array.from({ length: compact ? 30 : 65 }, (_, i) => ({
    x: (i * 73.13 + seed * 3.7) % 360,
    y: (i * 39.17 + seed * 1.3) % 220,
    r: i % 9 === 0 ? 1.4 : 0.65,
  }));
  return (
    <svg
      viewBox="0 0 360 220"
      className="object-art"
      role="img"
      aria-label={`Illustration of ${target.category.toLowerCase()}`}
    >
      <rect width="360" height="220" fill="#0a1721" />
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={i % 7 === 0 ? "#e1c299" : "#9ebac8"}
          opacity={0.3 + (i % 5) / 9}
        />
      ))}
      {type === "Galaxy" ? (
        <g transform="translate(180 110) rotate(-28)">
          {[76, 62, 48, 32, 18].map((r, i) => (
            <ellipse
              key={r}
              rx={r}
              ry={r * 0.34}
              fill={i < 3 ? "#91b9ba" : "#f5e3bb"}
              opacity={0.06 + i * 0.03}
            />
          ))}
          <ellipse rx="20" ry="9" fill="#e3d9bd" opacity=".24" />
          <ellipse rx="9" ry="4" fill="#f8e9c8" opacity=".5" />
          <path
            d="M-71 0Q-30-22 27-5T76 0M-65 7Q-12 22 26 8T66 4"
            stroke="#a9c9c9"
            strokeWidth="1.3"
            fill="none"
            opacity=".22"
          />
        </g>
      ) : type.includes("Neb") || type === "SNR" ? (
        <g>
          {[60, 47, 34, 22].map((r, i) => (
            <ellipse
              key={r}
              cx={180}
              cy={110}
              rx={r}
              ry={r * 0.66}
              fill={type === "Plan. Neb." ? "none" : "#82adba"}
              stroke="#82adba"
              strokeWidth={14 - i * 2}
              opacity={0.06 + i * 0.03}
              transform={`rotate(${i * 15} 180 110)`}
            />
          ))}
          <circle cx="183" cy="107" r="2" fill="#f7e5bd" />
        </g>
      ) : type === "Dbl Star" ? (
        <g>
          <circle cx="157" cy="105" r="17" fill="#edba74" opacity=".06" />
          <circle cx="199" cy="113" r="13" fill="#92c7f3" opacity=".08" />
          <circle cx="157" cy="105" r="3.6" fill="#f3ca82" />
          <circle cx="199" cy="113" r="2.5" fill="#b3d5f4" />
        </g>
      ) : (
        <g>
          {Array.from({ length: type === "Glob. Cl." ? 120 : 28 }, (_, i) => {
            const a = i * 2.39996,
              r = Math.sqrt(i / (type === "Glob. Cl." ? 120 : 28)) * 64;
            return (
              <g key={i}>
                <circle
                  cx={180 + Math.cos(a) * r * 1.2}
                  cy={110 + Math.sin(a) * r * 0.75}
                  r={i % 5 === 0 ? 5 : 2}
                  fill="#b0d4e8"
                  opacity=".08"
                />
                <circle
                  cx={180 + Math.cos(a) * r * 1.2}
                  cy={110 + Math.sin(a) * r * 0.75}
                  r={i % 5 === 0 ? 1.8 : 0.8}
                  fill={i % 7 === 0 ? "#ebcd98" : "#dce9f1"}
                  opacity=".8"
                />
              </g>
            );
          })}
        </g>
      )}
      {!compact && (
        <text x="18" y="204" fill="#6e8795" fontSize="9" letterSpacing="2">
          FIELD IMPRESSION · ILLUSTRATION
        </text>
      )}
    </svg>
  );
}

export function SkyOverview({
  stars,
  constellations,
  objects,
  lat,
  lon,
  date,
  selectedId,
  onSelect,
}: {
  stars: Star[];
  constellations: ConstellationLine[];
  objects: VisibleTarget[];
  lat: number;
  lon: number;
  date: Date;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const project = (ra: number, dec: number) => {
    const { alt, az } = eqToHorizontal(ra, dec, lat, lon, date);
    const r = ((90 - alt) / 90) * 181;
    return {
      x: 280 - Math.sin((az * Math.PI) / 180) * r,
      y: 222 - Math.cos((az * Math.PI) / 180) * r,
      alt,
    };
  };
  const positions = useMemo(
    () =>
      stars
        .filter((s) => s.mag <= 5.2)
        .map((s) => ({ ...s, ...project(s.ra, s.dec) }))
        .filter((s) => s.alt > 0),
    [stars, lat, lon, date],
  );
  const lines = useMemo(
    () =>
      constellations
        .flatMap((c) =>
          c.points.flatMap((line) =>
            line
              .slice(1)
              .map((p, i) => ({
                a: project(line[i][0], line[i][1]),
                b: project(p[0], p[1]),
              })),
          ),
        )
        .filter((l) => l.a.alt > 0 && l.b.alt > 0),
    [constellations, lat, lon, date],
  );
  const markers: VisibleTarget[] = [];
  const selected = objects.find((o) => o.target.id === selectedId);
  if (selected && selected.alt > 0) markers.push(selected);
  for (const object of objects) {
    if (
      object.alt <= 15 ||
      object.target.id === selectedId ||
      markers.length >= 7
    )
      continue;
    const point = project(object.target.ra, object.target.dec);
    if (
      markers.some((m) => {
        const p = project(m.target.ra, m.target.dec);
        return Math.hypot(point.x - p.x, point.y - p.y) < 48;
      })
    )
      continue;
    markers.push(object);
  }
  return (
    <svg
      className="sky-overview"
      viewBox="0 0 560 455"
      role="group"
      aria-label="Sky overhead for your selected location and time. North is up and east is left."
    >
      <defs>
        <radialGradient id="overview-bg">
          <stop stopColor="#142c37" stopOpacity=".7" />
          <stop offset="1" stopColor="#07131d" />
        </radialGradient>
      </defs>
      <circle
        cx="280"
        cy="222"
        r="181"
        fill="url(#overview-bg)"
        stroke="#2c414d"
      />
      {[60, 121, 181].map((r, i) => (
        <g key={r}>
          <circle
            cx="280"
            cy="222"
            r={r}
            fill="none"
            stroke="#506a78"
            strokeOpacity=".22"
            strokeDasharray={i === 2 ? undefined : "3 6"}
          />
          <text x={287} y={222 - r + 13} fill="#58727f" fontSize="9">
            {90 - (i + 1) * 30}°
          </text>
        </g>
      ))}
      <path d="M99 222H461M280 41V403" stroke="#506a78" strokeOpacity=".14" />
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.a.x}
          y1={l.a.y}
          x2={l.b.x}
          y2={l.b.y}
          stroke="#577c8f"
          strokeWidth=".7"
          opacity=".32"
        />
      ))}
      {positions.map((s) => (
        <circle
          key={s.id}
          cx={s.x}
          cy={s.y}
          r={Math.max(0.4, (6 - s.mag) * 0.37)}
          fill={s.mag < 2 ? "#e3ecee" : "#9bb7c4"}
          opacity={s.mag < 3 ? 0.85 : 0.5}
        >
          <title>{s.name || s.bayer || s.id}</title>
        </circle>
      ))}
      {markers.map((o) => {
        const p = project(o.target.ra, o.target.dec),
          active = o.target.id === selectedId;
        return (
          <g
            key={o.target.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${o.target.name}, ${Math.round(o.alt)} degrees ${compassLabel(o.az)}`}
            className="sky-marker"
            onClick={() => onSelect(o.target.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(o.target.id);
              }
            }}
          >
            <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
            <circle
              cx={p.x}
              cy={p.y}
              r={active ? 8 : 4}
              fill={active ? "#d9b978" : "#79bdb5"}
              fillOpacity={active ? 0.15 : 0.3}
              stroke={active ? "#e4c98b" : "#79bdb5"}
              strokeWidth="1"
            />
            {active && <circle cx={p.x} cy={p.y} r="2" fill="#e4c98b" />}
            <text
              x={p.x + 11}
              y={p.y + 3}
              fill={active ? "#e4c98b" : "#92b6bf"}
              fontSize="10"
              fontFamily="monospace"
            >
              {o.target.id.startsWith("M") || o.target.id.startsWith("NGC")
                ? o.target.id
                : o.target.name}
            </text>
          </g>
        );
      })}
      {[
        ["N", 280, 26],
        ["E", 80, 226],
        ["S", 280, 425],
        ["W", 482, 226],
      ].map(([label, x, y]) => (
        <text
          key={label}
          x={x}
          y={y}
          textAnchor="middle"
          fill="#99acb6"
          fontSize="11"
          letterSpacing="2"
        >
          {label}
        </text>
      ))}
      <text x="280" y="450" textAnchor="middle" fill="#657d8a" fontSize="10">
        LOOKING UP · TAP AN OBJECT TO EXPLORE
      </text>
    </svg>
  );
}

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
          Altitude over the next 8 hours
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
        aria-label={`Altitude forecast for ${target.name}. Shaded bands show astronomical darkness.`}
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
        Shaded = astronomical darkness · aim for 30° or higher
      </p>
    </div>
  );
}
