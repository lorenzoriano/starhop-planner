/**
 * Photo horizon storage (docs/local-horizon-design.md 5.3). IndexedDB database `starhop-horizon`, store `sites`, holds
 * each capture's sky grid (typed arrays stored as-is by structured clone), panorama Blob and capture record. Up to two
 * seasonal captures per site ('leaf-on' and 'leaf-off'; an 'unknown' capture counts as both), keyed
 * `<siteKey>|<season>`. The photo HorizonProfile derived from the grid is also written to localStorage (store.ts), so
 * the rest of the app works from localStorage alone; every change notifies all useLocalHorizon hooks.
 *
 * The capture "in use" is the one whose profile is the site's localStorage photo layer (matched by computedAt =
 * updatedAt); activateSeasonalPhotoLayer switches it for a date's season.
 *
 * Writes never leave the two halves disagreeing: the localStorage layer is written first (a full or blocked storage
 * fails before anything changed), and a failed IndexedDB write puts the previous layer back. Failures reject with a
 * PhotoStoreError whose message the UI shows as is.
 */
import { gridToProfile, shiftGrid } from './segment/grid';
import { horizonSiteKey, readLocalHorizon, removeHorizonLayer, saveHorizonLayer } from './store';
import { notifyHorizonStoreChanged } from './terrain-jobs';
import { distanceM } from './terrain';
import { seasonFor } from './season';
import type { PhotoCaptureRecord, PhotoSiteData, Season, SkyGrid } from './photo-types';
import type { HorizonProfile } from './types';

const PHOTO_DB_NAME = 'starhop-horizon';
const PHOTO_STORE_NAME = 'sites';
const DB_VERSION = 1;
/** A stored capture is used anywhere within this distance of where it was taken (as store.ts REUSE_DISTANCE_M). */
const NEAR_M = 200;
/** Floor for the photo layer's one-sigma, degrees (pixel size and segmentation edge). */
const MIN_PHOTO_SIGMA_DEG = 0.3;

/** Shown when a capture, an alignment or a seasonal switch cannot be written. */
export const PHOTO_SAVE_FAILED = 'Could not save the photo horizon on this device — storage is full or blocked.';
/** Shown when the panorama cannot be turned for a new alignment (nothing is changed then). */
export const PHOTO_TURN_FAILED = 'Could not turn the photo for the new alignment, so nothing was changed.';

/** A photo horizon storage failure in plain words (`message` is shown to the user as is). */
export class PhotoStoreError extends Error {
  constructor(message: string = PHOTO_SAVE_FAILED) {
    super(message);
    this.name = 'PhotoStoreError';
  }
}

/** Rotate an equirectangular panorama in azimuth (trueAz += deltaDeg); returns the new Blob, rejects when it cannot. */
export type PanoramaRoller = (panorama: Blob, deltaDeg: number) => Promise<Blob>;

let idbFactory: IDBFactory | null = null;
let roller: PanoramaRoller = rollPanoramaBlob;
let dbPromise: Promise<IDBDatabase> | null = null;
let persistAsked = false;

/** Tests: inject an IDBFactory (fake-indexeddb) and a panorama roller; drops the cached connection. */
export function configurePhotoStore(opts: { indexedDB?: IDBFactory | null; rollPanorama?: PanoramaRoller } = {}): void {
  void dbPromise?.then((db) => db.close(), () => undefined);
  dbPromise = null;
  persistAsked = false;
  idbFactory = opts.indexedDB ?? null;
  roller = opts.rollPanorama ?? rollPanoramaBlob;
}

function factory(): IDBFactory {
  const f = idbFactory ?? (typeof indexedDB === 'undefined' ? null : indexedDB);
  if (!f) throw new PhotoStoreError('This browser cannot store photo horizons (IndexedDB is not available).');
  return f;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory().open(PHOTO_DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PHOTO_STORE_NAME)) req.result.createObjectStore(PHOTO_STORE_NAME);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open the photo horizon storage.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const finished = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Photo horizon storage was interrupted.'));
});

interface Entry {
  key: string;
  data: PhotoSiteData;
}

async function allEntries(): Promise<Entry[]> {
  const db = await openDb();
  const store = db.transaction(PHOTO_STORE_NAME, 'readonly').objectStore(PHOTO_STORE_NAME);
  const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
  return keys.map((k, i) => ({ key: String(k), data: values[i] as PhotoSiteData }));
}

async function writeEntries(puts: Entry[], deletes: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
  const store = tx.objectStore(PHOTO_STORE_NAME);
  deletes.forEach((k) => store.delete(k));
  puts.forEach((e) => store.put(e.data, e.key));
  await finished(tx);
}

const entryKey = (siteKey: string, season: Season) => `${siteKey}|${season}`;
const seasonOf = (e: Entry): Season => e.data.record.season;
const newest = (a: Entry, b: Entry) => (Date.parse(b.data.updatedAt) || 0) - (Date.parse(a.data.updatedAt) || 0);

/** Captures of the stored site nearest to (lat, lon) within 200 m, newest first. */
async function nearestSite(lat: number, lon: number): Promise<Entry[]> {
  const entries = await allEntries();
  let bestKey: string | null = null, bestD = Infinity;
  for (const e of entries) {
    const d = distanceM(lat, lon, e.data.lat, e.data.lon);
    if (d <= NEAR_M && d < bestD) {
      bestD = d;
      bestKey = e.data.siteKey;
    }
  }
  return bestKey === null ? [] : entries.filter((e) => e.data.siteKey === bestKey).sort(newest);
}

/** The capture whose profile is the site's photo layer now (`layer`: none, from that capture, or an imported file). */
function layerCapture(site: Entry[], lat: number, lon: number): { layer: 'none' | 'capture' | 'import'; entry: Entry | null } {
  const layer = readLocalHorizon(lat, lon)?.photo;
  if (!layer) return { layer: 'none', entry: null };
  const entry = site.find((e) => e.data.updatedAt === layer.computedAt && e.data.lat === layer.lat && e.data.lon === layer.lon) ?? null;
  return { layer: entry ? 'capture' : 'import', entry };
}

/** The capture in use, else the newest. */
const inUse = (site: Entry[], lat: number, lon: number): Entry | null => layerCapture(site, lat, lon).entry ?? site[0] ?? null;

/** Captures matching a season: exact first, then 'unknown' (counts as both). 'unknown' asked = any. */
function forSeason(site: Entry[], season: Season): Entry | null {
  if (season === 'unknown') return site[0] ?? null;
  return site.find((e) => seasonOf(e) === season) ?? site.find((e) => seasonOf(e) === 'unknown') ?? null;
}

/** One-sigma of the photo skyline from the alignment and the lens calibration, never below MIN_PHOTO_SIGMA_DEG. */
export function photoSigmaDeg(record: PhotoCaptureRecord): number {
  const yaw = record.yaw?.chosen?.sigmaDeg, cam = record.camera?.sigmaDeg;
  const s = Math.hypot(Number.isFinite(yaw) ? yaw : 0, Number.isFinite(cam) ? cam : 0);
  return Math.max(MIN_PHOTO_SIGMA_DEG, s);
}

/** The photo profile for a stored capture (its site, its time). */
function deriveProfile(data: PhotoSiteData): HorizonProfile {
  const p = gridToProfile(data.grid, { lat: data.lat, lon: data.lon }, photoSigmaDeg(data.record), data.updatedAt);
  return { ...p, kind: 'photo', lat: data.lat, lon: data.lon, computedAt: data.updatedAt };
}

/**
 * Make `profile` the site's photo layer in localStorage; throws a PhotoStoreError when it cannot be written. Returns an
 * undo that puts back the photo layer used there before (for when the IndexedDB half of a write then fails).
 */
function putLayer(profile: HorizonProfile): () => void {
  const previous = readLocalHorizon(profile.lat, profile.lon)?.photo ?? null;
  if (!saveHorizonLayer(profile)) throw new PhotoStoreError(PHOTO_SAVE_FAILED);
  return () => {
    removeHorizonLayer(profile.lat, profile.lon, 'photo', { maxDistanceM: 1 });
    if (previous) saveHorizonLayer(previous);
  };
}

/** Write captures to IndexedDB after the localStorage layer was put; on failure undo it and reject plainly. */
async function writeWithLayer(puts: Entry[], deletes: string[], undo: () => void): Promise<void> {
  try {
    await writeEntries(puts, deletes);
  } catch (e) {
    undo();
    throw e instanceof PhotoStoreError ? e : new PhotoStoreError(PHOTO_SAVE_FAILED);
  }
}

/** Unique, increasing ISO time (two saves in the same millisecond still get distinct computedAt keys). */
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

async function askPersist(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Best effort: the browser may refuse; data is still stored (just evictable).
  }
}

/**
 * Store a capture (grid, panorama, record) for the site where it was taken and make it the site's photo layer.
 * A capture replaces the one of the same season at that site; an 'unknown'-season capture replaces both. Returns the
 * derived photo profile (also saved to localStorage) after notifying every view. Rejects with a PhotoStoreError
 * (PHOTO_SAVE_FAILED) when the phone's storage is full or blocked; nothing is changed then.
 */
export async function savePhotoHorizon(input: { lat: number; lon: number; grid: SkyGrid; record: PhotoCaptureRecord; panorama: Blob | null }): Promise<HorizonProfile> {
  await askPersist();
  const siteKey = horizonSiteKey(input.lat, input.lon);
  const season = input.record.season;
  const data: PhotoSiteData = {
    siteKey, lat: input.lat, lon: input.lon, record: input.record, grid: input.grid, panorama: input.panorama, updatedAt: stamp(),
  };
  const existing = (await allEntries()).filter((e) => e.data.siteKey === siteKey && e.key !== entryKey(siteKey, season));
  let deletes: string[];
  if (season === 'unknown') deletes = existing.map((e) => e.key);
  else {
    const seasons = new Set<Season>([season, ...existing.map(seasonOf)]);
    // An older 'unknown' capture stays while it still covers the other season.
    deletes = seasons.has('leaf-on') && seasons.has('leaf-off') ? existing.filter((e) => seasonOf(e) === 'unknown').map((e) => e.key) : [];
  }
  const profile = deriveProfile(data);
  await writeWithLayer([{ key: entryKey(siteKey, season), data }], deletes, putLayer(profile));
  notifyHorizonStoreChanged();
  return profile;
}

/**
 * The stored capture nearest to (lat, lon) within 200 m. With a season: the capture for that season (or an
 * 'unknown'-season one), null if none. Without: the capture in use (the site's photo layer), else the newest.
 */
export async function readPhotoSite(lat: number, lon: number, season?: Season): Promise<PhotoSiteData | null> {
  const site = await nearestSite(lat, lon);
  const e = season ? forSeason(site, season) : inUse(site, lat, lon);
  return e?.data ?? null;
}

/** Every stored capture (small fields only), newest first, for a list of photo sites. */
export async function listPhotoSites(): Promise<Array<Pick<PhotoSiteData, 'siteKey' | 'lat' | 'lon' | 'record' | 'updatedAt'>>> {
  return (await allEntries()).sort(newest).map(({ data: { siteKey, lat, lon, record, updatedAt } }) => ({ siteKey, lat, lon, record, updatedAt }));
}

/** Remove every capture within 200 m of (lat, lon) and the localStorage photo layer there. */
export async function deletePhotoHorizon(lat: number, lon: number): Promise<void> {
  const entries = await allEntries();
  const gone = entries.filter((e) => distanceM(lat, lon, e.data.lat, e.data.lon) <= NEAR_M).map((e) => e.key);
  // The layer first: if storage is blocked, nothing is removed.
  if (!removeHorizonLayer(lat, lon, 'photo')) throw new PhotoStoreError('Could not remove the photo horizon on this device — storage is blocked.');
  notifyHorizonStoreChanged();
  if (gone.length) await writeEntries([], gone);
}

/**
 * Manual alignment: rotate the capture in use by `deltaDeg` (trueAz += deltaDeg) — grid and panorama — add it to
 * record.manualYawDeg and re-derive the photo layer. Null when no capture is stored near the site or the layer in use is
 * an imported file. All or nothing: rejects with a PhotoStoreError (PHOTO_TURN_FAILED when the panorama cannot be
 * turned, PHOTO_SAVE_FAILED when storage is full or blocked) and leaves grid, panorama and layer as they were.
 */
export async function shiftPhotoHorizon(lat: number, lon: number, deltaDeg: number): Promise<HorizonProfile | null> {
  const site = await nearestSite(lat, lon);
  const { layer, entry } = layerCapture(site, lat, lon);
  // An imported file has no grid to shift; with no layer at all, shift the newest capture (and make it the layer).
  const e = layer === 'import' ? null : entry ?? site[0] ?? null;
  if (!e) return null;
  if (!Number.isFinite(deltaDeg) || deltaDeg === 0) return deriveProfile(e.data);
  const old = e.data;
  let panorama = old.panorama;
  if (panorama) {
    try {
      panorama = await roller(panorama, deltaDeg);
    } catch {
      // A panorama left unturned would no longer match the grid: change nothing.
      throw new PhotoStoreError(PHOTO_TURN_FAILED);
    }
  }
  const manual = Math.round(((old.record.manualYawDeg ?? 0) + deltaDeg) * 1000) / 1000;
  const data: PhotoSiteData = {
    ...old, grid: shiftGrid(old.grid, deltaDeg), panorama, record: { ...old.record, manualYawDeg: manual }, updatedAt: stamp(),
  };
  const profile = deriveProfile(data);
  await writeWithLayer([{ key: e.key, data }], [], putLayer(profile));
  notifyHorizonStoreChanged();
  return profile;
}

/**
 * Use the capture matching the date's leaf season as the site's photo layer (the stored one for that season, or an
 * 'unknown'-season one). Nothing changes when there is no such capture, it is already in use, or the layer in use is an
 * imported file. Rejects with a PhotoStoreError when the layer cannot be written.
 */
export async function activateSeasonalPhotoLayer(lat: number, lon: number, date: Date): Promise<void> {
  const site = await nearestSite(lat, lon);
  if (!site.length) return;
  const season = seasonFor(date, site[0].data.lat);
  const want = season === 'unknown' ? null : forSeason(site, season);
  const { layer, entry } = layerCapture(site, lat, lon);
  // An imported file stays in use until the user captures or removes it.
  if (!want || layer === 'import' || (layer === 'capture' && entry === want)) return;
  putLayer(deriveProfile(want.data));
  notifyHorizonStoreChanged();
}

/** An imported text horizon (export.ts parseAzAltText) becomes the site's photo layer. False when it cannot be stored
 *  (an invalid profile, or storage full or blocked). */
export function importPhotoProfile(profile: HorizonProfile): boolean {
  const ok = saveHorizonLayer({ ...profile, kind: 'photo' });
  if (ok) notifyHorizonStoreChanged();
  return ok;
}

/** Default roller: redraw the panorama shifted right by deltaDeg (wrapping) and re-encode it as WebP. Rejects when the
 *  browser cannot decode or draw it (the caller then changes nothing). */
async function rollPanoramaBlob(panorama: Blob, deltaDeg: number): Promise<Blob> {
  if (typeof createImageBitmap === 'undefined') throw new Error('createImageBitmap is not available');
  const bitmap = await createImageBitmap(panorama);
  try {
    const { width: w, height: h } = bitmap;
    const dx = ((Math.round((deltaDeg / 360) * w) % w) + w) % w;
    if (!dx) return panorama;
    const draw = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
      ctx.drawImage(bitmap, dx, 0);
      ctx.drawImage(bitmap, dx - w, 0);
    };
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2D canvas');
      draw(ctx);
      return await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas');
    draw(ctx);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) throw new Error('could not encode the panorama');
    return blob;
  } finally {
    bitmap.close();
  }
}
