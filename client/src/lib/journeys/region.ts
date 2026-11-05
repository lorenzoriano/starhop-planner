/**
 * Sky Journeys: region geometry (doc 05 §5.2–5.3, spec decision 4).
 *
 * - Sky patches: spherical caps (default radius 30°), scored and non-max-suppressed.
 * - Flat projection: gnomonic (tangent-plane) projection about the cap centre. Turn angles and principal-axis
 *   reversals are measured there, so they do not change as the sky rotates during the session.
 */
import { getConstellationName } from '../astronomy';
import type { Compass8 } from './types';

const RAD = Math.PI / 180;
export type Vec3 = [number, number, number];
export interface RaDec { ra: number; dec: number }

/** Hops shorter than this are "same area" moves; their direction is too noisy to count as a turn. */
export const MIN_TURN_HOP_DEG = 2;
/** Turns sharper than this are back-tracks (spec: at most one, and only on a link of strength ≥ 0.85). */
export const SHARP_TURN_DEG = 135;
/** Principal-axis steps smaller than this fraction of the cap radius are side-steps, not reversals. */
export const REVERSAL_MIN_STEP_FRACTION = 0.15;

export function unitVec(ra: number, dec: number): Vec3 {
  const r = ra * RAD, d = dec * RAD, c = Math.cos(d);
  return [c * Math.cos(r), c * Math.sin(r), Math.sin(d)];
}

export function sepDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / RAD;
}

export function vecToRaDec(v: Vec3): RaDec {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  const dec = Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / RAD;
  let ra = Math.atan2(v[1], v[0]) / RAD;
  if (ra < 0) ra += 360;
  return { ra, dec };
}

/** Normalised vector mean of positions (cap centre of a set of stops). */
export function meanPosition(points: RaDec[]): RaDec {
  const s: Vec3 = [0, 0, 0];
  for (const p of points) {
    const v = unitVec(p.ra, p.dec);
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2];
  }
  return vecToRaDec(s);
}

/**
 * Gnomonic projection about `center` → plane coordinates in degrees-equivalent units
 * (x toward increasing RA / east, y toward north). Points ≥ 90° away are pushed far out.
 */
export function gnomonic(center: RaDec, ra: number, dec: number): [number, number] {
  const a0 = center.ra * RAD, d0 = center.dec * RAD, a = ra * RAD, d = dec * RAD;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const k = 1 / Math.max(1e-6, cosc);
  const x = k * Math.cos(d) * Math.sin(a - a0);
  const y = k * (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0));
  return [x / RAD, y / RAD];
}

/** Turn angle at p1 (0 = straight on, 180 = straight back). Returns 0 when either leg is a tiny move. */
export function turnAngleDeg(p0: [number, number], p1: [number, number], p2: [number, number], hop1: number, hop2: number): number {
  if (hop1 < MIN_TURN_HOP_DEG || hop2 < MIN_TURN_HOP_DEG) return 0;
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
  const na = Math.hypot(ax, ay), nb = Math.hypot(bx, by);
  if (na < 1e-9 || nb < 1e-9) return 0;
  const cos = (ax * bx + ay * by) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / RAD;
}

/** Major eigenvector of the 2×2 covariance of the points (unit vector). */
export function principalAxis(points: [number, number][]): [number, number] {
  const n = points.length;
  if (n < 2) return [1, 0];
  let mx = 0, my = 0;
  for (const [x, y] of points) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(theta), Math.sin(theta)];
}

export interface PathGeometry {
  /** hops[k] = distance from stop k to stop k+1 (degrees). */
  hops: number[];
  pathDeg: number;
  maxHopDeg: number;
  /** turns[k] = turn angle at stop k+1 (between hop k and hop k+1). */
  turns: number[];
  sharpTurns: number;
  reversals: number;
  /**
   * Indices of hops that move back over covered ground: the hop after a sharp turn, and the hop that makes a
   * principal-axis reversal. Spec 4 allows one such back-track and only on a link of strength ≥ 0.85.
   */
  backtrackHops: number[];
  /** Max distance of a stop from the given cap centre (degrees). */
  maxFromCenter: number;
  /** Max distance of a stop from the stops' own centroid / radius (feature `cap_used`). */
  capUsed: number;
}

/** All path metrics of an ordered list of stops, in the tangent plane of `center`. */
export function pathGeometry(stops: RaDec[], center: RaDec, radius: number): PathGeometry {
  const vecs = stops.map((s) => unitVec(s.ra, s.dec));
  const pts = stops.map((s) => gnomonic(center, s.ra, s.dec));
  const hops: number[] = [];
  for (let k = 0; k + 1 < vecs.length; k++) hops.push(sepDeg(vecs[k], vecs[k + 1]));
  const turns: number[] = [];
  const backtrack = new Set<number>();
  let sharpTurns = 0;
  for (let k = 0; k + 2 < pts.length; k++) {
    const t = turnAngleDeg(pts[k], pts[k + 1], pts[k + 2], hops[k], hops[k + 1]);
    turns.push(t);
    if (t > SHARP_TURN_DEG) { sharpTurns++; backtrack.add(k + 1); }
  }
  // Principal-axis reversals (doc 05 §5.2).
  const u = principalAxis(pts);
  const s = pts.map(([x, y]) => x * u[0] + y * u[1]);
  let reversals = 0, lastSign = 0;
  for (let k = 0; k + 1 < s.length; k++) {
    const ds = s[k + 1] - s[k];
    if (Math.abs(ds) < REVERSAL_MIN_STEP_FRACTION * radius) continue;
    const sign = Math.sign(ds);
    if (lastSign !== 0 && sign !== lastSign) { reversals++; backtrack.add(k); }
    lastSign = sign;
  }
  const c = unitVec(center.ra, center.dec);
  const maxFromCenter = vecs.reduce((m, v) => Math.max(m, sepDeg(v, c)), 0);
  const centroid = meanPosition(stops);
  const cv = unitVec(centroid.ra, centroid.dec);
  const capUsed = vecs.reduce((m, v) => Math.max(m, sepDeg(v, cv)), 0) / radius;
  return {
    hops,
    pathDeg: hops.reduce((a, b) => a + b, 0),
    maxHopDeg: hops.reduce((a, b) => Math.max(a, b), 0),
    turns,
    sharpTurns,
    reversals,
    backtrackHops: Array.from(backtrack).sort((a, b) => a - b),
    maxFromCenter,
    capUsed,
  };
}

/** n roughly uniform points on the sphere (golden-angle spiral). */
export function fibonacciSphere(n: number): RaDec[] {
  const out: RaDec[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    const phi = i * golden;
    out.push(vecToRaDec([r * Math.cos(phi), r * Math.sin(phi), z]));
  }
  return out;
}

const COMPASS_WORDS: Record<Compass8, string> = {
  N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west',
};
const COMPASS: Compass8[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass8(az: number): Compass8 {
  return COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}
export function compassWord(az: number): string {
  return COMPASS_WORDS[compass8(az)];
}

/** "high in the south-east", "overhead", "low in the west". */
export function altAzPhrase(alt: number, az: number): string {
  if (alt >= 75) return 'overhead';
  const band = alt >= 50 ? 'high in the' : alt >= 30 ? 'in the' : 'low in the';
  return `${band} ${compassWord(az)}`;
}

// ───────────────────────────── patches ─────────────────────────────

export interface PatchInputObject {
  ra: number;
  dec: number;
  /** Feasible for at least one stop window tonight. */
  feasible: boolean;
  interest: number;
  concepts: readonly string[];
  con: string;
}

export interface Patch {
  id: string;
  ra: number;
  dec: number;
  radius: number;
  altDeg: number;
  azDeg: number;
  /** "high in the south-east" (used in titles). */
  shortLabel: string;
  /** "High in the south-east, around Orion" (regionCenter.label). */
  label: string;
  /** Indices (into the input array) of feasible objects inside the cap. */
  members: number[];
  score: number;
}

export interface PatchOptions {
  radius: number;
  minAlt: number;
  /** Alt/az of an equatorial position at the middle of the journey horizon. */
  altAz: (ra: number, dec: number) => { alt: number; az: number };
  moon: { up: boolean; ra: number; dec: number; illumination: number };
  maxPatches?: number;
  suppressDeg?: number;
  gridPoints?: number;
}

const smoothstep = (x: number, a: number, b: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** S2: candidate cap centres → score → non-max suppression (doc 05 §5.3). */
export function buildPatches(objects: readonly PatchInputObject[], opts: PatchOptions): Patch[] {
  const { radius, minAlt } = opts;
  const maxPatches = opts.maxPatches ?? 12;
  const suppress = opts.suppressDeg ?? 15;
  const feasibleIdx = objects.map((o, i) => (o.feasible ? i : -1)).filter((i) => i >= 0);
  if (feasibleIdx.length < 3) return [];
  const vecs = objects.map((o) => unitVec(o.ra, o.dec));
  const cosR = Math.cos(radius * RAD);

  const centres: RaDec[] = feasibleIdx.map((i) => ({ ra: objects[i].ra, dec: objects[i].dec }));
  for (const p of fibonacciSphere(opts.gridPoints ?? 400)) {
    if (opts.altAz(p.ra, p.dec).alt >= minAlt + 10) centres.push(p);
  }
  const moonVec = unitVec(opts.moon.ra, opts.moon.dec);

  type Scored = { c: RaDec; v: Vec3; members: number[]; score: number; alt: number; az: number };
  const scored: Scored[] = [];
  for (const c of centres) {
    const v = unitVec(c.ra, c.dec);
    const members: number[] = [];
    for (const i of feasibleIdx) {
      const w = vecs[i];
      if (v[0] * w[0] + v[1] * w[1] + v[2] * w[2] >= cosR - 1e-12) members.push(i);
    }
    if (members.length < 3) continue;
    const interests = members.map((i) => objects[i].interest).sort((a, b) => b - a).slice(0, 8);
    const concepts = new Set<string>();
    for (const i of members) for (const k of objects[i].concepts) concepts.add(k);
    const { alt, az } = opts.altAz(c.ra, c.dec);
    const moonPenalty = opts.moon.up && opts.moon.illumination > 0.5 && sepDeg(v, moonVec) < radius + 10 ? 1 : 0;
    const score = interests.reduce((a, b) => a + b, 0) + (0.5 * concepts.size) / 10 + 0.3 * smoothstep(alt, 40, 70) - moonPenalty;
    scored.push({ c, v, members, score: Math.round(score * 1e6) / 1e6, alt, az });
  }
  // Deterministic order: score, then position.
  scored.sort((a, b) => b.score - a.score || a.c.ra - b.c.ra || a.c.dec - b.c.dec);
  const kept: Scored[] = [];
  for (const s of scored) {
    if (kept.length >= maxPatches) break;
    if (kept.some((k) => sepDeg(k.v, s.v) < suppress)) continue;
    // A patch whose member set is already covered by a kept patch adds nothing.
    if (kept.some((k) => s.members.every((m) => k.members.includes(m)))) continue;
    kept.push(s);
  }
  return kept.map((s, n) => {
    const shortLabel = altAzPhrase(s.alt, s.az);
    const conWeight = new Map<string, number>();
    for (const i of s.members) conWeight.set(objects[i].con, (conWeight.get(objects[i].con) ?? 0) + 1 + objects[i].interest);
    const con = Array.from(conWeight.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const around = con ? `, around ${getConstellationName(con)}` : '';
    return {
      id: `P${n}`,
      ra: Math.round(s.c.ra * 1e4) / 1e4,
      dec: Math.round(s.c.dec * 1e4) / 1e4,
      radius,
      altDeg: s.alt,
      azDeg: s.az,
      shortLabel,
      label: shortLabel.charAt(0).toUpperCase() + shortLabel.slice(1) + around,
      members: s.members,
      score: s.score,
    };
  });
}
