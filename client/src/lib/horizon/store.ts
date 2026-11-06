/**
 * Local horizon persistence per site (localStorage, offline). Each site keeps its layers (terrain, later photo)
 * rounded to 0.1° and 0.1 km (~3–4 KB per site with distances); at most MAX_HORIZON_SITES sites, oldest evicted.
 * A stored layer is reused anywhere within REUSE_DISTANCE_M of where it was computed.
 */
import { distanceM } from './terrain';
import type { HorizonLayerKind, HorizonProfile, LocalHorizon } from './types';

export const HORIZON_STORAGE_KEY = 'starhop-local-horizon-v1';
export const MAX_HORIZON_SITES = 30;
export const REUSE_DISTANCE_M = 200;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
interface StoredSite {
  /** Last write, ms epoch (eviction order). */
  savedAt: number;
  terrain?: HorizonProfile;
  photo?: HorizonProfile;
}
type Store = Record<string, StoredSite>;

const KINDS: readonly HorizonLayerKind[] = ['terrain', 'photo'];

/** Site key: lat/lon to 3 decimals (≈ 100 m), with −0 collapsed (as siteSkyBrightnessKey does). */
export function horizonSiteKey(lat: number, lon: number): string {
  const normalized = (value: number) => {
    const rounded = Number(value.toFixed(3));
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return `${normalized(lat)},${normalized(lon)}`;
}

const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const round1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
const finiteIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Validate an unknown value as a HorizonProfile (as stored or received); null when anything is off. */
export function parseHorizonProfile(value: unknown): HorizonProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'terrain' && v.kind !== 'photo') return null;
  if (!finiteIn(v.stepDeg, 0.1, 45) || !finiteIn(v.lat, -90, 90) || !finiteIn(v.lon, -180, 180)) return null;
  const n = 360 / v.stepDeg;
  if (Math.abs(n - Math.round(n)) > 1e-6) return null;
  if (!Array.isArray(v.alt) || v.alt.length !== Math.round(n) || !v.alt.every((a) => finiteIn(a, -90, 90))) return null;
  if (v.distanceKm !== undefined && (!Array.isArray(v.distanceKm) || v.distanceKm.length !== v.alt.length || !v.distanceKm.every((d) => finiteIn(d, 0, 2000)))) return null;
  if (v.groundM !== undefined && !finiteIn(v.groundM, -1000, 9000)) return null;
  if (v.uncertaintyDeg !== undefined && !finiteIn(v.uncertaintyDeg, 0, 90)) return null;
  if (typeof v.computedAt !== 'string' || Number.isNaN(Date.parse(v.computedAt)) || typeof v.source !== 'string') return null;
  return {
    kind: v.kind,
    stepDeg: v.stepDeg,
    alt: v.alt as number[],
    ...(v.distanceKm ? { distanceKm: v.distanceKm as number[] } : {}),
    lat: v.lat,
    lon: v.lon,
    ...(v.groundM !== undefined ? { groundM: v.groundM } : {}),
    computedAt: v.computedAt,
    source: v.source.slice(0, 200),
    ...(v.uncertaintyDeg !== undefined ? { uncertaintyDeg: v.uncertaintyDeg } : {}),
  };
}

/** The stored form: altitudes to 0.1°, distances to 0.1 km, ground to 1 m. */
export function compactProfile(p: HorizonProfile): HorizonProfile {
  return {
    ...p,
    alt: p.alt.map(round1),
    ...(p.distanceKm ? { distanceKm: p.distanceKm.map(round1) } : {}),
    ...(p.groundM !== undefined ? { groundM: Math.round(p.groundM) } : {}),
    ...(p.uncertaintyDeg !== undefined ? { uncertaintyDeg: round1(p.uncertaintyDeg) } : {}),
  };
}

/** Last parsed store, by its raw JSON: the many useLocalHorizon instances of one page (charts on every card) then share
 *  one parse and the same profile objects (so profile.ts's per-profile caches are shared too). Read-only use. */
let parsed: { raw: string; store: Store } | null = null;

/** The validated store. `forWrite` returns a private copy the caller may mutate (never the shared parsed one). */
function readStore(storage: StorageLike | undefined, forWrite = false): Store {
  try {
    const raw = storage?.getItem(HORIZON_STORAGE_KEY);
    if (!raw) return {};
    if (!forWrite && parsed?.raw === raw) return parsed.store;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: Store = {};
    for (const [key, site] of Object.entries(data as Record<string, unknown>)) {
      if (!site || typeof site !== 'object' || Array.isArray(site)) continue;
      const s = site as Record<string, unknown>;
      const entry: StoredSite = { savedAt: finiteIn(s.savedAt, 0, Number.MAX_SAFE_INTEGER) ? s.savedAt : 0 };
      for (const kind of KINDS) {
        const p = parseHorizonProfile(s[kind]);
        if (p && p.kind === kind) entry[kind] = p;
      }
      if (entry.terrain || entry.photo) out[key] = entry;
    }
    if (!forWrite) parsed = { raw, store: out };
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: Store, storage: StorageLike | undefined): boolean {
  if (!storage) return false;
  const keys = Object.keys(store).sort((a, b) => store[b].savedAt - store[a].savedAt);
  let kept = keys.slice(0, MAX_HORIZON_SITES);
  // On a quota error, retry once with the newest half.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      storage.setItem(HORIZON_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept.map((k) => [k, store[k]]))));
      return true;
    } catch {
      kept = kept.slice(0, Math.max(1, Math.floor(kept.length / 2)));
    }
  }
  return false;
}

/**
 * Everything stored near a site: for each layer, the one computed closest to (lat, lon) within `maxDistanceM`
 * (default 200 m). Null when nothing is stored nearby or the coordinates are invalid.
 */
export function readLocalHorizon(
  lat: number,
  lon: number,
  opts: { maxDistanceM?: number } = {},
  storage: StorageLike | undefined = defaultStorage(),
): LocalHorizon | null {
  if (!finiteIn(lat, -90, 90) || !finiteIn(lon, -180, 180)) return null;
  const max = opts.maxDistanceM ?? REUSE_DISTANCE_M;
  const store = readStore(storage);
  const best: Partial<Record<HorizonLayerKind, { d: number; p: HorizonProfile }>> = {};
  for (const site of Object.values(store)) {
    for (const kind of KINDS) {
      const p = site[kind];
      if (!p) continue;
      const d = distanceM(lat, lon, p.lat, p.lon);
      if (d <= max && (!best[kind] || d < best[kind]!.d)) best[kind] = { d, p };
    }
  }
  if (!best.terrain && !best.photo) return null;
  return { ...(best.terrain ? { terrain: best.terrain.p } : {}), ...(best.photo ? { photo: best.photo.p } : {}) };
}

/** Store (or replace) one layer for the site where it was computed. Returns false when storage is unavailable. */
export function saveHorizonLayer(profile: HorizonProfile, storage: StorageLike | undefined = defaultStorage(), now = Date.now()): boolean {
  const p = parseHorizonProfile(compactProfile(profile));
  if (!p) return false;
  try {
    const store = readStore(storage, true);
    const key = horizonSiteKey(p.lat, p.lon);
    store[key] = { ...store[key], [p.kind]: p, savedAt: now };
    return writeStore(store, storage);
  } catch {
    return false;
  }
}

/** Forget a site's layer (or all its layers) stored within `maxDistanceM` of (lat, lon). */
export function removeHorizonLayer(
  lat: number,
  lon: number,
  kind?: HorizonLayerKind,
  opts: { maxDistanceM?: number } = {},
  storage: StorageLike | undefined = defaultStorage(),
): boolean {
  try {
    const store = readStore(storage, true);
    const max = opts.maxDistanceM ?? REUSE_DISTANCE_M;
    for (const [key, site] of Object.entries(store)) {
      for (const k of kind ? [kind] : KINDS) {
        const p = site[k];
        if (p && distanceM(lat, lon, p.lat, p.lon) <= max) delete site[k];
      }
      if (!site.terrain && !site.photo) delete store[key];
    }
    return writeStore(store, storage);
  } catch {
    return false;
  }
}

export interface StoredHorizonSite {
  lat: number;
  lon: number;
  kinds: HorizonLayerKind[];
}

/** Every stored layer's site (where it was computed), read once — for "horizon saved" markers on many locations. */
export function storedHorizonSites(storage: StorageLike | undefined = defaultStorage()): StoredHorizonSite[] {
  const out: StoredHorizonSite[] = [];
  for (const site of Object.values(readStore(storage))) {
    for (const kind of KINDS) {
      const p = site[kind];
      if (p) out.push({ lat: p.lat, lon: p.lon, kinds: [kind] });
    }
  }
  return out;
}

/** Layers stored within `maxDistanceM` (default 200 m) of (lat, lon), from a storedHorizonSites() list. */
export function storedHorizonKindsNear(
  sites: readonly StoredHorizonSite[],
  lat: number,
  lon: number,
  maxDistanceM = REUSE_DISTANCE_M,
): HorizonLayerKind[] {
  if (!finiteIn(lat, -90, 90) || !finiteIn(lon, -180, 180)) return [];
  const found = new Set<HorizonLayerKind>();
  for (const s of sites) if (distanceM(lat, lon, s.lat, s.lon) <= maxDistanceM) s.kinds.forEach((k) => found.add(k));
  return KINDS.filter((k) => found.has(k));
}
