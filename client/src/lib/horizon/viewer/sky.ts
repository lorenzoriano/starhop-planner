/**
 * Sky layer of the horizon viewer: stars, constellation lines, targets, the Sun, Moon and planets, as APPARENT
 * horizontal directions for one instant. Pure apart from astronomy-engine.
 *
 * Speed: catalogue directions are converted once to unit vectors on the true equator of date (precession and nutation
 * over one night change them by a few thousandths of a degree). Each time tick then needs ONE rotation matrix
 * (equator of date → east/north/up, from the local sidereal time), applied to every vector — the same geometry as
 * astronomy.ts eqToHorizontal, which gives the app's GEOMETRIC altitudes. Refraction is added afterwards with
 * profile.ts apparentFromGeometric, and "behind the skyline" is decided with the geometric altitude (profile.ts horizonLookup).
 */
import * as Astro from 'astronomy-engine';
import { equatorialOfDate } from '../../fixed-equatorial';
import { apparentFromGeometric, horizonLookup, type HorizonInput } from '../profile';
import { stellarColor } from '../../stellar-appearance';
import type { Vec3 } from '../calibrate/quat';

const RAD = Math.PI / 180;

/** Row-major 3×3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** Unit vector of (ra, dec) in degrees. */
function eqVec(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * RAD, d = decDeg * RAD, c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
}

/** Packs J2000 (ra, dec) pairs into of-date unit vectors (x, y, z per entry) for the night around `refDate`. */
export function packOfDate(points: ReadonlyArray<{ ra: number; dec: number }>, refDate: Date): Float64Array {
  const out = new Float64Array(points.length * 3);
  points.forEach((p, i) => {
    const q = equatorialOfDate(p.ra, p.dec, refDate);
    const v = eqVec(q.ra, q.dec);
    out[i * 3] = v[0];
    out[i * 3 + 1] = v[1];
    out[i * 3 + 2] = v[2];
  });
  return out;
}

/** Local apparent sidereal time, degrees. */
const localSiderealDeg = (lon: number, date: Date) => (Astro.SiderealTime(Astro.MakeTime(date)) * 15 + lon) % 360;

/**
 * Rotation from the true equator of date to the site's east/north/up frame at `date`.
 * east = −sin L·x + cos L·y; north = −sin φ cos L·x − sin φ sin L·y + cos φ·z; up = cos φ cos L·x + cos φ sin L·y + sin φ·z
 * (L local sidereal time, φ latitude). Azimuth = atan2(east, north), as in calibrate/quat.ts.
 */
export function horizontalMatrix(lat: number, lon: number, date: Date): Mat3 {
  const L = localSiderealDeg(lon, date) * RAD, p = lat * RAD;
  const sL = Math.sin(L), cL = Math.cos(L), sp = Math.sin(p), cp = Math.cos(p);
  return [-sL, cL, 0, -sp * cL, -sp * sL, cp, cp * cL, cp * sL, sp];
}

/** Applies a matrix to the i-th packed vector. */
export function rotatePacked(m: Mat3, packed: Float64Array, i: number, out: [number, number, number]): [number, number, number] {
  const x = packed[i * 3], y = packed[i * 3 + 1], z = packed[i * 3 + 2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** Geometric altitude and azimuth (degrees) of an east/north/up unit vector. */
export function altAzOf(v: Vec3): { alt: number; az: number } {
  const alt = Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD;
  const az = ((Math.atan2(v[0], v[1]) / RAD) % 360 + 360) % 360;
  return { alt, az };
}

/** The same direction lifted to its apparent altitude (refraction added), as a unit vector. */
function apparentVec(az: number, geometricAlt: number): Vec3 {
  const alt = apparentFromGeometric(geometricAlt) * RAD, a = az * RAD, c = Math.cos(alt);
  return [c * Math.sin(a), c * Math.cos(a), Math.sin(alt)];
}

// ───────────────────────────── the sky at one instant ─────────────────────────────

export interface SkyCatalogue {
  stars: Array<{ mag: number; color: string; name?: string }>;
  starVecs: Float64Array;
  /** Constellation line segments as pairs of packed vectors: segment k joins entries 2k and 2k + 1. */
  lineVecs: Float64Array;
  targets: Array<{ id: string; name: string }>;
  targetVecs: Float64Array;
}

/** Faintest catalogue star kept (the app's bright-star catalogue goes deeper; this is the naked-eye view). */
const STAR_MAG_LIMIT = 5;

/**
 * Catalogue for one night: the app's stars (bsc5, loadStars) to STAR_MAG_LIMIT, constellation lines
 * (loadConstellations) and the targets, all packed as of-date vectors for `refDate`.
 */
export function buildCatalogue(
  stars: ReadonlyArray<{ ra: number; dec: number; mag: number; name?: string; temperature?: number }>,
  constellations: ReadonlyArray<{ points: [number, number][][] }>,
  targets: ReadonlyArray<{ id: string; name: string; ra: number; dec: number }>,
  refDate: Date,
): SkyCatalogue {
  const kept = stars.filter((s) => Number.isFinite(s.mag) && s.mag <= STAR_MAG_LIMIT);
  const ends: Array<{ ra: number; dec: number }> = [];
  for (const c of constellations) {
    for (const line of c.points) {
      for (let i = 0; i + 1 < line.length; i++) ends.push({ ra: line[i][0], dec: line[i][1] }, { ra: line[i + 1][0], dec: line[i + 1][1] });
    }
  }
  const okTargets = targets.filter((t) => Number.isFinite(t.ra) && Number.isFinite(t.dec));
  return {
    stars: kept.map((s) => ({ mag: s.mag, color: stellarColor(s.temperature), ...(s.name ? { name: s.name } : {}) })),
    starVecs: packOfDate(kept, refDate),
    lineVecs: packOfDate(ends, refDate),
    targets: okTargets.map((t) => ({ id: t.id, name: t.name })),
    targetVecs: packOfDate(okTargets, refDate),
  };
}

export interface SkyPoint {
  /** Apparent direction (east/north/up unit vector). */
  vec: Vec3;
  az: number;
  /** Apparent altitude, degrees. */
  alt: number;
  /** Below the site's skyline (geometric altitude compared via profile.ts). */
  hidden: boolean;
}

/** Positions of `count` packed vectors at one instant (one rotation for all). Below −5° geometric are skipped (null). */
export function skyPoints(packed: Float64Array, m: Mat3, horizon: HorizonInput): Array<SkyPoint | null> {
  const lookup = horizonLookup(horizon);
  const n = packed.length / 3, out = new Array<SkyPoint | null>(n), v: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    rotatePacked(m, packed, i, v);
    if (v[2] < -0.087) { out[i] = null; continue; }
    const { alt, az } = altAzOf(v);
    const hidden = lookup ? alt < lookup(az) : alt < 0;
    const vec = apparentVec(az, alt);
    out[i] = { vec, az, alt: Math.asin(vec[2]) / RAD, hidden };
  }
  return out;
}

export type BodyName = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn';
const BODIES: Array<{ name: BodyName; body: Astro.Body }> = [
  { name: 'Sun', body: Astro.Body.Sun },
  { name: 'Moon', body: Astro.Body.Moon },
  { name: 'Mercury', body: Astro.Body.Mercury },
  { name: 'Venus', body: Astro.Body.Venus },
  { name: 'Mars', body: Astro.Body.Mars },
  { name: 'Jupiter', body: Astro.Body.Jupiter },
  { name: 'Saturn', body: Astro.Body.Saturn },
];

export interface BodyPoint extends SkyPoint {
  name: BodyName;
  mag: number;
  /** Moon phase angle (astronomy-engine MoonPhase: 0 new, 180 full), Moon only. */
  phase?: number;
}

/** Sun, Moon and the bright planets at `date`, topocentric, with apparent altitude; all bodies, up or not. */
export function bodyPoints(lat: number, lon: number, date: Date, horizon: HorizonInput): BodyPoint[] {
  const observer = new Astro.Observer(lat, lon, 0), time = Astro.MakeTime(date);
  const lookup = horizonLookup(horizon);
  return BODIES.map(({ name, body }) => {
    const eq = Astro.Equator(body, time, observer, true, true);
    const hor = Astro.Horizon(time, observer, eq.ra, eq.dec); // geometric
    const vec = apparentVec(hor.azimuth, hor.altitude);
    let mag = -26.7;
    try { if (name !== 'Sun') mag = Astro.Illumination(body, time).mag; } catch { /* keep the default */ }
    return {
      name, mag, vec, az: hor.azimuth, alt: Math.asin(vec[2]) / RAD,
      hidden: lookup ? hor.altitude < lookup(hor.azimuth) : hor.altitude < 0,
      ...(name === 'Moon' ? { phase: Astro.MoonPhase(time) } : {}),
    };
  });
}

// ───────────────────────────── tonight ─────────────────────────────

/**
 * Tonight, sunset → sunrise, for the night that follows the most recent local solar noon before `date` (so at 2 am
 * it is the night already under way). Where the Sun does not set or rise (polar day or night) the whole day from noon
 * to noon is used. `start` is moved back to `date` when `date` falls in the afternoon before sunset, so "now" is always
 * on the slider.
 */
export function tonightWindow(lat: number, lon: number, date: Date): { start: Date; end: Date; sunset: Date | null; sunrise: Date | null } {
  const observer = new Astro.Observer(lat, lon, 0), day = 86400000;
  let noon = Astro.SearchHourAngle(Astro.Body.Sun, observer, 0, new Date(+date - day)).time.date;
  const next = Astro.SearchHourAngle(Astro.Body.Sun, observer, 0, new Date(+noon + 60000)).time.date;
  if (+next <= +date) noon = next;
  const sunset = Astro.SearchRiseSet(Astro.Body.Sun, observer, -1, noon, 1)?.date ?? null;
  const sunrise = sunset ? Astro.SearchRiseSet(Astro.Body.Sun, observer, 1, sunset, 1)?.date ?? null : null;
  if (!sunset || !sunrise) return { start: noon, end: new Date(+noon + day), sunset, sunrise };
  return { start: +date < +sunset ? new Date(+date) : sunset, end: sunrise, sunset, sunrise };
}
