/**
 * Core astronomy engine for StarHop Planner.
 * Handles coordinate transforms, star catalog loading,
 * sky graph construction, and route planning.
 */
import * as Astro from 'astronomy-engine';

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
  binocularCategory?: BinocularCategory;
}

export type ObservingMode = 'telescope' | 'binocular';
export type PatternType = 'triangle' | 'chain' | 'bracket' | 'pair' | 'field';

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

let _stars: Star[] | null = null;
let _messier: MessierObject[] | null = null;
let _constellations: ConstellationLine[] | null = null;
let _binocularTargets: BinocularTarget[] | null = null;

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
      nodes.push({
        id: t.id,
        ra: t.ra,
        dec: t.dec,
        alt, az,
        mag: t.mag,
        name: t.name,
        type: 'binocular',
        constellation: t.con,
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

interface PatternAnalysis {
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

function inferPattern(center: SkyNode, visible: SkyNode[]): PatternAnalysis {
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
      ? `${primary.name || primary.id} and ${top[1].name || top[1].id} frame the hop`
      : `${primary.name || primary.id} is the main guide star in the field`,
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
              description: `${stars[0].name || stars[0].id}, ${stars[1].name || stars[1].id}, and ${stars[2].name || stars[2].id} form a triangle around the hop`,
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
              description: `${ordered.map((star) => star.name || star.id).join(' → ')} make a chain pointing through the field`,
              score: chainScore,
              confidence: Math.min(0.96, 0.5 + Math.max(0, (chainAngle - 150) / 40) + (1 - chainTightness) * 0.18),
              anchors: ordered,
            };
          }
        }
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
        const bracketScore = 50 + sideBalance * 24 + Math.max(0, (opening - 70) / 40) * 10 + Math.max(0, 2 - midpointDist) * 6;
        if (opening >= 75 && sideBalance > 0.45 && sep > 1.2 && bracketScore > best.score) {
          best = {
            type: 'bracket',
            description: `${a.name || a.id} and ${b.name || b.id} bracket the next move`,
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

    const namedStars = visible.filter(v => v.name && v.name !== v.id);
    const patternAnalysis = inferPattern(node, visible);
    const pattern = patternAnalysis.description;

    // Instruction text
    // Better display name
    const displayName = (n: SkyNode) => {
      if (n.name && n.name.length > 2 && !n.name.startsWith('HR')) return n.name;
      if (n.bayer && n.constellation) return `${n.bayer} ${getConstellationName(n.constellation)}`;
      if (n.constellation) return `star in ${getConstellationName(n.constellation)}`;
      return n.name || n.id;
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
        instruction += ` Keep ${displayName(namedStars[0])} in view as a guide.`;
      }
      if (patternAnalysis.type !== 'field') {
        instruction += ` Look for the ${patternAnalysis.type} pattern formed by ${patternAnalysis.anchors.map(displayName).join(patternAnalysis.anchors.length > 2 ? ', ' : ' and ')}.`;
      }
    }

    hops.push({
      center: { ra: node.ra, dec: node.dec, alt: node.alt, az: node.az },
      visibleGuideStars: visible,
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
    if (hop.patternType === 'triangle') score += profile.mode === 'binocular' ? 4 : 3;
    else if (hop.patternType === 'bracket') score += profile.mode === 'binocular' ? 3 : 2;
    else if (hop.patternType === 'chain') score += profile.mode === 'binocular' ? 2 : 1;
    else if (hop.patternType === 'pair') score -= profile.pairPenalty;
    else score -= profile.sparsePenalty;

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

  // Build graph
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
