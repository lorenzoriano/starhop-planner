import * as Astro from "astronomy-engine";
import { formatInTimeZone } from "date-fns-tz";
import { eqToHorizontal, type UnifiedTarget } from "./astronomy";
import { clockBounds, clockNightDate, shiftClockDate } from "./astronomical-clock";
import { moonState } from "./moon";
import { skylineWithMinimum, targetWindow, visibilityWindow } from "./target-visibility";
import { clearIntervals, horizonLookup, type HorizonInput } from "./horizon/profile";

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
  /** The instant moonIllumination and moonLabel describe (middle of the first dark segment). */
  moonAt: Date;
  moonLabel: string;
  moonFreeDarkHours: number;
  moonFreeWindows: { start: Date; end: Date }[];
  darkHours: number;
  darkWindows: { start: Date; end: Date }[];
  targets: UpcomingTargetResult[];
  feasibleTargetCount: number;
  selectedTarget: UpcomingTargetResult | null;
  geometryScore: number;
  chooseAt: Date;
}

export interface UpcomingNightsOptions {
  lat: number;
  lon: number;
  timezone: string;
  date: Date;
  days?: number;
  targets?: UnifiedTarget[];
  selected?: UnifiedTarget | null;
  /** The site's local horizon: target time then needs alt ≥ max(limit, skyline at the target's azimuth). Omitted or
   *  null keeps the flat-horizon results exactly. */
  horizon?: HorizonInput;
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

function targetHours(target: UnifiedTarget, lat: number, lon: number, segments: { start: Date; end: Date }[], horizon?: HorizonInput) {
  const skyline = horizonLookup(horizon);
  // Good time: high enough and, when a local horizon is known, clear of it (alt ≥ max(30°, skyline)).
  const good = (pos: { alt: number; az: number }) => pos.alt >= GOOD_TARGET_ALTITUDE && (!skyline || pos.alt >= skyline(pos.az));
  let goodMs = 0;
  let bestSampled: { at: Date; alt: number } | null = null;
  for (const segment of segments) {
    for (let at = +segment.start; at < +segment.end; at += SAMPLE_STEP) {
      const end = Math.min(at + SAMPLE_STEP, +segment.end);
      const midpoint = new Date((at + end) / 2);
      const pos = eqToHorizontal(target.ra, target.dec, lat, lon, midpoint);
      if (good(pos)) {
        goodMs += end - at;
        if (!bestSampled || pos.alt > bestSampled.alt) bestSampled = { at: midpoint, alt: pos.alt };
      }
    }
  }
  const window = segments.length
    ? targetWindow(target.ra, target.dec, lat, lon, { ok: true, start: segments[0].start, end: segments.at(-1)!.end, segments })
    : null;
  let bestAt = window && window.max >= GOOD_TARGET_ALTITUDE ? window.bestAt : null;
  // Behind the skyline at its highest: the highest sampled time that is clear instead.
  if (skyline && bestAt && !good(eqToHorizontal(target.ra, target.dec, lat, lon, bestAt))) bestAt = bestSampled?.at ?? null;
  return { id: target.id, name: target.name, goodAltitudeHours: goodMs / 3_600_000, bestAt };
}

export function upcomingNights(options: UpcomingNightsOptions): UpcomingNight[] {
  const { lat, lon, timezone, date, selected, horizon } = options;
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
    const targetResults = targets.map((target) => targetHours(target, lat, lon, moonFree, horizon));
    const feasibleTargetCount = targetResults.filter((target) => target.goodAltitudeHours >= 1).length;
    const selectedTarget = selected ? targetHours(selected, lat, lon, moonFree, horizon) : null;
    const chooseAt = selectedTarget?.bestAt
      ?? (moonFree.length ? new Date((+moonFree[0].start + +moonFree[0].end) / 2)
        : dark.length ? new Date((+dark[0].start + +dark[0].end) / 2) : bounds.start);
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
      moonAt: phaseAt,
      moonLabel: moon.phaseName,
      moonFreeDarkHours: moonFree.reduce((sum, s) => sum + (+s.end - +s.start) / 3_600_000, 0),
      moonFreeWindows: moonFree,
      darkWindows: dark,
      darkHours: dark.reduce((sum, s) => sum + (+s.end - +s.start) / 3_600_000, 0),
      targets: targetResults,
      feasibleTargetCount,
      selectedTarget,
      geometryScore,
      chooseAt,
    });
  }
  return nights;
}

export interface MoonFreeTargetWindow {
  date: string;
  start: Date;
  end: Date;
  moonPhase: number;
  moonIllumination: number;
  moonLabel: string;
  targetAltitude: number;
}

/** Search complete observing nights and intersect moon-free darkness with a real altitude threshold. With a local
 *  horizon the target must also clear the skyline (alt ≥ max(minAltitude, skyline)); hills can split one dark window
 *  into several. */
export function moonFreeTargetWindows({
  lat, lon, timezone, date, target, days = 30, minAltitude = 15, minDurationMinutes = 30, horizon,
}: UpcomingNightsOptions & { target: UnifiedTarget; minAltitude?: 15 | 30; minDurationMinutes?: number }): MoonFreeTargetWindow[] {
  const nights = upcomingNights({ lat, lon, timezone, date, days: Math.min(30, Math.max(1, days)) });
  const result: MoonFreeTargetWindow[] = [];
  const altitudeAt = (at: Date) => eqToHorizontal(target.ra, target.dec, lat, lon, at).alt;
  const crossing = (a: Date, b: Date, aAbove: boolean) => {
    let lo = +a, hi = +b;
    while (hi - lo > 1000) {
      const mid = (lo + hi) / 2;
      if ((altitudeAt(new Date(mid)) >= minAltitude) === aAbove) lo = mid;
      else hi = mid;
    }
    return new Date((lo + hi) / 2);
  };
  const skyline = skylineWithMinimum(horizon, minAltitude);
  const position = (t: number) => eqToHorizontal(target.ra, target.dec, lat, lon, new Date(t));
  for (const night of nights) {
    for (const dark of night.moonFreeWindows) {
      const window = { ok: true as const, start: dark.start, end: dark.end, segments: [dark] };
      const peak = targetWindow(target.ra, target.dec, lat, lon, window);
      if (peak.max < minAltitude) continue;
      let above: { start: Date; end: Date }[];
      if (skyline) {
        // Every disjoint span above max(minAltitude, skyline), refined to about a second.
        const count = Math.max(1, Math.ceil((+dark.end - +dark.start) / (5 * 60_000)));
        const samples = Array.from({ length: count + 1 }, (_, i) => {
          const t = +dark.start + (+dark.end - +dark.start) * i / count;
          return { t, ...position(t) };
        });
        above = clearIntervals(samples, skyline, { position, tolerance: 1000 }).map((span) => ({ start: new Date(span.start), end: new Date(span.end) }));
      } else {
        above = [{
          start: altitudeAt(dark.start) >= minAltitude ? dark.start : crossing(dark.start, peak.bestAt, false),
          end: altitudeAt(dark.end) >= minAltitude ? dark.end : crossing(peak.bestAt, dark.end, true),
        }];
      }
      for (const window of above) if (+window.end - +window.start >= minDurationMinutes * 60_000) result.push({
          date: night.date, ...window, moonPhase: night.moonPhase,
          moonIllumination: night.moonIllumination, moonLabel: night.moonLabel,
          targetAltitude: minAltitude,
        });
    }
  }
  return result;
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

/** Clip ongoing windows to the selected instant and reject expired/short tails. */
export function remainingMoonFreeWindows(windows:MoonFreeTargetWindow[],from:Date,minimumMinutes=30):MoonFreeTargetWindow[] {
  return windows.flatMap(window=>{
    const start=new Date(Math.max(+window.start,+from));
    return +window.end-+start>=minimumMinutes*60_000?[{...window,start}]:[];
  });
}

/** Choose the nearest usable window, not the highest-ranked night later in the month. */
export function nearestMoonFreeTargetTime(options:UpcomingNightsOptions&{target:UnifiedTarget;minAltitude?:15|30;minDurationMinutes?:number}):Date|null {
  const window=remainingMoonFreeWindows(moonFreeTargetWindows(options),options.date,options.minDurationMinutes??30)[0];
  if(!window)return null;
  const start=new Date(Math.max(+window.start,+options.date));
  const peak=targetWindow(options.target.ra,options.target.dec,options.lat,options.lon,{ok:true,start,end:window.end,segments:[{start,end:window.end}]});
  // Boundaries of darkness/altitude are exclusive in the action: leave a small margin.
  return new Date(Math.min(+window.end-1000,Math.max(+start+1000,+peak.bestAt)));
}
