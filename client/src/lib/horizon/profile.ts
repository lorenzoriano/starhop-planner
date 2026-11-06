/**
 * Questions asked of a site's local horizon (docs/local-horizon-design.md). Pure functions only.
 *
 * Altitude convention: HorizonProfile.alt is the APPARENT skyline (refraction included), but the app's star
 * altitudes (eqToHorizontal, journeys fastAltAz) are GEOMETRIC. Every comparison helper here therefore takes the
 * target's geometric altitude and compares it with the skyline's geometric-equivalent threshold
 * `apparent − R(apparent)`, where R is Bennett's astronomical refraction (≈ 0.57° at 0°, 0.16° at 5°).
 * Display helpers (horizonAltitudeAt, highestPoint, summaries) report the apparent skyline, which is what the eye sees.
 *
 * With no horizon known, comparisons keep the app's flat-horizon rule: geometric altitude ≥ 0 (margins ignored).
 */
import type { Compass8 } from '../journeys/types';
import type { HorizonProfile, LocalHorizon } from './types';

const RAD = Math.PI / 180;
const LAYERS = ['terrain', 'photo'] as const;

/** Combined geometric-equivalent skyline, structured-cloneable for workers (journeys engine, clock-season worker).
 *  `alt[i]` is the threshold a GEOMETRIC target altitude must reach at azimuth i·stepDeg. */
export interface CompactHorizon {
  kind: 'geometric';
  stepDeg: number;
  alt: number[];
}

/** Anything the comparison helpers accept. */
export type HorizonInput = LocalHorizon | CompactHorizon | null | undefined;

// ───────────────────────────── refraction ─────────────────────────────

/** Bennett (1982) refraction for an APPARENT altitude, degrees. Clamped below −1.5°, where it is undefined. */
export function refractionDeg(apparentAltDeg: number): number {
  const h = Math.max(-1.5, apparentAltDeg);
  if (h >= 89.9) return 0;
  return 1 / Math.tan((h + 7.31 / (h + 4.4)) * RAD) / 60;
}

/** Geometric altitude a target must have to appear at `apparentAltDeg`: apparent − R(apparent). */
export function geometricFromApparent(apparentAltDeg: number): number {
  return apparentAltDeg - refractionDeg(apparentAltDeg);
}

/** Inverse of geometricFromApparent: where a geometric altitude is seen (Saemundsson), for showing a threshold in words. */
export function apparentFromGeometric(geometricAltDeg: number): number {
  const h = Math.max(geometricAltDeg, -1.9);
  return geometricAltDeg + 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * Math.PI / 180) / 60;
}

// ───────────────────────────── per-layer arrays ─────────────────────────────

const norm = (az: number) => ((az % 360) + 360) % 360;

/** Validated bins of a layer, or null when the layer is unusable. */
function layerBins(p: HorizonProfile | null | undefined): { step: number; alt: readonly number[] } | null {
  if (!p || !Array.isArray(p.alt) || p.alt.length < 2) return null;
  const step = 360 / p.alt.length;
  if (p.stepDeg && Math.abs(p.stepDeg - step) > 1e-6) return null;
  return { step, alt: p.alt };
}

/** Linear interpolation with wrap-around (bin i at azimuth i·step). */
function interpolate(values: ArrayLike<number>, step: number, azDeg: number): number {
  const n = values.length, x = norm(azDeg) / step;
  const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
  return values[i0] * (1 - f) + values[i1] * f;
}

// Geometric-equivalent arrays per profile object (profiles are treated as immutable).
const geometricCache = new WeakMap<HorizonProfile, Float32Array>();
function geometricBins(p: HorizonProfile): Float32Array | null {
  const cached = geometricCache.get(p);
  if (cached) return cached;
  const bins = layerBins(p);
  if (!bins) return null;
  const out = Float32Array.from(bins.alt, (a) => (Number.isFinite(a) ? geometricFromApparent(a) : -90));
  geometricCache.set(p, out);
  return out;
}

const isCompact = (h: HorizonInput): h is CompactHorizon =>
  !!h && (h as CompactHorizon).kind === 'geometric' && Array.isArray((h as CompactHorizon).alt);

function presentLayers(h: LocalHorizon | null | undefined): HorizonProfile[] {
  if (!h) return [];
  return LAYERS.map((k) => h[k]).filter((p): p is HorizonProfile => !!layerBins(p));
}

// ───────────────────────────── display: apparent skyline ─────────────────────────────

/** Apparent skyline altitude at an azimuth (max over present layers, linear interpolation); null if no layer. */
export function horizonAltitudeAt(h: LocalHorizon | null | undefined, azDeg: number): number | null {
  let best: number | null = null;
  for (const p of presentLayers(h)) {
    const bins = layerBins(p)!;
    const v = interpolate(bins.alt, bins.step, azDeg);
    if (Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

// ───────────────────────────── comparisons: geometric target altitudes ─────────────────────────────

/**
 * Combined geometric-equivalent threshold per azimuth (max of layers, sampled at the finest layer step), or null when
 * no horizon is known. Pass it to workers; rebuild the lookup there with `horizonLookup(compact)`.
 */
export function compactHorizon(h: HorizonInput): CompactHorizon | null {
  if (isCompact(h)) return h;
  const layers = presentLayers(h);
  if (!layers.length) return null;
  const step = Math.min(...layers.map((p) => layerBins(p)!.step));
  const n = Math.round(360 / step);
  const alt = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let best = -90;
    for (const p of layers) {
      const g = geometricBins(p)!;
      best = Math.max(best, interpolate(g, 360 / g.length, i * step));
    }
    alt[i] = Math.round(best * 100) / 100;
  }
  return { kind: 'geometric', stepDeg: step, alt };
}

const lookupCache = new WeakMap<object, (azDeg: number) => number>();

/**
 * Fast threshold lookup for hot loops: azimuth (deg) → geometric altitude a target must reach to clear the skyline.
 * Backed by a Float32Array with linear interpolation. Null when no horizon is known (use the flat rule alt ≥ 0).
 */
export function horizonLookup(h: HorizonInput): ((azDeg: number) => number) | null {
  if (!h) return null;
  const cached = lookupCache.get(h);
  if (cached) return cached;
  const compact = compactHorizon(h);
  if (!compact || compact.alt.length < 2) return null;
  const values = Float32Array.from(compact.alt);
  const n = values.length, step = 360 / n;
  const fn = (azDeg: number) => {
    let x = (azDeg % 360) / step;
    if (x < 0) x += n;
    const i0 = Math.floor(x), f = x - i0, a = i0 % n;
    return values[a] * (1 - f) + values[(a + 1) % n] * f;
  };
  lookupCache.set(h, fn);
  return fn;
}

/** Geometric altitude needed to clear the skyline at an azimuth, or null when no horizon is known. */
export function horizonThresholdAt(h: HorizonInput, azDeg: number): number | null {
  const lookup = horizonLookup(h);
  return lookup ? lookup(azDeg) : null;
}

/** Degrees by which a target at GEOMETRIC altitude `alt` clears the skyline at `az` (negative = hidden); null if no
 *  horizon is known. */
export function clearanceDeg(h: HorizonInput, alt: number, az: number): number | null {
  const t = horizonThresholdAt(h, az);
  return t === null ? null : alt - t;
}

/** True when a target at GEOMETRIC altitude `alt` is above the local skyline by at least `marginDeg`.
 *  With no horizon known this is the app's flat rule `alt >= 0` (the margin applies only to a known skyline). */
export function isAboveLocalHorizon(h: HorizonInput, alt: number, az: number, marginDeg = 0): boolean {
  const t = horizonThresholdAt(h, az);
  return t === null ? alt >= 0 : alt >= t + marginDeg;
}

/** Short stable id of the combined skyline for cache keys ("flat" when no horizon is known). */
export function horizonFingerprint(h: HorizonInput): string {
  const compact = compactHorizon(h);
  if (!compact) return 'flat';
  let hash = 0x811c9dc5;
  const mix = (v: number) => {
    hash ^= v & 0xffff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  mix(Math.round(compact.stepDeg * 1000));
  for (const a of compact.alt) mix(Math.round(a * 10) + 1000);
  return `h${compact.alt.length}-${hash.toString(36)}`;
}

// ───────────────────────────── time windows ─────────────────────────────

export interface AltAzSample {
  /** Time, any monotonic unit (ms epoch in the app). */
  t: number;
  /** GEOMETRIC altitude, degrees. */
  alt: number;
  /** Azimuth from north through east, degrees. */
  az: number;
}
export interface ClearInterval {
  start: number;
  end: number;
}
export interface ClearIntervalOptions {
  /** Extra clearance above a known skyline, degrees (ignored for the flat rule). */
  marginDeg?: number;
  /** Exact position at time t: crossings are then refined by bisection instead of linear interpolation. */
  position?: (t: number) => { alt: number; az: number };
  /** Bisection stops when the bracket is this short (same unit as t; default 30 000 = 30 s for ms). */
  tolerance?: number;
}

/**
 * Intervals during which a target clears the local skyline, from time-ordered samples. The first/last interval is
 * open-ended at the first/last sample. Crossing times are linearly interpolated on the clearance, or refined by
 * bisection when `position` is given (minute-accurate rise/set "above your skyline").
 */
export function clearIntervals(samples: readonly AltAzSample[], h: HorizonInput, opts: ClearIntervalOptions = {}): ClearInterval[] {
  const lookup = horizonLookup(h);
  const margin = lookup ? opts.marginDeg ?? 0 : 0;
  const clearance = (alt: number, az: number) => alt - (lookup ? lookup(az) : 0) - margin;
  const tolerance = opts.tolerance ?? 30000;
  const crossing = (a: AltAzSample, ca: number, b: AltAzSample, cb: number) => {
    if (!opts.position) return a.t + ((b.t - a.t) * ca) / (ca - cb);
    let lo = a.t, hi = b.t;
    const loClear = ca >= 0;
    for (let i = 0; i < 40 && hi - lo > tolerance; i++) {
      const mid = (lo + hi) / 2, p = opts.position(mid);
      if (clearance(p.alt, p.az) >= 0 === loClear) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const out: ClearInterval[] = [];
  let start: number | null = null;
  let prev: AltAzSample | null = null, prevC = 0;
  for (const s of samples) {
    const c = clearance(s.alt, s.az);
    if (!prev) {
      if (c >= 0) start = s.t;
    } else if (prevC < 0 && c >= 0) {
      start = crossing(prev, prevC, s, c);
    } else if (prevC >= 0 && c < 0 && start !== null) {
      out.push({ start, end: crossing(prev, prevC, s, c) });
      start = null;
    }
    prev = s;
    prevC = c;
  }
  if (start !== null && prev) out.push({ start, end: prev.t });
  return out;
}

// ───────────────────────────── description ─────────────────────────────

export const COMPASS8: readonly Compass8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_WORDS: Record<Compass8, string> = {
  N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest',
};
/** Nearest of the eight compass points. */
export const compass8Of = (az: number): Compass8 => COMPASS8[Math.round(norm(az) / 45) % 8];
/** "northwest": a compass point in words (the app's style for skyline sentences). */
export const compass8Word = (d: Compass8): string => COMPASS_WORDS[d];
/** "southwest": the nearest compass point in words, for sentences such as "behind the hills to the southwest". */
export const compassWord = (az: number): string => COMPASS_WORDS[compass8Of(az)];

export interface HighestPoint {
  az: number;
  /** Apparent altitude, degrees. */
  alt: number;
  distanceKm?: number;
}

/** Highest bin of a profile (first one on ties); null for an empty profile. */
export function highestPoint(profile: HorizonProfile | null | undefined): HighestPoint | null {
  const bins = layerBins(profile);
  if (!profile || !bins) return null;
  let best = 0;
  bins.alt.forEach((a, i) => {
    if (a > bins.alt[best]) best = i;
  });
  const d = profile.distanceKm?.[best];
  return { az: best * bins.step, alt: bins.alt[best], ...(typeof d === 'number' ? { distanceKm: d } : {}) };
}

/** Apparent skyline sampled every degree over one 45° compass sector (centre ± 22.5°). */
function sectorValues(h: LocalHorizon, dir: Compass8): number[] {
  const centre = COMPASS8.indexOf(dir) * 45, out: number[] = [];
  for (let a = -22; a <= 22; a++) out.push(horizonAltitudeAt(h, centre + a) ?? 0);
  return out;
}

/**
 * Compass directions whose skyline rises above `thresholdDeg` (apparent) over at least half of the 45° sector — a
 * single narrow peak does not block a direction. Empty when no horizon is known. For the journeys "open directions"
 * control (Compass8).
 */
export function blockedDirections8(h: LocalHorizon | null | undefined, thresholdDeg = 10): Compass8[] {
  if (!presentLayers(h).length) return [];
  return COMPASS8.filter((dir) => {
    const v = sectorValues(h!, dir);
    return v.filter((a) => a > thresholdDeg).length >= v.length / 2;
  });
}

/** Complement of blockedDirections8 (all eight when no horizon is known). */
export function openDirections8(h: LocalHorizon | null | undefined, thresholdDeg = 10): Compass8[] {
  const blocked = new Set(blockedDirections8(h, thresholdDeg));
  return COMPASS8.filter((d) => !blocked.has(d));
}

const fmtDeg = (v: number) => `${Math.abs(v) >= 2 ? Math.round(v) : Math.round(v * 10) / 10}°`;
const fmtKm = (km: number) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : km < 10 ? `${Math.round(km * 10) / 10} km` : `${Math.round(km)} km`);

/** Below this (apparent, over the whole sector) a direction reads as "open" in the summary. */
const OPEN_DEG = 1;

/** Runs of consecutive open compass directions (circular), worded "the south" / "from southeast to west". */
function openRuns(open: boolean[]): string[] {
  if (open.every(Boolean)) return [];
  const start = open.findIndex((o, i) => !o && open[(i + 1) % 8]);
  const runs: Compass8[][] = [];
  let cur: Compass8[] = [];
  for (let k = 1; k <= 8; k++) {
    const i = (start + k) % 8;
    if (open[i]) cur.push(COMPASS8[i]);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.map((r) =>
    r.length === 1 ? `the ${COMPASS_WORDS[r[0]]}`
      : r.length === 2 ? `the ${COMPASS_WORDS[r[0]]} and ${COMPASS_WORDS[r[1]]}`
        : `${COMPASS_WORDS[r[0]]} to ${COMPASS_WORDS[r[r.length - 1]]}`,
  );
}

/**
 * One plain-language sentence about a terrain (or photo) profile, e.g.
 * "Hills block up to 4° to the northeast (12 km away); open to the south."
 */
export function horizonSummary(profile: HorizonProfile | null | undefined): string {
  const top = highestPoint(profile);
  if (!profile || !top) return 'No horizon measured yet; a flat horizon is assumed.';
  const h: LocalHorizon = { [profile.kind]: profile };
  if (top.alt < OPEN_DEG) return `Open horizon all around; nothing rises above ${fmtDeg(Math.max(0, top.alt))}.`;
  let noun: string;
  if (profile.kind === 'photo') noun = 'Nearby obstructions';
  else if (top.distanceKm !== undefined && top.distanceKm < 1) noun = 'Nearby slopes';
  else {
    const dM = (top.distanceKm ?? 0) * 1000;
    const relief = dM * Math.tan(top.alt * RAD) + (dM * dM * 0.87) / (2 * 6371008.8);
    noun = relief >= 500 ? 'Mountains' : relief >= 80 ? 'Hills' : 'Rising ground';
  }
  const where = top.distanceKm !== undefined && profile.kind === 'terrain' ? ` (${fmtKm(top.distanceKm)} away)` : '';
  const first = `${noun} block up to ${fmtDeg(top.alt)} to the ${COMPASS_WORDS[compass8Of(top.az)]}${where}`;
  const maxima = COMPASS8.map((d) => Math.max(...sectorValues(h, d)));
  const runs = openRuns(maxima.map((m) => m < OPEN_DEG));
  if (runs.length) {
    const words = runs.map((r) => (r.startsWith('the ') ? `to ${r}` : `from ${r}`));
    return `${first}; open ${words.slice(0, 2).join(' and ')}.`;
  }
  const bins = layerBins(profile)!;
  let low = 0;
  bins.alt.forEach((a, i) => {
    if (a < bins.alt[low]) low = i;
  });
  return `${first}; the lowest gap is ${fmtDeg(bins.alt[low])} to the ${COMPASS_WORDS[compass8Of(low * bins.step)]}.`;
}
