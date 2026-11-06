import { describe, expect, it, vi } from 'vitest';
import {
  EARTH_RADIUS_M, REFRACTION_K, TERRAIN_SOURCES, computeTerrainHorizon, curvatureDropM, decodeTerrarium, destination,
  distanceM, fetchTerrainHorizon, mercatorPixel, pixelToLatLon, planTiles, zoomForDistance, type TerrainSource, type TileGrid,
} from '@/lib/horizon/terrain';

const RAD = Math.PI / 180;
const GRID: TileGrid = { tileSize: 256, minZoom: 7, maxZoom: 13 };
const LAT = 45.07, LON = 7.69;

/** Synthetic DEM: tiles generated lazily from an analytic elevation function (pixel centres). */
function synthetic(fn: (lat: number, lon: number) => number, grid: TileGrid = GRID) {
  const cache = new Map<string, Float32Array>();
  return (z: number, x: number, y: number) => {
    const key = `${z}/${x}/${y}`;
    let t = cache.get(key);
    if (!t) {
      const T = grid.tileSize;
      t = new Float32Array(T * T);
      for (let py = 0; py < T; py++) {
        for (let px = 0; px < T; px++) {
          const [la, lo] = pixelToLatLon(x * T + px + 0.5, y * T + py + 0.5, z, T);
          t[py * T + px] = fn(la, lo);
        }
      }
      cache.set(key, t);
    }
    return t;
  };
}
const bearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return ((b / RAD) % 360 + 360) % 360;
};
/** Brute-force reference: dense march over the analytic function along one azimuth. */
function referenceAlt(fn: (lat: number, lon: number) => number, az: number, eye = 1.7) {
  const h0 = fn(LAT, LON) + eye;
  let best = -90;
  for (let d = 150; d <= 100000; d += 5) {
    const [la, lo] = destination(LAT, LON, az, d);
    best = Math.max(best, Math.atan2(fn(la, lo) - h0 - curvatureDropM(d), d) / RAD);
  }
  return best;
}

describe('terrain geometry and decoding', () => {
  it('decodes Terrarium RGB as R·256 + G + B/256 − 32768', () => {
    const px = decodeTerrarium([128, 0, 0, 255, 128, 100, 128, 255, 0, 0, 0, 255, 130, 16, 0, 0]);
    expect(Array.from(px)).toEqual([0, 100.5, -32768, 528]);
  });
  it('round-trips Web Mercator pixels and great-circle destinations', () => {
    const [x, y] = mercatorPixel(LAT, LON, 12, 512);
    const [la, lo] = pixelToLatLon(x, y, 12, 512);
    expect(la).toBeCloseTo(LAT, 9);
    expect(lo).toBeCloseTo(LON, 9);
    const [dl, dn] = destination(LAT, LON, 37, 25000);
    expect(distanceM(LAT, LON, dl, dn)).toBeCloseTo(25000, 3);
    expect(bearing(LAT, LON, dl, dn)).toBeCloseTo(37, 3);
    expect(destination(10, 179.9, 90, 50000)[1]).toBeLessThan(-179); // wraps at the antimeridian
  });
  it('chooses coarser zooms with distance', () => {
    const zs = [150, 1000, 5000, 20000, 100000].map((d) => zoomForDistance(d, LAT, TERRAIN_SOURCES.mapterhorn));
    expect(zs[0]).toBe(14);
    expect(zs[4]).toBe(7);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThanOrEqual(zs[i - 1]);
  });
  it('plans a reasonable number of tiles at 100 km, the observer tile first', () => {
    for (const source of [TERRAIN_SOURCES.mapterhorn, TERRAIN_SOURCES.terrarium]) {
      const plan = planTiles(LAT, LON, { grid: source });
      expect(plan.length).toBeGreaterThanOrEqual(15);
      expect(plan.length).toBeLessThanOrEqual(45);
      expect(new Set(plan.map((t) => t.key)).size).toBe(plan.length);
      const [x, y] = mercatorPixel(LAT, LON, source.maxZoom, source.tileSize);
      expect(plan[0]).toMatchObject({ z: source.maxZoom, x: Math.floor(x / source.tileSize), y: Math.floor(y / source.tileSize) });
    }
    expect(() => planTiles(NaN, 0, { grid: GRID })).toThrow();
  });
});

describe('terrain ray casting on synthetic DEMs', () => {
  it('gives a slightly negative horizon on a flat plain (curvature dip for a 1.7 m eye)', () => {
    const p = computeTerrainHorizon(LAT, LON, synthetic(() => 0), { grid: GRID });
    const dip = (-2 * Math.sqrt((1.7 * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS_M))) / RAD;
    expect(p).toMatchObject({ kind: 'terrain', stepDeg: 1, groundM: 0, lat: LAT, lon: LON });
    expect(p.alt).toHaveLength(360);
    expect(p.distanceKm).toHaveLength(360);
    for (const a of p.alt) expect(a).toBeCloseTo(dip, 2);
    expect(dip).toBeCloseTo(-0.039, 3);
  });

  it('places a single hill of known height at the right apparent altitude', () => {
    const [cl, cn] = destination(LAT, LON, 90, 20000);
    const hill = (la: number, lo: number) => 800 * Math.exp(-(distanceM(la, lo, cl, cn) ** 2) / (2 * 2000 ** 2));
    const p = computeTerrainHorizon(LAT, LON, synthetic(hill), { grid: GRID });
    const expected = referenceAlt(hill, 90);
    expect(expected).toBeGreaterThan(1.5);
    expect(Math.abs(p.alt[90] - expected)).toBeLessThan(0.1);
    expect(p.distanceKm![90]).toBeGreaterThan(16);
    expect(p.distanceKm![90]).toBeLessThan(21);
    expect(p.alt[270]).toBeLessThan(0);
    expect(p.alt.indexOf(Math.max(...p.alt))).toBe(90);
  });

  it('blocks only the arc of azimuths covered by a wall at 20 km', () => {
    const wall = (la: number, lo: number) => {
      const d = distanceM(LAT, LON, la, lo), b = bearing(LAT, LON, la, lo);
      return d >= 20000 && d <= 21000 && b >= 60 && b <= 120 ? 500 : 0;
    };
    const p = computeTerrainHorizon(LAT, LON, synthetic(wall), { grid: GRID });
    const expected = Math.atan2(500 - 1.7 - curvatureDropM(20000), 20000) / RAD;
    for (let az = 66; az <= 114; az++) expect(Math.abs(p.alt[az] - expected)).toBeLessThan(0.1);
    for (let az = 0; az < 360; az++) if (az < 55 || az > 125) expect(p.alt[az]).toBeLessThan(0);
  });

  it('reads ocean bathymetry as the sea surface for a coastal observer', () => {
    const coast = (la: number, lo: number) => (distanceM(LAT, LON, la, lo) < 100 ? 10 : -1000);
    const p = computeTerrainHorizon(LAT, LON, synthetic(coast), { grid: GRID });
    const dip = (-2 * Math.sqrt(((p.groundM! + 1.7) * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS_M))) / RAD;
    expect(p.groundM).toBeGreaterThan(0);
    for (const a of p.alt) expect(Math.abs(a - dip)).toBeLessThan(0.02);
  });

  it('rejects a site without ground data', () => {
    expect(() => computeTerrainHorizon(LAT, LON, new Map(), { grid: GRID })).toThrow(/No elevation data/);
  });
});

describe('fetching with source fallback', () => {
  const flat = (source: TerrainSource) => new Float32Array(source.tileSize * source.tileSize);

  it('switches the whole run to AWS Terrarium when a Mapterhorn tile fails', async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const load = vi.fn(async (source: TerrainSource) => {
      calls.push(source.id);
      if (source.id === 'mapterhorn') throw new Error('HTTP 503');
      return flat(source);
    });
    const p = await fetchTerrainHorizon(LAT, LON, load, { onProgress: (f) => progress.push(f), now: () => new Date('2026-11-06T20:00:00Z') });
    expect(p.source).toBe(TERRAIN_SOURCES.terrarium.label);
    expect(p.computedAt).toBe('2026-11-06T20:00:00.000Z');
    expect(calls.filter((c) => c === 'mapterhorn').length).toBeLessThanOrEqual(6);
    expect(calls.filter((c) => c === 'terrarium').length).toBe(planTiles(LAT, LON, { grid: TERRAIN_SOURCES.terrarium }).length);
    expect(progress.at(-1)).toBe(1);
  });

  it('uses Mapterhorn when it works, treats a missing fallback tile as sea level and reports total failure', async () => {
    const ok = await fetchTerrainHorizon(LAT, LON, async (s) => flat(s));
    expect(ok.source).toBe(TERRAIN_SOURCES.mapterhorn.label);
    let first = true;
    const missing = await fetchTerrainHorizon(LAT, LON, async (s, t) => {
      if (s.id === 'mapterhorn') return null;
      if (first && t.z < 10) { first = false; return null; }
      return flat(s);
    });
    expect(missing.source).toBe(TERRAIN_SOURCES.terrarium.label);
    await expect(fetchTerrainHorizon(LAT, LON, async () => { throw new Error('offline'); })).rejects.toThrow(/Could not load elevation data/);
  });

  it('stops on cancellation', async () => {
    const controller = new AbortController();
    const load = vi.fn(async (s: TerrainSource) => {
      controller.abort();
      return flat(s);
    });
    await expect(fetchTerrainHorizon(LAT, LON, load, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(load.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
