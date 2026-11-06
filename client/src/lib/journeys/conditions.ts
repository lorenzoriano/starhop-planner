/**
 * Sky Journeys S0: night context and per-object sky tracks (doc 05 §5.1, spec decision 4).
 *
 * Reuses the app's astronomy: `equatorialOfDate` (precession + nutation), the `eqToHorizontal` formula,
 * `moonState` + `scatteredMoonlight` (Krisciunas & Schaefer 1991) and `binocularAssessment`.
 *
 * Time model. All selection happens on a grid anchored at the start of the 15-minute slot that contains the
 * request instant, so two requests in the same slot choose the same journeys. Stop i is checked over the
 * covering interval [slot + i·m, slot + 15 min + (i+1)·m], which contains the displayed window
 * [instant + i·m, instant + (i+1)·m] for any instant in the slot. Checks are therefore conservative.
 */
import * as Astro from 'astronomy-engine';
import { angularDistance, type UnifiedTarget } from '../astronomy';
import { binocularAssessment, type BinocularProfile } from '../binocular-assessment';
import { equatorialOfDate } from '../fixed-equatorial';
import { horizonFingerprint, horizonLookup, type CompactHorizon } from '../horizon/profile';
import { moonState, type MoonState } from '../moon';
import { GLOW_LIMIT, GLOW_REFERENCE_SKY, MIN_ALT, moonGlow, moonIsUp, moonMinSeparation, moonVerdict, twilightLimit, type MoonCategory } from '../sky-feasibility';
import { SLOT_MS, slotStartMs } from './seed';
import type { Compass8, Darkness, DeepSkyClass, JourneyRequest, KbObject, NightContext } from './types';

const RAD = Math.PI / 180;
const MIN = 60_000;
export const MAX_STOPS = 10;
export const MIN_STOPS = 3;
/** Grid spacing inside a stop interval (minutes). */
export const GRID_STEP_MIN = 5;

// ───────────────────────────── hard-constraint constants (spec decision 4) ─────────────────────────────
// Altitude, twilight and Moon limits live in the shared sky model (lib/sky-feasibility.ts, rule "comfortable") and
// are re-exported here under the engine's historical names, so the engine and every tab read one set of numbers.

export const DEFAULT_MIN_ALT = MIN_ALT.comfortable;
export const FLOOR_MIN_ALT = MIN_ALT.journeyFloor;
/** Engine fallback never lowers the altitude floor below this (doc 05 §5.8). */
export const FALLBACK_MIN_ALT = MIN_ALT.journeyFallback;
export const DEFAULT_RADIUS = 30;
export const MAX_HOP_DEG = 20;
export const PATH_OVER_RADIUS = 2.5;
export const BACKTRACK_MIN_STRENGTH = 0.85;
export const MIN_EDGE_STRENGTH = 0.35;
/**
 * Duplicate-ish stops (doc 05 §5.2, tightened in the P4 evaluation): two stops closer than SAME_POINT_DEG are one
 * sight (double-star components, a star at the heart of its own small cluster) and never both count; closer than
 * SAME_VIEW_DEG they share one binocular view and need a curated comparison edge (StoryGraph.pairOk).
 */
export const SAME_POINT_DEG = 0.1;
export const SAME_VIEW_DEG = 1.0;
/**
 * Colour archetypes (teffK progression) only use stars at least this bright: fainter stars show little or no
 * colour in 50 mm binoculars (engine calibration, P4 evaluation; not a published threshold).
 */
export const STAR_COLOR_MAG = 6.0;
/** Sun altitude limits ("comfortable" rule): stars allow nautical twilight; deep-sky objects need astronomical night. */
export const SUN_LIMIT_STAR = twilightLimit({ stellar: true, mag: null }, 'comfortable');
export const SUN_LIMIT_DSO = twilightLimit({ stellar: false, mag: null }, 'comfortable');
export { GLOW_LIMIT, GLOW_REFERENCE_SKY, moonGlow, moonMinSeparation, moonVerdict };

const DIFFUSE: ReadonlySet<DeepSkyClass> = new Set<DeepSkyClass>([
  'hii-region', 'reflection-nebula', 'dark-nebula', 'nebula-complex', 'planetary-nebula', 'supernova-remnant',
  'wind-bubble', 'galaxy-spiral', 'galaxy-barred-spiral', 'galaxy-lenticular', 'galaxy-elliptical',
  'galaxy-dwarf-elliptical', 'galaxy-irregular', 'milky-way-field', 'star-cloud',
]);
/** Classes whose angular extent is meant to be swept, not framed. */
const WIDE_OK: ReadonlySet<DeepSkyClass> = new Set<DeepSkyClass>(['asterism', 'ob-association', 'moving-group', 'milky-way-field', 'star-cloud']);

export type { MoonCategory };
export function moonCategory(o: KbObject): MoonCategory {
  if (o.kind === 'star') return 'star';
  return DIFFUSE.has(o.dsoClass) ? 'diffuse' : 'cluster';
}
export const glowLimitFor = (o: KbObject) => GLOW_LIMIT[moonCategory(o)];
export const sunLimitFor = (o: KbObject) => twilightLimit({ stellar: o.kind === 'star', mag: o.mag }, 'comfortable');

/** Major axis in arcmin (extent, else the angularSizeArcmin fact), or null. */
export function majorArcmin(o: KbObject): number | null {
  if (o.kind === 'dso' && o.extent) return o.extent.majorArcmin;
  return o.facts.angularSizeArcmin?.value ?? null;
}
/** Angular extent ≤ 3 fields unless the object is meant to be swept (doc 05 §5.2). */
export function extentOk(o: KbObject, fovDeg: number): boolean {
  if (o.kind === 'star') return true;
  if (WIDE_OK.has(o.dsoClass)) return true;
  const m = majorArcmin(o);
  return m === null || m <= 3 * fovDeg * 60;
}

// ───────────────────────────── request normalisation ─────────────────────────────

export interface EngineSettings {
  instantMs: number;
  slotMs: number;
  /** Computation site, rounded to 0.01° (≈1 km) so GPS jitter cannot change the result. */
  lat: number;
  lon: number;
  fovDeg: number;
  aperture: number;
  magnification: number;
  stabilized: boolean;
  sky: number;
  minAlt: number;
  radius: number;
  length: number;
  minutesPerStop: number;
  level: 'first-night' | 'curious' | 'keen';
  includeChallenge: boolean;
  openDirections: ReadonlySet<Compass8> | null;
  theme: string | null;
  limit: number;
  shuffle: number;
  /** seenObjectIds ∪ observedIds (KB ids). */
  seen: ReadonlySet<string>;
  /** Tonight's Best boost (JourneyRequest.boostIds); empty = no effect. */
  boost: ReadonlySet<string>;
  /** Stops to include when feasible (JourneyRequest.mustInclude); empty = no effect. */
  must: ReadonlySet<string>;
  timezone: string | null;
  maxHop: number;
  maxPath: number;
  /** The site's skyline (JourneyRequest.horizon, geometric-equivalent thresholds), or null for a flat horizon. */
  horizon: CompactHorizon | null;
  /** horizonFingerprint(horizon) ('flat' without one): the skyline's part of the candidate-table cache key. */
  horizonKey: string;
  /** Skyline threshold lookup (azimuth → geometric altitude to clear it), built once per request; null = flat. */
  skyline: ((azDeg: number) => number) | null;
  /** Highest skyline threshold (−90 when flat). When it is ≤ minAlt the skyline can never bind: the analytic paths stay. */
  skylineMax: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** KB id of a request id: Planner session ids `star:HR<n>` name the KB's `HR<n>` (object-links toKbId does the rest). */
export const requestKbId = (id: string) => (id.startsWith('star:') ? id.slice(5) : id);
function idSet(...lists: (readonly string[] | undefined)[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const list of lists) for (const id of list ?? []) out.add(requestKbId(id));
  return out;
}

export function normalizeRequest(req: JourneyRequest): EngineSettings {
  const instantMs = Date.parse(req.instant);
  if (!Number.isFinite(instantMs)) throw new Error(`Invalid journey instant "${req.instant}"`);
  const radius = clamp(req.regionRadius ?? DEFAULT_RADIUS, 20, 40);
  const level = req.level ?? 'curious';
  const dirs = req.openDirections && req.openDirections.length > 0 && req.openDirections.length < 8 ? new Set(req.openDirections) : null;
  const skyline = horizonLookup(req.horizon ?? null);
  const horizon = skyline ? req.horizon! : null;
  return {
    instantMs,
    slotMs: slotStartMs(instantMs),
    lat: Math.round(req.lat * 100) / 100,
    lon: Math.round(req.lon * 100) / 100,
    fovDeg: req.instrument.fovDeg,
    aperture: req.instrument.aperture,
    magnification: req.instrument.magnification,
    stabilized: !!req.instrument.stabilized,
    sky: req.skyBrightness,
    minAlt: clamp(req.minAlt ?? DEFAULT_MIN_ALT, FLOOR_MIN_ALT, 60),
    radius,
    length: Math.round(clamp(req.length ?? 5, MIN_STOPS, MAX_STOPS)),
    minutesPerStop: clamp(req.minutesPerStop ?? 8, 3, 30),
    level,
    includeChallenge: req.includeChallenge ?? level !== 'first-night',
    openDirections: dirs,
    theme: req.theme ?? null,
    limit: Math.max(1, Math.min(12, req.limit ?? 3)),
    shuffle: Math.max(0, Math.floor(req.shuffle ?? 0)),
    seen: idSet(req.seenObjectIds, req.observedIds),
    boost: idSet(req.boostIds),
    must: idSet(req.mustInclude),
    timezone: req.timezone ?? null,
    maxHop: Math.min(MAX_HOP_DEG, 0.75 * radius),
    maxPath: PATH_OVER_RADIUS * radius,
    horizon,
    horizonKey: horizonFingerprint(horizon),
    skyline,
    skylineMax: horizon ? Math.max(...horizon.alt) : -90,
  };
}

/** Altitude a target must reach at azimuth `az` under settings `s`: max(minAlt, skyline(az)). */
export function clearAltitude(s: Pick<EngineSettings, 'minAlt' | 'skyline' | 'skylineMax'>, az: number): number {
  return s.skyline && s.skylineMax > s.minAlt ? Math.max(s.minAlt, s.skyline(az)) : s.minAlt;
}

// ───────────────────────────── the time grid ─────────────────────────────

export interface StopInterval {
  /** Covering interval used for feasibility (ms). */
  startMs: number;
  endMs: number;
  /** Indices into NightGrid.times inside [startMs, endMs] (endpoints included). */
  samples: number[];
}

export interface NightGrid {
  times: number[];
  /** Greenwich apparent sidereal time per sample (degrees). */
  gastDeg: number[];
  sunAlt: number[];
  moon: MoonState[];
  moonUp: boolean[];
  /** intervals[i] = covering interval of stop index i (0..MAX_STOPS-1). */
  intervals: StopInterval[];
  /** Sample nearest the middle of a default-length journey (patch scoring, labels). */
  midIndex: number;
}

export { moonIsUp };

/** Brightest Moon illumination while it is up during the first `stops` stop intervals (0 = down throughout). */
export function moonDuring(grid: NightGrid, stops: number): number {
  let best = 0;
  for (const iv of grid.intervals.slice(0, Math.max(1, stops))) {
    for (const k of iv.samples) if (grid.moonUp[k]) best = Math.max(best, grid.moon[k].illumination);
  }
  return best;
}

export function buildNightGrid(s: EngineSettings): NightGrid {
  const m = s.minutesPerStop * MIN;
  const bounds: [number, number][] = [];
  for (let i = 0; i < MAX_STOPS; i++) bounds.push([s.slotMs + i * m, s.slotMs + SLOT_MS + (i + 1) * m]);
  const end = bounds[MAX_STOPS - 1][1];
  const set = new Set<number>();
  for (let t = s.slotMs; t <= end; t += GRID_STEP_MIN * MIN) set.add(t);
  for (const [a, b] of bounds) { set.add(a); set.add(b); }
  const times = Array.from(set).sort((a, b) => a - b);
  const gastDeg = times.map((t) => Astro.SiderealTime(new Date(t)) * 15);
  const moon = times.map((t) => moonState(s.lat, s.lon, new Date(t)));
  const intervals = bounds.map(([a, b]) => ({
    startMs: a,
    endMs: b,
    samples: times.map((t, k) => (t >= a && t <= b ? k : -1)).filter((k) => k >= 0),
  }));
  const midT = s.slotMs + (s.length * m) / 2;
  let midIndex = 0;
  times.forEach((t, k) => { if (Math.abs(t - midT) < Math.abs(times[midIndex] - midT)) midIndex = k; });
  return { times, gastDeg, sunAlt: moon.map((x) => x.sunAlt), moon, moonUp: moon.map(moonIsUp), intervals, midIndex };
}

// ───────────────────────────── fast alt/az ─────────────────────────────

/** Same spherical formula as `eqToHorizontal`, with the of-date position and GAST precomputed. */
export function fastAltAz(raDate: number, decDate: number, lat: number, lon: number, gastDeg: number): { alt: number; az: number } {
  let ha = gastDeg + lon - raDate;
  ha = ((ha + 180) % 360 + 360) % 360 - 180;
  const h = ha * RAD, d = decDate * RAD, p = lat * RAD;
  const sinAlt = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAz = (Math.sin(d) - Math.sin(alt) * Math.sin(p)) / (Math.cos(alt) * Math.cos(p) || 1e-12);
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD;
  if (Math.sin(h) > 0) az = 360 - az;
  return { alt: alt / RAD, az };
}

/** Hour angle (degrees, −180..180). */
export function hourAngle(raDate: number, lon: number, gastDeg: number): number {
  const ha = gastDeg + lon - raDate;
  return ((ha + 180) % 360 + 360) % 360 - 180;
}

/** Altitude at lower culmination (HA = 180°). */
export function lowerCulminationAlt(decDate: number, lat: number): number {
  const d = decDate * RAD, p = lat * RAD;
  return Math.asin(Math.max(-1, Math.min(1, Math.sin(d) * Math.sin(p) - Math.cos(d) * Math.cos(p)))) / RAD;
}

const SIDEREAL_DEG_PER_MIN = 360 / 1436.0682;

/** Minutes the object stays at or above `minAlt` from the given hour angle (capped at 720; 0 if below now). */
export function minutesAboveAlt(decDate: number, lat: number, haDeg: number, minAlt: number): number {
  const d = decDate * RAD, p = lat * RAD;
  const denom = Math.cos(p) * Math.cos(d);
  const sinAlt = Math.sin(d) * Math.sin(p) + denom * Math.cos(haDeg * RAD);
  if (Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD < minAlt) return 0;
  if (Math.abs(denom) < 1e-9) return 720;
  const cosH = (Math.sin(minAlt * RAD) - Math.sin(d) * Math.sin(p)) / denom;
  if (cosH <= -1) return 720;
  if (cosH >= 1) return 0;
  const h0 = Math.acos(cosH) / RAD;
  return Math.min(720, Math.max(0, (h0 - haDeg) / SIDEREAL_DEG_PER_MIN));
}

/** Sampling step of `minutesClear` against a skyline (minutes). */
export const SKYLINE_STEP_MIN = 5;

/**
 * Minutes the object stays at or above minAlt AND clear of the local skyline from the given sidereal time (capped at
 * 720; 0 when it is low or hidden now). Without a skyline that can bind (none, or never higher than minAlt) this is
 * exactly the analytic `minutesAboveAlt`. Otherwise the track is sampled every SKYLINE_STEP_MIN minutes up to the
 * analytic answer (the skyline can only shorten it) and the first crossing is interpolated linearly.
 */
export function minutesClear(raDate: number, decDate: number, s: Pick<EngineSettings, 'lat' | 'lon' | 'minAlt' | 'skyline' | 'skylineMax'>, gastDeg: number): number {
  const analytic = minutesAboveAlt(decDate, s.lat, hourAngle(raDate, s.lon, gastDeg), s.minAlt);
  if (analytic <= 0 || !s.skyline || s.skylineMax <= s.minAlt) return analytic;
  const clearance = (min: number) => {
    const h = fastAltAz(raDate, decDate, s.lat, s.lon, gastDeg + min * SIDEREAL_DEG_PER_MIN);
    return h.alt - clearAltitude(s, h.az);
  };
  let prevT = 0, prev = clearance(0);
  if (prev < 0) return 0;
  // The last step ends exactly at the analytic answer, where the object meets minAlt (a skyline above it is crossed first).
  for (let t = Math.min(SKYLINE_STEP_MIN, analytic); ; t = Math.min(t + SKYLINE_STEP_MIN, analytic)) {
    const c = clearance(t);
    if (c < 0) return prevT + ((t - prevT) * prev) / (prev - c);
    if (t >= analytic) return analytic;
    prevT = t;
    prev = c;
  }
}

/** Per-object sky track over the grid. */
export interface ObjectTrack {
  raDate: number;
  decDate: number;
  alt: Float64Array;
  az: Float64Array;
  /** Skyline threshold at the object's azimuth per sample; absent when no skyline can bind (flat, or never above minAlt). */
  skyline?: Float64Array;
  /** Moon separation per sample (180 when the Moon is down). */
  moonSep: Float64Array;
  /** K–S brightening (mag) per sample (0 when the Moon is down). */
  glow: Float64Array;
}

export function trackObject(o: KbObject, s: EngineSettings, grid: NightGrid, dateOf: { raDec: (ra: number, dec: number) => { ra: number; dec: number } }): ObjectTrack {
  const { ra: raDate, dec: decDate } = dateOf.raDec(o.ra, o.dec);
  const n = grid.times.length;
  const alt = new Float64Array(n), az = new Float64Array(n), moonSep = new Float64Array(n), glow = new Float64Array(n);
  // The skyline is only sampled when it can bind (somewhere higher than the altitude floor); otherwise it changes nothing.
  const sky = s.skyline && s.skylineMax > s.minAlt ? s.skyline : null;
  const skyline = sky ? new Float64Array(n) : undefined;
  for (let k = 0; k < n; k++) {
    const h = fastAltAz(raDate, decDate, s.lat, s.lon, grid.gastDeg[k]);
    alt[k] = h.alt; az[k] = h.az;
    if (skyline) skyline[k] = sky!(h.az);
    if (grid.moonUp[k]) {
      const m = grid.moon[k];
      const sep = angularDistance(o.ra, o.dec, m.ra, m.dec);
      moonSep[k] = sep;
      glow[k] = moonGlow(m, h.alt, sep, s.sky);
    } else {
      moonSep[k] = 180;
      glow[k] = 0;
    }
  }
  return { raDate, decDate, alt, az, moonSep, glow, ...(skyline ? { skyline } : {}) };
}

/** Of-date conversion with one rotation date for all objects (the fixed-equatorial cache holds one date). */
export function ofDateConverter(atMs: number) {
  const at = new Date(atMs);
  return { raDec: (ra: number, dec: number) => equatorialOfDate(ra, dec, at) };
}

// ───────────────────────────── binocular rating ─────────────────────────────

const DSO_CATEGORY: Record<DeepSkyClass, string> = {
  'hii-region': 'Emission Nebula', 'reflection-nebula': 'Reflection Nebula', 'dark-nebula': 'Dark Nebula',
  'nebula-complex': 'Nebula Complex', 'embedded-cluster': 'Open Cluster', 'open-cluster': 'Open Cluster',
  'ob-association': 'Asterism', 'moving-group': 'Asterism', 'globular-cluster': 'Globular Cluster',
  'star-cloud': 'Star Cloud', asterism: 'Asterism', 'planetary-nebula': 'Planetary Nebula',
  'supernova-remnant': 'Supernova Remnant', 'wind-bubble': 'Emission Nebula', 'galaxy-spiral': 'Spiral Galaxy',
  'galaxy-barred-spiral': 'Barred Spiral Galaxy', 'galaxy-lenticular': 'Lenticular Galaxy',
  'galaxy-elliptical': 'Elliptical Galaxy', 'galaxy-dwarf-elliptical': 'Dwarf Elliptical Galaxy',
  'galaxy-irregular': 'Irregular Galaxy', 'milky-way-field': 'Milky Way Field',
};

/** KB record → the app's UnifiedTarget shape so `binocularAssessment` can rate it (stars rated as single points). */
export function toBinocularTarget(o: KbObject): UnifiedTarget {
  const major = majorArcmin(o);
  const minor = o.kind === 'dso' ? o.extent?.minorArcmin ?? major : major;
  const category = o.kind === 'star' ? 'Star' : DSO_CATEGORY[o.dsoClass];
  return {
    id: o.id,
    name: o.names.display,
    displayName: o.names.display,
    mag: o.mag ?? 99,
    ra: o.ra,
    dec: o.dec,
    con: o.con,
    category,
    categoryShort: category,
    source: 'binocular',
    ...(major !== null ? { size: `${major}×${minor ?? major}′` } : {}),
  };
}

export function binocularProfileOf(s: EngineSettings): BinocularProfile {
  return { magnification: s.magnification, aperture: s.aperture, fov: s.fovDeg, stabilized: s.stabilized, transmission: 0.85 };
}

/**
 * Curated view grade → rating floor (doc 03 §3.3): 4 showpiece → 0, 3 easy → 1, 2 certain but faint → 2,
 * 1 suspected / 0 not seen → 3. Dark-sky grade only when the sky is darker than 20.8 mag/arcsec².
 */
export function viewGradeRating(o: KbObject, s: EngineSettings): 0 | 1 | 2 | 3 | null {
  const v = o.view;
  if (!v) return null;
  const optic = s.aperture >= 50 && s.magnification >= 9 ? v['10x50'] : v['7x50'];
  const grade = s.sky >= 20.8 ? optic.dark : optic.suburban;
  return grade >= 4 ? 0 : grade === 3 ? 1 : grade === 2 ? 2 : 3;
}

/** Lowest altitude (degrees) at which a curated view grade alone rates a deep-sky object on a moonless night. */
export const CURATED_GRADE_MIN_ALT = 30;

/**
 * Conservative binocular rating for one stop interval: `binocularAssessment` (the physical visibility model,
 * lib/visibility/model.ts) at the interval's lowest altitude (rounded down) with the Moon and Sun of its
 * brightest-glow sample, combined with the curated view grade (the grade alone for a curated object on a moonless
 * night, from CURATED_GRADE_MIN_ALT up). The request carries no haze or elevation, so the model assumes an average
 * night at sea level; `stabilized` selects image-stabilized vs hand-held steadiness.
 */
export function makeRater(s: EngineSettings) {
  const profile = binocularProfileOf(s);
  const cache = new Map<string, 0 | 1 | 2 | 3>();
  const targets = new Map<string, UnifiedTarget>();
  return (o: KbObject, minAlt: number, moon: MoonState | undefined, moonKey: number): 0 | 1 | 2 | 3 => {
    const altKey = Math.floor(minAlt);
    const key = `${o.id}|${altKey}|${moonKey}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let rating: 0 | 1 | 2 | 3;
    const grade = viewGradeRating(o, s);
    if (o.mag === null) {
      rating = grade ?? 3;
    } else {
      let t = targets.get(o.id);
      if (!t) { t = toBinocularTarget(o); targets.set(o.id, t); }
      // No skyline here (AssessmentContext.horizonAlt): the rater only runs for stops that clear max(minAlt, skyline)
      // at every sample (evaluateStop), so the skyline could not change the rating; `altKey` is floored, so passing it
      // could even misreport a just-clear stop as hidden, and the cache key would have to carry it.
      const r = binocularAssessment(t, profile, { alt: altKey, moon, skyBrightness: s.sky }).rating;
      // A curator's grade for this sky class (doc 03 §3.3) wins over the model when the Moon is down and the object
      // stands at least CURATED_GRADE_MIN_ALT high: observer grades capture concentrated cores the catalogue extent
      // hides (round 3: a whole-extent average rated the Orion, Lagoon and Carina nebulae invisible from a suburban
      // sky, so A1 could never open at its nursery). With the Moon up, or low down, the more cautious of the two holds.
      const trusted = grade !== null && o.view?.basis === 'curator' && moonKey < 0 && altKey >= CURATED_GRADE_MIN_ALT;
      rating = Math.max(trusted ? grade : Math.max(r, grade ?? 0), fadingFloor(o)) as 0 | 1 | 2 | 3;
    }
    cache.set(key, rating);
    return rating;
  };
}
export type Rater = ReturnType<typeof makeRater>;

/**
 * A variable that fades below binocular reach (variability.binocularVisibleAtMin false: Mira, χ Cygni, R Leonis,
 * R CrB …) may be invisible tonight, and the engine cannot know its phase offline. It is never a sure stop: at best
 * the one challenge stop (rating 2), which keeps it off the opener, stop 2 and the payoff (P4 evaluation).
 */
export function fadingFloor(o: KbObject): 0 | 2 {
  return o.kind === 'star' && o.variability && !o.variability.binocularVisibleAtMin ? 2 : 0;
}

// ───────────────────────────── night summary ─────────────────────────────

export function darknessOf(sunAlt: number): Darkness {
  if (sunAlt > -0.833) return 'day';
  if (sunAlt > -6) return 'civil';
  if (sunAlt > -12) return 'nautical';
  if (sunAlt > -18) return 'astronomical';
  return 'night';
}

/** Sun crossings of `altitude` around the instant: the setting crossing of this night and the next rising one. */
export function sunCrossings(s: EngineSettings, altitude: number): { dusk: Date | null; dawn: Date | null } {
  const observer = new Astro.Observer(s.lat, s.lon, 0);
  const from = new Date(s.instantMs - 12 * 3_600_000);
  const dusk = Astro.SearchAltitude(Astro.Body.Sun, observer, -1, from, 1, altitude)?.date ?? null;
  const dawn = Astro.SearchAltitude(Astro.Body.Sun, observer, +1, dusk ?? from, 1.2, altitude)?.date ?? null;
  return { dusk, dawn };
}

export function nextMoonEvent(s: EngineSettings, direction: 1 | -1): Date | null {
  const observer = new Astro.Observer(s.lat, s.lon, 0);
  return Astro.SearchRiseSet(Astro.Body.Moon, observer, direction, new Date(s.instantMs), 1)?.date ?? null;
}

export function buildNightContext(s: EngineSettings, grid: NightGrid, seedKey: string): NightContext {
  const now = moonState(s.lat, s.lon, new Date(s.instantMs));
  const astro = sunCrossings(s, -18);
  return {
    seedKey,
    instant: new Date(s.instantMs).toISOString(),
    lat: s.lat,
    lon: s.lon,
    sunAltDeg: now.sunAlt,
    darkness: darknessOf(now.sunAlt),
    astroDusk: astro.dusk?.toISOString() ?? null,
    astroDawn: astro.dawn?.toISOString() ?? null,
    moon: { up: moonIsUp(now), altDeg: now.alt, azDeg: now.az, ra: now.ra, dec: now.dec, illumination: now.illumination },
    skyBrightness: s.sky,
    minAlt: s.minAlt,
    regionRadius: s.radius,
    samples: grid.times.map((t) => new Date(t).toISOString()),
  };
}
