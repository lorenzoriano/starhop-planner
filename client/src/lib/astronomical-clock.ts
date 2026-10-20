import type { SeasonTrajectory } from "./season-trajectories";
import * as Astro from "astronomy-engine";
import { formatInTimeZone } from "date-fns-tz";
import {
  angularDistance,
  eqToHorizontal,
  type UnifiedTarget,
} from "./astronomy";
import { moonState, scatteredMoonlight } from "./moon";
import { resolveLocalMoment } from "./session";
import { nextLocalDate, targetDayEvents } from "./target-visibility";

export const CLOCK_LIMIT = 8;
// Saturated object colors stay separate from neutral Moon and amber Sun.
export const CLOCK_COLORS = [
  "#53e352",
  "#ff59ce",
  "#ff792f",
  "#459bff",
  "#ff4b67",
  "#00c9b7",
  "#ac77ff",
  "#ead328",
];
export function comparisonIds(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (id): id is string =>
              typeof id === "string" && id.length > 0 && id.length < 120,
          ),
        ),
      ).slice(0, CLOCK_LIMIT)
    : [];
}
export function shiftClockDate(day: string, days: number) {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
export function clockNightDate(at: Date, zone: string) {
  const day = formatInTimeZone(at, zone, "yyyy-MM-dd");
  return Number(formatInTimeZone(at, zone, "H")) < 12
    ? shiftClockDate(day, -1)
    : day;
}
export function clockBounds(day: string, zone: string) {
  const start = resolveLocalMoment(day, "12:00", zone),
    end = resolveLocalMoment(nextLocalDate(day), "12:00", zone);
  if (!start || !end || end <= start)
    throw new Error("Choose a valid observing date.");
  return { start, end };
}
export function clockHour(at: Date, zone: string) {
  return (
    Number(formatInTimeZone(at, zone, "H")) +
    Number(formatInTimeZone(at, zone, "m")) / 60 +
    Number(formatInTimeZone(at, zone, "s")) / 3600
  );
}
/** Midnight at top, clockwise; radius is linear in altitude, −90° at center. */
export function clockPoint(hour: number, alt: number, radius = 254) {
  const angle = (hour / 12) * Math.PI - Math.PI / 2,
    r = Math.max(0, Math.min(1, (alt + 90) / 180)) * radius;
  return { x: 320 + Math.cos(angle) * r, y: 320 + Math.sin(angle) * r };
}
export const solarColor = (alt: number) =>
  alt >= 0
    ? "#83b2d3"
    : alt >= -6
      ? "#b99459"
      : alt >= -12
        ? "#386e9e"
        : alt >= -18
          ? "#263e68"
          : "#101d30";
export type ClockTarget = Pick<UnifiedTarget, "id" | "name" | "ra" | "dec">;
export type ClockSample = {
  ms: number;
  hour: number;
  sun: number;
  moon: number;
  lit: number;
  alt: number[];
  separation: number[];
};
export function clockSamples(
  targets: ClockTarget[],
  lat: number,
  lon: number,
  day: string,
  zone: string,
  stepMinutes = 10,
): ClockSample[] {
  const { start, end } = clockBounds(day, zone),
    count = Math.ceil((+end - +start) / (Math.max(1, stepMinutes) * 60000));
  const times = new Set(
    Array.from(
      { length: count + 1 },
      (_, i) => +start + ((+end - +start) * i) / count,
    ),
  );
  const observer = new Astro.Observer(lat, lon, 0),
    duration = (+end - +start) / 86400000;
  for (const altitude of [-18, -12, -6, 0])
    for (const direction of [-1, 1]) {
      const crossing = Astro.SearchAltitude(
        Astro.Body.Sun,
        observer,
        direction,
        start,
        duration,
        altitude,
      )?.date;
      if (crossing && crossing > start && crossing < end) times.add(+crossing);
    }
  for (const target of targets) {
    const events = clockTargetEvents(target, lat, lon, day, zone);
    for (const at of [events.rise, events.transit, events.set])
      if (at) times.add(+at);
  }
  return Array.from(times)
    .sort((a, b) => a - b)
    .map((ms) => {
      const at = new Date(ms),
        moon = moonState(lat, lon, at);
      return {
        ms,
        hour: clockHour(at, zone),
        sun: moon.sunAlt,
        moon: moon.alt,
        lit: moon.illumination,
        alt: targets.map((t) => eqToHorizontal(t.ra, t.dec, lat, lon, at).alt),
        separation: targets.map((t) =>
          angularDistance(t.ra, t.dec, moon.ra, moon.dec),
        ),
      };
    });
}
/** Avoid connecting across a DST wall-clock jump on the polar dial. */
export function clockCurve(
  samples: ClockSample[],
  alt: (s: ClockSample) => number,
) {
  return samples
    .map((s, i) => {
      const p = clockPoint(s.hour, alt(s));
      const previous = samples[i - 1];
      const delta = previous ? (s.hour - previous.hour + 24) % 24 : 0;
      return `${!i || delta > 0.4 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");
}
export type SeasonRequest = {
  targets: ClockTarget[];
  lat: number;
  lon: number;
  zone: string;
  from: string;
  to: string;
  minAlt: number;
  minSeparation: number;
  skyBrightness?: number;
};
export type SeasonDay = { day: string; hours: number[]; available: number[]; contrast: number[]; lit: number };
export type ClockSeason = {
  days: SeasonDay[];
  bins: number[][];
  trajectories: SeasonTrajectory[];
};
export function seasonDates(from: string, to: string) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(`${s}T12:00:00Z`)) &&
    new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
  if (
    !valid(from) ||
    !valid(to) ||
    to < from ||
    Date.parse(to) - Date.parse(from) > 365 * 86400000
  )
    throw new Error(
      "Choose an interval of 1–366 dates, with the end on or after the start.",
    );
  const dates = [];
  for (let day = from; day <= to; day = nextLocalDate(day)) dates.push(day);
  return dates;
}
export function seasonEligible(
  alt: number,
  sun: number,
  moonAlt: number,
  separation: number,
  minAlt: number,
  minSeparation: number,
) {
  return (
    sun <= -18 &&
    alt >= minAlt &&
    (moonAlt <= -1 || separation >= minSeparation)
  );
}
/** Half-hour midpoint integration, every date. Worker keeps annual calculations off the UI thread. */
export function clockSeason(
  request: SeasonRequest,
  progress?: (done: number, total: number) => void,
): ClockSeason {
  const { targets, lat, lon, zone, minAlt, minSeparation } = request,
    dates = seasonDates(request.from, request.to);
  const bins = targets.map(() => Array(48).fill(0)),
    totals = Array(48).fill(0),
    days: SeasonDay[] = [],
    trajectories: SeasonTrajectory[] = [];
  for (const day of dates) {
    const { start, end } = clockBounds(day, zone),
      hours = targets.map(() => 0), available = targets.map(() => 0), contrast = targets.map(() => 0);
    const track: SeasonTrajectory = {
      day,
      ms: [],
      hour: [],
      alt: targets.map(() => []),
      dark: [],
      qualified: targets.map(() => []),
    };
    let lit = 0,
      count = 0;
    for (let ms = +start + 15 * 60000; ms < +end; ms += 30 * 60000) {
      const at = new Date(ms),
        moon = moonState(lat, lon, at),
        hour = clockHour(at, zone),
        bin = Math.floor(hour * 2) % 48;
      totals[bin]++;
      lit += moon.illumination;
      count++;
      track.ms!.push(ms);
      track.hour.push(hour);
      track.dark.push(moon.sunAlt <= -18);
      targets.forEach((t, i) => {
        const alt = eqToHorizontal(t.ra, t.dec, lat, lon, at).alt;
        const separation = angularDistance(t.ra, t.dec, moon.ra, moon.dec);
        if (moon.sunAlt <= -18 && alt >= minAlt) {
          available[i] += .5;
          const glow = scatteredMoonlight(moon, alt, separation, request.skyBrightness ?? 21.6).brightening;
          // Relative diffuse-object contrast against the added sky background.
          contrast[i] += .5 * 10 ** (-.4 * glow);
        }
        const qualified = seasonEligible(
          alt,
          moon.sunAlt,
          moon.alt,
          angularDistance(t.ra, t.dec, moon.ra, moon.dec),
          minAlt,
          minSeparation,
        );
        track.alt[i].push(alt);
        track.qualified[i].push(qualified);
        if (qualified) {
          hours[i] += 0.5;
          bins[i][bin]++;
        }
      });
    }
    trajectories.push(track);
    days.push({ day, hours, available, contrast, lit: lit / Math.max(1, count) });
    progress?.(days.length, dates.length);
  }
  bins.forEach((row) =>
    row.forEach((value, i) => (row[i] = totals[i] ? value / totals[i] : 0)),
  );
  return { days, bins, trajectories };
}

/** Events in the displayed observing night, including events after midnight. */
export function clockTargetEvents(
  target: ClockTarget,
  lat: number,
  lon: number,
  day: string,
  zone: string,
) {
  const bounds = clockBounds(day, zone),
    first = targetDayEvents(
      target.ra,
      target.dec,
      lat,
      lon,
      bounds.start,
      zone,
    ),
    second = targetDayEvents(target.ra, target.dec, lat, lon, bounds.end, zone);
  const event = (key: "rise" | "transit" | "set") =>
    [first[key], second[key]].find(
      (at) => at && at >= bounds.start && at < bounds.end,
    ) ?? null;
  return {
    rise: event("rise"),
    transit: event("transit"),
    set: event("set"),
    alwaysUp: first.alwaysUp,
    neverUp: first.neverUp,
  };
}
export function clockMoonEvents(
  lat: number,
  lon: number,
  day: string,
  zone: string,
) {
  const { start, end } = clockBounds(day, zone),
    observer = new Astro.Observer(lat, lon, 0),
    days = (+end - +start) / 86400000;
  const transit = Astro.SearchHourAngle(Astro.Body.Moon, observer, 0, start)
    .time.date;
  return {
    rise:
      Astro.SearchRiseSet(Astro.Body.Moon, observer, 1, start, days)?.date ??
      null,
    set:
      Astro.SearchRiseSet(Astro.Body.Moon, observer, -1, start, days)?.date ??
      null,
    transit: transit < end ? transit : null,
  };
}
