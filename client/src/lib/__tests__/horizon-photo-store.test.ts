import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateSeasonalPhotoLayer, configurePhotoStore, deletePhotoHorizon, importPhotoProfile, listPhotoSites, PHOTO_SAVE_FAILED,
  PHOTO_TURN_FAILED, photoSigmaDeg, PhotoStoreError, readPhotoSite, savePhotoHorizon, shiftPhotoHorizon,
} from '@/lib/horizon/photo-store';
import { GRID_ALT_MAX, GRID_ALT_MIN, GRID_STEP_DEG, type PhotoCaptureRecord, type Season, type SkyGrid } from '@/lib/horizon/photo-types';
import { HORIZON_STORAGE_KEY, readLocalHorizon, saveHorizonLayer } from '@/lib/horizon/store';
import { readSiteHorizon, subscribeTerrainJobs, terrainStoreVersion } from '@/lib/horizon/terrain-jobs';
import type { HorizonProfile } from '@/lib/horizon/types';

// Stand-in for segment/grid (agent B): skyline = top of the highest obstruction row in each column; shift = whole bins.
vi.mock('@/lib/horizon/segment/grid', () => ({
  gridToProfile: (grid: SkyGrid, site: { lat: number; lon: number }, uncertaintyDeg: number, computedAt?: string): HorizonProfile => {
    const alt: number[] = [];
    for (let x = 0; x < grid.width; x++) {
      let top = grid.altMinDeg;
      for (let y = 0; y < grid.height; y++) {
        if (grid.alpha[y * grid.width + x] < 128) {
          top = grid.altMaxDeg - y * grid.stepDeg;
          break;
        }
      }
      alt.push(top);
    }
    return {
      kind: 'photo', stepDeg: grid.stepDeg, alt, lat: site.lat, lon: site.lon, uncertaintyDeg,
      computedAt: computedAt ?? new Date().toISOString(), source: 'Photo',
    };
  },
  shiftGrid: (grid: SkyGrid, deltaDeg: number): SkyGrid => {
    const d = Math.round(deltaDeg / grid.stepDeg), w = grid.width;
    const alpha = new Uint8Array(grid.alpha.length), known = new Uint8Array(grid.known.length);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < w; x++) {
        const to = y * w + (((x + d) % w) + w) % w;
        alpha[to] = grid.alpha[y * w + x];
        known[to] = grid.known[y * w + x];
      }
    }
    return { ...grid, alpha, known };
  },
}));

const W = 1440, H = 320;
/** Grid with an obstruction from 0° up to `topDeg` over azimuths [fromAz, toAz). */
function grid(topDeg: number, fromAz = 200, toAz = 250): SkyGrid {
  const alpha = new Uint8Array(W * H).fill(255), known = new Uint8Array(W * H).fill(1);
  for (let x = Math.round(fromAz / GRID_STEP_DEG); x < Math.round(toAz / GRID_STEP_DEG); x++) {
    for (let y = 0; y < H; y++) {
      const alt = GRID_ALT_MAX - (y + 0.5) * GRID_STEP_DEG;
      if (alt <= topDeg) alpha[y * W + x] = 0;
    }
  }
  return { stepDeg: GRID_STEP_DEG, altMinDeg: GRID_ALT_MIN, altMaxDeg: GRID_ALT_MAX, width: W, height: H, alpha, known };
}
const LAT = 46.02, LON = 7.75;
function record(season: Season, extra: Partial<PhotoCaptureRecord> = {}): PhotoCaptureRecord {
  return {
    version: 1, capturedAt: '2026-07-01T10:00:00Z', lat: LAT, lon: LON, season,
    camera: { width: 1280, height: 960, hfovDeg: 66, cameraKey: 'cam|1280x960', sigmaDeg: 0.4 },
    yaw: { chosen: { source: 'sun', offsetDeg: 12, sigmaDeg: 0.3, label: 'the Sun' }, fixes: [] },
    segmentation: 'classical', frames: 8, rings: 1, light: 'day', ...extra,
  };
}
function storage() {
  const items = new Map<string, string>();
  const st = {
    items,
    /** Simulates a full or blocked localStorage. */
    full: false,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, v: string) => {
      if (st.full) throw new DOMException('quota', 'QuotaExceededError');
      items.set(key, v);
    },
  };
  return st;
}

let ls: ReturnType<typeof storage>;
let fakeDb: IDBFactory;
beforeEach(() => {
  ls = storage();
  vi.stubGlobal('localStorage', ls);
  fakeDb = new IDBFactory();
  configurePhotoStore({ indexedDB: fakeDb, rollPanorama: async (b, d) => new Blob([await b.text(), `+${d}`]) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  configurePhotoStore();
});

describe('photo horizon store', () => {
  it('combines alignment and lens sigma, never below 0.3°', () => {
    expect(photoSigmaDeg(record('leaf-on'))).toBeCloseTo(0.5, 6);
    expect(photoSigmaDeg(record('leaf-on', {
      camera: { width: 1, height: 1, hfovDeg: 60, cameraKey: 'x', sigmaDeg: 0 },
      yaw: { chosen: { source: 'compass', offsetDeg: 0, sigmaDeg: 0.1, label: 'the compass' }, fixes: [] },
    }))).toBe(0.3);
  });

  it('agrees with the real segment/grid on the synthetic grid (the mock is only a stand-in)', async () => {
    const real = await vi.importActual<typeof import('@/lib/horizon/segment/grid')>('@/lib/horizon/segment/grid');
    const p = real.gridToProfile(grid(24), { lat: LAT, lon: LON }, 0.5, '2026-11-06T00:00:00.000Z');
    expect(p).toMatchObject({ kind: 'photo', stepDeg: 0.25, lat: LAT, lon: LON, uncertaintyDeg: 0.5 });
    expect(p.alt[900]).toBeCloseTo(24, 0);
    expect(p.alt[0]).toBe(GRID_ALT_MIN);
    const moved = real.gridToProfile(real.shiftGrid(grid(24), 10), { lat: LAT, lon: LON }, 0.5);
    expect(moved.alt[Math.round(255 / 0.25)]).toBeCloseTo(24, 0);
    expect(moved.alt[Math.round(205 / 0.25)]).toBe(GRID_ALT_MIN);
  });

  it('saves the grid as-is, derives the photo layer into localStorage and notifies every view', async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeTerrainJobs(seen);
    const before = terrainStoreVersion();
    const g = grid(24);
    const profile = await savePhotoHorizon({ lat: LAT, lon: LON, grid: g, record: record('leaf-on'), panorama: new Blob(['pano']) });
    unsubscribe();
    expect(seen).toHaveBeenCalled();
    expect(terrainStoreVersion()).toBe(before + 1);
    expect(profile).toMatchObject({ kind: 'photo', stepDeg: 0.25, lat: LAT, lon: LON, uncertaintyDeg: 0.5 });
    expect(profile.alt).toHaveLength(1440);
    expect(profile.alt[900]).toBe(24); // 225°
    expect(profile.alt[0]).toBe(GRID_ALT_MIN);

    // What useLocalHorizon re-reads when the store version changes.
    expect(readSiteHorizon(LAT, LON)?.photo?.computedAt).toBe(profile.computedAt);
    const stored = readLocalHorizon(LAT, LON)!;
    expect(stored.photo).toMatchObject({ kind: 'photo', lat: LAT, lon: LON, uncertaintyDeg: 0.5, computedAt: profile.computedAt });
    expect(stored.photo!.alt[900]).toBe(24);
    // About 6–8 KB for a 1440-bin layer.
    expect(ls.items.get(HORIZON_STORAGE_KEY)!.length).toBeLessThan(9000);

    const site = (await readPhotoSite(LAT + 0.0005, LON))!; // ≈ 55 m away
    expect(site.siteKey).toBe('46.02,7.75');
    expect(site.grid.alpha).toBeInstanceOf(Uint8Array);
    expect(site.grid.alpha).toEqual(g.alpha);
    expect(await site.panorama!.text()).toBe('pano');
    expect(await readPhotoSite(LAT + 0.01, LON)).toBeNull(); // ≈ 1.1 km away

    const list = await listPhotoSites();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('grid');
    expect(list[0]).toMatchObject({ siteKey: '46.02,7.75', lat: LAT, lon: LON });
  });

  it('keeps one capture per leaf season; an unknown-season capture counts as both', async () => {
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(10), record: record('leaf-off'), panorama: null });
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(20), record: record('leaf-on'), panorama: null });
    expect(await listPhotoSites()).toHaveLength(2);
    expect(readLocalHorizon(LAT, LON)!.photo!.alt[900]).toBe(20); // the newest is in use
    expect((await readPhotoSite(LAT, LON))!.record.season).toBe('leaf-on');
    expect((await readPhotoSite(LAT, LON, 'leaf-off'))!.record.season).toBe('leaf-off');

    // Winter date: the leaf-off capture becomes the layer, and is then the one in use.
    await activateSeasonalPhotoLayer(LAT, LON, new Date('2026-01-15T12:00:00Z'));
    expect(readLocalHorizon(LAT, LON)!.photo!.alt[900]).toBe(10);
    expect((await readPhotoSite(LAT, LON))!.record.season).toBe('leaf-off');
    await activateSeasonalPhotoLayer(LAT, LON, new Date('2026-07-15T12:00:00Z'));
    expect(readLocalHorizon(LAT, LON)!.photo!.alt[900]).toBe(20);

    // A replacement for one season leaves the other alone.
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(22), record: record('leaf-on'), panorama: null });
    expect((await listPhotoSites()).map((s) => s.record.season).sort()).toEqual(['leaf-off', 'leaf-on']);

    // Unknown replaces both; it then answers for either season.
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(15), record: record('unknown'), panorama: null });
    expect((await listPhotoSites()).map((s) => s.record.season)).toEqual(['unknown']);
    expect((await readPhotoSite(LAT, LON, 'leaf-on'))!.record.season).toBe('unknown');

    // A leaf-on capture keeps the unknown one for winter; a leaf-off one then makes it redundant.
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(18), record: record('leaf-on'), panorama: null });
    expect((await readPhotoSite(LAT, LON, 'leaf-off'))!.record.season).toBe('unknown');
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(9), record: record('leaf-off'), panorama: null });
    expect((await listPhotoSites()).map((s) => s.record.season).sort()).toEqual(['leaf-off', 'leaf-on']);
  });

  it('shifts the capture in use (grid, panorama, record) and re-derives the layer', async () => {
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(24), record: record('leaf-on'), panorama: new Blob(['pano']) });
    const before = terrainStoreVersion();
    const shifted = (await shiftPhotoHorizon(LAT, LON, 10))!;
    expect(terrainStoreVersion()).toBe(before + 1);
    // Obstruction moved from 200–250° to 210–260°.
    expect(shifted.alt[Math.round(205 / 0.25)]).toBe(GRID_ALT_MIN);
    expect(shifted.alt[Math.round(255 / 0.25)]).toBe(24);
    expect(readLocalHorizon(LAT, LON)!.photo!.alt[Math.round(255 / 0.25)]).toBe(24);
    const site = (await readPhotoSite(LAT, LON))!;
    expect(site.record.manualYawDeg).toBe(10);
    expect(await site.panorama!.text()).toBe('pano+10');
    await shiftPhotoHorizon(LAT, LON, -2.5);
    expect((await readPhotoSite(LAT, LON))!.record.manualYawDeg).toBe(7.5);
    expect(await shiftPhotoHorizon(LAT + 1, LON, 3)).toBeNull();
  });

  it('removes captures and the localStorage photo layer but keeps terrain', async () => {
    const terrain: HorizonProfile = {
      kind: 'terrain', stepDeg: 1, alt: new Array(360).fill(2), lat: LAT, lon: LON, computedAt: '2026-11-01T00:00:00Z', source: 'Mapterhorn',
    };
    saveHorizonLayer(terrain);
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(24), record: record('leaf-on'), panorama: null });
    expect(Object.keys(readLocalHorizon(LAT, LON)!).sort()).toEqual(['photo', 'terrain']);
    const before = terrainStoreVersion();
    await deletePhotoHorizon(LAT, LON);
    expect(terrainStoreVersion()).toBe(before + 1);
    expect(await listPhotoSites()).toEqual([]);
    expect(readLocalHorizon(LAT, LON)).toEqual({ terrain: expect.objectContaining({ kind: 'terrain' }) });
  });

  it('imports a text profile as the photo layer; an import is neither shifted nor replaced by the seasonal switch', async () => {
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(24), record: record('leaf-on'), panorama: null });
    const before = terrainStoreVersion();
    const imported: HorizonProfile = {
      kind: 'photo', stepDeg: 0.25, alt: new Array(1440).fill(5), lat: LAT, lon: LON, computedAt: '2026-11-06T00:00:00Z', source: 'Imported file',
    };
    expect(importPhotoProfile(imported)).toBe(true);
    expect(terrainStoreVersion()).toBe(before + 1);
    expect(readLocalHorizon(LAT, LON)!.photo).toMatchObject({ source: 'Imported file', alt: expect.arrayContaining([5]) });
    expect(await shiftPhotoHorizon(LAT, LON, 4)).toBeNull();
    await activateSeasonalPhotoLayer(LAT, LON, new Date('2026-07-01T00:00:00Z'));
    expect(readLocalHorizon(LAT, LON)!.photo!.source).toBe('Imported file');
    expect(importPhotoProfile({ ...imported, alt: [1, 2, 3] })).toBe(false);
  });

  it('a full or blocked localStorage fails the save plainly and changes nothing', async () => {
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(24), record: record('leaf-on'), panorama: null });
    const before = terrainStoreVersion();
    ls.full = true;
    const failed = savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(9), record: record('leaf-on'), panorama: null });
    await expect(failed).rejects.toBeInstanceOf(PhotoStoreError);
    await expect(failed).rejects.toThrow(PHOTO_SAVE_FAILED);
    expect(terrainStoreVersion()).toBe(before);
    ls.full = false;
    // The earlier capture is still the one stored and in use.
    expect(readLocalHorizon(LAT, LON)!.photo!.alt[Math.round(225 / 0.25)]).toBe(24);
    expect((await listPhotoSites())).toHaveLength(1);
    expect((await readPhotoSite(LAT, LON))!.grid.alpha).toEqual(grid(24).alpha);
  });

  it('a failed IndexedDB write puts the previous photo layer back', async () => {
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(24), record: record('leaf-on'), panorama: null });
    const layer = readLocalHorizon(LAT, LON)!.photo!;
    // A value IndexedDB cannot store (structured clone fails) makes the write reject after localStorage was written.
    const bad = { ...record('leaf-on'), oops: () => 1 } as unknown as PhotoCaptureRecord;
    await expect(savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(9), record: bad, panorama: null })).rejects.toThrow(PHOTO_SAVE_FAILED);
    expect(readLocalHorizon(LAT, LON)!.photo).toEqual(layer);
    expect((await readPhotoSite(LAT, LON))!.updatedAt).toBe(layer.computedAt);
  });

  it('an alignment shift is all or nothing: a panorama that cannot be turned or full storage changes nothing', async () => {
    await savePhotoHorizon({ lat: LAT, lon: LON, grid: grid(24), record: record('leaf-on'), panorama: new Blob(['pano']) });
    const layer = readLocalHorizon(LAT, LON)!.photo!;
    configurePhotoStore({ indexedDB: fakeDb, rollPanorama: () => Promise.reject(new Error('no canvas')) });
    await expect(shiftPhotoHorizon(LAT, LON, 10)).rejects.toThrow(PHOTO_TURN_FAILED);
    let site = (await readPhotoSite(LAT, LON))!;
    expect(site.record.manualYawDeg).toBeUndefined();
    expect(await site.panorama!.text()).toBe('pano');
    expect(readLocalHorizon(LAT, LON)!.photo).toEqual(layer);

    configurePhotoStore({ indexedDB: fakeDb, rollPanorama: async (b, d) => new Blob([await b.text(), `+${d}`]) });
    ls.full = true;
    await expect(shiftPhotoHorizon(LAT, LON, 10)).rejects.toThrow(PHOTO_SAVE_FAILED);
    ls.full = false;
    site = (await readPhotoSite(LAT, LON))!;
    expect(site.record.manualYawDeg).toBeUndefined();
    expect(await site.panorama!.text()).toBe('pano');
    expect(readLocalHorizon(LAT, LON)!.photo).toEqual(layer);
  });

  it('import reports false when storage is full', () => {
    ls.full = true;
    const imported: HorizonProfile = {
      kind: 'photo', stepDeg: 0.25, alt: new Array(1440).fill(5), lat: LAT, lon: LON, computedAt: '2026-11-06T00:00:00Z', source: 'Imported file',
    };
    expect(importPhotoProfile(imported)).toBe(false);
  });

  it('says plainly when IndexedDB is missing', async () => {
    configurePhotoStore({ indexedDB: null });
    vi.stubGlobal('indexedDB', undefined);
    await expect(readPhotoSite(LAT, LON)).rejects.toThrow(/cannot store photo horizons/);
  });
});
