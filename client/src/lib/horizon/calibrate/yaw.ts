/**
 * True-north alignment of a sweep (docs/local-horizon-design.md, section 7). All frames share the relative (gyro)
 * frame, so one offset aligns them all: trueAz = relAz + offsetDeg. Each method returns a YawFix with its one-sigma
 * uncertainty; chooseYaw keeps the most precise one and says so plainly when two fixes disagree.
 * Terrain matching lives in terrain-match.ts. Pure functions.
 */
import type { CapturedFrame, YawChoice, YawFix } from '../photo-types';
import { cameraPointing } from './camera';
import { magneticDeclinationDeg } from './declination';
import { angleDiffDeg, circularMedianDeg, type Quat } from './quat';
import type { TapTarget } from './tap-targets';

export type { TapTarget } from './tap-targets';

const RAD = Math.PI / 180;

/** The compass is never trusted to better than this, degrees (typical phone heading error). */
const COMPASS_MIN_SIGMA_DEG = 5;
/** A spread of the per-frame compass offsets above this suggests magnetic interference (cars, metal, the mount). */
const COMPASS_INTERFERENCE_DEG = 3;

/** Wrap to (−180, 180]. */
const wrap = (deg: number) => angleDiffDeg(deg, 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

type CompassFrame = Pick<CapturedFrame, 'qRel' | 'qAbs' | 'screenAngle'>;

/** Per-frame magnetic offsets (magnetic az − relative az of the camera), skipping frames without a compass reading
 *  and frames looking nearly straight up or down (azimuth undefined there). */
function compassOffsets(frames: readonly CompassFrame[]): number[] {
  const out: number[] = [];
  for (const f of frames) {
    if (!f.qAbs) continue;
    const abs = cameraPointing({ q: f.qAbs, screenAngle: f.screenAngle });
    const rel = cameraPointing({ q: f.qRel, screenAngle: f.screenAngle });
    if (Math.abs(abs.alt) > 75 || Math.abs(rel.alt) > 75) continue;
    out.push(angleDiffDeg(abs.az, rel.az));
  }
  return out;
}

/** Circular median and robust spread (1.4826 × median absolute deviation), degrees. */
function circularStats(angles: number[]): { median: number; spread: number } {
  const median = circularMedianDeg(angles);
  const dev = angles.map((a) => Math.abs(angleDiffDeg(a, median))).sort((a, b) => a - b);
  const n = dev.length;
  const mad = n % 2 ? dev[(n - 1) / 2] : (dev[n / 2 - 1] + dev[n / 2]) / 2;
  return { median, spread: 1.4826 * mad };
}

/**
 * Compass seed: median over the sweep of (absolute − relative) camera azimuth, plus the WMM declination at the site.
 * Sigma is the robust spread of the per-frame offsets, never below 5°. Null when no frame has a compass reading.
 */
export function compassFix(frames: Pick<CapturedFrame, 'qRel' | 'qAbs' | 'screenAngle'>[], lat: number, lon: number, date: Date): YawFix | null {
  const offsets = compassOffsets(frames);
  if (!offsets.length) return null;
  const { median, spread } = circularStats(offsets);
  return {
    source: 'compass',
    offsetDeg: round2(wrap(median + magneticDeclinationDeg(lat, lon, date))),
    sigmaDeg: round2(Math.max(COMPASS_MIN_SIGMA_DEG, spread)),
    label: 'the compass',
  };
}

/** True when the compass readings wander during the sweep (spread > 3°): suggest moving away from cars and metal. */
export function compassInterference(frames: Pick<CapturedFrame, 'qRel' | 'qAbs' | 'screenAngle'>[]): boolean {
  const offsets = compassOffsets(frames);
  return offsets.length >= 2 && circularStats(offsets).spread > COMPASS_INTERFERENCE_DEG;
}

/** Centring error of a tap on each kind of body, degrees (the Sun and Moon are big discs; points are harder). */
const TAP_SIGMA: Record<TapTarget['source'], number> = { sun: 0.5, moon: 0.5, planet: 0.7, star: 0.7 };

/**
 * Fix from a body centred in the reticle (the image centre) when the user tapped: the camera's relative azimuth is
 * compared with the body's true azimuth. pitchErrorDeg = measured centre altitude − the body's apparent altitude
 * (a level check). Sigma grows as 1/cos(alt) for high bodies, where a small centring error is a large azimuth error.
 */
export function celestialFix(tap: { qRel: Quat; screenAngle: number }, body: TapTarget): { fix: YawFix; pitchErrorDeg: number } {
  const p = cameraPointing({ q: tap.qRel, screenAngle: tap.screenAngle });
  const cosAlt = Math.max(0.25, Math.cos(body.alt * RAD));
  return {
    fix: {
      source: body.source,
      offsetDeg: round2(wrap(body.az - p.az)),
      sigmaDeg: round2(TAP_SIGMA[body.source] / cosAlt),
      label: body.label,
    },
    pitchErrorDeg: round2(p.alt - body.alt),
  };
}

/** Fix from a landmark of known true bearing seen at a relative azimuth (dragged into line in the review or viewer). */
export function landmarkFix(relAzDeg: number, trueBearingDeg: number, sigmaDeg = 1): YawFix {
  return { source: 'landmark', offsetDeg: round2(wrap(trueBearingDeg - relAzDeg)), sigmaDeg, label: 'the landmark' };
}

/** Initial great-circle bearing from point 1 to point 2, degrees from true north (0…360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "The hills disagree", "The compass disagrees". */
const verb = (f: YawFix) => (f.source === 'terrain' ? 'disagree' : 'disagrees');

/** Two fixes disagree when they differ by more than this many combined sigmas, and by more than MIN_DISAGREE_DEG. */
const DISAGREE_SIGMAS = 2;
/** Below this, a difference is never worth a sentence (two good fixes rarely agree to better than a few tenths). */
const MIN_DISAGREE_DEG = 3;

/** Whether two fixes `diffDeg` apart, with these sigmas, disagree enough to say so. */
export function fixesDisagree(diffDeg: number, sigmaA: number, sigmaB: number): boolean {
  return Math.abs(diffDeg) > Math.max(MIN_DISAGREE_DEG, DISAGREE_SIGMAS * Math.hypot(sigmaA, sigmaB));
}

/**
 * Keep the fix with the smallest sigma. When another fix disagrees with it by more than max(3°, 2 combined sigma), say
 * so in one plain sentence ("The compass disagrees with the Sun by 14°; using the Sun."); the worst disagreement wins, and
 * one between two other fixes is reported only when none involves the chosen fix.
 */
export function chooseYaw(fixes: YawFix[]): YawChoice | null {
  const valid = fixes.filter((f) => Number.isFinite(f.offsetDeg) && Number.isFinite(f.sigmaDeg) && f.sigmaDeg > 0);
  if (!valid.length) return null;
  const chosen = valid.reduce((best, f) => (f.sigmaDeg < best.sigmaDeg ? f : best));
  // Worst disagreement (in combined sigmas) involving the chosen fix, else between any two others.
  const worst = (pairs: Array<[YawFix, YawFix]>) => {
    let found: { a: YawFix; b: YawFix; diff: number; z: number } | null = null;
    for (const [a, b] of pairs) {
      const diff = Math.abs(angleDiffDeg(a.offsetDeg, b.offsetDeg));
      const z = diff / Math.hypot(a.sigmaDeg, b.sigmaDeg);
      // 2σ rather than 3σ: a compass sigma comes from the spread of its own readings, so a biased compass with a
      // heading-dependent error (25° + 8°, σ ≈ 8°) would otherwise slip under 3σ unnoticed.
      if (fixesDisagree(diff, a.sigmaDeg, b.sigmaDeg) && (!found || z > found.z)) found = { a, b, diff, z };
    }
    return found;
  };
  const others = valid.filter((f) => f !== chosen);
  const pairsOf: Array<[YawFix, YawFix]> = [];
  for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) pairsOf.push([others[i], others[j]]);
  const hit = worst(others.map((f) => [f, chosen])) ?? worst(pairsOf);
  const fmt = (d: number) => `${d >= 10 ? Math.round(d) : Math.round(d * 10) / 10}°`;
  return {
    chosen,
    fixes: valid,
    ...(hit ? { disagreement: `${capitalise(hit.a.label)} ${verb(hit.a)} with ${hit.b.label} by ${fmt(hit.diff)}; using ${chosen.label}.` } : {}),
  };
}
