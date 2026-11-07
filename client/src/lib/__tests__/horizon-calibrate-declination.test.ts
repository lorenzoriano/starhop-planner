import { describe, expect, it } from 'vitest';
import geomagnetism from 'geomagnetism';
import { magneticDeclinationDeg } from '../horizon/calibrate/declination';

const PLACES: Array<[string, number, number]> = [
  ['Turin', 45.07, 7.69], ['Boston', 42.36, -71.06], ['Denver', 39.74, -104.99], ['Sydney', -33.87, 151.21],
  ['Reykjavik', 64.15, -21.94], ['Equator 120E', 0, 120], ['Cape Town', -33.92, 18.42], ['Anchorage', 61.22, -149.9],
  ['Tokyo', 35.68, 139.69], ['Near south pole', -80, 240], ['High north', 80, 0], ['Dateline', 10, 180],
];

describe('magnetic declination (WMM-2025)', () => {
  for (const date of [new Date('2025-01-01T00:00:00Z'), new Date('2026-11-06T21:00:00Z'), new Date('2029-06-30T12:00:00Z')]) {
    it(`matches the geomagnetism package at many places on ${date.toISOString().slice(0, 10)}`, () => {
      const model = geomagnetism.model(date);
      for (const [, lat, lon] of PLACES) {
        expect(magneticDeclinationDeg(lat, lon, date)).toBeCloseTo(model.point([lat, lon]).decl, 6);
      }
    });
  }

  it('gives the expected sign and size at well-known places', () => {
    const d = new Date('2026-11-06T00:00:00Z');
    expect(magneticDeclinationDeg(45.07, 7.69, d)).toBeGreaterThan(2); // Turin: ≈ +3.5° east
    expect(magneticDeclinationDeg(45.07, 7.69, d)).toBeLessThan(5);
    expect(magneticDeclinationDeg(42.36, -71.06, d)).toBeLessThan(-12); // Boston: ≈ −14° west
    expect(magneticDeclinationDeg(-33.87, 151.21, d)).toBeGreaterThan(11); // Sydney: ≈ +12.8° east
  });

  it('is finite outside the model years and safe at the poles', () => {
    expect(Number.isFinite(magneticDeclinationDeg(45, 7, new Date('2031-01-01T00:00:00Z')))).toBe(true);
    expect(magneticDeclinationDeg(90, 0, new Date())).toBe(0);
    expect(magneticDeclinationDeg(NaN, 0, new Date())).toBe(0);
  });
});
