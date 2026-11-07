/**
 * Synthetic elevation model for the simulation: smooth hills and ridges 2–30 km from the site (or a flat plain), on a
 * local tangent plane around the site. The same function feeds the Terrarium tiles served to the app (tiles.ts) and the
 * truth skyline (computed with the app's own ray caster on the quantised tiles), so the terrain layer and the photo
 * agree exactly.
 */
import {
  computeTerrainHorizon, pixelToLatLon, TERRAIN_SOURCES, type TerrainSourceId, type TileGrid,
} from '../../../client/src/lib/horizon/terrain';
import type { HorizonProfile } from '../../../client/src/lib/horizon/types';
import { fbm, RAD, rng } from './common';

const R = 6371008.8;

export interface DemFeature {
  /** Centre east/north of the site, metres. */
  e: number;
  n: number;
  heightM: number;
  /** Gaussian widths along and across `angleDeg` (the long axis, from north through east), metres. */
  sigmaAlongM: number;
  sigmaAcrossM: number;
  angleDeg: number;
}

export interface DemSpec {
  lat: number;
  lon: number;
  /** Plain height (m). */
  baseM: number;
  /** Amplitude of gentle roughness (m) everywhere beyond 1 km. */
  roughM: number;
  features: DemFeature[];
  seed: number;
}

/** Hills (round) and ridges (elongated across the line of sight), each subtending roughly 1–7° from the site. */
export function makeDem(seed: number, lat: number, lon: number, kind: 'hills' | 'flat'): DemSpec {
  const r = rng(seed * 7919 + 13);
  const features: DemFeature[] = [];
  if (kind === 'hills') {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const ridge = i % 3 === 0;
      const az = (i / count) * 360 + (r() - 0.5) * 30;
      const d = Math.exp(Math.log(2500) + r() * (Math.log(30000) - Math.log(2500)));
      const altDeg = 1 + r() * 6;
      const heightM = d * Math.tan(altDeg * RAD) + (d * d) / (2 * R);
      const sigma = Math.max(350, d * (0.12 + r() * 0.18));
      features.push({
        e: d * Math.sin(az * RAD), n: d * Math.cos(az * RAD), heightM,
        sigmaAlongM: ridge ? sigma * (3 + r() * 3) : sigma, sigmaAcrossM: sigma,
        // A ridge's long axis is roughly perpendicular to the line of sight.
        angleDeg: az + 90 + (r() - 0.5) * 40,
      });
    }
  }
  return { lat, lon, baseM: 250, roughM: kind === 'hills' ? 4 : 0.5, features, seed };
}

/** Elevation (m) at a point. Local east/north from an equirectangular approximation around the site (fine to 100 km). */
export function elevation(spec: DemSpec, lat: number, lon: number): number {
  const e = (lon - spec.lon) * RAD * R * Math.cos(spec.lat * RAD);
  const n = (lat - spec.lat) * RAD * R;
  let h = spec.baseM;
  for (const f of spec.features) {
    const a = f.angleDeg * RAD, dx = e - f.e, dy = n - f.n;
    // Along = (sin a, cos a); across = (cos a, −sin a).
    const along = dx * Math.sin(a) + dy * Math.cos(a), across = dx * Math.cos(a) - dy * Math.sin(a);
    const q = (along / f.sigmaAlongM) ** 2 + (across / f.sigmaAcrossM) ** 2;
    if (q < 30) h += f.heightM * Math.exp(-0.5 * q);
  }
  const dist = Math.hypot(e, n);
  if (spec.roughM > 0 && dist > 1000) h += spec.roughM * (fbm(e / 700, n / 700, spec.seed, 3) - 0.5) * Math.min(1, (dist - 1000) / 1000);
  return h;
}

/** Terrarium RGBA for a height: h + 32768 = R·256 + G + B/256. */
export function encodeTerrarium(h: number, out: Uint8Array, i: number) {
  const v = Math.max(0, Math.min(65535.99, h + 32768));
  const whole = Math.floor(v);
  out[i] = whole >> 8;
  out[i + 1] = whole & 255;
  out[i + 2] = Math.min(255, Math.floor((v - whole) * 256));
  out[i + 3] = 255;
}

/** One tile as Terrarium RGBA pixels (row-major, tileSize²·4), sampled at pixel centres. */
export function tileRgba(spec: DemSpec, z: number, x: number, y: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const [la, lo] = pixelToLatLon(x * size + px + 0.5, y * size + py + 0.5, z, size);
      encodeTerrarium(elevation(spec, la, lo), out, (py * size + px) * 4);
    }
  }
  return out;
}

/** Tile heights exactly as the app decodes them (Terrarium quantisation included), cached. */
export function tileLookup(spec: DemSpec, size: number) {
  const cache = new Map<string, Float32Array>();
  return (z: number, x: number, y: number): Float32Array => {
    const key = `${z}/${x}/${y}`;
    let t = cache.get(key);
    if (!t) {
      const rgba = tileRgba(spec, z, x, y, size);
      t = new Float32Array(size * size);
      for (let i = 0, j = 0; i < t.length; i++, j += 4) t[i] = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
      cache.set(key, t);
    }
    return t;
  };
}

/** The terrain skyline the app should compute (apparent), at any azimuth step, from the given tile source. */
export function terrainTruth(spec: DemSpec, stepDeg: number, source: TerrainSourceId = 'mapterhorn'): HorizonProfile {
  const grid: TileGrid = TERRAIN_SOURCES[source];
  return computeTerrainHorizon(spec.lat, spec.lon, tileLookup(spec, grid.tileSize), {
    grid, stepDeg, source: TERRAIN_SOURCES[source].label, now: new Date(0),
  });
}
