import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
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
