/**
 * Terrain horizon from elevation tiles (docs/local-horizon-design.md; research notes: terrain feasibility study).
 *
 * For every azimuth (1° rays) we march outward from ~150 m to 100 km over Terrarium-encoded DEM tiles in Web
 * Mercator, choosing for each distance the coarsest zoom whose pixel still subtends ≤ ~1° (so a ray needs only
 * ~900 samples and a site ~20–45 tiles), and keep the highest apparent elevation angle after Earth curvature and
 * standard terrestrial refraction (k = 0.13). Anything closer than ~150 m (the slope you stand on, GPS error, trees,
 * houses) is left to the photo layer.
 *
 * Pure functions only: tiles come from an injected lookup (prefetched map or function), so tests use synthetic DEMs
 * and the Web Worker (terrain.worker.ts) supplies real tiles via `fetchTerrainHorizon` with an injected loader.
 */
import type { HorizonProfile } from './types';

// ───────────────────────────── constants ─────────────────────────────

/** Mean Earth radius (m), used for great-circle geometry and the curvature drop. */
export const EARTH_RADIUS_M = 6371008.8;
/** Web Mercator sphere radius (m), used for the ground size of a tile pixel. */
const MERCATOR_RADIUS_M = 6378137;
/** Standard terrestrial refraction coefficient (light ray curvature / Earth curvature). */
export const REFRACTION_K = 0.13;
/** Observer eye height above the DEM ground (m). */
export const EYE_HEIGHT_M = 1.7;
/** Web Mercator latitude limit. */
const MAX_MERCATOR_LAT = 85.05112878;
const RAD = Math.PI / 180;

// ───────────────────────────── tile sources ─────────────────────────────

export type TerrainSourceId = 'mapterhorn' | 'terrarium';

/** Pyramid geometry the ray caster needs (synthetic test DEMs only need this). */
export interface TileGrid {
  /** Tile edge in pixels (Mapterhorn 512, AWS Terrarium 256). */
  tileSize: number;
  /** Coarsest zoom used for far samples. */
  minZoom: number;
  /** Finest zoom used near the observer (and for the observer's own ground height). */
  maxZoom: number;
}

export interface TerrainSource extends TileGrid {
  id: TerrainSourceId;
  /** Label stored in HorizonProfile.source. */
  label: string;
  url: (z: number, x: number, y: number) => string;
}

/** Mapterhorn first (global Copernicus GLO-30 plus national LiDAR, 512 px lossless WebP), AWS Terrain Tiles as the
 *  fallback (256 px PNG, same Terrarium encoding). Both are keyless and send `Access-Control-Allow-Origin: *`. */
export const TERRAIN_SOURCES: Record<TerrainSourceId, TerrainSource> = {
  mapterhorn: {
    id: 'mapterhorn',
    label: 'Mapterhorn (Copernicus GLO-30 and national LiDAR)',
    tileSize: 512,
    minZoom: 7,
    maxZoom: 14,
    url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
  },
  terrarium: {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (SRTM, 3DEP, EU-DEM and others)',
    tileSize: 256,
    minZoom: 7,
    maxZoom: 13,
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  },
};

/** Order tried by `fetchTerrainHorizon`: one source per run, switching wholesale on the first failure. */
export const DEFAULT_SOURCE_ORDER: readonly TerrainSourceId[] = ['mapterhorn', 'terrarium'];

/** Short credit line for the UI wherever a terrain horizon is shown. */
export const ATTRIBUTION =
  'Terrain horizon: elevation data © Mapterhorn (mapterhorn.com/attribution) and AWS Terrain Tiles ' +
  '(USGS 3DEP, SRTM and GMTED2010; Copernicus EU-DEM; and other national sources).';
/** Full source lists required by the providers' licences, for an "Attribution" link. */
export const ATTRIBUTION_LINKS: readonly { label: string; url: string }[] = [
  { label: 'Mapterhorn data sources', url: 'https://mapterhorn.com/attribution' },
  { label: 'AWS Terrain Tiles data sources', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' },
];

// ───────────────────────────── options ─────────────────────────────

export interface RayOptions {
  /** Farthest terrain considered, km (default 100: enough except for Himalaya-scale relief). */
  maxKm?: number;
  /** First sample distance, m (default 150; nearer ground is the photo layer's job). */
  minM?: number;
  /** Target angular size of a DEM pixel at each distance, degrees (default 1; 0.5 doubles the samples). */
  toleranceDeg?: number;
  /** Azimuth step between rays, degrees (default 1; must divide 360). */
  stepDeg?: number;
  /** Eye height above ground, m (default 1.7). */
  eyeM?: number;
  /** Terrestrial refraction coefficient (default 0.13). */
  refractionK?: number;
}

const resolved = (opts: RayOptions) => ({
  maxM: (opts.maxKm ?? 100) * 1000,
  minM: opts.minM ?? 150,
  tol: (opts.toleranceDeg ?? 1) * RAD,
  stepDeg: opts.stepDeg ?? 1,
  eyeM: opts.eyeM ?? EYE_HEIGHT_M,
  k: opts.refractionK ?? REFRACTION_K,
});

// ───────────────────────────── geometry ─────────────────────────────

/** Ground size of one pixel (m) at zoom z and latitude lat. */
export function pixelSizeM(z: number, lat: number, tileSize: number): number {
  return (Math.cos(lat * RAD) * 2 * Math.PI * MERCATOR_RADIUS_M) / (tileSize * 2 ** z);
}

/** Coarsest zoom whose pixel is no larger than the angle `toleranceDeg` seen from distance dM (clamped to the grid). */
export function zoomForDistance(dM: number, lat: number, grid: TileGrid, toleranceDeg = 1): number {
  const limit = Math.max(dM * Math.tan(toleranceDeg * RAD), 1);
  for (let z = grid.minZoom; z <= grid.maxZoom; z++) if (pixelSizeM(z, lat, grid.tileSize) <= limit) return z;
  return grid.maxZoom;
}

/** Sample distances along a ray and the zoom for each: the step grows to half a pixel of the chosen zoom. */
export function raySchedule(lat: number, grid: TileGrid, opts: RayOptions = {}): { d: Float64Array; z: Uint8Array } {
  const { maxM, minM, tol } = resolved(opts);
  const ds: number[] = [], zs: number[] = [];
  const tolDeg = tol / RAD;
  for (let d = minM; d <= maxM; ) {
    const z = zoomForDistance(d, lat, grid, tolDeg);
    ds.push(d);
    zs.push(z);
    d += Math.max(10, 0.5 * pixelSizeM(z, lat, grid.tileSize));
  }
  return { d: Float64Array.from(ds), z: Uint8Array.from(zs) };
}

/** Great-circle destination from (lat, lon) along azimuth azDeg (from north through east) for dM metres. */
export function destination(lat: number, lon: number, azDeg: number, dM: number): [number, number] {
  const p1 = lat * RAD, l1 = lon * RAD, b = azDeg * RAD, dr = dM / EARTH_RADIUS_M;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  return [p2 / RAD, (((l2 / RAD + 540) % 360) + 360) % 360 - 180];
}

/** Great-circle distance (m) between two points. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Fractional global pixel coordinates (x east, y south) of a point at zoom z. */
export function mercatorPixel(lat: number, lon: number, z: number, tileSize: number): [number, number] {
  const n = 2 ** z * tileSize;
  const phi = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * RAD;
  return [((lon + 180) / 360) * n, ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * n];
}

/** Inverse of mercatorPixel (pixel coordinates → degrees). */
export function pixelToLatLon(x: number, y: number, z: number, tileSize: number): [number, number] {
  const n = 2 ** z * tileSize;
  return [Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD, (x / n) * 360 - 180];
}

/** Apparent drop of distant ground below the observer's horizontal plane: curvature minus refraction, d²(1−k)/2R. */
export function curvatureDropM(dM: number, k = REFRACTION_K): number {
  return (dM * dM * (1 - k)) / (2 * EARTH_RADIUS_M);
}

/** Apparent elevation angle (degrees) of ground at height h (m) seen from eye height hObs (m) at distance dM. */
export function apparentElevationDeg(h: number, hObs: number, dM: number, k = REFRACTION_K): number {
  return Math.atan2(h - hObs - curvatureDropM(dM, k), dM) / RAD;
}

// ───────────────────────────── tiles ─────────────────────────────

export interface TileId {
  z: number;
  x: number;
  y: number;
  /** "z/x/y" */
  key: string;
}
export const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** Prefetched tiles by "z/x/y" (null = known missing), or a lookup function. Grids are row-major, tileSize². */
export type TileLookup =
  | ReadonlyMap<string, Float32Array | null>
  | ((z: number, x: number, y: number) => Float32Array | null | undefined);

/** Decode Terrarium RGBA pixels to metres: h = R·256 + G + B/256 − 32768 (alpha ignored). */
export function decodeTerrarium(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(Math.floor(rgba.length / 4));
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j] * 256 + rgba[j + 1] + rgba[j + 2] / 256 - 32768;
  return out;
}

// Numeric tile id (z ≤ 31, x, y < 2^24) avoids building strings in the hot loop.
const numericKey = (z: number, x: number, y: number) => (z * 16777216 + x) * 16777216 + y;

/**
 * Bilinear sampler over a tile pyramid. Pixel values are at pixel centres; x wraps around the antimeridian, y is
 * clamped at the Mercator edge. Missing tiles read as NaN.
 */
class Sampler {
  private cache = new Map<number, Float32Array | null>();
  constructor(private tiles: TileLookup, private size: number) {}

  private tile(z: number, x: number, y: number): Float32Array | null {
    const id = numericKey(z, x, y);
    let t = this.cache.get(id);
    if (t === undefined) {
      const v = typeof this.tiles === 'function' ? this.tiles(z, x, y) : this.tiles.get(tileKey(z, x, y));
      t = v && v.length >= this.size * this.size ? v : null;
      this.cache.set(id, t);
    }
    return t;
  }

  private pixel(z: number, px: number, py: number): number {
    const T = this.size, n = 2 ** z * T;
    px = ((px % n) + n) % n;
    py = py < 0 ? 0 : py >= n ? n - 1 : py;
    const t = this.tile(z, Math.floor(px / T), Math.floor(py / T));
    return t ? t[(py % T) * T + (px % T)] : NaN;
  }

  elevation(lat: number, lon: number, z: number): number {
    const [x, y] = mercatorPixel(lat, lon, z, this.size);
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const a = this.pixel(z, x0, y0), b = this.pixel(z, x0 + 1, y0);
    const c = this.pixel(z, x0, y0 + 1), d = this.pixel(z, x0 + 1, y0 + 1);
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
  }
}

/** Tiles touched by the four bilinear neighbours of a point. */
function addTilesAround(out: Map<number, TileId>, lat: number, lon: number, z: number, size: number) {
  const n = 2 ** z * size, tilesPerSide = 2 ** z;
  const [x, y] = mercatorPixel(lat, lon, z, size);
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  for (const px of [x0, x0 + 1]) {
    for (const py of [y0, y0 + 1]) {
      const wx = ((px % n) + n) % n, cy = py < 0 ? 0 : py >= n ? n - 1 : py;
      const tx = Math.floor(wx / size), ty = Math.min(tilesPerSide - 1, Math.floor(cy / size));
      const id = numericKey(z, tx, ty);
      if (!out.has(id)) out.set(id, { z, x: tx, y: ty, key: tileKey(z, tx, ty) });
    }
  }
}

const checkSite = (lat: number, lon: number) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Invalid coordinates for the terrain horizon.');
  }
};
const rayCount = (stepDeg: number) => {
  const n = 360 / stepDeg;
  if (!(stepDeg > 0) || Math.abs(n - Math.round(n)) > 1e-9) throw new Error('The azimuth step must divide 360°.');
  return Math.round(n);
};

/**
 * Tiles needed for a site, the observer's own tile first and then from fine to coarse zoom (so a failing source is
 * detected on the most important tile). About 20–28 Mapterhorn or 23–45 Terrarium tiles at the defaults.
 */
export function planTiles(lat: number, lon: number, opts: RayOptions & { grid: TileGrid }): TileId[] {
  checkSite(lat, lon);
  const { stepDeg } = resolved(opts);
  const rays = rayCount(stepDeg);
  const { d, z } = raySchedule(lat, opts.grid, opts);
  const found = new Map<number, TileId>();
  addTilesAround(found, lat, lon, opts.grid.maxZoom, opts.grid.tileSize);
  for (let r = 0; r < rays; r++) {
    for (let i = 0; i < d.length; i++) {
      const [la, lo] = destination(lat, lon, r * stepDeg, d[i]);
      addTilesAround(found, la, lo, z[i], opts.grid.tileSize);
    }
  }
  const list = Array.from(found.values());
  const first = list[0];
  return [first, ...list.slice(1).sort((a, b) => b.z - a.z || a.x - b.x || a.y - b.y)];
}

export interface ComputeOptions extends RayOptions {
  grid: TileGrid;
  /** Label stored in the profile (default: "Terrain tiles"). */
  source?: string;
  /** Computation time (default now). */
  now?: Date;
}

const round = (v: number, digits: number) => {
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Ray-cast the terrain horizon from prefetched tiles. Observer eye = DEM ground at the site (finest zoom) + eyeM.
 * Missing tiles count as sea level. Samples below min(0, ground) are raised to it, so Terrarium's ocean bathymetry
 * reads as the sea surface while land below sea level (Dead Sea, Death Valley) still works.
 * Throws when the observer's own ground height is unavailable.
 */
export function computeTerrainHorizon(lat: number, lon: number, tiles: TileLookup, opts: ComputeOptions): HorizonProfile {
  checkSite(lat, lon);
  const { stepDeg, eyeM, k } = resolved(opts);
  const rays = rayCount(stepDeg);
  const sampler = new Sampler(tiles, opts.grid.tileSize);
  const ground = sampler.elevation(lat, lon, opts.grid.maxZoom);
  if (!Number.isFinite(ground)) throw new Error('No elevation data for this site.');
  const hObs = ground + eyeM;
  const floor = Math.min(0, ground);
  const { d, z } = raySchedule(lat, opts.grid, opts);
  // Per-sample constant: curvature drop, so the inner loop is one destination, one bilinear read and one atan2.
  const drop = d.map((dist) => curvatureDropM(dist, k));
  const alt: number[] = new Array(rays), distanceKm: number[] = new Array(rays);
  const sinP1 = Math.sin(lat * RAD), cosP1 = Math.cos(lat * RAD);
  for (let r = 0; r < rays; r++) {
    const b = r * stepDeg * RAD, sinB = Math.sin(b), cosB = Math.cos(b);
    let best = -Infinity, bestD = d[0] ?? 0;
    for (let i = 0; i < d.length; i++) {
      const dr = d[i] / EARTH_RADIUS_M, sinDr = Math.sin(dr), cosDr = Math.cos(dr);
      const sinP2 = sinP1 * cosDr + cosP1 * sinDr * cosB;
      const la = Math.asin(sinP2) / RAD;
      const lo = lon + Math.atan2(sinB * sinDr * cosP1, cosDr - sinP1 * sinP2) / RAD;
      let h = sampler.elevation(la, lo, z[i]);
      if (!Number.isFinite(h)) h = 0;
      if (h < floor) h = floor;
      const ang = Math.atan2(h - hObs - drop[i], d[i]);
      if (ang > best) {
        best = ang;
        bestD = d[i];
      }
    }
    alt[r] = round(Number.isFinite(best) ? best / RAD : 0, 2);
    distanceKm[r] = round(bestD / 1000, 2);
  }
  return {
    kind: 'terrain',
    stepDeg,
    alt,
    distanceKm,
    lat,
    lon,
    groundM: round(ground, 1),
    computedAt: (opts.now ?? new Date()).toISOString(),
    source: opts.source ?? 'Terrain tiles',
  };
}

// ───────────────────────────── fetching (injected loader) ─────────────────────────────

/**
 * Loads one tile as decoded metres (tileSize² Float32Array). Resolve null when the server has no such tile (404);
 * reject on any other failure. Must honour `signal`.
 */
export type TileLoader = (source: TerrainSource, tile: TileId, signal: AbortSignal) => Promise<Float32Array | null>;

export interface FetchHorizonOptions extends RayOptions {
  /** Sources tried in order, one per run (default Mapterhorn then AWS Terrarium). */
  sources?: readonly (TerrainSourceId | TerrainSource)[];
  /** Parallel tile requests (default 6). */
  concurrency?: number;
  signal?: AbortSignal;
  /** 0…1; restarts from 0 if the run switches to the fallback source. */
  onProgress?: (fraction: number) => void;
  now?: () => Date;
}

export const abortError = () =>
  typeof DOMException !== 'undefined'
    ? new DOMException('Terrain horizon cancelled', 'AbortError')
    : Object.assign(new Error('Terrain horizon cancelled'), { name: 'AbortError' });

async function loadAll(
  plan: TileId[],
  source: TerrainSource,
  load: TileLoader,
  opts: { concurrency: number; signal?: AbortSignal; allowMissing: boolean; onProgress?: (f: number) => void },
): Promise<Map<string, Float32Array | null>> {
  const inner = new AbortController();
  const relay = () => inner.abort();
  opts.signal?.addEventListener('abort', relay);
  const tiles = new Map<string, Float32Array | null>();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < plan.length) {
      if (inner.signal.aborted) throw abortError();
      const tile = plan[next++];
      const data = await load(source, tile, inner.signal);
      if (inner.signal.aborted) throw abortError();
      if (!data && !opts.allowMissing) throw new Error(`${source.label}: tile ${tile.key} is missing.`);
      if (data && data.length !== source.tileSize * source.tileSize) throw new Error(`${source.label}: tile ${tile.key} has an unexpected size.`);
      tiles.set(tile.key, data);
      opts.onProgress?.(++done / plan.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, plan.length)) }, () =>
      worker().catch((error) => {
        inner.abort();
        throw error;
      }),
    ));
    return tiles;
  } finally {
    opts.signal?.removeEventListener('abort', relay);
  }
}

/**
 * Plan, fetch and ray-cast with one source per run: if any tile of a source fails (or is missing), the remaining
 * requests are cancelled and the whole run restarts with the next source. On the last source a missing tile (404)
 * counts as sea level; other errors reject. Rejects with an AbortError when `signal` aborts.
 */
export async function fetchTerrainHorizon(
  lat: number,
  lon: number,
  load: TileLoader,
  opts: FetchHorizonOptions = {},
): Promise<HorizonProfile> {
  checkSite(lat, lon);
  const sources = (opts.sources ?? DEFAULT_SOURCE_ORDER).map((s) => (typeof s === 'string' ? TERRAIN_SOURCES[s] : s));
  if (!sources.length) throw new Error('No terrain source configured.');
  const failures: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i], last = i === sources.length - 1;
    if (opts.signal?.aborted) throw abortError();
    try {
      const plan = planTiles(lat, lon, { ...opts, grid: source });
      opts.onProgress?.(0);
      const tiles = await loadAll(plan, source, load, {
        concurrency: opts.concurrency ?? 6,
        signal: opts.signal,
        allowMissing: last,
        onProgress: opts.onProgress && ((f) => opts.onProgress?.(0.95 * f)),
      });
      const profile = computeTerrainHorizon(lat, lon, tiles, { ...opts, grid: source, source: source.label, now: opts.now?.() });
      opts.onProgress?.(1);
      return profile;
    } catch (error) {
      if (opts.signal?.aborted) throw abortError();
      failures.push(error instanceof Error ? error.message : String(error));
      if (last) break;
    }
  }
  throw new Error(`Could not load elevation data (${failures.join('; ')}).`);
}
