import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HORIZON_STORAGE_KEY, MAX_HORIZON_SITES, compactProfile, horizonSiteKey, parseHorizonProfile, readLocalHorizon,
  removeHorizonLayer, saveHorizonLayer,
} from '@/lib/horizon/store';
import {
  AUTO_RETRY_MS, readSiteHorizon, resetTerrainJobs, retainTerrainSite, shouldAutoCompute, startTerrainJob, terrainFailure,
  terrainJob,
} from '@/lib/horizon/terrain-jobs';
import { destination } from '@/lib/horizon/terrain';
import type { HorizonProfile } from '@/lib/horizon/types';

function storage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, v: string) => { items.set(key, v); } };
}
const profile = (lat = 45.0703, lon = 7.6869, extra: Partial<HorizonProfile> = {}): HorizonProfile => ({
  kind: 'terrain', stepDeg: 1,
  alt: Array.from({ length: 360 }, (_, i) => 3 * Math.sin(i / 10) + 0.0123),
  distanceKm: Array.from({ length: 360 }, (_, i) => 50 + i / 7.3),
  lat, lon, groundM: 237.44, computedAt: '2026-11-06T12:00:00.000Z', source: 'Mapterhorn', ...extra,
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); resetTerrainJobs(); });

describe('local horizon store', () => {
  it('keys sites to ≈100 m and normalises −0', () => {
    expect(horizonSiteKey(45.07031, 7.68694)).toBe('45.07,7.687');
    expect(horizonSiteKey(-0.0001, 0.0002)).toBe('0,0');
  });
  it('round-trips a profile rounded to 0.1° / 0.1 km in a few KB, reused within 200 m', () => {
    const s = storage(), p = profile();
    expect(saveHorizonLayer(p, s)).toBe(true);
    const raw = s.items.get(HORIZON_STORAGE_KEY)!;
    expect(raw.length).toBeLessThan(4000);
    const read = readLocalHorizon(p.lat, p.lon, {}, s)!;
    expect(read.terrain).toEqual(compactProfile(p));
    expect(read.terrain!.alt[1]).toBe(0.3);
    expect(read.terrain!.groundM).toBe(237);
    const [nl, no] = destination(p.lat, p.lon, 45, 150);
    expect(readLocalHorizon(nl, no, {}, s)?.terrain).toBeTruthy();
    const [fl, fo] = destination(p.lat, p.lon, 45, 300);
    expect(readLocalHorizon(fl, fo, {}, s)).toBeNull();
  });
  it('combines the nearest layer of each kind and removes layers', () => {
    const s = storage();
    saveHorizonLayer(profile(), s);
    const [pl, po] = destination(45.0703, 7.6869, 0, 120);
    saveHorizonLayer(profile(pl, po, { kind: 'photo', distanceKm: undefined, uncertaintyDeg: 0.53 }), s);
    const both = readLocalHorizon(45.0703, 7.6869, {}, s)!;
    expect(both.terrain?.kind).toBe('terrain');
    expect(both.photo).toMatchObject({ kind: 'photo', uncertaintyDeg: 0.5 });
    expect(removeHorizonLayer(45.0703, 7.6869, 'photo', {}, s)).toBe(true);
    expect(readLocalHorizon(45.0703, 7.6869, {}, s)).toEqual({ terrain: both.terrain });
  });
  it('survives corrupted or unavailable storage', () => {
    const s = storage();
    s.setItem(HORIZON_STORAGE_KEY, '{not json');
    expect(readLocalHorizon(45, 7, {}, s)).toBeNull();
    const good = compactProfile(profile(45, 7));
    s.setItem(HORIZON_STORAGE_KEY, JSON.stringify({
      a: { savedAt: 1, terrain: { ...good, alt: good.alt.slice(10) } },
      b: { savedAt: 1, terrain: { ...good, alt: good.alt.map((v, i) => (i === 3 ? 'x' : v)) } },
      c: { savedAt: 1, terrain: { ...good, kind: 'photo' } },
      d: { savedAt: 'yesterday', terrain: good, photo: { broken: true } },
      e: [1, 2],
    }));
    expect(readLocalHorizon(45, 7, {}, s)).toEqual({ terrain: good });
    s.setItem(HORIZON_STORAGE_KEY, '[]');
    expect(readLocalHorizon(45, 7, {}, s)).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(readLocalHorizon(45, 7, {}, broken)).toBeNull();
    expect(saveHorizonLayer(profile(), broken)).toBe(false);
    expect(saveHorizonLayer(profile(), undefined)).toBe(false);
    expect(readLocalHorizon(NaN, 7, {}, s)).toBeNull();
    expect(parseHorizonProfile({ ...good, stepDeg: 7 })).toBeNull();
    expect(parseHorizonProfile({ ...good, lat: 91 })).toBeNull();
    expect(parseHorizonProfile({ ...good, computedAt: 'soon' })).toBeNull();
  });
  it('keeps at most 30 sites, evicting the oldest', () => {
    const s = storage();
    for (let i = 0; i < MAX_HORIZON_SITES + 5; i++) expect(saveHorizonLayer(profile(40 + i * 0.01, 7), s, 1000 + i)).toBe(true);
    const stored = JSON.parse(s.items.get(HORIZON_STORAGE_KEY)!);
    expect(Object.keys(stored)).toHaveLength(MAX_HORIZON_SITES);
    expect(readLocalHorizon(40, 7, {}, s)).toBeNull();
    expect(readLocalHorizon(40 + (MAX_HORIZON_SITES + 4) * 0.01, 7, {}, s)).not.toBeNull();
  });
});

describe('shared terrain jobs', () => {
  it('runs one computation per site for all callers and stores the result', async () => {
    const s = storage();
    vi.stubGlobal('localStorage', s);
    let resolve!: (p: HorizonProfile) => void;
    const compute = vi.fn((lat: number, lon: number, opts: { onProgress: (f: number) => void }) => {
      opts.onProgress(0.5);
      return new Promise<HorizonProfile>((r) => { resolve = r; });
    });
    resetTerrainJobs(compute);
    const a = startTerrainJob(45.0703, 7.6869), b = startTerrainJob(45.07031, 7.68691);
    const key = horizonSiteKey(45.0703, 7.6869);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(terrainJob(key)?.progress).toBe(0.5);
    expect(shouldAutoCompute(key)).toBe(false);
    resolve(profile());
    expect(await a).toEqual(profile());
    expect(await b).toEqual(profile());
    expect(terrainJob(key)).toBeUndefined();
    expect(readSiteHorizon(45.0703, 7.6869)?.terrain?.alt[1]).toBe(0.3);
    expect(readLocalHorizon(45.0703, 7.6869, {}, s)?.terrain).toBeTruthy();
  });
  it('remembers failures, waits before retrying automatically, and keeps results in memory without storage', async () => {
    resetTerrainJobs(async () => { throw new Error('Could not load elevation data (HTTP 503).'); });
    expect(await startTerrainJob(10, 20)).toBeNull();
    const key = horizonSiteKey(10, 20);
    expect(terrainFailure(key)).toMatchObject({ message: /HTTP 503/, forced: false });
    expect(shouldAutoCompute(key)).toBe(false);
    expect(shouldAutoCompute(key, Date.now() + AUTO_RETRY_MS)).toBe(true);
    resetTerrainJobs(async () => profile(10, 20));
    expect(await startTerrainJob(10, 20, true)).toBeTruthy();
    expect(terrainFailure(key)).toBeUndefined();
    expect(readSiteHorizon(10, 20)?.terrain?.lat).toBe(10); // no localStorage in Node: memory fallback
  });
  it('cancels a run nobody shows any more, after a grace period', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    resetTerrainJobs((lat, lon, opts) => { signal = opts.signal; return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))); });
    const key = horizonSiteKey(1, 2);
    const release = retainTerrainSite(key);
    const run = startTerrainJob(1, 2);
    release();
    const again = retainTerrainSite(key); // a quick remount keeps it alive
    vi.advanceTimersByTime(5000);
    expect(signal.aborted).toBe(false);
    again();
    vi.advanceTimersByTime(5000);
    expect(signal.aborted).toBe(true);
    expect(await run).toBeNull();
    expect(terrainFailure(key)).toBeUndefined();
  });
});
