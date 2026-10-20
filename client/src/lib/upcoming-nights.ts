import * as Astro from "astronomy-engine";
import { formatInTimeZone } from "date-fns-tz";
import { eqToHorizontal, type UnifiedTarget } from "./astronomy";
import { clockBounds, clockNightDate, shiftClockDate } from "./astronomical-clock";
import { moonState } from "./moon";
import { targetWindow, visibilityWindow } from "./target-visibility";

export const GOOD_TARGET_ALTITUDE = 30;
const SAMPLE_STEP = 15 * 60_000;
const phaseLabel = (phase: number) =>
  phase < 22.5 || phase >= 337.5 ? "New Moon"
    : phase < 67.5 ? "Waxing crescent"
      : phase < 112.5 ? "First quarter"
        : phase < 157.5 ? "Waxing gibbous"
          : phase < 202.5 ? "Full Moon"
            : phase < 247.5 ? "Waning gibbous"
              : phase < 292.5 ? "Last quarter" : "Waning crescent";

export interface UpcomingTargetResult {
  id: string;
  name: string;
  goodAltitudeHours: number;
  bestAt: Date | null;
}

export interface UpcomingNight {
  date: string;
  start: Date;
  end: Date;
  moonPhase: number;
  moonIllumination: number;
  moonLabel: string;
  moonFreeDarkHours: number;
  darkHours: number;
  targets: UpcomingTargetResult[];
  feasibleTargetCount: number;
  selectedTarget: UpcomingTargetResult | null;
  geometryScore: number;
}

export interface UpcomingNightsOptions {
  lat: number;
  lon: number;
  timezone: string;
  date: Date;
  days?: number;
  targets?: UnifiedTarget[];
  selected?: UnifiedTarget | null;
}

function moonFreeSegments(
  lat: number,
  lon: number,
  timezone: string,
  date: string,
  dark: { start: Date; end: Date }[],
) {
  if (!dark.length) return [] as { start: Date; end: Date }[];
  const { start, end } = clockBounds(date, timezone);
  const duration = (end.getTime() - start.getTime()) / 86_400_000;
  const observer = new Astro.Observer(lat, lon, 0);
  const events = ([-1, 1] as const)
    .map((direction) => Astro.SearchRiseSet(Astro.Body.Moon, observer, direction, start, duration)?.date)
    .filter((at): at is Date => Boolean(at && at > start && at < end));
  const result: { start: Date; end: Date }[] = [];
  for (const segment of dark) {
    const bounds = [segment.start, segment.end, ...events.filter((at) => at > segment.start && at < segment.end)]
      .sort((a, b) => a.getTime() - b.getTime());
    for (let i = 1; i < bounds.length; i++) {
      const a = bounds[i - 1], b = bounds[i];
      const midpoint = new Date((+a + +b) / 2);
      if (moonState(lat, lon, midpoint).alt < 0) result.push({ start: a, end: b });
    }
  }
  return result;
}

function targetHours(target: UnifiedTarget, lat: number, lon: number, segments: { start: Date; end: Date }[]) {
  let goodMs = 0;
  for (const segment of segments) {
    for (let at = +segment.start; at < +segment.end; at += SAMPLE_STEP) {
      const end = Math.min(at + SAMPLE_STEP, +segment.end);
      const midpoint = new Date((at + end) / 2);
      if (eqToHorizontal(target.ra, target.dec, lat, lon, midpoint).alt >= GOOD_TARGET_ALTITUDE) goodMs += end - at;
    }
  }
  const window = segments.length
    ? targetWindow(target.ra, target.dec, lat, lon, { ok: true, start: segments[0].start, end: segments.at(-1)!.end, segments })
    : null;
  return { id: target.id, name: target.name, goodAltitudeHours: goodMs / 3_600_000, bestAt: window && window.max >= GOOD_TARGET_ALTITUDE ? window.bestAt : null };
}

export function upcomingNights(options: UpcomingNightsOptions): UpcomingNight[] {
  const { lat, lon, timezone, date, selected } = options;
  const days = Math.max(1, Math.min(30, Math.floor(options.days ?? 7)));
  const targets = options.targets ?? [];
  const firstDate = clockNightDate(date, timezone);
  const nights: UpcomingNight[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = shiftClockDate(firstDate, offset);
    const bounds = clockBounds(day, timezone);
    const night = visibilityWindow(day, "12:00", "12:00", "night", timezone, lat, lon);
    const dark = night.ok ? night.segments : [];
    const moonFree = moonFreeSegments(lat, lon, timezone, day, dark);
    const phaseAt = dark.length
      ? new Date((+dark[0].start + +dark[0].end) / 2)
      : new Date((+bounds.start + +bounds.end) / 2);
    const moon = moonState(lat, lon, phaseAt);
    const phase = Astro.MoonPhase(phaseAt);
    const targetResults = targets.map((target) => targetHours(target, lat, lon, moonFree));
    const feasibleTargetCount = targetResults.filter((target) => target.goodAltitudeHours >= 1).length;
    const selectedTarget = selected ? targetHours(selected, lat, lon, moonFree) : null;
    // Geometric rank rewards moon-free darkness and the selected target's useful altitude.
    // Weather is intentionally not part of this score; unavailable weather stays unknown in the UI.
    const geometryScore = selectedTarget
      ? selectedTarget.goodAltitudeHours * 2 + moonFree.reduce((sum, s) => sum + (+s.end - +s.start) / 3_600_000, 0)
      : feasibleTargetCount * 2 + moonFree.reduce((sum, s) => sum + (+s.end - +s.start) / 3_600_000, 0);
    nights.push({
      date: day,
      start: bounds.start,
      end: bounds.end,
      moonPhase: phase,
      moonIllumination: moon.illumination,
      moonLabel: phaseLabel(phase),
      moonFreeDarkHours: moonFree.reduce((sum, s) => sum + (+s.end - +s.start) / 3_600_000, 0),
      darkHours: dark.reduce((sum, s) => sum + (+s.end - +s.start) / 3_600_000, 0),
      targets: targetResults,
      feasibleTargetCount,
      selectedTarget,
      geometryScore,
    });
  }
  return nights;
}

export function bestUpcomingNights(options: Omit<UpcomingNightsOptions, "days">): UpcomingNight[] {
  return upcomingNights({ ...options, days: 30 })
    .filter((night) => night.moonFreeDarkHours > 0 && (!options.selected || (night.selectedTarget?.goodAltitudeHours ?? 0) > 0))
    .sort((a, b) => b.geometryScore - a.geometryScore || a.date.localeCompare(b.date))
    .slice(0, 3);
}

export function upcomingNightDateLabel(night: UpcomingNight, timezone: string) {
  return formatInTimeZone(night.start, timezone, "EEE, MMM d");
}
