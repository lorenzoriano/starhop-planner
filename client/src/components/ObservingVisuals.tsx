import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  type UnifiedTarget,
} from "@/lib/astronomy";
import {
  altitudeSamples,
  compassLabel,
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
      {type === "Star" ? (
        <g>
          {[36, 20, 10].map((r) => (
            <circle key={r} cx="180" cy="110" r={r} fill="#e8cc95" opacity={0.04} />
          ))}
          <circle cx="180" cy="110" r="3.5" fill="#e8cc95" />
        </g>
      ) : type === "Galaxy" ? (
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
