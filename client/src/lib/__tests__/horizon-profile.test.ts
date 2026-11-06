import { describe, expect, it } from 'vitest';
import {
  blockedDirections8, clearIntervals, clearanceDeg, compactHorizon, geometricFromApparent, apparentFromGeometric, highestPoint, horizonAltitudeAt,
  horizonFingerprint, horizonLookup, horizonSummary, horizonThresholdAt, isAboveLocalHorizon, openDirections8, refractionDeg,
} from '@/lib/horizon/profile';
import type { HorizonProfile, LocalHorizon } from '@/lib/horizon/types';
import zermattVillage from './horizon-zermatt-village.json';

const profile = (alt: (az: number) => number, extra: Partial<HorizonProfile> = {}): HorizonProfile => ({
  kind: 'terrain', stepDeg: 1, alt: Array.from({ length: 360 }, (_, i) => alt(i)), lat: 45, lon: 7, computedAt: '2026-11-06T12:00:00Z', source: 'test', ...extra,
});
const flat5: LocalHorizon = { terrain: profile(() => 5) };

describe('refraction and the geometric-equivalent threshold', () => {
  it('uses standard astronomical refraction', () => {
    expect(refractionDeg(0)).toBeCloseTo(0.575, 2);
    expect(refractionDeg(5)).toBeCloseTo(0.165, 2);
    expect(refractionDeg(90)).toBe(0);
    expect(Number.isFinite(refractionDeg(-10))).toBe(true);
    expect(geometricFromApparent(5)).toBeCloseTo(4.835, 2);
    for (const a of [-0.5, 0, 0.5, 1.4, 5, 20]) expect(apparentFromGeometric(geometricFromApparent(a))).toBeCloseTo(a, 1);
  });
  it('compares GEOMETRIC target altitudes with the skyline minus refraction', () => {
    expect(Math.abs(horizonThresholdAt(flat5, 123)! - 4.835)).toBeLessThan(0.01);
    expect(isAboveLocalHorizon(flat5, 4.9, 10)).toBe(true);
    expect(isAboveLocalHorizon(flat5, 4.8, 10)).toBe(false);
    expect(isAboveLocalHorizon(flat5, 5.5, 10, 1)).toBe(false);
    expect(Math.abs(clearanceDeg(flat5, 6, 200)! - 1.165)).toBeLessThan(0.01);
    // A sea horizon (apparent ≈ 0) shows stars down to about −0.57° geometric.
    expect(isAboveLocalHorizon({ terrain: profile(() => 0) }, -0.5, 0)).toBe(true);
  });
  it('keeps the flat-horizon rule (alt ≥ 0) when nothing is known', () => {
    for (const h of [null, undefined, {}, { terrain: null }]) {
      expect(horizonAltitudeAt(h, 10)).toBeNull();
      expect(clearanceDeg(h, 10, 10)).toBeNull();
      expect(horizonLookup(h)).toBeNull();
      expect(compactHorizon(h)).toBeNull();
      expect(isAboveLocalHorizon(h, 0.1, 10, 3)).toBe(true);
      expect(isAboveLocalHorizon(h, -0.1, 10)).toBe(false);
      expect(horizonFingerprint(h)).toBe('flat');
    }
  });
});

describe('skyline interpolation and lookups', () => {
  const h: LocalHorizon = { terrain: profile((az) => (az === 359 ? 2 : az === 0 ? 4 : 0)), photo: { ...profile((az) => (az === 180 ? 10 : 0)), kind: 'photo' } };
  it('interpolates linearly with wrap-around and takes the max of layers', () => {
    expect(horizonAltitudeAt(h, 359.5)).toBeCloseTo(3);
    expect(horizonAltitudeAt(h, -0.5)).toBeCloseTo(3);
    expect(horizonAltitudeAt(h, 360)).toBeCloseTo(4);
    expect(horizonAltitudeAt(h, 0.25)).toBeCloseTo(3);
    expect(horizonAltitudeAt(h, 180)).toBeCloseTo(10);
    expect(horizonAltitudeAt(h, 179.5)).toBeCloseTo(5);
  });
  it('builds a fast lookup and a structured-cloneable compact form that agree', () => {
    const lookup = horizonLookup(h)!;
    const compact = structuredClone(compactHorizon(h)!);
    expect(compact).toMatchObject({ kind: 'geometric', stepDeg: 1 });
    expect(compact.alt).toHaveLength(360);
    const fromCompact = horizonLookup(compact)!;
    for (const az of [-0.5, 0, 0.3, 90, 179.5, 180, 359.5, 719]) {
      const expected = geometricFromApparent(horizonAltitudeAt(h, az)!);
      // Interpolating thresholds vs converting the interpolated skyline differs slightly on steep 1° slopes.
      expect(Math.abs(lookup(az) - expected)).toBeLessThan(Number.isInteger(az) ? 0.01 : 0.2);
      expect(fromCompact(az)).toBeCloseTo(lookup(az), 2);
    }
    expect(isAboveLocalHorizon(compact, 10, 180)).toBe(true);
    expect(isAboveLocalHorizon(compact, 9.8, 180)).toBe(false);
  });
  it('fingerprints the combined skyline stably', () => {
    const a = horizonFingerprint(h);
    expect(horizonFingerprint({ terrain: h.terrain, photo: h.photo })).toBe(a);
    expect(horizonFingerprint(compactHorizon(h))).toBe(a);
    expect(horizonFingerprint({ terrain: h.terrain })).not.toBe(a);
    expect(a.length).toBeLessThan(20);
  });
});

describe('clear intervals', () => {
  const MIN = 60000;
  it('finds where a rising and setting target clears the skyline, refined by bisection', () => {
    const T = 600 * MIN;
    const position = (t: number) => ({ alt: 30 * Math.sin((Math.PI * t) / T) - 5, az: 90 + (t / T) * 180 });
    const samples = Array.from({ length: 21 }, (_, i) => ({ t: (i * T) / 20, ...position((i * T) / 20) }));
    const exact = (alt: number) => [(T / Math.PI) * Math.asin((alt + 5) / 30), T - (T / Math.PI) * Math.asin((alt + 5) / 30)];
    const threshold = geometricFromApparent(5);
    const [start, end] = exact(threshold);
    const refined = clearIntervals(samples, flat5, { position });
    expect(refined).toHaveLength(1);
    expect(Math.abs(refined[0].start - start)).toBeLessThan(MIN / 2);
    expect(Math.abs(refined[0].end - end)).toBeLessThan(MIN / 2);
    const linear = clearIntervals(samples, flat5);
    expect(Math.abs(linear[0].start - start)).toBeLessThan(5 * MIN);
    const [flatStart] = exact(0);
    expect(Math.abs(clearIntervals(samples, null, { position })[0].start - flatStart)).toBeLessThan(MIN / 2);
  });
  it('splits windows when the target passes behind a peak and keeps open ends', () => {
    const peak: LocalHorizon = { terrain: profile((az) => (az >= 100 && az <= 110 ? 30 : 0)) };
    const samples = Array.from({ length: 31 }, (_, i) => ({ t: i * MIN, alt: 20, az: 90 + i }));
    const windows = clearIntervals(samples, peak);
    expect(windows).toHaveLength(2);
    expect(windows[0].start).toBe(0);
    expect(windows[1].end).toBe(30 * MIN);
    expect(windows[0].end).toBeGreaterThan(9 * MIN);
    expect(windows[0].end).toBeLessThan(10 * MIN);
    expect(clearIntervals([], peak)).toEqual([]);
  });
});

describe('descriptions', () => {
  it('maps blocked and open compass directions', () => {
    const ridge: LocalHorizon = { terrain: profile((az) => (az >= 30 && az <= 150 ? 15 : 1)) };
    expect(blockedDirections8(ridge, 10)).toEqual(['NE', 'E', 'SE']);
    expect(openDirections8(ridge, 10)).toEqual(['N', 'S', 'SW', 'W', 'NW']);
    expect(blockedDirections8(ridge, 20)).toEqual([]);
    expect(blockedDirections8(null)).toEqual([]);
    expect(openDirections8(null)).toHaveLength(8);
  });
  it('summarises a profile in plain language', () => {
    const hills = profile((az) => (az >= 30 && az <= 60 ? 2 : 0.2), { distanceKm: Array(360).fill(12) });
    expect(highestPoint(hills)).toEqual({ az: 30, alt: 2, distanceKm: 12 });
    expect(horizonSummary(hills)).toBe('Hills block up to 2° to the northeast (12 km away); open from east to north.');
    expect(horizonSummary(profile(() => -0.1))).toMatch(/^Open horizon all around/);
    expect(horizonSummary(null)).toMatch(/flat horizon/);
  });
  it('handles a real alpine valley (Zermatt, Mapterhorn) and agrees with PVGIS', () => {
    const p = zermattVillage as HorizonProfile;
    expect(highestPoint(p)).toMatchObject({ az: 312 });
    expect(horizonSummary(p)).toBe('Mountains block up to 33° to the northwest (1.2 km away); the lowest gap is 4° to the north.');
    expect(blockedDirections8({ terrain: p }, 10)).toHaveLength(8);
    // PVGIS printhorizon for 46.0207, 7.7491 (7.5° steps from north; 90 m DEM). Sharp ridges between its samples
    // differ by a few degrees; typical agreement is a fraction of a degree.
    const pvgis = [20.6, 15.7, 9.5, 5.0, 7.6, 10.7, 13.4, 14.9, 18.0, 19.1, 19.9, 21.0, 21.8, 24.8, 25.6, 26.0, 25.6, 26.4, 26.7,
      25.2, 21.4, 19.5, 19.5, 18.3, 16.8, 16.0, 13.0, 12.6, 12.2, 11.8, 12.6, 14.5, 14.1, 19.1, 23.3, 24.8, 27.5, 29.0, 27.1, 22.5,
      20.6, 25.6, 32.1, 31.3, 30.9, 29.4, 25.6, 22.9];
    const errors = pvgis.map((v, i) => Math.abs(horizonAltitudeAt({ terrain: p }, i * 7.5)! - v)).sort((a, b) => a - b);
    expect(errors.reduce((s, e) => s + e, 0) / errors.length).toBeLessThan(1);
    expect(errors[errors.length >> 1]).toBeLessThan(0.5);
  });
});
