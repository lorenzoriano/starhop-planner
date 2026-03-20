/**
 * Core astronomy engine for StarHop Planner.
 * Handles coordinate transforms, star catalog loading,
 * sky graph construction, and route planning.
 */
import * as Astro from 'astronomy-engine';
import { planRoute as planVariableReachRoute, type DifficultyLevel } from './route-planner';

// ─── Types ───────────────────────────────────────────────────

export interface Star {
  id: string;
  hr: number;
  ra: number;   // degrees
  dec: number;  // degrees
  mag: number;
  name?: string;
  bayer?: string;
  constellation?: string;
  flamsteed?: number;
}

export interface MessierObject {
  id: string;
  m: string;
  ngc?: string;
  type: string;
  mag: number;
  ra: number;
  dec: number;
  constellation: string;
  name?: string;
  size?: string;
}

// Categories for the expanded binocular catalog
export type BinocularCategory = 'DS' | 'AST' | 'OC' | 'GC' | 'EN' | 'PN' | 'SNR' | 'GAL';

export const BINOCULAR_CATEGORY_LABELS: Record<BinocularCategory, string> = {
  DS: 'Double Star',
  AST: 'Asterism',
  OC: 'Open Cluster',
  GC: 'Globular Cluster',
  EN: 'Emission Nebula',
  PN: 'Planetary Nebula',
  SNR: 'Supernova Remnant',
  GAL: 'Galaxy',
};

export const BINOCULAR_CATEGORY_SHORT: Record<BinocularCategory, string> = {
  DS: 'Dbl Star',
  AST: 'Asterism',
  OC: 'Open Cl.',
  GC: 'Glob. Cl.',
  EN: 'Nebula',
  PN: 'Plan. Neb.',
  SNR: 'SNR',
  GAL: 'Galaxy',
};

export interface BinocularTarget {
  id: string;
  cat: BinocularCategory;
  name: string;
  altId?: string;
  ra: number;
  dec: number;
  mag: number;
  mag2?: number;    // secondary magnitude for double stars
  sep?: number;     // separation in arcseconds for double stars
  con: string;
  size?: string;
  desc: string;
  binoTip: string;
}

export interface ConstellationLine {
  id: string;
  points: [number, number][][]; // arrays of [ra_deg, dec_deg] line segments
}

export interface SkyNode {
  id: string;
  ra: number;
  dec: number;
  alt: number;
  az: number;
  mag: number;
  name: string;
  type: 'star' | 'planet' | 'messier' | 'binocular';
  constellation?: string;
  bayer?: string;
  flamsteed?: number;
  binocularCategory?: BinocularCategory;
}

export type ObservingMode = 'telescope' | 'binocular';
export type PatternType =
  | 'triangle' | 'diamond' | 'trapezoid' | 'kite'
  | 'cross' | 'arrow' | 'arc' | 'zigzag'
  | 'chain' | 'bracket' | 'pair' | 'field';

export interface HopStep {
  center: { ra: number; dec: number; alt: number; az: number };
  visibleGuideStars: SkyNode[];
  pattern: string;
  patternType: PatternType;
  patternConfidence: number;
  patternScore: number;
  patternAnchors: SkyNode[];
  direction: string;
  distanceDeg: number;
  instruction: string;
}

export interface Route {
  id: string;
  score: number;
  startAnchor: SkyNode;
  target: SkyNode;
  hops: HopStep[];
}

export type { DifficultyLevel };

export interface ObservingParams {
  lat: number;
  lon: number;
  date: Date;
  fovWidth: number;
  fovHeight: number;
  fovShape: 'circle' | 'rectangle';
  limitingMag: number;
  numRoutes: number;
  targetId: string;
  observingMode?: ObservingMode;
  difficulty?: DifficultyLevel;
}

// ─── Parsing Utilities ────────────────────────────────────────

function parseRA(raStr: string): number {
  // "00h 05m 09.9s" -> degrees
  const m = raStr.match(/(\d+)h\s*(\d+(?:\.\d+)?)m?\s*(\d+(?:\.\d+)?)?s?/);
  if (!m) return 0;
  const h = parseFloat(m[1]);
  const min = parseFloat(m[2]);
  const sec = m[3] ? parseFloat(m[3]) : 0;
  return (h + min / 60 + sec / 3600) * 15;
}

function parseDec(decStr: string): number {
  // "+45° 13′ 45″" -> degrees
  const m = decStr.match(/([+-]?\d+)°\s*(\d+)[′']\s*(\d+(?:\.\d+)?)?[″"]?/);
  if (!m) return 0;
  const sign = decStr.startsWith('-') ? -1 : 1;
  const d = Math.abs(parseFloat(m[1]));
  const min = parseFloat(m[2]);
  const sec = m[3] ? parseFloat(m[3]) : 0;
  return sign * (d + min / 60 + sec / 3600);
}

// ─── Catalog Loading ─────────────────────────────────────────

// Dense star catalog type: [ra_deg, dec_deg, mag, bv_color_index]
export type DenseStar = [number, number, number, number];

let _stars: Star[] | null = null;
let _messier: MessierObject[] | null = null;
let _constellations: ConstellationLine[] | null = null;
let _binocularTargets: BinocularTarget[] | null = null;
let _denseStars: DenseStar[] | null = null;

export async function loadStars(): Promise<Star[]> {
  if (_stars) return _stars;
  const resp = await fetch('./data/bsc5-short.json');
  const raw = await resp.json();
  _stars = raw.map((s: any) => ({
    id: `HR${s.HR}`,
    hr: parseInt(s.HR),
    ra: parseRA(s.RA),
    dec: parseDec(s.Dec),
    mag: parseFloat(s.V),
    name: s.N || undefined,
    bayer: s.B || undefined,
    constellation: s.C || undefined,
    flamsteed: s.F ? parseInt(s.F) : undefined,
  }));
  return _stars!;
}

export async function loadMessier(): Promise<MessierObject[]> {
  if (_messier) return _messier;
  const resp = await fetch('./data/messier.json');
  const raw = await resp.json();
  _messier = raw.map((m: any) => ({
    id: m.M,
    m: m.M,
    ngc: m.NGC || undefined,
    type: m.T,
    mag: parseFloat(m.V),
    ra: parseRA(m.RA),
    dec: parseDec(m.Dec),
    constellation: m.Con,
    name: m.N || undefined,
    size: m.S || undefined,
  }));
  return _messier!;
}

export async function loadConstellations(): Promise<ConstellationLine[]> {
  if (_constellations) return _constellations;
  const resp = await fetch('./data/constellations.lines.json');
  const raw = await resp.json();
  _constellations = raw.features.map((f: any) => ({
    id: f.id,
    points: f.geometry.coordinates.map((line: number[][]) =>
      line.map(([ra, dec]: number[]) => [ra < 0 ? ra + 360 : ra, dec] as [number, number])
    ),
  }));
  return _constellations!;
}

export async function loadDenseStars(): Promise<DenseStar[]> {
  if (_denseStars) return _denseStars;
  const resp = await fetch('./data/stars-dense.json');
  _denseStars = await resp.json();
  return _denseStars!;
}

export async function loadBinocularTargets(): Promise<BinocularTarget[]> {
  if (_binocularTargets) return _binocularTargets;
  const resp = await fetch('./data/binocular-catalog.json');
  const raw = await resp.json();
  _binocularTargets = raw.map((t: any) => ({
    id: t.id,
    cat: t.cat as BinocularCategory,
    name: t.name,
    altId: t.altId || undefined,
    ra: parseRA(t.ra),
    dec: parseDec(t.dec),
    mag: typeof t.mag === 'string' ? parseFloat(t.mag) : t.mag,
    mag2: t.mag2 !== undefined ? (typeof t.mag2 === 'string' ? parseFloat(t.mag2) : t.mag2) : undefined,
    sep: t.sep,
    con: t.con,
    size: t.size ? String(t.size) : undefined,
    desc: t.desc,
    binoTip: t.binoTip,
  }));
  return _binocularTargets!;
}

/**
 * Returns the merged list of all selectable targets:
 * Messier objects + binocular catalog (excluding duplicates where a Messier ID already covers it).
 */
export interface UnifiedTarget {
  id: string;
  name: string;
  displayName: string; // short label for lists
  mag: number;
  ra: number;
  dec: number;
  con: string;
  category: string;       // human-readable category
  categoryShort: string;  // short badge label
  source: 'messier' | 'binocular';
  binoTip?: string;
  desc?: string;
}

export function buildUnifiedTargets(
  messier: MessierObject[],
  binocularTargets: BinocularTarget[]
): UnifiedTarget[] {
  const targets: UnifiedTarget[] = [];
  const usedIds = new Set<string>();

  // Messier catalog type labels
  const messierTypes: Record<string, string> = {
    OC: 'Open Cluster', GC: 'Globular Cluster', DN: 'Diffuse Nebula',
    PN: 'Planetary Nebula', SG: 'Spiral Galaxy', EG: 'Elliptical Galaxy',
    BG: 'Barred Galaxy', IG: 'Irregular Galaxy', LG: 'Lenticular Galaxy',
    SN: 'Supernova Remnant', DS: 'Double Star', AS: 'Asterism', MW: 'Milky Way Patch',
  };
  const messierTypesShort: Record<string, string> = {
    OC: 'Open Cl.', GC: 'Glob. Cl.', DN: 'Nebula',
    PN: 'Plan. Neb.', SG: 'Galaxy', EG: 'Galaxy',
    BG: 'Galaxy', IG: 'Galaxy', LG: 'Galaxy',
    SN: 'SNR', DS: 'Dbl Star', AS: 'Asterism', MW: 'MW Patch',
  };

  for (const m of messier) {
    usedIds.add(m.id);
    targets.push({
      id: m.id,
      name: m.name || m.id,
      displayName: `${m.id}${m.name ? ' — ' + m.name : ''}`,
      mag: m.mag,
      ra: m.ra,
      dec: m.dec,
      con: m.constellation,
      category: messierTypes[m.type] || m.type,
      categoryShort: messierTypesShort[m.type] || m.type,
      source: 'messier',
      desc: m.size ? `${messierTypes[m.type] || m.type}, ${m.size}'` : messierTypes[m.type] || m.type,
    });
  }

  for (const t of binocularTargets) {
    if (usedIds.has(t.id)) continue;
    usedIds.add(t.id);
    targets.push({
      id: t.id,
      name: t.name,
      displayName: t.name + (t.altId ? ` (${t.altId})` : ''),
      mag: t.mag,
      ra: t.ra,
      dec: t.dec,
      con: t.con,
      category: BINOCULAR_CATEGORY_LABELS[t.cat],
      categoryShort: BINOCULAR_CATEGORY_SHORT[t.cat],
      source: 'binocular',
      binoTip: t.binoTip,
      desc: t.desc,
    });
  }

  return targets;
}

// ─── Named Star Lookup ───────────────────────────────────────

const MAJOR_STAR_NAMES: Record<string, string> = {
  'Sirius': 'HR2491', 'Canopus': 'HR2326', 'Arcturus': 'HR5340',
  'Vega': 'HR7001', 'Capella': 'HR1708', 'Rigel': 'HR1713',
  'Procyon': 'HR2943', 'Betelgeuse': 'HR2061', 'Altair': 'HR7557',
  'Aldebaran': 'HR1457', 'Spica': 'HR5056', 'Antares': 'HR6134',
  'Pollux': 'HR2990', 'Fomalhaut': 'HR8728', 'Deneb': 'HR7924',
  'Regulus': 'HR3982', 'Castor': 'HR2891', 'Alpheratz': 'HR15',
  'Mirach': 'HR337', 'Almach': 'HR603',
  'Polaris': 'HR424', 'Dubhe': 'HR4301', 'Merak': 'HR4295',
};

// ─── Coordinate Transforms ──────────────────────────────────

export function eqToHorizontal(
  ra: number, dec: number, lat: number, lon: number, date: Date
): { alt: number; az: number } {
  const time = Astro.MakeTime(date);
  const observer = new Astro.Observer(lat, lon, 0);
  // Use the sidereal time approach
  const gast = Astro.SiderealTime(time);
  const lst = gast * 15 + lon; // local sidereal time in degrees
  let ha = lst - ra; // hour angle in degrees
  // Normalize
  while (ha < -180) ha += 360;
  while (ha > 180) ha -= 360;

  const haRad = ha * Math.PI / 180;
  const decRad = dec * Math.PI / 180;
  const latRad = lat * Math.PI / 180;

  const sinAlt = Math.sin(decRad) * Math.sin(latRad) + Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;

  const cosAz = (Math.sin(decRad) - Math.sin(alt * Math.PI / 180) * Math.sin(latRad)) / (Math.cos(alt * Math.PI / 180) * Math.cos(latRad));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
  if (Math.sin(haRad) > 0) az = 360 - az;

  return { alt, az };
}

/**
 * Find the next future date/time (within maxDays) when a target is ≥ 30°
 * above the horizon during astronomical darkness (sun altitude < −18°).
 *
 * Scans each calendar day (UTC noon-to-next-noon) in 30-minute steps.
 * Returns the midpoint of the longest qualifying contiguous window (≥ 1.5 h),
 * or null if no such window exists within maxDays.
 */
export function findBestObservingTime(
  ra: number,
  dec: number,
  lat: number,
  lon: number,
  startDate: Date,
  maxDays = 365,
): { date: Date; alt: number } | null {
  const observer = new Astro.Observer(lat, lon, 0);

  for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
    // Sample a full 24-hour window starting at UTC noon — spans the complete
    // astronomical night at any longitude. Sun-altitude filter removes daytime.
    const windowStartMs = Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate() + dayOffset,
      12, 0, 0, 0,
    );

    const qualifying: Array<{ time: Date; alt: number }> = [];

    for (let step = 0; step < 48; step++) {
      const sampleTime = new Date(windowStartMs + step * 30 * 60 * 1000);

      // On day 0, skip samples that predate startDate
      if (dayOffset === 0 && sampleTime < startDate) continue;

      // Target altitude — must be ≥ 30°
      const { alt: targetAlt } = eqToHorizontal(ra, dec, lat, lon, sampleTime);
      if (targetAlt < 30) continue;

      // Sun altitude — must be < −18° (astronomical darkness)
      // Astro.Equator returns ra in sidereal hours; Astro.Horizon accepts hours directly.
      const astroTime = Astro.MakeTime(sampleTime);
      const sunEq = Astro.Equator(Astro.Body.Sun, astroTime, observer, true, true);
      const sunHor = Astro.Horizon(astroTime, observer, sunEq.ra, sunEq.dec, 'normal');
      if (sunHor.altitude >= -18) continue;

      qualifying.push({ time: sampleTime, alt: targetAlt });
    }

    if (qualifying.length === 0) continue;

    // Find the longest contiguous run (consecutive pairs exactly 30 min apart).
    // Require ≥ 3 samples (1.5 h) to avoid suggesting a barely-visible window.
    let longestRun: Array<{ time: Date; alt: number }> = [];
    let currentRun: Array<{ time: Date; alt: number }> = [qualifying[0]];

    for (let i = 1; i < qualifying.length; i++) {
      const gapMs = qualifying[i].time.getTime() - qualifying[i - 1].time.getTime();
      if (gapMs === 30 * 60 * 1000) {
        currentRun.push(qualifying[i]);
      } else {
        if (currentRun.length > longestRun.length) longestRun = currentRun;
        currentRun = [qualifying[i]];
      }
    }
    if (currentRun.length > longestRun.length) longestRun = currentRun;

    if (longestRun.length < 3) continue;

    const midpoint = longestRun[Math.floor(longestRun.length / 2)];
    return { date: midpoint.time, alt: midpoint.alt };
  }

  return null;
}

export function getPlanetPositions(lat: number, lon: number, date: Date): SkyNode[] {
  const time = Astro.MakeTime(date);
  const observer = new Astro.Observer(lat, lon, 0);
  const planets: SkyNode[] = [];

  const planetsToTrack = [
    { body: Astro.Body.Mercury, name: 'Mercury' },
    { body: Astro.Body.Venus, name: 'Venus' },
    { body: Astro.Body.Mars, name: 'Mars' },
    { body: Astro.Body.Jupiter, name: 'Jupiter' },
    { body: Astro.Body.Saturn, name: 'Saturn' },
  ];
  const planetMags: Record<string, number> = {
    Mercury: 0.0, Venus: -4.0, Mars: 1.0, Jupiter: -2.5, Saturn: 0.5
  };

  for (const { body, name } of planetsToTrack) {
    try {
      const eq = Astro.Equator(body, time, observer, true, true);
      const hor = Astro.Horizon(time, observer, eq.ra, eq.dec, 'normal');
      if (hor.altitude > 5) {
        planets.push({
          id: `planet-${name}`,
          ra: eq.ra * 15, // hours to degrees
          dec: eq.dec,
          alt: hor.altitude,
          az: hor.azimuth,
          mag: planetMags[name] ?? 0,
          name: name as string,
          type: 'planet',
        });
      }
    } catch {
      // skip if position can't be computed
    }
  }
  return planets;
}

// ─── Angular Distance ────────────────────────────────────────

export function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const r1 = ra1 * Math.PI / 180;
  const d1 = dec1 * Math.PI / 180;
  const r2 = ra2 * Math.PI / 180;
  const d2 = dec2 * Math.PI / 180;
  const cosD = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  return Math.acos(Math.max(-1, Math.min(1, cosD))) * 180 / Math.PI;
}

export function directionBetween(ra1: number, dec1: number, ra2: number, dec2: number): string {
  const dra = ra2 - ra1;
  const ddec = dec2 - dec1;
  // Correct for RA wrapping
  let draCorr = dra;
  if (draCorr > 180) draCorr -= 360;
  if (draCorr < -180) draCorr += 360;
  // In sky terms: increasing RA = east, decreasing = west
  // Increasing dec = north, decreasing = south
  const dirs: string[] = [];
  if (ddec > 0.5) dirs.push('north');
  else if (ddec < -0.5) dirs.push('south');
  // RA increases to the east
  if (draCorr > 0.5) dirs.push('east');
  else if (draCorr < -0.5) dirs.push('west');
  if (dirs.length === 0) return 'same position';
  return dirs.join('-');
}

function compassDirection(az1: number, az2: number): string {
  let diff = az2 - az1;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  if (Math.abs(diff) < 10) return 'straight ahead';
  const dirs: string[] = [];
  // Simplified compass
  if (diff > 0) dirs.push('right');
  else dirs.push('left');
  return dirs.join('');
}

// ─── FOV Check ───────────────────────────────────────────────

export function fitsInFov(
  centerRa: number, centerDec: number,
  pointRa: number, pointDec: number,
  fovWidth: number, fovHeight: number,
  shape: 'circle' | 'rectangle'
): boolean {
  if (shape === 'circle') {
    return angularDistance(centerRa, centerDec, pointRa, pointDec) <= fovWidth / 2;
  }
  // Rectangle: check RA and Dec separately (simple approximation)
  let dra = Math.abs(pointRa - centerRa);
  if (dra > 180) dra = 360 - dra;
  dra *= Math.cos(centerDec * Math.PI / 180);
  const ddec = Math.abs(pointDec - centerDec);
  return dra <= fovWidth / 2 && ddec <= fovHeight / 2;
}

// ─── Sky Graph & Route Planning ─────────────────────────────

function buildSkyNodes(
  stars: Star[],
  messier: MessierObject[],
  params: ObservingParams,
  binocularTargets?: BinocularTarget[]
): SkyNode[] {
  const nodes: SkyNode[] = [];
  const { lat, lon, date, limitingMag } = params;
  const addedIds = new Set<string>();

  // Add bright stars
  for (const star of stars) {
    if (star.mag > limitingMag) continue;
    const { alt, az } = eqToHorizontal(star.ra, star.dec, lat, lon, date);
    if (alt < 5) continue; // below horizon
    addedIds.add(star.id);
    nodes.push({
      id: star.id,
      ra: star.ra,
      dec: star.dec,
      alt, az,
      mag: star.mag,
      name: star.name || star.bayer || `HR${star.hr}`,
      type: 'star',
      constellation: star.constellation,
      bayer: star.bayer,
      flamsteed: star.flamsteed,
    });
  }

  // Add planets
  const planets = getPlanetPositions(lat, lon, date);
  nodes.push(...planets);

  // Add Messier objects
  for (const m of messier) {
    const { alt, az } = eqToHorizontal(m.ra, m.dec, lat, lon, date);
    if (alt < 5) continue;
    addedIds.add(m.id);
    nodes.push({
      id: m.id,
      ra: m.ra,
      dec: m.dec,
      alt, az,
      mag: m.mag,
      name: m.name || m.m,
      type: 'messier',
      constellation: m.constellation,
    });
  }

  // Add binocular catalog targets (non-duplicates)
  if (binocularTargets) {
    for (const t of binocularTargets) {
      if (addedIds.has(t.id)) continue;
      const { alt, az } = eqToHorizontal(t.ra, t.dec, lat, lon, date);
      if (alt < 5) continue;
      addedIds.add(t.id);
      // Extract Bayer designation from altId if it starts with a Greek letter
      const altFirst = t.altId ? t.altId.split(/\s+/)[0] : undefined;
      const bayerFromAlt = altFirst && altFirst.charCodeAt(0) > 0x0370 ? altFirst : undefined;
      nodes.push({
        id: t.id,
        ra: t.ra,
        dec: t.dec,
        alt, az,
        mag: t.mag,
        name: t.name,
        type: 'binocular',
        constellation: t.con,
        bayer: bayerFromAlt,
        binocularCategory: t.cat,
      });
    }
  }

  return nodes;
}

interface GraphEdge {
  from: string;
  to: string;
  cost: number;
  dist: number;
}

export interface PatternAnalysis {
  type: PatternType;
  description: string;
  score: number;
  confidence: number;
  anchors: SkyNode[];
}

function normalizedRaDelta(ra1: number, ra2: number): number {
  let delta = ra2 - ra1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function localOffset(from: SkyNode, to: SkyNode): { x: number; y: number; dist: number } {
  const x = normalizedRaDelta(from.ra, to.ra) * Math.cos(((from.dec + to.dec) / 2) * Math.PI / 180);
  const y = to.dec - from.dec;
  return { x, y, dist: Math.sqrt(x * x + y * y) };
}

function angleBetweenVectors(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const aMag = Math.sqrt(a.x * a.x + a.y * a.y);
  const bMag = Math.sqrt(b.x * b.x + b.y * b.y);
  if (aMag < 1e-6 || bMag < 1e-6) return 0;
  const cosTheta = (a.x * b.x + a.y * b.y) / (aMag * bMag);
  return Math.acos(Math.max(-1, Math.min(1, cosTheta))) * 180 / Math.PI;
}

// Order 4 stars by angle from centroid for correct polygon winding
function convexHullOrder4(stars: SkyNode[], center: SkyNode): SkyNode[] {
  const withAngle = stars.map(s => {
    const off = localOffset(center, s);
    return { star: s, angle: Math.atan2(off.y, off.x) };
  });
  withAngle.sort((a, b) => a.angle - b.angle);
  return withAngle.map(w => w.star);
}

// Sign of cross product (b-a) x (c-a) — positive = left turn, negative = right turn
function crossProduct2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Check if segment p1-p2 is roughly parallel to segment p3-p4
function linesApproximatelyParallel(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
  toleranceDeg: number,
): boolean {
  const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
  const angle2 = Math.atan2(p4.y - p3.y, p4.x - p3.x) * 180 / Math.PI;
  let diff = Math.abs(angle1 - angle2) % 180;
  if (diff > 90) diff = 180 - diff;
  return diff < toleranceDeg;
}

// Fit a circular arc through 3+ points; returns radius and curvature consistency
function fitCircularArc(
  points: { x: number; y: number }[],
): { radius: number; consistency: number } | null {
  if (points.length < 3) return null;
  const radii: number[] = [];
  for (let i = 0; i < points.length - 2; i++) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
    const dAB = Math.hypot(b.x - a.x, b.y - a.y);
    const dBC = Math.hypot(c.x - b.x, c.y - b.y);
    const dAC = Math.hypot(c.x - a.x, c.y - a.y);
    const s = (dAB + dBC + dAC) / 2;
    const area = Math.sqrt(Math.max(0, s * (s - dAB) * (s - dBC) * (s - dAC)));
    if (area < 1e-6) return null; // degenerate (collinear)
    radii.push((dAB * dBC * dAC) / (4 * area));
  }
  const avgRadius = radii.reduce((s, r) => s + r, 0) / radii.length;
  const variance = radii.reduce((s, r) => s + (r - avgRadius) ** 2, 0) / radii.length;
  const consistency = 1 - Math.min(1, Math.sqrt(variance) / Math.max(avgRadius, 0.001));
  return { radius: avgRadius, consistency };
}

// Compact label for pattern descriptions (no access to full constellation name map here)
function patternLabel(n: SkyNode): string {
  const hasProperName = n.name && n.name.length > 2 && !n.name.startsWith('HR')
    && n.name !== n.bayer;
  if (hasProperName) return n.name;
  if (n.bayer && n.constellation) return `${n.bayer} ${n.constellation}`;
  if (n.flamsteed && n.constellation) return `${n.flamsteed} ${n.constellation}`;
  if (n.constellation) return `a mag-${n.mag.toFixed(1)} star`;
  if (n.name && !n.name.startsWith('HR')) return n.name;
  return `a mag-${n.mag.toFixed(1)} star`;
}

export function inferPattern(center: SkyNode, visible: SkyNode[]): PatternAnalysis {
  if (visible.length === 0) {
    return {
      type: 'field',
      description: 'Sparse field with few obvious guide stars',
      score: 20,
      confidence: 0.2,
      anchors: [],
    };
  }

  const sorted = [...visible].sort((a, b) => a.mag - b.mag);
  const top = sorted.slice(0, Math.min(5, sorted.length));
  const primary = top[0];

  let best: PatternAnalysis = {
    type: top.length >= 2 ? 'pair' : 'field',
    description: top.length >= 2
      ? `${patternLabel(primary)} and ${patternLabel(top[1])} frame the hop`
      : `${patternLabel(primary)} is the main guide star in the field`,
    score: top.length >= 2 ? 48 : 32,
    confidence: top.length >= 2 ? 0.55 : 0.45,
    anchors: top.slice(0, Math.min(2, top.length)),
  };

  if (top.length >= 3) {
    for (let i = 0; i < top.length - 2; i++) {
      for (let j = i + 1; j < top.length - 1; j++) {
        for (let k = j + 1; k < top.length; k++) {
          const stars = [top[i], top[j], top[k]];
          const offsets = stars.map((star) => localOffset(center, star));
          const d01 = angularDistance(stars[0].ra, stars[0].dec, stars[1].ra, stars[1].dec);
          const d12 = angularDistance(stars[1].ra, stars[1].dec, stars[2].ra, stars[2].dec);
          const d02 = angularDistance(stars[0].ra, stars[0].dec, stars[2].ra, stars[2].dec);
          const sideLengths = [d01, d12, d02].sort((a, b) => a - b);
          const angles = [
            angleBetweenVectors(offsets[0], offsets[1]),
            angleBetweenVectors(offsets[0], offsets[2]),
            angleBetweenVectors(offsets[1], offsets[2]),
          ].sort((a, b) => a - b);
          const perimeter = sideLengths[0] + sideLengths[1] + sideLengths[2];
          const brightness = stars.reduce((sum, star) => sum + Math.max(0, 6 - star.mag), 0) / stars.length;

          const triangleBalance = 1 - Math.min(1, (sideLengths[2] - sideLengths[0]) / Math.max(sideLengths[2], 0.001));
          const triangleSeparation = perimeter > 3 ? 1 : perimeter / 3;
          const triangleScore = 52 + triangleBalance * 26 + triangleSeparation * 10 + brightness * 1.5;
          if (angles[0] > 28 && triangleScore > best.score) {
            best = {
              type: 'triangle',
              description: `${patternLabel(stars[0])}, ${patternLabel(stars[1])}, and ${patternLabel(stars[2])} form a triangle around the hop`,
              score: triangleScore,
              confidence: Math.min(0.98, 0.55 + triangleBalance * 0.25 + triangleSeparation * 0.15),
              anchors: stars,
            };
          }

          const longest = sideLengths[2];
          const shortest = sideLengths[0];
          const chainTightness = longest > 0 ? shortest / longest : 0;
          const chainAngle = angles[2];
          const chainScore = 46 + (1 - chainTightness) * 28 + Math.max(0, (chainAngle - 150) / 30) * 12 + brightness * 1.4;
          if (chainAngle > 155 && chainScore > best.score) {
            const ordered = [...stars].sort((a, b) => {
              const aOffset = localOffset(center, a);
              const bOffset = localOffset(center, b);
              return aOffset.x + aOffset.y - (bOffset.x + bOffset.y);
            });
            best = {
              type: 'chain',
              description: `${ordered.map((star) => patternLabel(star)).join(' → ')} make a chain pointing through the field`,
              score: chainScore,
              confidence: Math.min(0.96, 0.5 + Math.max(0, (chainAngle - 150) / 40) + (1 - chainTightness) * 0.18),
              anchors: ordered,
            };
          }

          // Arc detection: curved path (not straight like chain, not wide like triangle)
          if (chainAngle >= 100 && chainAngle <= 155) {
            const arcPoints = stars.map(s => localOffset(center, s));
            const arcFit = fitCircularArc(arcPoints);
            if (arcFit && arcFit.consistency > 0.6) {
              // Check middle star deviates from chord
              const chordLen = Math.hypot(arcPoints[2].x - arcPoints[0].x, arcPoints[2].y - arcPoints[0].y);
              const midChordX = (arcPoints[0].x + arcPoints[2].x) / 2;
              const midChordY = (arcPoints[0].y + arcPoints[2].y) / 2;
              const deviation = Math.hypot(arcPoints[1].x - midChordX, arcPoints[1].y - midChordY);
              if (chordLen > 0.5 && deviation / chordLen > 0.08) {
                const arcScore = 48 + arcFit.consistency * 22 + brightness * 1.4 + Math.min(1, deviation / chordLen) * 8;
                if (arcScore > best.score) {
                  const ordered = [...stars].sort((a, b) => {
                    const ao = localOffset(center, a);
                    const bo = localOffset(center, b);
                    return ao.x + ao.y - (bo.x + bo.y);
                  });
                  best = {
                    type: 'arc',
                    description: `${ordered.map(s => patternLabel(s)).join(' → ')} trace a curved arc`,
                    score: arcScore,
                    confidence: Math.min(0.90, 0.52 + arcFit.consistency * 0.25 + Math.min(1, deviation / chordLen) * 0.12),
                    anchors: ordered,
                  };
                }
              }
            }
          }

          // Arrow detection: V-shape with a "tip" star
          for (let tipIdx = 0; tipIdx < 3; tipIdx++) {
            const tip = stars[tipIdx];
            const wings = stars.filter((_, idx) => idx !== tipIdx);
            const tipOff = localOffset(center, tip);
            const w0Off = localOffset(center, wings[0]);
            const w1Off = localOffset(center, wings[1]);
            const v0 = { x: w0Off.x - tipOff.x, y: w0Off.y - tipOff.y };
            const v1 = { x: w1Off.x - tipOff.x, y: w1Off.y - tipOff.y };
            const tipAngle = angleBetweenVectors(v0, v1);
            const d0 = Math.hypot(v0.x, v0.y);
            const d1 = Math.hypot(v1.x, v1.y);
            const wingBalance = Math.min(d0, d1) / Math.max(d0, d1, 0.001);
            if (tipAngle >= 25 && tipAngle <= 85 && wingBalance > 0.55) {
              const symmetry = 1 - Math.abs(d0 - d1) / Math.max(d0, d1, 0.001);
              const arrowScore = 56 + symmetry * 18 + wingBalance * 10 + brightness * 1.3;
              if (arrowScore > best.score) {
                best = {
                  type: 'arrow',
                  description: `${patternLabel(wings[0])} and ${patternLabel(wings[1])} point toward ${patternLabel(tip)}`,
                  score: arrowScore,
                  confidence: Math.min(0.88, 0.52 + symmetry * 0.2 + wingBalance * 0.15),
                  anchors: [wings[0], wings[1], tip], // [wing1, wing2, tip] for SVG rendering
                };
              }
            }
          }
        }
      }
    }
  }

  // ── 4-star pattern detection (diamond, trapezoid, kite, cross) ──
  if (top.length >= 4) {
    for (let a = 0; a < top.length - 3; a++) {
      for (let b = a + 1; b < top.length - 2; b++) {
        for (let c = b + 1; c < top.length - 1; c++) {
          for (let d = c + 1; d < top.length; d++) {
            const quad = [top[a], top[b], top[c], top[d]];
            const ordered = convexHullOrder4(quad, center);
            const offs = ordered.map(s => localOffset(center, s));
            const brightness4 = quad.reduce((sum, s) => sum + Math.max(0, 6 - s.mag), 0) / 4;

            // Side lengths (consecutive in ordered quad)
            const sides = [0, 1, 2, 3].map(i => {
              const ni = (i + 1) % 4;
              return angularDistance(ordered[i].ra, ordered[i].dec, ordered[ni].ra, ordered[ni].dec);
            });
            // Diagonals
            const diag1 = angularDistance(ordered[0].ra, ordered[0].dec, ordered[2].ra, ordered[2].dec);
            const diag2 = angularDistance(ordered[1].ra, ordered[1].dec, ordered[3].ra, ordered[3].dec);

            const sortedSides = [...sides].sort((x, y) => x - y);
            const sideRatio = sortedSides[0] / Math.max(sortedSides[3], 0.001);
            const diagRatio = Math.min(diag1, diag2) / Math.max(diag1, diag2, 0.001);

            // Interior angles at each vertex
            const interiorAngles = [0, 1, 2, 3].map(i => {
              const prev = (i + 3) % 4;
              const next = (i + 1) % 4;
              const vPrev = { x: offs[prev].x - offs[i].x, y: offs[prev].y - offs[i].y };
              const vNext = { x: offs[next].x - offs[i].x, y: offs[next].y - offs[i].y };
              return angleBetweenVectors(vPrev, vNext);
            });
            const minAngle = Math.min(...interiorAngles);

            // Diamond: all 4 sides roughly equal (4-star patterns get higher base for using more stars)
            if (sideRatio > 0.6 && diagRatio >= 0.4 && diagRatio <= 2.5 && minAngle > 40) {
              const diamondScore = 62 + sideRatio * 22 + brightness4 * 1.5 + Math.min(1, (minAngle - 40) / 50) * 8;
              if (diamondScore > best.score) {
                best = {
                  type: 'diamond',
                  description: `${ordered.map(s => patternLabel(s)).join(', ')} form a diamond`,
                  score: diamondScore,
                  confidence: Math.min(0.96, 0.58 + sideRatio * 0.22 + Math.min(1, (minAngle - 40) / 60) * 0.14),
                  anchors: ordered,
                };
              }
            }

            // Trapezoid: one pair of opposite sides roughly parallel
            for (const [pair1, pair2] of [
              [[0, 1], [2, 3]], [[1, 2], [3, 0]], [[0, 3], [1, 2]],
            ] as [number[], number[]][]) {
              const p1 = offs[pair1[0]], p2 = offs[pair1[1]];
              const p3 = offs[pair2[0]], p4 = offs[pair2[1]];
              if (linesApproximatelyParallel(p1, p2, p3, p4, 20) &&
                  !linesApproximatelyParallel(offs[pair1[0]], offs[pair2[0]], offs[pair1[1]], offs[pair2[1]], 30)) {
                // Compute parallelism quality (how close to 0 the angle diff is)
                const ang1 = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
                const ang2 = Math.atan2(p4.y - p3.y, p4.x - p3.x) * 180 / Math.PI;
                let parallelism = Math.abs(ang1 - ang2) % 180;
                if (parallelism > 90) parallelism = 180 - parallelism;
                parallelism = 1 - parallelism / 20; // 1.0 = perfect parallel, 0.0 = 20° off

                const trapScore = 60 + parallelism * 22 + brightness4 * 1.5 + Math.min(1, (minAngle - 30) / 50) * 8;
                if (minAngle > 30 && trapScore > best.score) {
                  best = {
                    type: 'trapezoid',
                    description: `${ordered.map(s => patternLabel(s)).join(', ')} form a trapezoid`,
                    score: trapScore,
                    confidence: Math.min(0.94, 0.56 + parallelism * 0.24 + Math.min(1, (minAngle - 30) / 60) * 0.12),
                    anchors: ordered,
                  };
                }
                break; // only need one parallel pair
              }
            }

            // Kite: two pairs of adjacent sides equal
            for (let start = 0; start < 4; start++) {
              const s0 = sides[start];
              const s1 = sides[(start + 1) % 4];
              const s2 = sides[(start + 2) % 4];
              const s3 = sides[(start + 3) % 4];
              const adj1Ratio = Math.min(s0, s3) / Math.max(s0, s3, 0.001);
              const adj2Ratio = Math.min(s1, s2) / Math.max(s1, s2, 0.001);
              if (adj1Ratio > 0.8 && adj2Ratio > 0.8 && Math.abs(s0 - s1) / Math.max(s0, s1, 0.001) > 0.15) {
                const symmetry = (adj1Ratio + adj2Ratio) / 2;
                const kiteScore = 62 + symmetry * 20 + brightness4 * 1.4 + Math.min(1, (minAngle - 25) / 50) * 8;
                if (minAngle > 25 && kiteScore > best.score) {
                  best = {
                    type: 'kite',
                    description: `${ordered.map(s => patternLabel(s)).join(', ')} form a kite shape`,
                    score: kiteScore,
                    confidence: Math.min(0.92, 0.55 + symmetry * 0.22 + Math.min(1, (minAngle - 25) / 60) * 0.12),
                    anchors: ordered,
                  };
                }
                break;
              }
            }
          }
        }
      }
    }

    // Cross detection: find two perpendicular line segments among top stars
    for (let i = 0; i < top.length - 1; i++) {
      for (let j = i + 1; j < top.length; j++) {
        for (let k = j + 1; k < top.length - 1; k++) {
          for (let l = k + 1; l < top.length; l++) {
            // Try (i,j) vs (k,l) as two arms
            const oi = localOffset(center, top[i]);
            const oj = localOffset(center, top[j]);
            const ok = localOffset(center, top[k]);
            const ol = localOffset(center, top[l]);
            const dir1 = { x: oj.x - oi.x, y: oj.y - oi.y };
            const dir2 = { x: ol.x - ok.x, y: ol.y - ok.y };
            const angle = angleBetweenVectors(dir1, dir2);
            const perpDeviation = Math.abs(angle - 90);
            if (perpDeviation < 20) {
              // Check midpoints are close
              const mid1 = { x: (oi.x + oj.x) / 2, y: (oi.y + oj.y) / 2 };
              const mid2 = { x: (ok.x + ol.x) / 2, y: (ok.y + ol.y) / 2 };
              const midDist = Math.hypot(mid1.x - mid2.x, mid1.y - mid2.y);
              if (midDist < 1.5) {
                const perpQuality = 1 - perpDeviation / 20;
                const intersectQuality = Math.max(0, 1 - midDist / 1.5);
                const crossBrightness = [top[i], top[j], top[k], top[l]].reduce((sum, s) => sum + Math.max(0, 6 - s.mag), 0) / 4;
                const crossScore = 62 + perpQuality * 20 + intersectQuality * 10 + crossBrightness * 1.5;
                if (crossScore > best.score) {
                  best = {
                    type: 'cross',
                    description: `${patternLabel(top[i])}–${patternLabel(top[j])} and ${patternLabel(top[k])}–${patternLabel(top[l])} form a cross`,
                    score: crossScore,
                    confidence: Math.min(0.95, 0.58 + perpQuality * 0.22 + intersectQuality * 0.14),
                    anchors: [top[i], top[j], top[k], top[l]], // [arm1-start, arm1-end, arm2-start, arm2-end]
                  };
                }
              }
            }
          }
        }
      }
    }
  }

  // ── Zigzag detection (4-5 stars with alternating turns) ──
  if (top.length >= 4) {
    // Sort stars along principal axis
    const allOffs = top.map(s => ({ star: s, off: localOffset(center, s) }));
    // PCA-lite: sort by the dominant axis
    const xRange = Math.max(...allOffs.map(o => o.off.x)) - Math.min(...allOffs.map(o => o.off.x));
    const yRange = Math.max(...allOffs.map(o => o.off.y)) - Math.min(...allOffs.map(o => o.off.y));
    allOffs.sort((a, b) => xRange >= yRange
      ? a.off.x - b.off.x
      : a.off.y - b.off.y);

    for (let count = Math.min(5, allOffs.length); count >= 4; count--) {
      const subset = allOffs.slice(0, count);
      let alternating = true;
      let prevSign = 0;
      let minTurnAngle = 180;
      for (let i = 0; i < subset.length - 2; i++) {
        const cp = crossProduct2D(subset[i].off, subset[i + 1].off, subset[i + 2].off);
        const sign = cp > 0 ? 1 : cp < 0 ? -1 : 0;
        if (sign === 0) { alternating = false; break; }
        if (prevSign !== 0 && sign === prevSign) { alternating = false; break; }
        prevSign = sign;
        // Compute turn angle
        const v1 = { x: subset[i + 1].off.x - subset[i].off.x, y: subset[i + 1].off.y - subset[i].off.y };
        const v2 = { x: subset[i + 2].off.x - subset[i + 1].off.x, y: subset[i + 2].off.y - subset[i + 1].off.y };
        const turnAngle = 180 - angleBetweenVectors(v1, v2);
        minTurnAngle = Math.min(minTurnAngle, turnAngle);
      }
      if (alternating && minTurnAngle > 25) {
        const brightness = subset.reduce((sum, o) => sum + Math.max(0, 6 - o.star.mag), 0) / subset.length;
        const turnConsistency = Math.min(1, minTurnAngle / 60);
        const zigzagScore = 58 + turnConsistency * 20 + brightness * 1.3 + (count - 4) * 12;
        if (zigzagScore > best.score) {
          best = {
            type: 'zigzag',
            description: `${subset.map(o => patternLabel(o.star)).join(' ↔ ')} trace a zigzag`,
            score: zigzagScore,
            confidence: Math.min(0.88, 0.50 + turnConsistency * 0.22 + Math.min(1, minTurnAngle / 80) * 0.15),
            anchors: subset.map(o => o.star),
          };
        }
        break; // prefer longer zigzag, so try 5 first then 4
      }
    }
  }

  if (top.length >= 2) {
    for (let i = 0; i < top.length - 1; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i];
        const b = top[j];
        const oa = localOffset(center, a);
        const ob = localOffset(center, b);
        const sep = angularDistance(a.ra, a.dec, b.ra, b.dec);
        const midpointDist = Math.sqrt(((oa.x + ob.x) / 2) ** 2 + ((oa.y + ob.y) / 2) ** 2);
        const sideBalance = 1 - Math.min(1, Math.abs(oa.dist - ob.dist) / Math.max(Math.max(oa.dist, ob.dist), 0.001));
        const opening = angleBetweenVectors(oa, ob);
        // Bracket is a 2-star flanking pattern — should lose to 3+ star patterns
        const bracketScore = 50 + sideBalance * 16 + Math.max(0, Math.min(opening, 140) - 70) / 40 * 8 + Math.max(0, 2 - midpointDist) * 4;
        if (opening >= 75 && opening <= 160 && sideBalance > 0.45 && sep > 1.2 && bracketScore > best.score) {
          best = {
            type: 'bracket',
            description: `${patternLabel(a)} and ${patternLabel(b)} bracket the next move`,
            score: bracketScore,
            confidence: Math.min(0.95, 0.54 + sideBalance * 0.25 + Math.max(0, (opening - 75) / 90) * 0.18),
            anchors: [a, b],
          };
        }
      }
    }
  }

  return best;
}

function observingProfile(params: ObservingParams) {
  const mode = params.observingMode || 'telescope';
  // FOV-overlap star hopping: consecutive hop views must overlap.
  // Max hop = ~80% of FOV so ~20% overlap minimum.
  // Preferred hop = 40-70% of FOV so ~30-60% overlap.
  // We also allow a "stretch" zone up to 1.0× FOV with heavy penalty.
  // The graph maxHopDist is set wider to allow reaching across sparse regions,
  // but the cost function makes hops beyond 1× FOV extremely expensive.
  if (mode === 'binocular') {
    return {
      mode,
      preferredHopFovRange: [0.3, 0.7] as const,  // 30-70% of FOV (sweet spot with good overlap)
      maxHopDist: Math.max(params.fovWidth * 1.5, 8), // graph connectivity — tight for overlap
      overlapMaxFovRatio: 0.85,  // hops above this ratio get steep penalty
      navMagLimit: Math.min(params.limitingMag, 6.5),
      anchorMagLimit: 3.4,
      targetAnchorDistance: 65,
      dimPenaltyMultiplier: 1.35,
      namedBonus: 0.82,
      lowAltPenalty: 1.2,
      patternWeight: 0.12,
      confusionPenalty: 0.18,
      pairPenalty: 5,
      sparsePenalty: 9,
    };
  }

  return {
    mode,
    preferredHopFovRange: [0.3, 0.7] as const,  // 30-70% of FOV (sweet spot with good overlap)
    maxHopDist: Math.max(params.fovWidth * 1.5, 10), // graph connectivity — tight for overlap
    overlapMaxFovRatio: 0.85,  // hops above this ratio get steep penalty
    navMagLimit: Math.min(params.limitingMag, 6.5),
    anchorMagLimit: 2.5,
    targetAnchorDistance: 50,
    dimPenaltyMultiplier: 1,
    namedBonus: 0.7,
    lowAltPenalty: 1.5,
    patternWeight: 0.08,
    confusionPenalty: 0.12,
    pairPenalty: 3,
    sparsePenalty: 6,
  };
}

function buildGraph(
  nodes: SkyNode[],
  params: ObservingParams
): { nodeMap: Map<string, SkyNode>; edges: GraphEdge[] } {
  const nodeMap = new Map<string, SkyNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const edges: GraphEdge[] = [];
  const profile = observingProfile(params);
  const maxHopDist = profile.maxHopDist;

  // Pre-filter: keep moderately bright navigation stars plus deep-sky objects and planets.
  const navMagLimit = profile.navMagLimit;
  const navNodes = nodes.filter(n => n.mag < navMagLimit || n.type === 'messier' || n.type === 'binocular' || n.type === 'planet');

  for (let i = 0; i < navNodes.length; i++) {
    for (let j = i + 1; j < navNodes.length; j++) {
      const dist = angularDistance(navNodes[i].ra, navNodes[i].dec, navNodes[j].ra, navNodes[j].dec);
      if (dist > maxHopDist) continue;

      // Cost: FOV-overlap-aware. Consecutive hop views should overlap.
      // fovRatio = hop distance / FOV width. For overlap, we need fovRatio < 1.0.
      // Sweet spot is 0.3-0.7 (30-60% overlap). Above 0.85 means barely any overlap.
      // Above 1.0 means no overlap at all — very expensive.
      const fovRatio = dist / Math.max(params.fovWidth, 0.25);
      let cost = dist;
      const [preferredMin, preferredMax] = profile.preferredHopFovRange;
      const overlapMax = profile.overlapMaxFovRatio;

      if (fovRatio < preferredMin) {
        // Very short hop — mild penalty (could be useful but not ideal)
        cost *= 0.75 + (preferredMin - fovRatio) * 0.4;
      } else if (fovRatio <= preferredMax) {
        // Sweet spot: 30-70% of FOV = 30-70% overlap. Big discount.
        cost *= 0.45;
      } else if (fovRatio <= overlapMax) {
        // Acceptable: still overlapping but less ideal (15-30% overlap)
        cost *= 0.65 + (fovRatio - preferredMax) * 0.8;
      } else if (fovRatio <= 1.0) {
        // Marginal overlap — penalize but allow
        cost *= 1.2 + (fovRatio - overlapMax) * 3.0;
      } else {
        // No overlap (fovRatio > 1.0) — very steep penalty to strongly discourage
        cost *= 2.5 + (fovRatio - 1.0) * 6.0 * (profile.mode === 'binocular' ? 1.5 : 1.0);
      }

      const maxMag = Math.max(navNodes[i].mag, navNodes[j].mag);
      cost *= 1 + (maxMag / 7) * profile.dimPenaltyMultiplier;

      if (navNodes[i].name && navNodes[i].name.length > 2) cost *= profile.namedBonus;
      if (navNodes[j].name && navNodes[j].name.length > 2) cost *= profile.namedBonus;
      if (navNodes[i].type === 'planet' || navNodes[j].type === 'planet') cost *= 0.56;

      const midpoint: SkyNode = {
        id: `${navNodes[i].id}-${navNodes[j].id}-mid`,
        ra: navNodes[i].ra + normalizedRaDelta(navNodes[i].ra, navNodes[j].ra) / 2,
        dec: (navNodes[i].dec + navNodes[j].dec) / 2,
        alt: (navNodes[i].alt + navNodes[j].alt) / 2,
        az: (navNodes[i].az + navNodes[j].az) / 2,
        mag: Math.min(navNodes[i].mag, navNodes[j].mag),
        name: 'midpoint',
        type: 'star',
      };
      const localGuides = navNodes.filter(candidate =>
        candidate.id !== navNodes[i].id &&
        candidate.id !== navNodes[j].id &&
        angularDistance(candidate.ra, candidate.dec, midpoint.ra, midpoint.dec) <= Math.max(params.fovWidth * 0.9, 2.2)
      ).slice(0, 10);
      const pattern = inferPattern(midpoint, [navNodes[i], navNodes[j], ...localGuides]);
      cost *= Math.max(0.55, 1 - ((pattern.score - 35) / 100) * (profile.patternWeight * 2.4));

      // Confusion penalty — penalize hops where endpoints sit in crowded similar-brightness fields.
      // Stars of similar magnitude (±0.5 mag) within the FOV radius make it hard to identify the target.
      const confusionRadius = params.fovWidth / 2;
      let confusionCount = 0;
      for (let k = 0; k < navNodes.length; k++) {
        if (k === i || k === j) continue;
        if (Math.abs(navNodes[k].mag - navNodes[j].mag) <= 0.5 &&
            angularDistance(navNodes[k].ra, navNodes[k].dec, navNodes[j].ra, navNodes[j].dec) <= confusionRadius) {
          confusionCount++;
        }
        if (Math.abs(navNodes[k].mag - navNodes[i].mag) <= 0.5 &&
            angularDistance(navNodes[k].ra, navNodes[k].dec, navNodes[i].ra, navNodes[i].dec) <= confusionRadius) {
          confusionCount++;
        }
      }
      cost *= 1 + confusionCount * profile.confusionPenalty;

      const minAlt = Math.min(navNodes[i].alt, navNodes[j].alt);
      if (minAlt < 15) cost *= profile.lowAltPenalty;
      else if (minAlt < 25) cost *= 1.08;

      if (profile.mode === 'binocular' && pattern.type === 'field') cost *= 1.14;
      if (profile.mode === 'binocular' && dist > params.fovWidth * 0.9) cost *= 1.3;

      edges.push({ from: navNodes[i].id, to: navNodes[j].id, cost, dist });
      edges.push({ from: navNodes[j].id, to: navNodes[i].id, cost, dist });
    }
  }

  return { nodeMap, edges };
}

// Dijkstra-based pathfinding
function dijkstra(
  nodeMap: Map<string, SkyNode>,
  edges: GraphEdge[],
  startId: string,
  targetId: string
): string[] | null {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(startId, 0);

  while (true) {
    let minNode: string | null = null;
    let minDist = Infinity;
    Array.from(dist.entries()).forEach(([n, d]) => {
      if (!visited.has(n) && d < minDist) {
        minDist = d;
        minNode = n;
      }
    });
    if (!minNode || minNode === targetId) break;
    visited.add(minNode);

    const neighbors = adj.get(minNode) || [];
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue;
      const newDist = minDist + edge.cost;
      if (newDist < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, newDist);
        prev.set(edge.to, minNode);
      }
    }
  }

  if (!prev.has(targetId) && startId !== targetId) return null;

  // Reconstruct path
  const path: string[] = [];
  let curr: string | undefined = targetId;
  while (curr) {
    path.unshift(curr);
    if (curr === startId) break;
    curr = prev.get(curr);
  }
  return path[0] === startId ? path : null;
}

// Find candidate start anchors
function findAnchors(nodes: SkyNode[], targetNode: SkyNode, count: number, params: ObservingParams): SkyNode[] {
  const profile = observingProfile(params);
  // Prefer bright, named, high-altitude stars and planets that are reasonably close.
  const candidates = nodes.filter(n =>
    n.id !== targetNode.id &&
    n.mag < profile.anchorMagLimit &&
    n.alt > 15 &&
    (n.type === 'star' || n.type === 'planet')
  );

  const nearCandidates = nodes.filter(n =>
    n.id !== targetNode.id &&
    n.mag < profile.anchorMagLimit + 1 &&
    n.mag >= profile.anchorMagLimit &&
    n.alt > 15 &&
    n.name && n.name.length > 2 &&
    (n.type === 'star' || n.type === 'planet') &&
    angularDistance(n.ra, n.dec, targetNode.ra, targetNode.dec) < profile.targetAnchorDistance
  );
  candidates.push(...nearCandidates);

  // Sort: prefer closer to target, brighter, higher altitude
  const targetDist = (n: SkyNode) => angularDistance(n.ra, n.dec, targetNode.ra, targetNode.dec);
  candidates.sort((a, b) => {
    // Ideal anchor is moderate distance from the target, bright, and high.
    const distA = targetDist(a);
    const distB = targetDist(b);
    const idealDistance = profile.mode === 'binocular' ? 16 : 20;
    const scoreA = a.mag * (profile.mode === 'binocular' ? 2.6 : 2) + Math.abs(distA - idealDistance) / (profile.mode === 'binocular' ? 4 : 5) - a.alt / 20;
    const scoreB = b.mag * (profile.mode === 'binocular' ? 2.6 : 2) + Math.abs(distB - idealDistance) / (profile.mode === 'binocular' ? 4 : 5) - b.alt / 20;
    return scoreA - scoreB;
  });

  // Take diverse set (spread around target)
  const selected: SkyNode[] = [];
  for (const c of candidates) {
    if (selected.length >= count * 3) break;
    const tooClose = selected.some(s =>
      angularDistance(s.ra, s.dec, c.ra, c.dec) < 15
    );
    if (!tooClose) selected.push(c);
  }

  return selected.slice(0, count * 2);
}

// Generate hop instructions
function generateHopSteps(
  path: string[],
  nodeMap: Map<string, SkyNode>,
  allNodes: SkyNode[],
  params: ObservingParams
): HopStep[] {
  const profile = observingProfile(params);
  const hops: HopStep[] = [];

  for (let i = 0; i < path.length; i++) {
    const node = nodeMap.get(path[i])!;
    const prevNode = i > 0 ? nodeMap.get(path[i - 1])! : null;

    // Find visible guide stars in FOV at this position
    const visible = allNodes.filter(n =>
      n.id !== node.id &&
      n.mag < params.limitingMag &&
      fitsInFov(node.ra, node.dec, n.ra, n.dec, params.fovWidth, params.fovHeight, params.fovShape)
    ).sort((a, b) => a.mag - b.mag).slice(0, 6);

    // Dedup stars at same position (e.g., binocular target + BSC component)
    const deduped: SkyNode[] = [];
    for (const v of visible) {
      const tooClose = deduped.find(d => angularDistance(d.ra, d.dec, v.ra, v.dec) < 0.5);
      if (tooClose) {
        if (v.mag < tooClose.mag) {
          deduped[deduped.indexOf(tooClose)] = v;
        }
      } else {
        deduped.push(v);
      }
    }

    const dist = prevNode ? angularDistance(prevNode.ra, prevNode.dec, node.ra, node.dec) : 0;
    const dir = prevNode ? directionBetween(prevNode.ra, prevNode.dec, node.ra, node.dec) : '';
    const fovRatio = dist > 0 ? dist / params.fovWidth : 0;
    // Describe hop distance in terms that help the observer
    const overlapPct = Math.max(0, Math.round((1 - fovRatio) * 100));
    const hopDistLabel = dist > 0
      ? (fovRatio <= 0.85
        ? `${dist.toFixed(1)}°, ~${overlapPct}% overlap`
        : `${dist.toFixed(1)}° (~${fovRatio.toFixed(1)} FOV${fovRatio !== 1 ? 's' : ''})`)
      : '0';

    const namedStars = deduped.filter(v => v.name && v.name !== v.id);
    const patternAnalysis = inferPattern(node, deduped);
    const pattern = patternAnalysis.description;

    // Instruction text
    // Better display name
    const displayName = (n: SkyNode) => {
      const hasProperName = n.name && n.name.length > 2 && !n.name.startsWith('HR')
        && n.name !== n.bayer;
      if (hasProperName) {
        if (n.type === 'binocular' && n.bayer && n.constellation) {
          return `${n.name} (${n.bayer} ${n.constellation})`;
        }
        return n.name;
      }
      if (n.bayer && n.constellation) return `${n.bayer} ${getConstellationName(n.constellation)}`;
      if (n.flamsteed && n.constellation) return `${n.flamsteed} ${getConstellationName(n.constellation)}`;
      if (n.constellation) return `a mag-${n.mag.toFixed(1)} star in ${getConstellationName(n.constellation)}`;
      if (n.name && !n.name.startsWith('HR')) return n.name;
      return `a mag-${n.mag.toFixed(1)} star`;
    };

    let instruction = '';
    if (i === 0) {
      const dn = displayName(node);
      instruction = `Start at ${dn}${node.constellation ? ` in ${getConstellationName(node.constellation)}` : ''}.`;
      if (node.type === 'planet') instruction = `Start at the planet ${node.name}, easily visible to the naked eye.`;
      if (profile.mode === 'binocular' && patternAnalysis.type !== 'field' && patternAnalysis.anchors.length > 0) {
        instruction += ` In binoculars, confirm the ${patternAnalysis.type} pattern anchored by ${patternAnalysis.anchors.map(displayName).join(patternAnalysis.anchors.length > 2 ? ', ' : ' and ')}.`;
      }
    } else if (i === path.length - 1) {
      const dn = displayName(node);
      if (fovRatio <= 0.85) {
        instruction = `Nudge ${dir} (${hopDistLabel}) to bring ${dn} into view.`;
      } else {
        instruction = `Move ${dir} (${hopDistLabel}) to bring ${dn} into view.`;
      }
      if (patternAnalysis.type !== 'field') {
        instruction += ` The target should sit in a ${patternAnalysis.type} pattern with ${patternAnalysis.anchors.map(displayName).join(patternAnalysis.anchors.length > 2 ? ', ' : ' and ')}.`;
      }
    } else {
      const dn = displayName(node);
      if (fovRatio <= 0.85) {
        instruction = `Slide ${dir} (${hopDistLabel}) to ${dn} — keep the previous field partially in view.`;
      } else {
        instruction = `Move ${dir} (${hopDistLabel}) to ${dn}.`;
      }
      if (namedStars.length > 0) {
        const guide = namedStars[0];
        const guideDir = directionBetween(node.ra, node.dec, guide.ra, guide.dec);
        instruction += ` Keep ${displayName(guide)} in view as a guide, to the ${guideDir}.`;
      }
      if (patternAnalysis.type !== 'field') {
        instruction += ` Look for the ${patternAnalysis.type} pattern formed by ${patternAnalysis.anchors.map(displayName).join(patternAnalysis.anchors.length > 2 ? ', ' : ' and ')}.`;
      }
    }

    hops.push({
      center: { ra: node.ra, dec: node.dec, alt: node.alt, az: node.az },
      visibleGuideStars: deduped,
      pattern,
      patternType: patternAnalysis.type,
      patternConfidence: patternAnalysis.confidence,
      patternScore: Math.round(patternAnalysis.score),
      patternAnchors: patternAnalysis.anchors,
      direction: dir,
      distanceDeg: dist,
      instruction,
    });
  }

  return hops;
}

const CONSTELLATION_NAMES: Record<string, string> = {
  And: 'Andromeda', Ant: 'Antlia', Aps: 'Apus', Aqr: 'Aquarius', Aql: 'Aquila',
  Ara: 'Ara', Ari: 'Aries', Aur: 'Auriga', Boo: 'Boötes', Cae: 'Caelum',
  Cam: 'Camelopardalis', Cnc: 'Cancer', CVn: 'Canes Venatici', CMa: 'Canis Major',
  CMi: 'Canis Minor', Cap: 'Capricornus', Car: 'Carina', Cas: 'Cassiopeia',
  Cen: 'Centaurus', Cep: 'Cepheus', Cet: 'Cetus', Cha: 'Chamaeleon',
  Cir: 'Circinus', Col: 'Columba', Com: 'Coma Berenices', CrA: 'Corona Australis',
  CrB: 'Corona Borealis', Crv: 'Corvus', Crt: 'Crater', Cru: 'Crux',
  Cyg: 'Cygnus', Del: 'Delphinus', Dor: 'Dorado', Dra: 'Draco',
  Equ: 'Equuleus', Eri: 'Eridanus', For: 'Fornax', Gem: 'Gemini',
  Gru: 'Grus', Her: 'Hercules', Hor: 'Horologium', Hya: 'Hydra',
  Hyi: 'Hydrus', Ind: 'Indus', Lac: 'Lacerta', Leo: 'Leo',
  LMi: 'Leo Minor', Lep: 'Lepus', Lib: 'Libra', Lup: 'Lupus',
  Lyn: 'Lynx', Lyr: 'Lyra', Men: 'Mensa', Mic: 'Microscopium',
  Mon: 'Monoceros', Mus: 'Musca', Nor: 'Norma', Oct: 'Octans',
  Oph: 'Ophiuchus', Ori: 'Orion', Pav: 'Pavo', Peg: 'Pegasus',
  Per: 'Perseus', Phe: 'Phoenix', Pic: 'Pictor', Psc: 'Pisces',
  PsA: 'Piscis Austrinus', Pup: 'Puppis', Pyx: 'Pyxis', Ret: 'Reticulum',
  Sge: 'Sagitta', Sgr: 'Sagittarius', Sco: 'Scorpius', Scl: 'Sculptor',
  Sct: 'Scutum', Ser: 'Serpens', Sex: 'Sextans', Tau: 'Taurus',
  Tel: 'Telescopium', Tri: 'Triangulum', TrA: 'Triangulum Australe',
  Tuc: 'Tucana', UMa: 'Ursa Major', UMi: 'Ursa Minor', Vel: 'Vela',
  Vir: 'Virgo', Vol: 'Volans', Vul: 'Vulpecula',
};

export function getConstellationName(abbr: string): string {
  return CONSTELLATION_NAMES[abbr] || abbr;
}

// Score a route
function scoreRoute(hops: HopStep[], params: ObservingParams): number {
  const profile = observingProfile(params);
  let score = profile.mode === 'binocular' ? 66 : 70;

  const numHops = hops.length;
  if (profile.mode === 'binocular') {
    if (numHops <= 3) score += 6;
    else if (numHops <= 5) score += 2;
    else if (numHops <= 6) score -= 4;
    else score -= 12 + (numHops - 6) * 8;
  } else {
    if (numHops <= 3) score += 5;
    else if (numHops <= 5) score += 0;
    else if (numHops <= 7) score -= (numHops - 5) * 4;
    else score -= 15 + (numHops - 7) * 6;
  }

  for (let i = 1; i < hops.length; i++) {
    const hop = hops[i];
    const fovRatio = hop.distanceDeg / Math.max(params.fovWidth, 0.25);

    // Score based on FOV overlap quality
    if (fovRatio <= 0.7) {
      // Excellent overlap (30%+ overlap) — reward
      score += 3;
    } else if (fovRatio <= 0.85) {
      // Good overlap (15-30%) — small reward
      score += 1;
    } else if (fovRatio <= 1.0) {
      // Marginal overlap — no bonus
      score -= 2;
    } else if (fovRatio <= 1.5) {
      // No overlap — penalize
      score -= (profile.mode === 'binocular' ? 8 : 6);
    } else {
      // Way too far — heavy penalty
      score -= (profile.mode === 'binocular' ? 14 : 10);
    }

    if (hop.visibleGuideStars.length < 2) score -= 4;
    if (hop.visibleGuideStars.length >= 3) score += 1;
    // Pattern scoring tiers
    if (hop.patternType === 'triangle' || hop.patternType === 'diamond' || hop.patternType === 'cross' || hop.patternType === 'trapezoid') {
      score += profile.mode === 'binocular' ? 4 : 3; // Tier 1: highly distinctive
    } else if (hop.patternType === 'kite' || hop.patternType === 'arrow' || hop.patternType === 'arc' || hop.patternType === 'bracket') {
      score += profile.mode === 'binocular' ? 3 : 2; // Tier 2: recognizable
    } else if (hop.patternType === 'zigzag' || hop.patternType === 'chain') {
      score += profile.mode === 'binocular' ? 2 : 1; // Tier 3: linear/directional
    } else if (hop.patternType === 'pair') {
      score -= profile.pairPenalty;
    } else {
      score -= profile.sparsePenalty;
    }

    score += Math.round((hop.patternScore - 50) / 12);
    score += Math.round((hop.patternConfidence - 0.55) * 6);
  }

  if (hops.length > 0 && hops[0].visibleGuideStars.length > 0) {
    const brightestMag = Math.min(...hops[0].visibleGuideStars.map(s => s.mag));
    if (brightestMag < 1.5) score += 6;
    else if (brightestMag < 2.5) score += 3;
  }

  const totalDist = hops.reduce((sum, h) => sum + h.distanceDeg, 0);
  score -= totalDist / (profile.mode === 'binocular' ? 6 : 8);

  return Math.max(5, Math.min(100, Math.round(score)));
}

// ─── Main Route Planner ──────────────────────────────────────

export async function planRoutes(params: ObservingParams): Promise<{
  routes: Route[];
  nodes: SkyNode[];
  targetNode: SkyNode | null;
  belowHorizon: boolean;
}> {
  const [stars, messier, binoTargets] = await Promise.all([
    loadStars(), loadMessier(), loadBinocularTargets()
  ]);
  const allNodes = buildSkyNodes(stars, messier, params, binoTargets);

  // Find target
  const targetNode = allNodes.find(n => n.id === params.targetId) || null;
  if (!targetNode) {
    // Check if target exists but is below horizon
    const mObj = messier.find(m => m.id === params.targetId);
    const bObj = binoTargets.find(t => t.id === params.targetId);
    const anyObj = mObj || bObj;
    if (anyObj) {
      const ra = mObj ? mObj.ra : bObj!.ra;
      const dec = mObj ? mObj.dec : bObj!.dec;
      const { alt } = eqToHorizontal(ra, dec, params.lat, params.lon, params.date);
      return { routes: [], nodes: allNodes, targetNode: null, belowHorizon: alt < 5 };
    }
    return { routes: [], nodes: allNodes, targetNode: null, belowHorizon: false };
  }

  // ─── New Variable-Reach A* algorithm (when difficulty is set) ───
  if (params.difficulty) {
    const starNodes = allNodes.filter(n => n.type === 'star' || n.type === 'planet');
    const anchors = findAnchors(allNodes, targetNode, params.numRoutes, params);

    const routes: Route[] = [];
    const usedAnchors = new Set<string>();

    for (const anchor of anchors) {
      if (routes.length >= params.numRoutes) break;
      if (usedAnchors.has(anchor.id)) continue;

      const result = planVariableReachRoute(anchor, targetNode, starNodes, params.fovWidth, params.difficulty);
      if (!result) continue;

      usedAnchors.add(anchor.id);

      // Convert compressed waypoints to HopStep format for UI compatibility
      const waypointIds = result.path.map(n => n.id);
      const nodeMap = new Map(allNodes.map(n => [n.id, n]));
      const hops = generateHopSteps(waypointIds, nodeMap, allNodes, params);
      const score = scoreRoute(hops, params);

      routes.push({
        id: `route-${routes.length + 1}`,
        score,
        startAnchor: anchor,
        target: targetNode,
        hops,
      });
    }

    routes.sort((a, b) => b.score - a.score);
    return { routes, nodes: allNodes, targetNode, belowHorizon: false };
  }

  // ─── Legacy Dijkstra algorithm (no difficulty set) ───
  const { nodeMap, edges } = buildGraph(allNodes, params);

  // Find anchor candidates
  const anchors = findAnchors(allNodes, targetNode, params.numRoutes, params);

  // Compute routes from each anchor
  const routes: Route[] = [];
  const usedPaths = new Set<string>();

  for (const anchor of anchors) {
    if (routes.length >= params.numRoutes) break;

    const path = dijkstra(nodeMap, edges, anchor.id, targetNode.id);
    if (!path || path.length < 2) continue;

    // Check uniqueness
    const pathKey = path.join(',');
    if (usedPaths.has(pathKey)) continue;

    // Also check if this path is too similar to existing ones
    const pathSig = new Set(path);
    const tooSimilar = routes.some(r => {
      const existingIds = new Set(r.hops.map(h =>
        h.visibleGuideStars[0]?.id || ''
      ));
      let overlap = 0;
      Array.from(pathSig).forEach((id) => {
        if (existingIds.has(id)) overlap++;
      });
      return overlap > path.length * 0.6;
    });
    if (tooSimilar && routes.length > 0) continue;

    usedPaths.add(pathKey);

    const hops = generateHopSteps(path, nodeMap, allNodes, params);
    const score = scoreRoute(hops, params);

    routes.push({
      id: `route-${routes.length + 1}`,
      score,
      startAnchor: anchor,
      target: targetNode,
      hops,
    });
  }

  // Sort by score descending
  routes.sort((a, b) => b.score - a.score);

  return { routes, nodes: allNodes, targetNode, belowHorizon: false };
}

// ─── Stereo Projection ───────────────────────────────────────

export function stereographicProject(
  ra: number, dec: number,
  centerRa: number, centerDec: number,
  scale: number // pixels per degree
): { x: number; y: number } | null {
  const r1 = ra * Math.PI / 180;
  const d1 = dec * Math.PI / 180;
  const r0 = centerRa * Math.PI / 180;
  const d0 = centerDec * Math.PI / 180;

  const cosc = Math.sin(d0) * Math.sin(d1) + Math.cos(d0) * Math.cos(d1) * Math.cos(r1 - r0);
  if (cosc < -0.1) return null; // behind projection

  const k = 1 / (1 + cosc);
  // Note: RA increases to the left (east) in sky charts
  const x = -k * Math.cos(d1) * Math.sin(r1 - r0) * (180 / Math.PI) * scale;
  const y = -k * (Math.cos(d0) * Math.sin(d1) - Math.sin(d0) * Math.cos(d1) * Math.cos(r1 - r0)) * (180 / Math.PI) * scale;

  return { x, y };
}

// ─── Preset Targets ──────────────────────────────────────────

export interface Preset {
  name: string;
  targetId: string;
  description: string;
  lat: number;
  lon: number;
}

export const PRESETS: Preset[] = [
  { name: 'M31 — Andromeda Galaxy', targetId: 'M31', description: 'The nearest large galaxy. Best from northern latitudes in autumn.', lat: 37.77, lon: -122.42 },
  { name: 'M42 — Orion Nebula', targetId: 'M42', description: 'Bright emission nebula visible to the naked eye in Orion\'s sword.', lat: 37.77, lon: -122.42 },
  { name: 'M13 — Hercules Cluster', targetId: 'M13', description: 'The finest globular cluster in the northern sky.', lat: 37.77, lon: -122.42 },
  { name: 'M45 — Pleiades', targetId: 'M45', description: 'A brilliant open cluster, the Seven Sisters.', lat: 37.77, lon: -122.42 },
  { name: 'M57 — Ring Nebula', targetId: 'M57', description: 'A planetary nebula between Beta and Gamma Lyrae.', lat: 37.77, lon: -122.42 },
  { name: 'M51 — Whirlpool Galaxy', targetId: 'M51', description: 'A face-on spiral galaxy in Canes Venatici.', lat: 37.77, lon: -122.42 },
  { name: 'M1 — Crab Nebula', targetId: 'M1', description: 'Supernova remnant near Zeta Tauri.', lat: 37.77, lon: -122.42 },
  { name: 'M81 — Bode\'s Galaxy', targetId: 'M81', description: 'A bright spiral galaxy in Ursa Major.', lat: 37.77, lon: -122.42 },
  { name: 'Albireo — Gold & Blue Double', targetId: 'DS-Albireo', description: 'Stunning gold and sapphire double star in Cygnus.', lat: 37.77, lon: -122.42 },
  { name: 'Coathanger Asterism', targetId: 'AST-Coathanger', description: 'Ten stars forming a perfect coat-hanger shape in Vulpecula.', lat: 37.77, lon: -122.42 },
  { name: 'Double Cluster', targetId: 'NGC869', description: 'Spectacular twin open clusters in Perseus, visible naked-eye.', lat: 37.77, lon: -122.42 },
  { name: 'Kemble\'s Cascade', targetId: 'AST-KemblesCascade', description: 'Beautiful chain of 20+ stars streaming across 2.5° in Camelopardalis.', lat: 37.77, lon: -122.42 },
];
