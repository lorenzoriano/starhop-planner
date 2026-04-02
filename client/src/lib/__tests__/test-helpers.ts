/**
 * Test helpers: load star catalogs from disk (Node.js fs) for unit/integration tests.
 * Mirrors the browser-based catalog loading in astronomy.ts but uses fs.readFileSync.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { SkyNode } from '../astronomy';

// Path to catalog data — __dirname is client/src/lib/__tests__
const DATA_DIR = resolve(__dirname, '../../../public/data');

interface RawBSC5Star {
  HR: string;
  RA: string;
  Dec: string;
  V: string;
  N?: string;
  B?: string;
  C?: string;
  F?: string;
}

interface RawMessier {
  M: string;
  NGC?: string;
  T: string;
  V: string;
  RA: string;
  Dec: string;
  Con: string;
  N?: string;
  S?: string;
}

interface RawBinocular {
  id: string;
  cat: string;
  name: string;
  altId?: string;
  ra: string;
  dec: string;
  mag: number;
  mag2?: number;
  sep?: number;
  con: string;
  size?: string;
  desc: string;
  binoTip: string;
}

/** Parse RA string like "00h 05m 09.9s" to degrees */
export function parseRA(raStr: string): number {
  const m = raStr.match(/(\d+)h\s*(\d+(?:\.\d+)?)m?\s*(\d+(?:\.\d+)?)?s?/);
  if (!m) return 0;
  const h = parseFloat(m[1]);
  const min = parseFloat(m[2]);
  const sec = m[3] ? parseFloat(m[3]) : 0;
  return (h + min / 60 + sec / 3600) * 15;
}

/** Parse Dec string like "+45° 13′ 45″" to degrees */
export function parseDec(decStr: string): number {
  const m = decStr.match(/([+-]?\d+)°\s*(\d+)[′']\s*(\d+(?:\.\d+)?)?[″"]?/);
  if (!m) return 0;
  const sign = decStr.startsWith('-') ? -1 : 1;
  const d = Math.abs(parseFloat(m[1]));
  const min = parseFloat(m[2]);
  const sec = m[3] ? parseFloat(m[3]) : 0;
  return sign * (d + min / 60 + sec / 3600);
}

export interface ParsedStar {
  id: string;
  hr: number;
  ra: number;
  dec: number;
  mag: number;
  name?: string;
  bayer?: string;
  constellation?: string;
}

export interface ParsedTarget {
  id: string;
  ra: number;
  dec: number;
  mag: number;
  name?: string;
  type: string;
  constellation: string;
}

/** Load BSC5 star catalog from disk */
export function loadStarsFromDisk(): ParsedStar[] {
  const raw: RawBSC5Star[] = JSON.parse(readFileSync(resolve(DATA_DIR, 'bsc5-short.json'), 'utf-8'));
  return raw.map(s => ({
    id: `HR${s.HR}`,
    hr: parseInt(s.HR),
    ra: parseRA(s.RA),
    dec: parseDec(s.Dec),
    mag: parseFloat(s.V),
    name: s.N || undefined,
    bayer: s.B || undefined,
    constellation: s.C || undefined,
  }));
}

/** Load Messier catalog from disk */
export function loadMessierFromDisk(): ParsedTarget[] {
  const raw: RawMessier[] = JSON.parse(readFileSync(resolve(DATA_DIR, 'messier.json'), 'utf-8'));
  return raw.map(m => ({
    id: m.M,
    ra: parseRA(m.RA),
    dec: parseDec(m.Dec),
    mag: parseFloat(m.V),
    name: m.N || undefined,
    type: m.T,
    constellation: m.Con,
  }));
}

/** Load binocular catalog from disk */
export function loadBinocularFromDisk(): ParsedTarget[] {
  const raw: RawBinocular[] = JSON.parse(readFileSync(resolve(DATA_DIR, 'binocular-catalog.json'), 'utf-8'));
  return raw.map(b => ({
    id: b.id,
    ra: parseRA(b.ra),
    dec: parseDec(b.dec),
    mag: b.mag,
    name: b.name,
    type: b.cat,
    constellation: b.con,
  }));
}

/** Convert parsed star to SkyNode (with dummy alt/az for testing) */
export function starToSkyNode(s: ParsedStar): SkyNode {
  return {
    id: s.id,
    ra: s.ra,
    dec: s.dec,
    alt: 45, // dummy — tests that need real alt/az should compute them
    az: 180,
    mag: s.mag,
    name: s.name || '',
    type: 'star',
    constellation: s.constellation,
    bayer: s.bayer,
  };
}

/** Convert parsed target to SkyNode */
export function targetToSkyNode(t: ParsedTarget): SkyNode {
  return {
    id: t.id,
    ra: t.ra,
    dec: t.dec,
    alt: 45,
    az: 180,
    mag: t.mag,
    name: t.name || t.id,
    type: 'messier',
    constellation: t.constellation,
  };
}

/** Load all catalogs and return as SkyNode arrays */
export function loadTestCatalogs(): { stars: SkyNode[]; targets: SkyNode[] } {
  const parsedStars = loadStarsFromDisk();
  const messier = loadMessierFromDisk();
  const binocular = loadBinocularFromDisk();

  const stars = parsedStars.map(starToSkyNode);
  const targets = [
    ...messier.map(targetToSkyNode),
    ...binocular.map(t => ({ ...targetToSkyNode(t), type: 'binocular' as const })),
  ];

  return { stars, targets };
}

/** Find a star by common name (case-insensitive partial match) */
export function findStar(stars: SkyNode[], name: string): SkyNode {
  const lower = name.toLowerCase();
  const found = stars.find(s => s.name.toLowerCase().includes(lower));
  if (!found) throw new Error(`Star "${name}" not found in catalog`);
  return found;
}

/** Find a target by ID (exact match) */
export function findTarget(targets: SkyNode[], id: string): SkyNode {
  const found = targets.find(t => t.id === id);
  if (!found) throw new Error(`Target "${id}" not found in catalog`);
  return found;
}

export interface ConstellationLineData {
  id: string;
  points: [number, number][][];
}

export function loadConstellationsFromDisk(): ConstellationLineData[] {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'constellations.lines.json'), 'utf-8'));
  return raw.features.map((f: any) => ({
    id: f.id,
    points: f.geometry.coordinates.map((line: number[][]) =>
      line.map(([ra, dec]: number[]) => [ra < 0 ? ra + 360 : ra, dec] as [number, number])
    ),
  }));
}
