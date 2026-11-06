import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HORIZON_PREFS_KEY, localHorizonEnabled, resetLocalHorizonPref, setLocalHorizonEnabled, subscribeLocalHorizonPref,
} from '@/lib/horizon/prefs';
import { saveHorizonLayer, storedHorizonKindsNear, storedHorizonSites } from '@/lib/horizon/store';
import { resetTerrainJobs } from '@/lib/horizon/terrain-jobs';
import { destination } from '@/lib/horizon/terrain';
import type { HorizonProfile } from '@/lib/horizon/types';
import { useLocalHorizon } from '@/hooks/use-local-horizon';

function storage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, v: string) => { items.set(key, v); } };
}
const profile = (lat = 46.0207, lon = 7.7491): HorizonProfile => ({
  kind: 'terrain', stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => (i >= 200 && i <= 260 ? 20 : 2)),
  distanceKm: Array.from({ length: 360 }, () => 8), lat, lon, groundM: 1603, computedAt: '2026-11-06T12:00:00.000Z', source: 'Mapterhorn',
});

afterEach(() => { vi.unstubAllGlobals(); resetLocalHorizonPref(); resetTerrainJobs(); });

describe('local horizon preference', () => {
  it('defaults to on, persists off/on and tolerates junk or missing storage', () => {
    const s = storage();
    expect(localHorizonEnabled(s)).toBe(true);
    expect(setLocalHorizonEnabled(false, s)).toBe(true);
    expect(JSON.parse(s.items.get(HORIZON_PREFS_KEY)!)).toEqual({ enabled: false });
    resetLocalHorizonPref();
    expect(localHorizonEnabled(s)).toBe(false);
    setLocalHorizonEnabled(true, s);
    resetLocalHorizonPref();
    expect(localHorizonEnabled(s)).toBe(true);
    s.items.set(HORIZON_PREFS_KEY, '{not json');
    resetLocalHorizonPref();
    expect(localHorizonEnabled(s)).toBe(true);
    resetLocalHorizonPref();
    expect(setLocalHorizonEnabled(false, undefined)).toBe(false);
    expect(localHorizonEnabled(undefined)).toBe(false); // still applies for this session
  });

  it('notifies subscribers only on a change', () => {
    const s = storage(), seen: boolean[] = [];
    const off = subscribeLocalHorizonPref(() => seen.push(localHorizonEnabled(s)));
    setLocalHorizonEnabled(true, s);
    setLocalHorizonEnabled(false, s);
    setLocalHorizonEnabled(false, s);
    setLocalHorizonEnabled(true, s);
    off();
    setLocalHorizonEnabled(false, s);
    expect(seen).toEqual([false, true]);
  });
});

describe('useLocalHorizon with the preference', () => {
  const Probe = ({ lat, lon }: { lat: number; lon: number }) => {
    const { horizon, status } = useLocalHorizon(lat, lon);
    return createElement('p', null, `${status.state}|${horizon?.terrain ? horizon.terrain.groundM : 'none'}`);
  };
  const render = (lat: number, lon: number) => renderToStaticMarkup(createElement(Probe, { lat, lon }));

  it('returns the stored horizon when on, and nothing (status idle) when off', () => {
    const s = storage();
    vi.stubGlobal('localStorage', s);
    vi.stubGlobal('navigator', { onLine: true });
    expect(saveHorizonLayer(profile(), s)).toBe(true);
    expect(render(46.0207, 7.7491)).toBe('<p>ready|1603</p>');
    setLocalHorizonEnabled(false);
    expect(render(46.0207, 7.7491)).toBe('<p>idle|none</p>');
    setLocalHorizonEnabled(true);
    expect(render(46.0207, 7.7491)).toBe('<p>ready|1603</p>');
    expect(render(37.77, -122.42)).toBe('<p>idle|none</p>');
  });
});

describe('stored horizon sites (saved-location markers)', () => {
  it('lists stored layers and finds them within 200 m only', () => {
    const s = storage(), p = profile();
    saveHorizonLayer(p, s);
    const sites = storedHorizonSites(s);
    expect(sites).toEqual([{ lat: p.lat, lon: p.lon, kinds: ['terrain'] }]);
    const [nl, no] = destination(p.lat, p.lon, 90, 150), [fl, fo] = destination(p.lat, p.lon, 90, 400);
    expect(storedHorizonKindsNear(sites, nl, no)).toEqual(['terrain']);
    expect(storedHorizonKindsNear(sites, fl, fo)).toEqual([]);
    expect(storedHorizonKindsNear(sites, NaN, 0)).toEqual([]);
    expect(storedHorizonSites(undefined)).toEqual([]);
  });
});
