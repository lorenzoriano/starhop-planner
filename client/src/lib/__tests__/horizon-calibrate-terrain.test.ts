import { describe, expect, it } from 'vitest';
import { terrainMatchFix } from '../horizon/calibrate/terrain-match';
import { chooseYaw } from '../horizon/calibrate/yaw';
import { angleDiffDeg } from '../horizon/calibrate/quat';
import type { HorizonProfile } from '../horizon/types';
import { rng } from './horizon-calibrate-synth';
import overcastHills from './horizon-sim-overcast-hills.json';

const RAD = Math.PI / 180;

function profile(alt: (az: number) => number, km: (az: number) => number, stepDeg = 0.5): HorizonProfile {
  const n = Math.round(360 / stepDeg);
  return {
    kind: 'terrain', stepDeg,
    alt: Array.from({ length: n }, (_, i) => alt(i * stepDeg)),
    distanceKm: Array.from({ length: n }, (_, i) => km(i * stepDeg)),
    lat: 46, lon: 7.7, computedAt: '2026-11-06T12:00:00.000Z', source: 'test',
  };
}

const hills = (az: number) => 2 + 3 * Math.sin(2 * az * RAD) + 1.5 * Math.sin((5 * az + 40) * RAD) + 0.8 * Math.sin((11 * az + 10) * RAD);

/** Photo skyline seen in the relative frame: terrain shifted by the true offset, plus pitch bias, noise and trees. */
function photoOf(terrainAlt: (az: number) => number, trueOffset: number, opts: { bias?: number; noise?: number; trees?: Array<[number, number, number]>; gaps?: Array<[number, number]> } = {}) {
  const r = rng(5);
  // Smooth-ish noise: fixed random values per degree, interpolated.
  const nz = Array.from({ length: 361 }, () => (r() - 0.5) * 2 * (opts.noise ?? 0.1));
  nz[360] = nz[0];
  return (rel: number): number | null => {
    const az = (((rel + trueOffset) % 360) + 360) % 360;
    for (const [a, b] of opts.gaps ?? []) if (az >= a && az < b) return null;
    const i = Math.floor(az), f = az - i;
    let alt = terrainAlt(az) + (opts.bias ?? 0) + nz[i] * (1 - f) + nz[i + 1] * f;
    for (const [a, b, h] of opts.trees ?? []) if (az >= a && az < b) alt = Math.max(alt, h);
    return alt;
  };
}

describe('terrainMatchFix', () => {
  const terrain = profile(hills, (az) => (az > 300 ? 0.8 : 8 + 4 * Math.sin(az * RAD)));

  it('recovers a known yaw within 0.2° despite a 12° compass error, pitch bias, noise and some trees', () => {
    for (const trueOffset of [37.3, -151.8, 179.6]) {
      const photo = photoOf(hills, trueOffset, { bias: 0.4, noise: 0.15, trees: [[100, 140, 14], [200, 215, 9]] });
      const fix = terrainMatchFix(photo, terrain, trueOffset + 12);
      expect(fix).not.toBeNull();
      expect(Math.abs(angleDiffDeg(fix!.offsetDeg, trueOffset))).toBeLessThan(0.2);
      expect(fix!.source).toBe('terrain');
      expect(fix!.label).toBe('the hills');
      expect(fix!.sigmaDeg).toBeGreaterThanOrEqual(1);
      expect(fix!.sigmaDeg).toBeLessThanOrEqual(3);
    }
  });

  it('never claims better than 1° (the elevation model\'s accuracy), so a centred Sun wins over perfect hills', () => {
    // Noise-free photo of the very terrain profile: the fit alone would claim ~0.1°.
    const fix = terrainMatchFix(photoOf(hills, 37.3, { noise: 0 }), terrain, 40);
    expect(fix).not.toBeNull();
    expect(fix!.sigmaDeg).toBe(1);
    const sun = { source: 'sun' as const, offsetDeg: 37.5, sigmaDeg: 0.58, label: 'the Sun' };
    expect(chooseYaw([fix!, sun])!.chosen.source).toBe('sun');
  });

  it('works with a 1° terrain profile and unknown parts of the photo skyline', () => {
    const coarse = profile(hills, () => 15, 1);
    const photo = photoOf(hills, 80, { gaps: [[0, 90]], noise: 0.1 });
    const fix = terrainMatchFix(photo, coarse, 72, { searchDeg: 15 });
    expect(fix).not.toBeNull();
    expect(Math.abs(angleDiffDeg(fix!.offsetDeg, 80))).toBeLessThan(0.2);
  });

  it('searches the whole circle when there is no compass (searchDeg 180)', () => {
    for (const [trueOffset, seed] of [[-120.4, 0], [178.2, 0], [5, 0]]) {
      const photo = photoOf(hills, trueOffset, { noise: 0.1, trees: [[100, 140, 14]] });
      const t0 = performance.now();
      const fix = terrainMatchFix(photo, terrain, seed, { searchDeg: 180 });
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(fix).not.toBeNull();
      expect(Math.abs(angleDiffDeg(fix!.offsetDeg, trueOffset))).toBeLessThan(0.2);
    }
    const flat = profile(() => -0.12, () => 30);
    expect(terrainMatchFix(photoOf(() => -0.12, 25, { noise: 0.1 }), flat, 0, { searchDeg: 180 })).toBeNull();
  });

  it('returns null when the true offset lies outside the search window', () => {
    const photo = photoOf(hills, 40, { noise: 0.05 });
    expect(terrainMatchFix(photo, terrain, 10, { searchDeg: 10 })).toBeNull();
  });

  it('returns null at a flat site (nothing to lock onto)', () => {
    const flat = profile(() => -0.12, () => 30);
    const photo = photoOf(() => -0.12, 25, { noise: 0.1 });
    expect(terrainMatchFix(photo, flat, 30)).toBeNull();
  });

  it('returns null in a backyard: near trees hide the hills almost everywhere', () => {
    const photo = photoOf(hills, 25, { noise: 0.1, trees: [[0, 150, 18], [175, 360, 22]] });
    expect(terrainMatchFix(photo, terrain, 30)).toBeNull();
  });

  it('ignores near slopes: ridges under 2 km never count', () => {
    const near = profile(hills, () => 0.6);
    const photo = photoOf(hills, 25, { noise: 0.05 });
    expect(terrainMatchFix(photo, near, 30)).toBeNull();
  });

  it('returns null when the photo skyline does not resemble the terrain', () => {
    const r = rng(11);
    const junk = Array.from({ length: 360 }, () => r() * 8);
    expect(terrainMatchFix((rel) => junk[Math.floor(((rel % 360) + 360) % 360)], terrain, 0)).toBeNull();
  });

  it('a repeating skyline (ridges every 6°) is ambiguous and rejected', () => {
    const ridges = (az: number) => 3 + 1.5 * Math.sin(60 * az * RAD);
    const p = profile(ridges, () => 20);
    const photo = photoOf(ridges, 50, { noise: 0.05 });
    expect(terrainMatchFix(photo, p, 50)).toBeNull();
  });

  it('accepts a clear minimum whose ±0.5° neighbourhood is flattened by sampling ripple (simulated overcast hills)', () => {
    // Recorded by the simulation harness: the cost bowl is clear over ±2°, but a 0.5°-period ripple made the old ±0.5°
    // parabola concave and the match was declined, leaving a compass that was 7.5° off.
    const f = overcastHills as unknown as { photoStepDeg: number; photo: Array<number | null>; terrain: HorizonProfile; compassOffsetDeg: number; trueOffsetDeg: number };
    const n = f.photo.length;
    const photo = (rel: number) => f.photo[Math.round((((rel % 360) + 360) % 360) / f.photoStepDeg) % n];
    const fix = terrainMatchFix(photo, f.terrain, f.compassOffsetDeg);
    expect(fix).not.toBeNull();
    expect(Math.abs(angleDiffDeg(fix!.offsetDeg, f.trueOffsetDeg))).toBeLessThan(0.5);
    expect(fix!.sigmaDeg).toBeGreaterThanOrEqual(1);
    expect(Math.abs(angleDiffDeg(f.compassOffsetDeg, f.trueOffsetDeg))).toBeGreaterThan(5);
  });

  it('still declines a cost that is not a bowl even over ±2° (flat terrain seen through noise)', () => {
    const gentle = profile(() => 1, () => 20);
    const photo = photoOf(() => 1, 30, { noise: 0.2 });
    expect(terrainMatchFix(photo, gentle, 35)).toBeNull();
  });
});
